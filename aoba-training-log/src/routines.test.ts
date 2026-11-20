import 'fake-indexeddb/auto'
import { expect, test } from 'vitest'
import { createAccountStorage } from './accountStorage'
import { savePlan } from './activities'
import { decodeBackup, encodeBackup } from './backup'
import { importCandidates, parseSchedule, type TrainingSheet } from './excelPlan'
import { initialData } from './initialData'
import type { RoutineItem, RoutineVersion, TrainingData } from './model'
import { dailyStats, managementProgress } from './progress'
import { saveQuickRecord } from './quickRecord'
import { changeRoutineMode, dailyRoutine, nextMonth, plannedMenuIds, routineForDate, saveRoutine, selectRoutineMenu, setRoutineAddition, setRoutineCompletion } from './routines'
import { syncOnce, type RemoteSnapshot, type SnapshotApi } from './sync'
import { saveMenu, setMenuEnabled } from './training'

const now = new Date(2026, 10, 16, 12)
const monday = '2026-11-16'
const wednesday = '2026-11-18'
const items: RoutineItem[] = [
  { id: 'stretch', name: 'ストレッチ', menuId: 'stretch', schedule: 'daily', weekdays: [], note: '', condition: '' },
  { id: 'swing', name: '素振り', menuId: 'swing', schedule: 'weekdays', weekdays: [1, 3, 4], target: { amount: 20, unit: '回' }, note: '', condition: '' },
  { id: 'optional', name: '実施条件つき', menuId: 'grounder', schedule: 'conditional', weekdays: [], condition: '部活がない日', note: '' },
]

test('Excelで明示された曜日・毎日・任意の条件だけを割り当てる', () => {
  expect(parseSchedule('日曜・土曜')).toMatchObject({ schedule: 'weekdays', weekdays: [0, 6] })
  expect(parseSchedule('月曜、水曜、木曜')).toMatchObject({ schedule: 'weekdays', weekdays: [1, 3, 4] })
  expect(parseSchedule('毎日')).toMatchObject({ schedule: 'daily' })
  expect(parseSchedule('部活がない日')).toMatchObject({ schedule: 'conditional' })
  expect(parseSchedule('気がついた時')).toMatchObject({ schedule: 'conditional' })
  expect(parseSchedule('月曜か、時間がある時')).toBeNull()
  expect(parseSchedule('毎日5分、左右')).toBeNull()
})

test('候補は既存メニューと完全一致を照合し、時間・複合目標を要確認にする', () => {
  const cell = (address: string, text: string, raw = text, format = 'General') => ({ address, text, raw, format, formula: false })
  const sheet: TrainingSheet = { sourceKey: 'test-fixture', columns: ['A', 'B', 'C'], rows: [
    { number: 2, cells: [cell('A2', '素振り'), cell('B2', '月曜・水曜'), cell('C2', '20回')] },
    { number: 3, cells: [cell('A3', '軸足バランス'), cell('B3', '毎日'), cell('C3', '05:00', '0.00347222', 'mm:ss')] },
    { number: 4, cells: [cell('A4', 'ジャンプランジ'), cell('B4', '月曜・水曜'), cell('C4', '10回×3セット')] },
  ] }
  const rows = importCandidates(sheet, { name: 'A', schedule: 'B', target: 'C', note: '' }, initialData().menus, 2, 4)
  expect(rows[0]).toMatchObject({ unresolved: false, item: { menuId: 'swing', target: { amount: 20, unit: '回' } } })
  expect(rows[1]).toMatchObject({ unresolved: true, item: { schedule: 'daily', note: '05:00' } })
  expect(rows[1].item.target).toBeUndefined()
  expect(rows[2].item.target).toBeUndefined()
  expect(rows[2].item.note).toBe('10回×3セット')
})

test('取込は確定までデータを変えず、同じファイルの再登録を拒否する', () => {
  const before = initialData()
  const version = { id: 'excel', startsOn: monday, items, sourceKey: 'a' } as const
  expect(before.routineVersions).toBeUndefined()
  const saved = saveRoutine(before, version, now)
  expect(saved.menus).toEqual(before.menus)
  expect(saved.goals).toEqual(before.goals)
  expect(() => saveRoutine(saved, { ...version, id: 'other' }, now)).toThrow('すでに登録')
})

