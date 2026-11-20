import type { TrainingData } from './model'

export const initialPitchTypes = [
  { id: 'fastball-fast', name: 'ストレート（速）', symbol: '●' },
  { id: 'fastball-slow', name: 'ストレート（遅）', symbol: '●' },
  { id: 'curve', name: 'カーブ', symbol: '◢' },
  { id: 'slider', name: 'スライダー', symbol: '◀' },
  { id: 'splitter', name: 'スプリット', symbol: '▼' },
] as const

export const plateResults = ['single', 'double', 'triple', 'homeRun', 'groundOut', 'flyOut', 'lineOut', 'popOut',
  'doublePlay', 'triplePlay', 'otherOut', 'strikeoutSwinging', 'strikeoutLooking', 'walk', 'hitByPitch', 'reachedOnError', 'fieldersChoice',
  'sacrificeBunt', 'sacrificeFly', 'interference', 'droppedThirdStrike'] as const
const pitchResults = ['ball', 'calledStrike', 'swingingStrike', 'foul', 'foulBunt', 'inPlay', 'hitByPitch'] as const
const battedBallTypes = ['grounder', 'liner', 'fly', 'popup', 'bunt'] as const
const buntResults = ['attempted', 'succeeded', 'failed'] as const
const outsideSides = ['high', 'low', 'left', 'right', 'highLeft', 'highRight', 'lowLeft', 'lowRight'] as const
const bases = ['batter', 'first', 'second', 'third', 'home'] as const
const advanceReasons = ['hit', 'walk', 'hitByPitch', 'steal', 'wildPitch', 'passedBall', 'error', 'fieldersChoice',
  'sacrifice', 'balk', 'tagUp', 'other'] as const
const runningResults = ['advanced', 'stolenBase', 'caughtStealing', 'out', 'scored'] as const
export const positions = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'] as const
const playTypes = ['grounder', 'liner', 'fly', 'bunt', 'throw', 'tag', 'force', 'cover', 'other'] as const
const fieldingCredits = ['putout', 'assist', 'error'] as const
const skills = ['catching', 'throwing', 'baseCover', 'judgment', 'other'] as const
const sources = ['events', 'summary'] as const

type OrderedRow = { id: string; order: number }
type DraftableRow = OrderedRow & { status: 'draft' | 'complete' }
type Reflection = { feel?: string; reflection?: string; improvement?: string }
type Position = typeof positions[number]
type Count = { balls: number; strikes: number }

// Keep the label and symbol as recorded even when the selectable catalog is edited.
export type PitchTypeSnapshot = { id: string; name: string; symbol?: string }
export type PitchLocation =
  | { zone: 'inside'; row: 0 | 1 | 2; column: 0 | 1 | 2 }
  | { zone: 'outside'; side: typeof outsideSides[number] }
export type Pitch = OrderedRow & { type: PitchTypeSnapshot; result: typeof pitchResults[number]; location: PitchLocation }

export type PlateAppearance = DraftableRow & Reflection & {
  result?: typeof plateResults[number]
  bunt?: typeof buntResults[number]
  battedBall?: typeof battedBallTypes[number]
  // Normalized coordinates from the top-left of the field diagram, both inclusive.
  fieldPoint?: { x: number; y: number }
  pitchCount?: number
  beforeFinalPitch?: Count
  outs?: number
  errorPosition?: Position
  pitches?: Pitch[]
}

export type BaserunningPlay = DraftableRow & Reflection & {
  plateAppearanceId?: string
  from?: typeof bases[number]
  to?: Exclude<typeof bases[number], 'batter'>
  reason?: typeof advanceReasons[number]
  result?: typeof runningResults[number]
}

export type PositionChange = OrderedRow & { position: Position; inning?: number }
export type FieldingPlay = DraftableRow & Reflection & {
  plateAppearanceId?: string
  position?: Position
  playType?: typeof playTypes[number]
  credits?: (typeof fieldingCredits[number])[]
  development?: { skill: typeof skills[number]; note: string }[]
}

type SummaryCounts = {
  batting?: { appearances?: number; hits?: number }
  baserunning?: { advances?: number; steals?: number; caughtStealing?: number; outs?: number; runs?: number }
  fielding?: { putouts?: number; assists?: number; errors?: number }
}

export interface MatchDetails {
  version: 1
  opponent?: string
  // A consumer counts only the selected source per discipline, and skips drafts.
  source: { [K in keyof SummaryCounts]-?: typeof sources[number] }
  summary?: SummaryCounts
  plateAppearances: PlateAppearance[]
  baserunning: BaserunningPlay[]
  positionChanges: PositionChange[]
  fielding: FieldingPlay[]
}

export function emptyMatchDetails(): MatchDetails {
  return {
    version: 1, source: { batting: 'events', baserunning: 'events', fielding: 'events' },
    plateAppearances: [], baserunning: [], positionChanges: [], fielding: [],
  }
}

type Row = Record<string, unknown>
const object = (v: unknown): v is Row => typeof v === 'object' && v !== null && !Array.isArray(v)
const oneOf = (v: unknown, values: readonly unknown[]) => values.includes(v)
const optional = (v: unknown, validate: (v: unknown) => boolean) => v === undefined || validate(v)
const text = (v: unknown) => typeof v === 'string'
const id = (v: unknown) => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(v)
const count = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max
const coordinate = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1

