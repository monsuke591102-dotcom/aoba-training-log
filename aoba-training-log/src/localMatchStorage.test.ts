import 'fake-indexeddb/auto'
import { expect, test } from 'vitest'
import { openDB } from 'idb'
import { createAccountStorage, type Flight } from './accountStorage'
import { battedBallDistribution } from './battedBallDistribution'
import { decodeBackup, encodeBackup, restoreChange } from './backup'
import { initialData } from './initialData'
import { createLocalMatchStorage, LocalRestoreConflict } from './localMatchStorage'
import { emptyMatchDetails } from './matchDetails'
import type { MatchEntry, TrainingRecord } from './model'
import { battingGames, recordHistory } from './recordHistory'
import { createStorage, type Change } from './storage'
import { chooseSnapshot, syncOnce } from './sync'

const time = '2026-11-20T12:00:00.000Z'
const record: TrainingRecord = {
  id: 'record-1', date: '2026-11-20', kind: '試合', menuId: 'swing', menuName: '素振り',
  amount: 1, unit: '回', category: '打撃', note: '', createdAt: time, updatedAt: time,
}
const standalone: MatchEntry = {
  id: 'game-1', date: record.date, good: '', improve: '', createdAt: time, updatedAt: time,
  details: { ...emptyMatchDetails(), opponent: '合成', plateAppearances: [
    { id: 'pa1', order: 1, status: 'complete', result: 'single', fieldPoint: { x: .5, y: .5 } },
  ] },
}
const immediate = <T>(job: () => Promise<T>) => job()

test('物理版1の進行中の書き込みを確定してから版2に移り、旧版の再接続を拒否する', async () => {
  const name = crypto.randomUUID()
  const base = createStorage(name + '-base')
  const old = await openDB(name, 1, { upgrade(db) { db.createObjectStore('owners') } })
  try {
    let blocked!: () => void
    const waiting = new Promise<void>(resolve => { blocked = resolve })
    const newer = createLocalMatchStorage('guest', base, name, immediate, value => { if (value) blocked() })
    const reading = newer.read()
    await waiting
    await old.put('owners', { migrated: true, matches: [standalone] }, 'guest')
    old.close()
    expect((await reading).matches).toEqual([standalone])
    await expect(openDB(name, 1)).rejects.toMatchObject({ name: 'VersionError' })
    expect((await newer.read()).matches).toEqual([standalone])
  } finally { old.close() }
})

test('試合詳細v4はJSON v5で往復し、旧JSON置換と未確認の同版置換を拒否する', () => {
  const initial = initialData()
  const old = { ...initial, matches: [standalone] }
  const match: MatchEntry = { ...standalone, details: { ...emptyMatchDetails(), version: 4,
    plateAppearances: [{ id: 'pa1', order: 1, status: 'complete', result: 'droppedThirdStrike', droppedThirdStrikeKind: 'looking' }],
  } }
  const current = { ...initial, matches: [match] }
  const olderV5 = { ...current, matches: [{ ...match, details: { ...match.details!,
    plateAppearances: [{ ...match.details!.plateAppearances[0], droppedThirdStrikeKind: undefined }],
  } }] }
  const asBackup = (data: typeof initial) => decodeBackup(encodeBackup(data))
  expect(asBackup(current)).toMatchObject({ backupVersion: 5, data: current })
  for (const version of [1, 2, 3] as const) {
    const oldBackup = asBackup({ ...old, matches: [{ ...standalone, details: { ...standalone.details!, version } }] })
    expect(oldBackup.backupVersion).toBe(version + 1)
    expect(() => restoreChange(oldBackup, current, true, true)(current)).toThrow('古い形式')
  }
  expect(restoreChange(asBackup(initial), current, true)(current).matches).toEqual([match])
  expect(() => restoreChange(asBackup(current), old)(old)).toThrow('端末内専用')
  expect(() => restoreChange(asBackup(olderV5), current, true)(current)).toThrow('置き換わります')
  expect(restoreChange(asBackup(olderV5), current, true, true)(current)).toEqual(asBackup(olderV5).data)
  expect(() => restoreChange(asBackup(olderV5), current, true, true)(old)).toThrow('確認中')
})