test('今日の曜日・毎日・日別予定を表示し、任意メニューは本人が追加する', () => {
  let data = saveRoutine(initialData(), { id: 'v1', startsOn: monday, items }, now)
  expect([...plannedMenuIds(data, wednesday)]).toEqual(['stretch', 'swing'])
  expect(dailyRoutine(data, wednesday).optional.map(item => item.id)).toEqual(['optional'])
  expect([...plannedMenuIds(data, '2026-11-17')]).toEqual(['stretch'])
  data = savePlan(data, { date: wednesday, kind: 'チーム練習', menuIds: ['tee'] })
  data = setRoutineAddition(data, wednesday, 'optional', true)
  expect([...plannedMenuIds(data, wednesday)]).toEqual(['tee', 'stretch', 'swing', 'grounder'])
  expect(dailyRoutine(data, '2026-11-19').additions.size).toBe(0)
  expect(plannedMenuIds(setRoutineAddition(data, wednesday, 'optional', false), wednesday).has('grounder')).toBe(false)
})

test('翌月コピーと月途中の変更で過去の記録・目標・達成率・ポイントを保つ', () => {
  let data = saveRoutine(initialData(), { id: 'v1', startsOn: monday, items }, now)
  data = saveQuickRecord(data, monday, 'swing', '回', '自主練', { delta: 10 }, now)
  expect(dailyStats(data, monday).rate).toBe(50)
  const newer = { id: 'v2', startsOn: nextMonth(now), items: items.map(item => item.target ? { ...item, target: { ...item.target, amount: 10 } } : item) }
  const later = saveRoutine(data, newer, now)
  expect(routineForDate(later, monday)?.id).toBe('v1')
  expect(routineForDate(later, '2026-12-01')?.id).toBe('v2')
  const mid = saveRoutine(later, { ...newer, id: 'v3', startsOn: '2026-11-23', items: [] }, now)
  expect(routineForDate(mid, '2026-11-23')?.id).toBe('v3')
  expect(dailyStats(mid, monday)).toEqual(dailyStats(data, monday))
  expect(mid.records).toEqual(data.records)
  expect(mid.goals).toEqual(data.goals)
  expect(managementProgress(mid, now)).toEqual(managementProgress(data, now))
})

test('計画と任意追加をJSONで往復し、既存版のJSONも読み込める', () => {
  const before = initialData()
  const data = setRoutineAddition(saveRoutine(before, { id: 'v1', startsOn: monday, items }, now), wednesday, 'optional', true)
  expect(decodeBackup(encodeBackup(data, now)).data).toEqual(data)
  expect(decodeBackup(encodeBackup(before, now)).data).toEqual(before)
})

test('オフライン保存した計画・記録とメニューの非表示状態が別端末に復元される', async () => {
  const a = createAccountStorage('a', 'routine-a-' + crypto.randomUUID())
  const b = createAccountStorage('a', 'routine-b-' + crypto.randomUUID())
  let remote: RemoteSnapshot | null = null
  const api: SnapshotApi = {
    async read() { return remote },
    async write(flight) {
      if ((remote?.revision ?? null) !== flight.revision) return null
      remote = { revision: (flight.revision ?? 0) + 1, data: flight.data }
      return remote.revision
    },
  }
  await a.save(data => saveRoutine(data, { id: 'v1', startsOn: monday, items }, now))
  await a.save(data => saveQuickRecord(data, monday, 'swing', '回', '自主練', { delta: 10 }, now))
  const expected = await a.save(data => setMenuEnabled(data, 'swing', false))
  expect(expected.generation).toBeGreaterThan(expected.syncedGeneration)
  for (const store of [a, b]) {
    let result
    for (let i = 0; i < 10 && result !== 'synced'; i++) result = await syncOnce(store, api, async () => initialData())
    expect(result).toBe('synced')
  }
  expect((await b.read()).data).toEqual(expected.data)
})

test('非表示は当日と未来の候補から外れ、実績と過去集計を保持し、再表示で元の計画に戻る', () => {
  let data = saveRoutine(initialData(), { id: 'v1', startsOn: monday, items }, now)
  data = savePlan(data, { date: wednesday, kind: '自主練', menuIds: ['swing'] })
  data = saveQuickRecord(data, monday, 'swing', '回', '自主練', { delta: 10 }, now)
  const today = wednesday
  const hidden = setMenuEnabled(setMenuEnabled(data, 'swing', false), 'grounder', false)
  expect(hidden.records).toBe(data.records)
  expect(hidden.goals).toBe(data.goals)
  expect(hidden.plans).toBe(data.plans)
  expect(hidden.routineVersions).toBe(data.routineVersions)
  expect(dailyStats(hidden, monday, today)).toEqual(dailyStats(data, monday, today))
  expect(dailyStats(data, wednesday, today).rate).toBe(0)
  expect(dailyStats(hidden, wednesday, today).rate).toBeNull()
  expect(plannedMenuIds(hidden, '2026-11-19', today).has('swing')).toBe(false)
  expect(dailyRoutine(hidden, today, today).optional).toEqual([])
  const recordedToday = saveQuickRecord(data, today, 'swing', '回', '自主練', { delta: 10 }, new Date(2026, 10, 18, 12))
  expect(dailyStats(setMenuEnabled(recordedToday, 'swing', false), today, today).rate).toBe(50)
  expect(setMenuEnabled(setMenuEnabled(hidden, 'swing', true), 'grounder', true)).toEqual(data)
})

