import type { TrainingData } from './model'

const straightPitchType = { id: 'fastball', name: 'ストレート', symbol: '●' } as const
export const initialPitchTypes = [
  straightPitchType,
  { id: 'curve', name: 'カーブ', symbol: '◢' },
  { id: 'slider', name: 'スライダー', symbol: '◀' },
  { id: 'splitter', name: 'スプリット', symbol: '▼' },
] as const

export const plateResults = ['single', 'double', 'triple', 'homeRun', 'groundOut', 'flyOut', 'lineOut', 'popOut',
  'doublePlay', 'triplePlay', 'otherOut', 'strikeoutSwinging', 'strikeoutLooking', 'walk', 'hitByPitch', 'reachedOnError', 'fieldersChoice',
  'sacrificeBunt', 'sacrificeFly', 'interference', 'droppedThirdStrike'] as const
const legacyPitchResults = ['ball', 'calledStrike', 'swingingStrike', 'foul', 'foulBunt', 'inPlay', 'hitByPitch'] as const
const pitchResults = [...legacyPitchResults, 'hit', 'inPlayNonHit'] as const
const battedBallTypes = ['grounder', 'liner', 'fly', 'popup', 'bunt'] as const
const buntResults = ['attempted', 'succeeded', 'failed'] as const
const outsideSides = ['high', 'low', 'left', 'right', 'highLeft', 'highRight', 'lowLeft', 'lowRight'] as const
const bases = ['batter', 'first', 'second', 'third', 'home'] as const
const advanceReasons = ['hit', 'walk', 'hitByPitch', 'steal', 'wildPitch', 'passedBall', 'error', 'fieldersChoice',
  'sacrifice', 'balk', 'tagUp', 'other'] as const
const runningResults = ['advanced', 'stolenBase', 'caughtStealing', 'out', 'scored'] as const
export const positions = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'] as const
const battedFieldingTypes = ['grounder', 'liner', 'fly', 'bunt'] as const
const legacyFieldingTypes = [...battedFieldingTypes, 'throw', 'tag', 'force', 'cover', 'other'] as const
export const fieldingPlayTypes = [...battedFieldingTypes, 'noBall'] as const
const noBallKinds = ['pickoff', 'caughtStealing', 'other'] as const
const fieldingCatchResults = ['success', 'failure', 'notApplicable'] as const
const fieldingThrowResults = ['success', 'error', 'notApplicable'] as const
const fieldingOutcomes = ['out', 'safe', 'notApplicable'] as const
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
// The display alias does not migrate stored pitch snapshots.
export function displayPitchType(type: PitchTypeSnapshot): PitchTypeSnapshot {
  return type.id === 'fastball-fast' || type.id === 'fastball-slow' ? straightPitchType : type
}

export type PitchLocation =
  | { zone: 'inside'; row: 0 | 1 | 2; column: 0 | 1 | 2 }
  | { zone: 'outside'; side: typeof outsideSides[number] }
  // Relative to the full diagram, including the area outside the strike zone.
  | { zone: 'point'; x: number; y: number }
export type Pitch = OrderedRow & { type: PitchTypeSnapshot; result: typeof pitchResults[number]; location: PitchLocation }

