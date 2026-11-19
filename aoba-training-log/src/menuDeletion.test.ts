import 'fake-indexeddb/auto'
import { expect, test } from 'vitest'
import { createAccountStorage } from './accountStorage'
import { savePlan, saveSkippedMenu } from './activities'
import { decodeBackup, encodeBackup, restoreChange, validateData } from './backup'
import { initialData } from './initialData'
import type { TrainingData } from './model'
import { dailyStats } from './progress'
import { dailyRoutine, plannedMenuIds, saveRoutine, setRoutineCompletion } from './routines'
import { syncOnce, type RemoteSnapshot, type SnapshotApi } from './sync'
import { deleteMenu, saveMenu, saveRecord, setMenuEnabled } from './training'

const past = '2026-11-18'
const today = '2026-11-19'
const future = '2026-11-20'
const now = new Date(2026, 10, 19, 12)

function trainingFixture() {
  let data = initialData()
  const swing = data.menus.find(menu => menu.id === 'swing')!
  data = saveMenu(data, swing, '20', now, '20')
  data = saveRoutine(data, { id: 'routine', startsOn: past, items: [
    { id: 'linked', menuId: swing.id, name: swing.name, schedule: 'daily', weekdays: [],
      target: { amount: 20, unit: '回' }, condition: '', note: '' },
    { id: 'independent', name: swing.name, schedule: 'daily', weekdays: [], mode: 'check', condition: '', note: '' },
  ] }, new Date(2026, 10, 18, 12))
  for (const date of [past, today, future] as const) {
    data = savePlan(data, { date, kind: '自主練', menuIds: [swing.id, 'tee'] })
  }
  data = saveRecord(data, { date: past, kind: '自主練', menuId: swing.id, amount: '10', duration: '', note: '', rating: '' }, undefined, now)
  data = setRoutineCompletion(data, past, 'independent', true)
  data = saveSkippedMenu(data, future, swing.id, '予定変更', '', false, now)
  return { data, swing }
}

test('完全削除は登録と当日以降の予定参照だけを取り除き、計画・実績・履歴を保持する', () => {
  const { data, swing } = trainingFixture()
  const deleted = deleteMenu(data, swing, today)
  expect(deleted.menus).toEqual(data.menus.filter(menu => menu.id !== swing.id))
  expect(deleted.deletedMenus).toEqual([{ ...swing, deletedOn: today }])
  expect(deleted.plans).toEqual([data.plans[0], ...data.plans.slice(1).map(plan => ({ ...plan, menuIds: ['tee'] }))])
  for (const key of ['records', 'goals', 'skippedMenus', 'routineVersions', 'routineCompletions'] as const) {
    expect(deleted[key]).toBe(data[key])
  }
  expect(dailyStats(deleted, past, today)).toEqual(dailyStats(data, past, today))
  expect(dailyStats(deleted, today, today).rate).toBeNull()
  expect(plannedMenuIds(deleted, future, today)).toEqual(new Set(['tee']))
  expect(dailyRoutine(deleted, future, today).selected.map(item => item.id)).toEqual(['independent'])
  expect(() => setMenuEnabled(deleted, swing.id, true)).toThrow('見つかりません')
  expect(() => saveMenu(deleted, swing, '', now, undefined, true)).toThrow('使用されています')
  const previous = data.routineVersions![0]
  expect(() => saveRoutine(deleted, { ...previous, id: 'copy', startsOn: future,
    items: [{ ...previous.items[0], mode: 'quantity', recordUnit: swing.unit }] }, now)).toThrow('削除済み')
  expect(() => deleteMenu(setMenuEnabled(data, swing.id, false), swing, today)).toThrow('変更されました')
})

test('削除後のJSONを保存・復元し、旧形式と履歴参照を保持する', () => {
  const { data, swing } = trainingFixture()
  const deleted = deleteMenu(data, swing, today)
  expect(decodeBackup(encodeBackup(data)).data.deletedMenus).toBeUndefined()
  const restored = restoreChange(decodeBackup(encodeBackup(deleted)), data)(data)
  expect(restored).toEqual(JSON.parse(JSON.stringify(deleted)))
  expect(() => validateData({ ...restored, deletedMenus: undefined })).toThrow()
  expect(() => validateData({ ...restored, menus: [...restored.menus, swing] })).toThrow()
})

test('オフラインで削除し、再接続時に反映して、古い端末の変更は競合にする', async () => {
  const { data, swing } = trainingFixture()
  const device = () => createAccountStorage('account', 'delete-' + crypto.randomUUID())
  const writer = device(), stale = device(), reader = device()
  let remote: RemoteSnapshot = { revision: 1, data }
  const api: SnapshotApi = {
    async read() { validateData(remote.data); return remote },
    async write(flight) {
      if (flight.revision !== remote.revision) return null
      validateData(flight.data)
      remote = { revision: remote.revision + 1, data: flight.data }
      return remote.revision
    },
  }
  async function sync(store: typeof writer) {
    for (let i = 0; i < 6; i++) {
      const result = await syncOnce(store, api, async (): Promise<TrainingData> => initialData())
      if (result !== 'again') return result
    }
    throw new Error('同期が終了しませんでした')
  }
  expect(await sync(writer)).toBe('synced')
  expect(await sync(stale)).toBe('synced')
  const saved = await writer.save(current => deleteMenu(current, swing, today))
  await stale.save(current => setMenuEnabled(current, swing.id, false))
  expect(remote.revision).toBe(1)
  expect(await sync(writer)).toBe('synced')
  expect(await sync(stale)).toMatchObject({ kind: 'conflict' })
  expect(await sync(reader)).toBe('synced')
  expect(remote.revision).toBe(2)
  expect((await reader.read()).data).toEqual(saved.data)
})
