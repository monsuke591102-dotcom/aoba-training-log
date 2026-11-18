import { useEffect, useRef, useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import { savePlanKind } from './activities'
import { fromLocalDate } from './dates'
import type { LocalDate, Plan } from './model'
import { errorMessage, type Commit } from './recordFeedback'
import { trainingKinds } from './training'

const labelDate = new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })

export function PlanDialog({ date, existing, commit, close }: { date: LocalDate; existing?: Plan; commit: Commit; close: () => void }) {
  const [original] = useState(existing)
  const [kind, setKind] = useState<Plan['kind'] | ''>(existing?.kind ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  const saving = useRef(false)

  useEffect(() => {
    const panel = dialog.current
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    const overflow = document.body.style.overflow
    panel?.showModal()
    document.body.style.overflow = 'hidden'
    return () => {
      panel?.close()
      document.body.style.overflow = overflow
      if (focused?.isConnected) focused.focus({ preventScroll: true })
    }
  }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving.current) return
    if ((original?.kind ?? '') === kind && JSON.stringify(original) === JSON.stringify(existing)) {
      close()
      return
    }
    saving.current = true
    setBusy(true)
    setError('')
    try {
      await commit(data => savePlanKind(data, date, kind, original))
      close()
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      saving.current = false
      setBusy(false)
    }
  }

  return <dialog ref={dialog} className="card plan-dialog" aria-labelledby="home-plan-title"
    onCancel={event => { event.preventDefault(); if (!saving.current) close() }}>
    <div className="section-toolbar">
      <h2 id="home-plan-title">予定を編集</h2>
      <button type="button" className="action plan-close" aria-label="閉じる" disabled={busy} onClick={close}><X size={20} aria-hidden="true" /></button>
    </div>
    <p><time dateTime={date}>{labelDate.format(fromLocalDate(date))}</time></p>
    <p className="hint">現在の予定 · {existing?.kind ?? '予定なし'}</p>
    <form className="editor" onSubmit={submit}>
      <fieldset className="fields" disabled={busy}>
        <label>予定の種類<select autoFocus value={kind} onChange={event => setKind(event.target.value as typeof kind)}>
          {trainingKinds.map(value => <option key={value}>{value}</option>)}
          <option>休養日</option>
          <option value="">予定なし（登録解除）</option>
        </select></label>
        {original && original.kind !== '休養日' && original.menuIds.length > 0 && (kind === '' || kind === '休養日') &&
          <p className="hint">予定メニューの指定も解除されます。練習記録や見送り履歴は残ります。</p>}
        <div className="form-actions">
          <button className="action filled" type="submit">保存する</button>
          <button className="action" type="button" onClick={close}>キャンセル</button>
        </div>
      </fieldset>
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  </dialog>
}
