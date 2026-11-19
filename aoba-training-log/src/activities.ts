import { isLocalDate, localDate, fromLocalDate } from './dates'
import { skipReasons, type LocalDate, type Plan, type Reflection, type SkippedMenu, type TrainingData } from './model'
import { InputError, trainingKinds, weekDates } from './training'

export function savePlan(data: TrainingData, plan: Plan): TrainingData {
  if (!isLocalDate(plan.date)) throw new InputError('予定の日付を選んでください。')
  if (plan.kind !== '休養日') {
    if (!trainingKinds.includes(plan.kind)) throw new InputError('予定の種類を選んでください。')
    const previous = data.plans.find(item => item.date === plan.date)
    const allowed = new Set(previous && previous.kind !== '休養日' ? previous.menuIds : [])
    for (const menu of data.menus) if (menu.enabled) allowed.add(menu.id)
    if (plan.menuIds.some(id => !allowed.has(id))) throw new InputError('予定に使えるメニューを選んでください。')
    plan = { ...plan, menuIds: [...new Set(plan.menuIds)] }
  }
  return { ...data, plans: [...data.plans.filter(item => item.date !== plan.date), plan] }
}

export function deletePlan(data: TrainingData, date: LocalDate): TrainingData {
  return { ...data, plans: data.plans.filter(plan => plan.date !== date) }
}

export function setRest(data: TrainingData, date: LocalDate, rest: boolean, now = new Date()): TrainingData {
  if (!isLocalDate(date) || date > localDate(now)) throw new InputError('休養日は今日以前の日付を選んでください。')
  const exists = data.rests.some(item => item.date === date)
  if (rest === exists) return data
  return { ...data, rests: rest ? [...data.rests, { date, createdAt: now.toISOString() }] : data.rests.filter(item => item.date !== date) }
}

export type ReflectionDraft = Pick<Reflection, 'success' | 'challenge' | 'next'>

export function saveReflection(data: TrainingData, period: Reflection['period'], date: LocalDate, draft: ReflectionDraft, now = new Date()): TrainingData {
  if (!isLocalDate(date) || date > localDate(now)) throw new InputError('振り返りは今日以前の日付を選んでください。')
  const key = period === 'week' ? weekDates(fromLocalDate(date))[0] : date
  const previous = data.reflections.find(item => item.period === period && item.date === key)
  const others = data.reflections.filter(item => item.period !== period || item.date !== key)
  const fields = { success: draft.success.trim(), challenge: draft.challenge.trim(), next: draft.next.trim() }
  if (!hasReflection(fields)) return { ...data, reflections: others }
  const updatedAt = now.toISOString()
  return { ...data, reflections: [...others, { ...fields, period, date: key, createdAt: previous?.createdAt ?? previous?.updatedAt ?? updatedAt, updatedAt }] }
}

export function hasReflection(draft: ReflectionDraft) {
  return Boolean(draft.success.trim() || draft.challenge.trim() || draft.next.trim())
}



export class SkipConfirmationRequired extends InputError {}

export function saveSkippedMenu(
  data: TrainingData, date: LocalDate, menuId: string, reason: SkippedMenu['reason'], note: string,
  confirmed = false, now = new Date(),
): TrainingData {
  if (!skipReasons.includes(reason)) throw new InputError('見送りの理由を選んでください。')
  if (!isLocalDate(date)) throw new InputError('見送りの日付を確認してください。')
  const previous = data.skippedMenus.find(item => item.date === date && item.menuId === menuId)
  const plan = data.plans.find(item => item.date === date)
  if (!previous && (!plan || plan.kind === '休養日' || !plan.menuIds.includes(menuId))) {
    throw new InputError('このメニューは当日の予定にありません。')
  }
  if (!previous && !confirmed && data.records.some(item => item.date === date && item.menuId === menuId)) {
    throw new SkipConfirmationRequired('このメニューには練習記録があります。')
  }
  const menuName = previous?.menuName ?? [...data.menus, ...(data.deletedMenus ?? [])].find(item => item.id === menuId)?.name
  if (!menuName) throw new InputError('メニューが見つかりません。')
  const updatedAt = now.toISOString()
  const next = { date, menuId, menuName, reason, note: note.trim(),
    createdAt: previous?.createdAt ?? updatedAt, updatedAt }
  return { ...data, skippedMenus: [...data.skippedMenus.filter(item => item !== previous), next] }
}

export function clearSkippedMenu(data: TrainingData, date: LocalDate, menuId: string): TrainingData {
  return { ...data, skippedMenus: data.skippedMenus.filter(item => item.date !== date || item.menuId !== menuId) }
}

export function savePlanKind(data: TrainingData, date: LocalDate, kind: Plan['kind'] | '', expected?: Plan): TrainingData {
  const current = data.plans.find(item => item.date === date)
  if (JSON.stringify(current) !== JSON.stringify(expected)) {
    throw new InputError('予定が変更されました。閉じてから開き直してください。')
  }
  if ((current?.kind ?? '') === kind) return data
  if (!kind) return deletePlan(data, date)
  if (kind === '休養日') return savePlan(data, { date, kind })
  const menuIds = current && current.kind !== '休養日' ? current.menuIds : []
  return savePlan(data, { date, kind, menuIds })
}