export type PlateAppearance = DraftableRow & Reflection & {
  batterSide?: 'right' | 'left'
  result?: typeof plateResults[number]
  rbi?: number
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
export type FieldingOpportunity = {
  inning?: number
  noBallKind?: typeof noBallKinds[number]
  catchResult?: typeof fieldingCatchResults[number]
  throwResult?: typeof fieldingThrowResults[number]
  outcome?: typeof fieldingOutcomes[number]
}

export type FieldingPlay = DraftableRow & Reflection & {
  plateAppearanceId?: string
  position?: Position
  playType?: typeof legacyFieldingTypes[number] | 'noBall'
  // Absent on existing plays until a play-specific value is explicitly recorded.
  opportunity?: FieldingOpportunity
  fieldPoint?: PlateAppearance['fieldPoint']
  credits?: (typeof fieldingCredits[number])[]
  development?: { skill: typeof skills[number]; note: string }[]
}

type SummaryCounts = {
  batting?: { appearances?: number; hits?: number; rbi?: number }
  baserunning?: { advances?: number; steals?: number; caughtStealing?: number; outs?: number; runs?: number }
  fielding?: { putouts?: number; assists?: number; errors?: number }
}

export interface MatchDetails {
  version: 1 | 2 | 3
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
const fieldPoint = (v: unknown) => object(v) && coordinate(v.x) && coordinate(v.y)

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
const pitchLocation = (v: unknown, version: MatchDetails['version']) => object(v) && (
  v.zone === 'inside' && count(v.row, 0, 2) && count(v.column, 0, 2) ||
  v.zone === 'outside' && oneOf(v.side, outsideSides) ||
  version >= 2 && v.zone === 'point' && fieldPoint(v)
)
const pitchType = (v: unknown) => object(v) && id(v.id) &&
  typeof v.name === 'string' && v.name.trim().length > 0 && optional(v.symbol, text)
const summaryFields = (v: unknown, fields: readonly string[]) => object(v) &&
  Object.entries(v).every(([key, value]) => fields.includes(key) && count(value))

export function isHitPlateResult(result: PlateAppearance['result']) {
  return result === 'single' || result === 'double' || result === 'triple' || result === 'homeRun'
}

export function pitchResultError({ pitches, result }: Pick<PlateAppearance, 'pitches' | 'result'>) {
  const batted = pitches?.filter(pitch => pitch.result === 'hit' || pitch.result === 'inPlayNonHit') ?? []
  if (!batted.length) return
  if (batted.length > 1 || pitches?.some(pitch => pitch.order > batted[0].order)) {
    return '「ヒット」または「打球（安打以外）」は、記録した最後の投球1球だけに指定してください。'
  }
  if (!result) return
  const isHit = isHitPlateResult(result)
  if (batted[0].result === 'hit' && !isHit) {
    return '投球が「ヒット」の場合、打席結果は単打・二塁打・三塁打・本塁打から選んでください。'
  }
  if (batted[0].result === 'inPlayNonHit' && isHit) {
    return '打席結果が安打です。最後の投球結果を「ヒット」に変更してください。'
  }
}

export function needsPitchDetailsV2(plate: PlateAppearance) {
  return plate.pitches?.some(pitch => pitch.location.zone === 'point' ||
    pitch.result === 'hit' || pitch.result === 'inPlayNonHit') ?? false
}

export function fieldingOpportunityError(play: Pick<FieldingPlay, 'opportunity' | 'playType' | 'status'>) {
  const { opportunity, playType, status } = play
  if (!opportunity) return
  if (opportunity.inning !== undefined && !count(opportunity.inning, 1)) {
    return 'イニングは1以上の整数で入力してください。'
  }
  if (status === 'complete' && opportunity.inning === undefined) {
    return 'イニングを入力してください。'
  }
  if (status === 'complete' && oneOf(playType, battedFieldingTypes) && opportunity.outcome === undefined) {
    return 'プレー結果でアウト・セーフ・結果対象外のいずれかを選んでください。'
  }
}

export function isMatchDetails(value: unknown): value is MatchDetails {
  if (!object(value) || (value.version !== 1 && value.version !== 2 && value.version !== 3) || !optional(value.opponent, text) || !object(value.source) ||
    !oneOf(value.source.batting, sources) || !oneOf(value.source.baserunning, sources) || !oneOf(value.source.fielding, sources)) return false
  if (!optional(value.summary, summary => object(summary) &&
    optional(summary.batting, v => summaryFields(v, ['appearances', 'hits', 'rbi'])) &&
    optional(summary.baserunning, v => summaryFields(v, ['advances', 'steals', 'caughtStealing', 'outs', 'runs'])) &&
    optional(summary.fielding, v => summaryFields(v, ['putouts', 'assists', 'errors'])))) return false

  const version = value.version
  const ids = new Set<unknown>()
  if (!rows(value.plateAppearances, row => draftable(row) &&
    optional(row.batterSide, v => v === 'right' || v === 'left') &&
    (row.status === 'complete' ? oneOf(row.result, plateResults) : optional(row.result, v => oneOf(v, plateResults))) &&
    optional(row.bunt, v => oneOf(v, buntResults)) && optional(row.battedBall, v => oneOf(v, battedBallTypes)) &&
    optional(row.fieldPoint, fieldPoint) && optional(row.rbi, count) &&
    optional(row.outs, v => count(v, 0, 2)) &&
    optional(row.errorPosition, v => row.result === 'reachedOnError' && oneOf(v, positions)) &&
    optional(row.pitchCount, count) && optional(row.beforeFinalPitch, v => object(v) && count(v.balls, 0, 3) && count(v.strikes, 0, 2)) &&
    optional(row.pitches, v => rows(v, pitch => pitchType(pitch.type) && oneOf(pitch.result, version >= 2 ? pitchResults : legacyPitchResults) &&
      pitchLocation(pitch.location, version), ids)) && !pitchResultError(row as PlateAppearance), ids)) return false

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
      optional(row.position, v => oneOf(v, positions)) &&
      optional(row.playType, v => oneOf(v, legacyFieldingTypes) || (version === 3 && v === 'noBall' && row.opportunity !== undefined)) &&
      optional(row.opportunity, v => version === 3 && object(v) &&
        optional(v.inning, n => count(n, 1)) &&
        optional(v.noBallKind, kind => row.playType === 'noBall' && oneOf(kind, noBallKinds)) &&
        optional(v.catchResult, result => oneOf(result, fieldingCatchResults)) &&
        optional(v.throwResult, result => oneOf(result, fieldingThrowResults)) &&
        optional(v.outcome, result => oneOf(result, fieldingOutcomes))) &&
      !fieldingOpportunityError(row as FieldingPlay) &&
      optional(row.fieldPoint, fieldPoint) &&
      optional(row.credits, v => Array.isArray(v) && new Set(v).size === v.length && v.every(c => oneOf(c, fieldingCredits))) &&
      optional(row.development, v => Array.isArray(v) && v.every(s => object(s) && oneOf(s.skill, skills) && text(s.note))), ids)
}

export const hasMatchDetails = (data: TrainingData) => data.matches?.some(match => match.details !== undefined) ?? false

export function requireCloudCompatibleMatchData(data: TrainingData) {
  if (hasMatchDetails(data)) throw new Error('試合詳細を含むデータは端末内専用です。クラウドへは送信できません。')
}
