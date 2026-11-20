import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { BallFieldDrawing } from './BattingDiagrams'
import { resultLabels } from './BattingEditor'
import { aggregateBattingStats, calculateMatchBattingStats, type BattingStats } from './battingStats'
import type { BattingGame } from './recordHistory'

const rates = [['avg', '打率', 'AVG'], ['obp', '出塁率', 'OBP'], ['slg', '長打率', 'SLG'], ['ops', 'OPS', '']] as const
const counts = [
  ['pa', '打席数'], ['ab', '打数'], ['h', '安打'], ['tb', '塁打数'], ['rbi', '打点'],
  ['singles', '単打'], ['doubles', '二塁打'], ['triples', '三塁打'], ['homeRuns', '本塁打'],
  ['bb', '四球'], ['hbp', '死球'], ['so', '三振'], ['swingingStrikeouts', '空振り三振'],
  ['lookingStrikeouts', '見逃し三振'], ['unclassifiedStrikeouts', '分類なし三振'],
  ['sh', '犠打'], ['sf', '犠飛'], ['reachedOnError', '失策出塁'], ['fieldersChoice', '野手選択'],
] as const

function formatRate(value: number | null) {
  return value === null ? '—' : value.toFixed(3).replace(/^0\./, '.')
}

export function HomeBattingSummary({ games, onOpen }: { games: readonly BattingGame[]; onOpen: () => void }) {
  const stats = aggregateBattingStats(games.map(calculateMatchBattingStats))
  const values = [formatRate(stats.avg), formatRate(stats.obp), stats.h ?? '—', stats.pa ?? '—']
  return <section className="club-panel home-batting-summary" aria-labelledby="home-batting-title">
    <header>
      <div><h2 id="home-batting-title">打撃成績</h2><p className="hint">通算 · {games.length}試合</p></div>
      <button type="button" id="home-batting-open" className="action" onClick={onOpen}>
        詳細を見る<ChevronRight size={16} aria-hidden="true" />
      </button>
    </header>
    <dl>
      {['打率 AVG', '出塁率 OBP', '安打 H', '打席 PA'].map((label, index) =>
        <div key={label}><dt>{label}</dt><dd>{values[index]}</dd></div>)}
    </dl>
    {games.length === 0 ? <p className="hint">試合の記録はまだありません。</p>
      : values.includes('—') && <p className="hint">記録が揃わない項目は「—」です。</p>}
  </section>
}

function StatsCard({ stats }: { stats: BattingStats }) {
  return <>
    <dl className="batting-stat-rates">
      {rates.map(([key, label, abbr]) => <div key={key}><dt>{label}{abbr && <small>{abbr}</small>}</dt>
        <dd>{formatRate(stats[key])}</dd></div>)}
    </dl>
    <h3>打撃の内訳</h3>
    <dl className="batting-stat-counts">
      {counts.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{stats[key] ?? '—'}</dd></div>)}
    </dl>
    <details className="batting-stat-help">
      <summary>「—」になる理由</summary>
      <ul>
        <li>打数などの記録がない、または率の分母が0の場合は「—」です。算出できた0は「0」または「.000」と表示します。</li>
        <li>簡易集計から利用できるのは、入力済みの打席数・安打数です。確定済みの詳細打席と重ねて数えません。</li>
        <li>打点は現在の記録項目から確定できないため「—」です。</li>
      </ul>
    </details>
  </>
}

function HitLocations({ game }: { game: BattingGame }) {
  const [selected, setSelected] = useState<string>()
  const hits = [...(game.details?.plateAppearances ?? [])]
    .sort((a, b) => a.order - b.order)
    .flatMap(row => row.status === 'complete' && row.fieldPoint && row.result
      ? [{ id: row.id, order: row.order, point: row.fieldPoint, result: resultLabels[row.result] }] : [])
  const groups = new Map<string, typeof hits>()
  for (const hit of hits) {
    const key = JSON.stringify([hit.point.x, hit.point.y])
    const group = groups.get(key)
    if (group) group.push(hit)
    else groups.set(key, [hit])
  }
  const all = [...groups.values()]
  const active = all.find(group => group.some(hit => hit.id === selected))
  const ordered = active ? [...all.filter(group => group !== active), active] : all
  return <section className="batting-stat-field">
    <h3>記録した打球位置</h3>
    {game.details?.source.batting === 'summary' && <p className="hint">球場図には確定した詳細記録の位置を表示します。</p>}
    {hits.length === 0 ? <p className="hint">位置を記録した確定打席はありません。</p> : <>
      <div className="ball-field batting-stat-map">
        <BallFieldDrawing>
          {ordered.map(group => {
            const { x, y } = group[0].point
            const current = group.find(hit => hit.id === selected)
            const label = current?.order ?? (group.length > 1 ? '+' + group.length : group[0].order)
            return <g key={group[0].id} data-ball-marker="">
              <circle cx={x * 300} cy={y * 260} r={current ? 13 : 11} fill={current ? '#fff2ac' : '#ffce68'} stroke="#13263b" strokeWidth="2" />
              <text x={x * 300} y={y * 260} dominantBaseline="central" textAnchor="middle" fill="#142238"
                fontSize="10" fontWeight="700">{label}</text>
            </g>
          })}
        </BallFieldDrawing>
      </div>
      <p className="hint">位置は目安です。番号は打席順、＋数字は同じ位置の打球数です。</p>
      <ul className="batting-stat-hits">
        {hits.map(hit => <li key={hit.id}><button type="button" className="action"
          aria-pressed={selected === hit.id} onClick={() => setSelected(hit.id)}>
          第{hit.order}打席 · {hit.result}
        </button></li>)}
      </ul>
    </>}
  </section>
}

export function BattingStatsView({ games, game, onClose, backLabel = '練習履歴へ戻る' }: {
  games: readonly BattingGame[]; game?: BattingGame; onClose: () => void; backLabel?: string
}) {
  const rows = game ? [game] : games
  const summaries = rows.map(calculateMatchBattingStats)
  const stats = game ? summaries[0] : aggregateBattingStats(summaries)
  const dates = rows.map(row => row.date).sort()
  const recorded = summaries.filter(summary => summary.pa !== null || summary.h !== null).length
  return <section className="card batting-stats">
    <button type="button" className="action" onClick={onClose}>{backLabel}</button>
    <h2>{game ? '試合の打撃成績' : '通算打撃成績'}</h2>
    {game ? <p className="hint">{game.date}{game.details?.opponent && ' · ' + game.details.opponent}
      {game.details && (game.details.source.batting === 'summary' ? ' · 簡易集計' : ' · 詳細記録')}</p>
      : <p className="hint">対象 {rows.length}試合 · 打席数または安打数の記録あり {recorded}試合<br />
        {dates.length ? `対象期間 ${dates[0]} ～ ${dates.at(-1)}` : '対象期間 —'}</p>}
    {!game && <p className="hint">対象試合すべてで値が揃った項目を合算します。欠けている項目の通算値と、必要な値が揃わない率は「—」です。</p>}
    {recorded === 0 && <p className="hint">集計できる打撃記録がありません。</p>}
    <StatsCard stats={stats} />
    {game && <HitLocations key={game.id} game={game} />}
  </section>
}
