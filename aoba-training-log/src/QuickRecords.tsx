import { useRef, useState, type FormEvent } from 'react'
import { Equipment } from './BaseballArt'
import type { LocalDate, Menu, RoutineItem, TrainingData, TrainingKind } from './model'
import { quickMetrics, saveQuickRecord, type QuickChange } from './quickRecord'
import { errorMessage, type Commit } from './recordFeedback'
import { StepButton } from './StepButton'
import { dailyRoutine, plannedMenuIds, setRoutineAddition, setRoutineCompletion } from './routines'

const quantity = new Intl.NumberFormat('ja-JP', { maximumSignificantDigits: 15 })

function QuickRow({ data, date, kind, menu, commit, open, select, rule }: {
  data: TrainingData; date: LocalDate; kind: TrainingKind; menu: Menu; commit: Commit
  open: boolean; select: (show: boolean) => void; rule?: RoutineItem
}) {
  const { total, target, floor, skipped } = quickMetrics(data, date, menu)
  const [draft, setDraft] = useState('')
  const [expected, setExpected] = useState(0)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const submitting = useRef(false)
  const button = useRef<HTMLButtonElement>(null)
  const rate = target !== null && !skipped ? Math.round(total / target * 100) : null

  function begin() {
    setExpected(total)
    setDraft(String(total))
    setError('')
    select(true)
  }

  async function apply(change: QuickChange) {
    setError('')
    try {
      await commit(current => saveQuickRecord(current, date, menu.id, menu.unit, kind, change))
      return true
    } catch (error) {
      setError(errorMessage(error))
      return false
    }
  }

  function close() {
    setError('')
    select(false)
    button.current?.focus()
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current) return
    submitting.current = true
    setSaving(true)
    try {
      if (await apply({ total: draft, expected })) close()
    } finally {
      submitting.current = false
      setSaving(false)
    }
  }

  return <li className="quick-row">
    <div className="quick-row-top">
      <button ref={button} className="quick-value" type="button" disabled={skipped || saving} aria-expanded={open}
        aria-label={menu.name + 'の実施量を入力'} onClick={begin}>
        <span className="equipment"><Equipment category={menu.category} /></span>
        <span className="quick-value-text">
          <strong>{rule?.group && rule.group + ' · '}{rule?.name ?? menu.name}</strong>
          <span><b>{quantity.format(total)}{menu.unit}</b> / {target === null ? '目標未設定' : quantity.format(target) + menu.unit}
            {rate !== null && <span className={rate >= 100 ? 'success' : undefined}> · {rate}%</span>}</span>
        </span>
      </button>
      <div className="quick-steps">
        <StepButton direction="minus" label={menu.name + 'を減らす'} disabled={skipped || open || total <= floor} step={n => { void apply({ delta: -n }) }} />
        <StepButton direction="plus" label={menu.name + 'を増やす'} disabled={skipped || open} step={n => { void apply({ delta: n }) }} />
      </div>
    </div>
    {rate !== null && <progress className="meter" max={100} value={Math.min(rate, 100)} aria-label={menu.name + 'の達成率 ' + rate + '%'} />}
    {rule && <RoutineNote item={rule} />}
    {skipped && <p className="hint">見送り中 · カレンダーから解除できます。</p>}
    {open && <form className="quick-entry fields" onSubmit={submit} noValidate>
      <label>実施量（{menu.unit}）<input type="text" inputMode={menu.unit === '分' ? 'decimal' : 'numeric'}
        autoFocus value={draft} readOnly={saving} onChange={event => setDraft(event.target.value)}
        onKeyDown={event => { if (event.key === 'Escape' && !saving) close() }} /></label>
      {floor > 0 && <p className="hint">詳細入力の {quantity.format(floor)}{menu.unit} を含みます。変更は練習履歴で行えます。</p>}
      <div className="form-actions">
        <button className="action filled" type="submit" disabled={saving}>数値を確定</button>
        <button className="action" type="button" disabled={saving} onClick={close}>キャンセル</button>
      </div>
    </form>}
    {error && <p className="error" role="alert">{error}</p>}
  </li>
}


