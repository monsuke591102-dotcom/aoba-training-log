import { ClipboardList } from 'lucide-react'
import { ScreenTitle } from './ScreenTitle'
import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { LocalDate, MatchEntry, TrainingData, TrainingKind, TrainingRecord } from './model'
import { errorMessage, type Commit } from './recordFeedback'
export { errorMessage, type Commit } from './recordFeedback'
import { localDate } from './dates'
import { deleteRecord, InputError, saveRecord, trainingKinds } from './training'
import { canEditMatches, deleteMatch, saveMatch, type MatchDraft } from './matches'
import { BattingEditor } from './BattingEditor'
import { BaserunningEditor } from './BaserunningEditor'
import { FieldingEditor } from './FieldingEditor'
import { BattingStatsView } from './BattingStatsView'
import { RunningFieldingStatsView, type RunningFieldingKind } from './RunningFieldingStatsView'
import { battingGames, isMatchHistoryEntry, matchHistoryCounts, recordHistory } from './recordHistory'

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

const disciplines = [
  ['batting', '打撃', '確定打席'],
  ['running', '走塁', '確定盗塁試行'],
  ['fielding', '守備', '確定守備プレー'],
] as const
type Discipline = 'batting' | RunningFieldingKind
type MatchView = { id: string; kind: Discipline; mode: 'record' | 'stats' }

