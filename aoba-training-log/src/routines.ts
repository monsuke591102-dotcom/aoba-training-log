import { fromLocalDate, isLocalDate, localDate } from './dates'
import type { LocalDate, Menu, RoutineItem, RoutineVersion, TrainingData } from './model'
import { saveMenu, InputError } from './training'

export const weekdays = ['日', '月', '火', '水', '木', '金', '土']

export type RoutineDraftItem = RoutineItem & {
  pausedLink?: Pick<RoutineItem, 'recordUnit' | 'target'> & { menuId: string }
}

export function changeRoutineMode(item: RoutineDraftItem, mode: RoutineItem['mode'], menus: Menu[]): RoutineDraftItem {
  const unit = item.recordUnit ?? menus.find(menu => menu.id === item.menuId)?.unit
  const pausedLink = item.menuId === undefined ? item.pausedLink
    : { menuId: item.menuId, recordUnit: unit, target: item.target }
  if (mode === 'quantity' && pausedLink) {
    const menu = menus.find(menu => menu.id === pausedLink.menuId)
    if (menu && menu.unit === pausedLink.recordUnit) {
      return { ...item, ...pausedLink, mode, pausedLink: undefined }
    }
  }
  return { ...item, menuId: undefined, mode, target: undefined, pausedLink,
    recordUnit: mode === 'quantity' ? unit : undefined }
}

export function selectRoutineMenu(item: RoutineDraftItem, menu: Menu): RoutineDraftItem {
  return { ...item, menuId: menu.id, recordUnit: menu.unit, mode: 'quantity',
    name: item.name || menu.name, target: undefined, pausedLink: undefined }
}

export function routineForDate(data: TrainingData, date: LocalDate) {
  let active: RoutineVersion | undefined
  for (const version of data.routineVersions ?? []) {
    if (version.startsOn <= date && (!active || active.startsOn <= version.startsOn)) active = version
  }
  return active
}

export function isMenuHidden(menus: Menu[], menuId?: string) {
  return menus.some(menu => menu.id === menuId && !menu.enabled)
}

export function isMenuDeleted(data: TrainingData, date: LocalDate, menuId?: string) {
  return data.deletedMenus?.some(menu => menu.id === menuId && date >= menu.deletedOn) ?? false
}

export function findRoutineMenu(menus: Menu[], item: RoutineItem) {
  if (item.menuId !== undefined) return menus.find(menu => menu.id === item.menuId)
  if (item.mode !== 'quantity') return undefined
  const group = item.group?.trim()
  const label = (group ? group + ' · ' : '') + item.name.trim()
  const normalize = (value: string) => value.normalize('NFKC').trim()
  return menus.find(menu => menu.unit === item.recordUnit && normalize(menu.name) === normalize(label))
}

export function dailyRoutine(data: TrainingData, date: LocalDate, today = localDate(new Date())) {
  const items = (routineForDate(data, date)?.items ?? [])
    .filter(item => !isMenuDeleted(data, date, item.menuId) && (date < today || !isMenuHidden(data.menus, item.menuId)))
  const day = fromLocalDate(date).getDay()
  const additions = new Set(data.routineAdditions?.filter(item => item.date === date).map(item => item.itemId))
  const selected = items.filter(item => additions.has(item.id) || item.schedule === 'daily' ||
    (item.schedule === 'weekdays' && item.weekdays.includes(day)))
  return { selected, optional: items.filter(item => item.schedule === 'conditional' && !additions.has(item.id)), additions }
}

export function routineItemForMenu(data: TrainingData, date: LocalDate, menuId: string) {
  return routineForDate(data, date)?.items.find(item => item.menuId === menuId)
}

export function nextMonth(today: Date) {
  return localDate(new Date(today.getFullYear(), today.getMonth() + 1, 1))
}

