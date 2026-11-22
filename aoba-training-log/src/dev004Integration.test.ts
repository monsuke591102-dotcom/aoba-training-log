import 'fake-indexeddb/auto'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { deletePlan, savePlan, saveSkippedMenu } from './activities'
import { decodeBackup, encodeBackup, restoreBackup, restoreChange } from './backup'
import { aggregateBattingStats, calculateMatchBattingStats } from './battingStats'
import { Calendar } from './Calendar'
import { initialData } from './initialData'
import { emptyMatchDetails, initialPitchTypes, type Pitch } from './matchDetails'
import { assignMenuCategory, defaultCategorySettings, groupedMenus, readCategorySettings, saveCategory } from './menuCategories'
import { monthlyTrainingDays, readMonthlyGoals, type MonthlyGoal } from './monthlyGoals'
import { deleteMatch, saveMatchDetailRow, updateMatchDetails } from './matches'
import type { MatchEntry, TrainingData } from './model'
import { dailyStats, periodAchievement } from './progress'
import { battingGames, recordHistory } from './recordHistory'
import { findRoutineMenu, saveRoutine } from './routines'
import { aggregateBaserunningStats, aggregateFieldingStats, calculateMatchBaserunningStats, calculateMatchFieldingStats } from './runningFieldingStats'
import { createStorage } from './storage'
import { saveRecord } from './training'

const time = '2026-11-20T12:00:00.000Z'
const match = { id: 'game-a', date: '2026-11-20', good: '声かけ', improve: '', createdAt: time, updatedAt: time } satisfies MatchEntry
const target = { matchId: match.id }
const plate = { id: 'pa', order: 1, status: 'complete', result: 'single', pitchCount: 0, rbi: 0 } as const
const legacy = { ...emptyMatchDetails(), plateAppearances: [{ ...plate, pitches: [
  { id: 'old-pitch', order: 1, result: 'inPlay', type: initialPitchTypes[1], location: { zone: 'outside', side: 'high' } },
] }] } satisfies NonNullable<MatchEntry['details']>
const data: TrainingData = { ...initialData(), matches: [{ ...match, details: legacy },
  { ...match, id: 'game-b', details: legacy }] }

beforeEach(() => {
  vi.stubGlobal('__LOCAL_MATCH_RECORDS__', true)
  vi.stubGlobal('__MATCH_TEST_BUILD__', null)
  vi.stubGlobal('window', { location: { hostname: 'localhost' } })
})
afterEach(() => vi.unstubAllGlobals())

function withPitch(source: TrainingData) {
  return saveMatchDetailRow(source, target, 'plateAppearances', { ...legacy.plateAppearances[0], pitches: [
    ...legacy.plateAppearances[0].pitches,
    { id: 'new-pitch', order: 2, type: initialPitchTypes[0], result: 'hit', location: { zone: 'point', x: .3, y: .9 } },
  ] })
}

function withFielding(source: TrainingData) {
  return saveMatchDetailRow(source, target, 'fielding', { id: 'play', order: 1, plateAppearanceId: 'pa',
    status: 'complete', playType: 'noBall', position: 'C', opportunity: { inning: 2, noBallKind: 'caughtStealing' }, credits: ['putout'] })
}

