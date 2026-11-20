import { positionLabels } from './BattingEditor'
import { formatRate } from './BattingStatsView'
import { fieldingSkills } from './FieldingEditor'
import { positions } from './matchDetails'
import type { BattingGame } from './recordHistory'
import {
  aggregateBaserunningStats, aggregateFieldingStats, calculateMatchBaserunningStats, calculateMatchFieldingStats,
  type FieldingLine, type FieldingStats,
} from './runningFieldingStats'

export type RunningFieldingKind = 'running' | 'fielding'
const fieldingCounts = [
  ['po', '刺殺 PO'], ['a', '補殺 A'], ['e', '失策 E'], ['tc', '守備機会 TC'],
] as const

function CountCards({ rows }: { rows: readonly (readonly [string, number | string | null])[] }) {
  return <dl className="batting-stat-counts">
    {rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value ?? '—'}</dd></div>)}
  </dl>
}

function RateCard({ label, value }: { label: string; value: number | null }) {
  return <dl className="batting-stat-rates"><div><dt>{label}</dt><dd>{formatRate(value)}</dd></div></dl>
}

function fieldingRows(line: FieldingLine) {
  return fieldingCounts.map(([key, label]) => [label, line[key]] as const)
}

function FieldingBreakdown({ stats, games }: { stats: FieldingStats; games: readonly BattingGame[] }) {
  const observed = games.flatMap(game => (game.details?.fielding ?? [])
    .filter(play => play.status === 'complete' && play.development?.length)
    .map(play => ({ game, play })))
  return <>
    <h3>公式成績</h3>
    <RateCard label="守備率 FPCT" value={stats.fpct} />
    <CountCards rows={fieldingRows(stats)} />
    <details className="batting-stat-help">
      <summary>守備位置別成績</summary>
      {!stats.hasPositionBreakdown && <p className="hint">位置別の記録が揃わない成績は「—」です。</p>}
      {positions.map(position => {
        const line = stats.byPosition[position]
        return line && <section key={position}>
          <h4>{positionLabels[position]}</h4>
          <CountCards rows={[...fieldingRows(line), ['守備率 FPCT', formatRate(line.fpct)]]} />
        </section>
      })}
      {!Object.keys(stats.byPosition).length && <p>位置別成績 —</p>}
    </details>
    <section className="fielding-observations">
      <h3>育成観察</h3>
      <CountCards rows={[[ '観察件数', stats.observations ]]} />
      {observed.length ? <details className="batting-stat-help">
        <summary>保存済みの観察を見る</summary>
        <ul className="entries">{observed.map(({ game, play }) => <li key={game.id + ':' + play.id}>
          <p className="hint">{game.date} · 第{play.order}プレー{play.position && ' · ' + positionLabels[play.position]}</p>
          {play.development?.map(({ skill, note }, index) => <p className="entry-note" key={index}>
            <strong>{fieldingSkills.find(([key]) => key === skill)?.[1]}</strong> {note}
          </p>)}
        </li>)}</ul>
      </details> : <p className="hint">保存済みの確定プレーに観察はありません。</p>}
    </section>
  </>
}

export function RunningFieldingStatsView({ kind, games, game, onClose }: {
  kind: RunningFieldingKind; games: readonly BattingGame[]; game?: BattingGame; onClose: () => void
}) {
  const rows = game ? [game] : games
  const running = kind === 'running'
  const runningLines = running ? rows.map(calculateMatchBaserunningStats) : []
  const fieldingLines = running ? [] : rows.map(calculateMatchFieldingStats)
  const recorded = running
    ? runningLines.filter(row => [row.sb, row.cs, row.r, row.otherOuts].some(value => value !== null)).length
    : fieldingLines.filter(row => [row.po, row.a, row.e].some(value => value !== null)).length
  const dates = rows.map(row => row.date).sort()
  const run = game ? runningLines[0] : aggregateBaserunningStats(runningLines)
  const field = game ? fieldingLines[0] : aggregateFieldingStats(fieldingLines)
  return <section className="card batting-stats running-fielding-stats">
    <button type="button" className="action" onClick={onClose}>練習履歴へ戻る</button>
    <h2>{game ? '試合の' : '通算'}{running ? '走塁成績' : '守備成績'}</h2>
    <p className="hint">対象 {rows.length}試合 · 公式成績の記録あり {recorded}試合<br />
      {game ? game.date : dates.length ? `対象期間 ${dates[0]} ～ ${dates.at(-1)}` : '対象期間 —'}</p>
    {!game && <p className="hint">対象試合すべてで値が揃った項目を合算します。欠けている項目の通算値と必要な値が揃わない率は「—」です。</p>}
    {running ? <>
      <RateCard label="盗塁成功率" value={run.stealRate} />
      <CountCards rows={[[ '盗塁成功 SB', run.sb ], [ '盗塁失敗 CS', run.cs ], [ '得点 R', run.r ], [ 'その他の走塁アウト', run.otherOuts ]]} />
    </> : <FieldingBreakdown stats={field} games={rows} />}
    <details className="batting-stat-help">
      <summary>「—」になる理由</summary>
      <p>未記録の項目や分母が0の率は「—」です。集計できた0は「0」または「.000」と表示します。</p>
      {running ? <p>盗塁成功率には成功と失敗の両方の記録が必要です。簡易記録のアウトは盗塁失敗を含むか未確定のため、その他の走塁アウトには使用しません。</p>
        : <p>簡易集計に守備位置の内訳はありません。育成観察は刺殺・補殺・失策や守備率に加えません。</p>}
    </details>
  </section>
}
