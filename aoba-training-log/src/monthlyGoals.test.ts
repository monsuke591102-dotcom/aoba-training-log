import { expect, test } from 'vitest'
import { savePlan, saveSkippedMenu } from './activities'
import { monthDates } from './dates'
import { initialData } from './initialData'
import { monthlyTrainingDays, readMonthlyGoal, saveMonthlyGoal } from './monthlyGoals'
import { dailyStats, periodAchievement } from './progress'
import { saveMenu, saveRecord } from './training'
import type { LocalDate, TrainingData } from './model'

function record(data: TrainingData, date: LocalDate, menuId: string, amount: string) {
  return saveRecord(data, { date, menuId, kind: '自主練', amount, duration: '', rating: '', note: '' },
    undefined, new Date(2028, 2, 1, 12))
}

test('週間・月間は当日までの日付×メニューを等しく集計し、超過分・見送り・休養日を除外する', () => {
  const feb = '2028-02-29'
  const mar = '2028-03-01'
  const now = new Date(2028, 1, 28, 12)
  let data = initialData()
  for (const id of ['swing', 'tee', 'core']) data = saveMenu(data, data.menus.find(menu => menu.id === id)!, '', now, '10')
  data = record(data, feb, 'swing', '20')
  data = record(data, mar, 'swing', '5')
  data = savePlan(data, { date: mar, kind: '自主練', menuIds: ['tee', 'core'] })
  data = saveSkippedMenu(data, mar, 'core', '天候不良', '', false, new Date(2028, 2, 1, 12))
  data = savePlan(data, { date: '2028-02-28', kind: '休養日' })
  data = savePlan(data, { date: '2028-03-02', kind: '自主練', menuIds: ['swing'] })
  expect(dailyStats(data, mar, mar).rate).toBe(25)
  expect(periodAchievement(data, 'week', mar)).toEqual({ start: '2028-02-28', end: mar, rate: 50 })
  expect(periodAchievement(data, 'month', mar)).toEqual({ start: mar, end: mar, rate: 25 })
  expect(periodAchievement(initialData(), 'month', mar).rate).toBeNull()
})

test('うるう年と年替わりの日数を使い、月別目標を独立して変更・解除できる', () => {
  const values = new Map<string, string>([['aoba-training-log:monthly-goal:2027-12', '12']])
  const storage = {
    get length() { return values.size },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  }
  expect(monthDates(new Date(2027, 11, 31), 1)).toEqual({ start: '2028-01-01', end: '2028-01-31', length: 31 })
  expect(monthDates(new Date(2028, 0, 31), 1)).toEqual({ start: '2028-02-01', end: '2028-02-29', length: 29 })
  expect(readMonthlyGoal(storage, '2028-02-01')).toBeNull()
  expect(readMonthlyGoal(storage, '2027-12-01')).toBe(12)
  expect(saveMonthlyGoal(storage, '2028-02-01', '29')).toBe(29)
  expect(saveMonthlyGoal(storage, '2028-01-01', '31')).toBe(31)
  expect(saveMonthlyGoal(storage, '2028-01-01', '20')).toBe(20)
  for (const input of ['0', '30', '2.5']) {
    expect(() => saveMonthlyGoal(storage, '2028-02-01', input)).toThrow('1〜29日')
  }
  expect(() => saveMonthlyGoal(storage, '2027-02-01', '29')).toThrow('1〜28日')
  expect(readMonthlyGoal(storage, '2028-02-01')).toBe(29)
  expect(readMonthlyGoal(storage, '2027-12-01')).toBe(12)
  saveMonthlyGoal(storage, '2027-12-01', '')
  expect(readMonthlyGoal(storage, '2027-12-01')).toBeNull()
  expect(saveMonthlyGoal(storage, '2028-01-01', '')).toBeNull()
  expect(readMonthlyGoal(storage, '2028-01-01')).toBeNull()
  expect(readMonthlyGoal(storage, '2028-02-01')).toBe(29)
})

test('月間実績日数は同日複数件を1日と数え、他の月を含めない', () => {
  let data = initialData()
  data = record(data, '2028-02-28', 'swing', '1')
  data = record(data, '2028-02-28', 'tee', '1')
  data = record(data, '2028-02-29', 'swing', '1')
  data = record(data, '2028-03-01', 'swing', '1')
  expect(monthlyTrainingDays(data, '2028-02-01')).toBe(2)
  expect(monthlyTrainingDays(data, '2028-03-01')).toBe(1)
  expect(monthlyTrainingDays(data, '2028-01-01')).toBe(0)
})
