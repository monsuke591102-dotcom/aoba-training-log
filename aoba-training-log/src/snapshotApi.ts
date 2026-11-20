import type { Session } from '@supabase/supabase-js'
import { validateData } from './backup'
import { config } from './cloud'
import type { RemoteSnapshot, SnapshotApi } from './sync'

export class SnapshotWriteDenied extends Error {}

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
      validateData(flight.data)
      const response = await request('rpc/training_log_write_snapshot_v2', {
        method: 'POST',
        body: JSON.stringify({ expected_revision: flight.revision, new_data: flight.data }),
      })
      if ([401, 403, 404].includes(response.status)) throw new SnapshotWriteDenied('クラウド同期の書き込みが許可されていません。')
      if (!response.ok) throw new Error('クラウドデータを保存できませんでした。')
      const rows = await response.json()
      if (!Array.isArray(rows) || rows.length !== 1) throw new Error('更新の応答が不正です。')
      if (rows[0]?.status === 'conflict' && rows[0].revision === null) return null
      if (rows[0]?.status !== 'written') throw new Error('更新の応答が不正です。')
      return readRevision(rows[0].revision)
    },
  }
}
