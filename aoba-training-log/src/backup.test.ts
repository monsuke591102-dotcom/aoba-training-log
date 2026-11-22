import 'fake-indexeddb/auto'
import { expect, test, vi } from 'vitest'
import { savePlan, saveReflection, saveSkippedMenu, setRest } from './activities'
import { compareBackupCounts, decodeBackup, encodeBackup, restoreBackup, restoreChange } from './backup'
import { initialData } from './initialData'
import { defaultCategorySettings, readCategorySettings, saveCategory } from './menuCategories'
import { readMonthlyGoals, saveMonthlyGoal, type MonthlyGoal } from './monthlyGoals'
import { managementProgress } from './progress'
import { createStorage } from './storage'
import { saveGoals, saveMenu, saveRecord } from './training'

const now = new Date(2026, 10, 18, 13)
const date = '2026-11-18'

function goalStorage() {
  const values = new Map([['aoba-training-log:monthly-goal:2026-11', '12']])
  return {
    get length() { return values.size },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  }
}

const incomingGoals: MonthlyGoal[] = [{ start: '2028-02-01', days: 29 }, { start: '2028-03-01', days: 18 }]

function fixture() {
  let data = initialData()
  data = saveMenu(data, data.menus[0], '50', now, '10')
  data = saveGoals(data, '1', '足を使う', now)
  data = saveGoals(data, '2', '投球フォームを確認', now)
  data = savePlan(data, { date, kind: 'チーム練習', menuIds: ['swing', 'core'] })
  const draft = { date, menuId: 'swing', amount: '20', duration: '5', note: '記録メモ', rating: '4' }
  data = saveRecord(data, { ...draft, kind: '自主練' }, undefined, now)
  data = saveRecord(data, { ...draft, date: '2026-11-17', kind: 'チーム練習' }, undefined, now)
  data = saveRecord(data, { ...draft, date: '2026-11-16', kind: '試合' }, undefined, now)
  data = saveSkippedMenu(data, date, 'core', '天候不良', '屋外が使えなかった', false, now)
  data = setRest(data, '2026-11-15', true, now)
  for (const period of ['day', 'week'] as const) {
    data = saveReflection(data, period, date, { success: '記録できた', challenge: '', next: '計画する' }, now)
  }
  return data
}

test('全データのJSON書き出しと復元で計算結果・見送り・履歴を保持する', async () => {
  const source = fixture()
  const json = encodeBackup(source, now)
  const backup = decodeBackup(json)
  expect(backup).toMatchObject({
    appId: 'aoba-training-log', backupVersion: 1, dataVersion: 3, createdAt: now.toISOString(), data: source,
  })
  expect(backup.data.skippedMenus[0]).toMatchObject({ reason: '天候不良', note: '屋外が使えなかった' })
  const store = createStorage('restore-' + crypto.randomUUID())
  const expected = await store.read()
  await store.update(restoreChange(backup, expected))
  const restored = await store.read()
  expect(restored).toEqual(source)
  expect(managementProgress(restored, now)).toEqual(managementProgress(source, now))
})

test('通常のバックアップは月別目標を別項目に保存し、旧ファイルでは既存目標を保持する', async () => {
  const goals = goalStorage()
  const original = readMonthlyGoals(goals)
  const store = createStorage('restore-goals-' + crypto.randomUUID())
  const restore = async (change: Parameters<typeof store.update>[0]) => { await store.update(change) }
  const source = fixture()
  const legacy = decodeBackup(encodeBackup(source, now))
  await restoreBackup(legacy, await store.read(), original, goals, restore)
  expect(readMonthlyGoals(goals)).toEqual(original)
  const backup = decodeBackup(encodeBackup(source, now, incomingGoals))
  expect(backup).toMatchObject({ backupVersion: 1, monthlyGoals: incomingGoals })
  expect(backup.data).toEqual(source)
  await restoreBackup(backup, await store.read(), original, goals, restore)
  expect(readMonthlyGoals(goals)).toEqual(incomingGoals)
  const noGoals = decodeBackup(encodeBackup(source, now, []))
  await restoreBackup(noGoals, await store.read(), incomingGoals, goals, restore)
  expect(readMonthlyGoals(goals)).toEqual([])
})

