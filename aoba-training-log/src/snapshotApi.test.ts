import 'fake-indexeddb/auto'
import { openDB } from 'idb'
import type { Session } from '@supabase/supabase-js'
import { afterEach, expect, test, vi } from 'vitest'
import { decodeBackup, encodeBackup } from './backup'
import { initialData } from './initialData'
import { emptyMatchDetails } from './matchDetails'
import { defaultCategorySettings } from './menuCategories'
import { snapshotApi, SnapshotWriteDenied } from './snapshotApi'
import { createAccountStorage } from './accountStorage'
import { createStorage } from './storage'
import { chooseSnapshot, syncOnce } from './sync'

vi.mock('./cloud', () => ({ config: { url: 'https://cloud.invalid', key: 'fixture-key' } }))

const session = { access_token: 'fixture-token', user: { id: 'fixture-user' } } as Session
const signal = new AbortController().signal
const flight = { id: 'fixture-flight', data: initialData(), generation: 1, revision: null }
const timestamp = '2026-11-20T01:00:00.000Z'
const detailedData = { ...initialData(), matches: [{ id: 'match-1', date: '2026-11-20' as const,
  good: '', improve: '', createdAt: timestamp, updatedAt: timestamp, details: emptyMatchDetails() }] }
afterEach(() => vi.unstubAllGlobals())

test.each(([1, 2, 3] as const).flatMap(version => [null, 2].map(revision => ({ version, revision }))))(
  '詳細v$versionを通信前に拒否する（revision $revision）', async ({ version, revision }) => {
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  const timestamp = '2026-11-20T01:00:00.000Z'
  const data = { ...initialData(), matches: [{ id: 'match-1', date: '2026-11-20' as const,
    good: '', improve: '', createdAt: timestamp, updatedAt: timestamp, details: { ...emptyMatchDetails(), version } }] }
  await expect(snapshotApi(session, signal).write({ ...flight, data, revision })).rejects.toThrow('端末内専用')
  expect(fetch).not.toHaveBeenCalled()
})

test.each([null, 2])('作成・更新とも新版RPCに送信し、書き込まれたrevisionを返す（%s）', async revision => {
  const fetch = vi.fn().mockResolvedValue(Response.json([{ status: 'written', revision: (revision ?? 0) + 1 }]))
  vi.stubGlobal('fetch', fetch)
  const api = snapshotApi(session, signal)
  expect(await api.write({ ...flight, revision })).toBe((revision ?? 0) + 1)
  expect(fetch).toHaveBeenCalledExactlyOnceWith('https://cloud.invalid/rest/v1/rpc/training_log_write_snapshot_v2',
    expect.objectContaining({ method: 'POST', signal, cache: 'no-store',
      headers: { apikey: 'fixture-key', Authorization: 'Bearer fixture-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ expected_revision: revision, new_data: flight.data }) }))
})

test('書き込み拒否、通信失敗、revision競合を異なる結果にする', async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(new Response(null, { status: 401 }))
    .mockResolvedValueOnce(new Response(null, { status: 403 }))
    .mockResolvedValueOnce(new Response(null, { status: 404 }))
    .mockRejectedValueOnce(new TypeError('network failed'))
    .mockResolvedValueOnce(Response.json([{ status: 'conflict', revision: null }]))
  vi.stubGlobal('fetch', fetch)
  const api = snapshotApi(session, signal)
  await expect(api.write(flight)).rejects.toBeInstanceOf(SnapshotWriteDenied)
  await expect(api.write(flight)).rejects.toBeInstanceOf(SnapshotWriteDenied)
  await expect(api.write(flight)).rejects.toBeInstanceOf(SnapshotWriteDenied)
  await expect(api.write(flight)).rejects.toThrow('network failed')
  await expect(api.write(flight)).resolves.toBeNull()
})

test.each([
  { rows: [] }, { rows: [{ status: 'updated', revision: 1 }] }, { rows: [{ status: 'conflict', revision: 1 }] },
  { rows: [{ status: 'written', revision: 1 }, { status: 'written', revision: 2 }] },
])('新版RPCの戻り値として不正な配列を拒否する（%j）', async ({ rows }) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(rows)))
  await expect(snapshotApi(session, signal).write(flight)).rejects.toThrow('更新の応答が不正')
})

test('通常JSONの分類設定・月別目標は同期ペイロードに含まれない', async () => {
  const backup = decodeBackup(encodeBackup(flight.data, new Date(timestamp),
    [{ start: '2026-11-01', days: 15 }], defaultCategorySettings()))
  const fetch = vi.fn().mockResolvedValue(Response.json([{ status: 'written', revision: 1 }]))
  vi.stubGlobal('fetch', fetch)
  await expect(snapshotApi(session, signal).write({ ...flight, data: backup.data })).resolves.toBe(1)
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ expected_revision: null, new_data: flight.data })
})

