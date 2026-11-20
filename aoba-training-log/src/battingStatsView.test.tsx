import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test, vi } from 'vitest'
import { BattingStatsView, HomeBattingSummary } from './BattingStatsView'
import { battingGames, recordHistory, type BattingGame } from './recordHistory'
import { emptyMatchDetails } from './matchDetails'
import { initialData } from './initialData'
import type { TrainingRecord } from './model'

const point = { x: .3, y: .45 }
const game: BattingGame = {
  id: 'first', date: '2026-11-18', details: {
    ...emptyMatchDetails(),
    plateAppearances: [
      { id: 'pa1', order: 1, status: 'complete', result: 'double', fieldPoint: point },
      { id: 'pa2', order: 2, status: 'complete', result: 'groundOut', fieldPoint: point },
      { id: 'pa3', order: 3, status: 'complete', result: 'walk' },
      { id: 'pa4', order: 4, status: 'draft', fieldPoint: { x: .9, y: .9 } },
    ],
  },
}
const render = (games: BattingGame[], selected?: BattingGame) =>
  renderToStaticMarkup(<BattingStatsView games={games} game={selected} onClose={vi.fn()} />)

test('試合成績の率、記録された0、打点の未記録を表示する', () => {
  const html = render([game], game)
  expect(html).toContain('試合の打撃成績')
  expect(html).toContain('AVG</small></dt><dd>.500')
  expect(html).toContain('OBP</small></dt><dd>.667')
  expect(html).toContain('SLG</small></dt><dd>1.000')
  expect(html).toContain('OPS</dt><dd>1.667')
  expect(html).toContain('本塁打</dt><dd>0')
  expect(html).toContain('打点</dt><dd>—')
  expect(html).toContain('「—」になる理由')
})

test('球場図は確定打席の記録位置だけを表示し、重複座標と個別結果を示す', () => {
  const html = render([game], game)
  expect(html.match(/data-ball-marker=/g)).toHaveLength(1)
  expect(html).toContain('>+2</text>')
  expect(html).toContain('第1打席 · 二塁打')
  expect(html).toContain('第2打席 · ゴロアウト')
  expect(html).not.toContain('第3打席')
  expect(html).not.toContain('第4打席')
})

test('通算は既存エンジンで再計算し、対象試合数と日付範囲を表示する', () => {
  const next: BattingGame = { id: 'next', date: '2026-11-20', details: {
    ...emptyMatchDetails(), plateAppearances: [{ id: 'pa5', order: 1, status: 'complete', result: 'single' }],
  } }
  const html = render([next, game])
  expect(html).toContain('通算打撃成績')
  expect(html).toContain('対象 2試合 · 打席数または安打数の記録あり 2試合')
  expect(html).toContain('2026-11-18 ～ 2026-11-20')
  expect(html).toContain('AVG</small></dt><dd>.667')
  expect(html).not.toContain('data-ball-marker')
})

test('簡易集計を尊重し、不足値のある試合を含む通算を確定値として表示しない', () => {
  const simple: BattingGame = { ...game, details: {
    ...game.details!, source: { batting: 'summary', baserunning: 'events', fielding: 'events' },
    summary: { batting: { appearances: 0, hits: 0 } },
  } }
  const simpleHtml = render([simple], simple)
  expect(simpleHtml).toContain('簡易集計')
  expect(simpleHtml).toContain('打席数</dt><dd>0')
  expect(simpleHtml).toContain('AVG</small></dt><dd>—')
  const missing: BattingGame = { id: 'missing', date: '2026-11-20' }
  expect(render([game, missing])).toContain('対象 2試合 · 打席数または安打数の記録あり 1試合')
  expect(render([game, missing])).toContain('安打</dt><dd>—')
  expect(render([missing], missing)).toContain('集計できる打撃記録がありません。')
})

const renderHome = (games: BattingGame[]) =>
  renderToStaticMarkup(<HomeBattingSummary games={games} onOpen={vi.fn()} />)

test('ホームに通算4項目と詳細ボタンを表示し、詳細画面と同じ率・実数を示す', () => {
  const html = renderHome([game])
  expect(html).toContain('通算 · 1試合')
  expect(html).toContain('打率 AVG</dt><dd>.500')
  expect(html).toContain('出塁率 OBP</dt><dd>.667')
  expect(html).toContain('安打 H</dt><dd>1')
  expect(html).toContain('打席 PA</dt><dd>3')
  expect(html).toContain('詳細を見る')
  expect(html).not.toContain('長打率')
  expect(render([game])).toContain('AVG</small></dt><dd>.500')
})

test('ホームは試合なし、算出可能なゼロ、簡易集計の未算出を区別する', () => {
  expect(renderHome([])).toContain('試合の記録はまだありません。')
  const details = { ...emptyMatchDetails(), plateAppearances: [
    { id: 'out', status: 'complete', result: 'groundOut', order: 1 } as const,
  ] }
  expect(renderHome([{ ...game, details }])).toContain('打率 AVG</dt><dd>.000')
  const simple = { ...game, details: { ...details, source: { ...details.source, batting: 'summary' as const },
    summary: { batting: { appearances: 2, hits: 0 } } } }
  expect(renderHome([simple])).toContain('打率 AVG</dt><dd>—')
  expect(renderHome([simple])).toContain('安打 H</dt><dd>0')
  const missing: BattingGame = { id: 'missing', date: '2026-11-20' }
  expect(renderHome([simple, missing])).toContain('安打 H</dt><dd>—')
  expect(renderHome([simple, missing])).toContain('記録が揃わない項目')
})

test('ホームと履歴の対象は共通で、紐づく試合を重複させず従来の試合も含む', () => {
  const timestamp = '2026-11-18T00:00:00.000Z'
  const record: TrainingRecord = { id: 'linked', date: game.date, kind: '試合', menuId: 'swing', menuName: '素振り',
    amount: 1, unit: '回', category: '打撃', note: '', createdAt: timestamp, updatedAt: timestamp }
  const games = battingGames(recordHistory({ ...initialData(),
    records: [record, { ...record, id: 'legacy' }, { ...record, id: 'practice', kind: '自主練' }],
    matches: [{ ...game, recordId: record.id, good: '', improve: '', createdAt: timestamp, updatedAt: timestamp }],
  }))
  expect(games).toHaveLength(2)
  expect(games.find(row => row.id === 'record:linked')?.details).toEqual(game.details)
  expect(games.find(row => row.id === 'record:legacy')?.details).toBeUndefined()
  expect(renderHome(games)).toContain('安打 H</dt><dd>—')
})
