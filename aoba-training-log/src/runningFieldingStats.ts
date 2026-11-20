import { positions, type BaserunningPlay, type FieldingPlay } from './matchDetails'
import type { MatchEntry } from './model'

type Count = number | null
type Match = Pick<MatchEntry, 'details'>
type RunningCounts = { sb: Count; cs: Count; r: Count; otherOuts: Count }
type StealEvidence = { success: boolean; failure: boolean }
export type BaserunningStats = RunningCounts & { stealRate: Count; stealEvidence: StealEvidence }

type FieldingCounts = { po: Count; a: Count; e: Count }
export type FieldingLine = FieldingCounts & { tc: Count; fpct: Count }
type Position = typeof positions[number]
export type FieldingStats = FieldingLine & {
  byPosition: Partial<Record<Position, FieldingLine>>
  hasPositionBreakdown: boolean
  observations: Count
}

const runningUnknown = { sb: null, cs: null, r: null, otherOuts: null }
const fieldingUnknown = { po: null, a: null, e: null }
const fieldingZero = { po: 0, a: 0, e: 0 }
const baseOrder = ['batter', 'first', 'second', 'third', 'home'] as const

function sum(values: readonly Count[]): Count {
  if (!values.length) return null
  let total = 0
  for (const value of values) {
    if (value === null) return null
    total += value
  }
  return total
}

function runningRates(counts: RunningCounts, stealEvidence: StealEvidence): BaserunningStats {
  const { sb, cs } = counts
  return { ...counts, stealEvidence, stealRate: stealEvidence.success && stealEvidence.failure &&
    sb !== null && cs !== null && sb + cs > 0 ? sb / (sb + cs) : null }
}

function recordedRun(play: BaserunningPlay) {
  const { status, from, to, result } = play
  if (status !== 'complete' || !from || from === 'home' || !result) return false
  if (result === 'out') return true
  if (result === 'caughtStealing') return from !== 'batter'
  if (!to || baseOrder.indexOf(to) <= baseOrder.indexOf(from)) return false
  if (result === 'stolenBase') return from !== 'batter'
  return result === 'scored' ? to === 'home' : to !== 'home'
}

export function calculateMatchBaserunningStats({ details }: Match): BaserunningStats {
  if (details?.source.baserunning === 'summary') {
    const values = details.summary?.baserunning
    const sb = values?.steals ?? null
    const cs = values?.caughtStealing ?? null
    // The summary model does not define whether outs includes caught stealing.
    return runningRates({ sb, cs, r: values?.runs ?? null, otherOuts: null }, { success: sb !== null, failure: cs !== null })
  }
  const plays = details?.baserunning.filter(recordedRun) ?? []
  if (!plays.length) return runningRates(runningUnknown, { success: false, failure: false })
  const counts = { sb: 0, cs: 0, r: 0, otherOuts: 0 }
  for (const play of plays) {
    if (play.result === 'stolenBase') counts.sb++
    if (play.result === 'caughtStealing') counts.cs++
    if (play.result === 'out') counts.otherOuts++
    if (play.to === 'home' && (play.result === 'stolenBase' || play.result === 'scored')) counts.r++
  }
  return runningRates(counts, { success: counts.sb > 0, failure: counts.cs > 0 })
}

export function aggregateBaserunningStats(matches: readonly BaserunningStats[]): BaserunningStats {
  return runningRates({
    sb: sum(matches.map(row => row.sb)), cs: sum(matches.map(row => row.cs)), r: sum(matches.map(row => row.r)),
    otherOuts: sum(matches.map(row => row.otherOuts)),
  }, { success: matches.some(row => row.stealEvidence.success), failure: matches.some(row => row.stealEvidence.failure) })
}

function fieldingRates(counts: FieldingCounts): FieldingLine {
  const { po, a, e } = counts
  const tc = sum([po, a, e])
  return { ...counts, tc, fpct: tc && po !== null && a !== null ? (po + a) / tc : null }
}

function fieldingCounts(plays: readonly FieldingPlay[]): FieldingCounts {
  if (!plays.length || plays.some(row => row.credits === undefined)) return fieldingUnknown
  const counts = { ...fieldingZero }
  for (const { credits } of plays) {
    if (credits?.includes('putout')) counts.po++
    if (credits?.includes('assist')) counts.a++
    if (credits?.includes('error')) counts.e++
  }
  return counts
}

export function calculateMatchFieldingStats({ details }: Match): FieldingStats {
  const plays = details?.fielding.filter(play => play.status === 'complete') ?? []
  const observations = plays.length ? plays.reduce((total, row) => total + (row.development?.length ?? 0), 0) : null
  if (details?.source.fielding === 'summary') {
    const values = details.summary?.fielding
    return { ...fieldingRates({ po: values?.putouts ?? null, a: values?.assists ?? null, e: values?.errors ?? null }),
      byPosition: {}, hasPositionBreakdown: false, observations }
  }
  const byPosition: FieldingStats['byPosition'] = {}
  for (const position of positions) {
    const atPosition = plays.filter(row => row.position === position)
    if (atPosition.length) byPosition[position] = fieldingRates(fieldingCounts(atPosition))
  }
  return { ...fieldingRates(fieldingCounts(plays)), byPosition, hasPositionBreakdown: plays.length > 0, observations }
}

function combineFielding(lines: readonly FieldingCounts[]): FieldingLine {
  return fieldingRates({ po: sum(lines.map(row => row.po)), a: sum(lines.map(row => row.a)), e: sum(lines.map(row => row.e)) })
}

export function aggregateFieldingStats(matches: readonly FieldingStats[]): FieldingStats {
  const byPosition: FieldingStats['byPosition'] = {}
  for (const position of positions) {
    if (!matches.some(row => row.byPosition[position])) continue
    byPosition[position] = combineFielding(matches.map(row =>
      row.byPosition[position] ?? (row.hasPositionBreakdown ? fieldingZero : fieldingUnknown)))
  }
  return { ...combineFielding(matches), byPosition,
    hasPositionBreakdown: matches.length > 0 && matches.every(row => row.hasPositionBreakdown),
    observations: sum(matches.map(row => row.observations)) }
}
