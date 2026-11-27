import { useId, useRef, useState } from 'react'
import { BallField, pitchLocationLabel, StrikeZone } from './BattingDiagrams'
import { contactPitchResult, displayPitchType, initialPitchTypes, pitchResultError, positions, type Pitch, type PitchLocation, type PitchTypeSnapshot, type PlateAppearance } from './matchDetails'
import { updateMatchDetails, type MatchTarget } from './matches'
import { errorMessage, type Commit } from './recordFeedback'
import { InputError } from './training'
import { useMatchSaveBar } from './useMatchSaveBar'

export const resultLabels: Record<NonNullable<PlateAppearance['result']>, string> = {
  single: '単打', double: '二塁打', triple: '三塁打', homeRun: '本塁打',
  groundOut: 'ゴロアウト', flyOut: 'フライアウト', lineOut: 'ライナーアウト', popOut: 'ポップフライアウト',
  doublePlay: '併殺', triplePlay: '三重殺', strikeoutSwinging: '空振り三振', strikeoutLooking: '見逃し三振',
  walk: '四球', hitByPitch: '死球', reachedOnError: '失策出塁', fieldersChoice: '野手選択',
  sacrificeBunt: '犠打成功', sacrificeFly: '犠飛', interference: '妨害による出塁',
  droppedThirdStrike: '振り逃げ', otherOut: 'その他のアウト',
}
export const droppedThirdStrikeLabels = { swinging: '空振り', looking: '見逃し' } as const
const enablesStrikeoutClassification = __STRIKEOUT_CLASSIFICATION__
export const ballLabels = { grounder: 'ゴロ', liner: 'ライナー', fly: 'フライ', popup: 'ポップフライ', bunt: 'バント' } as const
const buntLabels = { attempted: '試行', succeeded: '成功', failed: '失敗' } as const
const pitchLabels: Record<Pitch['result'], string> = {
  calledStrike: '見逃し', swingingStrike: '空振り', foul: 'ファウル', foulBunt: 'バントのファウル',
  ball: 'ボール', hit: '打球（安打）', inPlayNonHit: '打球（安打以外）', inPlay: '打球（旧記録）', hitByPitch: '死球',
}
export const positionLabels: Record<typeof positions[number], string> = {
  P: '投手', C: '捕手', '1B': '一塁手', '2B': '二塁手', '3B': '三塁手',
  SS: '遊撃手', LF: '左翼手', CF: '中堅手', RF: '右翼手',
}
export const reflections = [['feel', '手応え・良かったこと'], ['reflection', '反省点'], ['improvement', '改善点・次に意識すること']] as const
const tabs = ['投球内容', '打席内容'] as const
const missingResult = '確定するには打席結果を選んでください。'
type PitchDraft = { id?: string; type?: PitchTypeSnapshot; location?: PitchLocation; result?: Pitch['result'] }

function nextOrder(rows: { order: number }[]) {
  return rows.reduce((max, row) => Math.max(max, row.order), 0) + 1
}

function CountSelect({ label, symbol, max, value, onChange }: {
  label: string; symbol: 'B' | 'S' | 'O'; max: number; value: string; onChange: (value: string) => void
}) {
  return <label><span className={'count-dot count-' + symbol}>{symbol}</span> {label}
    <select value={value} onChange={event => onChange(event.target.value)}>
      <option value="">未入力</option>
      {Array.from({ length: max + 1 }, (_, n) => <option key={n} value={n}>{n}</option>)}
    </select>
  </label>
}

const pitchNameKey = (name: string) => name.normalize('NFKC').trim().toLowerCase()

export function pitchCatalog(appearances: readonly PlateAppearance[], previous?: PlateAppearance) {
  const types = new Map<string, PitchTypeSnapshot>(initialPitchTypes.map(type => [pitchNameKey(type.name), type]))
  for (const plate of [...(previous ? [previous] : []), ...appearances]) {
    for (const pitch of plate.pitches ?? []) {
      const type = displayPitchType(pitch.type)
      const key = pitchNameKey(type.name)
      if (!types.has(key)) types.set(key, type)
    }
  }
  return [...types.values()]
}

