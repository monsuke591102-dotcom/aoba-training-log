import { useEffect, useRef, useState, type RefObject } from 'react'
import { CalendarDays, CalendarPlus, ChevronRight, Flag, NotebookPen } from 'lucide-react'
import { Badges, type Badge } from './Badges'
import { Baseball, Equipment, Laurel, StadiumLights } from './BaseballArt'
import { ActivityIcon } from './Calendar'
import { fromLocalDate, localDate, recentDays } from './dates'
import { PlanDialog } from './PlanDialog'
import { MonthlyProgress } from './MonthlyProgress'
import { QuickRecords } from './QuickRecords'
import { HomeBattingSummary } from './BattingStatsView'
import type { BattingGame } from './recordHistory'
import { plannedMenuIds } from './routines'
import type { Commit } from './recordFeedback'
import type { Category, DayKind, LocalDate, TrainingData, Unit } from './model'
import { dailyStats, managementProgress, periodAchievement } from './progress'
import { currentGoal, weeklyStats } from './training'
import { useLocalDay } from './useLocalDay'

const dateLabel = new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })
const weekday = new Intl.DateTimeFormat('ja-JP', { weekday: 'short' })
const shortDate = new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric' })
const quantity = new Intl.NumberFormat('ja-JP', { maximumSignificantDigits: 12 })
const showQuantity = (amount: number, unit: string) => quantity.format(amount) + unit
type Progress = ReturnType<typeof managementProgress>

function Meter({ value, max, label, className = '' }: { value: number; max: number; label: string; className?: string }) {
  return <progress className={'meter ' + className} value={Math.min(value, max)} max={max} aria-label={label} />
}

const gaugePeriods = ['day', 'week', 'month'] as const
const gaugeLabels = { day: '日次', week: '週間', month: '月間' }
type GaugePeriod = typeof gaugePeriods[number]

