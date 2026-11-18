import { useState, type FormEvent } from 'react'
import { CircleMinus } from 'lucide-react'
import { clearSkippedMenu, saveSkippedMenu, SkipConfirmationRequired } from './activities'
import { skipReasons, type LocalDate, type SkippedMenu } from './model'
import { errorMessage, type Commit } from './Records'

export function PlanMenuStatus({ date, menuId, name, skipped, commit }: {
  date: LocalDate; menuId: string; name: string; skipped?: SkippedMenu; commit: Commit
}) {
  const [editing, setEditing] = useState(false)
  const [reason, setReason] = useState<SkippedMenu['reason'] | ''>('')
  const [note, setNote] = useState('')
  const [confirmation, confirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function open() {
    setReason(skipped?.reason ?? '')
    setNote(skipped?.note ?? '')
    setError('')
    confirm(false)
    setEditing(true)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!reason) {
      setError('見送りの理由を選んでください。')
      return
    }
    setError('')
    setBusy(true)
    try {
      await commit(data => saveSkippedMenu(data, date, menuId, reason, note, confirmation))
      setEditing(false)
    } catch (error) {
      if (error instanceof SkipConfirmationRequired) confirm(true)
      else setError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  async function clear() {
    setError('')
    setBusy(true)
    try {
      await commit(data => clearSkippedMenu(data, date, menuId))
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return <li className="plan-menu-status">
    <div className="plan-menu-line">
      <strong>{name}</strong>
      {skipped && <span className="skip-tag"><CircleMinus size={14} aria-hidden="true" />見送り</span>}
    </div>
    {skipped && <>
      <p className="hint">{skipped.reason}</p>
      {skipped.note && <p className="entry-note">{skipped.note}</p>}
    </>}
    {editing ? <form className="editor" onSubmit={submit} noValidate>
      <fieldset className="fields" disabled={busy}>
        <label>見送りの理由<select required value={reason} onChange={event => setReason(event.target.value as typeof reason)}>
          <option value="">理由を選ぶ</option>
          {skipReasons.map(item => <option key={item}>{item}</option>)}
        </select></label>
        <label>メモ（任意）<textarea rows={2} value={note} onChange={event => setNote(event.target.value)} /></label>
        {confirmation && <p role="alert" className="skip-confirm">すでに練習実績があります。記録は保存したまま、このメニューを今日の達成率から外します。</p>}
        <div className="form-actions">
          <button className="action filled" type="submit">{confirmation ? '記録を残して見送る' : '見送りを保存'}</button>
          <button className="action" type="button" onClick={() => { setEditing(false); setError('') }}>キャンセル</button>
        </div>
      </fieldset>
    </form> : <div className="form-actions">
      <button className="action" disabled={busy} onClick={open} aria-label={name + (skipped ? 'の見送りを編集' : 'を見送る')}>{skipped ? '理由を編集' : '見送り'}</button>
      {skipped && <button className="action" disabled={busy} onClick={clear} aria-label={name + 'の見送りを解除'}>見送りを解除</button>}
    </div>}
    {error && <p className="error" role="alert">{error}</p>}
  </li>
}