function rows(v: unknown, valid: (row: Row) => boolean, ids: Set<unknown>) {
  if (!Array.isArray(v)) return false
  const orders = new Set<unknown>()
  for (const row of v) {
    if (!object(row) || !id(row.id) || ids.has(row.id) || !count(row.order, 1) || orders.has(row.order)) return false
    ids.add(row.id)
    orders.add(row.order)
    if (!valid(row)) return false
  }
  return true
}

const draftable = (row: Row) => oneOf(row.status, ['draft', 'complete']) &&
  ['feel', 'reflection', 'improvement'].every(key => optional(row[key], text))
const pitchLocation = (v: unknown) => object(v) && (v.zone === 'inside'
  ? count(v.row, 0, 2) && count(v.column, 0, 2)
  : v.zone === 'outside' && oneOf(v.side, outsideSides))
const pitchType = (v: unknown) => object(v) && id(v.id) &&
  typeof v.name === 'string' && v.name.trim().length > 0 && optional(v.symbol, text)
const summaryFields = (v: unknown, fields: readonly string[]) => object(v) &&
  Object.entries(v).every(([key, value]) => fields.includes(key) && count(value))

export function isMatchDetails(value: unknown): value is MatchDetails {
  if (!object(value) || value.version !== 1 || !optional(value.opponent, text) || !object(value.source) ||
    !oneOf(value.source.batting, sources) || !oneOf(value.source.baserunning, sources) || !oneOf(value.source.fielding, sources)) return false
  if (!optional(value.summary, summary => object(summary) &&
    optional(summary.batting, v => summaryFields(v, ['appearances', 'hits'])) &&
    optional(summary.baserunning, v => summaryFields(v, ['advances', 'steals', 'caughtStealing', 'outs', 'runs'])) &&
    optional(summary.fielding, v => summaryFields(v, ['putouts', 'assists', 'errors'])))) return false

  const ids = new Set<unknown>()
  if (!rows(value.plateAppearances, row => draftable(row) &&
    (row.status === 'complete' ? oneOf(row.result, plateResults) : optional(row.result, v => oneOf(v, plateResults))) &&
    optional(row.bunt, v => oneOf(v, buntResults)) && optional(row.battedBall, v => oneOf(v, battedBallTypes)) &&
    optional(row.fieldPoint, v => object(v) && coordinate(v.x) && coordinate(v.y)) &&
    optional(row.outs, v => count(v, 0, 2)) &&
    optional(row.errorPosition, v => row.result === 'reachedOnError' && oneOf(v, positions)) &&
    optional(row.pitchCount, count) && optional(row.beforeFinalPitch, v => object(v) && count(v.balls, 0, 3) && count(v.strikes, 0, 2)) &&
    optional(row.pitches, v => rows(v, pitch => pitchType(pitch.type) && oneOf(pitch.result, pitchResults) && pitchLocation(pitch.location), ids)), ids)) return false

  const appearances = new Set((value.plateAppearances as PlateAppearance[]).map(row => row.id))
  const linked = (row: Row) => optional(row.plateAppearanceId, v => typeof v === 'string' && appearances.has(v))
  return rows(value.baserunning, row => draftable(row) && linked(row) &&
    (row.status === 'draft' || (row.from !== undefined && row.result !== undefined)) &&
    optional(row.from, v => oneOf(v, bases)) && optional(row.to, v => v !== 'batter' && oneOf(v, bases)) &&
    optional(row.reason, v => oneOf(v, advanceReasons)) && optional(row.result, v => oneOf(v, runningResults)) &&
    (row.status === 'draft' || (row.from !== 'home' &&
      (!oneOf(row.result, ['advanced', 'stolenBase']) || (row.to !== undefined && (row.result === 'stolenBase' || row.to !== 'home') && bases.indexOf(row.to as typeof bases[number]) > bases.indexOf(row.from as typeof bases[number]))) &&
      (row.result !== 'scored' || (row.to === 'home' && row.from !== 'home'))
    )), ids) &&
    rows(value.positionChanges, row => oneOf(row.position, positions) && optional(row.inning, v => count(v, 1)), ids) &&
    rows(value.fielding, row => draftable(row) && linked(row) &&
      (row.status === 'draft' || (row.position !== undefined && row.playType !== undefined)) &&
      optional(row.position, v => oneOf(v, positions)) && optional(row.playType, v => oneOf(v, playTypes)) &&
      optional(row.credits, v => Array.isArray(v) && new Set(v).size === v.length && v.every(c => oneOf(c, fieldingCredits))) &&
      optional(row.development, v => Array.isArray(v) && v.every(s => object(s) && oneOf(s.skill, skills) && text(s.note))), ids)
}

export const hasMatchDetails = (data: TrainingData) => data.matches?.some(match => match.details !== undefined) ?? false

export function requireCloudCompatibleMatchData(data: TrainingData) {
  if (hasMatchDetails(data)) throw new Error('試合詳細を含むデータは端末内専用です。クラウドへは送信できません。')
}
