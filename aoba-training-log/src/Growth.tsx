import { ChartNoAxesColumnIncreasing } from 'lucide-react'
import { ScreenTitle } from './ScreenTitle'
import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { localDate, shiftDate } from './dates'
import { categories } from './initialData'
import type { TrainingData } from './model'
import { currentGoal, weeklyStats } from './training'

const short = (date: string) => date.slice(5).replace('-', '/')
type Datum = { label: string; value: number | null }

function Chart({ data, unit, line = false }: { data: Datum[]; unit: string; line?: boolean }) {
  const axes = <>
    <CartesianGrid vertical={false} stroke="#e0e7e3" />
    <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#304858' }} />
    <YAxis width={42} tick={{ fontSize: 10, fill: '#304858' }} allowDecimals={unit === '分'} />
    <Tooltip formatter={value => [String(value) + unit, '実績']} />
  </>
  return <>
    <div className="chart" aria-label={'単位 ' + unit}>
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 280, height: 190 }}>
        {line
          ? <LineChart data={data} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>{axes}
              <Line type="linear" dataKey="value" stroke="#194d40" strokeWidth={2} isAnimationActive={false} />
            </LineChart>
          : <BarChart data={data} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>{axes}
              <Bar dataKey="value" fill="#194d40" radius={[4, 4, 0, 0]} isAnimationActive={false} />
            </BarChart>}
      </ResponsiveContainer>
    </div>
    <details className="chart-data"><summary>数値を見る</summary>
      <ul className="compact-list">{data.map(item => <li key={item.label}>{item.label} · {item.value === null ? '未設定' : item.value + unit}</li>)}</ul>
    </details>
  </>
}

export default function Growth({ data }: { data: TrainingData }) {
  const today = new Date()
  const todayKey = localDate(today)
  const records = data.records.filter(record => record.date <= todayKey)
  const weeks = Array.from({ length: 6 }, (_, index) => {
    const date = shiftDate(today, (index - 5) * 7)
    const stats = weeklyStats(data, date)
    // Completed weeks use the last goal set by the Sunday of that week.
    const cutoff = stats.end > todayKey ? todayKey : stats.end
    const goal = currentGoal(data.goals, 'weekly', cutoff)?.days
    return { ...stats, label: short(stats.start), rate: goal ? Math.round(stats.days / goal * 100) : null }
  })
  const monthData = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(today.getFullYear(), today.getMonth() + index - 5, 1)
    const month = localDate(date).slice(0, 7)
    return { label: month.slice(5) + '月', value: new Set(records.filter(record => record.date.startsWith(month)).map(record => record.date)).size, month }
  })
  const start = weeks[0].start
  const recent = records.filter(record => record.date >= start)
  const pairs = new Map(recent.map(record => [JSON.stringify([record.menuId, record.unit]), record]))
  const [pick, setPick] = useState('')
  const choice = pairs.has(pick) ? pick : pairs.keys().next().value
  const chosen = choice ? pairs.get(choice) : undefined
  const quantities = chosen ? weeks.map(week => ({
    label: week.label,
    value: recent.filter(record => record.menuId === chosen.menuId && record.unit === chosen.unit &&
      record.date >= week.start && record.date <= week.end).reduce((sum, record) => sum + record.amount, 0),
  })) : []
  const categoryData = categories.map(category => ({ label: category, value: recent.filter(record => record.category === category).length }))
  const skill = currentGoal(data.goals, 'skill', todayKey)?.text
  const reflections = [...data.reflections].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3)

  return <>
    <ScreenTitle title="成長ダッシュボード" icon={ChartNoAxesColumnIncreasing} />
    {records.length === 0 && <section className="card"><p className="empty">練習を記録すると、ここに活動の推移が表示されます。</p></section>}
    {records.length > 0 && <>
      <section className="card">
        <h2>週間練習日数</h2><p className="hint">{start} 〜 {todayKey} · 月〜日 · 日数</p>
        <Chart data={weeks.map(week => ({ label: week.label, value: week.days }))} unit="日" />
        <h2 className="section-heading">月間練習日数</h2><p className="hint">{monthData[0].month} 〜 {monthData[5].month} · 日数</p>
        <Chart data={monthData} unit="日" />
      </section>
      <section className="card">
        <h2>メニュー別実施量</h2>
        <p className="hint">{start} 〜 {todayKey} · 週ごとの合計</p>
        {chosen ? <>
          <div className="fields editor"><label>メニューと単位<select value={choice} onChange={event => setPick(event.target.value)}>
            {[...pairs].map(([key, record]) => <option key={key} value={key}>{record.menuName}（{record.unit}）</option>)}
          </select></label></div>
          <Chart data={quantities} unit={chosen.unit} line />
        </> : <p className="empty">この期間の練習記録はありません。</p>}
      </section>
      <section className="card">
        <h2>カテゴリ別練習状況</h2>
        <p className="hint">{start} 〜 {todayKey} · カテゴリ別の記録件数</p>
        {recent.length ? <Chart data={categoryData} unit="件" /> : <p className="empty">この期間の練習記録はありません。</p>}
      </section>
    </>}
    <section className="card">
      <h2>週間目標の達成状況</h2>
      <p className="hint">{start} 〜 {todayKey} · 達成率（%）</p>
      {weeks.some(week => week.rate !== null)
        ? <Chart data={weeks.map(week => ({ label: week.label, value: week.rate }))} unit="%" line />
        : <p className="empty">この期間の週間目標は未設定です。</p>}
    </section>
    <section className="card">
      <h2>技術目標と振り返り</h2>
      <p className="entry-note">{skill || '技術目標は未設定です。'}</p>
      <ul className="entries">{reflections.map(item => <li key={item.period + item.date}>
        <p className="hint">{item.date} · {item.period === 'week' ? '週次' : '日次'}</p>
        {[item.success, item.challenge, item.next].filter(Boolean).map((text, index) => <p className="entry-note" key={index}>{text}</p>)}
      </li>)}</ul>
    </section>
  </>
}


