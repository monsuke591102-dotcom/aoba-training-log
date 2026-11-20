import 'fake-indexeddb/auto'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createAccountStorage } from './accountStorage'
import { decodeBackup, encodeBackup, replacesMatches, restoreChange, validateData } from './backup'
import { calculateMatchBattingStats } from './battingStats'
import { initialData } from './initialData'
import { emptyMatchDetails, initialPitchTypes, isMatchDetails, type MatchDetails, type Pitch } from './matchDetails'
import { deleteMatch, saveMatch, saveMatchDetailRow, updateMatchDetails, type MatchDraft } from './matches'
import { createStorage } from './storage'
import { chooseSnapshot } from './sync'
import { saveRecord } from './training'

const now = new Date(2026, 10, 20, 12)
const draft: MatchDraft = { date: '2026-11-20', kind: '試合', menuId: '', amount: '',
  duration: '', note: '', rating: '', good: '', improve: '' }
const plate = { id: 'pa-1', order: 1, status: 'complete', result: 'single' } as const

function fixture() {
  const old = saveMatch(initialData(), draft, undefined, now)
  const target = { matchId: old.matches![0].id }
  const details: MatchDetails = {
    ...emptyMatchDetails(), opponent: ' 対戦クラブ ',
    source: { batting: 'events', baserunning: 'summary', fielding: 'events' },
    summary: { baserunning: { runs: 0 } },
    plateAppearances: [
      { ...plate, rbi: 0, fieldPoint: { x: 0, y: 1 }, pitchCount: 0, beforeFinalPitch: { balls: 0, strikes: 0 } },
      { id: 'pa-2', order: 2, status: 'complete', result: 'strikeoutLooking', bunt: 'failed',
        pitches: [{ id: 'pitch-1', order: 1, type: { id: 'fastball-fast', name: 'ストレート（速）', symbol: '●' }, result: 'calledStrike',
          location: { zone: 'inside', row: 0, column: 2 } }] },
      { id: 'pa-3', order: 3, status: 'draft', rbi: 4 },
    ],
    baserunning: [{ id: 'run-1', order: 1, status: 'complete', from: 'third', to: 'home',
      reason: 'steal', result: 'stolenBase', reflection: 'スタート' }],
    positionChanges: [{ id: 'pos-1', order: 1, position: 'SS', inning: 1 }, { id: 'pos-2', order: 2, position: 'CF' }],
    fielding: [{ id: 'field-1', order: 1, status: 'complete', position: 'SS', playType: 'grounder', credits: ['assist'],
      development: [{ skill: 'throwing', note: '握り替え' }], improvement: '送球' }],
  }
  return { old, target, details, saved: updateMatchDetails(old, target, () => details, now) }
}

beforeEach(() => {
  vi.stubGlobal('__LOCAL_MATCH_RECORDS__', true)
  vi.stubGlobal('__MATCH_TEST_BUILD__', null)
  vi.stubGlobal('window', { location: { hostname: 'localhost' } })
})
afterEach(() => vi.unstubAllGlobals())

test('旧形式を読み続け、詳細・未確定の打席・投球なし・0をIndexedDBに保存し再読込できる', async () => {
  const { old, saved, details } = fixture()
  const name = 'detail-' + crypto.randomUUID()
  const storage = createStorage(name)
  await storage.update(() => old)
  expect(await createStorage(name).read()).toEqual(old)
  await storage.update(() => saved)
  const reloaded = await createStorage(name).read()
  expect(reloaded.matches?.[0].details).toEqual(details)
  expect(reloaded.matches?.[0].details?.plateAppearances[0].pitches).toBeUndefined()
  expect(reloaded.matches?.[0].details?.plateAppearances[0].pitchCount).toBe(0)
  expect(reloaded.matches?.[0].details?.plateAppearances[1].pitchCount).toBeUndefined()
  expect(reloaded.matches?.[0].details?.plateAppearances.map(row => row.rbi)).toEqual([0, undefined, 4])
})

