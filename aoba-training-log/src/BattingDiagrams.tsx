import type { KeyboardEvent, MouseEvent, PropsWithChildren } from 'react'
import { displayPitchType, type Pitch, type PitchLocation, type PlateAppearance } from './matchDetails'

type FieldPoint = NonNullable<PlateAppearance['fieldPoint']>
const clamp = (value: number) => Math.max(0, Math.min(1, value))
export const normalizeFieldPoint = (x: number, y: number, width: number, height: number): FieldPoint => ({
  x: clamp(x / width), y: clamp(y / height),
})

const rows = ['高め', '中央', '低め'] as const
const columns = ['左', '中央', '右'] as const
const outside = {
  highLeft: ['左上', .1, .1], high: ['上', .5, .1], highRight: ['右上', .9, .1],
  left: ['左', .1, .5], right: ['右', .9, .5],
  lowLeft: ['左下', .1, .9], low: ['下', .5, .9], lowRight: ['右下', .9, .9],
} as const
const zoneMin = .2
const zoneMax = .8

export function pitchPoint(location: PitchLocation): FieldPoint {
  if (location.zone === 'point') return { x: location.x, y: location.y }
  if (location.zone === 'outside') {
    const [, x, y] = outside[location.side]
    return { x, y }
  }
  return { x: (3 + location.column * 2) / 10, y: (3 + location.row * 2) / 10 }
}

export function pitchLocationLabel(location: PitchLocation) {
  if (location.zone === 'outside') return 'ゾーン外・' + outside[location.side][0]
  if (location.zone === 'inside') return rows[location.row] + '・' + columns[location.column]
  const { x, y } = location
  const inside = x >= zoneMin && x <= zoneMax && y >= zoneMin && y <= zoneMax
  return `${inside ? 'ゾーン内' : 'ゾーン外'} · 左から ${Math.round(x * 100)}%、上から ${Math.round(y * 100)}%`
}

type DiagramPitch = Pick<Pitch, 'id' | 'order' | 'type' | 'location'>
type BatterSide = 'left' | 'right'

// Keep the recorded anchor exact. Each label occupies the nearest available cell.
const markerColumns = 6
const markerRows = 9

function pitchMarkers(pitches: DiagramPitch[]) {
  const slots = Array.from({ length: markerColumns * markerRows }, (_, index) => ({
    x: (index % markerColumns + .5) / markerColumns,
    y: (Math.floor(index / markerColumns) + .5) / markerRows,
  }))
  return [...pitches].sort((a, b) => a.order - b.order).map(pitch => {
    const anchor = pitchPoint(pitch.location)
    let nearest = -1
    let distance = Infinity
    for (const [index, slot] of slots.entries()) {
      const next = (slot.x - anchor.x) ** 2 + (slot.y - anchor.y) ** 2
      if (next < distance) {
        nearest = index
        distance = next
      }
    }
    const label = nearest < 0 ? undefined : slots.splice(nearest, 1)[0]
    return { pitch, anchor, label }
  })
}

function PitchBadge({ pitch }: { pitch: DiagramPitch }) {
  const { name, symbol } = displayPitchType(pitch.type)
  return <span className="zone-marker-badge" title={`${pitch.order}球目 · ${name}`}>
    {pitch.order}{symbol && <span className="zone-marker-type">{symbol}</span>}
  </span>
}

function BatterSilhouette({ side }: { side: BatterSide }) {
  return <svg className="strike-batter" data-batter={side} viewBox="0 0 72 128" aria-hidden="true">
    <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <path d="M29 44 12 16" strokeWidth="5" />
      <path d="M15 21 8 10" strokeWidth="8" />
      <path d="M32 79 23 99 15 117m23-39 16 20-2 19" strokeWidth="10" />
      <path d="M16 118H7m45 0h11" strokeWidth="8" />
      <path d="M44 46 53 53 29 44m5-1-11 13 6-12" strokeWidth="7" />
    </g>
    <path d="M29 45q9-10 18-1l-1 17-5 24H27l-1-22Z" fill="currentColor" />
    <circle cx="44" cy="29" r="9" fill="currentColor" />
    <path d="M34 28q0-11 11-11 8 0 10 9l7 3v3H40Z" fill="currentColor" />
  </svg>
}

