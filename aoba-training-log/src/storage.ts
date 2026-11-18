import { openDB, type DBSchema } from 'idb'
import { initialData } from './initialData'
import type { TrainingData } from './model'

type Version2 = Omit<TrainingData, 'schemaVersion' | 'skippedMenus'> & { schemaVersion: 2 }
type Version1 = Omit<Version2, 'schemaVersion' | 'rests'> & { schemaVersion: 1 }
type StoredData = TrainingData | Version2 | Version1

function migrate(data: StoredData | undefined): TrainingData {
  if (!data) return initialData()
  const normalized: Version2 | TrainingData = data.schemaVersion === 1
    ? { ...data, schemaVersion: 2, rests: [] }
    : data
  return normalized.schemaVersion === 2 ? { ...normalized, schemaVersion: 3, skippedMenus: [] } : normalized
}

interface TrainingDatabase extends DBSchema {
  training: { key: 'data'; value: StoredData }
}

export type Change = (data: TrainingData) => TrainingData

const databaseVersion = 3

export function createStorage(name = 'aoba-training-log') {
  function open() {
    return openDB<TrainingDatabase>(name, databaseVersion, {
      upgrade(db, oldVersion, _newVersion, tx) {
        // Add later migrations in order, using the upgrade transaction.
        if (oldVersion < 1) db.createObjectStore('training')
        if (oldVersion >= 1 && oldVersion < 3) {
          const store = tx.objectStore('training')
          void (async () => {
            try {
              const data = await store.get('data')
              if (data) await store.put(migrate(data), 'data')
            } catch {
              try { tx.abort() } catch { /* The upgrade already aborted. */ }
            }
          })()
          void tx.done.catch(() => {})
        }
      },
    })
  }

  return {
    async read(): Promise<TrainingData> {
      const db = await open()
      try {
        return migrate(await db.get('training', 'data'))
      } finally {
        db.close()
      }
    },
    async update(change: Change): Promise<TrainingData> {
      const db = await open()
      try {
        const tx = db.transaction('training', 'readwrite')
        try {
          const data = change(migrate(await tx.store.get('data')))
          await Promise.all([tx.store.put(data, 'data'), tx.done])
          return data
        } catch (error) {
          try { tx.abort() } catch { /* The transaction already ended. */ }
          await tx.done.catch(() => {})
          throw error
        }
      } finally {
        db.close()
      }
    },
  }
}

export const storage = createStorage()