function Gauge({ data, date, dailyRate, pending }: {
  data: TrainingData; date: LocalDate; dailyRate: number | null; pending: RefObject<boolean>
}) {
  const [period, setPeriod] = useState<GaugePeriod>('day')
  const next = gaugePeriods[(gaugePeriods.indexOf(period) + 1) % gaugePeriods.length]
  const stats = period === 'day' ? { start: date, end: date, rate: dailyRate } : periodAchievement(data, period, date)
  const rate = stats.rate
  const label = gaugeLabels[period] + '達成率'
  const start = shortDate.format(fromLocalDate(stats.start))
  const end = shortDate.format(fromLocalDate(stats.end))
  const range = stats.start === stats.end ? start : start + '〜' + end
  const summary = `${label} ${range} ${rate === null ? '集計対象なし' : rate + '%'}`
  const fill = useRef<SVGCircleElement>(null)
  useEffect(() => {
    if (!pending.current) return
    pending.current = false
    if (period !== 'day' || rate === null || !fill.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const animation = fill.current.animate([
      { strokeDasharray: '0 100' },
      { strokeDasharray: rate + ' 100' },
    ], { duration: 520, easing: 'ease-out' })
    return () => animation.cancel()
  }, [pending, period, rate])
  return <div className="gauge">
    <button type="button" className="gauge-toggle" aria-label={summary + '、' + gaugeLabels[next] + 'に切り替える'}
      onClick={() => setPeriod(next)}>
    <svg viewBox="0 0 140 140" aria-hidden="true">
      <defs>
        <linearGradient id="ring-metal" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#effdff" /><stop offset=".19" stopColor="#54d1ff" />
          <stop offset=".44" stopColor="#143e65" /><stop offset=".7" stopColor="#255673" /><stop offset="1" stopColor="#8ae8ff" />
        </linearGradient>
        <linearGradient id="ring-progress" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#fff799" /><stop offset=".29" stopColor="#ffe029" />
          <stop offset=".64" stopColor="#5ef22e" /><stop offset="1" stopColor="#02cdb3" />
        </linearGradient>
      </defs>
      <circle cx="70" cy="70" r="67" className="gauge-ticks" pathLength="100" strokeDasharray=".55 2.575" />
      <circle cx="70" cy="70" r="62" className="gauge-bezel" stroke="url(#ring-metal)" />
      <circle cx="70" cy="70" r="56" className="gauge-track" />
      {rate !== null && rate > 0 && <circle ref={fill} cx="70" cy="70" r="56" pathLength="100" className="gauge-fill" stroke="url(#ring-progress)"
        strokeDasharray={rate + ' 100'} transform="rotate(-90 70 70)" />}
      <circle cx="70" cy="70" r="49" className="gauge-inner" stroke="url(#ring-metal)" />
    </svg>
    <span className="gauge-text" aria-hidden="true">
      <strong>{rate === null ? '—' : <>{rate}<small>%</small></>}</strong>
      <span>{label}</span>
      <small>{period === 'day' ? (rate === null ? '集計対象なし' : rate === 100 ? '目標クリア' : range) : range}</small>
    </span>
    </button>
    <span className="gauge-announcement" role="status">{summary}</span>
  </div>
}

function Status({ progress }: { progress: Progress }) {
  return <section className="status-strip" aria-label="プレイヤーステータス">
    <div className="status-line">
      <div className="level-mark">
        <Laurel />
        <svg className="level-shield" viewBox="0 0 90 88" aria-hidden="true">
          <defs>
            <linearGradient id="shield-gold" x2=".3" y2="1">
              <stop stopColor="#fff4aa" /><stop offset=".32" stopColor="#dfa132" />
              <stop offset=".56" stopColor="#fff295" /><stop offset="1" stopColor="#a95110" />
            </linearGradient>
            <linearGradient id="shield-blue" x2="1" y2="1">
              <stop stopColor="#1c5085" /><stop offset=".56" stopColor="#0a284b" /><stop offset="1" stopColor="#040e24" />
            </linearGradient>
          </defs>
          <path d="M45 4 78 11v30c0 21-13 34-33 43C25 75 12 62 12 41V11Z" fill="url(#shield-gold)" />
          <path d="M45 10 73 16v25c0 17-11 29-28 37-17-8-28-20-28-37V16Z" fill="url(#shield-blue)" stroke="#936322" />
          <path d="M18 17 45 11l26 6M19 42c0 17 10 27 26 34" fill="none" stroke="#e6dca9" opacity=".62" />
          <path d="m45 66 2 4 5 .6-3.5 3.2.9 4.2-4.4-2.2-4.3 2.2.8-4.2-3.4-3.2 5-.6Z" fill="#ffd976" />
        </svg>
        <strong aria-label={'レベル ' + progress.level}><small>Lv.</small> {progress.level}</strong>
      </div>
      <div className="status-stats">
        <div className="score-total"><span>累計ポイント</span><strong>{progress.points.toLocaleString('ja-JP')} <small>pt</small></strong></div>
        <Meter value={progress.points - progress.start} max={progress.end - progress.start} label="次のレベルへの進捗" className="level-meter" />
        <p>次のレベルまで <strong>{progress.remaining.toLocaleString('ja-JP')} pt</strong></p>
      </div>
    </div>
    <div className="status-foot">
      <details className="points-help">
        <summary>ポイントの仕組み</summary>
        <p>ポイントとレベルは練習を管理する行動の目安です。選手の技術力の評価とは別の指標です。</p>
        <ul className="compact-list">
          {['その日の初回練習記録 10pt', '日次振り返り 5pt', '週次振り返り 20pt', '週間目標達成 30pt', '休養日記録 5pt'].map(text => <li key={text}>{text}</li>)}
        </ul>
      </details>
    </div>
  </section>
}

type MenuRow = { name: string; unit: Unit; category: Category; target?: number; amount?: number; skipped?: boolean }

export function Home({ data, commit, onPlan, onReflection, onBadge, pendingGauge, batting }: {
  data: TrainingData; commit: Commit; onPlan: () => void; onReflection: () => void; onBadge: (id: Badge['id']) => void; pendingGauge: RefObject<boolean>
  batting?: { games: readonly BattingGame[]; onOpen: () => void }
}) {
  const [planDate, setPlanDate] = useState<LocalDate>()
  const { date, changed } = useLocalDay()
  const today = fromLocalDate(date)
  const records = data.records.filter(record => record.date === date)
  const plan = data.plans.find(item => item.date === date)
  const plannedMenus = [...plannedMenuIds(data, date, date)]
  const rests = new Set(data.rests.map(item => item.date))
  const week = weeklyStats(data, today)
  const goal = currentGoal(data.goals, 'weekly', date)?.days
  const daily = dailyStats(data, date, date)
  const skips = data.skippedMenus.filter(item => item.date === date)
  const skippedIds = new Set(skips.map(item => item.menuId))
  const recordedIds = new Set(records.map(record => record.menuId))
  const completedCount = [...recordedIds].filter(id => !skippedIds.has(id)).length
  const pendingCount = plannedMenus.filter(id => !recordedIds.has(id) && !skippedIds.has(id)).length
  const progress = managementProgress(data, today)
  const menus = new Map(data.menus.map(menu => [menu.id, menu]))
  const rows = new Map<string, MenuRow>()
  const rowKey = (id: string, unit: Unit) => id + ':' + unit
  for (const entry of daily.entries) {
    const menu = menus.get(entry.id)
    if (menu?.enabled) rows.set(rowKey(entry.id, entry.unit), { ...entry, category: menu.category })
  }
  const recorded = new Map<string, MenuRow>()
  for (const record of records) {
    if (!menus.get(record.menuId)?.enabled) continue
    const key = rowKey(record.menuId, record.unit)
    const previous = recorded.get(key)
    recorded.set(key, {
      name: record.menuName, category: record.category, unit: record.unit, amount: (previous?.amount ?? 0) + record.amount,
      skipped: skippedIds.has(record.menuId),
    })
  }
  for (const [key, item] of recorded) if (!rows.has(key)) rows.set(key, item)
  for (const id of plannedMenus) {
    const menu = menus.get(id)
    if (menu && !rows.has(rowKey(id, menu.unit))) rows.set(rowKey(id, menu.unit), { ...menu, skipped: skippedIds.has(id) })
  }
  const planNames = plannedMenus.flatMap(id => menus.get(id)?.name ?? [])

  return <>
    <div className="arena">
      <StadiumLights />
      <Status progress={progress} />
      <MonthlyProgress data={data} today={date} />
      <section className={'scoreboard' + (daily.rate === 100 ? ' achieved' : '')}>
        <header className="scoreboard-heading">
          <h1>今日のトレーニング</h1>
          <p className="date"><time dateTime={date}>{dateLabel.format(today)}</time></p>
        </header>
        <div className="scoreboard-body">
          <Gauge data={data} date={date} dailyRate={daily.rate} pending={pendingGauge} />
          <div className="score-plan">
            <div><strong>今日の予定</strong>
              <p>{plan ? <><ActivityIcon kind={plan.kind} />{plan.kind}{planNames.length > 0 && ' · ' + planNames.join('、')}</> : '予定区分なし'}
                {rests.has(date) && <span className="score-rest">休養日を記録済み</span>}
              </p>
            </div>
            <button onClick={event => { event.currentTarget.focus({ preventScroll: true }); setPlanDate(date) }} className="score-link">{plan ? '予定を編集' : '予定を入れる'}</button>
          </div>
          {(plan || skips.length > 0) && <button className="score-link" onClick={onPlan}>予定メニュー・見送りを見る</button>}
          <button className="primary score-record" onClick={() => {
            const panel = document.getElementById('home-quick-records')
            panel?.focus({ preventScroll: true })
            panel?.scrollIntoView({ block: 'start' })
          }}><Baseball size={30} />練習を記録する<ChevronRight size={19} aria-hidden="true" /></button>
          <div className="score-brief">
            <p className="score-count">
              <span>実施 <strong>{completedCount}</strong></span>
              <span>未実施 <strong>{pendingCount}</strong></span>
              <span>見送り <strong>{skips.length}</strong></span>
            </p>
            {rows.size > 0 ? <ul className="score-summary">{[...rows].slice(0, 3).map(([key, item]) =>
              <li key={key}><Equipment category={item.category} /><span>{item.name}</span>
                <strong>{item.skipped ? '見送り' : item.amount === undefined ? '—' : showQuantity(item.amount, item.unit)}{item.target !== undefined && <small> / {showQuantity(item.target, item.unit)}</small>}</strong></li>
            )}</ul> : <p className="score-summary-empty">今日の実績は<br />ここに表示されます。</p>}
          </div>
        </div>
      </section>
    </div>

    <div role="status">
      {changed && <p className="hint">日付が変わりました。確定前のクイック入力は取り消され、今日のメニューに切り替わりました。</p>}
    </div>
    <QuickRecords key={date} data={data} commit={commit} date={date} kind={plan && plan.kind !== '休養日' ? plan.kind : '自主練'} />

    <section className="club-panel weekly-panel" aria-labelledby="weekly-title">
      <h2 id="weekly-title"><Flag size={19} aria-hidden="true" />週間目標</h2>
      <div className="weekly-score">
        <p><strong>{week.days}</strong> 日 <span>{goal ? '/ 目標 ' + goal + '日' : '/ 目標未設定'}</span></p>
        {week.rate !== null && <strong className={week.rate >= 100 ? 'success' : undefined}>{week.rate}%</strong>}
      </div>
      {goal ? <Meter value={week.days} max={goal} label={'週間目標 ' + week.rate + '%'} /> : <div className="meter-empty" aria-hidden="true" />}
    </section>

    <section className="club-panel home-activity" aria-labelledby="activity-title">
      <h2 id="activity-title"><CalendarDays size={19} aria-hidden="true" />直近7日間</h2>
      <ul className="activity grid grid-cols-7">{recentDays(today).map(day => {
        const key = localDate(day)
        const kinds = new Set<DayKind>(data.records.filter(record => record.date === key).map(record => record.kind))
        if (rests.has(key)) kinds.add('休養日')
        const scheduled = data.plans.find(item => item.date === key)
        const labels = [...kinds, ...(scheduled ? ['予定 ' + scheduled.kind] : [])]
        return <li key={key}><button type="button" className="activity-edit-day" aria-haspopup="dialog" onClick={event => { event.currentTarget.focus({ preventScroll: true }); setPlanDate(key) }}
          aria-label={dateLabel.format(day) + 'の予定を編集、' + (labels.join('、') || '記録なし')}><time dateTime={key} className={rests.has(key) ? 'rest-day' : kinds.has('試合') ? 'game-day' : kinds.size ? 'recorded' : scheduled ? 'planned-day' : undefined} aria-current={key === date ? 'date' : undefined}>
          <span>{weekday.format(day)}</span><b>{day.getDate()}</b>
          <span className="recent-icons" aria-hidden="true">
            {[...kinds].map(kind => <ActivityIcon key={kind} kind={kind} />)}
            {scheduled && <span className="activity-plan-marker"><CalendarPlus size={11} className="scheduled-icon" /><ActivityIcon kind={scheduled.kind} /></span>}
          </span>
        </time></button></li>
      })}</ul>
      <ul className="calendar-legend">
        {(['自主練', 'チーム練習', '試合', '休養日'] as const).map(kind => <li key={kind}><ActivityIcon kind={kind} />{kind}</li>)}
        <li><CalendarPlus size={15} className="scheduled-icon" aria-hidden="true" />予定</li>
      </ul>
    </section>

    {batting && <HomeBattingSummary games={batting.games} onOpen={batting.onOpen} />}
    <Badges badges={progress.badges} open={onBadge} />

    <section className="club-panel section-toolbar">
      <h2><NotebookPen size={19} aria-hidden="true" />振り返り</h2>
      <button className="action filled" onClick={onReflection}>振り返りを書く</button>
    </section>
    {planDate && <PlanDialog key={planDate} date={planDate} existing={data.plans.find(item => item.date === planDate)}
      commit={commit} close={() => setPlanDate(undefined)} />}
  </>
}