test('復元失敗と確認後の月別目標変更で月別目標を保持する', async () => {
  const goals = goalStorage()
  const original = readMonthlyGoals(goals)
  const current = fixture()
  const backup = decodeBackup(encodeBackup(initialData(), now, incomingGoals))
  const restoreFailure = vi.fn(async () => { throw new Error('transaction aborted') })
  await expect(restoreBackup(backup, current, original, goals, restoreFailure)).rejects.toThrow('transaction aborted')
  expect(readMonthlyGoals(goals)).toEqual(original)
  saveMonthlyGoal(goals, '2026-12-01', '15')
  await expect(restoreBackup(backup, current, original, goals, restoreFailure)).rejects.toThrow('月別目標が変更')
  expect(restoreFailure).toHaveBeenCalledTimes(1)
  expect(readMonthlyGoals(goals)).toHaveLength(2)
})

test('練習データの保存が未確定ならブラウザー設定を書き換えない', async () => {
  const storage = goalStorage()
  const previous = readMonthlyGoals(storage)
  const categories = defaultCategorySettings()
  const backup = decodeBackup(encodeBackup(initialData(), now, incomingGoals, saveCategory(categories, '連携')))
  let reject!: (error: Error) => void
  const promise = new Promise<void>((_resolve, fail) => { reject = fail })
  const restore = vi.fn(() => promise)
  const result = restoreBackup(backup, fixture(), previous, storage, restore, categories)
  expect(restore).toHaveBeenCalledOnce()
  expect(readMonthlyGoals(storage)).toEqual(previous)
  expect(readCategorySettings(storage)).toEqual(categories)
  reject(new Error('interrupted before commit'))
  await expect(result).rejects.toThrow('interrupted before commit')
  expect(readMonthlyGoals(storage)).toEqual(previous)
  expect(readCategorySettings(storage)).toEqual(categories)
})

test('確定後のブラウザー設定保存失敗は先に書いた設定を戻し、同じJSONで再試行できる', async () => {
  const storage = goalStorage()
  const previous = readMonthlyGoals(storage)
  const categories = defaultCategorySettings()
  const nextCategories = saveCategory(categories, '連携')
  const snapshot = fixture()
  const backup = decodeBackup(encodeBackup(snapshot, now, incomingGoals, nextCategories))
  const store = createStorage('partial-restore-' + crypto.randomUUID())
  const restore = async (change: Parameters<typeof store.update>[0]) => { await store.update(change) }
  let fail = true
  const browser = { ...storage, setItem(key: string, value: string) {
    if (fail && key.endsWith(':menu-categories')) throw new DOMException('storage full', 'QuotaExceededError')
    storage.setItem(key, value)
  } }
  await expect(restoreBackup(backup, await store.read(), previous, browser, restore, categories))
    .rejects.toThrow('練習データは復元されましたが')
  expect(await store.read()).toEqual(backup.data)
  expect(readMonthlyGoals(browser)).toEqual(previous)
  expect(readCategorySettings(browser)).toEqual(categories)
  fail = false
  await restoreBackup(backup, await store.read(), previous, browser, restore, categories)
  expect(readMonthlyGoals(browser)).toEqual(incomingGoals)
  expect(readCategorySettings(browser)).toEqual(nextCategories)
})

test('月別目標の不正な日付・日数・重複を拒否する', () => {
  const backup = decodeBackup(encodeBackup(initialData(), now))
  for (const monthlyGoals of [
    [{ start: '2028-02-02', days: 2 }], [{ start: '2027-02-01', days: 29 }],
    [{ start: '2028-02-01', days: 0 }], [incomingGoals[0], incomingGoals[0]], null,
  ]) {
    expect(() => decodeBackup(JSON.stringify({ ...backup, monthlyGoals }))).toThrow('月別目標')
  }
})