test('未知の試合詳細を空扱いせず基礎データと専用DBを保持する', async () => {
  const name = crypto.randomUUID()
  const base = createStorage(name + '-base')
  const future = { ...standalone, details: { ...standalone.details!, version: 5 } }
  const db = await openDB(name, 2, { upgrade(database) { database.createObjectStore('owners') } })
  try {
    const fixture = { migrated: true, matches: [future] }
    await db.put('owners', fixture, 'guest')
    const local = createLocalMatchStorage('guest', base, name, immediate)
    const before = await base.read()
    await expect(local.update(() => initialData())).rejects.toThrow('扱えない')
    expect(await db.get('owners', 'guest')).toEqual(fixture)
    expect(await base.read()).toEqual(before)
  } finally { db.close() }
})

test('ゲストの旧試合を再読み込みしても重複せず、明示コピーでのみアカウントに現れる', async () => {
  const name = crypto.randomUUID()
  const base = createStorage(name + '-guest')
  const oldStandalone = { ...standalone, id: 'old-basic', details: undefined }
  await base.update(data => ({ ...data, matches: [standalone, oldStandalone] }))
  const guest = createLocalMatchStorage('guest', base, name, immediate)
  const a = createLocalMatchStorage('project|A', createStorage(name + '-a'), name, immediate)
  const b = createLocalMatchStorage('project|B', createStorage(name + '-b'), name, immediate)
  expect((await a.read()).matches).toBeUndefined()
  expect((await guest.readSync()).matches).toBeUndefined()
  expect((await base.read()).matches).toBeUndefined()
  expect(await a.copyFromGuest(await guest.readLocal())).toBe(2)
  expect(await a.copyFromGuest(await guest.readLocal())).toBe(0)
  expect((await b.read()).matches).toBeUndefined()
  expect((await a.read()).matches?.map(row => row.id)).toEqual(['guest-copy:game-1', 'guest-copy:old-basic'])
  expect((await guest.read()).matches).toHaveLength(2)
})

test('詳細編集は送信状態を保持し、同期記録が消えても詳細を独立表示できる', async () => {
  const name = crypto.randomUUID()
  const account = createAccountStorage('project|A', name + '-base')
  const base = { read: async () => (await account.read()).data, update: async (edit: Change) => (await account.save(edit)).data }
  const linked = { ...standalone, recordId: record.id }
  const basic = { ...linked, details: undefined, good: '既存の振り返り' }
  delete basic.details
  await account.change(state => ({ ...state, data: { ...state.data, records: [record], matches: [basic] },
    revision: 4, initialized: true, flight: { id: 'noop', revision: 4, generation: 0, data: initialData() } }))
  const before = await account.read()
  const local = createLocalMatchStorage('project|A', base, name, immediate)
  expect((await local.update(data => ({ ...data, matches: [{ ...basic, details: linked.details }] }))).syncChanged).toBe(false)
  expect(await account.read()).toEqual(before)
  await account.change(state => ({ ...state, data: initialData(), flight: undefined, revision: 5 }))
  const reopened = createLocalMatchStorage('project|A', base, name, immediate)
  const recovered = await reopened.read()
  expect(recovered.matches?.[0]).toMatchObject({ id: linked.id, date: linked.date, details: linked.details })
  expect(recovered.matches?.[0].recordId).toBeUndefined()
  expect(battedBallDistribution(battingGames(recordHistory(recovered))).hits).toHaveLength(1)
  await reopened.update(({ matches, ...data }) => data)
  expect((await reopened.read()).matches).toBeUndefined()
})

