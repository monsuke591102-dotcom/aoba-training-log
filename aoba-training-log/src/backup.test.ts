import 'fake-indexeddb/auto'
import { expect, test, vi } from 'vitest'
import { savePlan, saveReflection, saveSkippedMenu, setRest } from './activities'
import { compareBackupCounts, decodeBackup, encodeBackup, restoreChange } from './backup'
import { initialData } from './initialData'
import { managementProgress } from './progress'
import { createStorage } from './storage'
import { saveGoals, saveMenu, saveRecord } from './training'

const now = new Date(2026, 10, 18, 13)
const date = '2026-11-18'

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

test.each([
  ['破損JSON', '{broken', 'JSONを読み取れません'],
  ['別アプリ', JSON.stringify({ appId: 'other' }), 'AOBA TRAINING LOG'],
  ['未対応のバックアップ版', JSON.stringify({ appId: 'aoba-training-log', backupVersion: 4, dataVersion: 3 }), '対応していません'],
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
