import 'fake-indexeddb/auto'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test, vi } from 'vitest'
import { savePlan } from './activities'
import { decodeBackup, encodeBackup, restoreBackup } from './backup'
import Growth from './Growth'
import { initialData } from './initialData'
import { assignMenuCategory, defaultCategorySettings, groupedMenus, moveCategory,
  readCategorySettings, saveCategory, writeCategorySettings } from './menuCategories'
import type { Menu } from './model'
import { RoutineFields } from './RoutineFields'
import { findRoutineMenu, saveRoutine, type RoutineDraftItem } from './routines'
import { createStorage } from './storage'
import { saveMenu, saveRecord } from './training'
import { localDate } from './dates'

const now = new Date()
const date = localDate(now)
const item: RoutineDraftItem = { id: 'planned-swing', menuId: 'swing', name: '素振り', mode: 'quantity',
  recordUnit: '回', schedule: 'daily', weekdays: [], note: '', condition: '' }
const customMenu: Menu = { id: 'new-menu', category: 'その他', name: '連携練習', unit: '回', enabled: true }

test('分類の改名・並べ替え・追加でメニューID、計画・記録と成長集計を維持する', () => {
  let data = saveRoutine(initialData(), { id: 'version', startsOn: date, items: [item] }, now)
  data = savePlan(data, { date, kind: '自主練', menuIds: ['swing'] })
  data = saveRecord(data, { date, kind: '自主練', menuId: 'swing', amount: '4', duration: '', note: '', rating: '' }, undefined, now)
  data = saveMenu(data, customMenu, '', now, undefined, true)
  const chart = () => renderToStaticMarkup(<Growth data={data} />)
  const before = chart()
  const swing = data.menus.find(menu => menu.id === 'swing')!
  let settings = saveCategory(defaultCategorySettings(), '打つ練習', 'batting')
  settings = moveCategory(settings, 'batting', 1)
  settings = saveCategory(settings, '連携')
  const customId = settings.categories.at(-1)!.id
  settings = saveCategory(settings, '連携プレー', customId)
  settings = moveCategory(settings, customId, -1)
  settings = assignMenuCategory(assignMenuCategory(settings, swing, customId), customMenu, customId)
  expect(groupedMenus(settings, data.menus).map(group => group.name)).toEqual(['守備', '打つ練習', '走塁', '体づくり', '連携プレー', 'その他'])
  expect(groupedMenus(settings, data.menus).find(group => group.id === customId)?.menus).toEqual([swing, customMenu])
  expect(findRoutineMenu(data.menus, item)).toEqual(swing)
  expect(data.plans[0]).toMatchObject({ menuIds: ['swing'] })
  expect(data.records[0]).toMatchObject({ menuId: 'swing', category: '打撃', amount: 4 })
  expect(chart()).toContain('打撃 · 1件')
  expect(before).toContain('打撃 · 1件')
  expect(chart()).not.toContain('連携プレー')
  const html = renderToStaticMarkup(<RoutineFields item={item} menus={data.menus} settings={settings} change={vi.fn()} />)
  expect([...html.matchAll(/data-menu-category="([^"]+)"/g)].map(match => match[1]))
    .toEqual(settings.categories.map(category => category.name))
  expect(html).toContain('連携プレー</span><span>2種目 · 選択中</span>')
})

test('分類設定を再読込とJSON復元で保ち、旧ファイルや失敗した復元で消さない', async () => {
  const values = new Map<string, string>()
  const browser = { length: 0, key: () => null, getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) } }
  const defaults = readCategorySettings(browser)
  const data = saveMenu(initialData(), customMenu, '', now, undefined, true)
  let settings = saveCategory(defaults, '連携')
  settings = assignMenuCategory(settings, customMenu, settings.categories.at(-1)!.id)
  writeCategorySettings(browser, settings)
  expect(readCategorySettings(browser)).toEqual(settings)
  const backup = decodeBackup(encodeBackup(data, now, undefined, settings))
  expect(backup.backupVersion).toBe(1)
  expect(backup.data).toEqual(data)
  expect(JSON.stringify(backup.data)).not.toContain('categoryId')
  const device = createStorage('categories-' + crypto.randomUUID())
  const restore = async (change: Parameters<typeof device.update>[0]) => { await device.update(change) }
  writeCategorySettings(browser, defaults)
  await restoreBackup(backup, await device.read(), [], browser, restore, defaults)
  expect(readCategorySettings(browser)).toEqual(settings)
  const old = decodeBackup(encodeBackup(data, now))
  await restoreBackup(old, await device.read(), [], browser, restore, settings)
  expect(readCategorySettings(browser)).toEqual(settings)
  const reset = decodeBackup(encodeBackup(data, now, undefined, defaults))
  await expect(restoreBackup(reset, await device.read(), [], browser,
    async () => { throw new Error('write failed') }, settings)).rejects.toThrow('write failed')
  expect(readCategorySettings(browser)).toEqual(settings)
  const invalid = { ...settings, assignments: [{ menuId: 'new-menu', categoryId: 'missing' }] }
  expect(() => decodeBackup(JSON.stringify({ ...backup, menuCategories: invalid }))).toThrow('分類設定')
  expect(await device.read()).toEqual(data)
})