test('単位・名称・所属グループの変更を新しい版として保存し、旧メニューを保持する', () => {
  const original = saveRoutine(initialData(), { id: 'original-group', startsOn: monday, items: [{
    id: 'custom', name: '素振り', menuId: 'swing', mode: 'quantity', recordUnit: '回',
    schedule: 'daily', weekdays: [], target: { amount: 20, unit: '回' }, note: '', condition: '',
  }] }, now)
  const old = saveQuickRecord(original, monday, 'swing', '回', '自主練', { delta: 10 }, now)
  const next = saveRoutine(old, { id: 'next-group', startsOn: '2026-12-01', items: [{
    ...original.routineVersions![0].items[0], menuId: undefined, name: '素振り15回', group: '打撃', recordUnit: 'セット',
    target: { amount: 3, unit: 'セット' },
  }] }, now)
  expect(routineForDate(next, monday)?.items[0]).toMatchObject({ menuId: 'swing', recordUnit: '回' })
  expect(routineForDate(next, '2026-12-01')?.items[0]).toMatchObject({ group: '打撃', recordUnit: 'セット' })
  expect(next.records).toEqual(old.records)
  expect(next.menus.find(menu => menu.id === 'swing')).toEqual(old.menus.find(menu => menu.id === 'swing'))
  expect(decodeBackup(encodeBackup(next, now)).data).toEqual(JSON.parse(JSON.stringify(next)))
})

function balancePlan() {
  const group = '軸足バランス'
  const linked: RoutineItem[] = ['右', '左'].map(side => ({
    id: side, name: group + '(' + side + ')', group, mode: 'quantity', recordUnit: '分',
    target: { amount: 5, unit: '分' }, schedule: 'daily', weekdays: [], note: '', condition: '',
  }))
  const data = saveRoutine(initialData(), { id: 'balance', startsOn: monday, items: [...linked, {
    id: 'check', name: '確認', mode: 'check', schedule: 'daily', weekdays: [], note: '', condition: '',
  }] }, now)
  const version = routineForDate(data, monday)!
  const [right, left] = version.items.map(item => data.menus.find(menu => menu.id === item.menuId)!)
  return { data, version, right, left }
}

test.each([false, true])('記録方法を往復しても左右の元IDと目標を保つ（改名・非表示・旧名の別ID: %s）', renamed => {
  const { data, version, right, left } = balancePlan()
  const recorded = saveQuickRecord(data, monday, right.id, right.unit, '自主練', { delta: 1 }, now)
  let before = recorded
  if (renamed) {
    before = saveMenu(before, { ...right, name: '軸足バランス(右)' }, '', now)
    before = saveMenu(before, { ...right, id: 'old-name' }, '', now, undefined, true)
    before = setMenuEnabled(before, right.id, false)
  }
  const drafts = version.items.slice(0, 2).map(item =>
    changeRoutineMode(changeRoutineMode(item, 'check', before.menus), 'quantity', before.menus))
  const saved = saveRoutine(before, { ...version, id: 'mode-copy', startsOn: wednesday, items: drafts }, now)
  expect(saved.menus).toBe(before.menus)
  expect(saved.records).toBe(recorded.records)
  expect(saved.goals).toBe(before.goals)
  expect(saved.routineVersions?.[0]).toBe(version)
  expect(routineForDate(saved, wednesday)?.items).toEqual(version.items.slice(0, 2))
  expect(dailyRoutine(saved, wednesday, wednesday).selected.map(item => item.menuId))
    .toEqual(renamed ? [left.id] : [right.id, left.id])
})

test.each(['missing', 'deleted', 'unit changed'])('無効な退避先では明示選択まで数量保存を拒否する（%s）', reason => {
  const { data, version, right, left } = balancePlan()
  const check = changeRoutineMode(version.items[0], 'check', data.menus)
  const menus = reason === 'unit changed'
    ? data.menus.map(menu => menu.id === right.id ? { ...menu, unit: '回' as const } : menu)
    : data.menus.filter(menu => menu.id !== right.id)
  const latest: TrainingData = { ...data, menus: [...menus, { ...right, id: 'same-name' }],
    deletedMenus: reason === 'deleted' ? [{ ...right, deletedOn: wednesday }] : undefined }
  const returned = changeRoutineMode(check, 'quantity', latest.menus)
  expect(returned.menuId).toBeUndefined()
  const copy: RoutineVersion = { ...version, id: 'mode-copy', startsOn: wednesday }
  expect(() => saveRoutine(latest, { ...copy, items: [returned] }, now)).toThrow('選び直してください')
  const selected = selectRoutineMenu(check, left)
  const final = changeRoutineMode(changeRoutineMode(selected, 'check', latest.menus), 'quantity', latest.menus)
  expect(saveRoutine(latest, { ...copy, items: [final] }, now).routineVersions?.at(-1)?.items[0].menuId).toBe(left.id)
})

