import 'fake-indexeddb/auto'
import { openDB } from 'idb'
import { expect, test } from 'vitest'
import { deletePlan, savePlan, saveReflection, setRest } from './activities'
import { monthGrid } from './dates'
import { initialData } from './initialData'
import type { LocalDate } from './model'
import { dailyStats, levelProgress, levelThreshold, managementProgress } from './progress'
import { createStorage } from './storage'
import { deleteRecord, saveGoals, saveMenu, saveRecord, weekDates } from './training'

const now = new Date(2027, 0, 3, 12)
const draft = { date: '2027-01-03', menuId: 'swing', kind: '自主練' as const, amount: '25', duration: '', note: '', rating: '' }
const reflection = { success: '  手帳に書けた ', challenge: '', next: '' }

test('予定・休養の予定は実績とポイントに入らず、休養記録は日ごとに5ポイント', () => {
  let data = savePlan(initialData(), { date: '2027-01-03', kind: '自主練', menuIds: ['swing', 'swing'] })
  expect(data.plans[0]).toMatchObject({ menuIds: ['swing'] })
  data = savePlan(data, { date: '2027-01-03', kind: '休養日' })
  expect(managementProgress(data, now).points).toBe(0)
  data = setRest(data, '2027-01-03', true, now)
  data = setRest(data, '2027-01-03', true, now)
  expect(data.records).toEqual([])
  expect(managementProgress(data, now).points).toBe(5)
  expect(managementProgress(data, now).badges.find(badge => badge.id === 'rest')?.earnedAt).toBe(now.toISOString())
  data = deletePlan(data, '2027-01-03')
  expect(data.plans).toEqual([])
  expect(managementProgress(data, now).points).toBe(5)
  expect(managementProgress(setRest(data, '2027-01-03', false, now), now).points).toBe(0)
})

test('同日や同一週の重複を防ぎ、削除でポイントとバッジを再計算する', () => {
  let data = saveGoals(initialData(), '1', '', now)
  data = saveRecord(data, draft, undefined, now)
  data = saveRecord(data, { ...draft, menuId: 'tee' }, undefined, now)
  data = saveRecord(data, { ...draft, date: '2027-01-01' }, undefined, now)
  expect(managementProgress(data, now).points).toBe(50)
  expect(managementProgress(data, now).badges.filter(badge => badge.earnedAt).map(badge => badge.id)).toEqual(['first', 'goal'])
  data = deleteRecord(data, data.records[0].id)
  expect(managementProgress(data, now).points).toBe(50)
  data = deleteRecord(data, data.records[0].id)
  expect(managementProgress(data, now).points).toBe(40)
  data = deleteRecord(data, data.records[0].id)
  expect(managementProgress(data, now).points).toBe(0)
  expect(managementProgress(data, now).badges.some(badge => badge.earnedAt)).toBe(false)
})

test('レベルの境界とLv.6以降の累計ポイント', () => {
  const thresholds = [0, 100, 250, 450, 700, 1000, 1350]
  thresholds.forEach((points, index) => {
    expect(levelThreshold(index + 1)).toBe(points)
    expect(levelProgress(points).level).toBe(index + 1)
    if (index) {
      expect(levelProgress(points - 1)).toMatchObject({ level: index, remaining: 1 })
    }
  })
})

test('練習日数バッジは実施量に関係なく10日・30日で獲得する', () => {
  const records = Array.from({ length: 30 }, (_, index) =>
    saveRecord(initialData(), { ...draft, date: '2026-12-' + String(index + 1).padStart(2, '0') }, undefined, now).records[0])
  const earned = (length: number) => managementProgress({ ...initialData(), records: records.slice(0, length) }, now)
    .badges.filter(badge => badge.earnedAt).map(badge => badge.id)
  expect(earned(9)).toEqual(['first'])
  expect(earned(10)).toEqual(['first', 'ten'])
  expect(earned(29)).toEqual(['first', 'ten'])
  expect(earned(30)).toEqual(['first', 'ten', 'thirty'])
})

