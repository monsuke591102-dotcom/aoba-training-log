import 'fake-indexeddb/auto'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, test, vi } from 'vitest'
import { decodeBackup, encodeBackup, restoreChange } from './backup'
import { FieldingEditor } from './FieldingEditor'
import { initialData } from './initialData'
import { emptyMatchDetails, initialPitchTypes, isMatchDetails, type FieldingPlay, type MatchDetails } from './matchDetails'
import { saveMatchDetailRow, updateMatchDetails } from './matches'
import { aggregateFieldingStats, calculateMatchFieldingStats } from './runningFieldingStats'
import { createStorage } from './storage'

const timestamp = '2026-11-20T00:00:00.000Z'
const match = { id: 'match', date: '2026-11-20' as const, createdAt: timestamp, updatedAt: timestamp, good: '', improve: '' }
const target = { matchId: match.id }
const play: FieldingPlay = { id: 'play', order: 1, status: 'complete', position: 'SS', playType: 'grounder',
  credits: [], fieldPoint: { x: .34, y: .67 }, development: [{ skill: 'catching', note: '前で捕球' }], reflection: '次は早く構える' }
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
  expect(html).toContain('4イニング目')
  expect(html).toContain('イニング未記録')
  expect(html).toContain('旧記録の守備位置履歴')
  expect(html).toContain('前で捕球')
  expect(html).toContain('次は早く構える')
  expect(html).toContain('公式記録なし')
  expect(html).toContain('PO（刺殺）・A（補殺）・E（失策）')
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

test('守備機会の形式・イニング・結果を検証し、打球なしはプレー結果なしで確定できる', () => {
  const check = (row: FieldingPlay, version: MatchDetails['version'] = 3) =>
    isMatchDetails({ ...emptyMatchDetails(), version, fielding: [row] })
  const row: FieldingPlay = { ...play, opportunity: { inning: 1, catchResult: 'success', outcome: 'safe' } }
  expect(check(row)).toBe(true)
  expect(check(row, 1)).toBe(false)
  expect(check(row, 2)).toBe(false)
  expect(check({ ...row, opportunity: { inning: 0, outcome: 'out' } })).toBe(false)
  expect(check({ ...row, opportunity: { outcome: 'out' } })).toBe(false)
  expect(check({ ...row, opportunity: { inning: 1 } })).toBe(false)
  expect(check({ ...row, playType: 'noBall', opportunity: { inning: 1 } })).toBe(true)
  expect(check({ ...row, playType: 'noBall', opportunity: undefined })).toBe(false)
  expect(check({ ...row, opportunity: { ...row.opportunity, noBallKind: 'pickoff' } })).toBe(false)
  expect(check({ ...row, status: 'draft', opportunity: {} })).toBe(true)
})

