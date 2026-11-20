import 'fake-indexeddb/auto'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, test, vi } from 'vitest'
import { FieldingEditor } from './FieldingEditor'
import { emptyMatchDetails, isMatchDetails, type FieldingPlay } from './matchDetails'
import { saveMatchDetailRow, updateMatchDetails } from './matches'
import { createStorage } from './storage'

const timestamp = '2026-11-20T00:00:00.000Z'
const match = { id: 'match', date: '2026-11-20' as const, createdAt: timestamp, updatedAt: timestamp, good: '', improve: '' }
const target = { matchId: match.id }
const play: FieldingPlay = { id: 'play', order: 1, status: 'complete', position: 'SS', playType: 'grounder',
  credits: [], fieldPoint: { x: .34, y: .67 }, development: [{ skill: 'catching', note: '前で捕球' }] }
afterEach(() => vi.unstubAllGlobals())

test('旧データと公式記録なしの観察・任意の座標を受理し、不正な座標を拒否する', () => {
  const valid = (row: FieldingPlay) => isMatchDetails({ ...emptyMatchDetails(), fielding: [row] })
  expect(valid(play)).toBe(true)
  expect(valid({ ...play, fieldPoint: undefined, credits: undefined })).toBe(true)
  expect(valid({ ...play, fieldPoint: { x: 1.01, y: 0 } })).toBe(false)
  expect(valid({ ...play, fieldPoint: { x: 0, y: Number.NaN } })).toBe(false)
})

test('守備位置履歴とプレー一覧に公式記録の内訳と下書き状態を表示する', () => {
  const html = renderToStaticMarkup(<FieldingEditor target={target} commit={vi.fn()} onClose={vi.fn()} details={{
    ...emptyMatchDetails(),
    positionChanges: [{ id: 'p1', position: 'SS', order: 1 }, { id: 'p2', position: 'RF', order: 2, inning: 4 }],
    fielding: [play, { ...play, id: 'play-2', order: 2, status: 'draft', credits: ['putout', 'assist', 'error'] }],
  }} />)
  expect(html).toContain('遊撃手')
  expect(html).toContain('右翼手')
  expect(html).toContain('4回')
  expect(html).toContain('公式記録なし')
  expect(html).toContain('刺殺・補殺・失策')
  expect(html).toContain('下書き')
})

test('守備の下書き・確定・削除は別プレー、位置履歴、打撃・走塁、簡易集計元を保持する', async () => {
  vi.stubGlobal('__LOCAL_MATCH_RECORDS__', false)
  vi.stubGlobal('__MATCH_TEST_BUILD__', { origin: 'https://match.invalid', build: 'c2' })
  vi.stubGlobal('window', { isSecureContext: true, location: { origin: 'https://match.invalid' } })
  const db = 'fielding-' + crypto.randomUUID()
  const base = emptyMatchDetails()
  const details = { ...base, source: { ...base.source, fielding: 'summary' as const },
    summary: { fielding: { putouts: 0 } },
    plateAppearances: [{ id: 'pa', status: 'draft' as const, order: 1 }],
    baserunning: [{ id: 'run', status: 'draft' as const, order: 1 }] }
  const store = createStorage(db)
  await store.update(data => ({ ...data, matches: [{ ...match, details }] }))
  const position = { id: 'pos1', position: 'SS' as const, order: 1 }
  await store.update(data => saveMatchDetailRow(data, target, 'positionChanges', position))
  await store.update(data => saveMatchDetailRow(data, target, 'fielding', { ...play, status: 'draft' }))
  expect((await createStorage(db).read()).matches?.[0].details?.fielding[0]).toEqual({ ...play, status: 'draft' })
  await store.update(data => saveMatchDetailRow(data, target, 'fielding', play))
  const other = { ...play, id: 'other', order: 2, credits: ['assist'] as const }
  await store.update(data => saveMatchDetailRow(data, target, 'fielding', { ...other, credits: [...other.credits] }))
  const after = await store.update(data => updateMatchDetails(data, target, current => ({
    ...current, fielding: current.fielding.filter(row => row.id !== play.id),
  })))
  expect(after.matches?.[0].details).toEqual({ ...details, positionChanges: [position], fielding: [other] })
})