test('別タブ相当の競合更新を直列化し、同日試合の座標を両方保持する', async () => {
  const name = crypto.randomUUID()
  const base = createStorage(name + '-base')
  let last: Promise<unknown> = Promise.resolve()
  const exclusive = <T>(job: () => Promise<T>) => {
    const turn = last.then(job)
    last = turn.catch(() => {})
    return turn
  }
  const first = createLocalMatchStorage('guest', base, name, exclusive)
  const second = createLocalMatchStorage('guest', base, name, exclusive)
  await Promise.all([first.update(data => ({ ...data, matches: [...(data.matches ?? []), standalone] })),
    second.update(data => ({ ...data, matches: [...(data.matches ?? []), { ...standalone, id: 'game-2' }] }))])
  const { hits } = battedBallDistribution(battingGames(recordHistory(await first.read())))
  expect(hits).toHaveLength(2)
  expect(new Set(hits.map(hit => hit.id)).size).toBe(2)
  expect(hits[0].point).toEqual(hits[1].point)
})

test('練習記録だけが送信され、同期競合の両選択で端末内試合を保持する', async () => {
  for (const choice of ['local', 'remote'] as const) {
    const name = crypto.randomUUID()
    const owner = 'project|A'
    const account = createAccountStorage(owner, name + '-base')
    const local = createLocalMatchStorage(owner, { read: async () => (await account.read()).data,
      update: async edit => (await account.save(edit)).data }, name, immediate)
    await account.change(state => ({ ...state, initialized: true, revision: 1 }))
    expect((await local.update(data => ({ ...data, matches: [standalone] }))).syncChanged).toBe(false)
    await local.update(data => ({ ...data, records: [record] }))
    let remote = { revision: 2, data: initialData() }
    const flights: Flight[] = []
    const api = { read: async () => remote, write: async (flight: Flight) => {
      flights.push(flight)
      remote = { revision: 3, data: flight.data }
      return 3
    } }
    const result = await syncOnce(account, api, async () => initialData())
    if (typeof result === 'string') throw new Error('Expected conflict')
    await chooseSnapshot(account, result, choice)
    for (let run = 0; run < 3; run++) await syncOnce(account, api, async () => initialData())
    expect((await local.read()).matches).toEqual([standalone])
    expect(flights).toHaveLength(choice === 'local' ? 1 : 0)
    if (flights.length) {
      expect(flights[0].data.records).toEqual([record])
      expect(flights[0].data.matches).toBeUndefined()
    }
  }
})

test('v1は既存詳細を保持し、詳細付き復元の中断後に再開して重複しない', async () => {
  const name = crypto.randomUUID()
  const base = createStorage(name + '-base')
  let interrupted = true
  const wrapped = { read: base.read, update: async (change: Parameters<typeof base.update>[0]) => {
    if (interrupted) throw new Error('interrupted')
    return base.update(change)
  } }
  const local = createLocalMatchStorage('guest', wrapped, name, immediate)
  await local.update(data => ({ ...data, matches: [standalone] }))
  const first = await local.read()
  const basic = decodeBackup(encodeBackup({ ...initialData(), records: [record] }))
  expect(restoreChange(basic, first, true)(first).matches).toEqual([standalone])
  const incoming = decodeBackup(encodeBackup({ ...initialData(), records: [record], matches: [
    { ...standalone, id: 'replacement' },
  ] }))
  await expect(local.update(restoreChange(incoming, first, true))).rejects.toThrow('interrupted')
  expect((await base.read()).records).toEqual([])
  interrupted = false
  const reopened = createLocalMatchStorage('guest', wrapped, name, immediate)
  const recovered = await reopened.read()
  expect(recovered).toEqual(incoming.data)
  await reopened.update(restoreChange(incoming, recovered, true))
  expect(decodeBackup(encodeBackup(await reopened.read())).data).toEqual(incoming.data)
})

test('同期用保存直後の中断から再開しても二重送信世代を作らず、明示削除で両領域を更新する', async () => {
  const name = crypto.randomUUID()
  const owner = 'project|A'
  const account = createAccountStorage(owner, name + '-base')
  let interrupt = true
  const base = { read: async () => (await account.read()).data, update: async (change: Change) => {
    const result = await account.save(change)
    if (interrupt) throw new Error('interrupted after base commit')
    return result.data
  } }
  const local = createLocalMatchStorage(owner, base, name, immediate)
  await expect(local.update(data => ({ ...data, records: [record],
    matches: [{ ...standalone, recordId: record.id, good: '合成の振り返り' }] }))).rejects.toThrow('after base commit')
  expect((await account.read()).generation).toBe(1)
  interrupt = false
  const reopened = createLocalMatchStorage(owner, base, name, immediate)
  expect((await reopened.read()).matches?.[0].details).toEqual(standalone.details)
  expect((await account.read()).generation).toBe(1)
  await reopened.update(({ matches, ...data }) => ({ ...data, records: [] }))
  expect((await account.read()).data.records).toEqual([])
  expect((await reopened.read()).matches).toBeUndefined()
})