export function StrikeZone({ location, pitches, batterSide = 'right', onSelect }: {
  location?: PitchLocation; pitches: DiagramPitch[]; batterSide?: BatterSide; onSelect: (location: PitchLocation) => void
}) {
  const selected = location && pitchPoint(location)
  const markers = pitchMarkers(pitches)
  const overflow = markers.filter(marker => !marker.label)

  function select(point: FieldPoint) {
    onSelect({ zone: 'point', ...point })
  }

  function tap(event: MouseEvent<HTMLButtonElement>) {
    if (event.detail === 0) {
      if (!selected) select({ x: .5, y: .5 })
      return
    }
    const box = event.currentTarget.getBoundingClientRect()
    if (box.width && box.height) {
      select(normalizeFieldPoint(event.clientX - box.left, event.clientY - box.top, box.width, box.height))
    }
  }

  function move(event: KeyboardEvent<HTMLButtonElement>) {
    const step = event.shiftKey ? .01 : .05
    const offsets: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step],
    }
    if (!Object.hasOwn(offsets, event.key)) return
    event.preventDefault()
    const [dx, dy] = offsets[event.key]
    const { x, y } = selected ?? { x: .5, y: .5 }
    select({ x: clamp(x + dx), y: clamp(y + dy) })
  }

  return <figure className="batting-diagram">
    <figcaption>投球コース · 捕手視点</figcaption>
    <div className="strike-scene">
      <BatterSilhouette side={batterSide} />
      <button type="button" className="strike-grid" aria-label="ストライクゾーンとゾーン外で投球位置を指定"
        aria-describedby="strike-grid-help" onClick={tap} onKeyDown={move}>
        <svg className="strike-guides" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <rect x={zoneMin * 100} y={zoneMin * 100} width={(zoneMax - zoneMin) * 100} height={(zoneMax - zoneMin) * 100} />
          <path d="M40 20v60 M60 20v60 M20 40h60 M20 60h60" />
        </svg>
        <svg className="zone-anchors" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {markers.map(({ pitch, anchor, label }) => <g key={pitch.id}>
            {label && <line x1={anchor.x * 100} y1={anchor.y * 100} x2={label.x * 100} y2={label.y * 100} />}
            <circle data-pitch-order={pitch.order} cx={anchor.x * 100} cy={anchor.y * 100} r="1" />
          </g>)}
        </svg>
        {markers.map(({ pitch, label }) => label && <span key={pitch.id} className="zone-marker"
          aria-hidden="true" data-pitch-order={pitch.order} style={{ left: label.x * 100 + '%', top: label.y * 100 + '%' }}>
          <PitchBadge pitch={pitch} />
        </span>)}
        {selected && <span className="zone-selection" aria-hidden="true"
          style={{ left: selected.x * 100 + '%', top: selected.y * 100 + '%' }} />}
      </button>
    </div>
    {overflow.length > 0 && <div className="zone-marker-overflow" aria-label="図に収まらない投球">
      {overflow.map(({ pitch }) => <PitchBadge key={pitch.id} pitch={pitch} />)}
    </div>}
    <p className="hint" id="strike-grid-help">枠の内外をタップできます。キーボードでは矢印で移動、Shift＋矢印で微調整できます。</p>
  </figure>
}

export function BallFieldDrawing({ children }: PropsWithChildren) {
  return <svg viewBox="0 0 300 260" aria-hidden="true">
    <path d="M150 237 20 105Q51 22 150 17q99 5 130 88Z" fill="#285f48" stroke="#9ad1a5" strokeWidth="3" />
    <path d="M150 237 55 138 150 47l95 91Z" fill="#337653" />
    <path d="M150 238 91 179l59-59 59 59Z" fill="#b18757" stroke="#e4c187" strokeWidth="4" />
    <path d="m150 217-39-38 39-39 39 39Z" fill="#397853" />
    <path d="M150 237 20 105m130 132 130-132" stroke="#ecf1dd" strokeWidth="2" />
    <path d="m150 122 6 6-6 6-6-6Zm53 53 6 6-6 6-6-6Zm-106 0 6 6-6 6-6-6Z" fill="#f2f4ec" />
    <circle cx="150" cy="182" r="10" fill="#b18757" /><path d="M145 234h10v5l-5 4-5-4Z" fill="#fff" />
    {children}
  </svg>
}

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
      <BallFieldDrawing>
        {point && <g>
          <line x1="150" y1="237" x2={point.x * 300} y2={point.y * 260} stroke="#ffdc83" strokeWidth="2.5" strokeDasharray="5 4" />
          <circle cx={point.x * 300} cy={point.y * 260} r="7" fill="#ffdc83" stroke="#15243d" strokeWidth="2.5" />
        </g>}
      </BallFieldDrawing>
    </button>
    <p className="hint" id="ball-field-help">図をタップ。キーボードでは矢印で移動、Shift＋矢印で微調整できます。位置は目安です。</p>
    <p className="hint" role="status">{point ? `選択位置：左から ${Math.round(point.x * 100)}%、上から ${Math.round(point.y * 100)}%` : '打球位置は未入力'}</p>
    {point && <button type="button" className="action" onClick={() => onSelect()}>打球位置を解除</button>}
  </figure>
}