test('新旧守備の混在、再読込、バックアップ復元と編集・削除後の公式成績を確認する', async () => {
  vi.stubGlobal('__MATCH_TEST_BUILD__', { origin: 'https://match.invalid' })
  vi.stubGlobal('window', { isSecureContext: true, location: { origin: 'https://match.invalid' } })
  const db = 'opportunity-' + crypto.randomUUID()
  const store = createStorage(db)
  const legacy = { ...play, plateAppearanceId: 'pa' }
  const details: MatchDetails = { ...emptyMatchDetails(), version: 2, fielding: [legacy],
    plateAppearances: [{ id: 'pa', order: 1, status: 'complete', result: 'single', pitches: [
      { id: 'pitch', order: 1, result: 'hit', type: initialPitchTypes[0], location: { zone: 'point', x: .31, y: .55 } },
    ] }],
    baserunning: [{ id: 'run', order: 1, status: 'complete', from: 'first', to: 'second', result: 'stolenBase' }],
    positionChanges: [{ id: 'position', position: 'RF', order: 1, inning: 5 }] }
  const parent = { ...match, good: '声かけ', improve: '連携', details }
  const oldBackup = decodeBackup(encodeBackup({ ...initialData(), matches: [parent] }))
  expect(oldBackup.backupVersion).toBe(3)
  await store.update(restoreChange(oldBackup, initialData()))
  const save = (row: FieldingPlay) => store.update(data => saveMatchDetailRow(data, target, 'fielding', row))
  const safe: FieldingPlay = { id: 'safe', order: 2, status: 'complete', position: 'SS', playType: 'grounder',
    opportunity: { inning: 2, catchResult: 'success', throwResult: 'error', outcome: 'safe' }, credits: [] }
  const out: FieldingPlay = { id: 'out', order: 3, status: 'complete', position: 'RF', playType: 'fly',
    opportunity: { inning: 2, catchResult: 'failure', throwResult: 'notApplicable', outcome: 'out' }, credits: ['error'] }
  const noBall: FieldingPlay = { id: 'noball', order: 4, status: 'complete', position: 'RF', playType: 'noBall',
    opportunity: { inning: 2, noBallKind: 'caughtStealing', catchResult: 'notApplicable' }, credits: ['putout', 'assist'] }
  await save(safe)
  await save(out)
  await save(noBall)
  const reopened = await createStorage(db).read()
  expect(reopened.matches![0]).toMatchObject({ good: parent.good, improve: parent.improve })
  expect(reopened.matches![0].details).toEqual({ ...details, version: 3, fielding: [legacy, safe, out, noBall] })
  const stats = calculateMatchFieldingStats(reopened.matches![0])
  expect(stats).toMatchObject({ po: 1, a: 1, e: 1, fpct: 2 / 3,
    byPosition: { SS: { po: 0, a: 0, e: 0 }, RF: { po: 1, a: 1, e: 1 } } })

  const edited = await save({ ...out, credits: [], opportunity: { ...out.opportunity, outcome: 'notApplicable' } })
  expect(calculateMatchFieldingStats(edited.matches![0])).toMatchObject({ e: 0, fpct: 1 })
  const deleted = await store.update(data => updateMatchDetails(data, target, current =>
    ({ ...current, fielding: current.fielding.filter(row => row.id !== noBall.id) })))
  const after = calculateMatchFieldingStats(deleted.matches![0])
  expect(after).toMatchObject({ tc: 0, fpct: null })
  expect(aggregateFieldingStats([stats, after])).toMatchObject({ tc: 3, fpct: 2 / 3 })
  const unknown = await save({ ...safe, credits: undefined })
  expect(calculateMatchFieldingStats(unknown.matches![0]).po).toBeNull()
  const backup = decodeBackup(encodeBackup(reopened))
  expect(backup.backupVersion).toBe(4)
  const restored = createStorage('restored-' + db)
  await restored.update(restoreChange(backup, initialData()))
  expect(await restored.read()).toEqual(reopened)
})

test('送球エラーを単独・アウト併記で保存でき、編集と削除で公式の失策を自動加算しない', async () => {
  vi.stubGlobal('__MATCH_TEST_BUILD__', { origin: 'https://match.invalid' })
  vi.stubGlobal('window', { isSecureContext: true, location: { origin: 'https://match.invalid' } })
  const db = 'throwing-error-' + crypto.randomUUID()
  const store = createStorage(db)
  const prior: FieldingPlay = { ...play, opportunity: { inning: 2, throwResult: 'success', outcome: 'safe' } }
  const current: FieldingPlay = { id: 'throwing-error', order: 2, status: 'complete', position: 'SS', playType: 'grounder',
    opportunity: { inning: 2, throwResult: 'error', outcome: 'notApplicable' }, credits: ['assist'] }
  const details: MatchDetails = { ...emptyMatchDetails(), version: 3, fielding: [prior] }
  await store.update(data => ({ ...data, matches: [{ ...match, details }] }))
  await store.update(data => saveMatchDetailRow(data, target, 'fielding', current))
  const saved = (await createStorage(db).read()).matches![0]
  expect(saved.details!.fielding).toEqual([prior, current])
  expect(calculateMatchFieldingStats(saved)).toMatchObject({ po: 0, a: 1, e: 0, fpct: 1 })
  const html = renderToStaticMarkup(<FieldingEditor details={saved.details} target={target} commit={vi.fn()} onClose={vi.fn()} />)
  expect(html).toContain('旧記録：送球成功')
  expect(html).toContain('送球エラー')
  expect(decodeBackup(encodeBackup({ ...initialData(), matches: [saved] })).data.matches).toEqual([saved])

  const edited = await store.update(data => saveMatchDetailRow(data, target, 'fielding', {
    ...current, opportunity: { ...current.opportunity, outcome: 'out' }, credits: ['error'],
  }))
  expect(calculateMatchFieldingStats(edited.matches![0])).toMatchObject({ po: 0, e: 1, fpct: 0 })
  expect(edited.matches![0].details!.fielding[0]).toEqual(prior)
  const deleted = await store.update(data => updateMatchDetails(data, target, details => ({
    ...details, fielding: details.fielding.filter(row => row.id !== current.id),
  })))
  expect(deleted.matches![0].details!.fielding).toEqual([prior])
  expect(calculateMatchFieldingStats(deleted.matches![0])).toMatchObject({ po: 0, a: 0, e: 0, fpct: null })
})
