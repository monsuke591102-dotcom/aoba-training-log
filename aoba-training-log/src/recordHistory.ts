import type { MatchDetails } from './matchDetails'
import type { MatchEntry, TrainingData } from './model'
import { recordedRun } from './runningFieldingStats'

export type BattingGame = Pick<MatchEntry, 'id' | 'date' | 'details'>

export function recordHistory(data: TrainingData) {
  const links = new Map(data.matches?.filter(match => match.recordId).map(match => [match.recordId, match]))
  const linkedIds = new Set(data.records.filter(record => record.kind === '試合').map(record => record.id))
  return [
    ...data.records.map(record => ({ id: 'record:' + record.id, record,
      match: record.kind === '試合' ? links.get(record.id) : undefined, date: record.date, createdAt: record.createdAt })),
    ...(data.matches ?? []).filter(match => !linkedIds.has(match.recordId ?? '')).map(match =>
      ({ id: 'match:' + match.id, record: undefined, match, date: match.date, createdAt: match.createdAt })),
  ].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
}

type Entry = ReturnType<typeof recordHistory>[number]
export const isMatchHistoryEntry = (entry: Entry) => entry.record ? entry.record.kind === '試合' : Boolean(entry.match)

export function battingGames(history: readonly Entry[]): BattingGame[] {
  return history.filter(isMatchHistoryEntry).map(({ id, date, match }) => ({ id, date, details: match?.details }))
}

// History shows counts from saved events. The selected source still governs the stats screen.
export function matchHistoryCounts(details?: MatchDetails) {
  const batting = details?.plateAppearances.filter(row => row.status === 'complete' && row.result !== undefined) ?? []
  const running = details?.baserunning.filter(recordedRun) ?? []
  const fielding = details?.fielding.filter(row => row.status === 'complete') ?? []
  return {
    batting: { confirmed: batting.length || null, drafts: details?.plateAppearances.filter(row => row.status === 'draft').length ?? 0,
      source: details?.source.batting },
    running: { confirmed: running.length ? running.filter(row => row.result === 'stolenBase' || row.result === 'caughtStealing').length : null,
      drafts: details?.baserunning.filter(row => row.status === 'draft').length ?? 0, source: details?.source.baserunning },
    fielding: { confirmed: fielding.length || null, drafts: details?.fielding.filter(row => row.status === 'draft').length ?? 0,
      source: details?.source.fielding },
  }
}