export function saveRoutine(data: TrainingData, version: Omit<RoutineVersion, 'items'> & { items: RoutineDraftItem[] }, now = new Date()): TrainingData {
  if (!isLocalDate(version.startsOn) || version.startsOn < localDate(now)) throw new InputError('適用開始日は今日以降を選んでください。')
  const versions = data.routineVersions ?? []
  if (versions.some(item => item.id === version.id || (version.sourceKey && item.sourceKey === version.sourceKey))) {
    throw new InputError('この計画はすでに登録されています。')
  }
  const seen = new Set<string>()
  const menuIds = new Set<string>()
  let candidate = data
  const items = version.items.map(({ pausedLink, ...draft }) => {
    if (draft.mode === 'quantity' && pausedLink) {
      throw new InputError(draft.name + 'の記録メニューまたは単位が変わりました。記録メニューを選び直してください。')
    }
    if (data.deletedMenus?.some(menu => menu.id === draft.menuId)) {
      throw new InputError(draft.name + 'は削除済みです。記録メニューを選び直すか、計画から除外してください。')
    }
    let item = { ...draft, group: draft.group?.trim() || undefined }
    const linked = item.menuId !== undefined ? findRoutineMenu(candidate.menus, item) : undefined
    if (item.menuId !== undefined && (!linked || (item.recordUnit !== undefined && item.recordUnit !== linked.unit))) {
      throw new InputError(item.name + 'の記録メニューまたは単位が変わりました。記録メニューを選び直してください。')
    }
    if (item.mode === 'quantity') {
      const unit = item.recordUnit ?? linked?.unit
      if (!unit) throw new InputError(item.name + 'の記録単位を選んでください。')
      const label = item.group ? item.group + ' · ' + item.name.trim() : item.name.trim()
      const existing = linked ?? findRoutineMenu(candidate.menus, item)
      if (existing) item = { ...item, menuId: existing.id, recordUnit: unit }
      else {
        const menu = { id: crypto.randomUUID(), name: label, unit, category: 'その他' as const, enabled: true }
        candidate = saveMenu(candidate, menu, '', now, undefined, true)
        item = { ...item, menuId: menu.id, recordUnit: unit }
      }
    }
    if (!item.name.trim() || !item.id || seen.has(item.id)) throw new InputError('種目名と種目の重複を確認してください。')
    seen.add(item.id)
    if (item.schedule === 'weekdays' && !item.weekdays.length) throw new InputError(item.name + 'の曜日を選んでください。')
    if (item.menuId) {
      const menu = candidate.menus.find(menu => menu.id === item.menuId)
      if (!menu || menuIds.has(menu.id)) throw new InputError('同じ記録メニューへの重複は登録できません。')
      if (item.target && (menu.unit !== item.target.unit || !Number.isFinite(item.target.amount) ||
        item.target.amount <= 0 || item.target.amount > Number.MAX_SAFE_INTEGER ||
        (menu.unit !== '分' && !Number.isInteger(item.target.amount)))) throw new InputError(item.name + 'の数量と単位を確認してください。')
      menuIds.add(menu.id)
    }
    if (item.target && !item.menuId) throw new InputError('数量目標には記録メニューの指定が必要です。')
    if (!['daily', 'weekdays', 'conditional'].includes(item.schedule) ||
      item.weekdays.some(day => !Number.isInteger(day) || day < 0 || day > 6)) throw new InputError('実施区分を確認してください。')
    return { ...item, weekdays: item.schedule === 'weekdays' ? [...new Set(item.weekdays)].sort() : [], name: item.name.trim() }
  })
  return { ...candidate, routineVersions: [...versions, { ...version, items }] }
}

export function setRoutineAddition(data: TrainingData, date: LocalDate, itemId: string, add: boolean): TrainingData {
  const rule = routineForDate(data, date)?.items.find(item => item.id === itemId && item.schedule === 'conditional')
  if (!isLocalDate(date) || !rule ||
      (add && (isMenuDeleted(data, date, rule.menuId) || (date >= localDate(new Date()) && isMenuHidden(data.menus, rule.menuId))))) {
    throw new InputError('その日に追加できる条件付きメニューがありません。')
  }
  const old = data.routineAdditions ?? []
  const rest = old.filter(item => item.date !== date || item.itemId !== itemId)
  if (add === (rest.length !== old.length)) return data
  return { ...data, routineAdditions: add ? [...rest, { date, itemId }] : rest }
}

export function plannedMenuIds(data: TrainingData, date: LocalDate, today = localDate(new Date())) {
  const plan = data.plans.find(item => item.date === date)
  const explicit = plan && plan.kind !== '休養日' ? plan.menuIds : []
  return new Set([
    ...explicit.filter(id => !isMenuDeleted(data, date, id) && (date < today || !isMenuHidden(data.menus, id))),
    ...dailyRoutine(data, date, today).selected.flatMap(item => item.menuId ? [item.menuId] : []),
  ])
}

export function planTarget(data: TrainingData, date: LocalDate, menu: Menu) {
  const rule = routineItemForMenu(data, date, menu.id)
  if (!rule) return undefined
  return rule.target?.unit === menu.unit ? rule.target.amount : null
}


export function setRoutineCompletion(data: TrainingData, date: LocalDate, itemId: string, done: boolean): TrainingData {
  if (!isLocalDate(date) || !dailyRoutine(data, date).selected.some(item => item.id === itemId && item.mode === 'check')) {
    throw new InputError('今日の計画を確認してください。')
  }
  const old = data.routineCompletions ?? []
  const rest = old.filter(item => item.date !== date || item.itemId !== itemId)
  if (done === (rest.length !== old.length)) return data
  return { ...data, routineCompletions: done ? [...rest, { date, itemId }] : rest }
}
