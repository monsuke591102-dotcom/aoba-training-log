import { isLocalDate, localDate } from './dates'
import { emptyMatchDetails, isMatchDetails, type MatchDetails } from './matchDetails'
import type { MatchEntry, TrainingData } from './model'
import { deleteRecord, InputError, saveRecord, type RecordDraft } from './training'

export function canEditMatches() {
  return __MATCH_TEST_BUILD__
    ? typeof window !== 'undefined' && window.isSecureContext && window.location.origin === __MATCH_TEST_BUILD__.origin
    : __LOCAL_MATCH_RECORDS__ && typeof window !== 'undefined' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)
}

export type MatchDraft = RecordDraft & { good: string; improve: string }
export type MatchTarget = { recordId: string } | { matchId: string }

function withMatches(data: TrainingData, matches: MatchEntry[]): TrainingData {
  const { matches: _, ...rest } = data
  return matches.length ? { ...rest, matches } : rest
}

function requireMatchAccess() {
  if (!canEditMatches()) throw new InputError('試合の記録と振り返りの編集は現在無効です。')
}

export function saveMatch(data: TrainingData, draft: MatchDraft, target?: MatchTarget, now = new Date()): TrainingData {
  requireMatchAccess()
  if (draft.kind !== '試合' || !isLocalDate(draft.date) || draft.date > localDate(now)) {
    throw new InputError('試合日は今日以前の有効な日付を選んでください。')
  }
  const matches = data.matches ?? []
  const linkedId = target && 'recordId' in target ? target.recordId : undefined
  const matchId = target && 'matchId' in target ? target.matchId : undefined
  const record = linkedId === undefined ? undefined : data.records.find(row => row.id === linkedId)
  const previous = linkedId !== undefined ? matches.find(row => row.recordId === linkedId)
    : matches.find(row => row.id === matchId && row.recordId === undefined)
  if ((linkedId !== undefined && !record) || (matchId !== undefined && !previous)) {
    throw new InputError('この試合記録はすでに削除されています。')
  }
  if (record && !draft.menuId) throw new InputError('既存の実施量を保持するため、記録メニューを選んでください。')
  const timestamp = now.toISOString()
  const good = draft.good.trim()
  const improve = draft.improve.trim()
  let next = data
  let recordId: string | undefined
  if (draft.menuId) {
    if (previous && !previous.recordId) throw new InputError('メニューなしの試合に実施量を追加する場合は、別の記録を作成してください。')
    next = saveRecord(data, draft, record?.id, now)
    recordId = next.records.at(-1)!.id
  }
  const remaining = matches.filter(row => row !== previous)
  if (recordId && !good && !improve && !previous?.details) return previous ? withMatches(next, remaining) : next
  const entry: MatchEntry = {
    ...previous, id: previous?.id ?? crypto.randomUUID(), recordId, date: draft.date, good, improve,
    createdAt: previous?.createdAt ?? timestamp, updatedAt: timestamp,
  }
  return { ...next, matches: [...remaining, entry] }
}

// Called inside the local storage transaction. Only the targeted match is replaced.
export function updateMatchDetails(data: TrainingData, target: MatchTarget,
  edit: (details: MatchDetails) => MatchDetails, now = new Date()): TrainingData {
  requireMatchAccess()
  const matches = data.matches ?? []
  const recordId = 'recordId' in target ? target.recordId : undefined
  const record = recordId === undefined ? undefined : data.records.find(row => row.id === recordId && row.kind === '試合')
  const previous = 'matchId' in target ? matches.find(row => row.id === target.matchId)
    : matches.find(row => row.recordId === target.recordId)
  if (!previous && !record) throw new InputError('試合記録が見つかりません。')
  const details = edit(previous?.details ? structuredClone(previous.details) : emptyMatchDetails())
  if (!isMatchDetails(details)) throw new InputError('試合詳細に不正な項目または重複があります。')
  const timestamp = now.toISOString()
  const entry: MatchEntry = previous
    ? { ...previous, details, updatedAt: timestamp }
    : { id: crypto.randomUUID(), recordId, date: record!.date, good: '', improve: '', createdAt: timestamp, updatedAt: timestamp, details }
  return { ...data, matches: previous ? matches.map(row => row === previous ? entry : row) : [...matches, entry] }
}

type DetailRows = Pick<MatchDetails, 'plateAppearances' | 'baserunning' | 'positionChanges' | 'fielding'>

export function saveMatchDetailRow<K extends keyof DetailRows>(data: TrainingData, target: MatchTarget,
  collection: K, row: NoInfer<DetailRows[K][number]>, now = new Date()): TrainingData {
  return updateMatchDetails(data, target, details => {
    const rows: DetailRows[K][number][] = details[collection]
    return { ...details, [collection]: rows.some(current => current.id === row.id)
      ? rows.map(current => current.id === row.id ? row : current)
      : [...rows, row] }
  }, now)
}

export function deleteMatch(data: TrainingData, id: string, linked: boolean): TrainingData {
  requireMatchAccess()
  if (linked) {
    if (!data.records.some(row => row.id === id && row.kind === '試合')) throw new InputError('試合記録が見つかりません。')
    return withMatches(deleteRecord(data, id), (data.matches ?? []).filter(row => row.recordId !== id))
  }
  if (!data.matches?.some(row => row.id === id && row.recordId === undefined)) throw new InputError('この試合記録はすでに削除されています。')
  return withMatches(data, data.matches.filter(row => row.id !== id || row.recordId !== undefined))
}
