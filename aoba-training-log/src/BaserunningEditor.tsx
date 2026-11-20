import { useRef, useState } from 'react'
import type { BaserunningPlay, MatchDetails } from './matchDetails'
import { updateMatchDetails, type MatchTarget } from './matches'
import { errorMessage, type Commit } from './recordFeedback'
import { InputError } from './training'
import { useMatchSaveBar } from './useMatchSaveBar'

type Base = NonNullable<BaserunningPlay['from']>
type Result = NonNullable<BaserunningPlay['result']>
const diamondBases = ['first', 'second', 'third', 'home'] as const
const bases = ['batter', ...diamondBases] as const
const names = { batter: '本塁', first: '一塁', second: '二塁', third: '三塁', home: '本塁' } as const
const points = { batter: [50, 84], first: [84, 50], second: [50, 16], third: [16, 50], home: [50, 84] } as const
const reasons: Record<NonNullable<BaserunningPlay['reason']>, string> = {
  steal: '盗塁', hit: '打球による進塁', wildPitch: '暴投', passedBall: '捕逸', error: '失策',
  other: 'その他', walk: '四球', hitByPitch: '死球', fieldersChoice: '野手選択', sacrifice: '犠打・犠飛', balk: 'ボーク', tagUp: 'タッチアップ',
}
const results: Record<Result, string> = {
  advanced: '進塁', stolenBase: '盗塁成功', caughtStealing: '盗塁失敗', out: '走塁アウト', scored: '得点',
}
const isOut = (result?: Result) => result === 'out' || result === 'caughtStealing'
const isSteal = (result?: Result) => result === 'stolenBase' || result === 'caughtStealing'

export function runningPlayForSave(play: BaserunningPlay, status: BaserunningPlay['status']): BaserunningPlay {
  const { from, result } = play
  const to = isOut(result) ? undefined : play.to
  if (from === 'home' || (from && to && bases.indexOf(from) >= bases.indexOf(to))) {
    throw new InputError('到達塁は出発塁より先の塁を指定してください。')
  }
  if (isSteal(result) && from === 'batter') throw new InputError('盗塁は一塁・二塁・三塁から記録してください。')
  if (status === 'complete') {
    if (!from || !result || (!isOut(result) && !to)) throw new InputError('出発塁、結果、到達した塁を確認してください。')
    if ((result === 'scored' && to !== 'home') || (result === 'advanced' && to === 'home')) {
      throw new InputError('本塁に到達したプレーは得点または盗塁成功として記録してください。')
    }
  }
  return { ...play, to, status, reason: isSteal(result) ? 'steal' : play.reason }
}

export function RunningDiamond({ play, choosingFrom, onSelect }: {
  play: BaserunningPlay; choosingFrom: boolean; onSelect: (base: Exclude<Base, 'batter'>) => void
}) {
  const to = isOut(play.result) ? undefined : play.to
  const path = play.from && to && bases.indexOf(play.from) < bases.indexOf(to)
    ? bases.slice(bases.indexOf(play.from), bases.indexOf(to) + 1).map(base => points[base].join(',')).join(' ') : undefined
  return <figure className="batting-diagram">
    <figcaption>{choosingFrom ? 'ダイヤモンド · 出発塁を選択' : 'ダイヤモンド · 到達塁を選択'}</figcaption>
    <div className="running-diamond">
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <path d="M50 16 84 50 50 84 16 50Z" fill="#397853" stroke="#e4c187" strokeWidth="4" />
        <circle cx="50" cy="50" r="5" fill="#b18757" />
        {path && <polyline points={path} fill="none" stroke="#ffdf86" strokeWidth="2" strokeLinejoin="round" />}
      </svg>
      {diamondBases.map(base => {
        const [x, y] = points[base]
        const from = (play.from === 'batter' ? 'home' : play.from) === base
        const arrived = to === base
        return <button key={base} type="button" className="action running-base" style={{ left: x + '%', top: y + '%' }}
          data-from={from || undefined} data-to={arrived || undefined} disabled={!choosingFrom && isOut(play.result)}
          aria-label={(choosingFrom ? '出発塁' : '到達塁') + '：' + names[base]}
          aria-pressed={choosingFrom ? from : arrived} onClick={() => onSelect(base)}>
          {names[base]}{(from || arrived) && <small>{from && arrived ? '出発・到達' : from ? '出発' : '到達'}</small>}
        </button>
      })}
    </div>
  </figure>
}

