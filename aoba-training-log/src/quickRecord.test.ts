import 'fake-indexeddb/auto'
import { expect, test } from 'vitest'
import { createAccountStorage } from './accountStorage'
import { savePlan, saveSkippedMenu } from './activities'
import { decodeBackup, encodeBackup } from './backup'
import { createStorage } from './storage'
import { syncOnce, type RemoteSnapshot, type SnapshotApi } from './sync'
import { initialData } from './initialData'
import type { TrainingData } from './model'
import { dailyStats } from './progress'
import { movedOutsidePress, pressStep, quickMetrics, saveQuickRecord, type QuickChange } from './quickRecord'
import { saveMenu, saveRecord } from './training'

const date = '2026-11-18'
const now = new Date(2026, 10, 18, 13)
const change = (data: TrainingData, edit: QuickChange) => saveQuickRecord(data, date, 'swing', '回', '自主練', edit, now)

test('500ms未満は1、500ms以上は10の一回分として判定する', () => {
  expect([0, 499, 500, 1800].map(pressStep)).toEqual([1, 1, 10, 10])
  expect(movedOutsidePress(0, 0, 3, 4)).toBe(false)
  expect(movedOutsidePress(0, 0, 0, 11)).toBe(true)
})

test('短押し・長押しは同じ記録を増減し、0でクイック分だけ取り消す', () => {
  const empty = initialData()
  expect(change(empty, { delta: -10 })).toBe(empty)
  const first = change(empty, { delta: 1 })
  const more = change(first, { delta: 10 })
  expect(more.records).toMatchObject([{ amount: 11, id: first.records[0].id, entrySource: 'quick' }])
  const lower = change(more, { delta: -10 })
  expect(lower.records[0].amount).toBe(1)
  expect(change(lower, { delta: -10 }).records).toEqual([])
})

test('詳細記録を保持し、目標と同じ単位だけを集計する', () => {
  let data = initialData()
  data = saveMenu(data, data.menus[0], '', now, '10')
  data = saveRecord(data, { date, kind: '試合', menuId: 'swing', amount: '3', note: '詳細メモ', duration: '2', rating: '4' }, undefined, now)
  const detail = data.records[0]
  data = change(data, { total: '12', expected: 3 })
  expect(data.records[1].amount).toBe(9)
  expect(quickMetrics(data, date, data.menus[0])).toMatchObject({ total: 12, floor: 3, target: 10 })
  expect(dailyStats(data, date).rate).toBe(100)
  expect(() => change(data, { total: '1', expected: 12 })).toThrow('練習履歴')
  const reset = change(data, { delta: -10 })
  expect(reset.records).toEqual([detail])
})

test('負数・小数の回数・古い表示を拒否し、分の小数と秒を扱う', () => {
  let data = initialData()
  for (const total of ['-1', '1.5', '', 'Infinity']) expect(() => change(data, { total, expected: 0 })).toThrow()
  expect(() => change(change(data, { delta: 1 }), { total: '2', expected: 0 })).toThrow('実績が変わりました')
  data = saveMenu(data, { ...data.menus[0], unit: '分' }, '', now)
  data = saveQuickRecord(data, date, 'swing', '分', '自主練', { total: '1.5', expected: 0 }, now)
  expect(data.records[0].amount).toBe(1.5)
  data = saveMenu(data, { ...data.menus[0], unit: '秒' }, '', now)
  data = saveQuickRecord(data, date, 'swing', '秒', '自主練', { delta: 10 }, now)
  expect(data.records.map(record => [record.unit, record.amount])).toEqual([['分', 1.5], ['秒', 10]])
  expect(decodeBackup(encodeBackup(data)).data.records[1].entrySource).toBe('quick')
})

test('見送り中のクイック入力は実績を動かさない', () => {
  let data = change(initialData(), { delta: 1 })
  data = savePlan(data, { date, kind: '自主練', menuIds: ['swing'] })
  data = saveSkippedMenu(data, date, 'swing', '天候不良', '', true, now)
  expect(() => change(data, { delta: 10 })).toThrow('見送り中')
})

test('端末保存が再読込後も残り、アカウント保存では同時に同期待ちになる', async () => {
  const name = crypto.randomUUID()
  const local = createStorage('quick-local-' + name)
  await Promise.all([local.update(data => change(data, { delta: 1 })), local.update(data => change(data, { delta: 10 }))])
  expect((await createStorage('quick-local-' + name).read()).records[0].amount).toBe(11)
  const account = createAccountStorage('owner', 'quick-account-' + name)
  const result = await account.save(data => change(data, { delta: 1 }))
  expect(result.generation).toBeGreaterThan(result.syncedGeneration)
  expect((await createAccountStorage('owner', 'quick-account-' + name).read()).data.records[0].amount).toBe(1)
})

test('本人が追加したメニューも既存の一覧を保ったまま記録できる', () => {
  const original = initialData()
  const menu = { id: 'new-custom', name: 'タイム計測', category: 'その他' as const, unit: '秒' as const, enabled: true }
  const data = saveMenu(original, menu, '', now, '10', true)
  expect(data.menus.slice(0, -1)).toEqual(original.menus)
  const saved = saveQuickRecord(data, date, menu.id, menu.unit, '自主練', { delta: 10 }, now)
  expect(saved.records[0]).toMatchObject({ menuId: menu.id, unit: '秒', amount: 10 })
})


test('クイック記録の作成・増減・取り消しが通常のクラウド同期に反映される', async () => {
  const account = createAccountStorage('owner', 'quick-cloud-' + crypto.randomUUID())
  let remote: RemoteSnapshot | null = null
  const api: SnapshotApi = {
    async read() { return remote },
    async write(flight) {
      if ((remote?.revision ?? null) !== flight.revision) return null
      const revision = (remote?.revision ?? 0) + 1
      remote = { revision, data: JSON.parse(JSON.stringify(flight.data)) }
      return revision
    },
  }
  async function settle() {
    for (let i = 0; i < 10; i++) if (await syncOnce(account, api, async () => initialData()) === 'synced') return
    throw new Error('sync did not settle')
  }
  for (const [delta, expected] of [[10, 10], [-1, 9], [-10, 0]]) {
    await account.save(data => change(data, { delta }))
    await settle()
    const synced = await api.read()
    expect(synced?.data.records[0]?.amount ?? 0).toBe(expected)
    expect(synced?.data.records.length).toBe(expected ? 1 : 0)
  }
})
