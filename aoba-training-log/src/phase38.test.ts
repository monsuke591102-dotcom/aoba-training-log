import 'fake-indexeddb/auto'
import { openDB } from 'idb'
import { expect, test } from 'vitest'
import { clearSkippedMenu, deletePlan, savePlan, saveSkippedMenu, setRest, SkipConfirmationRequired } from './activities'
import { initialData } from './initialData'
import { dailyStats, goalEntriesInRange, managementProgress } from './progress'
import { createStorage } from './storage'
import { saveMenu, saveRecord, trainingDaysInRange } from './training'

const date = '2026-11-18'
const now = new Date(2026, 10, 18, 12)
const ids = ['swing', 'tee', 'core']
function setup(planned = true) {
  let data = initialData()
  for (const id of ids) data = saveMenu(data, data.menus.find(menu => menu.id === id)!, '', now, '10')
  return planned ? savePlan(data, { date, kind: '自主練', menuIds: ids }) : data
}
function record(data: ReturnType<typeof setup>, menuId: string, amount: number) {
  return saveRecord(data, { date, menuId, kind: '自主練', amount: String(amount), duration: '', note: '', rating: '' }, undefined, now)
}

test('予定3件のうち2件達成・1件見送りは100%、未実施のままなら67%', () => {
  const data = record(record(setup(), 'swing', 10), 'tee', 10)
  expect(dailyStats(data, date).rate).toBe(67)
  const skipped = saveSkippedMenu(data, date, 'core', '天候不良', '', false, now)
  expect(dailyStats(skipped, date).rate).toBe(100)
  expect(managementProgress(skipped, now)).toEqual(managementProgress(data, now))
})

test('全見送り・予定も記録もない日・休養日は集計対象なし', () => {
  let data = setup()
  for (const id of ids) data = saveSkippedMenu(data, date, id, '予定変更', '', false, now)
  expect(dailyStats(data, date)).toEqual({ rate: null, entries: [] })
  expect(dailyStats(setup(false), date).rate).toBeNull()
  expect(dailyStats(setRest(record(setup(), 'swing', 10), date, true, now), date).rate).toBeNull()
  expect(dailyStats(savePlan(record(setup(), 'swing', 10), { date, kind: '休養日' }), date).rate).toBeNull()
})

test('予定にない記録も対象になり、同日同単位の実績を合算する', () => {
  let data = record(record(setup(false), 'swing', 4), 'swing', 8)
  expect(dailyStats(data, date)).toMatchObject({ rate: 100, entries: [{ id: 'swing', amount: 12, target: 10 }] })
  data = savePlan(data, { date, kind: '自主練', menuIds: ['tee'] })
  expect(dailyStats(data, date).rate).toBe(50)
})

test('未設定または単位不一致のみの実績は除外し、丸めで100%に達する場合も99%にする', () => {
  const planned = record(setup(), 'swing', 10)
  const swing = planned.menus[0]
  let data = saveMenu(planned, { ...swing, unit: '分' }, '', now, '10')
  data = savePlan(data, { date, kind: '自主練', menuIds: ['swing', 'grounder'] })
  expect(dailyStats(data, date).rate).toBeNull()
  data = record(data, 'swing', 9.99)
  expect(dailyStats(data, date).rate).toBe(99)
})

test('期間の入力は日次と同じ実績・除外条件を使い、未実施と対象なしを区別する', () => {
  let data = record(setup(), 'swing', 12)
  data = saveSkippedMenu(data, date, 'core', '天候不良', '', false, now)
  data = savePlan(data, { date: '2026-11-19', kind: '休養日' })
  data = savePlan(data, { date: '2026-11-20', kind: '自主練', menuIds: ['grounder'] })
  const days = goalEntriesInRange(data, date, '2026-11-20', '2026-11-20')
  expect(days).toEqual([
    { date, entries: dailyStats(data, date, '2026-11-20').entries },
    { date: '2026-11-19', entries: [] },
    { date: '2026-11-20', entries: [] },
  ])
  expect(days[0].entries).toMatchObject([{ id: 'swing', amount: 12, target: 10 }, { id: 'tee', amount: 0, target: 10 }])
  expect(goalEntriesInRange(data, '2026-11-20', date)).toEqual([])
})