test('分類・計画・達成率・予定・試合詳細と月別目標を同じJSONで復元する', async () => {
  const oldDay = '2026-12-31'
  const newDay = '2027-01-01'
  const now = new Date(2027, 0, 1, 12)
  const swing = data.menus.find(menu => menu.id === 'swing')!
  const item = { id: 'routine', menuId: swing.id, name: swing.name, mode: 'quantity', recordUnit: swing.unit,
    schedule: 'daily', weekdays: [], note: '', condition: '', target: { amount: 10, unit: swing.unit } } as const
  let source = withFielding(withPitch(data))
  source = saveMatchDetailRow(source, target, 'baserunning', {
    id: 'run', order: 1, status: 'complete', from: 'second', to: 'third', result: 'stolenBase',
  })
  source = saveRoutine(source, { id: 'old', startsOn: oldDay, items: [{ ...item, weekdays: [] }] }, new Date(2026, 11, 30))
  source = saveRoutine(source, { id: 'new', startsOn: newDay, items: [{ ...item, weekdays: [], target: { ...item.target, amount: 20 } }] }, now)
  source = savePlan(source, { date: newDay, kind: 'チーム練習', menuIds: ['tee', 'core'] })
  source = saveSkippedMenu(source, newDay, 'tee', '予定変更', '', false, now)
  for (const [date, amount] of [[oldDay, '5'], [newDay, '20'], [newDay, '1']] as const) {
    source = saveRecord(source, { date, amount, menuId: swing.id, kind: '自主練', note: '', duration: '', rating: '' }, undefined, now)
  }
  let categories = saveCategory(defaultCategorySettings(), '打つ練習', 'batting')
  categories = saveCategory(categories, '連携')
  const categoryId = categories.categories.at(-1)!.id
  categories = assignMenuCategory(categories, swing, categoryId)
  const goals: MonthlyGoal[] = [{ start: '2026-12-01', days: 12 }, { start: newDay, days: 15 }]
  const backup = decodeBackup(encodeBackup(source, now, goals, categories))
  const values = new Map<string, string>()
  const browser = { length: 0, key: () => null, getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) } }
  const name = 'dev001-007-' + crypto.randomUUID()
  const store = createStorage(name)
  const restore = async (change: Parameters<typeof store.update>[0]) => { await store.update(change) }
  await restoreBackup(backup, await store.read(), [], browser, restore, defaultCategorySettings())
  const reopened = await createStorage(name).read()
  expect(reopened).toEqual(backup.data)
  expect(readMonthlyGoals(browser)).toEqual(goals)
  expect(readCategorySettings(browser)).toEqual(categories)
  expect(groupedMenus(readCategorySettings(browser), reopened.menus).find(group => group.id === categoryId)?.menus[0].id).toBe(swing.id)
  expect(findRoutineMenu(reopened.menus, reopened.routineVersions![0].items[0])?.id).toBe(swing.id)
  expect(dailyStats(reopened, oldDay, newDay).rate).toBe(50)
  expect(periodAchievement(reopened, 'week', newDay).rate).toBe(75)
  expect(periodAchievement(reopened, 'month', newDay).rate).toBe(100)
  expect(monthlyTrainingDays(reopened, oldDay)).toBe(1)
  expect(monthlyTrainingDays(reopened, newDay)).toBe(1)
  expect(reopened.matches?.[0].details).toEqual(source.matches?.[0].details)
  const calendar = (training: TrainingData) => renderToStaticMarkup(createElement(Calendar, { data: training, commit: vi.fn(),
    onRecord: vi.fn(), onReflection: vi.fn(), initialDate: newDay }))
  const html = calendar(reopened)
  expect(html).toContain('練習計画のメニュー')
  expect(html).toContain('<li>素振り</li>')
  expect(html).toContain('ティーバッティングの見送りを編集')
  expect(html).toContain('素振りの記録を編集')
  const explicit = savePlan(reopened, { date: newDay, kind: '自主練', menuIds: [swing.id] })
  const skipped = saveSkippedMenu(explicit, newDay, swing.id, '予定変更', '', true, now)
  const withoutExplicit = calendar(deletePlan(skipped, newDay))
  expect(withoutExplicit).toContain('素振りの見送りを編集')
  expect(withoutExplicit).not.toContain('<li>素振り</li>')
})

test('投球の編集・削除後も旧座標と打球情報を保持し、矛盾する更新を保存しない', async () => {
  const name = 'dev004-pitch-edit-' + crypto.randomUUID()
  const store = createStorage(name)
  const oldPitch = legacy.plateAppearances[0].pitches[0]
  const hit = { id: 'hit', order: 2, result: 'hit', type: initialPitchTypes[0],
    location: { zone: 'point', x: .1, y: .85 } } satisfies Pitch
  const row = { ...plate, battedBall: 'liner' as const, fieldPoint: { x: .35, y: .6 }, pitches: [oldPitch, hit] }
  await store.update(() => data)
  await store.update(current => saveMatchDetailRow(current, target, 'plateAppearances', row))
  const edited = { ...row, result: 'double' as const, pitches: [oldPitch, { ...hit, location: { ...hit.location, x: .9 } }] }
  await store.update(current => saveMatchDetailRow(current, target, 'plateAppearances', edited))
  const reopened = await createStorage(name).read()
  expect(reopened.matches![0].details?.plateAppearances).toEqual([edited])
  expect(calculateMatchBattingStats(reopened.matches![0])).toMatchObject({ h: 1, tb: 2 })
  await expect(store.update(current => saveMatchDetailRow(current, target, 'plateAppearances',
    { ...edited, result: 'walk' }))).rejects.toThrow()
  expect(await createStorage(name).read()).toEqual(reopened)

  const removed = { ...edited, pitches: [oldPitch] }
  await store.update(current => saveMatchDetailRow(current, target, 'plateAppearances', removed))
  const final = await createStorage(name).read()
  expect(final.matches![0].details?.plateAppearances).toEqual([removed])
  expect(final.matches![1]).toEqual(data.matches![1])
  expect(calculateMatchBattingStats(final.matches![0])).toMatchObject({ h: 1, tb: 2 })
})

