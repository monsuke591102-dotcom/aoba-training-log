import { ClipboardList } from 'lucide-react'
import { ScreenTitle } from './ScreenTitle'
import { useState } from 'react'
import type { FormEvent } from 'react'
import type { LocalDate, MatchEntry, TrainingData, TrainingKind, TrainingRecord } from './model'
import { errorMessage, type Commit } from './recordFeedback'
export { errorMessage, type Commit } from './recordFeedback'
import { localDate } from './dates'
import { deleteRecord, InputError, saveRecord, trainingKinds } from './training'
import { canEditMatches, deleteMatch, saveMatch, type MatchDraft } from './matches'
import { BattingEditor } from './BattingEditor'
import { BattingStatsView } from './BattingStatsView'
import { battingGames, isMatchHistoryEntry, recordHistory } from './recordHistory'

export function rejectInvalidNumber(form: HTMLFormElement) {
  if (Array.from(form.querySelectorAll<HTMLInputElement>('input[type="number"]')).some(input => input.validity.badInput)) {
    throw new InputError('数値の入力欄を確認してください。')
  }
}

function RecordForm({ data, record, match, date, kind, commit, onClose }: {
  data: TrainingData
  record?: TrainingRecord
  match?: MatchEntry
  date?: LocalDate
  kind?: TrainingKind
  commit: Commit
  onClose: () => void
}) {
  const today = localDate(new Date())
  const [draft, setDraft] = useState<MatchDraft>({
    date: record?.date ?? match?.date ?? date ?? today, menuId: record?.menuId ?? '', kind: record?.kind ?? (match ? '試合' : kind ?? '自主練'),
    amount: String(record?.amount ?? ''), duration: String(record?.durationMinutes ?? ''),
    note: record?.note ?? '', rating: String(record?.rating ?? ''),
    good: match?.good ?? '', improve: match?.improve ?? '',
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const menu = data.menus.find(item => item.id === draft.menuId)
  const unit = record && record.menuId === draft.menuId ? record.unit : menu?.unit
  const matchEnabled = canEditMatches() && draft.kind === '試合'
  const standalone = match && !record
  const menuOptional = matchEnabled && !record
  const update = <K extends keyof MatchDraft>(key: K, value: MatchDraft[K]) =>
    setDraft(current => ({ ...current, [key]: value }))

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      rejectInvalidNumber(event.currentTarget)
      const target = record ? { recordId: record.id } : match ? { matchId: match.id } : undefined
      await commit(data => matchEnabled ? saveMatch(data, draft, target) : saveRecord(data, draft, record?.id))
      onClose()
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="editor" onSubmit={submit} noValidate>
      <h2>{record || match ? '記録を編集' : '新しい練習記録'}</h2>
      <fieldset disabled={busy} className="fields">
        <label>練習日<input type="date" required max={today} value={draft.date} onChange={event => update('date', event.target.value)} /></label>
        <label>練習の種類<select disabled={Boolean(standalone)} value={draft.kind} onChange={event => update('kind', event.target.value as TrainingKind)}>
          {trainingKinds.map(kind => <option key={kind}>{kind}</option>)}
        </select></label>
        {!standalone && <label>練習メニュー<select required={!menuOptional} value={draft.menuId} onChange={event => update('menuId', event.target.value)}>
          <option value="">{menuOptional ? 'メニューなし' : '選んでください'}</option>
          {record && <option value={record.menuId}>{record.menuName}（{record.unit}・記録時）</option>}
          {data.menus.filter(item => item.enabled && item.id !== record?.menuId).map(item =>
            <option key={item.id} value={item.id}>{item.name}（{item.unit}）</option>,
          )}
        </select></label>}
        {(!menuOptional || draft.menuId) && <>
        <label>実施量{unit ? '（' + unit + '）' : ''}<input type="number" required inputMode={unit === '分' ? 'decimal' : 'numeric'} value={draft.amount} onChange={event => update('amount', event.target.value)} /></label>
        <label>所要時間（分・任意）<input type="number" inputMode="decimal" value={draft.duration} onChange={event => update('duration', event.target.value)} /></label>
        <label>メモ（任意）<textarea rows={2} value={draft.note} onChange={event => update('note', event.target.value)} /></label>
        <label>自己評価（任意）<select value={draft.rating} onChange={event => update('rating', event.target.value)}>
          <option value="">選ばない</option>
          {[1, 2, 3, 4, 5].map(score => <option key={score}>{score}</option>)}
        </select></label>
        </>}
        {matchEnabled && <>
          <label>良かったこと（任意）<textarea rows={2} value={draft.good} onChange={event => update('good', event.target.value)} /></label>
          <label>改善したいこと（任意）<textarea rows={2} value={draft.improve} onChange={event => update('improve', event.target.value)} /></label>
        </>}
        <div className="form-actions"><button className="action filled" type="submit">記録を保存</button><button className="action" type="button" onClick={onClose}>キャンセル</button></div>
      </fieldset>
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  )
}

export function Records({ data, commit, start }: { data: TrainingData; commit: Commit; start?: { id?: string; date?: LocalDate; kind?: TrainingKind } }) {
  const [editing, setEditing] = useState<string | null>(start ? start.id ? 'record:' + start.id : '' : null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [batting, setBatting] = useState<string | null>(null)
  const [battingStats, setBattingStats] = useState<string>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const editMatches = canEditMatches()
  const history = recordHistory(data)
  const selection = history.find(item => item.id === editing)
  const battingEntry = editMatches ? history.find(item => item.id === batting) : undefined

  async function confirmDelete() {
    const entry = history.find(item => item.id === deleting)
    if (!entry) return
    setBusy(true)
    setError('')
    try {
      await commit(data => {
        if (entry.record) return editMatches && entry.record.kind === '試合'
          ? deleteMatch(data, entry.record.id, true) : deleteRecord(data, entry.record.id)
        return deleteMatch(data, entry.match!.id, false)
      })
      if (editing === entry.id) setEditing(null)
      setDeleting(null)
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  if (battingEntry && (battingEntry.record?.kind === '試合' || (battingEntry.match && !battingEntry.match.recordId))) {
    return <BattingEditor key={battingEntry.id} commit={commit} onClose={() => setBatting(null)}
      target={battingEntry.record ? { recordId: battingEntry.record.id } : { matchId: battingEntry.match!.id }}
      appearances={battingEntry.match?.details?.plateAppearances ?? []} />
  }
  if (editMatches && battingStats) {
    const games = battingGames(history)
    const game = games.find(row => row.id === battingStats)
    if (battingStats === 'total' || game) return <BattingStatsView games={games} game={game}
      onClose={() => setBattingStats(undefined)} />
  }

  function openBattingStats(id: string) {
    setBattingStats(id)
    window.scrollTo(0, 0)
  }

  return (
    <>
      <ScreenTitle title="練習記録" icon={ClipboardList} />
      <section className="card">
        {editing === null || (editing !== '' && !selection)
          ? <button className="primary" onClick={() => setEditing('')}>詳細を入力</button>
          : <RecordForm key={editing} data={data} date={start?.date} kind={start?.kind} record={selection?.record} match={selection?.match} commit={commit} onClose={() => setEditing(null)} />}
      </section>
      <section className="card">
        <h2>練習履歴</h2>
        {editMatches && editing === null && history.some(isMatchHistoryEntry) &&
          <button type="button" className="action" onClick={() => openBattingStats('total')}>通算打撃成績</button>}
        {history.length === 0 && <p className="hint">まだ記録がありません。</p>}
        <ul className="entries">
          {history.map(({ id, record, match, date }) => (
            <li key={id}>
              <p className="hint"><time dateTime={date}>{date}</time> · {record?.kind ?? '試合'}{record && ' · ' + record.category}</p>
              {record ? <p className="entry-title">{record.menuName} <span className="record-amount">{record.amount}{record.unit}</span></p>
                : <p className="entry-title">{match?.recordId ? '元の試合記録が見つからない振り返り' : 'メニューなしの試合'}</p>}
              {record?.durationMinutes !== undefined && <p className="hint">所要時間 {record.durationMinutes}分</p>}
              {record?.rating !== undefined && <p className="hint">自己評価 {record.rating} / 5</p>}
              {record?.note && <p className="entry-note">{record.note}</p>}
              {match?.good && <p className="entry-note"><strong>良かったこと</strong> {match.good}</p>}
              {match?.improve && <p className="entry-note"><strong>改善したいこと</strong> {match.improve}</p>}
              {editMatches && editing === null && deleting !== id && (record?.kind === '試合' || (!record && match)) &&
                <button type="button" className="action" onClick={() => openBattingStats(id)}>打撃成績</button>}
              {deleting === id
                ? <div className="confirmation" role="group" aria-label="削除の確認">
                    <p>この練習記録を削除しますか？</p>
                    <div className="form-actions">
                      <button className="action danger" disabled={busy} onClick={confirmDelete}>削除する</button>
                      <button className="action" disabled={busy} onClick={() => setDeleting(null)}>キャンセル</button>
                    </div>
                    {error && <p className="error" role="alert">{error}</p>}
                  </div>
                : (record || (editMatches && !match?.recordId)) && <div className="form-actions">
                    <button className="action" onClick={() => { setEditing(id); window.scrollTo(0, 0) }}>編集</button>
                    <button className="action" onClick={() => { setError(''); setDeleting(id) }}>削除</button>
                    {editMatches && editing === null && (record?.kind === '試合' || (match && !match.recordId)) &&
                      <button className="action" onClick={() => { setBatting(id); window.scrollTo(0, 0) }}>打席を記録</button>}
                  </div>}
            </li>
          ))}
        </ul>
      </section>
    </>
  )
}







