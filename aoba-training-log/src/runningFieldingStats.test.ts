import { expect, test } from 'vitest'
import { emptyMatchDetails, type BaserunningPlay, type FieldingPlay, type MatchDetails } from './matchDetails'
import { aggregateBaserunningStats, aggregateFieldingStats, calculateMatchBaserunningStats, calculateMatchFieldingStats } from './runningFieldingStats'

const run = (order: number, result: BaserunningPlay['result'], patch: Partial<BaserunningPlay> = {}): BaserunningPlay =>
  ({ id: 'run-' + order, order, from: 'first', status: 'complete', result, ...patch })
const play = (order: number, credits: FieldingPlay['credits'], patch: Partial<FieldingPlay> = {}): FieldingPlay =>
  ({ id: 'field-' + order, order, status: 'complete', position: 'SS', playType: 'grounder', credits, ...patch })
const running = (...baserunning: BaserunningPlay[]) => calculateMatchBaserunningStats({ details: { ...emptyMatchDetails(), baserunning } })
const fielding = (...fielding: FieldingPlay[]) => calculateMatchFieldingStats({ details: { ...emptyMatchDetails(), fielding } })

test('盗塁成功・失敗、本盗、正しい得点、その他の走塁アウトを分ける', () => {
  expect(running(run(1, 'stolenBase', { to: 'second' }), run(2, 'caughtStealing', { to: 'home' }),
    run(3, 'stolenBase', { from: 'third', to: 'home' }), run(4, 'scored', { from: 'third', to: 'home' }),
    run(5, 'out', { to: 'home' }), run(6, 'scored', { to: 'second' }), run(7, 'scored', { to: 'home', status: 'draft' })))
    .toMatchObject({ sb: 2, cs: 1, r: 2, otherOuts: 1, stealRate: 2 / 3 })
})

test('成功または失敗の片側だけでも成功率を算出し、未記録と実数0を区別する', () => {
  expect(running(run(1, 'stolenBase', { to: 'second' }))).toMatchObject({ sb: 1, cs: 0, stealRate: 1 })
  expect(running(run(1, 'caughtStealing'))).toMatchObject({ sb: 0, cs: 1, stealRate: 0 })
  expect(running(run(1, 'advanced', { to: 'second' }))).toMatchObject({ sb: 0, cs: 0, stealRate: null })
  expect(running(run(1, 'stolenBase', { from: 'batter', to: 'second' }))).toMatchObject({ sb: null, cs: null, r: null })
  expect(running(run(1, 'out', { status: 'draft' }))).toMatchObject({ otherOuts: null })
})

test('簡易走塁を優先し、明示された0と欠落を区別する。内訳不明のoutsは流用しない', () => {
  const base = emptyMatchDetails()
  const details: MatchDetails = { ...base, source: { ...base.source, baserunning: 'summary' },
    summary: { baserunning: { steals: 0, caughtStealing: 2, outs: 3 } }, baserunning: [run(1, 'stolenBase', { to: 'second' })] }
  expect(calculateMatchBaserunningStats({ details })).toMatchObject({ sb: 0, cs: 2, r: null, otherOuts: null, stealRate: 0 })
  details.summary = { baserunning: { steals: 1 } }
  const partial = calculateMatchBaserunningStats({ details })
  expect(partial).toMatchObject({ sb: 1, cs: null, stealRate: null })
  expect(aggregateBaserunningStats([running(run(1, 'caughtStealing')), partial]))
    .toMatchObject({ sb: 1, cs: null, stealRate: null })
  details.summary = { baserunning: { steals: 0, caughtStealing: 0 } }
  expect(calculateMatchBaserunningStats({ details }).stealRate).toBeNull()
})

test('走塁の通算は実数から率を再計算し、不足があればその通算値を出さない', () => {
  const first = running(run(1, 'stolenBase', { to: 'second' }), run(2, 'stolenBase', { to: 'third' }))
  const second = running(run(1, 'caughtStealing'))
  expect(aggregateBaserunningStats([first, second])).toMatchObject({ sb: 2, cs: 1, stealRate: 2 / 3 })
  expect(aggregateBaserunningStats([first, running()])).toMatchObject({ sb: null, cs: null, stealRate: null })
  expect(aggregateBaserunningStats([])).toEqual(running())
})

test('公式記録と育成観察を分け、守備率とポジション別の実数を集計する', () => {
  const observation = { skill: 'catching', note: '捕球。刺殺という言葉を含む。' } as const
  const stats = fielding(play(1, ['putout', 'assist'], { development: [observation] }),
    play(2, ['error'], { position: 'RF' }), play(3, [], { development: [observation] }),
    play(4, ['error'], { status: 'draft', development: [observation] }))
  expect(stats).toMatchObject({ po: 1, a: 1, e: 1, tc: 3, fpct: 2 / 3, observations: 2,
    byPosition: { SS: { po: 1, e: 0, fpct: 1 }, RF: { po: 0, e: 1, fpct: 0 } } })
})

test('履歴のみと、公式記録なしの観察、公式記録が未入力のプレーを区別する', () => {
  const detail = { ...emptyMatchDetails(), positionChanges: [{ id: 'pos', order: 1, position: 'SS' as const }] }
  expect(calculateMatchFieldingStats({ details: detail })).toMatchObject({ tc: null, fpct: null, byPosition: {} })
  const development = [{ skill: 'baseCover', note: 'カバーに入った' }] as FieldingPlay['development']
  expect(fielding(play(1, [], { development }))).toMatchObject({ tc: 0, fpct: null, observations: 1 })
  expect(fielding(play(1, undefined, { development }))).toMatchObject({ tc: null, fpct: null, observations: 1 })
})

test('守備の簡易値は詳細加算せず、不足する公式項目・ポジション内訳は補完しない', () => {
  const base = emptyMatchDetails()
  const details: MatchDetails = { ...base, source: { ...base.source, fielding: 'summary' },
    fielding: [play(1, ['putout'], { development: [{ skill: 'throwing', note: '送球' }] })],
    summary: { fielding: { putouts: 0, assists: 2 } } }
  expect(calculateMatchFieldingStats({ details })).toMatchObject({
    po: 0, a: 2, e: null, tc: null, fpct: null, byPosition: {}, observations: 1,
  })
})

test('通算守備率は実数の合算後に算出し、位置内訳のない試合を含む場合は位置別を未算出にする', () => {
  const first = fielding(play(1, ['putout', 'assist']), play(2, ['assist']))
  const second = fielding(play(1, ['error'], { position: 'RF' }))
  expect(aggregateFieldingStats([first, second])).toMatchObject({ po: 1, a: 2, e: 1, tc: 4, fpct: .75,
    byPosition: { SS: { tc: 3, fpct: 1 }, RF: { tc: 1, fpct: 0 } } })
  expect(aggregateFieldingStats([first, fielding()])).toMatchObject({ po: null, fpct: null, byPosition: { SS: { tc: null } } })
  expect(aggregateFieldingStats([])).toEqual(fielding())
})
