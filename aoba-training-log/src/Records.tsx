import { ClipboardList } from 'lucide-react'
import { ScreenTitle } from './ScreenTitle'
import { useState } from 'react'
import type { FormEvent } from 'react'
import type { LocalDate, TrainingData, TrainingKind, TrainingRecord } from './model'
import { errorMessage, type Commit } from './recordFeedback'
export { errorMessage, type Commit } from './recordFeedback'
import { localDate } from './dates'
import { deleteRecord, InputError, saveRecord, trainingKinds, type RecordDraft } from './training'

export function rejectInvalidNumber(form: HTMLFormElement) {
  if (Array.from(form.querySelectorAll<HTMLInputElement>('input[type="number"]')).some(input => input.validity.badInput)) {
    throw new InputError('数値の入力欄を確認してください。')
  }
}

function RecordForm({ data, record, date, kind, commit, onClose }: {
  data: TrainingData
  record?: TrainingRecord
  date?: LocalDate
  kind?: TrainingKind
  commit: Commit
  onClose: () => void
}) {
  const today = localDate(new Date())
  const [draft, setDraft] = useState<RecordDraft>({
    date: record?.date ?? date ?? today, menuId: record?.menuId ?? '', kind: record?.kind ?? kind ?? '自主練',
    amount: String(record?.amount ?? ''), duration: String(record?.durationMinutes ?? ''),
    note: record?.note ?? '', rating: String(record?.rating ?? ''),
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const menu = data.menus.find(item => item.id === draft.menuId)
  const unit = record && record.menuId === draft.menuId ? record.unit : menu?.unit
  const update = <K extends keyof RecordDraft>(key: K, value: RecordDraft[K]) =>
    setDraft(current => ({ ...current, [key]: value }))

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      rejectInvalidNumber(event.currentTarget)
      await commit(data => saveRecord(data, draft, record?.id))
      onClose()
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="editor" onSubmit={submit} noValidate>
      <h2>{record ? '記録を編集' : '新しい練習記録'}</h2>
      <fieldset disabled={busy} className="fields">
        <label>練習日<input type="date" required max={today} value={draft.date} onChange={event => update('date', event.target.value)} /></label>
        <label>練習の種類<select value={draft.kind} onChange={event => update('kind', event.target.value as RecordDraft['kind'])}>
          {trainingKinds.map(kind => <option key={kind}>{kind}</option>)}
        </select></label>
        <label>練習メニュー<select required value={draft.menuId} onChange={event => update('menuId', event.target.value)}>
          <option value="">選んでください</option>
          {record && <option value={record.menuId}>{record.menuName}（{record.unit}・記録時）</option>}
          {data.menus.filter(item => item.enabled && item.id !== record?.menuId).map(item =>
            <option key={item.id} value={item.id}>{item.name}（{item.unit}）</option>,
          )}
        </select></label>
        <label>実施量{unit ? '（' + unit + '）' : ''}<input type="number" required inputMode={unit === '分' ? 'decimal' : 'numeric'} value={draft.amount} onChange={event => update('amount', event.target.value)} /></label>
        <label>所要時間（分・任意）<input type="number" inputMode="decimal" value={draft.duration} onChange={event => update('duration', event.target.value)} /></label>
        <label>メモ（任意）<textarea rows={2} value={draft.note} onChange={event => update('note', event.target.value)} /></label>
        <label>自己評価（任意）<select value={draft.rating} onChange={event => update('rating', event.target.value)}>
          <option value="">選ばない</option>
          {[1, 2, 3, 4, 5].map(score => <option key={score}>{score}</option>)}
        </select></label>
        <div className="form-actions"><button className="action filled" type="submit">記録を保存</button><button className="action" type="button" onClick={onClose}>キャンセル</button></div>
      </fieldset>
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  )
}

export function Records({ data, commit, start }: { data: TrainingData; commit: Commit; start?: { id?: string; date?: LocalDate; kind?: TrainingKind } }) {
  const [editing, setEditing] = useState<string | null>(start ? start.id ?? '' : null)
  const [deleting, setDeleting] = useState<TrainingRecord | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const records = [...data.records].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))

  async function confirmDelete() {
    if (!deleting) return
    setBusy(true)
    setError('')
    try {
      await commit(data => deleteRecord(data, deleting.id))
      if (editing === deleting.id) setEditing(null)
      setDeleting(null)
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <ScreenTitle title="練習記録" icon={ClipboardList} />
      <section className="card">
        {editing === null
          ? <button className="primary" onClick={() => setEditing('')}>詳細を入力</button>
          : <RecordForm key={editing} data={data} date={start?.date} kind={start?.kind} record={records.find(item => item.id === editing)} commit={commit} onClose={() => setEditing(null)} />}
      </section>
      <section className="card">
        <h2>練習履歴</h2>
        {records.length === 0 && <p className="hint">まだ記録がありません。</p>}
        <ul className="entries">
          {records.map(record => (
            <li key={record.id}>
              <p className="hint"><time dateTime={record.date}>{record.date}</time> · {record.kind} · {record.category}</p>
              <p className="entry-title">{record.menuName} <span>{record.amount}{record.unit}</span></p>
              {record.durationMinutes !== undefined && <p className="hint">所要時間 {record.durationMinutes}分</p>}
              {record.rating !== undefined && <p className="hint">自己評価 {record.rating} / 5</p>}
              {record.note && <p className="entry-note">{record.note}</p>}
              {deleting?.id === record.id
                ? <div className="confirmation" role="group" aria-label="削除の確認">
                    <p>この練習記録を削除しますか？</p>
                    <div className="form-actions">
                      <button className="action danger" disabled={busy} onClick={confirmDelete}>削除する</button>
                      <button className="action" disabled={busy} onClick={() => setDeleting(null)}>キャンセル</button>
                    </div>
                    {error && <p className="error" role="alert">{error}</p>}
                  </div>
                : <div className="form-actions">
                    <button className="action" onClick={() => { setEditing(record.id); window.scrollTo(0, 0) }}>編集</button>
                    <button className="action" onClick={() => { setError(''); setDeleting(record) }}>削除</button>
                  </div>}
            </li>
          ))}
        </ul>
      </section>
    </>
  )
}







