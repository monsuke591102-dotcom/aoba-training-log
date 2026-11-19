import { hasReflection } from './activities'
import { fromLocalDate, localDate } from './dates'
import type { LocalDate, TrainingData } from './model'
import { plannedMenuIds, routineItemForMenu } from './routines'
import { currentGoal, weekDates } from './training'

export function dailyStats(data: TrainingData, date: LocalDate, today = localDate(new Date())) {
  const plan = data.plans.find(item => item.date === date)
  if (plan?.kind === '休養日' || data.rests.some(item => item.date === date)) return { entries: [], rate: null }
  const planned = plannedMenuIds(data, date, today)
  const skipped = new Set(data.skippedMenus.filter(item => item.date === date).map(item => item.menuId))
  const records = data.records.filter(record => record.date === date)
  const recorded = new Set(records.map(record => record.menuId))
  const entries = [...data.menus, ...(data.deletedMenus ?? [])].flatMap(menu => {
    if (skipped.has(menu.id) || (!planned.has(menu.id) && !recorded.has(menu.id))) return []
    const rule = routineItemForMenu(data, date, menu.id)
    const goal = rule ? rule.target : currentGoal(data.goals, 'daily-menu', date, menu.id)
    if (!goal?.amount || (!rule && goal.unit !== menu.unit)) return []
    const matching = records.filter(record => record.menuId === menu.id && record.unit === goal.unit)
    if (matching.length === 0 && recorded.has(menu.id)) return []
    const amount = matching.reduce((sum, record) => sum + record.amount, 0)
    return [{ id: menu.id, name: menu.name, unit: goal.unit, target: goal.amount, amount }]
  })
  const average = entries.reduce((sum, entry) => sum + Math.min(entry.amount / entry.target, 1), 0) / entries.length
  const complete = entries.every(entry => entry.amount >= entry.target)
  const rate = entries.length ? complete ? 100 : Math.min(99, Math.round(average * 100)) : null
  return { entries, rate }
}

export function levelThreshold(level: number) {
  // Each next level adds 50 more points to the previous step.
  return 25 * (level - 1) * (level + 2)
}

export function levelProgress(points: number) {
  const level = Math.floor((Math.sqrt(9 + 4 * points / 25) - 1) / 2)
  return { level, remaining: levelThreshold(level + 1) - points, start: levelThreshold(level), end: levelThreshold(level + 1) }
}

const badgeDefinitions = [
  { id: 'first', label: 'はじめの一歩', condition: '初めての練習記録' },
  { id: 'ten', label: '記録の達人', condition: '異なる10日分の練習記録' },
  { id: 'thirty', label: '継続の証', condition: '異なる30日分の練習記録' },
  { id: 'goal', label: '目標クリア', condition: '初めての週間目標達成' },
  { id: 'reflection', label: '振り返り名人', condition: '初めての週次振り返り' },
  { id: 'rest', label: 'コンディション管理', condition: '初めての休養日記録' },
] as const

export function managementProgress(data: TrainingData, today: Date) {
  const todayKey = localDate(today)
  const days = new Map<LocalDate, string>()
  const weeks = new Map<LocalDate, { end: LocalDate; dates: LocalDate[] }>()
  for (const record of data.records) {
    if (record.date > todayKey) continue
    const first = days.get(record.date)
    if (first === undefined || record.createdAt < first) days.set(record.date, record.createdAt)
  }
  for (const date of [...days.keys()].sort()) {
    const [start, end] = weekDates(fromLocalDate(date))
    const week = weeks.get(start) ?? { end, dates: [] }
    week.dates.push(date)
    weeks.set(start, week)
  }
  const achievements: string[] = []
  for (const week of weeks.values()) {
    const cutoff = week.end < todayKey ? week.end : todayKey
    const goal = currentGoal(data.goals, 'weekly', cutoff)
    if (goal?.days && week.dates.length >= goal.days) {
      const qualifying = week.dates.map(date => days.get(date)!).sort().slice(0, goal.days)
      achievements.push([goal.changedAt, ...qualifying].sort().at(-1)!)
    }
  }
  const entries = data.reflections.filter(item => item.date <= todayKey && hasReflection(item))
  const daily = new Set(entries.filter(item => item.period === 'day').map(item => item.date))
  const weekly = entries.filter(item => item.period === 'week')
  const rests = data.rests.filter(item => item.date <= todayKey)
  const points = days.size * 10 + daily.size * 5 + new Set(weekly.map(item => item.date)).size * 20
    + achievements.length * 30 + new Set(rests.map(item => item.date)).size * 5
  const recordDates = [...days.values()].sort()
  const earned = [
    recordDates[0], recordDates[9], recordDates[29], achievements.sort()[0],
    weekly.map(item => item.createdAt ?? item.updatedAt).sort()[0], rests.map(item => item.createdAt).sort()[0],
  ]
  const badges = badgeDefinitions.map((badge, index) => ({ ...badge, earnedAt: earned[index] }))
  return { points, ...levelProgress(points), badges }
}




