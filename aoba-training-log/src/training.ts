import { localDate } from './dates'
import type { Goal, LocalDate, Menu, TrainingData, TrainingKind, TrainingRecord } from './model'

export class InputError extends Error {}

export const trainingKinds: TrainingKind[] = ['自主練', 'チーム練習', '試合']

export function setMenuEnabled(data: TrainingData, id: string, enabled: boolean): TrainingData {
  const menu = data.menus.find(item => item.id === id)
  if (!menu) throw new InputError('メニューが見つかりません。')
  if (menu.enabled === enabled) return data
  return { ...data, menus: data.menus.map(item => item.id === id ? { ...item, enabled } : item) }
}

export function weekDates(date: Date) {
  const day = date.getDate() - (date.getDay() + 6) % 7
  const year = date.getFullYear()
  const month = date.getMonth()
  return [localDate(new Date(year, month, day)), localDate(new Date(year, month, day + 6))] as const
}

export function currentGoal<K extends Goal['kind']>(goals: Goal[], kind: K, date: LocalDate, menuId?: string) {
  return goals.findLast((goal): goal is Extract<Goal, { kind: K }> =>
    goal.kind === kind && goal.effectiveFrom <= date && (!('menuId' in goal) || goal.menuId === menuId),
  )
}

export function weeklyStats(data: TrainingData, today: Date) {
  const [start, end] = weekDates(today)
  const records = data.records.filter(record => record.date >= start && record.date <= end)
  const days = new Set(records.map(record => record.date)).size
  const goal = currentGoal(data.goals, 'weekly', localDate(today))?.days
  return { start, end, days, rate: goal ? Math.round(days / goal * 100) : null }
}

export function menuStats(data: TrainingData, menu: Menu, today: Date) {
  const [start, end] = weekDates(today)
  const goal = currentGoal(data.goals, 'menu', localDate(today), menu.id)
  const target = goal?.unit === menu.unit ? goal.amount : null
  const amount = data.records.filter(record => record.menuId === menu.id && record.unit === menu.unit &&
    record.date >= start && record.date <= end).reduce((sum, record) => sum + record.amount, 0)
  return { target, amount, rate: target ? Math.round(amount / target * 100) : null }
}

export function positiveNumber(value: string, label: string, optional = false, integer = false) {
  if (value.trim() === '' && optional) return undefined
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0 || number > Number.MAX_SAFE_INTEGER || (integer && !Number.isInteger(number))) {
    throw new InputError(label + (integer ? 'は1以上の整数を入力してください。' : 'は0より大きい数を入力してください。'))
  }
  return number
}

export interface RecordDraft {
  date: string
  menuId: string
  kind: TrainingKind
  amount: string
  duration: string
  note: string
  rating: string
}

export function saveRecord(data: TrainingData, draft: RecordDraft, id?: string, now = new Date()): TrainingData {
  const parsed = new Date(draft.date + 'T12:00:00')
  const date = draft.date as LocalDate
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || localDate(parsed) !== date || date > localDate(now)) {
    throw new InputError('練習日は今日以前の有効な日付を選んでください。')
  }
  const previous = data.records.find(record => record.id === id)
  if (id && !previous) throw new InputError('この記録はすでに削除されています。')
  const menu = data.menus.find(item => item.id === draft.menuId && item.enabled)
  const snapshot = previous?.menuId === draft.menuId
    ? { menuName: previous.menuName, category: previous.category, unit: previous.unit }
    : menu && { menuName: menu.name, category: menu.category, unit: menu.unit }
  if (!snapshot) throw new InputError('有効な練習メニューを選んでください。')
  if ((previous?.date !== date || previous.menuId !== draft.menuId) &&
      data.skippedMenus.some(item => item.date === date && item.menuId === draft.menuId)) {
    throw new InputError('このメニューは見送り中です。新たに記録するには、カレンダーから見送りを解除してください。')
  }
  const amount = positiveNumber(draft.amount, '実施量', false, snapshot.unit !== '分')!
  const durationMinutes = positiveNumber(draft.duration, '所要時間', true)
  if (!trainingKinds.includes(draft.kind)) throw new InputError('練習の種類を選んでください。')
  if (draft.rating && !/^[1-5]$/.test(draft.rating)) throw new InputError('自己評価は1〜5から選んでください。')
  const timestamp = now.toISOString()
  const record: TrainingRecord = {
    id: previous?.id ?? crypto.randomUUID(), date, kind: draft.kind, menuId: draft.menuId,
    ...snapshot, amount, durationMinutes, note: draft.note.trim(),
    rating: draft.rating ? Number(draft.rating) as TrainingRecord['rating'] : undefined,
    createdAt: previous?.createdAt ?? timestamp, updatedAt: timestamp,
  }
  return { ...data, records: [...data.records.filter(item => item.id !== record.id), record] }
}

export function deleteRecord(data: TrainingData, id: string): TrainingData {
  return { ...data, records: data.records.filter(record => record.id !== id) }
}

function goalStamp(now: Date) {
  return { id: crypto.randomUUID(), effectiveFrom: localDate(now), changedAt: now.toISOString() }
}

export function saveGoals(data: TrainingData, days: string, skill: string, now = new Date()): TrainingData {
  const count = positiveNumber(days, '週間練習日数', true, true) ?? null
  if (count !== null && count > 7) throw new InputError('週間練習日数は1〜7日で入力してください。')
  const date = localDate(now)
  const text = skill.trim()
  const goals = [...data.goals]
  if (count !== (currentGoal(goals, 'weekly', date)?.days ?? null)) goals.push({ ...goalStamp(now), kind: 'weekly', days: count })
  if (text !== (currentGoal(goals, 'skill', date)?.text ?? '')) goals.push({ ...goalStamp(now), kind: 'skill', text })
  return { ...data, goals }
}

export function saveMenu(data: TrainingData, menu: Menu, target: string, now = new Date(), dailyTarget?: string, create = false): TrainingData {
  const name = menu.name.trim()
  if (!name) throw new InputError('メニュー名を入力してください。')
  const amount = positiveNumber(target, '目標値', true, menu.unit !== '分') ?? null
  if (create && data.menus.some(item => item.id === menu.id)) throw new InputError('このメニューはすでに登録されています。')
  if (!create && !data.menus.some(item => item.id === menu.id)) throw new InputError('メニューが見つかりません。')
  const saved = { ...menu, name }
  const existing = currentGoal(data.goals, 'menu', localDate(now), menu.id)
  const goals = [...data.goals]
  if (amount !== (existing?.amount ?? null) || (existing && existing.unit !== menu.unit)) {
    goals.push({ ...goalStamp(now), kind: 'menu', menuId: menu.id, menuName: name, unit: menu.unit, amount })
  }
  const previousDaily = currentGoal(goals, 'daily-menu', localDate(now), menu.id)
  const daily = dailyTarget === undefined
    ? previousDaily?.unit === menu.unit ? previousDaily.amount : null
    : positiveNumber(dailyTarget, '日次目標値', true, menu.unit !== '分') ?? null
  if (daily !== (previousDaily?.amount ?? null) || (previousDaily && previousDaily.unit !== menu.unit)) {
    goals.push({ ...goalStamp(now), kind: 'daily-menu', menuId: menu.id, menuName: name, unit: menu.unit, amount: daily })
  }
  return { ...data, menus: create ? [...data.menus, saved] : data.menus.map(item => item.id === menu.id ? saved : item), goals }
}



