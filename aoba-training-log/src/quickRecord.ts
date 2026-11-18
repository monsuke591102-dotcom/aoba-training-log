import type { LocalDate, Menu, TrainingData, TrainingKind, Unit } from './model'
import { planTarget } from './routines'
import { currentGoal, deleteRecord, InputError, saveRecord } from './training'

export function quickMetrics(data: TrainingData, date: LocalDate, menu: Menu) {
  const matching = data.records.filter(record => record.date === date && record.menuId === menu.id && record.unit === menu.unit)
  const editable = matching.find(record => record.entrySource === 'quick' &&
    !record.note && record.rating === undefined && record.durationMinutes === undefined)
  const floor = matching.reduce((sum, record) => record === editable ? sum : sum + record.amount, 0)
  const total = floor + (editable?.amount ?? 0)
  const goal = currentGoal(data.goals, 'daily-menu', date, menu.id)
  const plannedTarget = planTarget(data, date, menu)
  const target = plannedTarget === undefined ? goal?.unit === menu.unit ? goal.amount : null : plannedTarget
  const skipped = data.skippedMenus.some(item => item.date === date && item.menuId === menu.id)
  return { floor, total, editable, target, skipped }
}

export type QuickChange = { delta: number } | { total: string; expected: number }

function normalizeDecimal(value: number) {
  return Number.isInteger(value) || Math.abs(value) >= 1e12 ? value : Number(value.toPrecision(15))
}

function parseAmount(input: string, unit: Unit) {
  const value = input.trim()
  const valid = unit === '分' ? /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value) : /^\d+$/.test(value)
  const amount = Number(value)
  if (!valid || !Number.isFinite(amount) || amount > Number.MAX_SAFE_INTEGER) {
    throw new InputError(unit === '分' ? '0以上の数値を入力してください。' : '0以上の整数を入力してください。')
  }
  return amount
}

export function saveQuickRecord(
  data: TrainingData, date: LocalDate, menuId: string, unit: Unit, kind: TrainingKind,
  change: QuickChange, now = new Date(),
): TrainingData {
  const menu = data.menus.find(item => item.id === menuId && item.enabled && item.unit === unit)
  if (!menu) throw new InputError('メニュー設定が変わりました。表示を確認してください。')
  const { editable, floor, total, skipped } = quickMetrics(data, date, menu)
  if (skipped) throw new InputError('このメニューは見送り中です。カレンダーから見送りを解除してください。')
  if ('total' in change && total !== change.expected) {
    throw new InputError('実績が変わりました。入力を開き直して、最新の値を確認してください。')
  }
  const next = 'delta' in change
    ? Math.max(floor, normalizeDecimal(total + change.delta))
    : parseAmount(change.total, unit)
  if (next < floor) {
    throw new InputError('詳細入力の記録は練習履歴から編集してください。')
  }
  if (next === total) return data
  const amount = normalizeDecimal(next - floor)
  if (amount === 0) return editable ? deleteRecord(data, editable.id) : data
  const saved = saveRecord(data, {
    date, menuId, kind: editable?.kind ?? kind, amount: String(amount), duration: '', note: '', rating: '',
  }, editable?.id, now)
  const record = saved.records[saved.records.length - 1]
  return { ...saved, records: [...saved.records.slice(0, -1), { ...record, entrySource: 'quick' }] }
}

export const HOLD_MS = 500
export const PRESS_DRIFT_PX = 10

export function pressStep(elapsedMs: number) {
  return elapsedMs >= HOLD_MS ? 10 : 1
}

export function movedOutsidePress(startX: number, startY: number, x: number, y: number) {
  return Math.hypot(x - startX, y - startY) > PRESS_DRIFT_PX
}

