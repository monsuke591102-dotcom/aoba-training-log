import type { MatchDetails } from './matchDetails'

/** YYYY-MM-DD in the device's local calendar. */
export type LocalDate = `${number}-${number}-${number}`
export type Timestamp = string
export type Category = '打撃' | '守備' | '走塁' | '体づくり' | 'その他'
export type Unit = '回' | '分' | '秒' | 'セット' | '球' | '本'
export type TrainingKind = '自主練' | 'チーム練習' | '試合'
export type DayKind = TrainingKind | '休養日'

export interface Menu {
  id: string
  name: string
  category: Category
  unit: Unit
  enabled: boolean
}

export interface DeletedMenu extends Menu {
  deletedOn: LocalDate
}

export interface TrainingRecord {
  id: string
  date: LocalDate
  kind: TrainingKind
  menuId: string
  // Save a snapshot so later menu edits preserve historical labels and units.
  menuName: string
  category: Category
  unit: Unit
  amount: number
  entrySource?: 'quick'
  durationMinutes?: number
  note: string
  rating?: 1 | 2 | 3 | 4 | 5
  createdAt: Timestamp
  updatedAt: Timestamp
}

export interface MatchEntry {
  id: string
  date: LocalDate
  // Linked entries use the existing record ID and keep a date for recovery.
  recordId?: string
  good: string
  improve: string
  createdAt: Timestamp
  updatedAt: Timestamp
  details?: MatchDetails
}

export type Plan =
  | { date: LocalDate; kind: '休養日' }
  | { date: LocalDate; kind: TrainingKind; menuIds: string[] }

interface MenuGoal { menuId: string; menuName: string; amount: number | null; unit: Unit }

export type Goal = { id: string; effectiveFrom: LocalDate; changedAt: Timestamp } & (
  | { kind: 'weekly'; days: number | null }
  | ({ kind: 'menu' } & MenuGoal)
  | ({ kind: 'daily-menu' } & MenuGoal)
  | { kind: 'skill'; text: string }
)

export interface Reflection {
  period: 'day' | 'week'
  // Week entries use the local date of Monday.
  date: LocalDate
  success: string
  challenge: string
  next: string
  updatedAt: Timestamp
  createdAt?: Timestamp
}

export const skipReasons = ['天候不良', '場所・設備の都合', '体調・疲労を考慮', '予定変更', 'その他'] as const

export interface SkippedMenu {
  date: LocalDate
  menuId: string
  menuName: string
  reason: typeof skipReasons[number]
  note: string
  createdAt: Timestamp
  updatedAt: Timestamp
}

export interface RoutineItem {
  id: string
  name: string
  menuId?: string
  schedule: 'daily' | 'weekdays' | 'conditional'
  weekdays: number[]
  target?: { amount: number; unit: Unit }
  note: string
  condition: string
  group?: string
  mode?: 'check' | 'quantity'
  recordUnit?: Unit
}

export interface RoutineVersion {
  id: string
  startsOn: LocalDate
  items: RoutineItem[]
  sourceKey?: string
}

export interface TrainingData {
  schemaVersion: 3
  menus: Menu[]
  deletedMenus?: DeletedMenu[]
  records: TrainingRecord[]
  matches?: MatchEntry[]
  plans: Plan[]
  skippedMenus: SkippedMenu[]
  rests: { date: LocalDate; createdAt: Timestamp }[]
  goals: Goal[]
  reflections: Reflection[]
  routineVersions?: RoutineVersion[]
  routineCompletions?: { date: LocalDate; itemId: string }[]
  routineAdditions?: { date: LocalDate; itemId: string }[]
}






