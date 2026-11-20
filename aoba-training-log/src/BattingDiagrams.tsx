import type { KeyboardEvent, MouseEvent } from 'react'
import type { Pitch, PitchLocation, PlateAppearance } from './matchDetails'

const rows = ['高め', '中央', '低め'] as const
const columns = ['左', '中央', '右'] as const
const outside = [
  ['highLeft', '左上', '1', '1'], ['high', '上', '1', '2 / 5'], ['highRight', '右上', '1', '5'],
  ['left', '左', '2 / 5', '1'], ['right', '右', '2 / 5', '5'],
  ['lowLeft', '左下', '5', '1'], ['low', '下', '5', '2 / 5'], ['lowRight', '右下', '5', '5'],
] as const
const cells = [0, 1, 2] as const

export function pitchLocationLabel(location: PitchLocation) {
  if (location.zone === 'outside') return 'ゾーン外・' + outside.find(([side]) => side === location.side)?.[1]
  return rows[location.row] + '・' + columns[location.column]
}

function sameLocation(a: PitchLocation, b: PitchLocation) {
  return a.zone === 'inside'
    ? b.zone === 'inside' && a.row === b.row && a.column === b.column
    : b.zone === 'outside' && a.side === b.side
}

export function StrikeZone({ location, pitches, onSelect }: {
  location?: PitchLocation; pitches: Pitch[]; onSelect: (location: PitchLocation) => void
}) {
  function cell(value: PitchLocation, gridRow: string, gridColumn: string) {
    const label = pitchLocationLabel(value)
    const markers = pitches.filter(pitch => sameLocation(pitch.location, value))
    return <button key={label} type="button" className={'zone-cell zone-' + value.zone}
      style={{ gridRow, gridColumn }} aria-label={label} aria-pressed={location !== undefined && sameLocation(location, value)}
      onClick={() => onSelect(value)}>
      {value.zone === 'outside' && <span className="zone-edge" aria-hidden="true">{label.replace('ゾーン外・', '')}</span>}
      {markers.length > 0 && <span className="zone-markers" aria-hidden="true">
        {markers.map(pitch => <span key={pitch.id}>{pitch.order}</span>)}
      </span>}
    </button>
  }
  return <figure className="batting-diagram">
    <figcaption>投球コース · 捕手視点</figcaption>
    <div className="strike-scene">
      <svg className="right-batter" viewBox="0 0 64 110" aria-hidden="true">
        <path d="M17 24 5 3M19 30l14 13 10-5M34 46l-12 7M23 56 16 78l-7 22m14-21 15 18 9 3M15 102H4m43 0h9"
          fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M15 32c1-7 13-9 17-1l3 22-13 12-11-13Z" fill="currentColor" />
        <circle cx="29" cy="19" r="9" fill="currentColor" /><path d="M21 19h23" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      </svg>
      <div className="strike-grid" role="group" aria-label="ストライクゾーンとゾーン外">
        {outside.map(([side, , row, column]) => cell({ zone: 'outside', side }, row, column))}
        {cells.flatMap(row => cells.map(column => cell({ zone: 'inside', row, column }, String(row + 2), String(column + 2))))}
      </div>
    </div>
    <p className="hint">右打者は左側。枠の外側も選べます。番号は記録した投球順です。</p>
  </figure>
}

type FieldPoint = NonNullable<PlateAppearance['fieldPoint']>
const clamp = (value: number) => Math.max(0, Math.min(1, value))
export const normalizeFieldPoint = (x: number, y: number, width: number, height: number): FieldPoint => ({
  x: clamp(x / width), y: clamp(y / height),
})

export function BallField({ point, onSelect }: { point?: FieldPoint; onSelect: (point?: FieldPoint) => void }) {
  function tap(event: MouseEvent<HTMLButtonElement>) {
    if (event.detail === 0) {
      if (!point) onSelect({ x: .5, y: .5 })
      return
    }
    const box = event.currentTarget.getBoundingClientRect()
    if (box.width && box.height) onSelect(normalizeFieldPoint(event.clientX - box.left, event.clientY - box.top, box.width, box.height))
  }
  function move(event: KeyboardEvent<HTMLButtonElement>) {
    const arrows = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']
    if (!arrows.includes(event.key)) return
    event.preventDefault()
    const step = event.shiftKey ? .01 : .05
    const { x, y } = point ?? { x: .5, y: .5 }
    onSelect({
      x: clamp(x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0)),
      y: clamp(y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0)),
    })
  }
  return <figure className="batting-diagram">
    <figcaption>打球位置 · 上から見た球場</figcaption>
    <button type="button" className="ball-field" aria-label="球場図で打球位置を指定" aria-describedby="ball-field-help"
      onClick={tap} onKeyDown={move}>
      <svg viewBox="0 0 300 260" aria-hidden="true">
        <path d="M150 237 20 105Q51 22 150 17q99 5 130 88Z" fill="#285f48" stroke="#9ad1a5" strokeWidth="3" />
        <path d="M150 237 55 138 150 47l95 91Z" fill="#337653" />
        <path d="M150 238 91 179l59-59 59 59Z" fill="#b18757" stroke="#e4c187" strokeWidth="4" />
        <path d="m150 217-39-38 39-39 39 39Z" fill="#397853" />
        <path d="M150 237 20 105m130 132 130-132" stroke="#ecf1dd" strokeWidth="2" />
        <path d="m150 122 6 6-6 6-6-6Zm53 53 6 6-6 6-6-6Zm-106 0 6 6-6 6-6-6Z" fill="#f2f4ec" />
        <circle cx="150" cy="182" r="10" fill="#b18757" /><path d="M145 234h10v5l-5 4-5-4Z" fill="#fff" />
        {point && <g>
          <line x1="150" y1="237" x2={point.x * 300} y2={point.y * 260} stroke="#ffdc83" strokeWidth="2.5" strokeDasharray="5 4" />
          <circle cx={point.x * 300} cy={point.y * 260} r="7" fill="#ffdc83" stroke="#15243d" strokeWidth="2.5" />
        </g>}
      </svg>
    </button>
    <p className="hint" id="ball-field-help">図をタップ。キーボードでは矢印で移動、Shift＋矢印で微調整できます。位置は目安です。</p>
    <p className="hint" role="status">{point ? `選択位置：左から ${Math.round(point.x * 100)}%、上から ${Math.round(point.y * 100)}%` : '打球位置は未入力'}</p>
    {point && <button type="button" className="action" onClick={() => onSelect()}>打球位置を解除</button>}
  </figure>
}
