import 'fake-indexeddb/auto'
import { expect, test } from 'vitest'
import { createAccountStorage } from './accountStorage'
import { savePlan, savePlanKind, saveSkippedMenu, setRest } from './activities'
import { initialData } from './initialData'
import { managementProgress } from './progress'
import { saveQuickRecord } from './quickRecord'
import { syncOnce, type RemoteSnapshot, type SnapshotApi } from './sync'

const date = '2026-11-18'
const now = new Date(2026, 10, 18, 13)

test('全区分の登録・変更・解除と重複の回避', () => {
  let data = initialData()
  for (const kind of ['自主練', 'チーム練習', '試合', '休養日'] as const) {
    data = savePlanKind(data, date, kind, data.plans[0])
    expect(data.plans).toHaveLength(1)
    expect(data.plans[0]).toMatchObject({ date, kind })
    expect(savePlanKind(data, date, kind, data.plans[0])).toBe(data)
  }
  expect(savePlanKind(data, date, '', data.plans[0]).plans).toEqual([])
})

test('練習区分の変更で指定メニューを維持し、予定の解除でも既存実績・休養実績・見送りを保持する', () => {
  let data = savePlan(initialData(), { date, kind: '自主練', menuIds: ['swing', 'tee'] })
  data = saveQuickRecord(data, date, 'swing', '回', '自主練', { delta: 10 }, now)
  data = saveSkippedMenu(data, date, 'tee', '天候不良', '雨', false, now)
  data = setRest(data, date, true, now)
  const changed = savePlanKind(data, date, '試合', data.plans[0])
  expect(changed.plans[0]).toMatchObject({ kind: '試合', menuIds: ['swing', 'tee'] })
  const restPlan = savePlanKind(changed, date, '休養日', changed.plans[0])
  const cleared = savePlanKind(restPlan, date, '', restPlan.plans[0])
  expect(cleared.records).toEqual(data.records)
  expect(cleared.rests).toEqual(data.rests)
  expect(cleared.skippedMenus).toEqual(data.skippedMenus)
  expect(managementProgress(cleared, now)).toEqual(managementProgress(data, now))
})

test('編集中に別の保存があれば上書きを防ぐ', () => {
  const original = savePlanKind(initialData(), date, '自主練')
  const changed = savePlanKind(original, date, '試合', original.plans[0])
  expect(() => savePlanKind(changed, date, '休養日', original.plans[0])).toThrow('予定が変更されました')
  expect(changed.plans[0].kind).toBe('試合')
})

test('ホームの予定編集とクイック入力が端末に保存され、再接続後に同じ版へ送られる', async () => {
  const key = 'home-sync-test-' + crypto.randomUUID()
  const device = createAccountStorage('athlete', key)
  let remote: RemoteSnapshot | null = null
  const api: SnapshotApi = {
    async read() { return remote },
    async write(flight) {
      if ((remote?.revision ?? null) !== flight.revision) return null
      const revision = (flight.revision ?? 0) + 1
      remote = { revision, data: flight.data }
      return revision
    },
  }
  await device.save(data => savePlanKind(data, date, 'チーム練習'))
  await device.save(data => saveQuickRecord(data, date, 'swing', '回', 'チーム練習', { delta: 10 }, now))
  const restarted = createAccountStorage('athlete', key)
  const saved = await restarted.read()
  expect(saved.generation).toBeGreaterThan(saved.syncedGeneration)
  expect(saved.data.records[0].amount).toBe(10)
  let result
  for (let i = 0; i < 10 && result !== 'synced'; i++) result = await syncOnce(restarted, api, async () => initialData())
  expect(result).toBe('synced')
  expect((await api.read())?.data).toEqual(saved.data)
})
test('カレンダーの編集中に追加・変更された予定を古いフォームから上書きしない', () => {
  const date = '2026-11-18'
  const original = { date, kind: '自主練', menuIds: ['swing'] } as const
  const before = initialData()
  const saved = savePlan(before, { ...original, menuIds: ['swing'] }, {})
  const next = savePlanKind(saved, date, 'チーム練習', saved.plans[0])
  const draft = { date, kind: '休養日' } as const
  expect(() => savePlan(saved, draft, {})).toThrow('予定が変更されました')
  expect(() => savePlan(next, draft, { expected: saved.plans[0] })).toThrow('予定が変更されました')
  expect(savePlan(next, draft, { expected: next.plans[0] }).plans).toEqual([draft])
})
