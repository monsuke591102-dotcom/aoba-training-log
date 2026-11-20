import { isLocalDate, localDate } from './dates'
import type { MatchEntry, TrainingData } from './model'
import { deleteRecord, InputError, saveRecord, type RecordDraft } from './training'

export function canEditMatches() {
  return __MATCH_TEST_BUILD__
    ? typeof window !== 'undefined' && window.isSecureContext && window.location.origin === __MATCH_TEST_BUILD__.origin
    : __LOCAL_MATCH_RECORDS__ && typeof window !== 'undefined' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)
}

export type MatchDraft = RecordDraft & { good: string; improve: string }
type MatchTarget = { recordId: string } | { matchId: string }

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
  if (recordId && !good && !improve) return previous ? withMatches(next, remaining) : next
  const entry: MatchEntry = {
    id: previous?.id ?? crypto.randomUUID(), recordId, date: draft.date, good, improve,
    createdAt: previous?.createdAt ?? timestamp, updatedAt: timestamp,
  }
  return { ...next, matches: [...remaining, entry] }
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