test('完了チェックの退避情報は保存せず、元からIDのない種目は従来どおり扱う', async () => {
  const { data, version, right } = balancePlan()
  const db = 'routine-mode-' + crypto.randomUUID()
  const store = createAccountStorage('test', db)
  const check = changeRoutineMode(version.items[0], 'check', data.menus)
  expect(check.pausedLink?.menuId).toBe(right.id)
  const unlinked = changeRoutineMode(version.items[2], 'quantity', data.menus)
  expect(unlinked.pausedLink).toBeUndefined()
  await store.save(() => saveRoutine(data, { ...version, id: 'mode-copy', startsOn: wednesday,
    items: [check, { ...unlinked, recordUnit: '回' }] }, now))
  const reloaded = (await createAccountStorage('test', db).read()).data
  const [savedCheck, savedQuantity] = routineForDate(reloaded, wednesday)!.items
  expect(savedCheck.mode).toBe('check')
  expect(savedCheck.menuId).toBeUndefined()
  expect(savedCheck).not.toHaveProperty('pausedLink')
  expect(savedQuantity.menuId).toBeDefined()
  expect(reloaded.menus).toHaveLength(data.menus.length + 1)
})

test.each([false, true])('改名後の計画コピーは左右のIDと過去データを保持する（左も改名: %s）', renameLeft => {
  const { data, version, right, left } = balancePlan()
  const old = saveQuickRecord(data, monday, right.id, right.unit, '自主練', { delta: 1 }, now)
  let renamed = saveMenu(old, { ...right, name: '軸足バランス(右)' }, '', now)
  if (renameLeft) renamed = saveMenu(renamed, { ...left, name: '軸足バランス(左)' }, '', now)
  const withOther = saveMenu(renamed, { ...right, id: 'same-old-name' }, '', now, undefined, true)
  const hidden = setMenuEnabled(withOther, right.id, false)
  const copied = saveRoutine(hidden, { ...version, id: 'copy', startsOn: wednesday }, now)
  expect(copied.menus).toBe(hidden.menus)
  expect(copied.routineVersions?.[0]).toBe(version)
  expect(copied.records).toBe(old.records)
  expect(copied.goals).toBe(hidden.goals)
  expect(routineForDate(copied, wednesday)?.items.map(item => item.menuId)).toEqual([right.id, left.id, undefined])
  expect(dailyRoutine(copied, wednesday, wednesday).selected.map(item => item.id)).toEqual(['左', 'check'])
  expect(dailyRoutine(setMenuEnabled(copied, right.id, true), wednesday, wednesday).selected.map(item => item.id))
    .toEqual(['右', '左', 'check'])
})

test('記録メニューIDの欠落・単位の不一致を拒否し、明示的な編集と紐づけを受け入れる', () => {
  const { data, version, right } = balancePlan()
  const item = version.items[0]
  const save = (edited: RoutineItem) => saveRoutine(data, { id: 'copy', startsOn: wednesday, items: [edited] }, now)
  expect(() => save({ ...item, menuId: 'missing' })).toThrow('選び直してください')
  expect(() => save({ ...item, recordUnit: '回' })).toThrow('選び直してください')
  const renamed = save({ ...item, name: '計画だけの新名称' })
  expect(routineForDate(renamed, wednesday)?.items[0]).toMatchObject({ menuId: right.id, name: '計画だけの新名称' })
  const relinked = save({ ...item, menuId: 'swing', recordUnit: '回', target: { amount: 12, unit: '回' } })
  expect(routineForDate(relinked, wednesday)?.items[0]).toMatchObject({ menuId: 'swing', recordUnit: '回' })
  expect(relinked.menus).toBe(data.menus)
})


test('完了チェックは実績数量やポイントに置き換えず、バックアップに含める', () => {
  const data = saveRoutine(initialData(), { id: 'check-plan', startsOn: monday, items: [{
    id: 'check', name: '膝コロ5回', group: '筋トレ', mode: 'check', schedule: 'daily', weekdays: [], note: '', condition: '',
  }] }, now)
  const checked = setRoutineCompletion(data, monday, 'check', true)
  expect(checked.records).toEqual([])
  expect(managementProgress(checked, now)).toEqual(managementProgress(data, now))
  expect(decodeBackup(encodeBackup(checked, now)).data.routineCompletions).toEqual([{ date: monday, itemId: 'check' }])
  expect(setRoutineCompletion(checked, monday, 'check', false).routineCompletions).toEqual([])
})
