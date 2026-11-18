import type { AccountState, AccountStorage, Flight } from './accountStorage'
import { initialData } from './initialData'
import type { TrainingData } from './model'

export interface RemoteSnapshot { revision: number; data: TrainingData }
export interface SnapshotApi {
  read(): Promise<RemoteSnapshot | null>
  write(flight: Flight): Promise<number | null>
}

export interface SyncDecision {
  kind: 'initial' | 'conflict'
  local: TrainingData
  source: 'guest' | 'account'
  remote: RemoteSnapshot | null
  version: number
}

export type SyncResult = 'synced' | 'again' | SyncDecision

function sameData(a: TrainingData, b: TrainingData) {
  // PostgreSQL JSONB may return object keys in a different order.
  function ordered(data: TrainingData) {
    return JSON.stringify(data, (_key, value: unknown) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return value
      return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
    })
  }
  return ordered(a) === ordered(b)
}

export function hasLocalData(data: TrainingData) {
  return !sameData(data, initialData())
}

function asSynced(state: AccountState, remote: RemoteSnapshot | null, data = remote?.data ?? state.data): AccountState {
  return {
    ...state, data, initialized: true, revision: remote?.revision ?? null, flight: undefined,
    syncedGeneration: state.generation, lastSynced: new Date().toISOString(),
  }
}

export async function syncOnce(store: AccountStorage, api: SnapshotApi, readGuest: () => Promise<TrainingData>, signal?: AbortSignal): Promise<SyncResult> {
  const state = await store.read()
  signal?.throwIfAborted()
  const remote = await api.read()
  signal?.throwIfAborted()
  const revision = remote?.revision ?? null
  const guard = (edit: (current: AccountState) => AccountState) => store.change(current =>
    current.version === state.version && !signal?.aborted ? edit(current) : current,
  )

  if (!state.initialized) {
    const draft = hasLocalData(state.data)
    const guest = draft ? undefined : await readGuest()
    signal?.throwIfAborted()
    if (guest && hasLocalData(guest)) {
      return { kind: 'initial', local: guest, source: 'guest', remote, version: state.version }
    }
    if (draft && remote) {
      if (!sameData(state.data, remote.data)) {
        return { kind: 'initial', local: state.data, source: 'account', remote, version: state.version }
      }
      await guard(current => asSynced(current, remote))
      return 'again'
    }
    await guard(current => draft
      ? { ...current, initialized: true }
      : asSynced(current, remote))
    return 'again'
  }

  const flight = state.flight
  if (flight && remote && sameData(flight.data, remote.data)) {
    await acknowledge(store, flight, remote.revision, signal)
    return 'again'
  }

  if (state.generation === state.syncedGeneration && !flight) {
    if (revision === state.revision) return 'synced'
    // An unexpected disappearance is treated as a conflict, so the last local copy survives.
    if (!remote) return { kind: 'conflict', local: state.data, source: 'account', remote, version: state.version }
    await guard(current => asSynced(current, remote))
    return 'again'
  }

  if (revision !== state.revision) {
    return { kind: 'conflict', local: state.data, source: 'account', remote, version: state.version }
  }
  if (!flight) {
    await guard(current => ({
      ...current, flight: { id: crypto.randomUUID(), data: current.data, generation: current.generation, revision },
    }))
    return 'again'
  }

  signal?.throwIfAborted()
  const updated = await api.write(flight)
  if (updated !== null) await acknowledge(store, flight, updated, signal)
  return 'again'
}

function acknowledge(store: AccountStorage, flight: Flight, revision: number, signal?: AbortSignal) {
  return store.change(current => {
    if (signal?.aborted || current.flight?.id !== flight.id) return current
    return {
      ...current, revision, syncedGeneration: flight.generation, flight: undefined,
      lastSynced: new Date().toISOString(),
    }
  })
}

export async function chooseSnapshot(store: AccountStorage, decision: SyncDecision, choice: 'local' | 'remote') {
  return store.change(current => {
    if (current.version !== decision.version) throw new Error('選択中に端末のデータが変更されました。もう一度ご確認ください。')
    const chosen = choice === 'local' ? decision.local : decision.remote?.data ?? initialData()
    const discarded = choice === 'local' ? decision.remote?.data : decision.source === 'account' ? current.data : undefined
    const archives = discarded && !sameData(chosen, discarded)
      ? [...current.archives, { createdAt: new Date().toISOString(), data: discarded }]
      : current.archives
    const next = { ...current, data: chosen, archives, flight: undefined, initialized: true }
    if (choice === 'remote') return asSynced(next, decision.remote, chosen)
    return { ...next, generation: current.generation + 1, revision: decision.remote?.revision ?? null }
  })
}
