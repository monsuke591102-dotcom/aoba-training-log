import { useRef, useState } from 'react'
import { BallField } from './BattingDiagrams'
import { positionLabels } from './BattingEditor'
import { positions, type FieldingPlay, type MatchDetails, type PositionChange } from './matchDetails'
import { updateMatchDetails, type MatchTarget } from './matches'
import { errorMessage, type Commit } from './recordFeedback'
import { InputError } from './training'
import { useMatchSaveBar } from './useMatchSaveBar'

const plays: Record<NonNullable<FieldingPlay['playType']>, string> = {
  grounder: 'ゴロ', liner: 'ライナー', fly: 'フライ', bunt: 'バント', throw: '送球', tag: 'タッチ',
  force: 'フォースプレー', cover: 'ベースカバー', other: 'その他',
}
const credits = [['putout', '刺殺'], ['assist', '補殺'], ['error', '失策']] as const
export const fieldingSkills = [['catching', '捕球'], ['throwing', '送球'], ['judgment', '判断'], ['baseCover', 'ベースカバー'], ['other', 'その他']] as const
const reflections = [['feel', '良かったこと'], ['reflection', '反省点'], ['improvement', '次に意識すること']] as const
type Mode = { kind: 'play'; value: FieldingPlay } | { kind: 'position'; value: PositionChange }
const nextOrder = (items: readonly { order: number }[]) => items.reduce((max, row) => Math.max(max, row.order), 0) + 1
const ordered = <T extends { order: number }>(items: readonly T[]) => [...items].sort((a, b) => a.order - b.order)

function PositionSelect({ value, onChange }: {
  value?: PositionChange['position']; onChange: (value?: PositionChange['position']) => void
}) {
  return <label>守備位置<select value={value ?? ''} onChange={event =>
    onChange((event.target.value || undefined) as FieldingPlay['position'])}>
    <option value="">未選択</option>
    {positions.map(position => <option key={position} value={position}>{positionLabels[position]}</option>)}
  </select></label>
}