test('打席の更新は別打席、走塁・守備、親の既存IDに影響しない', () => {
  const { target, details, saved } = fixture()
  const next = saveMatchDetailRow(saved, target, 'plateAppearances', { ...plate, result: 'double' }, now)
  expect(next.matches![0].id).toBe(target.matchId)
  expect(next.matches![0].details).toEqual({ ...details, plateAppearances: [
    { ...plate, result: 'double' }, ...details.plateAppearances.slice(1),
  ] })
  expect(saved.matches![0].details).toEqual(details)
})

test('既存のメニュー付き記録に詳細を追加し、振り返り空欄でも保持して親の削除で一緒に除去する', () => {
  const linked = { ...draft, menuId: 'swing', amount: '3' }
  const old = saveRecord(initialData(), linked, undefined, now)
  const recordId = old.records[0].id
  const withDetails = saveMatchDetailRow(old, { recordId }, 'plateAppearances', plate, now)
  const prior = withDetails.matches![0]
  expect(withDetails.records).toEqual(old.records)
  const saved = saveMatch(withDetails, linked, { recordId }, now)
  expect(saved.matches?.[0]).toEqual(prior)
  expect(saved.records).toEqual(old.records)
  expect(deleteMatch(saved, recordId, true)).toEqual(initialData())
  const standalone = fixture()
  expect(deleteMatch(standalone.saved, standalone.target.matchId, false)).toEqual(initialData())
})

test('詳細なしはバックアップv1、詳細付きはv2で往復し、v1による詳細の上書きを防ぐ', async () => {
  const { old, saved } = fixture()
  const oldBackup = decodeBackup(encodeBackup(old, now))
  const backup = decodeBackup(encodeBackup(saved, now))
  expect(oldBackup).toMatchObject({ backupVersion: 1, dataVersion: 3 })
  expect(backup).toMatchObject({ backupVersion: 2, dataVersion: 3 })
  expect(oldBackup.data).toEqual(old)
  expect(backup.data).toEqual(saved)
  expect(() => decodeBackup(JSON.stringify({ ...backup, backupVersion: 1 }))).toThrow('一致しません')
  expect(replacesMatches(saved, old)).toBe(true)
  const storage = createStorage('restore-detail-' + crypto.randomUUID())
  await storage.update(restoreChange(oldBackup, initialData()))
  await storage.update(restoreChange(backup, old))
  await expect(storage.update(restoreChange(oldBackup, backup.data))).rejects.toThrow('旧形式')
  expect(await storage.read()).toEqual(backup.data)
})

test.each([
  ['空白を含むID', { ...plate, id: 'bad id' }],
  ['範囲外の座標', { ...plate, fieldPoint: { x: -0.001, y: 0 } }],
  ['不明な結果', { ...plate, result: 'unknown' }],
  ['負の打点', { ...plate, rbi: -1 }],
  ['小数の打点', { ...plate, rbi: 1.5 }],
  ['文字列の打点', { ...plate, rbi: '1' }],
  ['安全な整数範囲を超えた打点', { ...plate, rbi: Number.MAX_SAFE_INTEGER + 1 }],
  ['範囲外のカウント', { ...plate, beforeFinalPitch: { balls: 4, strikes: 0 } }],
  ['範囲外のストライクゾーン', { ...plate, pitches: [
    { id: 'pitch-2', order: 1, type: initialPitchTypes[1], result: 'ball', location: { zone: 'inside', row: 3, column: 0 } },
  ] }],
])('%sを端末保存・バックアップで拒否する', async (_name, invalid) => {
  const { target, old } = fixture()
  const invalidDetails = { ...emptyMatchDetails(), plateAppearances: [invalid] } as MatchDetails
  const storage = createStorage('invalid-detail-' + crypto.randomUUID())
  await storage.update(() => old)
  await expect(storage.update(data => updateMatchDetails(data, target, () => invalidDetails, now))).rejects.toThrow('試合詳細')
  expect(await storage.read()).toEqual(old)
  expect(() => validateData({ ...old, matches: [{ ...old.matches![0], details: invalidDetails }] })).toThrow('試合')
})