test('後日の単位変更で過去の同単位の目標・記録と未実施予定が消えない', () => {
  const today = '2026-11-20'
  const updated = new Date(2026, 10, 20, 12)
  let data = record(setup(), 'swing', 5)
  data = savePlan(data, { date: '2026-11-19', kind: '自主練', menuIds: ['swing'] })
  const before = goalEntriesInRange(data, date, '2026-11-19', today)
  const swing = data.menus.find(menu => menu.id === 'swing')!
  data = saveMenu(data, { ...swing, unit: '分' }, '', updated, '20')
  expect(goalEntriesInRange(data, date, '2026-11-19', today)).toEqual(before)
  expect(before[0].entries).toContainEqual(expect.objectContaining({ id: 'swing', unit: '回', target: 10, amount: 5 }))
  expect(before[1].entries).toContainEqual(expect.objectContaining({ id: 'swing', unit: '回', target: 10, amount: 0 }))
})

test('期間内の実績日数は同日複数件を1日と数え、予定だけの日と範囲外を含めない', () => {
  const start = '2026-11-01'
  const end = '2026-11-30'
  let data = record(record(setup(), 'swing', 5), 'tee', 7)
  const template = data.records[0]
  data = { ...data, records: [...data.records,
    { ...template, id: 'month-start', date: start },
    { ...template, id: 'month-end', date: end },
    { ...template, id: 'next-month', date: '2026-12-01' },
  ] }
  data = savePlan(data, { date: '2026-11-19', kind: '自主練', menuIds: ids })
  expect(trainingDaysInRange(data, start, end)).toBe(3)
  expect(trainingDaysInRange(data, '2026-11-19', '2026-11-19')).toBe(0)
})

test('実績がある見送りは確認を要求し、記録を保全して新規の重複記録を防ぐ', () => {
  const data = record(setup(), 'swing', 10)
  expect(() => saveSkippedMenu(data, date, 'swing', 'その他', '', false, now)).toThrow(SkipConfirmationRequired)
  const skipped = saveSkippedMenu(data, date, 'swing', 'その他', '', true, now)
  expect(skipped.records).toEqual(data.records)
  expect(dailyStats(skipped, date).entries.some(item => item.id === 'swing')).toBe(false)
  expect(() => record(skipped, 'swing', 3)).toThrow('見送り中')
  expect(() => saveSkippedMenu(data, date, 'dash', 'その他', '', false, now)).toThrow('予定にありません')
  expect(clearSkippedMenu(skipped, date, 'swing').records).toEqual(data.records)
})

test('見送りを保存・編集・解除でき、予定を削除しても解除前の情報は残る', async () => {
  const storage = createStorage('phase38-' + crypto.randomUUID())
  await storage.update(() => setup())
  await storage.update(data => saveSkippedMenu(data, date, 'core', '天候不良', ' 雨 ', false, now))
  expect((await storage.read()).skippedMenus).toMatchObject([{ reason: '天候不良', note: '雨' }])
  await storage.update(data => deletePlan(data, date))
  const later = new Date(now.getTime() + 1000)
  await storage.update(data => saveSkippedMenu(data, date, 'core', '場所・設備の都合', '使えない', false, later))
  expect((await storage.read()).skippedMenus).toMatchObject([{ reason: '場所・設備の都合', note: '使えない', createdAt: now.toISOString(), updatedAt: later.toISOString() }])
  await storage.update(data => clearSkippedMenu(data, date, 'core'))
  expect((await storage.read())).toMatchObject({ skippedMenus: [], records: [] })
})

test('実データ形式のIndexedDB v2をv3に移行し、既存プロパティを保持する', async () => {
  const name = 'phase38-migrate-' + crypto.randomUUID()
  const old = await openDB(name, 2, { upgrade: db => { db.createObjectStore('training') } })
  const { skippedMenus, ...previous } = setRest(record(setup(), 'swing', 10), date, true, now)
  const legacy = { ...previous, schemaVersion: 2 }
  await old.put('training', legacy, 'data')
  old.close()
  const storage = createStorage(name)
  expect(await storage.read()).toEqual({ ...legacy, schemaVersion: 3, skippedMenus: [] })
  const migrated = await openDB(name)
  expect(migrated.version).toBe(3)
  expect(await migrated.get('training', 'data')).toEqual({ ...legacy, schemaVersion: 3, skippedMenus: [] })
  migrated.close()
})
