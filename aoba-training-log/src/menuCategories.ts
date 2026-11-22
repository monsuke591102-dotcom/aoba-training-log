import type { Category, Menu } from './model'
import { InputError } from './training'

const builtIn = {
  batting: '打撃', fielding: '守備', running: '走塁', conditioning: '体づくり', other: 'その他',
} as const satisfies Record<string, Category>
const defaultIds = Object.keys(builtIn)
const storageKey = 'aoba-training-log:menu-categories'
export const unclassified = { id: '', name: '未分類' }

export type MenuCategory = { id: string; name: string }
export type CategorySettings = {
  categories: MenuCategory[]
  assignments: { menuId: string; categoryId: string }[]
}

export function defaultCategorySettings(): CategorySettings {
  return { categories: Object.entries(builtIn).map(([id, name]) => ({ id, name })), assignments: [] }
}

export function legacyCategory(id: string): Category | undefined {
  return Object.hasOwn(builtIn, id) ? builtIn[id as keyof typeof builtIn] : undefined
}

export function categoryIdForMenu(settings: CategorySettings, menu: Menu) {
  return settings.assignments.find(item => item.menuId === menu.id)?.categoryId ??
    defaultIds.find(id => legacyCategory(id) === menu.category) ?? unclassified.id
}

export function groupedMenus(settings: CategorySettings, menus: readonly Menu[]) {
  const groups = [...settings.categories, unclassified].map(category => ({ ...category, menus: [] as Menu[] }))
  const byId = new Map(groups.map(group => [group.id, group]))
  for (const menu of menus) byId.get(categoryIdForMenu(settings, menu))?.menus.push(menu)
  return groups.filter(group => group.id || group.menus.length)
}

export function isCategorySettings(value: unknown): value is CategorySettings {
  if (!value || typeof value !== 'object' || !('categories' in value) || !('assignments' in value) ||
    !Array.isArray(value.categories) || !Array.isArray(value.assignments)) return false
  const ids = new Set<string>()
  for (const entry of value.categories) {
    if (!entry || typeof entry.id !== 'string' ||
      (!defaultIds.includes(entry.id) && !/^custom-[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/.test(entry.id)) ||
      typeof entry.name !== 'string' || !entry.name.trim() || ids.has(entry.id)) return false
    ids.add(entry.id)
  }
  const menus = new Set<string>()
  for (const entry of value.assignments) {
    if (!entry || typeof entry.menuId !== 'string' || !entry.menuId.trim() || menus.has(entry.menuId) ||
      !ids.has(entry.categoryId)) return false
    menus.add(entry.menuId)
  }
  return defaultIds.every(id => ids.has(id))
}

type CategoryStorage = Pick<Storage, 'getItem' | 'setItem'>

export function readCategorySettings(storage: CategoryStorage): CategorySettings {
  const saved = storage.getItem(storageKey)
  if (saved === null) return defaultCategorySettings()
  const value: unknown = JSON.parse(saved)
  if (!isCategorySettings(value)) throw new InputError('分類設定を読み取れませんでした。')
  return value
}

export function writeCategorySettings(storage: CategoryStorage, settings: CategorySettings) {
  storage.setItem(storageKey, JSON.stringify(settings))
}

export function browserCategorySettings() {
  try { return readCategorySettings(window.localStorage) }
  catch { return defaultCategorySettings() }
}

export function saveCategory(settings: CategorySettings, input: string, id?: string): CategorySettings {
  const name = input.trim()
  if (!name) throw new InputError('分類名を入力してください。')
  return { ...settings, categories: id === undefined
    ? [...settings.categories, { id: 'custom-' + crypto.randomUUID(), name }]
    : settings.categories.map(category => category.id === id ? { ...category, name } : category) }
}

export function moveCategory(settings: CategorySettings, id: string, offset: -1 | 1): CategorySettings {
  const categories = [...settings.categories]
  const index = categories.findIndex(category => category.id === id)
  const next = index + offset
  if (index < 0 || next < 0 || next >= categories.length) return settings
  const [category] = categories.splice(index, 1)
  categories.splice(next, 0, category)
  return { ...settings, categories }
}

export function assignMenuCategory(settings: CategorySettings, menu: Menu, categoryId: string): CategorySettings {
  if (categoryIdForMenu(settings, menu) === categoryId) return settings
  if (!settings.categories.some(category => category.id === categoryId)) throw new InputError('分類を選び直してください。')
  const assignments = settings.assignments.filter(item => item.menuId !== menu.id)
  if (legacyCategory(categoryId) !== menu.category) assignments.push({ menuId: menu.id, categoryId })
  return { ...settings, assignments }
}