export function FieldingEditor({ target, details, commit, onClose }: {
  target: MatchTarget; details?: MatchDetails; commit: Commit; onClose: () => void
}) {
  const [draft, setDraft] = useState<FieldingPlay>()
  const [position, setPosition] = useState<PositionChange['position']>()
  const [inning, setInning] = useState('')
  const [editingPosition, setEditingPosition] = useState<PositionChange | null | undefined>()
  const [original, setOriginal] = useState<FieldingPlay>()
  const [deleting, setDeleting] = useState<Mode>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const editing = draft !== undefined || editingPosition !== undefined
  const { editor, saveBar } = useMatchSaveBar(editing)
  const rows = ordered(details?.fielding ?? [])
  const changes = ordered(details?.positionChanges ?? [])

  async function transact(edit: (current: MatchDetails) => MatchDetails) {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      await commit(data => updateMatchDetails(data, target, edit))
      setDraft(undefined)
      setEditingPosition(undefined)
      setDeleting(undefined)
      window.scrollTo(0, 0)
    } catch (error) { setError(errorMessage(error)) }
    finally { pending.current = false; setBusy(false) }
  }

  function openPlay(row?: FieldingPlay) {
    setOriginal(row)
    setDraft(row ?? { id: crypto.randomUUID(), order: nextOrder(rows), status: 'draft',
      position: changes.at(-1)?.position, credits: [] })
    setError('')
    window.scrollTo(0, 0)
  }

  function openPosition(row?: PositionChange) {
    setEditingPosition(row ?? null)
    setPosition(row?.position)
    setInning(row?.inning?.toString() ?? '')
    setError('')
    window.scrollTo(0, 0)
  }

  function savePlay(status: FieldingPlay['status']) {
    if (!draft) return
    void transact(current => {
      if (status === 'complete' && (!draft.position || !draft.playType)) throw new InputError('守備位置とプレー種類を選んでください。')
      if (original && JSON.stringify(current.fielding.find(row => row.id === original.id)) !== JSON.stringify(original)) {
        throw new InputError('この守備プレーは変更されています。開き直してください。')
      }
      const row = { ...draft, status, credits: draft.credits ?? [] }
      return { ...current, fielding: original ? current.fielding.map(item => item.id === row.id ? row : item)
        : [...current.fielding, { ...row, order: nextOrder(current.fielding) }] }
    })
  }

  function savePosition() {
    void transact(current => {
      if (!position) throw new InputError('守備位置を選んでください。')
      const value = inning.trim() === '' ? undefined : Number(inning)
      if (value !== undefined && (!/^\d+$/.test(inning.trim()) || !Number.isSafeInteger(value) || value < 1)) {
        throw new InputError('イニングは1以上の整数で入力してください。')
      }
      if (editingPosition && JSON.stringify(current.positionChanges.find(row => row.id === editingPosition.id)) !== JSON.stringify(editingPosition)) {
        throw new InputError('この守備位置履歴は変更されています。開き直してください。')
      }
      const row: PositionChange = { id: editingPosition?.id ?? crypto.randomUUID(),
        order: editingPosition?.order ?? nextOrder(current.positionChanges), position, inning: value }
      return { ...current, positionChanges: editingPosition
        ? current.positionChanges.map(item => item.id === row.id ? row : item) : [...current.positionChanges, row] }
    })
  }

  function deleteControls(entry: Mode, label: string) {
    if (deleting?.value.id !== entry.value.id) return <button type="button" className="action" disabled={busy}
      onClick={() => { setDeleting(entry); setError('') }}>{label}を削除</button>
    return <div className="confirmation">
      <p>{label}を削除しますか？</p>
      <button type="button" className="action danger" disabled={busy} onClick={() => void transact(current => entry.kind === 'play'
        ? { ...current, fielding: current.fielding.filter(row => row.id !== entry.value.id) }
        : { ...current, positionChanges: current.positionChanges.filter(row => row.id !== entry.value.id) })}>{label}を削除する</button>
      <button type="button" className="action" disabled={busy} onClick={() => { setDeleting(undefined); setError('') }}>キャンセル</button>
    </div>
  }

  if (!editing) return <section className="card batting-editor fielding-editor">
    <button type="button" className="action" disabled={busy} onClick={onClose}>練習履歴へ戻る</button>
    <h2>守備記録</h2>
    {details?.source.fielding === 'summary' && <p className="hint">集計元は簡易記録です。守備プレーを保存しても集計元は維持します。</p>}
    <h3>守備位置の履歴</h3>
    {!changes.length && <p className="hint">守備位置の履歴はまだありません。</p>}
    <ul className="entries">{changes.map(row => <li key={row.id}>
      <p>第{row.order}位置 · {positionLabels[row.position]}{row.inning && ' · ' + row.inning + '回'}</p>
      <div className="form-actions">
        <button type="button" className="action" disabled={busy} onClick={() => openPosition(row)}>第{row.order}位置を編集</button>
        {deleteControls({ kind: 'position', value: row }, `第${row.order}位置`)}
      </div>
    </li>)}</ul>
    <button type="button" className="action" disabled={busy} onClick={() => openPosition()}>守備位置を追加</button>
    <h3>守備プレー一覧</h3>
    {!rows.length && <p className="hint">守備プレーはまだありません。</p>}
    <ul className="entries">{rows.map(row => <li key={row.id}>
      <p className="entry-title">第{row.order}プレー <span>{row.status === 'draft' ? '下書き' : '確定'}</span></p>
      <p className="hint">{row.position ? positionLabels[row.position] : '位置未選択'} · {row.playType ? plays[row.playType] : '種類未選択'} ·
        {' '}{row.credits?.length ? credits.filter(([key]) => row.credits?.includes(key)).map(([, label]) => label).join('・') : '公式記録なし'}</p>
      <div className="form-actions">
        <button type="button" className="action" disabled={busy} onClick={() => openPlay(row)}>第{row.order}プレーを編集</button>
        {deleteControls({ kind: 'play', value: row }, `第${row.order}プレー`)}
      </div>
    </li>)}</ul>
    <button type="button" className="action filled" disabled={busy} onClick={() => openPlay()}>守備プレーを追加</button>
    {error && <p className="error" role="alert">{error}</p>}
  </section>

  const update = (patch: Partial<FieldingPlay>) => {
    setDraft(current => current && { ...current, ...patch })
    setError('')
  }
  return <section ref={editor} className="card batting-editor batting-editor-with-save">
    <h2>{draft ? `第${draft.order}守備プレー` : '守備位置の履歴'}</h2>
    <fieldset className="batting-form" disabled={busy}>
      {draft ? <>
        <div className="batting-result-fields">
          <PositionSelect value={draft.position} onChange={value => update({ position: value })} />
          <label>プレー種類<select value={draft.playType ?? ''} onChange={event => update({ playType: (event.target.value || undefined) as FieldingPlay['playType'] })}>
            <option value="">未選択</option>{Object.entries(plays).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select></label>
        </div>
        <fieldset className="batting-choices"><legend>公式記録</legend>
          <button type="button" className="action" aria-pressed={!draft.credits?.length} onClick={() => update({ credits: [] })}>公式記録なし</button>
          {credits.map(([key, label]) => <button type="button" key={key} className="action" aria-pressed={draft.credits?.includes(key) ?? false}
            onClick={() => update({ credits: draft.credits?.includes(key) ? draft.credits.filter(item => item !== key) : [...draft.credits ?? [], key] })}>{label}</button>)}
        </fieldset>
        <BallField point={draft.fieldPoint} onSelect={fieldPoint => update({ fieldPoint })} />
        <details className="batting-extra">
          <summary>育成観察（任意）{draft.development?.length ? ` · ${draft.development.length}件` : ''}</summary>
          <div className="fields batting-result-fields">
          {fieldingSkills.map(([skill, label]) => <label key={skill}>{label}の観察<textarea rows={2}
            value={draft.development?.filter(row => row.skill === skill).map(row => row.note).join('\n') ?? ''}
            onChange={event => {
              const note = event.target.value
              const other = (draft.development ?? []).filter(row => row.skill !== skill)
              update({ development: note ? [...other, { skill, note }] : other })
            }} /></label>)}
          </div>
        </details>
        <details className="batting-extra">
          <summary>振り返り（任意）</summary>
          <div className="fields">
          {reflections.map(([key, label]) => <label key={key}>{label}<textarea rows={2} value={draft[key] ?? ''}
            onChange={event => update({ [key]: event.target.value })} /></label>)}
          </div>
        </details>
      </> : <div className="batting-result-fields">
        <PositionSelect value={position} onChange={setPosition} />
        <label>イニング（任意）<input inputMode="numeric" value={inning} onChange={event => setInning(event.target.value)} /></label>
      </div>}
      <div><button type="button" className="action" onClick={() => { setDraft(undefined); setEditingPosition(undefined); setError('') }}>キャンセル</button></div>
      <div ref={saveBar} className="batting-save-bar" role="group" aria-label="守備記録の保存">
        {error && <p className="error" role="alert">{error}</p>}
        <div className="batting-save-actions">
          {draft ? <>
            <button type="button" className="action" onClick={() => savePlay('draft')}>下書き保存</button>
            <button type="button" className="action filled" onClick={() => savePlay('complete')}>守備プレーを確定</button>
          </> : <button type="button" className="action filled" onClick={savePosition}>守備位置を保存</button>}
        </div>
      </div>
    </fieldset>
  </section>
}
