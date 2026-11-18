import 'fake-indexeddb/auto'
import { expect, test } from 'vitest'
import { initialData } from './initialData'
import { createStorage } from './storage'
import { deleteRecord, menuStats, saveGoals, saveMenu, saveRecord, weeklyStats, type RecordDraft } from './training'

const now = new Date(2026, 10, 18, 15)
const draft: RecordDraft = {
  date: '2026-11-18', menuId: 'swing', kind: '自主練',
  amount: '20', duration: '4.5', note: 'ゆっくり確認', rating: '4',
}

test('初期メニュー18件に目標値が設定されていない', () => {
  const data = initialData()
  expect(data.menus).toHaveLength(18)
  expect(data.menus.every(menu => menu.enabled && menuStats(data, menu, now).rate === null)).toBe(true)
  expect(weeklyStats(data, now).rate).toBeNull()
})

test('記録の作成・編集・削除と登録日時の保持', () => {
  let data = saveRecord(initialData(), draft, undefined, now)
  const record = data.records[0]
  expect(record).toMatchObject({ amount: 20, durationMinutes: 4.5, note: draft.note, rating: 4 })
  const later = new Date(now.getTime() + 1000)
  data = saveRecord(data, { ...draft, amount: '25' }, record.id, later)
  expect(data.records).toHaveLength(1)
  expect(data.records[0]).toMatchObject({ id: record.id, amount: 25, createdAt: record.createdAt, updatedAt: later.toISOString() })
  expect(deleteRecord(data, record.id).records).toEqual([])
})

test('同日の複数記録と過去日は保存でき、週間日数は月〜日で重複を除く', () => {
  let data = saveGoals(initialData(), '1', '', now)
  data = saveRecord(data, draft, undefined, now)
  data = saveRecord(data, { ...draft, menuId: 'tee' }, undefined, now)
  data = saveRecord(data, { ...draft, date: '2026-11-16' }, undefined, now)
  data = saveRecord(data, { ...draft, date: '2026-11-15' }, undefined, now)
  expect(data.records).toHaveLength(4)
  expect(weeklyStats(data, now)).toEqual({ start: '2026-11-16', end: '2026-11-22', days: 2, rate: 200 })
  expect(weeklyStats(data, new Date(2026, 10, 22)).days).toBe(2)
  expect(weeklyStats(data, new Date(2026, 10, 23)).days).toBe(0)
})

test('不正な日付・実施量・目標値を拒否する', () => {
  const data = initialData()
  for (const date of ['', '2026-02-30', '2026-11-19']) {
    expect(() => saveRecord(data, { ...draft, date }, undefined, now)).toThrow('練習日は')
  }
  for (const amount of ['', '-1', '0', '2.5', 'NaN']) {
    expect(() => saveRecord(data, { ...draft, amount }, undefined, now)).toThrow('実施量は')
  }
  expect(() => saveGoals(data, '8', '', now)).toThrow('1〜7日')
  expect(() => saveMenu(data, data.menus[0], '-1', now)).toThrow('目標値は')
})

test('メニュー名・カテゴリ・単位を変更後も過去記録を保持し、別単位を除外する', () => {
  let data = saveRecord(initialData(), draft, undefined, now)
  const id = data.records[0].id
  const menu = { ...data.menus[0], name: 'フォーム確認', unit: '分' as const, category: 'その他' as const }
  data = saveMenu(data, menu, '5', now)
  data = saveRecord(data, { ...draft, amount: '21' }, id, now)
  data = saveRecord(data, { ...draft, amount: '7.5' }, undefined, now)
  expect(data.records[0]).toMatchObject({ menuName: '素振り', unit: '回', category: '打撃', amount: 21 })
  expect(data.records[1]).toMatchObject({ menuName: 'フォーム確認', unit: '分' })
  expect(menuStats(data, menu, now)).toEqual({ target: 5, amount: 7.5, rate: 150 })
})

test('無効なメニューは既存記録の編集に使える', () => {
  let data = saveRecord(initialData(), draft, undefined, now)
  data = saveMenu(data, { ...data.menus[0], enabled: false }, '', now)
  expect(() => saveRecord(data, draft, undefined, now)).toThrow('有効な練習メニュー')
  expect(saveRecord(data, { ...draft, note: '追記' }, data.records[0].id, now).records[0].note).toBe('追記')
})

test('目標の変更と解除を保存し、同じ内容の再保存で履歴を増やさない', () => {
  let data = saveGoals(initialData(), '3', '足元を見る', now)
  data = saveGoals(data, '4', '送球前に足をそろえる', now)
  data = saveGoals(data, '4', '送球前に足をそろえる', now)
  data = saveMenu(data, data.menus[0], '20', now)
  data = saveMenu(data, { ...data.menus[0], unit: '分' }, '', now)
  data = saveGoals(data, '', '', now)
  expect(data.goals.filter(goal => goal.kind === 'weekly').map(goal => goal.days)).toEqual([3, 4, null])
  expect(data.goals.filter(goal => goal.kind === 'skill').map(goal => goal.text)).toEqual(['足元を見る', '送球前に足をそろえる', ''])
  expect(data.goals.filter(goal => goal.kind === 'menu').map(goal => [goal.amount, goal.unit])).toEqual([[20, '回'], [null, '分']])
  expect(menuStats(data, data.menus[0], now).target).toBeNull()
  expect(weeklyStats(data, now).rate).toBeNull()
})

test('IndexedDBの再接続で全データを保持し、同時の更新を失わない', async () => {
  const name = 'test-' + crypto.randomUUID()
  const storage = createStorage(name)
  await Promise.all([
    storage.update(data => saveRecord(data, draft, undefined, now)),
    storage.update(data => saveMenu(data, { ...data.menus[1], enabled: false }, '20', now)),
    storage.update(data => saveGoals(data, '2', '足を使う', now)),
  ])
  const reopened = createStorage(name)
  const data = await reopened.read()
  expect(data.records).toHaveLength(1)
  expect(data.menus[1].enabled).toBe(false)
  expect(data.goals).toHaveLength(3)
  await expect(reopened.update(data => saveGoals(data, '8', '', now))).rejects.toThrow('1〜7日')
  expect(await storage.read()).toEqual(data)
})
