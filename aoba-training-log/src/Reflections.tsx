import { NotebookPen } from 'lucide-react'
import { ScreenTitle } from './ScreenTitle'
import { useState, type FormEvent } from 'react'
import { saveReflection, type ReflectionDraft } from './activities'
import { fromLocalDate, isLocalDate, localDate } from './dates'
import type { LocalDate, Reflection, TrainingData } from './model'
import { errorMessage, type Commit } from './Records'
import { weekDates } from './training'

const fields = ['success', 'challenge', 'next'] as const
const labels = {
  day: ['できたこと', '難しかったこと', '次に意識すること'],
  week: ['今週できたこと', '改善したいこと', '来週取り組むこと'],
}

function ReflectionForm({ period, date, existing, commit }: {
  period: Reflection['period']; date: LocalDate; existing?: Reflection; commit: Commit
}) {
  const [draft, setDraft] = useState<ReflectionDraft>({
    success: existing?.success ?? '', challenge: existing?.challenge ?? '', next: existing?.next ?? '',
  })
  const [feedback, setFeedback] = useState<{ text: string; error: boolean }>()
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setFeedback(undefined)
    try {
      await commit(data => saveReflection(data, period, date, draft))
      const filled = fields.some(field => draft[field].trim())
      setFeedback({ text: filled ? '振り返りを保存しました。' : 'この振り返りは空欄です。', error: false })
    } catch (error) {
      setFeedback({ text: errorMessage(error), error: true })
    } finally {
      setBusy(false)
    }
  }
  return <form className="editor" onSubmit={submit}>
    <fieldset className="fields" disabled={busy}>
      {fields.map((field, index) => <label key={field}>{labels[period][index]}（任意）
        <textarea rows={3} value={draft[field]} onChange={event => setDraft({ ...draft, [field]: event.target.value })} />
      </label>)}
      <p className="hint">すべて空欄で保存すると、この振り返りは消えます。</p>
      <button className="action filled" type="submit">振り返りを保存</button>
    </fieldset>
    {feedback && <p className={feedback.error ? 'error' : 'hint'} role={feedback.error ? 'alert' : 'status'}>{feedback.text}</p>}
  </form>
}

export function Reflections({ data, commit, initialDate, back }: {
  data: TrainingData; commit: Commit; initialDate: LocalDate; back: () => void
}) {
  const [date, setDate] = useState<LocalDate>(initialDate)
  const [period, setPeriod] = useState<Reflection['period']>('day')
  const today = localDate(new Date())
  const [start, end] = weekDates(fromLocalDate(date))
  const key = period === 'week' ? start : date
  const history = [...data.reflections].sort((a, b) => b.date.localeCompare(a.date))
  return <>
    <ScreenTitle title="振り返り" icon={NotebookPen} />
    <section className="card">
      <button className="action back-button" onClick={back}>戻る</button>
      <div className="form-actions" role="group" aria-label="振り返りの種類">
        <button className="action" aria-pressed={period === 'day'} onClick={() => setPeriod('day')}>日次</button>
        <button className="action" aria-pressed={period === 'week'} onClick={() => setPeriod('week')}>週次</button>
      </div>
      <div className="fields editor"><label>振り返りの日付<input type="date" max={today} value={date}
        onChange={event => { if (isLocalDate(event.target.value) && event.target.value <= today) setDate(event.target.value) }} />
      </label></div>
      {period === 'week' && <p className="hint">{start} 〜 {end}（月〜日）</p>}
      <ReflectionForm key={period + key} period={period} date={key} commit={commit}
        existing={history.find(item => item.period === period && item.date === key)} />
    </section>
    <section className="card">
      <h2>振り返りの履歴</h2>
      {history.length === 0 && <p className="hint">まだ振り返りがありません。</p>}
      <ul className="entries">{history.map(item => <li key={item.period + item.date}>
        <p className="entry-title">{item.date}{item.period === 'day' ? 'の日次振り返り' : 'からの週次振り返り'}</p>
        {fields.map((field, index) => item[field] && <p key={field} className="entry-note">{labels[item.period][index]} · {item[field]}</p>)}
        <button className="action edit-menu" onClick={() => { setDate(item.date); setPeriod(item.period); window.scrollTo(0, 0) }}>編集</button>
      </li>)}</ul>
    </section>
  </>
}

