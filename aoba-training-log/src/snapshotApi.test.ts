import 'fake-indexeddb/auto'
import type { Session } from '@supabase/supabase-js'
import { afterEach, expect, test, vi } from 'vitest'
import { initialData } from './initialData'
import { emptyMatchDetails } from './matchDetails'
import { snapshotApi, SnapshotWriteDenied } from './snapshotApi'
import { createAccountStorage } from './accountStorage'
import { syncOnce } from './sync'

vi.mock('./cloud', () => ({ config: { url: 'https://cloud.invalid', key: 'fixture-key' } }))

const session = { access_token: 'fixture-token', user: { id: 'fixture-user' } } as Session
const signal = new AbortController().signal
const flight = { id: 'fixture-flight', data: initialData(), generation: 1, revision: null }
afterEach(() => vi.unstubAllGlobals())

test.each([null, 2])('試合詳細は作成・更新のいずれも通信前に拒否する（%s）', async revision => {
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  const timestamp = '2026-11-20T01:00:00.000Z'
  const data = { ...initialData(), matches: [{ id: 'match-1', date: '2026-11-20' as const,
    good: '', improve: '', createdAt: timestamp, updatedAt: timestamp, details: emptyMatchDetails() }] }
  await expect(snapshotApi(session, signal).write({ ...flight, data, revision })).rejects.toThrow('端末内専用')
  expect(fetch).not.toHaveBeenCalled()
})

test.each([null, 2])('作成・更新とも新版RPCに送信し、書き込まれたrevisionを返す（%s）', async revision => {
  const fetch = vi.fn().mockResolvedValue(Response.json([{ status: 'written', revision: (revision ?? 0) + 1 }]))
  vi.stubGlobal('fetch', fetch)
  const api = snapshotApi(session, signal)
  expect(await api.write({ ...flight, revision })).toBe((revision ?? 0) + 1)
  expect(fetch).toHaveBeenCalledExactlyOnceWith('https://cloud.invalid/rest/v1/rpc/training_log_write_snapshot_v2',
    expect.objectContaining({ method: 'POST', signal, body: JSON.stringify({ expected_revision: revision, new_data: flight.data }) }))
})

test('書き込み拒否、通信失敗、revision競合を異なる結果にする', async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(new Response(null, { status: 403 }))
    .mockResolvedValueOnce(new Response(null, { status: 404 }))
    .mockRejectedValueOnce(new TypeError('network failed'))
    .mockResolvedValueOnce(Response.json([{ status: 'conflict', revision: null }]))
  vi.stubGlobal('fetch', fetch)
  const api = snapshotApi(session, signal)
  await expect(api.write(flight)).rejects.toBeInstanceOf(SnapshotWriteDenied)
  await expect(api.write(flight)).rejects.toBeInstanceOf(SnapshotWriteDenied)
  await expect(api.write(flight)).rejects.toThrow('network failed')
  await expect(api.write(flight)).resolves.toBeNull()
})

test('書き込み拒否後に開き直しても保留中のデータを再送できる', async () => {
  const db = 'write-denied-' + crypto.randomUUID()
  const store = createAccountStorage('fixture-user', db)
  const saved = await store.save(data => ({ ...data, pendingFixture: 'keep' }))
  const fetch = vi.fn(async (_url: string, request: RequestInit) => request.method === 'POST'
    ? new Response(null, { status: 403 }) : Response.json([]))
  vi.stubGlobal('fetch', fetch)
  const api = snapshotApi(session, signal)
  await syncOnce(store, api, async () => initialData())
  await syncOnce(store, api, async () => initialData())
  await expect(syncOnce(store, api, async () => initialData())).rejects.toBeInstanceOf(SnapshotWriteDenied)
  const reopened = createAccountStorage('fixture-user', db)
  expect(await reopened.read()).toMatchObject({ data: saved.data, generation: saved.generation, syncedGeneration: 0 })
  expect((await reopened.read()).flight?.data).toEqual(saved.data)
  fetch.mockImplementation(async (_url, request) => request.method === 'POST'
    ? Response.json([{ status: 'written', revision: 1 }]) : Response.json([]))
  await expect(syncOnce(reopened, api, async () => initialData())).resolves.toBe('again')
  expect(await reopened.read()).toMatchObject({ data: saved.data, syncedGeneration: saved.generation, revision: 1 })
})
