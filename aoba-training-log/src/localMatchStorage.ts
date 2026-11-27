import { openDB, type DBSchema } from 'idb'
import type { MatchEntry, TrainingData } from './model'
import type { Change } from './storage'
import { requireCloudCompatibleMatchData, supportedMatchDetailsVersion } from './matchDetails'
import { readMonthlyGoals, replaceMonthlyGoals, type MonthlyGoal } from './monthlyGoals'
import { readCategorySettings, writeCategorySettings, type CategorySettings } from './menuCategories'
import { validateData } from './backup'

type Matches = NonNullable<TrainingData['matches']>
interface MatchState {
  matches: Matches
  migrated: boolean
  pending?: PendingRestore
  recoveries?: { id: string; resolvedAt: string; retained: TrainingData; originalMatches: Matches; pending: PendingRestore }[]
}
interface PendingRestore {
  before: TrainingData
  after: TrainingData
  matches: Matches
  settings?: LocalRestoreSettings
  conflict?: { id: string; detectedAt: string }
}
export interface RestoreReview {
  id: string
  detectedAt: string
  basis: string
  before: TrainingData
  proposed: TrainingData
  current: TrainingData
  base: { before: TrainingData; proposed: TrainingData; current: TrainingData }
  hasSettings: boolean
}
class RestoreSettingsChanged extends Error {}
export class LocalRestoreConflict extends Error {
  constructor(readonly owner: string) {
    super('復元中に別の画面で保存データが変更されました。元データと復元内容を保留しています。')
  }
}
export class LocalMatchVersionError extends Error {
  constructor() {
    super('このアプリで扱えない試合データ形式です。保存済みデータを消去せず、対応する版で開き直してください。')
  }
}
type Replacement<T> = { before: T; after: T }
export type LocalRestoreSettings = {
  goals?: Replacement<MonthlyGoal[]>
  categories?: Replacement<CategorySettings>
}
interface MatchDatabase extends DBSchema {
  owners: { key: string; value: MatchState }
}
type Base = { read: () => Promise<TrainingData>; update: (change: Change) => Promise<TrainingData> }

function withMatches(data: TrainingData, matches: Matches): TrainingData {
  const { matches: previous, ...rest } = data
  return matches.length ? { ...rest, matches } : rest
}

function withoutDetails(entry: MatchEntry): MatchEntry {
  const { details, ...base } = entry
  return base
}

export function legacySyncData(data: TrainingData, localOnlyStandalone = false): TrainingData {
  return withMatches(data, (data.matches ?? []).filter(row => !localOnlyStandalone || row.recordId).flatMap(row => row.details
    ? row.recordId && (row.good || row.improve) ? [withoutDetails(row)] : []
    : [row]))
}

function key(row: MatchEntry) {
  return row.recordId ? 'record:' + row.recordId : 'match:' + row.id
}

export function combineLocalMatches(base: TrainingData, local: Matches) {
  const overrides = new Map(local.map(row => [key(row), row]))
  const records = new Set(base.records.filter(row => row.kind === '試合').map(row => row.id))
  const standaloneIfOrphaned = (row: MatchEntry) =>
    row.recordId && !records.has(row.recordId) ? { ...row, recordId: undefined } : row
  const combined = (base.matches ?? []).map(row => {
    const details = overrides.get(key(row))
    if (!details) return row
    overrides.delete(key(row))
    return standaloneIfOrphaned({ ...row, details: details.details })
  })
  for (const row of overrides.values()) combined.push(standaloneIfOrphaned(row))
  return withMatches(base, combined)
}

const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)

function requireSupportedMatches(matches?: Matches) {
  if (matches?.some(match => match.details !== undefined && !supportedMatchDetailsVersion(match.details?.version))) {
    throw new LocalMatchVersionError()
  }
}

