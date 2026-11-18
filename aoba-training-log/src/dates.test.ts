import { expect, test } from 'vitest'
import { localDate, recentDays } from './dates'

test('端末の暦日で日付を作る', () => {
  expect(localDate(new Date(2026, 10, 18, 0, 1))).toBe('2026-11-18')
  expect(localDate(new Date(2026, 10, 18, 23, 59))).toBe('2026-11-18')
})

test('直近7日間は年をまたいでも今日を含む', () => {
  expect(recentDays(new Date(2026, 0, 2)).map(localDate)).toEqual([
    '2025-12-27', '2025-12-28', '2025-12-29', '2025-12-30',
    '2025-12-31', '2026-01-01', '2026-01-02',
  ])
})
