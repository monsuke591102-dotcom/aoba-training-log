import type { MatchEntry, TrainingData } from './model'

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