test.each([
  ['破損JSON', '{broken', 'JSONを読み取れません'],
  ['別アプリ', JSON.stringify({ appId: 'other' }), 'AOBA TRAINING LOG'],
  ['未対応のバックアップ版', JSON.stringify({ appId: 'aoba-training-log', backupVersion: 5, dataVersion: 3 }), '対応していません'],
  ['未対応のデータ版', JSON.stringify({ appId: 'aoba-training-log', backupVersion: 1, dataVersion: 999 }), '対応していません'],
])('%sを拒否する', (_label, content, message) => {
  expect(() => decodeBackup(content)).toThrow(message)
})

test('必須項目・不正な暦日・単位に合わない数量・参照先・重複を検証する', () => {
  const good = decodeBackup(encodeBackup(fixture(), now))
  const attempt = (data: unknown) => decodeBackup(JSON.stringify({ ...good, data }))
  const records = good.data.records
  expect(() => attempt({ ...good.data, skippedMenus: undefined })).toThrow('見送り')
  for (const changes of [{ date: '2026-02-30' }, { menuId: 'unknown' }, { amount: 0.25 }, { createdAt: '2026-11-18' }]) {
    expect(() => attempt({ ...good.data, records: [{ ...records[0], ...changes }] })).toThrow('練習記録')
  }
  expect(() => attempt({ ...good.data, records: [...records, records[0]] })).toThrow('重複')
})

test.each([[0, 0], [1, 0], [0, 1], [1, 2]])('削除済みメニューを項目キーで比較する（現在 %i 件・復元後 %i 件）', (current, restored) => {
  const initial = initialData()
  const deletions = (count: number) => initial.menus.slice(0, count).map(menu => ({ ...menu, deletedOn: '2026-11-19' as const }))
  const rows = compareBackupCounts(
    { ...initial, deletedMenus: deletions(current), routineAdditions: [{ date: '2026-11-19', itemId: 'before' }] },
    { ...initial, deletedMenus: deletions(restored), routineCompletions: [{ date: '2026-11-19', itemId: 'after' }] },
  )
  expect(rows.map(row => row.label)).toEqual([
    '練習記録', '練習予定', '目標・変更履歴', '振り返り', '見送り', '休養日の記録', '練習メニュー', '曜日別計画',
    ...(current || restored ? ['削除済みメニュー（履歴用）'] : []), '条件付き計画の追加', '計画の完了チェック',
  ])
  expect(rows.slice(-2)).toMatchObject([
    { key: 'routineAdditions', current: 1, restored: 0 },
    { key: 'routineCompletions', current: 0, restored: 1 },
  ])
  expect(rows.find(row => row.key === 'deletedMenus')).toEqual(current || restored
    ? { key: 'deletedMenus', label: '削除済みメニュー（履歴用）', current, restored }
    : undefined)
})

test('確認画面の準備とキャンセルに相当する処理では書き換えない', async () => {
  const store = createStorage('cancel-' + crypto.randomUUID())
  const original = await store.update(() => fixture())
  const candidate = decodeBackup(encodeBackup(initialData(), now))
  const pending = restoreChange(candidate, await store.read())
  expect(typeof pending).toBe('function')
  expect(await store.read()).toEqual(original)
})

test('確認後に別の保存が行われた場合は置き換えを中止する', async () => {
  const store = createStorage('conflict-' + crypto.randomUUID())
  const pending = restoreChange(decodeBackup(encodeBackup(initialData(), now)), await store.read())
  const latest = await store.update(() => fixture())
  await expect(store.update(pending)).rejects.toThrow('確認中に現在のデータが変更')
  expect(await store.read()).toEqual(latest)
})

test('復元で書き込み途中のトランザクションが中断しても元のデータを保持する', async () => {
  const store = createStorage('rollback-' + crypto.randomUUID())
  const original = await store.update(() => fixture())
  const candidate = decodeBackup(encodeBackup(initialData(), now))
  const put = IDBObjectStore.prototype.put
  const failure = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
    const request = put.apply(this, args)
    request.addEventListener('success', () => this.transaction.abort())
    return request
  })
  try {
    await expect(store.update(restoreChange(candidate, original))).rejects.toThrow()
  } finally {
    failure.mockRestore()
  }
  expect(await store.read()).toEqual(original)
})
