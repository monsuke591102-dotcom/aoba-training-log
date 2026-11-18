import { CalendarDays } from 'lucide-react'
import { PlanMenuStatus } from './PlanMenuStatus'
import { ScreenTitle } from './ScreenTitle'
import { useState, type FormEvent } from 'react'
import { ChevronLeft, ChevronRight, Dumbbell, Flag, Moon, Users } from 'lucide-react'
import { deletePlan, savePlan, setRest } from './activities'
import { fromLocalDate, localDate, monthGrid } from './dates'
import type { DayKind, LocalDate, Plan, TrainingData, TrainingKind } from './model'
import { errorMessage, type Commit } from './Records'
import { trainingKinds } from './training'

const activityIcons = { 自主練: Dumbbell, チーム練習: Users, 試合: Flag, 休養日: Moon }
const activityClasses = { 自主練: 'solo', チーム練習: 'team', 試合: 'game', 休養日: 'rest' }
const kinds: DayKind[] = [...trainingKinds, '休養日']
const months = new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long' })
const longDate = new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })

export function ActivityIcon({ kind }: { kind: DayKind }) {
  const Icon = activityIcons[kind]
  return <Icon size={15} aria-hidden="true" className={'activity-icon ' + activityClasses[kind]} />
}

function PlanEditor({ data, date, existing, commit, close }: {
  data: TrainingData; date: LocalDate; existing?: Plan; commit: Commit; close: () => void
}) {
  const [kind, setKind] = useState<DayKind>(existing?.kind ?? '自主練')
  const [menuIds, setMenuIds] = useState(existing && existing.kind !== '休養日' ? existing.menuIds : [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await commit(data => savePlan(data, kind === '休養日' ? { date, kind } : { date, kind, menuIds }))
      close()
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="editor" onSubmit={submit}>
      <fieldset className="fields" disabled={busy}>
        <label>予定の種類<select value={kind} onChange={event => setKind(event.target.value as DayKind)}>
          {kinds.map(kind => <option key={kind}>{kind}</option>)}
        </select></label>
        {kind !== '休養日' && <fieldset className="plan-menus">
          <legend>予定メニュー（任意）</legend>
          {data.menus.filter(menu => menu.enabled || menuIds.includes(menu.id)).map(menu =>
            <label className="checkbox" key={menu.id}>
              <input type="checkbox" checked={menuIds.includes(menu.id)} onChange={event =>
                setMenuIds(event.target.checked ? [...menuIds, menu.id] : menuIds.filter(id => id !== menu.id))} />
              {menu.name}
            </label>,
          )}
        </fieldset>}
        <div className="form-actions">
          <button className="action filled" type="submit">予定を保存</button>
          <button className="action" type="button" onClick={close}>キャンセル</button>
        </div>
      </fieldset>
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  )
}

export function Calendar({ data, commit, onRecord, onReflection, initialDate }: {
  data: TrainingData
  commit: Commit
  initialDate: LocalDate
  onRecord: (date: LocalDate, kind?: TrainingKind, id?: string) => void
  onReflection: (date: LocalDate) => void
}) {
  const [selected, select] = useState(initialDate)
  const [month, setMonth] = useState(() => fromLocalDate(initialDate))
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const today = localDate(new Date())
  const plan = data.plans.find(item => item.date === selected)
  const records = data.records.filter(item => item.date === selected)
  const rest = data.rests.some(item => item.date === selected)
  const skips = data.skippedMenus.filter(item => item.date === selected)
  const plannedIds = plan && plan.kind !== '休養日' ? plan.menuIds : []
  const skippedDates = new Set(data.skippedMenus.map(item => item.date))
  const activity = new Map<LocalDate, Set<DayKind>>()
  for (const item of [...data.records, ...data.plans, ...data.rests.map(item => ({ ...item, kind: '休養日' as const }))]) {
    const day = activity.get(item.date) ?? new Set<DayKind>()
    day.add(item.kind)
    activity.set(item.date, day)
  }

  function choose(date: LocalDate) {
    select(date)
    setMonth(fromLocalDate(date))
    setEditing(false)
    setError('')
  }

  async function change(action: Parameters<Commit>[0]) {
    setBusy(true)
    setError('')
    try {
      await commit(action)
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <ScreenTitle title="練習カレンダー" icon={CalendarDays} />
      <section className="card">
        <div className="month-toolbar">
          <button className="action" aria-label="前の月" disabled={busy} onClick={() => choose(localDate(new Date(month.getFullYear(), month.getMonth() - 1, 1)))}><ChevronLeft size={20} /></button>
          <h2 aria-live="polite">{months.format(month)}</h2>
          <button className="action" aria-label="次の月" disabled={busy} onClick={() => choose(localDate(new Date(month.getFullYear(), month.getMonth() + 1, 1)))}><ChevronRight size={20} /></button>
        </div>
        <div className="calendar-grid">
          {'月火水木金土日'.split('').map(day => <span className="calendar-weekday" key={day}>{day}</span>)}
          {monthGrid(month).map(date => {
            const day = fromLocalDate(date)
            const markers = kinds.filter(kind => activity.get(date)?.has(kind))
            return <button key={date} className={'calendar-day ' + (day.getMonth() !== month.getMonth() ? 'outside' : '')}
              aria-current={date === today ? 'date' : undefined} aria-pressed={date === selected} disabled={busy}
              aria-label={[longDate.format(day), ...markers, ...(skippedDates.has(date) ? ['見送りあり'] : [])].join('、')} onClick={() => choose(date)}>
              {day.getDate()}
              <span className="calendar-markers">{markers.map(kind => <ActivityIcon kind={kind} key={kind} />)}{skippedDates.has(date) && <span className="skip-marker" aria-hidden="true">−</span>}</span>
            </button>
          })}
        </div>
        <ul className="calendar-legend">{kinds.map(kind => <li key={kind}><ActivityIcon kind={kind} />{kind}</li>)}</ul>
      </section>

      <section className="card">
        <h2>{longDate.format(fromLocalDate(selected))}</h2>
        <div className="day-section">
          <h3>練習予定</h3>
          {plan ? <><p className="kind-line"><ActivityIcon kind={plan.kind} />{plan.kind}</p>
            </> : <p className="hint">予定なし</p>}
          {editing ? <PlanEditor key={selected} data={data} date={selected} existing={plan} commit={commit} close={() => setEditing(false)} />
            : <div className="form-actions">
              <button className="action" disabled={busy} onClick={() => setEditing(true)}>{plan ? '予定を編集' : '予定を追加'}</button>
              {plan && <button className="action" disabled={busy} onClick={() => change(data => deletePlan(data, selected))}>予定を削除</button>}
            </div>}
        </div>
        {(plannedIds.length > 0 || skips.length > 0) && <div className="day-section">
          <h3>予定メニュー・見送り</h3>
          <ul>
            {[...new Set([...plannedIds, ...skips.map(skip => skip.menuId)])].map(menuId => {
              const skip = skips.find(item => item.menuId === menuId)
              const name = skip?.menuName ?? data.menus.find(menu => menu.id === menuId)?.name
              return name && <PlanMenuStatus key={selected + ':' + menuId} date={selected} menuId={menuId}
                name={name} skipped={skip} commit={commit} />
            })}
          </ul>
        </div>}
        <div className="day-section">
          <h3>実績</h3>
          {rest && <p className="kind-line"><ActivityIcon kind="休養日" />休養日を記録済み</p>}
          {!rest && records.length === 0 && <p className="hint">まだ記録がありません。</p>}
          <ul className="entries">{records.map(record => <li key={record.id}>
            <p className="kind-line hint"><ActivityIcon kind={record.kind} />{record.kind}</p>
            <p className="entry-title">{record.menuName} <span className="record-amount">{record.amount}{record.unit}</span></p>
            {skips.some(skip => skip.menuId === record.menuId) && <p className="hint">見送り中 · 日次達成率の集計対象外</p>}
            {record.note && <p className="entry-note">{record.note}</p>}
            <button className="action edit-menu" aria-label={record.menuName + 'の記録を編集'} onClick={() => onRecord(selected, record.kind, record.id)}>記録を編集</button>
          </li>)}</ul>
          {selected <= today && <div className="form-actions">
            <button className="action filled" onClick={() => onRecord(selected, plan && plan.kind !== '休養日' ? plan.kind : undefined)}>練習を記録</button>
            <button className="action" disabled={busy} onClick={() => change(data => setRest(data, selected, !rest))}>{rest ? '休養日記録を取り消す' : '休養日を記録'}</button>
            <button className="action" onClick={() => onReflection(selected)}>振り返りを書く</button>
          </div>}
        </div>
        {error && <p className="error" role="alert">{error}</p>}
      </section>
    </>
  )
}



