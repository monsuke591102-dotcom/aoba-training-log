import { useRef, useState } from 'react'
import type { BaserunningPlay, MatchDetails } from './matchDetails'
import { updateMatchDetails, type MatchTarget } from './matches'
import { errorMessage, type Commit } from './recordFeedback'
import { InputError } from './training'
import { useMatchSaveBar } from './useMatchSaveBar'

const bases = { batter: '打者', first: '一塁', second: '二塁', third: '三塁', home: '本塁' } as const
const results: Record<NonNullable<BaserunningPlay['result']>, string> = {
  advanced: '進塁', stolenBase: '盗塁成功', caughtStealing: '盗塁死', out: '走塁アウト', scored: '得点',
}
export const stealChoices = [
  { label: '二盗成功', from: 'first', to: 'second', result: 'stolenBase' },
  { label: '二盗死', from: 'first', to: 'second', result: 'caughtStealing' },
  { label: '三盗成功', from: 'second', to: 'third', result: 'stolenBase' },
  { label: '三盗死', from: 'second', to: 'third', result: 'caughtStealing' },
] as const

type StealChoice = typeof stealChoices[number]

function stealChoice(play: BaserunningPlay) {
  return stealChoices.find(choice => choice.from === play.from && choice.to === play.to && choice.result === play.result)
}

function unknownTarget(play: BaserunningPlay) {
  return play.result === 'caughtStealing' && play.to === undefined
}

export function runningPlayForSave(play: BaserunningPlay, status: BaserunningPlay['status'], choice?: StealChoice): BaserunningPlay {
  if (!choice) {
    if (status === 'complete') throw new InputError('盗塁の結果を選んでください。')
    return { ...play, status }
  }
  const { from, to, result } = choice
  return { ...play, from, to, result, reason: 'steal', status }
}

export function StealOptions({ selected, onSelect }: { selected?: StealChoice; onSelect: (choice: StealChoice) => void }) {
  return <fieldset className="running-choices">
    <legend>盗塁の結果</legend>
    {stealChoices.map(choice => <button key={choice.label} type="button" className="action"
      aria-pressed={selected === choice} onClick={() => onSelect(choice)}>{choice.label}</button>)}
  </fieldset>
}

