import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test, vi } from 'vitest'
import { emptyMatchDetails } from './matchDetails'
import type { BattingGame } from './recordHistory'
import { RunningFieldingStatsView, type RunningFieldingKind } from './RunningFieldingStatsView'

const game: BattingGame = { id: 'game', date: '2026-11-19', details: {
  ...emptyMatchDetails(),
  baserunning: [
    { id: 'r1', order: 1, status: 'complete', from: 'third', to: 'home', result: 'stolenBase' },
    { id: 'r2', order: 2, status: 'complete', from: 'first', result: 'caughtStealing' },
  ],
  fielding: [
    { id: 'f1', order: 1, status: 'complete', position: 'SS', playType: 'grounder', credits: ['assist'],
      development: [{ skill: 'catching', note: '打球を正面で捕球した' }] },
    { id: 'f2', order: 2, status: 'complete', position: 'RF', playType: 'fly', credits: ['error'] },
    { id: 'f3', order: 3, status: 'draft', development: [{ skill: 'other', note: '下書きの観察' }] },
  ],
} }
const view = (kind: RunningFieldingKind, games: BattingGame[], selected?: BattingGame) =>
  renderToStaticMarkup(<RunningFieldingStatsView kind={kind} games={games} game={selected} onClose={vi.fn()} />)

test('試合の盗塁と得点、本盗、記録済みの走塁アウト0を表示する', () => {
  const html = view('running', [game], game)
  expect(html).toContain('試合の走塁成績')
  expect(html).toContain('盗塁成功率</dt><dd>.500')
  expect(html).toContain('盗塁成功 SB</dt><dd>1')
  expect(html).toContain('得点 R</dt><dd>1')
  expect(html).toContain('その他の走塁アウト</dt><dd>0')
})

test('守備率と位置別成績を表示し、公式成績から観察を分ける', () => {
  const html = view('fielding', [game], game)
  expect(html).toContain('試合の守備成績')
  expect(html).toContain('守備率 FPCT</dt><dd>.500')
  expect(html).toContain('守備位置別成績')
  expect(html).toContain('遊撃手')
  expect(html).toContain('右翼手')
  expect(html).toContain('守備率 FPCT</dt><dd>.000')
  expect(html).toContain('観察件数</dt><dd>1')
  expect(html).toContain('保存済みの観察を見る')
  expect(html).toContain('打球を正面で捕球した')
  expect(html).not.toContain('下書きの観察')
})

test('通算は実数で合算し、一部試合不足で位置別や率を未算出にする', () => {
  const second: BattingGame = { id: 'next', date: '2026-11-20', details: {
    ...emptyMatchDetails(), fielding: [
      { id: 'f4', order: 1, status: 'complete', position: 'SS', playType: 'tag', credits: ['putout', 'assist'] },
    ],
    baserunning: [{ id: 'r3', order: 1, status: 'complete', from: 'first', to: 'second', result: 'stolenBase' }],
  } }
  expect(view('fielding', [game, second])).toContain('守備率 FPCT</dt><dd>.750')
  expect(view('running', [game, second])).toContain('盗塁成功率</dt><dd>.667')
  const html = view('fielding', [game, { id: 'missing', date: '2026-11-20' }])
  expect(html).toContain('通算守備成績')
  expect(html).toContain('対象 2試合 · 公式成績の記録あり 1試合')
  expect(html).toContain('2026-11-19 ～ 2026-11-20')
  expect(html).toContain('守備率 FPCT</dt><dd>—')
  expect(html).toContain('位置別の記録が揃わない')
})

test('簡易のアウト内訳と守備位置は推測せず、明示された0を保つ', () => {
  const simple: BattingGame = { ...game, details: { ...game.details!,
    source: { ...game.details!.source, baserunning: 'summary', fielding: 'summary' },
    summary: { baserunning: { steals: 0, caughtStealing: 2, outs: 4 }, fielding: { putouts: 0 } },
  } }
  const running = view('running', [simple], simple)
  expect(running).toContain('盗塁成功率</dt><dd>.000')
  expect(running).toContain('その他の走塁アウト</dt><dd>—')
  const fielding = view('fielding', [simple], simple)
  expect(fielding).toContain('刺殺 PO</dt><dd>0')
  expect(fielding).toContain('位置別成績 —')
  expect(fielding).toContain('「—」になる理由')
})
