import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer as createHttpServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'

// These values take precedence over .env.local in Vite.
process.env.VITE_SUPABASE_URL = 'disabled'
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'disabled'
process.env.VITE_ENABLE_LOCAL_MENU_DELETE = 'false'
process.env.VITE_ENABLE_LOCAL_MATCH_RECORDS = 'true'
process.env.VITE_BASE_PATH = '/'

async function waitFor(check, description) {
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    const result = await check()
    if (result) return result
    await delay(100)
  }
  throw new Error('Timed out waiting for ' + description)
}

async function openChrome(t) {
  const profile = await mkdtemp(join(tmpdir(), 'aoba-focus-'))
  let chrome, socket
  t.after(async () => {
    socket?.close()
    if (chrome?.pid && chrome.exitCode === null && chrome.signalCode === null) {
      const exited = once(chrome, 'exit')
      chrome.kill()
      await exited
    }
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  })
  const executable = process.env.AOBA_TEST_CHROME ?? (process.platform === 'win32'
    ? join(process.env.ProgramFiles ?? 'C:/Program Files', 'Google/Chrome/Application/chrome.exe')
    : 'google-chrome')
  chrome = spawn(executable, ['--headless=new', '--disable-background-networking', '--no-first-run',
    '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--user-data-dir=' + profile, 'about:blank'],
  { stdio: 'ignore', windowsHide: true })
  await once(chrome, 'spawn')
  const port = await waitFor(async () => {
    if (chrome.exitCode !== null) throw new Error('Chrome exited before DevTools was ready')
    const file = await readFile(join(profile, 'DevToolsActivePort'), 'utf8').catch(error => {
      if (error.code !== 'ENOENT' && error.code !== 'EBUSY') throw error
      return ''
    })
    return file.split(/\r?\n/)[0]
  }, 'Chrome DevTools')
  const pages = await fetch('http://127.0.0.1:' + port + '/json/list').then(response => response.json())
  socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl)
  await once(socket, 'open')
  let nextId = 0

  function command(method, params = {}) {
    const id = ++nextId
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.removeEventListener('message', receive)
        reject(new Error('Chrome did not answer ' + method))
      }, 30_000)
      function receive(event) {
        const message = JSON.parse(event.data)
        if (message.id !== id) return
        clearTimeout(timeout)
        socket.removeEventListener('message', receive)
        if (message.error) reject(new Error(message.error.message))
        else resolve(message.result)
      }
      socket.addEventListener('message', receive)
      socket.send(JSON.stringify({ id, method, params }))
    })
  }

  async function evaluate(expression) {
    const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
    return result.result.value
  }

  await command('Network.enable')
  await command('Network.setBlockedURLs', { urls: ['*://*.supabase.co/*'] })
  return { command, evaluate }
}