test('日次・週次の振り返りを保存・編集し、空欄はポイントを付けない', async () => {
  const storage = createStorage('phase3-reflection-' + crypto.randomUUID())
  await storage.update(data => saveReflection(data, 'day', '2027-01-03', reflection, now))
  await storage.update(data => saveReflection(data, 'week', '2027-01-03', reflection, now))
  const later = new Date(now.getTime() + 1000)
  await storage.update(data => saveReflection(data, 'week', '2027-01-02', { ...reflection, next: '週に一度見直す' }, later))
  const saved = await storage.read()
  expect(saved.reflections).toHaveLength(2)
  expect(saved.reflections.find(item => item.period === 'week')).toMatchObject({ date: '2026-12-28', success: '手帳に書けた', next: '週に一度見直す', createdAt: now.toISOString() })
  expect(managementProgress(saved, now).points).toBe(25)
  expect(managementProgress(saved, now).badges.find(item => item.id === 'reflection')?.earnedAt).toBe(now.toISOString())
  const blank = saveReflection(saved, 'day', '2027-01-03', { success: ' ', challenge: '', next: '' }, now)
  expect(managementProgress(blank, now).points).toBe(20)
})

test('年をまたぐ週の目標は週末時点の設定を使い、別週に1回ずつ付与する', () => {
  const monday = new Date(2027, 0, 4, 12)
  expect(weekDates(now)).toEqual(['2026-12-28', '2027-01-03'])
  let data = saveGoals(initialData(), '1', '', now)
  data = saveRecord(data, { ...draft, date: '2026-12-31' }, undefined, now)
  data = saveRecord(data, draft, undefined, now)
  data = saveRecord(data, { ...draft, date: '2027-01-04' }, undefined, monday)
  expect(managementProgress(data, monday).points).toBe(90)
  data = saveGoals(data, '2', '', monday)
  expect(managementProgress(data, monday).points).toBe(60)
})

test('月間カレンダーは月曜始まりで隣接月・閏日を含む', () => {
  const dates = monthGrid(new Date(2024, 1, 15))
  expect(dates[0]).toBe('2024-01-29')
  expect(dates.at(-1)).toBe('2024-03-03')
  expect(dates).toContain('2024-02-29')
  expect(new Set(dates).size).toBe(35)
  expect(monthGrid(new Date(2027, 0, 1))[0]).toBe('2026-12-28')
})

test('日次目標は各目標100%上限の平均を使い、週間目標・別単位・予定を混同しない', () => {
  const date = draft.date as LocalDate
  let data = saveMenu(initialData(), initialData().menus[0], '100', now)
  expect(dailyStats(data, date).rate).toBeNull()
  data = saveRecord(data, draft, undefined, now)
  const edited = { ...data.menus[0], unit: '分' as const }
  data = saveMenu(data, edited, '', now, '10')
  data = saveMenu(data, data.menus[1], '', now, '10')
  data = saveRecord(data, { ...draft, amount: '20' }, undefined, now)
  data = savePlan(data, { date, kind: '自主練', menuIds: ['swing', 'tee'] })
  expect(dailyStats(data, date)).toMatchObject({ rate: 50, entries: [{ unit: '分', amount: 20 }, { unit: '球', amount: 0 }] })
  data = savePlan(data, { date, kind: '自主練', menuIds: ['swing'] })
  expect(dailyStats(data, date).rate).toBe(100)
  expect(dailyStats(setRest(data, date, true, now), date).rate).toBeNull()
})

test('IndexedDB v1のデータをv3に移行して実績、メニュー、目標履歴を保持する', async () => {
  const name = 'phase2-migrate-' + crypto.randomUUID()
  const old = await openDB(name, 1, { upgrade: db => { db.createObjectStore('training') } })
  const initialized = saveRecord(saveGoals(initialData(), '2', '足を使う', now), draft, undefined, now)
  const { rests, skippedMenus, ...previous } = initialized
  await old.put('training', { ...previous, schemaVersion: 1 }, 'data')
  old.close()
  const storage = createStorage(name)
  const result = await storage.read()
  expect(result).toEqual(initialized)
  const migrated = await openDB(name)
  expect(migrated.version).toBe(3)
  expect(await migrated.get('training', 'data')).toEqual(initialized)
  migrated.close()
  await storage.update(data => setRest(data, '2027-01-02', true, now))
  expect((await storage.read()).records).toEqual(initialized.records)
})

