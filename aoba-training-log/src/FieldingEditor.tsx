import { useRef, useState } from 'react'
import { BallField } from './BattingDiagrams'
import { positionLabels } from './BattingEditor'
import { fieldingOpportunityError, fieldingPlayTypes, positions,
  type FieldingOpportunity, type FieldingPlay, type MatchDetails } from './matchDetails'
import { updateMatchDetails, type MatchTarget } from './matches'
import { errorMessage, type Commit } from './recordFeedback'
import { InputError } from './training'
import { useMatchSaveBar } from './useMatchSaveBar'

const plays: Record<NonNullable<FieldingPlay['playType']>, string> = {
  grounder: 'ゴロ', liner: 'ライナー', fly: 'フライ', bunt: 'バント', throw: '送球', tag: 'タッチ',
  force: 'フォースプレー', cover: 'ベースカバー', other: 'その他', noBall: '打球なし',
}
const credits = [['putout', 'PO（刺殺）'], ['assist', 'A（補殺）'], ['error', 'E（失策）']] as const
const noBallKinds = { pickoff: '牽制', caughtStealing: '盗塁阻止', other: 'その他' }
const catchResults = { success: '捕球成功', failure: '捕球失敗（捕球エラー）', notApplicable: '捕球なし・対象外' }
const throwResults = { success: '旧記録：送球成功', error: '送球エラー', notApplicable: '旧記録：送球なし・対象外' }
const outcomes = { out: 'アウト', safe: 'セーフ', notApplicable: '結果対象外' }
export const fieldingSkills = [['catching', '捕球'], ['throwing', '送球'], ['judgment', '判断'], ['baseCover', 'ベースカバー'], ['other', 'その他']] as const
const reflections = [['feel', '良かったこと'], ['reflection', '反省点'], ['improvement', '次に意識すること']] as const
const nextOrder = (items: readonly { order: number }[]) => items.reduce((max, row) => Math.max(max, row.order), 0) + 1
const ordered = <T extends { order: number }>(items: readonly T[]) => [...items].sort((a, b) => a.order - b.order)

function ResultSelect<T extends string>({ label, choices, value, onChange }: {
  label: string; choices: Record<T, string>; value?: T; onChange: (value?: T) => void
}) {
  return <label>{label}<select value={value ?? ''} onChange={event => onChange((event.target.value || undefined) as T)}>
    <option value="">未記録</option>
    {Object.entries(choices).map(([key, text]) => <option key={key} value={key}>{text as string}</option>)}
  </select></label>
}

const inningLabel = (inning?: number) => inning === undefined ? 'イニング未記録' : `${inning}イニング目`

export function suggestFieldingCredit(play: FieldingPlay): 'putout' | undefined {
  const chance = play.opportunity
  if ((play.playType === 'fly' || play.playType === 'liner') && chance?.catchResult === 'success' &&
    chance.outcome === 'out' && (!chance.throwResult || chance.throwResult === 'notApplicable')) return 'putout'
}

function LegacyNotes({ play }: { play: FieldingPlay }) {
  if (!play.development?.length && !reflections.some(([key]) => play[key])) return null
  return <details className="batting-extra">
    <summary>旧記録の育成観察・振り返り</summary>
    {play.development?.map(({ skill, note }, index) => <p className="entry-note" key={index}>
      <strong>{fieldingSkills.find(([key]) => key === skill)?.[1]}</strong> {note}
    </p>)}
    {reflections.map(([key, label]) => play[key] && <p className="entry-note" key={key}><strong>{label}</strong> {play[key]}</p>)}
  </details>
}