test('Settings, calendar plans, home progress and migration in Chrome', { timeout: 150_000 }, async t => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' })
  t.after(() => server.close())
  await server.listen()
  const origin = 'http://127.0.0.1:' + server.httpServer.address().port
  const { command, evaluate } = await openChrome(t)
  async function capture(name, width) {
    if (!process.env.AOBA_UI_SCREENSHOTS) return
    const shot = await command('Page.captureScreenshot', { format: 'png' })
    await writeFile(join(process.env.AOBA_UI_SCREENSHOTS, `${name}-${width}.png`), Buffer.from(shot.data, 'base64'), { flag: 'wx' })
  }
  for (const width of [375, 430]) {
    await command('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: true })
    await command('Page.navigate', { url: origin + '/?width=' + width })
    await waitFor(() => evaluate(`location.search === '?width=${width}' &&
      !!document.querySelector('nav button:not(:disabled)')`), `app at ${width}px`)
    await evaluate(`
      globalThis.button = label => [...document.querySelectorAll('button')].find(item =>
        (item.getAttribute('aria-label') ?? item.textContent.trim()) === label);
      globalThis.group = name => document.querySelector('details[data-menu-category="' + name + '"]');
      globalThis.summary = name => group(name).querySelector('summary');
      globalThis.active = () => document.activeElement;
      button('設定').click();
    `)
    await waitFor(() => evaluate("!!group('打撃')"), 'settings menu')
    assert.equal(await evaluate('innerWidth'), width)

    const cases = [
      ['一括閉鎖は分類内から閉じるボタンにフォーカスを移す',
        "summary('打撃').click(); button('素振りを編集').focus(); button('すべて閉じる').click();",
        "active() === button('すべて閉じる') && !group('打撃').open"],
      ['一括閉鎖は分類外のフォーカスを保持する',
        "summary('打撃').click(); button('すべて開く').focus(); button('すべて閉じる').click();",
        "active() === button('すべて開く') && !group('打撃').open"],
      ['個別閉鎖は分類内から見出しにフォーカスを移す',
        "summary('打撃').click(); button('素振りを編集').focus(); summary('打撃').click();",
        "active() === summary('打撃') && !group('打撃').open"],
      ['見出しのキーボード操作は見出しにフォーカスを保持する',
        "summary('打撃').click(); summary('打撃').focus();",
        "active() === summary('打撃') && !group('打撃').open", true],
      ['複数分類を閉じても隠れた要素にフォーカスが残らない',
        "button('すべて開く').click(); button('素振りを編集').focus(); button('すべて閉じる').click();",
        "active() === button('すべて閉じる') && !document.querySelector('details[data-menu-category][open]')"],
    ]
    for (const [name, action, expected, keyboard] of cases) {
      await t.test(`${width}px ${name}`, async () => {
        await evaluate(`button('すべて閉じる').click(); ${action}`)
        if (keyboard) {
          const key = { key: ' ', code: 'Space', windowsVirtualKeyCode: 32 }
          await command('Input.dispatchKeyEvent', { ...key, type: 'keyDown', text: ' ' })
          await command('Input.dispatchKeyEvent', { ...key, type: 'keyUp' })
        }
        assert.equal(await evaluate(expected), true)
      })
    }

    await t.test(`${width}px カレンダー予定の選択・保存・再読込と旧データ編集`, async () => {
      async function reloadCalendar() {
        const before = await evaluate('performance.timeOrigin')
        await command('Page.reload')
        await waitFor(() => evaluate(`performance.timeOrigin !== ${before} &&
          !!document.querySelector('nav button:not(:disabled)')`).catch(error => {
          if (/context/i.test(error.message)) return false
          throw error
        }), 'app reloaded')
        await evaluate(`
          globalThis.button = label => [...document.querySelectorAll('button')].find(item =>
            (item.getAttribute('aria-label') ?? item.textContent.trim()) === label);
          globalThis.radios = () => [...document.querySelectorAll('.calendar-plan-kinds input[type=radio]')];
          globalThis.readPlan = async () => {
            const { createStorage } = await import('/src/storage.ts');
            const { localDate } = await import('/src/dates.ts');
            return (await createStorage().read()).plans.find(row => row.date === localDate(new Date())) ?? null;
          };
          button('カレンダー').click();
        `)
        await waitFor(() => evaluate("!!button('予定を追加') || !!button('予定を編集')"), 'calendar')
      }
      async function openEditor(label) {
        await evaluate(`button(${JSON.stringify(label)}).click()`)
        await waitFor(() => evaluate('radios().length === 4'), 'plan editor')
      }
      await evaluate(`(async () => {
        const { createStorage } = await import('/src/storage.ts');
        const { localDate } = await import('/src/dates.ts');
        const date = localDate(new Date());
        await createStorage().update(data => ({ ...data, plans: data.plans.filter(row => row.date !== date) }));
      })()`)
      await reloadCalendar()
      await openEditor('予定を追加')
      assert.deepEqual(await evaluate('radios().map(input => input.value)'), ['自主練', 'チーム練習', '試合', '休養日'])
      assert.equal(await evaluate("radios().find(input => input.checked).value"), '自主練')
      assert.equal(await evaluate(`radios().every(input => {
        const { left, right, width, height } = input.labels[0].getBoundingClientRect();
        return left >= 0 && right <= innerWidth && width >= 44 && height >= 44 &&
          !!input.labels[0].querySelector('svg.activity-icon');
      }) && radios()[0].offsetTop === radios()[1].offsetTop &&
        radios()[0].labels[0].getBoundingClientRect().top < radios()[2].labels[0].getBoundingClientRect().top`), true)
      const center = await evaluate(`(() => {
        const label = radios()[2].labels[0];
        label.scrollIntoView({ block: 'center' });
        const box = label.getBoundingClientRect();
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      })()`)
      await command('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [center] })
      await command('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await waitFor(() => evaluate("radios().find(input => input.checked)?.value === '試合'"), 'tap selected match')
      assert.equal(await evaluate('readPlan()'), null)
      assert.deepEqual(await evaluate(`radios().map(input => getComputedStyle(
        input.labels[0].querySelector('.calendar-plan-check')).visibility)`), ['hidden', 'hidden', 'visible', 'hidden'])
      await evaluate("button('予定を保存').click()")
      await waitFor(() => evaluate("!!button('予定を編集')"), 'new plan saved')
      assert.deepEqual(await evaluate('readPlan().then(({kind, menuIds}) => ({kind, menuIds}))'), { kind: '試合', menuIds: [] })

      await evaluate(`(async () => {
        const { createStorage } = await import('/src/storage.ts');
        const saved = await readPlan();
        await createStorage().update(data => ({ ...data, plans: data.plans.map(row => row.date === saved.date
          ? { date: saved.date, kind: '自主練', menuIds: ['swing'] } : row) }));
      })()`)
      await reloadCalendar()
      await openEditor('予定を編集')
      await evaluate('radios()[0].focus()')
      assert.equal(await evaluate("radios().find(input => input.checked).value"), '自主練')
      const key = { key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 }
      await command('Input.dispatchKeyEvent', { ...key, type: 'keyDown' })
      await command('Input.dispatchKeyEvent', { ...key, type: 'keyUp' })
      assert.equal(await evaluate("document.activeElement.value === 'チーム練習' && document.activeElement.checked"), true)
      assert.equal(await evaluate("readPlan().then(plan => plan.kind)"), '自主練')
      await evaluate("button('予定を保存').click()")
      await waitFor(() => evaluate("!!button('予定を編集')"), 'edited plan saved')
      await reloadCalendar()
      await openEditor('予定を編集')
      assert.equal(await evaluate("radios().find(input => input.checked).value"), 'チーム練習')
      assert.deepEqual(await evaluate('readPlan().then(({kind, menuIds}) => ({kind, menuIds}))'),
        { kind: 'チーム練習', menuIds: ['swing'] })
    })

    await t.test(`${width}px ホームの期間切替と月別目標の保存`, async () => {
      async function openHome(stage) {
        const query = `?progress=${width}-${stage}`
        await command('Page.navigate', { url: origin + '/' + query })
        await waitFor(() => evaluate(`location.search === ${JSON.stringify(query)} && !!document.querySelector('.gauge-toggle')`),
          'home progress')
        await evaluate(`
          globalThis.gauge = () => document.querySelector('.gauge-toggle');
          globalThis.monthly = () => document.querySelector('.monthly-progress');
          globalThis.monthButton = label => [...monthly().querySelectorAll('button')].find(item =>
            (item.getAttribute('aria-label') ?? item.textContent.trim()) === label);
        `)
      }
      async function saveGoal(value) {
        await evaluate("monthButton('月間目標を設定').click()")
        await waitFor(() => evaluate("!!monthly().querySelector('input')"), 'monthly goal editor')
        assert.equal(await evaluate("document.activeElement === monthly().querySelector('input')"), true)
        await evaluate("monthly().querySelector('input').select()")
        await command('Input.insertText', { text: value })
        await evaluate("monthButton('月間目標を保存').click()")
        await waitFor(() => evaluate("!!monthButton('月間目標を設定')"), 'monthly goal saved')
      }
      await openHome('setup')
      await evaluate(`(async () => {
        const { createStorage } = await import('/src/storage.ts');
        const { monthDates } = await import('/src/dates.ts');
        const { saveMonthlyGoal } = await import('/src/monthlyGoals.ts');
        const { saveRecord } = await import('/src/training.ts');
        const now = new Date();
        const { start, end } = monthDates(now, -1);
        const current = monthDates(now).start;
        for (const date of [start, current]) saveMonthlyGoal(localStorage, date, '');
        await createStorage().update(data => {
          for (const date of [start, start, end]) {
            data = saveRecord(data, { date, menuId: 'swing', kind: '自主練', amount: '1', duration: '', rating: '', note: '' }, undefined, now);
          }
          return data;
        });
      })()`)
      await openHome('initial')
      assert.equal(await evaluate(`innerWidth === ${width} && [gauge(), monthly(), ...monthly().querySelectorAll('button')].every(node => {
        const box = node.getBoundingClientRect();
        return box.left >= 0 && box.right <= innerWidth && box.height >= 44;
      })`), true)
      assert.equal(await evaluate("gauge().textContent.includes('日次達成率') && gauge().textContent.includes('—')"), true)
      const dailyTone = await evaluate("getComputedStyle(gauge().querySelector('.gauge-period')).color")
      assert.equal(await evaluate("!!monthly().querySelector('progress')"), false)
      const center = await evaluate(`(() => {
        gauge().scrollIntoView({ block: 'center' });
        const box = gauge().getBoundingClientRect();
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      })()`)
      await command('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [center] })
      await command('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await waitFor(() => evaluate("gauge().textContent.includes('週間達成率')"), 'weekly gauge')
      const weeklyTone = await evaluate("getComputedStyle(gauge().querySelector('.gauge-period')).color")
      await evaluate('gauge().focus()')
      const space = { key: ' ', code: 'Space', windowsVirtualKeyCode: 32 }
      await command('Input.dispatchKeyEvent', { ...space, type: 'keyDown', text: ' ' })
      await command('Input.dispatchKeyEvent', { ...space, type: 'keyUp' })
      await waitFor(() => evaluate("gauge().getAttribute('aria-label').startsWith('月間達成率')"), 'monthly gauge')
      const monthlyTone = await evaluate("getComputedStyle(gauge().querySelector('.gauge-period')).color")
      assert.equal(new Set([dailyTone, weeklyTone, monthlyTone]).size, 3)
      assert.equal(await evaluate("getComputedStyle(gauge().querySelector('.gauge-bezel')).stroke"), monthlyTone)
      await command('Input.dispatchKeyEvent', { ...space, type: 'keyDown', text: ' ' })
      await command('Input.dispatchKeyEvent', { ...space, type: 'keyUp' })
      await waitFor(() => evaluate("gauge().textContent.includes('日次達成率')"), 'daily gauge')

      await saveGoal('3')
      await evaluate("monthButton('月間進捗の前の月').click()")
      await waitFor(() => evaluate("monthly().querySelector('.monthly-days').textContent.includes('2日')"), 'previous month')
      await saveGoal('1')
      assert.deepEqual(await evaluate(`(() => {
        const meter = monthly().querySelector('progress');
        return [meter.value, meter.max, meter.getAttribute('aria-valuetext')];
      })()`), [1, 1, '練習記録 2日、目標 1日'])
      await openHome('reload')
      assert.equal(await evaluate("monthly().querySelector('progress').max"), 3)
      await evaluate("monthButton('月間進捗の前の月').click()")
      await waitFor(() => evaluate("monthly().querySelector('progress')?.max === 1"), 'previous goal retained')

      await evaluate(`
        globalThis.findButton = text => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === text);
        globalThis.showSaveFilePicker = async () => ({ createWritable: async () => ({
          write: async contents => { globalThis.savedBackup = contents; },
          close: async () => {}
        }) });
        findButton('設定').click();
      `)
      await waitFor(() => evaluate("!!findButton('バックアップ・復元')"), 'backup settings')
      await evaluate("findButton('バックアップ・復元').click()")
      await waitFor(() => evaluate("!!findButton('バックアップを保存')"), 'backup view')
      await evaluate("findButton('バックアップを保存').click()")
      await waitFor(() => evaluate("typeof savedBackup === 'string' && !findButton('バックアップを保存').disabled"), 'backup exported')
      assert.deepEqual(await evaluate('JSON.parse(savedBackup).monthlyGoals.map(goal => goal.days)'), [1, 3])
      await evaluate(`(async () => {
        const { replaceMonthlyGoals, readMonthlyGoals } = await import('/src/monthlyGoals.ts');
        replaceMonthlyGoals(localStorage, []);
        globalThis.readLocalGoals = () => readMonthlyGoals(localStorage);
        const file = new File([savedBackup], 'goals.json', { type: 'application/json' });
        const transfer = new DataTransfer();
        transfer.items.add(file);
        const input = document.querySelector('input[type=file]');
        input.files = transfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      })()`)
      await waitFor(() => evaluate("!!findButton('全データを置き換えて復元')"), 'backup preview')
      await evaluate("findButton('全データを置き換えて復元').click()")
      await waitFor(() => evaluate("document.body.textContent.includes('バックアップから復元しました。')"), 'backup restored')
      assert.deepEqual(await evaluate('readLocalGoals().map(goal => goal.days)'), [1, 3])
    })

    await t.test(`${width}px 分類の編集・追加・計画への反映とバックアップ復元`, async () => {
      async function loadSettings(stage) {
        const query = `?categories=${width}-${stage}`
        await command('Page.navigate', { url: origin + '/' + query })
        await waitFor(() => evaluate(`location.search === ${JSON.stringify(query)} && !!document.querySelector('nav button:not(:disabled)')`), 'settings loaded')
        await evaluate(`
          globalThis.byLabel = text => [...document.querySelectorAll('button')].find(button =>
            (button.getAttribute('aria-label') ?? button.textContent.trim()) === text);
          globalThis.groupNames = () => [...document.querySelectorAll('details[data-menu-category]')].map(group => group.dataset.menuCategory);
          byLabel('設定').click();
        `)
        await waitFor(() => evaluate('!!document.querySelector(".category-management")'), 'category settings')
      }
      async function click(label) {
        await evaluate(`byLabel(${JSON.stringify(label)}).click()`)
      }
      async function type(selector, value) {
        const query = JSON.stringify(selector)
        await waitFor(() => evaluate(`!!document.querySelector(${query})`), 'category input')
        await evaluate(`document.querySelector(${query}).focus(); document.querySelector(${query}).select()`)
        await command('Input.insertText', { text: value })
      }
      await loadSettings('initial')
      try {
        await evaluate("document.querySelector('.category-management').open = true")
        await click('打撃の名称を変更')
        await type('.category-management li input', '打つ練習')
        await click('分類名を保存')
        await waitFor(() => evaluate("groupNames()[0] === '打つ練習'"), 'category renamed')
        await evaluate("byLabel('打つ練習を下へ移動').focus()")
        const space = { key: ' ', code: 'Space', windowsVirtualKeyCode: 32 }
        await command('Input.dispatchKeyEvent', { ...space, type: 'keyDown', text: ' ' })
        await command('Input.dispatchKeyEvent', { ...space, type: 'keyUp' })
        await waitFor(() => evaluate("groupNames()[0] === '守備'"), 'category reordered')
        await type('.category-management > form input', '連携')
        await click('分類を追加')
        await waitFor(() => evaluate("groupNames().at(-1) === '連携'"), 'category added')
        assert.equal(await evaluate(`[...document.querySelectorAll('.category-management button')].every(node => {
          const box = node.getBoundingClientRect();
          return box.left >= 0 && box.right <= innerWidth && box.height >= 44;
        })`), true)
        await evaluate(`document.querySelector('[data-menu-category="連携"]').open = true`)
        await click('連携にメニュー追加')
        await type('[data-menu-category="連携"] form input', '連携メニュー' + width)
        await click('メニューを保存')
        await waitFor(() => evaluate(`!!byLabel('連携メニュー${width}を編集')`), 'menu saved in category')
        await loadSettings('reload')
        assert.deepEqual(await evaluate('groupNames()'), ['守備', '打つ練習', '走塁', '体づくり', 'その他', '連携'])
        await click('練習計画の管理')
        await waitFor(() => evaluate("!!byLabel('計画を作る')"), 'plan management')
        await click('計画を作る')
        await waitFor(() => evaluate("!!byLabel('種目を追加')"), 'plan editor')
        await click('種目を追加')
        assert.equal(await evaluate("!document.querySelector('.import-draft-item').open"), true)
        assert.equal(await evaluate("!!(byLabel('計画を保存').compareDocumentPosition(document.querySelector('.import-draft-item')) & Node.DOCUMENT_POSITION_FOLLOWING)"), true)
        await evaluate("document.querySelector('.import-draft-item summary').click()")
        await waitFor(() => evaluate('groupNames().length === 6'), 'plan categories')
        assert.deepEqual(await evaluate('groupNames()'), ['守備', '打つ練習', '走塁', '体づくり', 'その他', '連携'])
        assert.equal(await evaluate(`document.querySelector('[data-menu-category="連携"]').textContent.includes('連携メニュー${width}')`), true)
        await type('.import-draft-item textarea', '下書き' + width)
        await click('種目を追加')
        await waitFor(() => evaluate("document.querySelectorAll('.import-draft-item').length === 2"), 'second plan item')
        await evaluate("document.querySelector('.import-draft-item summary').click()")
        assert.equal(await evaluate("[...document.querySelectorAll('.import-draft-item')].every(item => !item.open)"), true)
        await evaluate("document.querySelectorAll('.import-draft-item summary')[1].click(); document.querySelector('.import-draft-item summary').click()")
        assert.equal(await evaluate("document.querySelector('.import-draft-item textarea').value"), '下書き' + width)

        await loadSettings('backup')
        await evaluate(`
          globalThis.showSaveFilePicker = async () => ({ createWritable: async () => ({
            write: async contents => { globalThis.savedCategoriesBackup = contents; },
            close: async () => {}
          }) });
        `)
        await click('バックアップ・復元')
        await waitFor(() => evaluate("!!byLabel('バックアップを保存')"), 'backup view')
        await click('バックアップを保存')
        await waitFor(() => evaluate("typeof savedCategoriesBackup === 'string' && !byLabel('バックアップを保存').disabled"), 'categories exported')
        assert.equal(await evaluate('JSON.parse(savedCategoriesBackup).menuCategories.assignments.length'), 1)
        await evaluate(`(() => {
          localStorage.removeItem('aoba-training-log:menu-categories');
          const input = document.querySelector('input[type=file]');
          const transfer = new DataTransfer();
          transfer.items.add(new File([savedCategoriesBackup], 'categories.json', { type: 'application/json' }));
          input.files = transfer.files;
          input.dispatchEvent(new Event('change', { bubbles: true }));
        })()`)
        await waitFor(() => evaluate("!!byLabel('全データを置き換えて復元')"), 'categories preview')
        await click('全データを置き換えて復元')
        await waitFor(() => evaluate("document.body.textContent.includes('バックアップから復元しました。')"), 'categories restored')
        await loadSettings('restored')
        assert.deepEqual(await evaluate('groupNames()'), ['守備', '打つ練習', '走塁', '体づくり', 'その他', '連携'])
      } finally {
        await evaluate("localStorage.removeItem('aoba-training-log:menu-categories')")
      }
    })

    await t.test(`${width}px 試合の投球・打席・走塁・守備を入力し、編集・削除後に再集計する`, async () => {
      const label = '統合テスト ' + width
      await evaluate(`(async () => {
        const { createStorage } = await import('/src/storage.ts');
        const { localDate } = await import('/src/dates.ts');
        const { saveMatch } = await import('/src/matches.ts');
        const { createLocalMatchStorage } = await import('/src/localMatchStorage.ts');
        await createLocalMatchStorage('guest', createStorage()).update(data => {
          const row = {
          date: localDate(new Date()), kind: '試合', menuId: '', amount: '', duration: '', note: '', rating: '',
          good: '', improve: '', opponent: ${JSON.stringify(label)}
          };
          return saveMatch(saveMatch(data, row), { ...row, opponent: row.opponent + ' 別試合' });
        });
      })()`)
      const query = '?match-integration=' + width
      await command('Page.navigate', { url: origin + '/' + query })
      await waitFor(() => evaluate(`location.search === ${JSON.stringify(query)} && !!document.querySelector('nav button:not(:disabled)')`), 'match app')
      await evaluate(`
        globalThis.matchButton = name => [...document.querySelectorAll('button')].find(button =>
          !button.disabled && ((button.getAttribute('aria-label') || '').endsWith(name) || button.textContent.trim() === name));
        globalThis.matchField = name => [...document.querySelectorAll('label')].find(label =>
          label.firstChild?.textContent.trim() === name)?.querySelector('input, select');
        matchButton('記録').click();
      `)
      async function click(name) {
        const selector = `matchButton(${JSON.stringify(name)})`
        await waitFor(() => evaluate(`!!${selector}`), name)
        await evaluate(`${selector}.click()`)
      }
      async function select(name, value) {
        const selector = `matchField(${JSON.stringify(name)})`
        await waitFor(() => evaluate(`!!${selector}`), name)
        await evaluate(`(() => { const field = ${selector}; field.value = ${JSON.stringify(value)};
          field.dispatchEvent(new Event('change', { bubbles: true })); })()`)
      }
      async function discipline(name, opponent = label) {
        const selector = `[...document.querySelectorAll('.match-history-entry')].find(row =>
          row.querySelector('.entry-title')?.textContent.split(' · ').includes('対 ' + ${JSON.stringify(opponent)}))`
        await waitFor(() => evaluate(`!!${selector}?.querySelector('button[aria-label$="${name}"]')`), name)
        await evaluate(`${selector}.querySelector('button[aria-label$="${name}"]').click()`)
      }
      await discipline('打撃を記録する')
      await click('打席を追加')
      await evaluate(`globalThis.chooseOutside = () => {
        const grid = document.querySelector('button.strike-grid')
        const box = grid.querySelector('.strike-guides').getBoundingClientRect()
        grid.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, clientX: box.left + 18, clientY: box.top + 18 }))
      }`)
      await evaluate('chooseOutside()')
      await click('● ストレート')
      await click('ボール')
      await evaluate('chooseOutside()')
      await click('● ストレート')
      assert.equal(await evaluate(`(() => {
        const box = document.querySelector('.strike-grid').getBoundingClientRect();
        return innerWidth === ${width} && box.left >= 0 && box.right <= innerWidth && box.height >= 44;
      })()`), true)
      await click('打球')
      await waitFor(() => evaluate("document.body.textContent.includes('選択中の投球を打球として記録します')"), 'contact result panel')
      await capture('contact-result', width)
      await select('打席結果', 'single')
      await click('球場図で打球位置を指定')
      await evaluate("document.querySelector('textarea').focus()")
      await command('Input.insertText', { text: '合成コメント' })
      await click('打席を確定')
      await click('第1打席を編集')
      await click('② 打席内容')
      await select('打席結果', 'double')
      await click('打席を確定')
      await click('打席を追加')
      await click('② 打席内容')
      await select('打席結果', 'walk')
      await click('打席を確定')
      await click('練習履歴へ戻る')
      await discipline('打席を振り返る', label + ' 別試合')
      await waitFor(() => evaluate("document.body.textContent.includes('打席はまだありません。')"), 'separate same-day game')
      await click('練習履歴へ戻る')
      await discipline('打席を振り返る')
      await waitFor(() => evaluate("document.body.textContent.includes('打席結果 二塁打')"), 'review shows saved result')
      assert.equal(await evaluate("!!document.querySelector('div.strike-grid [data-pitch-order]') && !document.querySelector('button.strike-grid')"), true)
      assert.equal(await evaluate("document.querySelector('div.strike-grid .zone-anchors line') !== null"), true)
      await click('打球記録')
      assert.equal(await evaluate("!!document.querySelector('div.ball-field svg circle') && !document.querySelector('button.ball-field')"), true)
      assert.equal(await evaluate("document.body.textContent.includes('合成コメント')"), true)
      const firstPlate = await evaluate("matchField('打席を選ぶ').options[0].value")
      const nextPlate = await evaluate("matchField('打席を選ぶ').options[1].value")
      await select('打席を選ぶ', nextPlate)
      assert.equal(await evaluate("document.body.textContent.includes('打席結果 四球') && document.body.textContent.includes('打球記録なし') && !document.body.textContent.includes('合成コメント')"), true)
      await select('打席を選ぶ', firstPlate)
      await click('第1打席を編集')
      await click('② 打席内容')
      await select('打席結果', 'reachedOnError')
      await click('打席を確定')
      await waitFor(() => evaluate("document.body.textContent.includes('打席結果 失策出塁') && !!document.querySelector('div.ball-field')"), 'save returns to review')
      await capture('plate-review', width)
      await click('第1打席を編集')
      await click('② 打席内容')
      await select('打席結果', 'double')
      await click('打席を確定')
      await click('練習履歴へ戻る')
      await discipline('走塁を記録する')
      await click('走塁プレーを追加')
      await click('二盗成功')
      await click('走塁を確定')
      await click('第1プレーを編集')
      await click('二盗死')
      await click('走塁を確定')
      await click('練習履歴へ戻る')
      await discipline('走塁の成績を見る')
      await waitFor(() => evaluate("document.querySelector('.running-fielding-stats')?.textContent.includes('0%')"), 'steal rate after edit')
      await click('練習履歴へ戻る')
      await discipline('走塁を記録する')
      await click('第1プレーを削除')
      await click('走塁プレーを削除する')
      await waitFor(() => evaluate("document.body.textContent.includes('走塁プレーはまだありません。')"), 'running play deleted')
      await click('練習履歴へ戻る')
      await discipline('守備を記録する')
      await click('守備プレーを追加')
      await waitFor(() => evaluate("!!matchField('イニング')"), 'inning input')
      await evaluate("matchField('イニング').focus()")
      await command('Input.insertText', { text: '2' })
      await select('守備位置', 'C')
      await select('プレー種類', 'fly')
      await select('捕球結果', 'success')
      await select('アウト・セーフ', 'out')
      assert.equal(await evaluate("document.body.textContent.includes('候補：PO（刺殺）') && matchButton('公式記録未入力').getAttribute('aria-pressed') === 'true'"), true)
      await evaluate("matchButton('PO（刺殺）').scrollIntoView({block:'center'})")
      await capture('fielding-suggestion', width)
      await select('プレー種類', 'noBall')
      await click('PO（刺殺）')
      await click('守備プレーを確定')
      await waitFor(() => evaluate("document.body.textContent.includes('2イニング目 · 捕手 · 打球なし')"), 'fielding play saved')
      const details = await evaluate(`(async () => {
        const { createStorage } = await import('/src/storage.ts');
        const { createLocalMatchStorage } = await import('/src/localMatchStorage.ts');
        const match = (await createLocalMatchStorage('guest', createStorage()).read()).matches.find(row => row.details?.opponent === ${JSON.stringify(label)});
        return match.details;
      })()`)
      assert.equal(details.plateAppearances[0].result, 'double')
      assert.equal(details.plateAppearances[0].pitches[0].result, 'ball')
      assert.equal(details.plateAppearances[0].pitches[1].result, 'hit')
      assert.deepEqual(details.plateAppearances[0].pitches[0].location, details.plateAppearances[0].pitches[1].location)
      assert.ok(details.plateAppearances[0].pitches[0].location.x < 0.2)
      assert.equal(details.baserunning.length, 0)
      assert.deepEqual(details.fielding[0].credits, ['putout'])
      await click('練習履歴へ戻る')
      await click('通算打撃成績')
      const hit = '.batting-stat-career .batting-stat-hits button'
      await waitFor(() => evaluate(`!!document.querySelector('${hit}')`), 'career spray chart')
      await evaluate(`document.querySelector('${hit}').focus()`)
      const space = { key: ' ', code: 'Space', windowsVirtualKeyCode: 32 }
      await command('Input.dispatchKeyEvent', { ...space, type: 'keyDown', text: ' ' })
      await command('Input.dispatchKeyEvent', { ...space, type: 'keyUp' })
      await waitFor(() => evaluate(`document.querySelector('${hit}').getAttribute('aria-pressed') === 'true'`), 'keyboard selection')
      assert.deepEqual(await evaluate(`(() => {
        const button = document.querySelector('${hit}');
        const boxes = [button, document.querySelector('.batting-stat-career svg')].map(el => el.getBoundingClientRect());
        return { result: button.textContent.includes('二塁打'), fits: boxes.every(box => box.left >= 0 && box.right <= ${width}),
          touchTarget: boxes[0].height >= 44 };
      })()`), { result: true, fits: true, touchTarget: true })
      await click('練習履歴へ戻る')
    })
  }

  await t.test('別のChromeプロファイルへ現行JSONを復元する', async migration => {
    await evaluate(`(async () => {
      const { createStorage } = await import('/src/storage.ts');
      const { createLocalMatchStorage } = await import('/src/localMatchStorage.ts');
      const { localDate, monthDates } = await import('/src/dates.ts');
      const { saveRoutine } = await import('/src/routines.ts');
      const { assignMenuCategory, defaultCategorySettings, saveCategory, writeCategorySettings } = await import('/src/menuCategories.ts');
      const { saveMonthlyGoal } = await import('/src/monthlyGoals.ts');
      const now = new Date();
      const { data } = await createLocalMatchStorage('guest', createStorage()).update(current => saveRoutine(current, {
        id: 'migration-plan', startsOn: localDate(now), items: [{
          id: 'migration-item', menuId: 'swing', name: '素振り', schedule: 'daily', weekdays: [],
          note: '', condition: '', mode: 'quantity', recordUnit: '回', target: { amount: 10, unit: '回' }
        }]
      }, now));
      const settings = saveCategory(defaultCategorySettings(), '移行テスト分類');
      writeCategorySettings(localStorage, assignMenuCategory(settings, data.menus.find(menu => menu.id === 'swing'), settings.categories.at(-1).id));
      saveMonthlyGoal(localStorage, monthDates(now).start, '12');
      globalThis.migrationButton = label => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === label);
      globalThis.showSaveFilePicker = async () => ({ createWritable: async () => ({
        write: async contents => { globalThis.migrationBackup = contents; }, close: async () => {}
      }) });
      migrationButton('設定').click();
    })()`)
    await waitFor(() => evaluate("!!migrationButton('バックアップ・復元')"), 'migration source settings')
    await evaluate("migrationButton('バックアップ・復元').click()")
    await waitFor(() => evaluate("!!migrationButton('バックアップを保存')"), 'migration source export')
    await evaluate("migrationButton('バックアップを保存').click()")
    await waitFor(() => evaluate("typeof migrationBackup === 'string' && !migrationButton('バックアップを保存').disabled"), 'source JSON exported')
    const file = await evaluate('migrationBackup')
    const source = JSON.parse(file)
    assert.equal(source.backupVersion, 4)
    assert.ok(source.data.records.length && source.data.routineVersions.length && source.data.matches.some(row => row.details?.fielding.length))
    assert.ok(source.menuCategories.assignments.length && source.monthlyGoals.length)

    const target = await openChrome(migration)
    await target.command('Page.navigate', { url: origin + '/?migration=target' })
    await waitFor(() => target.evaluate("!!document.querySelector('nav button:not(:disabled)')"), 'fresh recipient')
    const empty = await target.evaluate(`(async () => {
      const { createStorage } = await import('/src/storage.ts');
      const { createLocalMatchStorage } = await import('/src/localMatchStorage.ts');
      const { readCategorySettings } = await import('/src/menuCategories.ts');
      const { readMonthlyGoals } = await import('/src/monthlyGoals.ts');
      globalThis.migrationButton = label => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === label);
      globalThis.migrationState = async () => ({
        data: await createLocalMatchStorage('guest', createStorage()).read(), menuCategories: readCategorySettings(localStorage), monthlyGoals: readMonthlyGoals(localStorage)
      });
      const { data, menuCategories, monthlyGoals } = await migrationState();
      migrationButton('設定').click();
      return [data.records.length, data.matches?.length ?? 0, menuCategories.assignments.length, monthlyGoals.length];
    })()`)
    assert.deepEqual(empty, [0, 0, 0, 0])
    await waitFor(() => target.evaluate("!!migrationButton('バックアップ・復元')"), 'migration recipient settings')
    await target.evaluate("migrationButton('バックアップ・復元').click()")
    await waitFor(() => target.evaluate("!!document.querySelector('input[type=file]')"), 'migration recipient input')
    await target.evaluate(`(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([${JSON.stringify(file)}], 'migration.json', { type: 'application/json' }));
      const input = document.querySelector('input[type=file]');
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`)
    await waitFor(() => target.evaluate("!!migrationButton('全データを置き換えて復元')"), 'migration preview')
    await target.evaluate("migrationButton('全データを置き換えて復元').click()")
    await waitFor(() => target.evaluate("document.body.textContent.includes('バックアップから復元しました。')"), 'migration complete')
    assert.deepEqual(await target.evaluate('migrationState()'),
      { data: source.data, menuCategories: source.menuCategories, monthlyGoals: source.monthlyGoals })
  })
})

test('旧座標と試合の関連付け案内を個別振り返りで確認する', { timeout: 60_000 }, async t => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' })
  t.after(() => server.close())
  await server.listen()
  const origin = 'http://127.0.0.1:' + server.httpServer.address().port
  const { command, evaluate } = await openChrome(t)
  await command('Emulation.setDeviceMetricsOverride', { width: 375, height: 800, deviceScaleFactor: 1, mobile: true })
  await command('Page.navigate', { url: origin + '/' })
  await waitFor(() => evaluate("!!document.querySelector('nav button:not(:disabled)')"), 'app ready')
  const before = await evaluate(`(async () => {
    const { createStorage } = await import('/src/storage.ts');
    const { createLocalMatchStorage } = await import('/src/localMatchStorage.ts');
    const { battedBallDistribution } = await import('/src/battedBallDistribution.ts');
    const base = createStorage();
    const local = createLocalMatchStorage('guest', base);
    const time = '2026-11-20T00:00:00.000Z';
    const game = { date: '2026-11-20', createdAt: time, updatedAt: time, good: '', improve: '' };
    const location = { x: 0.3, y: 0.4 };
    const results = ['single', 'walk', 'strikeoutSwinging', 'otherOut', undefined, 'hitByPitch', 'droppedThirdStrike', 'strikeoutLooking'];
    const plateAppearances = results.map((result, index) => ({
      id: 'plate-' + index, order: index + 1, result, status: result ? 'complete' : 'draft', fieldPoint: location,
      ...(index === 1 && { pitches: [{ id: 'pitch-1', order: 1, type: { id: 'fastball', name: 'ストレート' },
        result: 'ball', location: { zone: 'inside', row: 0, column: 0 } }] })
    }));
    const details = { version: 1, source: { batting: 'events', fielding: 'events', baserunning: 'events' },
      plateAppearances, baserunning: [], positionChanges: [], fielding: [] };
    await local.update(data => ({ ...data, matches: [
      { ...game, id: 'standalone', details: { ...details, opponent: '合成単独' } },
      { ...game, id: 'same-day', details: { ...details, opponent: '合成別試合', plateAppearances: [] } }
    ] }));
    await base.update(data => ({ ...data, matches: [
      ...(data.matches ?? []), { ...game, id: 'orphan', recordId: 'missing-record', good: '合成孤立記録' }
    ] }));
    globalThis.readReviewFixture = async () => {
      const matches = (await local.read()).matches;
      return { matches, distribution: battedBallDistribution(matches) };
    };
    return readReviewFixture();
  })()`)
  assert.equal(before.distribution.hits.length, 1)
  assert.equal(before.distribution.missingPositions, 0)
  // Re-enter Records to read the newly seeded data through the normal UI.
  await command('Page.reload')
  await waitFor(() => evaluate("!!document.querySelector('nav button:not(:disabled)')"), 'reloaded fixture')
  await evaluate(`
    globalThis.reviewButton = (label, scope = document) => [...scope.querySelectorAll('button')].find(button =>
      button.textContent.trim() === label);
    globalThis.reviewRow = text => [...document.querySelectorAll('.match-history-entry')].find(row => row.textContent.includes(text));
    reviewButton('記録').click();
  `)
  const missingNotice = '関連する練習記録がありません'
  await waitFor(() => evaluate("!!reviewRow('合成孤立記録')"), 'history fixture')
  assert.deepEqual(await evaluate(`['合成単独', '合成別試合', '合成孤立記録'].map(text =>
    reviewRow(text).textContent.includes('${missingNotice}'))`), [false, false, true])
  await evaluate("reviewButton('詳細を入力').click()")
  assert.equal(await evaluate("!!Array.from(document.querySelectorAll('option')).find(option => option.textContent === '選んでください')"), true)
  await evaluate(`(() => {
    const field = [...document.querySelectorAll('label')].find(label => label.firstChild?.textContent === '練習の種類').querySelector('select');
    field.value = '試合'; field.dispatchEvent(new Event('change', { bubbles: true }));
  })()`)
  await waitFor(() => evaluate("[...document.querySelectorAll('option')].some(option => option.textContent === '練習メニューを選ばずに記録' && option.value === '')"), 'optional match menu')
  await evaluate("reviewButton('キャンセル').click()")
  await waitFor(() => evaluate("!!reviewButton('打席を振り返る', reviewRow('合成別試合'))"), 'history after cancel')
  await evaluate("reviewButton('打席を振り返る', reviewRow('合成別試合')).click()")
  await waitFor(() => evaluate("document.body.textContent.includes('打席はまだありません。')"), 'same-day different game')
  await evaluate("reviewButton('練習履歴へ戻る').click()")
  await waitFor(() => evaluate("!!reviewRow('合成単独')"), 'history after review')
  await evaluate("reviewButton('打席を振り返る', reviewRow('合成単独')).click()")
  await waitFor(() => evaluate("!!reviewButton('打球記録')"), 'selected game')
  await evaluate("reviewButton('打球記録').click()")
  for (const [index, marker] of [true, false, false, true, true, false, false, false].entries()) {
    await evaluate(`(() => {
      const field = document.querySelector('select');
      field.value = 'plate-${index}'; field.dispatchEvent(new Event('change', { bubbles: true }));
    })()`)
    await waitFor(() => evaluate(`document.querySelector('select').value === 'plate-${index}' &&
      (!!document.querySelector('.ball-field svg g > circle')) === ${marker} &&
      document.querySelector('.batting-diagram [role=status]').textContent.includes('${marker ? '記録位置' : '打球記録なし'}')`), 'review marker for plate ' + index)
  }
  await evaluate(`(() => { const field = document.querySelector('select'); field.value = 'plate-1';
    field.dispatchEvent(new Event('change', { bubbles: true })); reviewButton('投球コース').click(); })()`)
  await waitFor(() => evaluate("!!document.querySelector('.strike-grid [data-pitch-order]')"), 'walk pitch remains visible')
  const after = await evaluate(`(async () => {
    const { createStorage } = await import('/src/storage.ts');
    const { createLocalMatchStorage } = await import('/src/localMatchStorage.ts');
    const { battedBallDistribution } = await import('/src/battedBallDistribution.ts');
    const matches = (await createLocalMatchStorage('guest', createStorage()).read()).matches;
    return { matches, distribution: battedBallDistribution(matches) };
  })()`)
  assert.deepEqual(after, before)
})

test('試合専用DBの物理版とバックアップの互換性を4つのビルドで確認する',
  { skip: !process.env.AOBA_COMPAT_BUILDS, timeout: 95_000 }, async t => {
    const root = process.env.AOBA_COMPAT_BUILDS
    const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
      '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' }
    const server = createHttpServer(async (request, response) => {
      const [, variant, asset = ''] = /^\/(public|split|new|rollback)\/([a-zA-Z0-9_.\/-]*)$/.exec(request.url ?? '') ?? []
      if (!variant || asset.split('/').some(part => part === '..')) { response.writeHead(404).end(); return }
      const file = asset || 'index.html'
      try {
        const body = await readFile(join(root, variant, file))
        response.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream' }).end(body)
      } catch { response.writeHead(404).end() }
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    t.after(() => new Promise(resolve => server.close(resolve)))
    const origin = 'http://127.0.0.1:' + server.address().port
    const { command, evaluate } = await openChrome(t)
    async function navigate(variant) {
      await command('Page.navigate', { url: origin + '/' + variant + '/' })
      await waitFor(() => evaluate(`location.pathname === '/${variant}/' && !!document.querySelector('main')`), variant)
      await evaluate(`globalThis.btn = label => [...document.querySelectorAll('button')].find(b =>
        b.textContent.trim() === label || (b.getAttribute('aria-label') ?? '').endsWith(label));
        window.showSaveFilePicker = async () => ({createWritable: async () => ({
          write: async contents => { window.saved = contents }, close: async () => {}
        })});
        globalThis.openDb = version => new Promise((resolve, reject) => {
          const request = indexedDB.open('aoba-training-log-local-matches', version);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });`)
    }
    async function click(label) {
      const button = `btn(${JSON.stringify(label)})`
      await waitFor(() => evaluate(`!!${button} && !${button}.disabled`), label)
      await evaluate(`${button}.click()`)
    }
    async function dataManagement() {
      await click('設定')
      await click('バックアップ・復元')
    }
    async function select(label, value) {
      await evaluate(`(() => {
        const field = [...document.querySelectorAll('label')].find(element =>
          element.firstChild?.textContent.trim() === ${JSON.stringify(label)}).querySelector('select');
        field.value = ${JSON.stringify(value)}; field.dispatchEvent(new Event('change', { bubbles: true }));
      })()`)
    }
    async function importFile(json, selector = 'input[type=file]') {
      await evaluate(`(() => {
        const transfer = new DataTransfer();
        transfer.items.add(new File([${JSON.stringify(json)}], 'synthetic.json', { type: 'application/json' }));
        const input = document.querySelector(${JSON.stringify(selector)});
        input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
      })()`)
    }
    async function exportFile() {
      await evaluate('window.saved = undefined')
      await click('バックアップを保存')
      await waitFor(() => evaluate('!!window.saved'), 'backup file written')
      return JSON.parse(await evaluate('window.saved'))
    }
    await navigate('public')
    await dataManagement()
    const base = await exportFile()
    assert.equal(base.backupVersion, 1)
    base.data.rests.push({ date: '2026-11-20', createdAt: '2026-11-20T00:00:00.000Z' })
    await importFile(JSON.stringify(base))
    await click('全データを置き換えて復元')
    await waitFor(() => evaluate("document.body.textContent.includes('バックアップから復元しました。')"), 'public base save')

    await navigate('split')
    await dataManagement()
    const old = await exportFile()
    assert.equal(await evaluate('(async () => { const db = await openDb(1); const version = db.version; db.close(); return version })()'), 1)
    const now = '2026-11-20T00:00:00.000Z'
    old.backupVersion = 2
    old.data.matches = [{ id: 'test-game', date: '2026-11-20', good: '', improve: '', createdAt: now, updatedAt: now,
      details: { version: 1, opponent: '合成クラブ', source: { batting: 'events', baserunning: 'events', fielding: 'events' },
        plateAppearances: [{ id: 'test-plate', order: 1, status: 'complete', result: 'droppedThirdStrike' }],
        baserunning: [], positionChanges: [], fielding: [] } }]
    await importFile(JSON.stringify(old))
    await click('全データを置き換えて復元')
    await waitFor(() => evaluate("document.body.textContent.includes('バックアップから復元しました。')"), 'split details save')

    // The new application starts in an iframe while the parent holds version 1.
    await evaluate(`(() => { const frame = document.createElement('iframe'); frame.name = 'aoba-upgrade-holder'; document.body.append(frame); })()`)
    // A top-level navigation would close the iframe, so navigate the new app in it.
    await evaluate(`(async () => { window.oldConnection = await openDb(1); document.querySelector('iframe').src = '${origin}/new/'; })()`)
    await waitFor(() => evaluate(`document.querySelector('iframe').contentDocument?.body?.textContent.includes('ほかのタブが試合データを使用しています')`), 'blocked upgrade notice')
    await evaluate('oldConnection.close()')
    await waitFor(() => evaluate(`!!document.querySelector('iframe').contentDocument?.querySelector('nav button:not(:disabled)')`), 'upgrade completed')
    assert.equal(await evaluate('(async () => { try { (await openDb(1)).close(); return "opened" } catch (error) { return error.name } })()'), 'VersionError')
    await navigate('new')
    await click('記録')
    await click('打撃を記録する')
    await click('第1打席を編集')
    await click('② 打席内容')
    await select('振り逃げの内訳', 'swinging')
    await click('打席を確定')
    await click('第1打席を編集')
    await click('② 打席内容')
    await select('振り逃げの内訳', 'looking')
    await click('打席を確定')
    await dataManagement()
    const current = await exportFile()
    assert.equal(current.backupVersion, 5)
    assert.equal(current.data.matches[0].details.plateAppearances[0].droppedThirdStrikeKind, 'looking')
    assert.deepEqual(current.data.rests, base.data.rests)
    await importFile(JSON.stringify(old))
    await waitFor(() => evaluate("document.body.textContent.includes('振り逃げの内訳 1件')"), 'legacy replacement preview')
    assert.equal(await evaluate("document.querySelector('.restore-preview input[type=checkbox]').disabled"), true)
    await exportFile()
    await evaluate("document.querySelector('.restore-preview input[type=checkbox]').click()")
    await click('全データを置き換えて復元')
    await waitFor(() => evaluate("document.body.textContent.includes('古い形式で上書きできません')"), 'legacy replacement refused')

    const sameVersion = structuredClone(current)
    sameVersion.data.matches[0].details.plateAppearances[0].droppedThirdStrikeKind = 'swinging'
    await importFile(JSON.stringify(sameVersion))
    await waitFor(() => evaluate("document.body.textContent.includes('振り逃げの内訳 1件')"), 'v5 replacement preview')
    assert.equal(await evaluate("btn('全データを置き換えて復元').disabled"), true)
    const savedBeforeRestart = await exportFile()
    await navigate('new')
    await dataManagement()
    assert.equal(await evaluate("!!document.querySelector('.restore-preview')"), false)
    await importFile(JSON.stringify(sameVersion))
    const savedInput = '.restore-preview input[type=file]'
    await waitFor(() => evaluate(`!!document.querySelector(${JSON.stringify(savedInput)})`), 'reselected v5 target')
    await importFile(JSON.stringify(sameVersion), savedInput)
    await waitFor(() => evaluate("document.body.textContent.includes('現在の復元先のデータと一致しません')"), 'replacement cannot stand in for saved data')
    assert.equal(await evaluate("document.querySelector('.restore-preview input[type=checkbox]').disabled"), true)
    await importFile(JSON.stringify(savedBeforeRestart), savedInput)
    await waitFor(() => evaluate("!document.querySelector('.restore-preview input[type=checkbox]').disabled"), 'saved backup verified after restart')
    assert.equal(await evaluate("btn('全データを置き換えて復元').disabled"), true)
    await evaluate("document.querySelector('.restore-preview input[type=checkbox]').click()")
    await click('全データを置き換えて復元')
    await waitFor(() => evaluate("document.body.textContent.includes('バックアップから復元しました。')"), 'file and consent permit v5 replacement')
    assert.equal((await exportFile()).data.matches[0].details.plateAppearances[0].droppedThirdStrikeKind, 'swinging')

    await navigate('split')
    await waitFor(() => evaluate("document.body.textContent.includes('データを読み込めませんでした')"), 'actual legacy split build fails closed')
    await navigate('public')
    await dataManagement()
    await importFile(JSON.stringify(current))
    await waitFor(() => evaluate("document.body.textContent.includes('対応していません')"), 'actual public build rejects v5')
    base.data.rests.push({ date: '2026-11-21', createdAt: '2026-11-21T00:00:00.000Z' })
    await importFile(JSON.stringify(base))
    await click('全データを置き換えて復元')
    await waitFor(() => evaluate("document.body.textContent.includes('バックアップから復元しました。')"), 'public version can write base only')

    await navigate('rollback')
    await click('記録')
    await click('打撃を記録する')
    assert.equal(await evaluate("btn('第1打席を削除').disabled"), true)
    await click('第1打席を編集')
    await waitFor(() => evaluate("document.body.textContent.includes('読み取り専用で扱います')"), 'rollback classified plate guard')
    await dataManagement()
    await importFile(JSON.stringify(base))
    await click('試合詳細を保持して復元')
    await waitFor(() => evaluate("document.body.textContent.includes('バックアップから復元しました。')"), 'rollback v1 import keeps local detail')
    const after = await exportFile()
    assert.equal(after.backupVersion, 5)
    assert.deepEqual(after.data.matches, sameVersion.data.matches)
    assert.deepEqual(after.data.rests, base.data.rests)
  })