test('重複ID・順序と、存在しない打席への参照を拒否する', () => {
  const { saved, target } = fixture()
  expect(() => saveMatchDetailRow(saved, target, 'baserunning',
    { id: plate.id, order: 2, status: 'draft' }, now)).toThrow('重複')
  expect(() => saveMatchDetailRow(saved, target, 'plateAppearances',
    { ...plate, id: 'duplicated-order' }, now)).toThrow('重複')
  expect(() => saveMatchDetailRow(saved, target, 'plateAppearances', { ...plate, pitches: [
    { id: plate.id, order: 1, type: initialPitchTypes[0], result: 'ball', location: { zone: 'outside', side: 'low' } },
  ] }, now)).toThrow('重複')
  expect(() => saveMatchDetailRow(saved, target, 'fielding',
    { id: 'field-2', order: 2, status: 'draft', plateAppearanceId: 'missing' }, now)).toThrow('不正')
})

test('追加球種・ゾーン外を記録し、後で球種候補の名称を変えても記録時点の名前が残る', async () => {
  const { old, target } = fixture()
  const type = { id: 'custom-changeup', name: 'チェンジアップ', symbol: '◇' }
  const storage = createStorage('pitch-type-' + crypto.randomUUID())
  await storage.update(() => old)
  await storage.update(data => saveMatchDetailRow(data, target, 'plateAppearances', { ...plate, pitches: [
    { id: 'custom-pitch', order: 1, type, result: 'ball', location: { zone: 'outside', side: 'lowRight' } },
  ] }, now))
  type.name = '候補名を変更'
  expect((await storage.read()).matches?.[0].details?.plateAppearances[0].pitches?.[0]).toMatchObject({
    type: { id: 'custom-changeup', name: 'チェンジアップ', symbol: '◇' }, location: { zone: 'outside', side: 'lowRight' },
  })
})

test('アカウント保存とゲストデータのクラウド引継ぎをトランザクション内で拒否する', async () => {
  const { saved } = fixture()
  const account = createAccountStorage('test', 'detail-account-' + crypto.randomUUID())
  const before = await account.read()
  await expect(account.save(() => saved)).rejects.toThrow('端末内専用')
  await expect(chooseSnapshot(account, { kind: 'initial', source: 'guest', version: before.version,
    local: saved, remote: null }, 'local')).rejects.toThrow('端末内専用')
  expect(await account.read()).toEqual(before)
})

test('詳細の保存も既存の試合編集ガードに従う', () => {
  const { old, target } = fixture()
  vi.stubGlobal('__LOCAL_MATCH_RECORDS__', false)
  expect(() => saveMatchDetailRow(old, target, 'plateAppearances', plate, now)).toThrow('編集は現在無効')
})

