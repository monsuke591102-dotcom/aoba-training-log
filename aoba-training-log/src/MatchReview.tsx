import { useState } from 'react'
import { BallField, StrikeZone } from './BattingDiagrams'
import { ballLabels, droppedThirdStrikeLabels, PlateEditor, reflections, resultLabels } from './BattingEditor'
import type { PlateAppearance } from './matchDetails'
import type { MatchTarget } from './matches'
import type { Commit } from './recordFeedback'

export function MatchReview({ description, appearances, ownerAppearances, target, commit, onClose }: {
  description: string
  appearances: PlateAppearance[]
  ownerAppearances?: PlateAppearance[]
  target?: MatchTarget
  commit: Commit
  onClose: () => void
}) {
  const ordered = [...appearances].sort((a, b) => a.order - b.order)
  const [id, setId] = useState(ordered[0]?.id)
  const [tab, setTab] = useState<'pitch' | 'ball'>('pitch')
  const [editing, setEditing] = useState(false)
  const plate = ordered.find(row => row.id === id) ?? ordered[0]
  const isNonContact = plate?.status === 'complete' && (
    plate.result === 'walk' || plate.result === 'hitByPitch' || plate.result === 'strikeoutSwinging' ||
    plate.result === 'strikeoutLooking' || plate.result === 'droppedThirdStrike'
  )

  if (editing && target && plate) return <PlateEditor key={plate.id} previous={plate} order={plate.order}
    target={target} ownerAppearances={ownerAppearances} commit={commit} onClose={() => setEditing(false)} />

  return <section className="card">
    <button type="button" className="action" onClick={onClose}>練習履歴へ戻る</button>
    <h2>試合の振り返り</h2>
    <p>{description}</p>
    {plate ? <>
      <div className="fields">
        <label>打席を選ぶ
          <select value={plate.id} onChange={event => setId(event.target.value)}>
            {ordered.map(row => <option key={row.id} value={row.id}>第{row.order}打席{row.status === 'draft' ? '（下書き）' : ''}</option>)}
          </select>
        </label>
      </div>
      <p>打席結果 {plate.result ? resultLabels[plate.result] : '未入力'}
        {plate.result === 'droppedThirdStrike' && '（' + (plate.droppedThirdStrikeKind ? droppedThirdStrikeLabels[plate.droppedThirdStrikeKind] : '詳細不明') + '）'}</p>
      <div className="form-actions" role="group" aria-label="振り返りの表示切替">
        <button type="button" className={'action' + (tab === 'pitch' ? ' filled' : '')} aria-pressed={tab === 'pitch'} onClick={() => setTab('pitch')}>投球コース</button>
        <button type="button" className={'action' + (tab === 'ball' ? ' filled' : '')} aria-pressed={tab === 'ball'} onClick={() => setTab('ball')}>打球記録</button>
      </div>
      {tab === 'pitch' ? <>
        <StrikeZone plateResult={plate.result} pitches={plate.pitches ?? []} />
        {!plate.pitches?.length && <p className="hint">投球コースは未記録です。</p>}
      </> : <>
        <BallField point={isNonContact ? undefined : plate.fieldPoint}
          emptyLabel={isNonContact ? '打球記録なし' : undefined} />
        <p>打球性質 {plate.battedBall ? ballLabels[plate.battedBall] : '未記録'} · 打点 {plate.rbi ?? '未記録'}</p>
      </>}
      {reflections.map(([key, label]) => plate[key] && <p className="entry-note" key={key}><strong>{label}</strong> {plate[key]}</p>)}
      {target && <button type="button" className="action" onClick={() => setEditing(true)}>第{plate.order}打席を編集</button>}
    </> : <p className="hint">打席はまだありません。</p>}
  </section>
}
