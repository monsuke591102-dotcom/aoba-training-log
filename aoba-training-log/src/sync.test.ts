import 'fake-indexeddb/auto'
import { expect, test } from 'vitest'
import { createAccountStorage, type Flight } from './accountStorage'
import { savePlan, saveReflection, saveSkippedMenu, setRest } from './activities'
import { decodeBackup, encodeBackup, restoreChange } from './backup'
import { initialData } from './initialData'
import type { TrainingData } from './model'
import { managementProgress } from './progress'
import { chooseSnapshot, syncOnce, type RemoteSnapshot, type SnapshotApi } from './sync'
import { deleteRecord, saveGoals, saveMenu, saveRecord } from './training'

const now = new Date(2026, 10, 18, 13)
const date = '2026-11-18'
const guest = async () => initialData()
const makeRecord = (data: TrainingData, amount = '10', id?: string) =>
  saveRecord(data, { date, kind: '自主練', menuId: 'swing', amount, note: '', duration: '', rating: '' }, id, now)
const create = () => createAccountStorage('owner', 'sync-test-' + crypto.randomUUID())

class Cloud implements SnapshotApi {
  snapshot: RemoteSnapshot | null = null
  writes = 0
  offline = false
  loseReply = false
  beforeWrite?: () => Promise<void>
  async read() {
    if (this.offline) throw Error('offline')
    return structuredClone(this.snapshot)
  }
  async write(flight: Flight) {
    if (this.offline) throw Error('offline')
    await this.beforeWrite?.()
    if ((this.snapshot?.revision ?? null) !== flight.revision) return null
    this.writes += 1
    const revision = (flight.revision ?? 0) + 1
    // Exercise JSON serialization, including undefined optional fields.
    this.snapshot = { revision, data: JSON.parse(JSON.stringify(flight.data)) }
    if (this.loseReply) throw Error('reply lost')
    return revision
  }
}

async function drain(store: ReturnType<typeof create>, cloud: SnapshotApi, readGuest = guest) {
  for (let i = 0; i < 20; i++) {
    const next = await syncOnce(store, cloud, readGuest)
    if (next !== 'again') return next
  }
  throw Error('sync did not settle')
}

test('作成・編集・削除と関連データを送信し、別端末で同じデータとポイントを復元する', async () => {
  const store = create()
  const cloud = new Cloud()
  expect(await drain(store, cloud)).toBe('synced')
  await store.save(data => {
    data = makeRecord(data)
    data = saveMenu(data, data.menus[0], '30', now, '10')
    data = saveGoals(data, '1', '足をそろえる', now)
    data = savePlan(data, { date, kind: '自主練', menuIds: ['swing', 'tee'] })
    data = saveSkippedMenu(data, date, 'tee', '天候不良', '雨', false, now)
    data = setRest(data, '2026-11-17', true, now)
    return saveReflection(data, 'day', date, { success: '書いた', challenge: '', next: '' }, now)
  })
  expect(await drain(store, cloud)).toBe('synced')
  const second = create()
  expect(await drain(second, cloud)).toBe('synced')
  const original = (await second.read()).data
  expect(original).toEqual(cloud.snapshot?.data)
  expect(managementProgress(original, now)).toEqual(managementProgress((await store.read()).data, now))
  await store.save(data => makeRecord(data, '14', data.records[0].id))
  await drain(store, cloud)
  await drain(second, cloud)
  expect((await second.read()).data.records[0].amount).toBe(14)
  await store.save(data => deleteRecord(data, data.records[0].id))
  await drain(store, cloud)
  await drain(second, cloud)
  expect((await second.read()).data.records).toEqual([])
})

test('オフライン保存を再起動後に送信し、応答消失後に再送しても二重更新しない', async () => {
  const name = 'sync-restart-' + crypto.randomUUID()
  const first = createAccountStorage('owner', name)
  const cloud = new Cloud()
  await drain(first, cloud)
  cloud.offline = true
  await first.save(data => makeRecord(data))
  await expect(drain(first, cloud)).rejects.toThrow('offline')
  const restarted = createAccountStorage('owner', name)
  expect((await restarted.read()).data.records).toHaveLength(1)
  cloud.offline = false
  cloud.loseReply = true
  await expect(drain(restarted, cloud)).rejects.toThrow('reply lost')
  expect((await restarted.read()).flight).toBeDefined()
  cloud.loseReply = false
  await drain(restarted, cloud)
  expect(cloud.writes).toBe(1)
  expect((await restarted.read()).flight).toBeUndefined()
  expect(cloud.snapshot?.data.records).toHaveLength(1)
})

test('送信確定前に保存された別の記録は次のrevisionへ送る', async () => {
  const store = create()
  const cloud = new Cloud()
  await drain(store, cloud)
  await store.save(data => makeRecord(data))
  cloud.beforeWrite = async () => {
    cloud.beforeWrite = undefined
    await store.save(data => makeRecord(data, '12'))
  }
  await drain(store, cloud)
  expect(cloud.snapshot?.revision).toBe(2)
  expect(cloud.snapshot?.data.records.map(row => row.amount)).toEqual([10, 12])
})

