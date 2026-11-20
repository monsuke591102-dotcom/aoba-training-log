import { expect, test } from 'vitest'
import { aggregateBattingStats, calculateMatchBattingStats } from './battingStats'
import { emptyMatchDetails, type MatchDetails, type PlateAppearance } from './matchDetails'

function match(...results: PlateAppearance['result'][]) {
  return { details: { ...emptyMatchDetails(), plateAppearances: results.map((result, i) => ({
    id: 'pa-' + i, order: i + 1, status: 'complete' as const, result,
  })) } }
}

test('4種類の安打を合計し、安打種別から塁打を計算する', () => {
  expect(calculateMatchBattingStats(match('single', 'double', 'triple', 'homeRun'))).toMatchObject({
    pa: 4, ab: 4, h: 4, singles: 1, doubles: 1, triples: 1, homeRuns: 1, tb: 10,
    avg: 1, obp: 1, slg: 2.5, ops: 3.5, rbi: null,
  })
})

test('四球・死球・犠打・犠飛を打数から除き、犠飛だけを犠牲打の中からOBP分母に入れる', () => {
  expect(calculateMatchBattingStats(match('single', 'walk', 'hitByPitch', 'sacrificeBunt', 'sacrificeFly'))).toMatchObject({
    pa: 5, ab: 1, h: 1, bb: 1, hbp: 1, sh: 1, sf: 1, avg: 1, obp: .75, slg: 1, ops: 1.75,
  })
})

test('失策出塁・野手選択は打数、妨害による出塁は打席のみ', () => {
  expect(calculateMatchBattingStats(match('reachedOnError', 'fieldersChoice', 'interference'))).toMatchObject({
    pa: 3, ab: 2, h: 0, reachedOnError: 1, fieldersChoice: 1, avg: 0, obp: 0, slg: 0, ops: 0,
  })
})

test('バント安打とバント失敗後の三振は、確定した打席結果で計上する', () => {
  const input = match('single', 'strikeoutSwinging', 'strikeoutLooking', 'droppedThirdStrike')
  const details: MatchDetails = { ...input.details, plateAppearances: input.details.plateAppearances.map((pa, i) =>
    i === 0 ? { ...pa, battedBall: 'bunt', bunt: 'succeeded' } : i === 1 ? { ...pa, bunt: 'failed' } : pa) }
  expect(calculateMatchBattingStats({ details })).toMatchObject({
    pa: 4, ab: 4, h: 1, singles: 1, tb: 1, so: 3, swingingStrikeouts: 1, lookingStrikeouts: 1,
    unclassifiedStrikeouts: 1, sh: 0, obp: .25,
  })
})

test('下書きと結果の欠落を除外し、記録ゼロと未記録を区別する', () => {
  const input = match('single', undefined)
  const details: MatchDetails = { ...input.details, plateAppearances: [
    ...input.details.plateAppearances, { id: 'draft', order: 3, status: 'draft', result: 'groundOut' },
  ] }
  expect(calculateMatchBattingStats({ details })).toMatchObject({ pa: 1, ab: 1, h: 1, so: 0 })
  expect(calculateMatchBattingStats(match(undefined))).toMatchObject({ pa: null, ab: null, h: null, rbi: null })
  expect(calculateMatchBattingStats({})).toEqual(calculateMatchBattingStats(match()))
})

test('集計元ごとに片方だけ使い、簡易集計で不足する項目を推測しない', () => {
  const details = { ...match('homeRun').details, summary: { batting: { appearances: 0, hits: 0 } } }
  expect(calculateMatchBattingStats({ details })).toMatchObject({ pa: 1, h: 1, homeRuns: 1 })
  const source = { ...details.source, batting: 'summary' as const }
  expect(calculateMatchBattingStats({ details: { ...details, source } })).toMatchObject({
    pa: 0, h: 0, homeRuns: null, ab: null, avg: null, obp: null, slg: null, ops: null,
  })
  expect(calculateMatchBattingStats({ details: { ...details, source, summary: { batting: { appearances: 2 } } } }))
    .toMatchObject({ pa: 2, h: null, rbi: null })
})

test('分母0を未算出として扱い、算出可能な0は保持する', () => {
  expect(calculateMatchBattingStats(match('sacrificeBunt'))).toMatchObject({
    pa: 1, ab: 0, avg: null, obp: null, slg: null, ops: null,
  })
  expect(calculateMatchBattingStats(match('sacrificeFly'))).toMatchObject({
    ab: 0, avg: null, obp: 0, slg: null, ops: null,
  })
  expect(calculateMatchBattingStats(match('groundOut'))).toMatchObject({ avg: 0, obp: 0, slg: 0, ops: 0 })
})

test('複数試合の実数から率を再計算し、全試合の値が揃った項目だけ合算する', () => {
  const first = calculateMatchBattingStats(match('single'))
  const second = calculateMatchBattingStats(match('groundOut', 'groundOut', 'groundOut', 'walk'))
  expect(aggregateBattingStats([first, second])).toMatchObject({
    pa: 5, ab: 4, h: 1, tb: 1, avg: .25, obp: .4, slg: .25, ops: .65, rbi: null,
  })
  const details = emptyMatchDetails()
  const summary = calculateMatchBattingStats({ details: {
    ...details, source: { ...details.source, batting: 'summary' }, summary: { batting: { appearances: 3, hits: 1 } },
  } })
  expect(aggregateBattingStats([first, summary])).toMatchObject({ pa: 4, h: 2, ab: null, avg: null, ops: null })
  expect(aggregateBattingStats([first, calculateMatchBattingStats({})])).toMatchObject({ pa: null, h: null })
  expect(aggregateBattingStats([])).toEqual(calculateMatchBattingStats({}))
})