test.each([
  { name: '権限拒否', error: SnapshotWriteDenied, response: () => new Response(null, { status: 403 }) },
  { name: '通信切断', error: 'network failed', response: () => { throw new TypeError('network failed') } },
  { name: 'revisionの不一致', error: 'revisionが送信内容と一致しません', response: () => Response.json([{ status: 'written', revision: 9 }]) },
])('$name後に開き直しても保留中のデータを再送できる', async ({ error, response }) => {
  const db = 'write-failure-' + crypto.randomUUID()
  const store = createAccountStorage('fixture-user', db)
  const saved = await store.save(data => ({ ...data, pendingFixture: 'keep' }))
  const fetch = vi.fn(async (_url: string, request: RequestInit) => request.method === 'POST'
    ? response() : Response.json([]))
  vi.stubGlobal('fetch', fetch)
  const api = snapshotApi(session, signal)
  await syncOnce(store, api, async () => initialData())
  await syncOnce(store, api, async () => initialData())
  await expect(syncOnce(store, api, async () => initialData())).rejects.toThrow(error)
  const reopened = createAccountStorage('fixture-user', db)
  expect(await reopened.read()).toMatchObject({ data: saved.data, generation: saved.generation, syncedGeneration: 0 })
  expect((await reopened.read()).flight?.data).toEqual(saved.data)
  fetch.mockImplementation(async (_url, request) => request.method === 'POST'
    ? Response.json([{ status: 'written', revision: 1 }]) : Response.json([]))
  await expect(syncOnce(reopened, api, async () => initialData())).resolves.toBe('again')
  expect(await reopened.read()).toMatchObject({ data: saved.data, syncedGeneration: saved.generation, revision: 1 })
})

test('読み取りでは本人IDを要求し、破損JSON・空行以外の不正形式・試合詳細を拒否する', async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(Response.json([{ revision: 2, data: flight.data }]))
    .mockResolvedValueOnce(Response.json([null]))
    .mockResolvedValueOnce(new Response('{broken'))
    .mockResolvedValueOnce(Response.json([{ revision: '2', data: flight.data }]))
    .mockResolvedValueOnce(Response.json([{ revision: 2, data: { schemaVersion: 3 } }]))
    .mockResolvedValueOnce(Response.json([{ revision: 2, data: detailedData }]))
  vi.stubGlobal('fetch', fetch)
  const api = snapshotApi(session, signal)
  await expect(api.read()).resolves.toEqual({ data: flight.data, revision: 2 })
  expect(fetch.mock.calls[0][0]).toBe('https://cloud.invalid/rest/v1/training_log_snapshots?user_id=eq.fixture-user&select=revision%2Cdata')
  await expect(api.read()).rejects.toThrow('クラウドの応答が不正')
  await expect(api.read()).rejects.toBeInstanceOf(SyntaxError)
  await expect(api.read()).rejects.toThrow('revisionが不正')
  await expect(api.read()).rejects.toThrow('練習メニュー')
  await expect(api.read()).rejects.toThrow('端末内専用')
})

test('旧アカウントキャッシュに試合詳細があれば通信前に止め、古い応答で置き換えない', async () => {
  const name = 'legacy-details-' + crypto.randomUUID()
  const store = createAccountStorage('fixture-user', name)
  const normal = await store.change(state => ({ ...state, initialized: true, revision: 1 }))
  const legacy = { ...normal, data: detailedData }
  const db = await openDB(name, 1)
  try { await db.put('accounts', legacy, 'fixture-user') }
  finally { db.close() }
  const fetch = vi.fn().mockResolvedValue(Response.json([{ data: flight.data, revision: 2 }]))
  vi.stubGlobal('fetch', fetch)
  await expect(syncOnce(store, snapshotApi(session, signal), async () => initialData())).rejects.toThrow('端末内専用')
  expect(fetch).not.toHaveBeenCalled()
  expect(await createAccountStorage('fixture-user', name).read()).toEqual(legacy)
})

test('初回同期で旧クラウドデータを明示的に選んでも端末内の詳細はゲスト領域に残る', async () => {
  const name = crypto.randomUUID()
  const guest = createStorage('guest-' + name)
  const account = createAccountStorage('fixture-user', 'account-' + name)
  await guest.update(() => detailedData)
  const fetch = vi.fn().mockImplementation(() => Promise.resolve(Response.json([{ data: flight.data, revision: 1 }])))
  vi.stubGlobal('fetch', fetch)
  const result = await syncOnce(account, snapshotApi(session, signal), guest.read)
  if (typeof result === 'string') throw new Error('Expected initial sync confirmation')
  expect(result).toMatchObject({ kind: 'initial', source: 'guest', local: detailedData })
  await expect(chooseSnapshot(account, result, 'local')).rejects.toThrow('端末内専用')
  await chooseSnapshot(account, result, 'remote')
  expect(await guest.read()).toEqual(detailedData)
  expect((await account.read()).data).toEqual(flight.data)
  expect(fetch).toHaveBeenCalledTimes(1)
})