test('旧位置と旧球数を保持してシュートを保存・再読込し、v3バックアップを復元できる', async () => {
  const { saved, target, details } = fixture()
  const oldPlate = details.plateAppearances[0]
  const legacy: Pitch = { id: 'legacy-in-play', order: 1, type: { id: 'fastball-slow', name: 'ストレート（遅）', symbol: '●' }, result: 'inPlay',
    location: { zone: 'outside', side: 'highLeft' } }
  const shoot = initialPitchTypes.find(type => type.id === 'shoot')!
  const newPitch: Pitch = { id: 'new-pitch', order: 2, type: shoot, result: 'hit',
    location: { zone: 'point', x: .237, y: 1 } }
  const oldData = updateMatchDetails(saved, target, current => ({
    ...current, plateAppearances: [{ ...oldPlate, pitches: [legacy] }, ...current.plateAppearances.slice(1)],
    baserunning: current.baserunning.map(row => ({ ...row, plateAppearanceId: oldPlate.id })),
    fielding: current.fielding.map(row => ({ ...row, plateAppearanceId: oldPlate.id })),
  }), now)
  const oldDetails = oldData.matches![0].details!
  const oldBackup = decodeBackup(encodeBackup(oldData, now))
  expect(oldBackup.backupVersion).toBe(2)

  const name = 'pitch-v2-' + crypto.randomUUID()
  const storage = createStorage(name)
  await storage.update(restoreChange(oldBackup, initialData()))
  const oldEdit = { ...oldDetails.plateAppearances[0], result: 'groundOut' } as const
  await storage.update(data => saveMatchDetailRow(data, target, 'plateAppearances', oldEdit, now))
  const legacyReloaded = await createStorage(name).read()
  expect(legacyReloaded.matches![0].details).toEqual({ ...oldDetails,
    plateAppearances: [oldEdit, ...oldDetails.plateAppearances.slice(1)] })
  expect(decodeBackup(encodeBackup(legacyReloaded, now)).backupVersion).toBe(2)
  const nextPlate = { ...oldDetails.plateAppearances[0], pitches: [legacy, newPitch] }
  expect(isMatchDetails({ ...oldDetails, plateAppearances: [nextPlate, ...oldDetails.plateAppearances.slice(1)] })).toBe(false)
  await storage.update(data => saveMatchDetailRow(data, target, 'plateAppearances', nextPlate, now))
  const reloaded = await createStorage(name).read()
  const newDetails = reloaded.matches![0].details!
  expect(newDetails).toEqual({ ...oldDetails, version: 2,
    plateAppearances: [nextPlate, ...oldDetails.plateAppearances.slice(1)] })
  expect(isMatchDetails({ ...newDetails, plateAppearances: [{ ...nextPlate, pitches: [
    { ...newPitch, location: { zone: 'point', x: -.001, y: 1 } },
  ] }, ...oldDetails.plateAppearances.slice(1)] })).toBe(false)
  expect(isMatchDetails({ ...newDetails, plateAppearances: [
    { ...nextPlate, result: 'groundOut' }, ...oldDetails.plateAppearances.slice(1),
  ] })).toBe(false)

  const edited = await storage.update(data => saveMatchDetailRow(data, target, 'plateAppearances',
    { ...nextPlate, result: 'double' }, now))
  expect(calculateMatchBattingStats(reloaded.matches![0])).toMatchObject({ h: 1, tb: 1, slg: .5 })
  expect(calculateMatchBattingStats(edited.matches![0])).toMatchObject({ h: 1, tb: 2, avg: .5, obp: .5, slg: 1 })

  const backup = decodeBackup(encodeBackup(edited, now))
  expect(backup.backupVersion).toBe(3)
  expect(() => decodeBackup(JSON.stringify({ ...backup, backupVersion: 2 }))).toThrow('一致しません')
  const restored = createStorage('pitch-restore-' + crypto.randomUUID())
  await restored.update(restoreChange(backup, initialData()))
  expect(await restored.read()).toEqual(edited)
})

test('打席の左右を保存・復元しても投球位置と他分野を保持し、旧打席は未記録のまま読む', async () => {
  const { target, details, saved } = fixture()
  const [first, legacy] = details.plateAppearances
  const db = 'batter-side-' + crypto.randomUUID()
  const store = createStorage(db)
  await store.update(() => saved)
  for (const batterSide of ['right', 'left', undefined] as const) {
    await store.update(data => saveMatchDetailRow(data, target, 'plateAppearances', { ...first, batterSide }, now))
    const reopened = await createStorage(db).read()
    expect(reopened.matches![0].details).toEqual({
      ...details, plateAppearances: [{ ...first, batterSide }, ...details.plateAppearances.slice(1)],
    })
    const backup = decodeBackup(encodeBackup(reopened))
    expect(backup.backupVersion).toBe(2)
    const restored = createStorage('restore-' + crypto.randomUUID())
    await restored.update(restoreChange(backup, initialData()))
    const plates = (await restored.read()).matches![0].details!.plateAppearances
    expect(plates[0].batterSide).toBe(batterSide)
    expect(plates[1]).toEqual(legacy)
  }
  expect(() => validateData({ ...saved, matches: [{ ...saved.matches![0], details: {
    ...details, plateAppearances: [{ ...first, batterSide: 'invalid' }, ...details.plateAppearances.slice(1)],
  } }] })).toThrow()
})
