import type { Session } from '@supabase/supabase-js'
import { validateData } from './backup'
import { config } from './cloud'
import type { RemoteSnapshot, SnapshotApi } from './sync'

function readRevision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error('クラウドのrevisionが不正です。')
  }
  return value
}

export function snapshotApi(session: Session, signal: AbortSignal): SnapshotApi {
  if (!config) throw new Error('クラウド接続は未設定です。')
  const origin = config.url
  const headers = {
    apikey: config.key,
    Authorization: 'Bearer ' + session.access_token,
    'Content-Type': 'application/json',
  }
  // Pin this job to one session, including the RPC whose owner is implicit in the JWT.
  const request = (path: string, options?: RequestInit) =>
    fetch(origin + '/rest/v1/' + path, { ...options, headers: { ...headers, ...options?.headers }, signal, cache: 'no-store' })

  return {
    async read(): Promise<RemoteSnapshot | null> {
      const query = new URLSearchParams({ user_id: 'eq.' + session.user.id, select: 'revision,data' })
      const response = await request('training_log_snapshots?' + query)
      if (!response.ok) throw new Error('クラウドデータを取得できませんでした。')
      const rows = await response.json()
      if (!Array.isArray(rows) || rows.length > 1) throw new Error('クラウドの応答が不正です。')
      if (!rows.length) return null
      const { data, revision } = rows[0]
      validateData(data)
      return { data, revision: readRevision(revision) }
    },
    async write(flight) {
      const create = flight.revision === null
      const response = await request(create ? 'training_log_snapshots?select=revision' : 'rpc/training_log_update_snapshot', {
        method: 'POST',
        headers: create ? { Prefer: 'return=representation' } : undefined,
        body: JSON.stringify(create
          ? { data: flight.data }
          : { expected_revision: flight.revision, new_data: flight.data }),
      })
      if (create && response.status === 409 && (await response.json()).code === '23505') return null
      if (!response.ok) throw new Error('クラウドデータを保存できませんでした。')
      const rows = await response.json()
      if (!Array.isArray(rows) || rows.length !== 1) throw new Error('更新の応答が不正です。')
      if (!create && rows[0].status === 'conflict') return null
      if (!create && rows[0].status !== 'updated') throw new Error('更新の応答が不正です。')
      return readRevision(rows[0].revision)
    },
  }
}
