import { openDB, type DBSchema } from 'idb'
import { initialData } from './initialData'
import type { TrainingData } from './model'
import type { Change } from './storage'

export interface Flight {
  id: string
  generation: number
  revision: number | null
  data: TrainingData
}

export interface AccountState {
  data: TrainingData
  version: number
  generation: number
  syncedGeneration: number
  initialized: boolean
  revision: number | null
  lastSynced?: string
  flight?: Flight
  archives: { createdAt: string; data: TrainingData }[]
}

interface SyncDatabase extends DBSchema {
  accounts: { key: string; value: AccountState }
}

const initial = (): AccountState => ({
  data: initialData(), version: 0, generation: 0, syncedGeneration: 0,
  initialized: false, revision: null, archives: [],
})

export function createAccountStorage(key: string, name = 'aoba-training-log-sync') {
  const open = () => openDB<SyncDatabase>(name, 1, {
    upgrade(db) { db.createObjectStore('accounts') },
  })

  async function change(edit: (state: AccountState) => AccountState): Promise<AccountState> {
    const db = await open()
    try {
      const tx = db.transaction('accounts', 'readwrite')
      try {
        const current = await tx.store.get(key) ?? initial()
        const next = edit(current)
        if (next === current) {
          await tx.done
          return current
        }
        const saved = { ...next, version: current.version + 1 }
        await Promise.all([tx.store.put(saved, key), tx.done])
        return saved
      } catch (error) {
        try { tx.abort() } catch { /* The transaction already ended. */ }
        await tx.done.catch(() => {})
        throw error
      }
    } finally {
      db.close()
    }
  }

  return {
    async read(): Promise<AccountState> {
      const db = await open()
      try {
        return await db.get('accounts', key) ?? initial()
      } finally {
        db.close()
      }
    },
    change,
    save(edit: Change) {
      return change(state => ({ ...state, data: edit(state.data), generation: state.generation + 1 }))
    },
  }
}

export type AccountStorage = ReturnType<typeof createAccountStorage>