export function BattingEditor({ target, appearances, ownerAppearances, commit, onClose }: {
  target: MatchTarget; appearances: PlateAppearance[]; ownerAppearances?: PlateAppearance[]; commit: Commit; onClose: () => void
}) {
  const [editing, setEditing] = useState<PlateAppearance | null | undefined>()
  const [deleting, setDeleting] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef(false)

  async function remove(appearance: PlateAppearance) {
    if (pending.current || (!enablesStrikeoutClassification && appearance.droppedThirdStrikeKind)) return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      await commit(data => updateMatchDetails(data, target, details => {
        if ([...details.baserunning, ...details.fielding].some(play => play.plateAppearanceId === appearance.id)) {
          throw new InputError('走塁・守備記録に紐づく打席は削除できません。')
        }
        return { ...details, plateAppearances: details.plateAppearances.filter(row => row.id !== appearance.id) }
      }))
      setDeleting(undefined)
    } catch (error) { setError(errorMessage(error)) }
    finally { pending.current = false; setBusy(false) }
  }

  if (editing !== undefined) {
    return <PlateEditor previous={editing ?? undefined} order={editing?.order ?? nextOrder(appearances)}
      target={target} ownerAppearances={ownerAppearances} commit={commit} onClose={() => setEditing(undefined)} />
  }
  return <section className="card batting-editor">
    <button type="button" className="action" disabled={busy} onClick={onClose}>練習履歴へ戻る</button>
    <h2>打席一覧</h2>
    {!appearances.length && <p className="hint">打席はまだありません。</p>}
    <ul className="entries">
      {[...appearances].sort((a, b) => a.order - b.order).map(row => <li key={row.id}>
        <p className="entry-title">第{row.order}打席 <span>{row.status === 'draft' ? '下書き' : '確定'}</span></p>
        <p className="hint">{row.result ? resultLabels[row.result] : '結果未入力'}
          {row.result === 'droppedThirdStrike' && '（' + (row.droppedThirdStrikeKind ? droppedThirdStrikeLabels[row.droppedThirdStrikeKind] : '詳細不明') + '）'}
          {' · 記録投球数 '}{row.pitches?.length ?? 0}球</p>
        {deleting === row.id ? <div className="confirmation" role="group" aria-label={`第${row.order}打席の削除確認`}>
          <p>この打席と投球・振り返りを削除しますか？</p>
          <div className="form-actions">
            <button type="button" className="action danger" disabled={busy} onClick={() => void remove(row)}>打席を削除する</button>
            <button type="button" className="action" disabled={busy} onClick={() => { setDeleting(undefined); setError('') }}>キャンセル</button>
          </div>
        </div> : <div className="form-actions">
          <button type="button" className="action" disabled={busy} onClick={() => setEditing(row)}>第{row.order}打席を編集</button>
          <button type="button" className="action" disabled={busy || (!enablesStrikeoutClassification && !!row.droppedThirdStrikeKind)}
            onClick={() => { setDeleting(row.id); setError('') }}>第{row.order}打席を削除</button>
        </div>}
      </li>)}
    </ul>
    <button type="button" className="action filled" disabled={busy} onClick={() => setEditing(null)}>打席を追加</button>
    {error && <p role="alert" className="error">{error}</p>}
  </section>
}

