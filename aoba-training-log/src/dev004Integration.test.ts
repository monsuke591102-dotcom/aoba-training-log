import 'fake-indexeddb/auto'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { decodeBackup, encodeBackup, restoreChange } from './backup'
import { aggregateBattingStats, calculateMatchBattingStats } from './battingStats'
import { initialData } from './initialData'
import { emptyMatchDetails, initialPitchTypes } from './matchDetails'
import { deleteMatch, saveMatchDetailRow, updateMatchDetails } from './matches'
import type { MatchEntry, TrainingData } from './model'
import { battingGames, recordHistory } from './recordHistory'
import { aggregateBaserunningStats, aggregateFieldingStats, calculateMatchBaserunningStats, calculateMatchFieldingStats } from './runningFieldingStats'
import { createStorage } from './storage'

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