export function BaserunningEditor({ target, details, commit, onClose }: {
  target: MatchTarget; details?: MatchDetails; commit: Commit; onClose: () => void
}) {
  const [draft, setDraft] = useState<BaserunningPlay>()
  const [original, setOriginal] = useState<BaserunningPlay>()
  const [choosingFrom, setChoosingFrom] = useState(true)
  const [deleting, setDeleting] = useState<string>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const { editor, saveBar } = useMatchSaveBar(draft !== undefined)
  const rows = [...(details?.baserunning ?? [])].sort((a, b) => a.order - b.order)
  const nextOrder = (items: BaserunningPlay[]) => items.reduce((max, row) => Math.max(max, row.order), 0) + 1

  function edit(row?: BaserunningPlay) {
    setOriginal(row)
    setDraft(row ? { ...row, to: isOut(row.result) ? undefined : row.to }
      : { id: crypto.randomUUID(), order: nextOrder(rows), status: 'draft' })
    setChoosingFrom(true)
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
    <ul className="entries">{rows.map(row => <li key={row.id}>
      <p className="entry-title">第{row.order}プレー <span>{row.status === 'draft' ? '下書き' : '確定'}</span></p>
      <p className="hint">{row.from ? names[row.from] : '出発塁未入力'}{row.to && !isOut(row.result) ? ' → ' + names[row.to] : ''} · {row.result ? results[row.result] : '結果未入力'}</p>
      {deleting === row.id ? <div className="confirmation">
        <p>この走塁プレーを削除しますか？</p>
        <div className="form-actions">
          <button type="button" className="action danger" disabled={busy} onClick={() => void change(items => items.filter(item => item.id !== row.id))}>走塁プレーを削除する</button>
          <button type="button" className="action" disabled={busy} onClick={() => { setDeleting(undefined); setError('') }}>キャンセル</button>
        </div>
      </div> : <div className="form-actions">
        <button type="button" className="action" disabled={busy} onClick={() => edit(row)}>第{row.order}プレーを編集</button>
        <button type="button" className="action" disabled={busy} onClick={() => { setDeleting(row.id); setError('') }}>第{row.order}プレーを削除</button>
      </div>}
    </li>)}</ul>
    <button type="button" className="action filled" disabled={busy} onClick={() => edit()}>走塁プレーを追加</button>
    {error && <p className="error" role="alert">{error}</p>}
  </section>

  const update = (patch: Partial<BaserunningPlay>) => { setDraft({ ...draft, ...patch }); setError('') }
  function save(status: BaserunningPlay['status']) {
    if (!draft) return
    void change(items => {
      const next = runningPlayForSave(draft, status)
      if (!original) return [...items, { ...next, order: nextOrder(items) }]
      if (JSON.stringify(items.find(row => row.id === original.id)) !== JSON.stringify(original)) {
        throw new InputError('この走塁プレーは変更されています。開き直してください。')
      }
      return items.map(row => row.id === next.id ? next : row)
    })
  }
  const selectFrom = (from?: BaserunningPlay['from']) => {
    update({ from })
    if (from && !isOut(draft.result)) setChoosingFrom(false)
  }
  return <section ref={editor} className="card batting-editor batting-editor-with-save">
    <h2>第{draft.order}走塁プレー</h2>
    <fieldset className="batting-form" disabled={busy}>
      <div className="form-actions" role="group" aria-label="選ぶ塁">
        <button type="button" className="action" aria-pressed={choosingFrom} onClick={() => setChoosingFrom(true)}>出発塁</button>
        <button type="button" className="action" aria-pressed={!choosingFrom} disabled={isOut(draft.result)} onClick={() => setChoosingFrom(false)}>到達塁</button>
      </div>
      <RunningDiamond play={draft} choosingFrom={choosingFrom} onSelect={base => choosingFrom
        ? selectFrom(base === 'home' ? 'batter' : base) : update({ to: base })} />
      <p className="hint" role="status">出発 {draft.from ? names[draft.from] : '未選択'} · 到達 {draft.to && !isOut(draft.result) ? names[draft.to] : '未選択'}</p>
      <details className="batting-extra">
        <summary>塁を選択欄から指定</summary>
        <div className="batting-result-fields">
          <label>出発塁<select value={draft.from ?? ''} onChange={event => selectFrom((event.target.value || undefined) as BaserunningPlay['from'])}>
            <option value="">未選択</option>{bases.slice(0, -1).map(base => <option value={base} key={base}>{names[base]}</option>)}</select></label>
          <label>到達塁<select value={draft.to ?? ''} disabled={isOut(draft.result)} onChange={event => update({ to: (event.target.value || undefined) as BaserunningPlay['to'] })}>
            <option value="">未選択</option>{bases.slice(1).map(base => <option value={base} key={base}>{names[base]}</option>)}</select></label>
        </div>
      </details>
      <div className="batting-result-fields">
        <label>結果<select value={draft.result ?? ''} onChange={event => {
          const result = (event.target.value || undefined) as BaserunningPlay['result']
          update({ result, to: isOut(result) ? undefined : draft.to, reason: isSteal(result) ? 'steal' : draft.reason })
          if (isOut(result)) setChoosingFrom(true)
        }}><option value="">未選択</option>{Object.entries(results).map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></label>
        <label>進塁理由（任意）<select value={draft.reason ?? ''} disabled={isSteal(draft.result)}
          onChange={event => update({ reason: (event.target.value || undefined) as BaserunningPlay['reason'] })}>
          <option value="">未選択</option>{Object.entries(reasons).map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></label>
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
