import { fromLocalDate, isLocalDate, monthDates } from './dates'
import type { LocalDate, TrainingData } from './model'
import { InputError, trainingDaysInRange } from './training'

export type GoalStorage = Pick<Storage, 'getItem' | 'setItem' | 'key' | 'length'>
export type MonthlyGoal = { start: LocalDate; days: number }
const goalsKey = 'aoba-training-log:monthly-goals'
const legacyPrefix = 'aoba-training-log:monthly-goal:'

function validDays(days: number, limit: number) {
  return Number.isInteger(days) && days >= 1 && days <= limit
}

export function isMonthlyGoal(value: unknown): value is MonthlyGoal {
  if (!value || typeof value !== 'object' || !('start' in value) || !('days' in value)) return false
  const { start, days } = value
  return typeof start === 'string' && isLocalDate(start) && start.endsWith('-01') &&
    typeof days === 'number' && validDays(days, monthDates(fromLocalDate(start)).length)
}

const ordered = (goals: readonly MonthlyGoal[]) => [...goals].sort((a, b) => a.start.localeCompare(b.start))

export function readMonthlyGoals(storage: GoalStorage): MonthlyGoal[] {
  const saved = storage.getItem(goalsKey)
  if (saved !== null) {
    const goals: unknown = JSON.parse(saved)
    if (!Array.isArray(goals) || !goals.every(isMonthlyGoal) || new Set(goals.map(goal => goal.start)).size !== goals.length) {
      throw new InputError('月別目標の保存データを読み取れませんでした。')
    }
    return ordered(goals)
  }
  const goals: MonthlyGoal[] = []
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index)
    if (!key?.startsWith(legacyPrefix)) continue
    const goal = { start: key.slice(legacyPrefix.length) + '-01', days: Number(storage.getItem(key)) }
    if (isMonthlyGoal(goal)) goals.push(goal)
  }
  return ordered(goals)
}

export function replaceMonthlyGoals(storage: GoalStorage, goals: readonly MonthlyGoal[]) {
  storage.setItem(goalsKey, JSON.stringify(ordered(goals)))
}

export function readMonthlyGoal(storage: GoalStorage, start: LocalDate): number | null {
  return readMonthlyGoals(storage).find(goal => goal.start === start)?.days ?? null
}

export function saveMonthlyGoal(storage: GoalStorage, start: LocalDate, input: string): number | null {
  const value = input.trim()
  const days = value === '' ? null : Number(value)
  const limit = monthDates(fromLocalDate(start)).length
  if (days !== null && (!/^\d+$/.test(value) || !isMonthlyGoal({ start, days }))) {
    throw new InputError(`目標練習日数は1〜${limit}日の整数で入力してください。`)
  }
  const goals = readMonthlyGoals(storage).filter(goal => goal.start !== start)
  if (days !== null) goals.push({ start, days })
  replaceMonthlyGoals(storage, goals)
  return days
}

export function monthlyTrainingDays(data: Pick<TrainingData, 'records'>, month: LocalDate) {
  const { start, end } = monthDates(fromLocalDate(month))
  return trainingDaysInRange(data, start, end)
}