test('旧タブ更新を保全して衝突を固定し、退避後に現在データを採用して同期を再開する', async () => {
  const name = crypto.randomUUID()
  const owner = 'project|A'
  const account = createAccountStorage(owner, name + '-base')
  const base = { read: async () => (await account.read()).data, update: async (change: Change) => (await account.save(change)).data }
  const interrupted = createLocalMatchStorage(owner, { ...base, update: async () => {
    throw new Error('restore interrupted')
  } }, name, immediate)
  await interrupted.update(data => ({ ...data, matches: [standalone] }))
  const before = await interrupted.read()
  const proposed = { ...before, records: [record], matches: [{ ...standalone, id: 'restore-candidate' }] }
  await expect(interrupted.update(() => proposed)).rejects.toThrow('restore interrupted')
  const fromOldTab = { ...record, id: 'old-tab-write' }
  await account.save(data => ({ ...data, records: [fromOldTab] }))
  const reopened = createLocalMatchStorage(owner, base, name, immediate)
  await expect(reopened.read()).rejects.toMatchObject({ owner })
  const review = await reopened.reviewRecovery()
  if (!review) throw new Error('Restore review missing')
  expect(review.before.matches).toEqual([standalone])
  expect(review.proposed.matches?.[0].id).toBe('restore-candidate')
  expect(review.current.records).toEqual([fromOldTab])
  await expect(reopened.readSync()).rejects.toBeInstanceOf(LocalRestoreConflict)
  expect(await createLocalMatchStorage('project|B', createStorage(name+'-b'), name, immediate).reviewRecovery()).toBeUndefined()
  expect(await createLocalMatchStorage('guest', createStorage(name+'-guest'), name, immediate).reviewRecovery()).toBeUndefined()

  // Another old tab edits after review; even returning to the original snapshot
  // cannot silently resume the previously interrupted restore.
  await account.save(data => ({ ...data, records: [] }))
  await expect(reopened.keepCurrent(review)).rejects.toThrow('候補を再確認')
  await expect(reopened.read()).rejects.toBeInstanceOf(LocalRestoreConflict)
  await account.save(data => ({ ...data, records: [{ ...fromOldTab, note: '最新' }] }))
  const current = await reopened.reviewRecovery()
  if (!current) throw new Error('Updated review missing')
  const saved = await account.read()
  // This recovery uses IndexedDB only and can complete while offline.
  let reads = 0
  const interruptedRecovery = createLocalMatchStorage(owner, { ...base, read: async () => {
    if (++reads === 2) throw new Error('interrupted after recovery commit')
    return base.read()
  } }, name, immediate)
  await expect(interruptedRecovery.keepCurrent(current)).rejects.toThrow('after recovery commit')
  expect(await account.read()).toEqual(saved)
  expect(await reopened.reviewRecovery()).toBeUndefined()
  const restarted = createLocalMatchStorage(owner, base, name, immediate)
  await expect(restarted.keepCurrent(current)).resolves.toEqual(current.current)
  expect(await account.read()).toEqual(saved)
  expect((await restarted.readSync()).matches).toBeUndefined()

  let remote: { revision: number; data: ReturnType<typeof initialData> } | null = null
  const api = { read: async () => remote, write: async (flight: Flight) => {
    expect(flight.data.records[0].note).toBe('最新')
    expect(flight.data.matches).toBeUndefined()
    remote = { data: flight.data, revision: 1 }
    return 1
  } }
  for (let step = 0; step < 3; step++) await syncOnce(account, api, async () => initialData())
  expect((await account.read()).revision).toBe(1)
  expect((await restarted.read()).matches).toEqual([standalone])
})