export function Records({ data, commit, start }: { data: TrainingData; commit: Commit; start?: { id?: string; date?: LocalDate; kind?: TrainingKind } }) {
  const [editing, setEditing] = useState<string | null>(start ? start.id ? 'record:' + start.id : '' : null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [view, setView] = useState<MatchView>()
  const actionPrefix = useId()
  const returnTo = useRef<{ buttonId: string; scrollY: number } | undefined>(undefined)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const editMatches = canEditMatches()
  const history = recordHistory(data)
  const selection = history.find(item => item.id === editing)
  const matchEntries = history.filter(isMatchHistoryEntry)
  const sameDayCounts = new Map<LocalDate, number>()
  const matchNumbers = new Map<string, number>()
  for (const entry of [...matchEntries].reverse()) {
    const number = (sameDayCounts.get(entry.date) ?? 0) + 1
    sameDayCounts.set(entry.date, number)
    matchNumbers.set(entry.id, number)
  }

  useEffect(() => {
    if (view || !returnTo.current) return
    const { buttonId, scrollY } = returnTo.current
    returnTo.current = undefined
    document.getElementById(buttonId)?.focus({ preventScroll: true })
    window.scrollTo(0, scrollY)
  }, [view])

  function openMatchView(next: MatchView, buttonId: string) {
    returnTo.current = { buttonId, scrollY: window.scrollY }
    setView(next)
    window.scrollTo(0, 0)
  }

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

  if (editMatches && view) {
    const onClose = () => setView(undefined)
    if (view.mode === 'record') {
      const entry = matchEntries.find(item => item.id === view.id)
      if (entry && (entry.record || (entry.match && !entry.match.recordId))) {
        const target = entry.record ? { recordId: entry.record.id } : { matchId: entry.match!.id }
        const details = entry.match?.details
        if (view.kind === 'batting') return <BattingEditor key={entry.id} commit={commit} onClose={onClose}
          target={target} appearances={details?.plateAppearances ?? []} />
        if (view.kind === 'running') return <BaserunningEditor key={entry.id} commit={commit} onClose={onClose}
          target={target} details={details} />
        return <FieldingEditor key={entry.id} commit={commit} onClose={onClose} target={target} details={details} />
      }
    } else {
      const games = battingGames(history)
      const game = games.find(row => row.id === view.id)
      if (view.id === 'total' || game) {
        return view.kind === 'batting'
          ? <BattingStatsView games={games} game={game} onClose={onClose} />
          : <RunningFieldingStatsView kind={view.kind} games={games} game={game} onClose={onClose} />
      }
    }
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
        {editMatches && editing === null && matchEntries.length > 0 && <div className="form-actions match-total-actions">
          {disciplines.map(([kind, label]) => {
            const buttonId = `${actionPrefix}-total-${kind}`
            return <button key={kind} id={buttonId} type="button" className="action"
              onClick={() => openMatchView({ id: 'total', kind, mode: 'stats' }, buttonId)}>通算{label}成績</button>
          })}
        </div>}
        {history.length === 0 && <p className="hint">まだ記録がありません。</p>}
        <ul className="entries">
          {history.map(entry => {
            const { id, record, match, date } = entry
            const isMatch = isMatchHistoryEntry(entry)
            const opponent = match?.details?.opponent?.trim()
            const matchName = opponent ? `試合 · 対 ${opponent}` : '試合'
            const number = (sameDayCounts.get(date) ?? 0) > 1 ? ` · 同日第${matchNumbers.get(id)}試合` : ''
            const description = `${date} ${matchName}${number}`
            const counts = isMatch && editMatches ? matchHistoryCounts(match?.details) : undefined
            const canRecord = Boolean(record || (match && !match.recordId))
            const deleteMessage = !isMatch ? 'この練習記録を削除しますか？'
              : record && editMatches ? 'この試合と、関連する練習記録を削除しますか？'
                : record ? 'この試合の練習記録を削除しますか？'
                  : 'この試合の記録と振り返りを削除しますか？'
            return <li key={id} className={isMatch ? 'match-history-entry' : undefined}>
              {isMatch
                ? <p className="entry-title"><time dateTime={date}>{date}</time> · {matchName}{number}</p>
                : <p className="hint"><time dateTime={date}>{date}</time> · {record?.kind} · {record?.category}</p>}
              {record && <p className={isMatch ? 'hint' : 'entry-title'}>{record.menuName} <span className="record-amount">{record.amount}{record.unit}</span></p>}
              {!record && match?.recordId && <p className="hint">元の試合記録が見つからない振り返り</p>}
              {record?.durationMinutes !== undefined && <p className="hint">所要時間 {record.durationMinutes}分</p>}
              {record?.rating !== undefined && <p className="hint">自己評価 {record.rating} / 5</p>}
              {record?.note && <p className="entry-note">{record.note}</p>}
              {match?.good && <p className="entry-note"><strong>良かったこと</strong> {match.good}</p>}
              {match?.improve && <p className="entry-note"><strong>改善したいこと</strong> {match.improve}</p>}
              {counts && editing === null && deleting !== id && <div className="match-discipline-actions">
                {disciplines.map(([kind, label, countLabel]) => {
                  const { confirmed, drafts, source } = counts[kind]
                  const buttonId = `${actionPrefix}-${id}-${kind}`
                  return <div className="match-discipline" key={kind} role="group" aria-label={label}>
                    <div>
                      <strong>{label}</strong>
                      <p className="hint">{countLabel} {confirmed === null ? '未記録' : `${confirmed}件`}
                        {drafts > 0 && ` · 下書き ${drafts}件`}</p>
                      {source === 'summary' && <p className="hint">成績は簡易集計</p>}
                    </div>
                    <button type="button" id={buttonId + '-record'} className="action" disabled={!canRecord}
                      aria-label={`${description} ${label}を記録する`}
                      onClick={() => openMatchView({ id, kind, mode: 'record' }, buttonId + '-record')}>記録する</button>
                    <button type="button" id={buttonId + '-stats'} className="action"
                      aria-label={`${description} ${label}の成績を見る`}
                      onClick={() => openMatchView({ id, kind, mode: 'stats' }, buttonId + '-stats')}>成績を見る</button>
                  </div>
                })}
              </div>}
              {deleting === id
                ? <div className="confirmation" role="group" aria-label="削除の確認">
                    <p>{deleteMessage}</p>
                    <div className="form-actions">
                      <button type="button" className="action danger" disabled={busy} onClick={confirmDelete}>削除する</button>
                      <button type="button" className="action" disabled={busy} onClick={() => setDeleting(null)}>キャンセル</button>
                    </div>
                    {error && <p className="error" role="alert">{error}</p>}
                  </div>
                : (record || (editMatches && canRecord)) && <div className={isMatch ? 'form-actions match-whole-actions' : 'form-actions'}>
                    <button type="button" className="action" onClick={() => { setEditing(id); window.scrollTo(0, 0) }}>{isMatch ? '試合を編集' : '編集'}</button>
                    <button type="button" className="action" onClick={() => { setError(''); setDeleting(id) }}>{isMatch ? '試合を削除' : '削除'}</button>
                  </div>}
            </li>
          })}
        </ul>
      </section>
    </>
  )
}