export function FieldingEditor({ target, details, commit, onClose }: {
  target: MatchTarget; details?: MatchDetails; commit: Commit; onClose: () => void
}) {
  const [draft, setDraft] = useState<FieldingPlay>()
  const [inning, setInning] = useState('')
  const [original, setOriginal] = useState<FieldingPlay>()
  const [deleting, setDeleting] = useState<string>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const { editor, saveBar } = useMatchSaveBar(draft !== undefined)
  const rows = ordered(details?.fielding ?? [])
  const changes = ordered(details?.positionChanges ?? [])
  const suggestion = draft && suggestFieldingCredit(draft)
  const needsCreditReview = original?.credits !== undefined && suggestion !== suggestFieldingCredit(original) &&
    (Boolean(suggestion) !== (draft?.credits?.includes('putout') ?? false))

  async function transact(edit: (current: MatchDetails) => MatchDetails) {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      await commit(data => updateMatchDetails(data, target, edit))
      setDraft(undefined)
      setDeleting(undefined)
      window.scrollTo(0, 0)
    } catch (error) { setError(errorMessage(error)) }
    finally { pending.current = false; setBusy(false) }
  }

  function openPlay(row?: FieldingPlay) {
    const previous = rows.findLast(item => item.status === 'complete')
    setOriginal(row)
    setDraft(row ?? { id: crypto.randomUUID(), order: nextOrder(rows), status: 'draft',
      position: previous?.position, opportunity: {} })
    setInning((row ? row.opportunity?.inning : previous?.opportunity?.inning)?.toString() ?? '')
    setError('')
    window.scrollTo(0, 0)
  }

  function savePlay(status: FieldingPlay['status']) {
    if (!draft) return
    if (needsCreditReview && !window.confirm('プレー内容の変更で公式記録の候補が変わりました。現在選択している公式記録のまま保存しますか？')) return
    void transact(current => {
      if (status === 'complete' && (!draft.position || !draft.playType)) throw new InputError('守備位置とプレー種類を選んでください。')
      if (original && JSON.stringify(current.fielding.find(row => row.id === original.id)) !== JSON.stringify(original)) {
        throw new InputError('この守備プレーは変更されています。開き直してください。')
      }
      const input = inning.trim()
      const inningValue = input === '' ? undefined : /^\d+$/.test(input) ? Number(input) : Number.NaN
      const opportunity = { ...draft.opportunity, inning: inningValue }
      if (status === 'complete' && opportunity.throwResult === 'error' && opportunity.outcome === undefined) {
        opportunity.outcome = 'notApplicable'
      }
      const hasDetails = !original || original.opportunity !== undefined || draft.playType === 'noBall' ||
        Object.values(opportunity).some(value => value !== undefined)
      const row = { ...draft, status, opportunity: hasDetails ? opportunity : undefined }
      const validation = fieldingOpportunityError(row)
      if (validation) throw new InputError(validation)
      return { ...current, fielding: original ? current.fielding.map(item => item.id === row.id ? row : item)
        : [...current.fielding, { ...row, order: nextOrder(current.fielding) }] }
    })
  }

  if (!draft) return <section className="card batting-editor fielding-editor">
    <button type="button" className="action" disabled={busy} onClick={onClose}>練習履歴へ戻る</button>
    <h2>守備記録</h2>
    {details?.source.fielding === 'summary' && <p className="hint">集計元は簡易記録です。守備プレーを保存しても集計元は維持します。</p>}
    <p className="hint">試合の振り返りは、練習履歴で試合全体を編集して記録します。</p>
    <button type="button" className="action filled" disabled={busy} onClick={() => openPlay()}>守備プレーを追加</button>
    <h3>守備履歴</h3>
    {!rows.length && <p className="hint">守備プレーはまだありません。</p>}
    {changes.length > 0 && <p className="hint">旧記録の守備位置履歴も表示します。同じイニング内で位置変更とプレーの前後関係は不明です。</p>}
    <ul className="entries">{[
      ...changes.map(row => ({ kind: 'position' as const, inning: row.inning, row })),
      ...rows.map(row => ({ kind: 'play' as const, inning: row.opportunity?.inning, row })),
    ].sort((a, b) => (a.inning ?? Infinity) - (b.inning ?? Infinity)).map(entry => {

      if (entry.kind === 'position') return <li key={'position:' + entry.row.id}>
        <p className="entry-title">守備位置の変更（旧記録）</p>
        <p className="hint">{inningLabel(entry.inning)} · {positionLabels[entry.row.position]} · プレーとの前後関係は不明</p>
      </li>
      const row = entry.row
      return <li key={'play:' + row.id}>
      <p className="entry-title">第{row.order}プレー <span>{row.status === 'draft' ? '下書き' : '確定'}</span></p>
      <p className="hint">{inningLabel(row.opportunity?.inning)} · {row.position ? positionLabels[row.position] : '位置未選択'} · {row.playType ? plays[row.playType] : '種類未選択'}
        {row.opportunity?.noBallKind && ' · ' + noBallKinds[row.opportunity.noBallKind]}
      </p>
      {row.opportunity && <p className="hint">
        {row.opportunity.catchResult ? catchResults[row.opportunity.catchResult] : '捕球結果未記録'} ·{' '}
        {row.opportunity.throwResult && throwResults[row.opportunity.throwResult] + ' · '}
        {row.opportunity.outcome ? outcomes[row.opportunity.outcome] : 'アウト・セーフ未記録'}
      </p>}
      <p className="hint">{row.credits === undefined ? '公式記録未入力' : row.credits.length
        ? credits.filter(([key]) => row.credits?.includes(key)).map(([, label]) => label).join('・') : '公式記録なし'}</p>
      <LegacyNotes play={row} />
      {deleting === row.id ? <div className="confirmation" role="group" aria-label="守備プレーの削除確認">
        <p>第{row.order}プレーを削除しますか？</p>
        <button type="button" className="action danger" disabled={busy} onClick={() => void transact(current =>
          ({ ...current, fielding: current.fielding.filter(item => item.id !== row.id) }))}>第{row.order}プレーを削除する</button>
        <button type="button" className="action" disabled={busy} onClick={() => { setDeleting(undefined); setError('') }}>キャンセル</button>
      </div> : <div className="form-actions">
        <button type="button" className="action" disabled={busy} onClick={() => openPlay(row)}>第{row.order}プレーを編集</button>
        <button type="button" className="action" disabled={busy} onClick={() => { setDeleting(row.id); setError('') }}>第{row.order}プレーを削除</button>
      </div>}
    </li>})}</ul>
    {error && <p className="error" role="alert">{error}</p>}
  </section>

  const update = (patch: Partial<FieldingPlay>) => {
    setDraft(current => current && { ...current, ...patch })
    setError('')
  }
  const updateOpportunity = (patch: Partial<FieldingOpportunity>) => update({ opportunity: { ...draft.opportunity, ...patch } })
  const oldPlayType = original?.playType
  const throwingError = draft.opportunity?.throwResult === 'error'
  const oldThrowResult = original?.opportunity?.throwResult
  return <section ref={editor} className="card batting-editor fielding-editor batting-editor-with-save">
    <h2>第{draft.order}守備プレー</h2>
    <fieldset className="batting-form" disabled={busy}>
      <fieldset className="batting-result-fields"><legend>守備機会</legend>
        <label>イニング
          <input inputMode="numeric" value={inning} onChange={event => { setInning(event.target.value); setError('') }} placeholder="例：1" />
        </label>
        {inning.trim() && /^\d+$/.test(inning.trim()) && Number(inning) >= 1 && <p className="hint">{inningLabel(Number(inning))}</p>}
        <ResultSelect label="守備位置" choices={positionLabels} value={draft.position} onChange={position => update({ position })} />
        <label>プレー種類<select value={draft.playType ?? ''} onChange={event => {
          const playType = (event.target.value || undefined) as FieldingPlay['playType']
          const opportunity = playType === 'noBall' ? draft.opportunity ?? {}
            : draft.opportunity && { ...draft.opportunity, noBallKind: undefined }
          update({ playType, opportunity })
        }}>
          <option value="">未選択</option>
          {Object.entries(plays).filter(([key]) => fieldingPlayTypes.some(type => type === key) || key === oldPlayType)
            .map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select></label>
        {draft.playType === 'noBall' && <ResultSelect label="打球なしの内訳（任意）" choices={noBallKinds}
          value={draft.opportunity?.noBallKind} onChange={noBallKind => updateOpportunity({ noBallKind })} />}
      </fieldset>
      <fieldset className="batting-result-fields"><legend>結果</legend>
        <ResultSelect label="捕球結果" choices={catchResults} value={draft.opportunity?.catchResult}
          onChange={catchResult => updateOpportunity({ catchResult })} />
        <fieldset className="batting-result-fields"><legend>プレー結果</legend>
          <ResultSelect label={draft.playType === 'noBall' || throwingError ? 'アウト・セーフ（任意）' : 'アウト・セーフ'}
            choices={outcomes} value={draft.opportunity?.outcome} onChange={outcome => updateOpportunity({ outcome })} />
          <div className="form-actions">
            <button type="button" className="action" aria-pressed={throwingError} onClick={() => updateOpportunity({
              throwResult: throwingError ? (oldThrowResult === 'error' ? undefined : oldThrowResult) : 'error',
            })}>送球エラー</button>
          </div>
          <p className="hint">送球エラーはアウト・セーフと併記できます。省略時は「結果対象外」で保存します。公式記録のEは下の欄で指定します。</p>
        </fieldset>
      </fieldset>
      <fieldset className="batting-choices"><legend>公式記録</legend>
        {suggestion && <p className="hint">候補：PO（刺殺）。捕球したフライ・ライナーがアウトの場合の候補です。公式記録を確認して下のボタンで選択してください。</p>}
        {needsCreditReview && <p className="hint">プレー内容の変更で候補が変わりました。選択中の公式記録を確認してください。</p>}
        <button type="button" className="action" aria-pressed={draft.credits === undefined}
          onClick={() => update({ credits: undefined })}>公式記録未入力</button>
        <button type="button" className="action" aria-pressed={draft.credits?.length === 0}
          onClick={() => update({ credits: [] })}>公式記録なし</button>
        {credits.map(([key, label]) => <button type="button" key={key} className="action" aria-pressed={draft.credits?.includes(key) ?? false}
          onClick={() => update({ credits: draft.credits?.includes(key) ? draft.credits.filter(item => item !== key) : [...draft.credits ?? [], key] })}>{label}</button>)}
      </fieldset>
      <details className="batting-extra">
        <summary>打球・プレー位置（任意）</summary>
        <BallField point={draft.fieldPoint} onSelect={fieldPoint => update({ fieldPoint })} />
      </details>
      <LegacyNotes play={draft} />
      <div><button type="button" className="action" onClick={() => { setDraft(undefined); setError('') }}>キャンセル</button></div>
      <div ref={saveBar} className="batting-save-bar" role="group" aria-label="守備記録の保存">
        {error && <p className="error" role="alert">{error}</p>}
        <div className="batting-save-actions">
          <button type="button" className="action" onClick={() => savePlay('draft')}>下書き保存</button>
          <button type="button" className="action filled" onClick={() => savePlay('complete')}>守備プレーを確定</button>
        </div>
      </div>
    </fieldset>
  </section>
}