export function BaserunningEditor({ target, details, commit, onClose }: {
  target: MatchTarget; details?: MatchDetails; commit: Commit; onClose: () => void
}) {
  const [draft, setDraft] = useState<BaserunningPlay>()
  const [original, setOriginal] = useState<BaserunningPlay>()
  const [selected, setSelected] = useState<StealChoice>()
  const [deleting, setDeleting] = useState<string>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const { editor, saveBar } = useMatchSaveBar(draft !== undefined)
  const rows = [...(details?.baserunning ?? [])].sort((a, b) => a.order - b.order)
  const nextOrder = (items: BaserunningPlay[]) => items.reduce((max, row) => Math.max(max, row.order), 0) + 1

  function edit(row?: BaserunningPlay) {
    setOriginal(row)
    setDraft(row ?? { id: crypto.randomUUID(), order: nextOrder(rows), status: 'draft' })
    setSelected(row && stealChoice(row))
    setError('')
    window.scrollTo(0, 0)
  }

  async function change(editRows: (rows: BaserunningPlay[]) => BaserunningPlay[]) {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      await commit(data => updateMatchDetails(data, target, current => ({ ...current, baserunning: editRows(current.baserunning) })))
      setDraft(undefined)
      setDeleting(undefined)
      window.scrollTo(0, 0)
    } catch (error) { setError(errorMessage(error)) }
    finally { pending.current = false; setBusy(false) }
  }

  if (!draft) return <section className="card batting-editor">
    <button type="button" className="action" onClick={onClose}>練習履歴へ戻る</button>
    <h2>走塁プレー一覧</h2>
    {!rows.length && <p className="hint">走塁プレーはまだありません。</p>}
    {details?.source.baserunning === 'summary' && <p className="hint">この試合の集計元は簡易記録です。詳細プレーを保存しても集計元は維持します。</p>}
    <ul className="entries">{rows.map(row => {
      const choice = stealChoice(row)
      const missingTarget = unknownTarget(row)
      const editable = choice || !row.result || (missingTarget && (row.from === 'first' || row.from === 'second'))
      return <li key={row.id}>
        <p className="entry-title">第{row.order}プレー <span>{row.status === 'draft' ? '下書き' : '確定'}</span></p>
        <p className="hint">{choice?.label ?? (row.result ? results[row.result] : '結果未入力')}
          {row.from && ' · 出発 ' + bases[row.from]}
          {row.to && (row.result === 'caughtStealing' ? ' · 狙い塁 ' : ' · 到達 ') + bases[row.to]}
          {missingTarget && ' · 狙い塁不明'}
        </p>
        {!editable && <p className="hint">旧走塁記録 · 現在の二盗・三盗の4択に当てはまらないため、編集できません。</p>}
        {row.reflection && <p className="entry-note">{row.reflection}</p>}
        {deleting === row.id ? <div className="confirmation">
          <p>この走塁プレーを削除しますか？</p>
          <div className="form-actions">
            <button type="button" className="action danger" disabled={busy}
              onClick={() => void change(items => items.filter(item => item.id !== row.id))}>走塁プレーを削除する</button>
            <button type="button" className="action" disabled={busy}
              onClick={() => { setDeleting(undefined); setError('') }}>キャンセル</button>
          </div>
        </div> : <div className="form-actions">
          {editable && <button type="button" className="action" disabled={busy}
            onClick={() => edit(row)}>第{row.order}プレーを編集</button>}
          <button type="button" className="action" disabled={busy}
            onClick={() => { setDeleting(row.id); setError('') }}>第{row.order}プレーを削除</button>
        </div>}
      </li>
    })}</ul>
    <button type="button" className="action filled" disabled={busy} onClick={() => edit()}>走塁プレーを追加</button>
    {error && <p className="error" role="alert">{error}</p>}
  </section>

  const update = (patch: Partial<BaserunningPlay>) => { setDraft({ ...draft, ...patch }); setError('') }
  function save(status: BaserunningPlay['status']) {
    if (!draft) return
    void change(items => {
      const next = runningPlayForSave(draft, status, selected)
      if (!original) return [...items, { ...next, order: nextOrder(items) }]
      if (JSON.stringify(items.find(row => row.id === original.id)) !== JSON.stringify(original)) {
        throw new InputError('この走塁プレーは変更されています。開き直してください。')
      }
      return items.map(row => row.id === next.id ? next : row)
    })
  }
  return <section ref={editor} className="card batting-editor batting-editor-with-save">
    <h2>第{draft.order}走塁プレー</h2>
    <fieldset className="batting-form" disabled={busy}>
      {original && unknownTarget(original) && <p className="hint">
        以前の記録には狙い塁がありません。確定する場合は実際の盗塁結果を選択してください。
      </p>}
      <StealOptions selected={selected} onSelect={choice => { setSelected(choice); setError('') }} />
      <div className="batting-result-fields">
        {Boolean(details?.plateAppearances.length) && <label>打席との紐づけ（任意）
          <select value={draft.plateAppearanceId ?? ''} onChange={event => update({ plateAppearanceId: event.target.value || undefined })}>
            <option value="">紐づけなし</option>{details?.plateAppearances.map(row => <option value={row.id} key={row.id}>第{row.order}打席</option>)}
          </select></label>}
      </div>
      <div className="fields"><label>振り返り（任意）<textarea rows={2} value={draft.reflection ?? ''}
        onChange={event => update({ reflection: event.target.value })} /></label></div>
      <div><button type="button" className="action" onClick={() => setDraft(undefined)}>キャンセル</button></div>
      <div ref={saveBar} className="batting-save-bar" role="group" aria-label="走塁プレーの保存">
        {error && <p role="alert" className="error">{error}</p>}
        <div className="batting-save-actions">
          <button type="button" className="action" onClick={() => save('draft')}>下書き保存</button>
          <button type="button" className="action filled" onClick={() => save('complete')}>走塁を確定</button>
        </div>
      </div>
    </fieldset>
  </section>
}