test('詳細v1〜v3とバックアップv1〜v4を復元し、古い形式・確認後変更・保存失敗で既存データを保持する', async () => {
  const v3 = withPitch(data)
  const v4 = withFielding(v3)
  const snapshots = [initialData(), data, v3, v4]
  const backups = snapshots.map(snapshot => decodeBackup(encodeBackup(snapshot)))
  expect(backups.map(backup => backup.backupVersion)).toEqual([1, 2, 3, 4])
  expect(backups.map(backup => backup.data.matches?.[0].details?.version)).toEqual([undefined, 1, 2, 3])
  const name = 'dev004-restore-' + crypto.randomUUID()
  const store = createStorage(name)
  for (const backup of backups) {
    const current = await store.read()
    await store.update(restoreChange(backup, current))
    expect(await createStorage(name).read()).toEqual(backup.data)
  }
  const saved = await store.read()
  for (const backup of backups.slice(0, -1)) {
    await expect(store.update(restoreChange(backup, saved))).rejects.toThrow('上書きできません')
    expect(await store.read()).toEqual(saved)
  }
  await expect(store.update(restoreChange(backups[3], data))).rejects.toThrow('確認中')
  await expect(store.update(current => ({ ...current, invalid: () => undefined }))).rejects.toMatchObject({ name: 'DataCloneError' })
  expect(await createStorage(name).read()).toEqual(saved)
  const retried = await store.update(current => saveMatchDetailRow(current, target, 'baserunning', {
    id: 'retry', order: 1, status: 'complete', from: 'first', to: 'second', result: 'stolenBase', plateAppearanceId: 'pa',
  }))
  expect(retried.matches![0].details?.baserunning[0].id).toBe('retry')
})

test('月別目標付きでも試合詳細のバックアップ版と旧形式の上書き防止を保つ', async () => {
  const full = withFielding(withPitch(data))
  const goals = [{ start: '2026-11-01', days: 15 }] as const
  const parsed = [initialData(), data, withPitch(data), full].map(snapshot => decodeBackup(encodeBackup(snapshot, new Date(time), [...goals])))
  expect(parsed.map(backup => backup.backupVersion)).toEqual([1, 2, 3, 4])
  expect(parsed[3].data).toEqual(full)
  const storage = { length: 0, key: () => null, getItem: () => null, setItem: vi.fn() }
  const restore = vi.fn()
  for (const backup of parsed.slice(0, -1)) {
    await expect(restoreBackup(backup, full, [], storage, restore)).rejects.toThrow('上書きできません')
  }
  expect(storage.setItem).not.toHaveBeenCalled()
  expect(restore).not.toHaveBeenCalled()
  expect(() => decodeBackup(JSON.stringify({ ...parsed[0], backupVersion: 4 }))).toThrow('一致しません')
})

test('同日試合の編集と削除をIDで分離し、試合別と通算を再集計する', async () => {
  const name = 'dev004-history-' + crypto.randomUUID()
  const store = createStorage(name)
  await store.update(() => withFielding(withPitch(data)))
  await store.update(current => saveMatchDetailRow(current, target, 'baserunning', {
    id: 'run', order: 1, status: 'complete', from: 'first', to: 'second', result: 'stolenBase', plateAppearanceId: 'pa',
  }))
  const other = { matchId: 'game-b' }
  await store.update(current => saveMatchDetailRow(current, other, 'baserunning', {
    id: 'run', order: 1, status: 'complete', from: 'first', to: 'second', result: 'caughtStealing',
  }))
  await store.update(current => saveMatchDetailRow(current, other, 'fielding', {
    id: 'play', order: 1, status: 'complete', position: 'C', playType: 'throw', credits: ['error'],
  }))
  const reopened = await createStorage(name).read()
  const games = battingGames(recordHistory(reopened))
  expect(new Set(games.map(game => game.id))).toEqual(new Set(['match:game-a', 'match:game-b']))
  const [a, b] = reopened.matches!
  expect(calculateMatchBattingStats(a)).toMatchObject({ h: 1, tb: 1 })
  expect(calculateMatchBaserunningStats(a)).toMatchObject({ sb: 1, cs: 0, stealRate: 1 })
  expect(calculateMatchFieldingStats(b)).toMatchObject({ po: 0, e: 1, fpct: 0 })
  expect(aggregateBattingStats(games.map(calculateMatchBattingStats))).toMatchObject({ h: 2, tb: 2 })
  expect(aggregateBaserunningStats(games.map(calculateMatchBaserunningStats))).toMatchObject({ sb: 1, cs: 1, stealRate: .5 })
  expect(aggregateFieldingStats(games.map(calculateMatchFieldingStats))).toMatchObject({ po: 1, e: 1, fpct: .5 })

  const edited = await store.update(current => updateMatchDetails(current, target, details => ({
    ...details, plateAppearances: details.plateAppearances.map(row => ({ ...row, result: 'double' })),
    baserunning: details.baserunning.map(row => ({ ...row, result: 'caughtStealing' })),
    fielding: details.fielding.map(row => ({ ...row, credits: [] })),
  })))
  expect(edited.matches![1]).toEqual(b)
  const after = battingGames(recordHistory(edited))
  expect(aggregateBattingStats(after.map(calculateMatchBattingStats))).toMatchObject({ h: 2, tb: 3 })
  expect(aggregateBaserunningStats(after.map(calculateMatchBaserunningStats))).toMatchObject({ sb: 0, cs: 2, stealRate: 0 })
  expect(aggregateFieldingStats(after.map(calculateMatchFieldingStats))).toMatchObject({ po: 0, e: 1, fpct: 0 })
  const removed = await store.update(current => deleteMatch(current, match.id, false))
  expect(removed.matches).toEqual([b])
  expect(await createStorage(name).read()).toEqual(removed)
})
