import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'

// These values take precedence over .env.local in Vite.
process.env.VITE_SUPABASE_URL = 'disabled'
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'disabled'
process.env.VITE_ENABLE_LOCAL_MENU_DELETE = 'false'
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

test('Settings menu focus in Chrome', { timeout: 120_000 }, async t => {
  const profile = await mkdtemp(join(tmpdir(), 'aoba-focus-'))
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' })
  let chrome, socket
  t.after(async () => {
    socket?.close()
    if (chrome?.pid && chrome.exitCode === null && chrome.signalCode === null) {
      const exited = once(chrome, 'exit')
      chrome.kill()
      await exited
    }
    await server.close()
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  })
  await server.listen()
  const origin = 'http://127.0.0.1:' + server.httpServer.address().port
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
      if (error.code !== 'ENOENT') throw error
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
    const result = await command('Runtime.evaluate', { expression, returnByValue: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
    return result.result.value
  }

  await command('Network.enable')
  await command('Network.setBlockedURLs', { urls: ['*://*.supabase.co/*'] })
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
  }
})
