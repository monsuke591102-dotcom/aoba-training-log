import 'fake-indexeddb/auto'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, test, vi } from 'vitest'
import { RunningDiamond, runningPlayForSave } from './BaserunningEditor'
import { initialData } from './initialData'
import { emptyMatchDetails, type BaserunningPlay } from './matchDetails'
import { saveMatchDetailRow, updateMatchDetails } from './matches'
import { Records } from './Records'
import { createStorage } from './storage'

const draft: BaserunningPlay = { id: 'run-1', order: 1, status: 'draft', from: 'first', to: 'second', result: 'advanced', reason: 'hit' }
const stamp = '2026-11-20T00:00:00.000Z'
const match = { id: 'match-1', date: '2026-11-20' as const, good: '', improve: '', createdAt: stamp, updatedAt: stamp }
function enableMatches() {
  vi.stubGlobal('__LOCAL_MATCH_RECORDS__', false)
  vi.stubGlobal('__MATCH_TEST_BUILD__', { origin: 'https://match.invalid', build: 'c1' })
  vi.stubGlobal('window', { isSecureContext: true, location: { origin: 'https://match.invalid' } })
}
afterEach(() => vi.unstubAllGlobals())

test('図の4つの塁は直接選べ、出発・到達と経路を区別する', () => {
  const html = renderToStaticMarkup(<RunningDiamond play={{ ...draft, to: 'third' }} choosingFrom={false} onSelect={vi.fn()} />)
  expect(html.match(/class="action running-base"/g)).toHaveLength(4)
  expect(html).toContain('data-from="true"')
  expect(html).toContain('data-to="true" aria-label="到達塁：三塁" aria-pressed="true"')
  expect(html).toContain('points="84,50 50,16 16,50"')
})

test('盗塁成功と失敗・走塁アウトは別の結果で、アウトには到達塁を保存しない', () => {
  expect(runningPlayForSave({ ...draft, result: 'stolenBase' }, 'complete')).toMatchObject({ to: 'second', reason: 'steal', result: 'stolenBase' })
  expect(runningPlayForSave({ ...draft, result: 'caughtStealing' }, 'complete')).toMatchObject({ to: undefined, reason: 'steal', result: 'caughtStealing' })
  expect(runningPlayForSave({ ...draft, result: 'out' }, 'complete')).toMatchObject({ to: undefined, reason: 'hit', result: 'out' })
})

test('得点・本盗は1件の本塁到達として保存し、不正な経路や確定条件を拒否する', () => {
  expect(runningPlayForSave({ ...draft, from: 'third', to: 'home', result: 'scored' }, 'complete').to).toBe('home')
  expect(runningPlayForSave({ ...draft, from: 'third', to: 'home', result: 'stolenBase' }, 'complete').result).toBe('stolenBase')
  expect(() => runningPlayForSave({ ...draft, from: 'second', to: 'first' }, 'complete')).toThrow('出発塁より先')
  expect(() => runningPlayForSave({ ...draft, to: 'first' }, 'draft')).toThrow('出発塁より先')
  expect(() => runningPlayForSave({ ...draft, result: 'scored' }, 'complete')).toThrow('本塁')
  expect(() => runningPlayForSave({ ...draft, from: 'batter', result: 'stolenBase' }, 'complete')).toThrow('盗塁')
  expect(() => runningPlayForSave({ ...draft, to: undefined }, 'complete')).toThrow('確認')
})

test('打席なしで保存でき、編集・削除で別プレー・打席・簡易集計元を保持する', async () => {
  enableMatches()
  const db = 'baserunning-' + crypto.randomUUID()
  const storage = createStorage(db)
  const target = { matchId: match.id }
  const details = emptyMatchDetails()
  const before = { ...details, source: { ...details.source, baserunning: 'summary' as const },
    summary: { baserunning: { runs: 0 } } }
  await storage.update(data => ({ ...data, matches: [{ ...match, details: before }] }))
  await storage.update(data => saveMatchDetailRow(data, target, 'baserunning', runningPlayForSave(draft, 'draft')))
  const reopened = createStorage(db)
  expect((await reopened.read()).matches?.[0].details?.baserunning).toEqual([draft])
  await reopened.update(data => saveMatchDetailRow(data, target, 'plateAppearances', { id: 'pa-1', order: 1, status: 'draft' }))
  const second = { ...draft, id: 'run-2', order: 2, plateAppearanceId: 'pa-1' }
  await reopened.update(data => saveMatchDetailRow(data, target, 'baserunning', second))
  const confirmed = await reopened.update(data => saveMatchDetailRow(data, target, 'baserunning', runningPlayForSave(draft, 'complete')))
  expect(confirmed.matches?.[0].details?.baserunning[0].status).toBe('complete')
  await expect(reopened.update(data => saveMatchDetailRow(data, target, 'baserunning', { ...second, plateAppearanceId: 'missing' }))).rejects.toThrow()
  const deleted = await reopened.update(data => updateMatchDetails(data, target, detail => ({
    ...detail, baserunning: detail.baserunning.filter(row => row.id !== draft.id),
  })))
  expect(deleted.matches?.[0].details).toEqual({ ...before, plateAppearances: [{ id: 'pa-1', order: 1, status: 'draft' }], baserunning: [second] })
  expect(deleted.records).toEqual(confirmed.records)
})

test('走塁の入口は試合編集が有効な環境に限る', () => {
  enableMatches()
  const render = () => renderToStaticMarkup(<Records data={{ ...initialData(), matches: [match] }} commit={vi.fn()} />)
  expect(render()).toContain('走塁を記録')
  vi.stubGlobal('__MATCH_TEST_BUILD__', null)
  expect(render()).not.toContain('走塁を記録')
})