function RoutineNote({ item }: { item: RoutineItem }) {
  return <>{item.condition && <p className="hint">{item.condition}</p>}{item.note && <p className="hint">{item.note}</p>}</>
}

export function QuickRecords({ data, commit, date, kind }: {
  data: TrainingData; commit: Commit; date: LocalDate; kind: TrainingKind
}) {
  const [selected, select] = useState<string>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const { selected: scheduled, optional, additions } = dailyRoutine(data, date)
  const ids = plannedMenuIds(data, date)
  const enabled = data.menus.filter(menu => menu.enabled)
  const visible = enabled.filter(menu => ids.has(menu.id))
  const conditional = optional.filter(item => !item.menuId || !ids.has(item.menuId))
  const other = enabled.filter(menu => !ids.has(menu.id) && !conditional.some(item => item.menuId === menu.id))
  const notesOnly = scheduled.filter(item => !visible.some(menu => menu.id === item.menuId))

  async function add(item: RoutineItem, selected: boolean) {
    setBusy(true)
    setError('')
    try { await commit(current => setRoutineAddition(current, date, item.id, selected)) }
    catch (error) { setError(errorMessage(error)) }
    finally { setBusy(false) }
  }

  async function complete(item: RoutineItem, done: boolean) {
    setBusy(true)
    setError('')
    try { await commit(current => setRoutineCompletion(current, date, item.id, done)) }
    catch (error) { setError(errorMessage(error)) }
    finally { setBusy(false) }
  }

  function rows(menus: Menu[]) {
    return <ul className="quick-list">{menus.map(menu =>
      <QuickRow key={date + ':' + menu.id + ':' + menu.unit} data={data} date={date} kind={kind} menu={menu} commit={commit}
        rule={scheduled.find(item => item.menuId === menu.id)}
        open={selected === menu.id} select={show => select(show ? menu.id : undefined)} />,
    )}</ul>
  }
  return <section className="club-panel quick-panel" id="home-quick-records" tabIndex={-1} aria-labelledby="home-quick-title">
    <h2 id="home-quick-title">今日のクイック記録</h2>
    <p className="hint">短押しで1、長押しして離すと10。数字をタップすると直接入力できます。</p>
    {!visible.length && !notesOnly.length && <p className="hint">今日の対象メニューはありません。条件付きメニューやその他のメニューを確認できます。</p>}
    {rows(visible)}
    {notesOnly.length > 0 && <ul className="entries">{notesOnly.map(item => <li key={item.id}>
      <strong>{item.group && item.group + ' · '}{item.name}</strong><RoutineNote item={item} />
      {item.mode === 'check'
        ? <label className="routine-check"><input type="checkbox" disabled={busy}
          checked={data.routineCompletions?.some(row => row.date === date && row.itemId === item.id) ?? false}
          onChange={event => complete(item, event.target.checked)} />完了</label>
        : <p className="hint">計画の内容を表示</p>}
    </li>)}</ul>}
    {scheduled.some(item => additions.has(item.id)) && <div className="form-actions">
      {scheduled.filter(item => additions.has(item.id)).map(item => <button key={item.id} type="button" className="action"
        disabled={busy} onClick={() => add(item, false)}>{item.name}を今日の計画から外す</button>)}
    </div>}
    {conditional.length > 0 && <details className="quick-help">
      <summary>条件付き・任意のメニュー</summary>
      <ul className="entries">{conditional.map(item => <li key={item.id}><strong>{item.group && item.group + ' · '}{item.name}</strong><RoutineNote item={item} />
        <button type="button" className="action edit-menu" disabled={busy} aria-label={item.name + 'を今日に追加'}
          onClick={() => add(item, true)}>今日に追加</button>
      </li>)}</ul>
    </details>}
    {other.length > 0 && <details className="quick-help"><summary>その他のメニューを表示</summary>{rows(other)}</details>}
    <details className="quick-help"><summary>操作と記録の扱い</summary>
      <p className="hint">目標は日次目標です。詳細入力分を減らす場合は練習履歴で編集してください。キーボードでは Shift と Enter または Space で10ずつ変更できます。</p>
    </details>
    {error && <p className="error" role="alert">{error}</p>}
  </section>
}