function restoreSettings(settings?: LocalRestoreSettings, apply = false) {
  if (!settings) return
  const { goals, categories } = settings
  const storage = window.localStorage
  const previousGoals = goals && readMonthlyGoals(storage)
  const previousCategories = categories && readCategorySettings(storage)
  if (goals && !equal(previousGoals, goals.before) && !equal(previousGoals, goals.after) ||
    categories && !equal(previousCategories, categories.before) && !equal(previousCategories, categories.after)) {
    throw new RestoreSettingsChanged('復元の確認後に端末の設定が変更されました。')
  }
  if (!apply) return
  if (goals && !equal(previousGoals, goals.after)) replaceMonthlyGoals(storage, goals.after)
  if (categories && !equal(previousCategories, categories.after)) writeCategorySettings(storage, categories.after)
}

export function createLocalMatchStorage(owner: string, base: Base, name = 'aoba-training-log-local-matches',
  exclusive: <T>(job: () => Promise<T>) => Promise<T> = async job => {
    if (!navigator.locks) throw new Error('このブラウザーでは安全な試合データ保存に対応していません。')
    return await navigator.locks.request(name + ':' + owner, job)
  }, onUpgradeBlocked?: (blocked: boolean) => void) {
  async function open() {
    try {
      return await openDB<MatchDatabase>(name, 2, {
        upgrade(db, oldVersion) { if (oldVersion === 0) db.createObjectStore('owners') },
        blocked() { onUpgradeBlocked?.(true) },
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'VersionError') throw new LocalMatchVersionError()
      throw error
    } finally {
      onUpgradeBlocked?.(false)
    }
  }
  const projectLegacy = (data: TrainingData) => legacySyncData(data, owner === 'guest')
  async function readState() {
    const db = await open()
    try {
      const state = await db.get('owners', owner) ?? { matches: [], migrated: false }
      requireSupportedMatches(state.matches)
      if (state.pending) {
        requireSupportedMatches(state.pending.before.matches)
        requireSupportedMatches(state.pending.after.matches)
        requireSupportedMatches(state.pending.matches)
      }
      return state
    }
    finally { db.close() }
  }
  async function saveState(state: MatchState) {
    const db = await open()
    try { await db.put('owners', state, owner) }
    finally { db.close() }
  }
  function review(raw: TrainingData, state: MatchState): RestoreReview | undefined {
    const pending = state.pending
    if (!pending?.conflict) return
    return {
      ...pending.conflict,
      basis: JSON.stringify([raw, pending.settings?.goals && readMonthlyGoals(window.localStorage),
        pending.settings?.categories && readCategorySettings(window.localStorage)]),
      before: combineLocalMatches(projectLegacy(pending.before), state.matches),
      proposed: combineLocalMatches(projectLegacy(pending.after), pending.matches),
      current: combineLocalMatches(projectLegacy(raw), state.matches),
      base: { before: pending.before, proposed: pending.after, current: raw },
      hasSettings: Boolean(pending.settings?.categories || pending.settings?.goals),
    }
  }
  async function load() {
    let raw = await base.read()
    requireSupportedMatches(raw.matches)
    let state = await readState()
    if (!state.migrated) {
      const matches = (raw.matches ?? []).filter(row => row.details || owner === 'guest' && !row.recordId)
      const projected = projectLegacy(raw)
      state = { migrated: true, matches,
        ...(owner === 'guest' && matches.length && !equal(raw, projected)
          ? { pending: { before: raw, after: projected, matches } } : {}) }
      await saveState(state)
    }
    const pending = state.pending
    if (pending) {
      if (pending.conflict) throw new LocalRestoreConflict(owner)
      try {
        if (!equal(raw, pending.before) && !equal(raw, pending.after)) throw new LocalRestoreConflict(owner)
        restoreSettings(pending.settings, true)
        if (!equal(raw, pending.after)) {
          raw = await base.update(current => {
            if (!equal(current, pending.before)) throw new LocalRestoreConflict(owner)
            return pending.after
          })
        }
      } catch (error) {
        if (!(error instanceof LocalRestoreConflict || error instanceof RestoreSettingsChanged)) throw error
        await saveState({ ...state, pending: { ...pending,
          conflict: { id: crypto.randomUUID(), detectedAt: new Date().toISOString() } } })
        throw new LocalRestoreConflict(owner)
      }
      state = { ...state, matches: pending.matches, pending: undefined }
      await saveState(state)
    }
    return { raw, state, data: combineLocalMatches(projectLegacy(raw), state.matches) }
  }

  return {
    exclusive,
    reviewRecovery: () => exclusive(async () => review(await base.read(), await readState())),
    keepCurrent: (confirmed: RestoreReview) => exclusive(async () => {
      const state = await readState()
      const raw = await base.read()
      const latest = review(raw, state)
      if (!latest && state.recoveries?.some(item => item.id === confirmed.id) && !state.pending) {
        return (await load()).data
      }
      if (!latest || !state.pending || !equal(latest, confirmed)) {
        throw new Error('確認後に保存内容が変わりました。候補を再確認して保存し直してください。')
      }
      requireCloudCompatibleMatchData(owner === 'guest' ? projectLegacy(raw) : raw)
      validateData(latest.current)
      // One transaction archives the journal and clears its stop condition. The
      // existing base and match rows are untouched, including any legacy write.
      await saveState({ ...state, pending: undefined, recoveries: [...(state.recoveries ?? []), {
        id: latest.id, resolvedAt: new Date().toISOString(), retained: raw, originalMatches: state.matches, pending: state.pending,
      }] })
      return (await load()).data
    }),
    read: () => exclusive(async () => (await load()).data),
    readSync: () => exclusive(async () => projectLegacy((await load()).raw)),
    copyFromGuest: (entries: Matches) => exclusive(async () => {
      requireSupportedMatches(entries)
      const { state } = await load()
      const known = new Set(state.matches.map(row => row.id))
      // Guest record IDs belong to the guest. A copied match is standalone.
      const copies = entries.filter(row => !known.has('guest-copy:' + row.id)).map(row => ({
        ...row, id: 'guest-copy:' + row.id, recordId: undefined,
      }))
      if (copies.length) await saveState({ ...state, matches: [...state.matches, ...copies] })
      return copies.length
    }),
    readLocal: () => exclusive(async () => (await load()).state.matches),
    ready: async () => { await load() },
    update: (change: Change, settings?: LocalRestoreSettings) => exclusive(async () => {
      const { raw, state, data } = await load()
      const next = change(data)
      requireSupportedMatches(next.matches)
      restoreSettings(settings)
      const oldBase = projectLegacy(raw)
      const baseByKey = new Map(oldBase.matches?.map(row => [key(row), row]))
      const baseById = new Map(oldBase.matches?.map(row => [row.id, row]))
      const localById = new Map(state.matches.map(row => [row.id, row]))
      const localByKey = new Map(state.matches.map(row => [key(row), row]))
      const locals: Matches = []
      const cloud: Matches = []
      for (const row of next.matches ?? []) {
        const previous = baseByKey.get(key(row)) ?? baseById.get(row.id)
        const earlier = localById.get(row.id) ?? localByKey.get(key(row))
        const basic = withoutDetails(previous && !row.recordId && earlier?.recordId
          ? { ...row, recordId: previous.recordId } : row)
        if (row.details || !row.recordId && (!previous || earlier)) {
          locals.push({ ...row, recordId: row.recordId ?? earlier?.recordId })
        }
        if (previous || row.recordId && (row.good || row.improve) || row.recordId && !row.details) {
          cloud.push(previous && equal({ ...basic, updatedAt: previous.updatedAt }, previous) ? previous : basic)
        }
      }
      const projected = withMatches(next, cloud)
      requireCloudCompatibleMatchData(projected)
      const syncChanged = !equal(projected, oldBase)
      if (!settings && !syncChanged && equal(locals, state.matches)) return { data, syncChanged }
      if (!settings && !syncChanged) {
        await saveState({ ...state, matches: locals })
      } else {
        await saveState({ ...state, pending: { before: raw, after: syncChanged ? projected : raw, matches: locals, settings } })
        await load()
      }
      return { data: combineLocalMatches(projected, locals), syncChanged }
    }),
  }
}