export function PlateEditor({ previous, order, target, ownerAppearances = [], commit, onClose }: {
  previous?: PlateAppearance; order: number; target: MatchTarget; ownerAppearances?: PlateAppearance[]; commit: Commit; onClose: () => void
}) {
  const [plate, setPlate] = useState<PlateAppearance>(() => previous ?? { id: crypto.randomUUID(), order, status: 'draft' })
  const [tab, setTab] = useState(0)
  const [pitch, setPitch] = useState<PitchDraft>({})
  const [catalog, setCatalog] = useState(() => pitchCatalog(ownerAppearances, previous))
  const [contactPending, setContactPending] = useState(false)
  const [extraPitch, setExtraPitch] = useState('')
  const [rbiInput, setRbiInput] = useState(plate.rbi?.toString() ?? '')
  const [balls, setBalls] = useState(plate.beforeFinalPitch?.balls.toString() ?? '')
  const [strikes, setStrikes] = useState(plate.beforeFinalPitch?.strikes.toString() ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const { editor, saveBar } = useMatchSaveBar()
  const tabId = useId()
  const pitches = [...(plate.pitches ?? [])].sort((a, b) => a.order - b.order)
  const editedPitch = pitches.find(row => row.id === pitch.id)
  const editedType = editedPitch && displayPitchType(editedPitch.type)
  const pitchTypes = catalog.map(type => editedType && pitchNameKey(type.name) === pitchNameKey(editedType.name) ? editedType : type)
  const previewPitch = pitch.location && pitch.type ? {
    id: pitch.id ?? tabId + '-pending', order: editedPitch?.order ?? nextOrder(pitches), location: pitch.location, type: pitch.type, result: pitch.result,
  } : undefined
  const diagramPitches = previewPitch
    ? [...pitches.filter(row => row.id !== pitch.id), previewPitch]
    : pitches

  function selectPitchType(type: PitchTypeSnapshot) {
    setPitch(current => ({ ...current, type: current.type && displayPitchType(current.type).id === type.id &&
      pitchNameKey(displayPitchType(current.type).name) === pitchNameKey(type.name) ? current.type : type }))
  }
  const pitchPending = Boolean(pitch.id || pitch.type || pitch.location || pitch.result)
  const update = (patch: Partial<PlateAppearance>) => setPlate(current => ({ ...current, ...patch }))

  function savePitch(result?: Pitch['result'], plateResult = plate.result) {
    const { id, location, type } = pitch
    if (!location || !result || !type) return
    const previous = pitches.find(row => row.id === id)
    const row: Pitch = { id: previous?.id ?? crypto.randomUUID(), order: previous?.order ?? nextOrder(pitches), location, result, type }
    const next = previous ? pitches.map(item => item.id === previous.id ? row : item) : [...pitches, row]
    const sequenceError = pitchResultError({ pitches: next })
    if (sequenceError) {
      setError(sequenceError)
      return
    }
    update({ pitches: next, result: plateResult, errorPosition: plateResult === 'reachedOnError' ? plate.errorPosition : undefined,
      droppedThirdStrikeKind: plateResult === 'droppedThirdStrike' ? plate.droppedThirdStrikeKind : undefined })
    setPitch({})
    setContactPending(false)
    setError('')
  }

  function changePlateResult(result: PlateAppearance['result']) {
    const contact = contactPitchResult(result)
    if (contactPending) {
      if (!contact) { setError('打球に対応する打席結果を選ぶか、投球の選択を取り消してください。'); return }
      savePitch(editedPitch?.result === 'inPlay' ? 'inPlay' : contact, result)
      return
    }
    const terminal = pitches.at(-1)
    const hasContact = terminal?.result === 'hit' || terminal?.result === 'inPlayNonHit'
    if (hasContact && result && !contact) {
      setError('最後の投球は打球です。先に投球内容で最後の投球を訂正または削除してください。')
      return
    }
    update({ result, errorPosition: result === 'reachedOnError' ? plate.errorPosition : undefined,
      droppedThirdStrikeKind: result === 'droppedThirdStrike' ? plate.droppedThirdStrikeKind : undefined,
      ...(hasContact && contact && { pitches: pitches.map(row => row === terminal ? { ...row, result: contact } : row) }) })
    setError('')
  }

  function replacePitchHistory(rows: Pitch[]) {
    update({ pitches: rows })
    setPitch({})
    setContactPending(false)
    setError('')
  }

  async function save(status: PlateAppearance['status']) {
    if (pending.current) return
    setError('')
    if (pitchPending) { setTab(0); setError('入力中の投球は、投球結果（「打球」の場合は打席結果まで）を選ぶか、投球の選択を取り消してください。'); return }
    if ((balls === '') !== (strikes === '')) { setTab(0); setError('最終投球前カウントはBとSを両方指定してください。'); return }
    if (status === 'complete' && !plate.result) { setTab(1); setError(missingResult); return }
    const resultError = pitchResultError(plate)
    if (resultError) { setTab(1); setError(resultError); return }
    const rbiText = rbiInput.trim()
    const rbi = rbiText === '' ? undefined : Number(rbiText)
    if (rbi !== undefined && (!/^\d+$/.test(rbiText) || !Number.isSafeInteger(rbi))) {
      setTab(1)
      setError('打点は0以上の正確に記録できる整数で入力してください。')
      return
    }
    pending.current = true
    setBusy(true)
    const next = { ...plate, status, rbi,
      beforeFinalPitch: balls === '' ? undefined : { balls: Number(balls), strikes: Number(strikes) } }
    try {
      await commit(data => updateMatchDetails(data, target, details => {
        const rows = details.plateAppearances
        const stored = rows.find(row => row.id === next.id)
        if (previous && (!stored || JSON.stringify(previous) !== JSON.stringify(stored))) {
          throw new InputError('この打席は別の操作で変更されました。内容を確認してから編集し直してください。')
        }
        return { ...details, plateAppearances: previous
          ? rows.map(row => row.id === next.id ? next : row)
          : [...rows, { ...next, order: nextOrder(rows) }] }
      }))
      onClose()
    } catch (error) { setError(errorMessage(error)) }
    finally { pending.current = false; setBusy(false) }
  }

  if (!enablesStrikeoutClassification && previous?.droppedThirdStrikeKind) return <section className="card">
    <p>振り逃げの内訳を保護するため、この互換版ではこの打席を読み取り専用で扱います。</p>
    <button type="button" className="action" onClick={onClose}>戻る</button>
  </section>

  return <section className="card batting-editor batting-editor-with-save" ref={editor}>
    <h2>第{plate.order}打席</h2>
    <fieldset className="batting-form" disabled={busy}>
      <div className="batting-tabs" role="tablist" aria-label="打席の入力区分">
        {tabs.map((label, index) => <button key={label} type="button" className="action" id={tabId + '-tab-' + index}
          role="tab" aria-selected={tab === index} aria-controls={tabId + '-panel'} tabIndex={tab === index ? 0 : -1}
          onClick={() => setTab(index)} onKeyDown={event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
            event.preventDefault()
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - index
            setTab(next)
            event.currentTarget.ownerDocument.getElementById(tabId + '-tab-' + next)?.focus()
          }}>{index === 0 ? '① ' : '② '}{label}</button>)}
      </div>
      <div id={tabId + '-panel'} role="tabpanel" aria-labelledby={tabId + '-tab-' + tab} className="batting-panel">
        {tab === 0 ? <>
          <div className="batting-choices" role="group" aria-label="打席の左右（任意）">
            <button type="button" className="action" aria-pressed={plate.batterSide === 'right'}
              onClick={() => update({ batterSide: 'right' })}>右打者</button>
            <button type="button" className="action" aria-pressed={plate.batterSide === 'left'}
              onClick={() => update({ batterSide: 'left' })}>左打者</button>
            <button type="button" className="action" aria-pressed={plate.batterSide === undefined}
              onClick={() => update({ batterSide: undefined })}>未記録</button>
          </div>
          <StrikeZone location={pitch.location} pitches={diagramPitches} plateResult={plate.result}
            onSelect={location => setPitch(current => ({ ...current, location }))} />
          <fieldset className="batting-choices"><legend>球種</legend>
            {pitchTypes.map(type => <button key={pitchNameKey(type.name)} type="button" className="action"
              aria-pressed={pitch.type && pitchNameKey(displayPitchType(pitch.type).name) === pitchNameKey(type.name)}
              onClick={() => selectPitchType(type)}>{type.symbol ? type.symbol + ' ' : ''}{type.name}</button>)}
          </fieldset>
          <details className="batting-extra">
            <summary>別の球種を入力</summary>
            <label>球種名<input value={extraPitch} onChange={event => setExtraPitch(event.target.value)} /></label>
            <button type="button" className="action" disabled={!extraPitch.trim()} onClick={() => {
              const name = extraPitch.trim()
              const existing = pitchTypes.find(item => pitchNameKey(item.name) === pitchNameKey(name))
              const type = existing ?? (/^ストレート[（(][速遅][）)]$/.test(name)
                ? initialPitchTypes[0] : { id: crypto.randomUUID(), name })
              if (!catalog.some(item => item.id === type.id)) setCatalog(current => [...current, type])
              selectPitchType(type)
              setExtraPitch('')
            }}>この球種を選択</button>
          </details>
          <p className="hint" id={tabId + '-pitch-result-hint'}>
            球種と位置を選び、投球結果を押すと投球一覧に反映されます。「打球」は次の画面で打席結果を選んでから反映されます。端末に保存するには「下書き保存」または「打席を確定」を押してください。
          </p>
          <fieldset className="batting-choices" aria-describedby={tabId + '-pitch-result-hint'}><legend>投球結果</legend>
            <button type="button" className="action" disabled={!pitch.location || !pitch.type}
              onClick={() => {
                setContactPending(true)
                setError('')
                setTab(1)
                requestAnimationFrame(() => document.getElementById(tabId + '-result')?.focus())
              }}>打球</button>
            {Object.entries(pitchLabels).filter(([value]) => value !== 'hit' && value !== 'inPlayNonHit' && (value !== 'inPlay' || editedPitch?.result === 'inPlay')).map(([value, label]) => <button key={value} type="button" className="action"
              disabled={!pitch.location || !pitch.type} aria-pressed={pitch.result === value}
              onClick={() => savePitch(value as Pitch['result'])}>{label}</button>)}
          </fieldset>
          <div className="form-actions">
            <button type="button" className="action" disabled={!pitches.length}
              onClick={() => replacePitchHistory(pitches.slice(0, -1))}>投球を取り消し</button>
            <button type="button" className="action danger" disabled={!pitches.length} onClick={() => {
              if (window.confirm('この打席の投球履歴をすべて削除しますか？')) replacePitchHistory([])
            }}>全てリセット</button>
            {editedPitch && <button type="button" className="action filled" disabled={!pitch.location || !pitch.type}
              onClick={() => savePitch(pitch.result)}>投球を更新</button>}
            {pitchPending && <button type="button" className="action" onClick={() => { setPitch({}); setContactPending(false); setError('') }}>投球の選択を取り消す</button>}
          </div>
          <p className="hint" role="status">{pitch.location ? '投球位置：' + pitchLocationLabel(pitch.location) : '投球は省略できます。'}</p>
          {pitches.length > 0 && <ol className="entries" aria-label="記録した投球">
            {pitches.map(row => {
              const type = displayPitchType(row.type)
              return <li key={row.id}>
                <p>{row.order}球目 · {type.symbol} {type.name} · {pitchLabels[row.result]} · {pitchLocationLabel(row.location)}</p>
                <div className="form-actions">
                  <button type="button" className="action" onClick={() => { setPitch(row); setContactPending(false); setError('') }}>{row.order}球目を編集</button>
                  <button type="button" className="action" onClick={() => {
                    update({ pitches: pitches.filter(item => item.id !== row.id).map((item, index) => ({ ...item, order: index + 1 })) })
                    if (pitch.id === row.id) { setPitch({}); setContactPending(false) }
                    setError('')
                  }}>{row.order}球目を削除</button>
                </div>
              </li>
            })}
          </ol>}
          <p className="hint">記録投球数 {pitches.length}球（ここに登録した投球の数）</p>
          {plate.pitchCount !== undefined && <p className="hint">旧記録の手入力球数 {plate.pitchCount}球</p>}
          <fieldset className="batting-counts"><legend>最終投球前カウント（任意）</legend>
            <CountSelect label="ストライク" symbol="S" max={2} value={strikes} onChange={setStrikes} />
            <CountSelect label="ボール" symbol="B" max={3} value={balls} onChange={setBalls} />
          </fieldset>
          <CountSelect label="アウト数（打席時・任意）" symbol="O" max={2} value={plate.outs?.toString() ?? ''}
            onChange={value => update({ outs: value === '' ? undefined : Number(value) })} />
        </> : <div className="batting-result-fields">
          {contactPending && <div>
            <p className="hint">打席結果を選ぶと、選択中の投球を打球として記録します。</p>
            <button type="button" className="action" onClick={() => { setPitch({}); setContactPending(false); setError(''); setTab(0) }}>投球の選択を取り消す</button>
          </div>}
          <label>打席結果<select id={tabId + '-result'} value={contactPending ? '' : plate.result ?? ''}
            onChange={event => changePlateResult((event.target.value || undefined) as PlateAppearance['result'])}>
            <option value="">未入力</option>{Object.entries(resultLabels).map(([value, label]) => <option key={value} value={value}
              disabled={contactPending && !contactPitchResult(value as PlateAppearance['result'])}>{label}</option>)}
          </select></label>
          {plate.result === 'droppedThirdStrike' && enablesStrikeoutClassification && <label>振り逃げの内訳
            <select value={plate.droppedThirdStrikeKind ?? ''} onChange={event => {
              const kind = event.target.value
              update({ droppedThirdStrikeKind: kind === 'swinging' || kind === 'looking' ? kind : undefined })
            }}>
              <option value="">詳細不明</option>
              {Object.entries(droppedThirdStrikeLabels).map(([kind, label]) => <option key={kind} value={kind}>{label}による振り逃げ</option>)}
            </select>
          </label>}
          <BallField point={plate.fieldPoint} onSelect={fieldPoint => update({ fieldPoint })} />
          <label>打球の種類<select value={plate.battedBall ?? ''} onChange={event => update({ battedBall: (event.target.value || undefined) as PlateAppearance['battedBall'] })}>
            <option value="">未入力</option>{Object.entries(ballLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
          <label>打点（RBI・任意）
            <input inputMode="numeric" value={rbiInput} onChange={event => setRbiInput(event.target.value)}
              aria-describedby={tabId + '-rbi-hint'} />
          </label>
          <p className="hint" id={tabId + '-rbi-hint'}>公式記録の打点を入力します。打点なしと確認できた場合は「0」、未確認の場合は空欄にします。</p>
          {plate.result === 'reachedOnError' && <label>失策した守備位置（任意）
            <select value={plate.errorPosition ?? ''} onChange={event => update({ errorPosition: (event.target.value || undefined) as PlateAppearance['errorPosition'] })}>
              <option value="">未入力</option>{positions.map(position => <option key={position} value={position}>{positionLabels[position]}</option>)}
            </select>
          </label>}
          <label>バントの試行・成否<select value={plate.bunt ?? ''} onChange={event => update({ bunt: (event.target.value || undefined) as PlateAppearance['bunt'] })}>
            <option value="">未入力</option>{Object.entries(buntLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
          <p className="hint">バント安打は「単打」と「バント」、試行の結果は「バントの試行・成否」に記録します。</p>
        </div>}
      </div>
      <fieldset className="fields"><legend>打席の振り返り（任意）</legend>
        {reflections.map(([key, label]) => <label key={key}>{label}<textarea rows={2} value={plate[key] ?? ''}
          onChange={event => update({ [key]: event.target.value })} /></label>)}
      </fieldset>
      <div><button type="button" className="action" onClick={onClose}>キャンセル</button></div>
      <div className="batting-save-bar" ref={saveBar} role="group" aria-label="打席の保存">
        {error && <p role="alert" className="error">{error}</p>}
        <div className="batting-save-actions">
          <button type="button" className="action" onClick={() => void save('draft')}>下書き保存</button>
          <button type="button" className="action filled" onClick={() => void save('complete')}>打席を確定</button>
        </div>
      </div>
    </fieldset>
  </section>
}
