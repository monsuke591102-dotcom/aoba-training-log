import { fromLocalDate, isLocalDate } from './dates'
import { categories, units } from './initialData'
import { hasMatchDetails, isMatchDetails } from './matchDetails'
import { skipReasons, type TrainingData } from './model'
import { trainingKinds } from './training'

const appId = 'aoba-training-log'
const backupVersion = 1
const detailedBackupVersion = 2
const pitchBackupVersion = 3
const dataVersion: TrainingData['schemaVersion'] = 3

export interface Backup {
  appId: typeof appId
  backupVersion: typeof backupVersion | typeof detailedBackupVersion | typeof pitchBackupVersion
  createdAt: string
  dataVersion: typeof dataVersion
  data: TrainingData
}

export class BackupError extends Error {}

type Row = Record<string, unknown>
const object = (value: unknown): value is Row => value !== null && typeof value === 'object' && !Array.isArray(value)
const string = (value: unknown): value is string => typeof value === 'string'
const nonempty = (value: unknown): value is string => string(value) && value.trim().length > 0
const date = (value: unknown) => string(value) && isLocalDate(value)
const timestamp = (value: unknown) => {
  if (!string(value) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value
}
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= Number.MAX_SAFE_INTEGER
const quantity = (value: unknown, unit: unknown) => positive(value) && (unit === '分' || Number.isInteger(value))
const oneOf = (value: unknown, choices: readonly unknown[]) => choices.includes(value)
const timestamps = (row: Row) => timestamp(row.createdAt) && timestamp(row.updatedAt)

function validateRows(value: unknown, label: string, valid: (row: Row) => boolean, key: (row: Row) => unknown): Row[] {
  if (!Array.isArray(value)) throw new BackupError(label + 'の一覧がありません。')
  const seen = new Set<unknown>()
  return value.map((row: unknown, index) => {
    if (!object(row) || !valid(row)) throw new BackupError(label + 'の' + (index + 1) + '件目に不正な項目があります。')
    const id = key(row)
    if (seen.has(id)) throw new BackupError(label + 'に重複があります。')
    seen.add(id)
    return row
  })
}

export function validateData(data: unknown): asserts data is TrainingData {
  if (!object(data) || data.schemaVersion !== dataVersion) {
    throw new BackupError('データ本体のバージョンが一致しません。')
  }
  const validMenu = (row: Row) => nonempty(row.id) && nonempty(row.name) &&
    oneOf(row.category, categories) && oneOf(row.unit, units) && typeof row.enabled === 'boolean'
  const menus = validateRows(data.menus, '練習メニュー', validMenu, row => row.id)
  const ids = new Set(menus.map(menu => menu.id))
  if (data.deletedMenus !== undefined) {
    const deleted = validateRows(data.deletedMenus, '削除済みメニュー',
      row => validMenu(row) && date(row.deletedOn) && !ids.has(row.id), row => row.id)
    for (const menu of deleted) ids.add(menu.id)
  }
  const hasMenu = (row: Row) => ids.has(row.menuId) && nonempty(row.menuName) && oneOf(row.unit, units)
  validateRows(data.records, '練習記録', row => nonempty(row.id) && date(row.date) && hasMenu(row) &&
    oneOf(row.kind, trainingKinds) && oneOf(row.category, categories) && quantity(row.amount, row.unit) &&
    (row.entrySource === undefined || row.entrySource === 'quick') &&
    (row.durationMinutes === undefined || positive(row.durationMinutes)) && string(row.note) &&
    (row.rating === undefined || oneOf(row.rating, [1, 2, 3, 4, 5])) && timestamps(row), row => row.id)
  if (data.matches !== undefined) {
    const linked = new Set<unknown>()
    validateRows(data.matches, '試合・試合の振り返り', row => {
      if (!nonempty(row.id) || !date(row.date) || !string(row.good) || !string(row.improve) || !timestamps(row)) return false
      if (row.details !== undefined && !isMatchDetails(row.details)) return false
      // A linked reflection can outlive its record when an older client deletes it.
      if (row.recordId === undefined) return true
      if (!nonempty(row.recordId) || linked.has(row.recordId)) return false
      linked.add(row.recordId)
      return true
    }, row => row.id)
  }
  validateRows(data.plans, '練習予定', row => date(row.date) && (row.kind === '休養日' ||
    (oneOf(row.kind, trainingKinds) && Array.isArray(row.menuIds) &&
      row.menuIds.every(id => ids.has(id)) && new Set(row.menuIds).size === row.menuIds.length)), row => row.date)
  // A skip can outlive a deleted or edited plan.
  validateRows(data.skippedMenus, '見送り', row => date(row.date) && ids.has(row.menuId) &&
    nonempty(row.menuName) && oneOf(row.reason, skipReasons) && string(row.note) && timestamps(row),
  row => JSON.stringify([row.date, row.menuId]))
  validateRows(data.rests, '休養日の記録', row => date(row.date) && timestamp(row.createdAt), row => row.date)
  validateRows(data.goals, '目標・変更履歴', row => {
    if (!nonempty(row.id) || !date(row.effectiveFrom) || !timestamp(row.changedAt)) return false
    switch (row.kind) {
      case 'weekly': return row.days === null || oneOf(row.days, [1, 2, 3, 4, 5, 6, 7])
      case 'menu':
      case 'daily-menu': return hasMenu(row) && (row.amount === null || quantity(row.amount, row.unit))
      case 'skill': return string(row.text)
      default: return false
    }
  }, row => row.id)
  validateRows(data.reflections, '振り返り', row => string(row.date) && isLocalDate(row.date) &&
    (row.period === 'day' || (row.period === 'week' && fromLocalDate(row.date).getDay() === 1)) &&
    string(row.success) && string(row.challenge) && string(row.next) && timestamp(row.updatedAt) &&
    (row.createdAt === undefined || timestamp(row.createdAt)), row => JSON.stringify([row.period, row.date]))
  const routineItems = new Set<unknown>()
  if (data.routineVersions !== undefined) {
    const sources = new Set<unknown>()
    validateRows(data.routineVersions, '曜日別計画', row => {
      if (!nonempty(row.id) || !date(row.startsOn)) return false
      if (row.sourceKey !== undefined) {
        if (!nonempty(row.sourceKey) || sources.has(row.sourceKey)) return false
        sources.add(row.sourceKey)
      }
      const linked = new Set<unknown>()
      validateRows(row.items, '計画の種目', item => {
        if (!nonempty(item.id) || !nonempty(item.name) || !string(item.note) || !string(item.condition) ||
          !oneOf(item.schedule, ['daily', 'weekdays', 'conditional']) || !Array.isArray(item.weekdays) ||
          item.weekdays.some(day => !oneOf(day, [0, 1, 2, 3, 4, 5, 6])) ||
          new Set(item.weekdays).size !== item.weekdays.length ||
          (item.schedule === 'weekdays' ? item.weekdays.length === 0 : item.weekdays.length > 0)) return false
        if ((item.group !== undefined && !nonempty(item.group)) ||
          (item.mode !== undefined && !oneOf(item.mode, ['check', 'quantity'])) ||
          (item.recordUnit !== undefined && !oneOf(item.recordUnit, units))) return false
        if (item.menuId !== undefined) {
          if (!ids.has(item.menuId) || linked.has(item.menuId)) return false
          linked.add(item.menuId)
        }
        routineItems.add(item.id)
        return item.target === undefined || (item.menuId !== undefined && object(item.target) &&
          oneOf(item.target.unit, units) && quantity(item.target.amount, item.target.unit))
      }, item => item.id)
      return true
    }, row => row.id)
  }
  if (data.routineCompletions !== undefined) validateRows(data.routineCompletions, '計画の完了チェック',
    row => date(row.date) && routineItems.has(row.itemId), row => JSON.stringify([row.date, row.itemId]))
  if (data.routineAdditions !== undefined) validateRows(data.routineAdditions, '条件付き計画の追加',
    row => date(row.date) && routineItems.has(row.itemId), row => JSON.stringify([row.date, row.itemId]))
}

function backupVersionFor(data: TrainingData): Backup['backupVersion'] {
  if (data.matches?.some(match => match.details?.version === 2)) return pitchBackupVersion
  return hasMatchDetails(data) ? detailedBackupVersion : backupVersion
}

export function encodeBackup(data: TrainingData, now = new Date()): string {
  validateData(data)
  const backup: Backup = { appId, backupVersion: backupVersionFor(data),
    createdAt: now.toISOString(), dataVersion, data }
  return JSON.stringify(backup, null, 2)
}

export function decodeBackup(text: string): Backup {
  let value: unknown
  try {
    value = JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch {
    throw new BackupError('JSONを読み取れません。ファイルが壊れていないか確認してください。')
  }
  if (!object(value) || value.appId !== appId) throw new BackupError('AOBA TRAINING LOGのバックアップを選んでください。')
  if ((value.backupVersion !== backupVersion && value.backupVersion !== detailedBackupVersion &&
    value.backupVersion !== pitchBackupVersion) || value.dataVersion !== dataVersion) {
    throw new BackupError('このバックアップのバージョンには対応していません。')
  }
  if (!string(value.createdAt) || !timestamp(value.createdAt)) throw new BackupError('バックアップの作成日時が不正です。')
  validateData(value.data)
  if (backupVersionFor(value.data) !== value.backupVersion) {
    throw new BackupError('試合詳細とバックアップ形式のバージョンが一致しません。')
  }
  return { appId, backupVersion: value.backupVersion, dataVersion, createdAt: value.createdAt, data: value.data }
}

const backupCountItems = [
  ['records', '練習記録'], ['matches', '試合・試合の振り返り'], ['plans', '練習予定'], ['goals', '目標・変更履歴'],
  ['reflections', '振り返り'], ['skippedMenus', '見送り'], ['rests', '休養日の記録'],
  ['menus', '練習メニュー'], ['routineVersions', '曜日別計画'], ['deletedMenus', '削除済みメニュー（履歴用）'],
  ['routineAdditions', '条件付き計画の追加'], ['routineCompletions', '計画の完了チェック'],
] as const

export function compareBackupCounts(current: TrainingData, backup: TrainingData) {
  return backupCountItems.map(([key, label]) => ({
    key, label, current: current[key]?.length ?? 0, restored: backup[key]?.length ?? 0,
  })).filter(row => (row.key !== 'deletedMenus' && row.key !== 'matches') || row.current > 0 || row.restored > 0)
}

export function replacesMatches(current: TrainingData, replacement?: TrainingData) {
  const incoming = new Map(replacement?.matches?.map(item => [item.id, item]))
  return current.matches?.some(item => {
    const next = incoming.get(item.id)
    return !next || item.recordId !== next.recordId || item.date !== next.date ||
      item.good !== next.good || item.improve !== next.improve ||
      JSON.stringify(item.details) !== JSON.stringify(next.details)
  }) ?? false
}

export function restoreChange(backup: Backup, expected: TrainingData) {
  const snapshot = JSON.stringify(expected)
  return (current: TrainingData) => {
    if (JSON.stringify(current) !== snapshot) {
      throw new BackupError('確認中に現在のデータが変更されました。ファイルを選び直してください。')
    }
    if (hasMatchDetails(current) && backup.backupVersion === backupVersion) {
      throw new BackupError('試合詳細のない旧形式で上書きできません。試合詳細を含むバックアップを選んでください。')
    }
    return backup.data
  }
}




