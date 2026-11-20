import 'fake-indexeddb/auto'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, test, vi } from 'vitest'
import { BaserunningEditor, StealOptions, runningPlayForSave, stealChoices } from './BaserunningEditor'
import { initialData } from './initialData'
import { emptyMatchDetails, type BaserunningPlay } from './matchDetails'
import { saveMatchDetailRow, updateMatchDetails } from './matches'
import { calculateMatchBaserunningStats } from './runningFieldingStats'
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

test('入力は4種類を表示し、選択を読み上げられる', () => {
  const html = renderToStaticMarkup(<StealOptions selected={stealChoices[1]} onSelect={vi.fn()} />)
  expect(html.match(/<button/g)).toHaveLength(4)
  expect(html).toContain('aria-pressed="false">二盗成功')
  expect(html).toContain('aria-pressed="true">二盗死')
  expect(html).toContain('aria-pressed="false">三盗成功')
  expect(html).toContain('aria-pressed="false">三盗死')
})

test.each(stealChoices)('$labelを追加・再読込・編集・削除でき、成績が反映される', async choice => {
  enableMatches()
  const db = 'steal-' + crypto.randomUUID()
  const storage = createStorage(db)
  const target = { matchId: match.id }
  const legacy: BaserunningPlay = { ...draft, id: 'old-run', order: 2, status: 'complete', reflection: '進塁の記録' }
  const details = { ...emptyMatchDetails(), baserunning: [legacy] }
  await storage.update(data => ({ ...data, matches: [{ ...match, details }] }))
  const blank: BaserunningPlay = { id: 'steal-1', order: 3, status: 'draft' }
  const row = runningPlayForSave(blank, 'complete', choice)
  await storage.update(data => saveMatchDetailRow(data, target, 'baserunning', row))
  const reopened = createStorage(db)
  const savedMatch = (await reopened.read()).matches![0]
  expect(savedMatch.details!.baserunning[0]).toEqual(legacy)
  const saved = savedMatch.details!.baserunning[1]
  expect(saved).toMatchObject({ from: choice.from, to: choice.to, result: choice.result, reason: 'steal' })
  const success = choice.result === 'stolenBase'
  expect(calculateMatchBaserunningStats(savedMatch)).toMatchObject({ sb: Number(success), cs: Number(!success), stealRate: Number(success) })

  const replacement = stealChoices.find(option => option.from === choice.from && option.result !== choice.result)!
  const updated = runningPlayForSave(saved, 'complete', replacement)
  const edited = await reopened.update(data => saveMatchDetailRow(data, target, 'baserunning', updated))
  expect(edited.matches![0].details!.baserunning).toEqual([legacy, updated])
  expect(calculateMatchBaserunningStats(edited.matches![0]).stealRate).toBe(Number(!success))
  const deleted = await reopened.update(data => updateMatchDetails(data, target, details => ({
    ...details, baserunning: details.baserunning.filter(play => play.id !== saved.id),
  })))
  expect(deleted.matches![0].details!.baserunning).toEqual([legacy])
  expect((await createStorage(db).read()).matches![0].details!.baserunning).toEqual([legacy])
  expect(calculateMatchBaserunningStats(deleted.matches![0]).stealRate).toBeNull()
})

test('旧走塁を閲覧でき、旧盗塁死の狙い塁を推測しない', () => {
  const old: BaserunningPlay = { id: 'old-cs', order: 2, status: 'complete', from: 'first', result: 'caughtStealing' }
  const details = { ...emptyMatchDetails(), baserunning: [
    draft, old,
    { ...draft, id: 'run-3', order: 3, status: 'complete', from: 'third', to: 'home', result: 'stolenBase' } as const,
    { ...draft, id: 'run-4', order: 4, status: 'complete', from: 'third', to: 'home', result: 'scored' } as const,
    { ...draft, id: 'run-5', order: 5, status: 'complete', to: undefined, result: 'out' } as const,
  ] }
  const html = renderToStaticMarkup(<BaserunningEditor details={details} target={{ matchId: match.id }} commit={vi.fn()} onClose={vi.fn()} />)
  expect(html).toContain('進塁 · 出発 一塁 · 到達 二塁')
  expect(html).toContain('盗塁死 · 出発 一塁 · 狙い塁不明')
  expect(html).toContain('盗塁成功 · 出発 三塁 · 到達 本塁')
  expect(html).toContain('得点 · 出発 三塁 · 到達 本塁')
  expect(html).toContain('走塁アウト · 出発 一塁')
  expect(html).toContain('第2プレーを編集')
  expect(html).not.toContain('第3プレーを編集')
  expect(html.match(/旧走塁記録 · 現在の二盗・三盗の4択に当てはまらないため、編集できません。/g)).toHaveLength(4)
  expect(() => runningPlayForSave(old, 'complete')).toThrow('盗塁の結果')
  expect(runningPlayForSave(old, 'draft').to).toBeUndefined()
  expect(runningPlayForSave(old, 'complete', stealChoices[1]).to).toBe('second')
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
  const confirmed = await reopened.update(data => saveMatchDetailRow(data, target, 'baserunning', runningPlayForSave(draft, 'complete', stealChoices[0])))
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
  expect(render()).toContain('走塁を記録する')
  vi.stubGlobal('__MATCH_TEST_BUILD__', null)
  expect(render()).not.toContain('走塁を記録する')
})