test('空の端末はクラウドを取得し、既存ローカルがある端末は確認を待つ', async () => {
  const cloud = new Cloud()
  const existing = makeRecord(initialData(), '7')
  cloud.snapshot = { revision: 5, data: existing }
  const device = create()
  await drain(device, cloud)
  expect((await device.read()).data).toEqual(existing)
  expect(cloud.writes).toBe(0)

  const userData = makeRecord(initialData(), '11')
  const other = create()
  const decision = await drain(other, cloud, async () => userData)
  if (typeof decision === 'string') throw Error('expected decision')
  expect(decision).toMatchObject({ kind: 'initial', source: 'guest', local: userData })
  expect(cloud.snapshot.data).toEqual(existing)
  await chooseSnapshot(other, decision, 'remote')
  expect((await other.read()).data).toEqual(existing)
  expect(userData.records[0].amount).toBe(11)
})

test('競合時は送信せず、選択後も両方を保全する', async () => {
  const store = create()
  const cloud = new Cloud()
  cloud.snapshot = { revision: 1, data: makeRecord(initialData()) }
  await drain(store, cloud)
  const latest = await store.save(data => makeRecord(data, '20'))
  const remote = makeRecord(initialData(), '30')
  cloud.snapshot = { revision: 2, data: remote }
  const conflict = await drain(store, cloud)
  if (typeof conflict === 'string') throw Error('expected conflict')
  expect(conflict.kind).toBe('conflict')
  expect(cloud.writes).toBe(0)
  expect((await store.read()).data).toEqual(latest.data)
  await chooseSnapshot(store, conflict, 'remote')
  expect((await store.read()).data).toEqual(remote)
  expect((await store.read()).archives[0].data).toEqual(latest.data)
})

test('競合の確認中にクラウドが更新されると端末を選択しても上書きせず再度競合する', async () => {
  const store = create()
  const cloud = new Cloud()
  cloud.snapshot = { revision: 1, data: makeRecord(initialData()) }
  await drain(store, cloud)
  await store.save(data => makeRecord(data))
  cloud.snapshot = { revision: 2, data: makeRecord(initialData(), '20') }
  const decision = await drain(store, cloud)
  if (typeof decision === 'string') throw Error('expected conflict')
  cloud.snapshot = { revision: 3, data: makeRecord(initialData(), '30') }
  await chooseSnapshot(store, decision, 'local')
  expect(await drain(store, cloud)).toMatchObject({ kind: 'conflict' })
  expect(cloud.writes).toBe(0)
  expect(cloud.snapshot.revision).toBe(3)
})

test('アカウント切替で端末データを分離し、JSON復元も端末保存と同時に同期待ちになる', async () => {
  const name = 'sync-isolation-' + crypto.randomUUID()
  const a = createAccountStorage('project-a|a', name)
  const b = createAccountStorage('project-a|b', name)
  const otherProject = createAccountStorage('project-b|a', name)
  const cloud = new Cloud()
  await drain(a, cloud)
  const backup = decodeBackup(encodeBackup(makeRecord(initialData(), '14'), now))
  const state = await a.save(restoreChange(backup, (await a.read()).data))
  expect(state.generation).toBeGreaterThan(state.syncedGeneration)
  expect((await b.read()).data.records).toEqual([])
  expect((await otherProject.read()).data.records).toEqual([])
  await drain(a, cloud)
  expect(decodeBackup(encodeBackup((await a.read()).data)).data.records[0].amount).toBe(14)
})

test('確認後に新しい端末の保存が入った場合、古い選択を拒否する', async () => {
  const store = create()
  const cloud = new Cloud()
  const decision = await drain(store, cloud, async () => makeRecord(initialData()))
  if (typeof decision === 'string') throw Error('expected confirmation')
  await store.save(data => makeRecord(data, '42'))
  await expect(chooseSnapshot(store, decision, 'remote')).rejects.toThrow('変更されました')
  expect((await store.read()).data.records[0].amount).toBe(42)
})

test('RPC照合の直前に別端末が更新した場合は競合として保留する', async () => {
  const store = create()
  const cloud = new Cloud()
  await drain(store, cloud)
  await store.save(data => makeRecord(data))
  await drain(store, cloud)
  const local = await store.save(data => makeRecord(data, '12'))
  const remote = makeRecord(initialData(), '14')
  cloud.beforeWrite = async () => {
    cloud.beforeWrite = undefined
    cloud.snapshot = { revision: 2, data: remote }
  }
  const result = await drain(store, cloud)
  if (typeof result === 'string') throw Error('expected conflict')
  expect(result.kind).toBe('conflict')
  expect(cloud.snapshot?.data).toEqual(remote)
  expect((await store.read()).data).toEqual(local.data)
  await chooseSnapshot(store, result, 'local')
  await drain(store, cloud)
  expect(cloud.snapshot?.revision).toBe(3)
  expect(cloud.snapshot?.data.records.map(item => item.amount)).toEqual([10, 12])
  expect((await store.read()).archives[0].data).toEqual(remote)
})
