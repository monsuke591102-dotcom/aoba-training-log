import type { Change } from './storage'
import { InputError } from './training'

export type Commit = (change: Change) => Promise<void>

export function errorMessage(error: unknown) {
  return error instanceof InputError ? error.message : 'データを保存できませんでした。時間をおいて再度お試しください。'
}
