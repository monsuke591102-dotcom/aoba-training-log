import type { PlateAppearance } from './matchDetails'
import type { MatchEntry } from './model'

const countKeys = ['pa', 'ab', 'h', 'singles', 'doubles', 'triples', 'homeRuns', 'tb', 'rbi',
  'bb', 'hbp', 'so', 'swingingStrikeouts', 'lookingStrikeouts', 'unclassifiedStrikeouts',
  'sh', 'sf', 'reachedOnError', 'fieldersChoice'] as const
type Counts = { [Key in typeof countKeys[number]]: number | null }
export type BattingStats = Counts & { avg: number | null; obp: number | null; slg: number | null; ops: number | null }

// Each code describes the final scoring decision. Pitch, bunt and field location do not override it.
type Result = NonNullable<PlateAppearance['result']>
type EventCounts = Omit<Counts, 'pa' | 'ab' | 'h' | 'tb' | 'rbi' | 'so'>
type Rule = { atBat: boolean; bases?: 1 | 2 | 3 | 4; count?: keyof EventCounts; strikeout?: true }
const out: Rule = { atBat: true }
const rules: Record<Result, Rule> = {
  single: { atBat: true, bases: 1, count: 'singles' },
  double: { atBat: true, bases: 2, count: 'doubles' },
  triple: { atBat: true, bases: 3, count: 'triples' },
  homeRun: { atBat: true, bases: 4, count: 'homeRuns' },
  groundOut: out, flyOut: out, lineOut: out, popOut: out, doublePlay: out, triplePlay: out, otherOut: out,
  strikeoutSwinging: { atBat: true, strikeout: true, count: 'swingingStrikeouts' },
  strikeoutLooking: { atBat: true, strikeout: true, count: 'lookingStrikeouts' },
  droppedThirdStrike: { atBat: true, strikeout: true, count: 'unclassifiedStrikeouts' },
  walk: { atBat: false, count: 'bb' },
  hitByPitch: { atBat: false, count: 'hbp' },
  sacrificeBunt: { atBat: false, count: 'sh' },
  sacrificeFly: { atBat: false, count: 'sf' },
  reachedOnError: { atBat: true, count: 'reachedOnError' },
  fieldersChoice: { atBat: true, count: 'fieldersChoice' },
  interference: { atBat: false }, // 妨害による出塁
}

function counts<T extends number | null>(value: T): Record<typeof countKeys[number], T> {
  return Object.fromEntries(countKeys.map(key => [key, value])) as Record<typeof countKeys[number], T>
}

function sum(values: (number | null)[]): number | null {
  return values.reduce<number | null>((total, value) =>
    total === null || value === null ? null : total + value, 0)
}

function ratio(numerator: number | null, denominator: number | null): number | null {
  return numerator === null || denominator === null || denominator === 0 ? null : numerator / denominator
}

function rates(totals: Counts): BattingStats {
  const { h, ab, bb, hbp, sf, tb } = totals
  const avg = ratio(h, ab)
  const obp = ratio(sum([h, bb, hbp]), sum([ab, bb, hbp, sf]))
  const slg = ratio(tb, ab)
  return { ...totals, avg, obp, slg, ops: sum([obp, slg]) }
}

export function calculateMatchBattingStats(match: Pick<MatchEntry, 'details'>): BattingStats {
  const details = match.details
  if (!details) return rates(counts(null))
  if (details.source.batting === 'summary') {
    const summary = details.summary?.batting
    return rates({ ...counts(null), pa: summary?.appearances ?? null, h: summary?.hits ?? null })
  }

  const totals = counts<number>(0)
  for (const { status, result } of details.plateAppearances) {
    if (status !== 'complete' || result === undefined) continue
    const rule = rules[result]
    totals.pa++
    if (rule.atBat) totals.ab++
    if (rule.bases !== undefined) {
      totals.h++
      totals.tb += rule.bases
    }
    if (rule.strikeout) totals.so++
    if (rule.count) totals[rule.count]++
  }
  return rates(totals.pa ? { ...totals, rbi: null } : counts(null))
}

/** Unknown counts in any included match make that period total unknown. */
export function aggregateBattingStats(matches: readonly BattingStats[]): BattingStats {
  if (!matches.length) return rates(counts(null))
  const totals = counts<number | null>(null)
  for (const key of countKeys) totals[key] = sum(matches.map(match => match[key]))
  return rates(totals)
}
