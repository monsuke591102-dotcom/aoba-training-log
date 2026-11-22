import type { LocalDate } from './model'

export function localDate(date: Date): LocalDate {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}` as LocalDate
}

export function recentDays(today: Date): Date[] {
  return Array.from({ length: 7 }, (_, index) =>
    new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6 + index),
  )
}

export function fromLocalDate(date: LocalDate): Date {
  return new Date(date + 'T12:00:00')
}

export function shiftDate(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

export function isLocalDate(value: string): value is LocalDate {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && localDate(fromLocalDate(value as LocalDate)) === value
}

export function monthGrid(month: Date): LocalDate[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const leading = (first.getDay() + 6) % 7
  const length = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  return Array.from({ length: Math.ceil((leading + length) / 7) * 7 },
    (_, index) => localDate(shiftDate(first, index - leading)))
}

export function monthDates(date: Date, offset = 0) {
  const first = new Date(date.getFullYear(), date.getMonth() + offset, 1)
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0)
  return { start: localDate(first), end: localDate(last), length: last.getDate() }
}
