import 'fake-indexeddb/auto'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createAccountStorage } from './accountStorage'
import { decodeBackup, encodeBackup, replacesMatches, restoreChange, validateData } from './backup'
import { initialData } from './initialData'
import { emptyMatchDetails, initialPitchTypes, type MatchDetails } from './matchDetails'
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
      { ...plate, fieldPoint: { x: 0, y: 1 }, pitchCount: 0, beforeFinalPitch: { balls: 0, strikes: 0 } },
      { id: 'pa-2', order: 2, status: 'complete', result: 'strikeoutLooking', bunt: 'failed',
        pitches: [{ id: 'pitch-1', order: 1, type: { ...initialPitchTypes[0] }, result: 'calledStrike',
          location: { zone: 'inside', row: 0, column: 2 } }] },
      { id: 'pa-3', order: 3, status: 'draft' },
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
