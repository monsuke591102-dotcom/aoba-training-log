import { useId, useRef, useState, type FormEvent } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { fromLocalDate, monthDates } from './dates'
import type { LocalDate, TrainingData } from './model'
import { monthlyTrainingDays, readMonthlyGoal, saveMonthlyGoal } from './monthlyGoals'
import { errorMessage } from './recordFeedback'

const monthLabel = new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long' })

function MonthGoal({ data, start, limit }: { data: TrainingData; start: LocalDate; limit: number }) {
  const hint = useId()
  const [goal, setGoal] = useState(() => {
    try { return readMonthlyGoal(window.localStorage, start) }
    catch { return null }
  })
  const [input, setInput] = useState<string>()
  const [error, setError] = useState('')
  const returnFocus = useRef(false)
  const days = monthlyTrainingDays(data, start)

  function close() {
    returnFocus.current = true
    setInput(undefined)
    setError('')
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (input === undefined) return
    try {
      setGoal(saveMonthlyGoal(window.localStorage, start, input))
      close()
    } catch (failure) {
      setError(errorMessage(failure))
    }
  }

  return <>
    <p className="monthly-days" aria-live="polite">練習記録 <strong>{days}日</strong>
      {goal !== null && <span> / 目標 {goal}日</span>}</p>
    {goal !== null && <progress className="meter" max={goal} value={Math.min(days, goal)}
      aria-label="月間練習日数の進捗" aria-valuetext={`練習記録 ${days}日、目標 ${goal}日`} />}
    {input === undefined
      ? <button type="button" className="action" ref={button => {
          if (button && returnFocus.current) {
            returnFocus.current = false
            button.focus({ preventScroll: true })
          }
        }} onClick={() => setInput(goal?.toString() ?? '')}>月間目標を設定</button>
      : <form onSubmit={submit} className="fields">
          <label>目標練習日数
            <input type="text" inputMode="numeric" value={input} aria-describedby={hint} autoFocus
              aria-invalid={error ? true : undefined}
              onChange={event => { setInput(event.target.value); setError('') }} />
          </label>
          <p id={hint} className="hint">1〜{limit}日。このブラウザーに保存します。空欄で保存すると目標を解除します。</p>
          <div className="form-actions">
            <button type="submit" className="action filled">月間目標を保存</button>
            <button type="button" className="action" onClick={close}>キャンセル</button>
          </div>
          {error && <p className="error" role="alert">{error}</p>}
        </form>}
  </>
}

export function MonthlyProgress({ data, today }: { data: TrainingData; today: LocalDate }) {
  const [selected, setSelected] = useState<LocalDate>()
  const current = monthDates(fromLocalDate(today)).start
  const shown = selected ?? current
  const month = fromLocalDate(shown)
  const { length } = monthDates(month)
  function changeMonth(offset: number) {
    const next = monthDates(month, offset).start
    setSelected(next === current ? undefined : next)
  }

  return <section className="status-strip monthly-progress" aria-labelledby="monthly-progress-title">
    <h2 id="monthly-progress-title">月間練習日数</h2>
    <div className="monthly-month">
      <button type="button" className="action" aria-label="月間進捗の前の月" onClick={() => changeMonth(-1)}>
        <ChevronLeft size={18} aria-hidden="true" />
      </button>
      <time dateTime={shown.slice(0, 7)} aria-live="polite">{monthLabel.format(month)}</time>
      <button type="button" className="action" aria-label="月間進捗の次の月" onClick={() => changeMonth(1)}>
        <ChevronRight size={18} aria-hidden="true" />
      </button>
    </div>
    <MonthGoal key={shown} data={data} start={shown} limit={length} />
  </section>
}
