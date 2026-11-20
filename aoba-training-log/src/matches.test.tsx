import 'fake-indexeddb/auto'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createAccountStorage } from './accountStorage'
import { compareBackupCounts, decodeBackup, encodeBackup, replacesMatches, validateData } from './backup'
import { emptyMatchDetails } from './matchDetails'
import { initialData } from './initialData'
import { canEditMatches, deleteMatch, saveMatch, updateMatchDetails, type MatchDraft } from './matches'
import { Records } from './Records'
import { createStorage } from './storage'
import { hasLocalData, syncOnce, type RemoteSnapshot, type SnapshotApi } from './sync'
import { deleteRecord, saveRecord } from './training'

const now = new Date(2026, 10, 20, 12)
const draft: MatchDraft = { date: '2026-11-20', kind: '試合', menuId: '', amount: '', duration: '', note: '', rating: '',
  good: ' 守備で声を出した ', improve: ' 次は早めに準備する ' }

beforeEach(() => {
  vi.stubGlobal('__LOCAL_MATCH_RECORDS__', true)
  vi.stubGlobal('__MATCH_TEST_BUILD__', null)
  vi.stubGlobal('window', { location: { hostname: 'localhost' } })
})
afterEach(() => vi.unstubAllGlobals())

test('同日の試合を別IDで保存し、履歴から振り返りを再表示・編集・削除できる', async () => {
  const db = 'match-' + crypto.randomUUID()
  const store = createStorage(db)
  await store.update(data => saveMatch(saveMatch(data, draft, undefined, now), draft, undefined, now))
  const reopened = createStorage(db)
  const data = await reopened.read()
  const [first, second] = data.matches!
  expect(first.id).not.toBe(second.id)
  expect(first).toMatchObject({ date: draft.date, good: draft.good.trim(), improve: draft.improve.trim(), createdAt: now.toISOString() })
  expect(data.records).toEqual([])
  const html = renderToStaticMarkup(<Records data={data} commit={vi.fn()} />)
  expect(html.match(/class="match-history-entry"/g)).toHaveLength(2)
  expect(html).toContain('</time> · 試合 · 同日第1試合')
  expect(html).toContain('</time> · 試合 · 同日第2試合')
  expect(html).toContain('守備で声を出した')
  expect(html).toContain('次は早めに準備する')
  const saved = await reopened.update(current => saveMatch(current, { ...draft, good: '修正' }, { matchId: first.id }, now))
  expect(saved.matches?.find(item => item.id === first.id)).toMatchObject({ good: '修正', createdAt: first.createdAt })
  const remaining = deleteMatch(saved, first.id, false)
  expect(remaining.matches).toEqual([second])
  expect(hasLocalData(deleteMatch(remaining, second.id, false))).toBe(false)
})

test('メニュー付き試合の反省を分離し、旧版相当の編集・削除で保持する', () => {
  const linkedDraft = { ...draft, menuId: 'swing', amount: '3' }
  const old = saveRecord(initialData(), linkedDraft, undefined, now)
  const id = old.records[0].id
  const data = saveMatch(old, linkedDraft, { recordId: id }, now)
  expect(data.records).toEqual(old.records)
  expect(data.matches?.[0]).toMatchObject({ recordId: id, good: draft.good.trim() })
  const moved = saveRecord(data, { ...linkedDraft, amount: '4' }, id, now)
  expect(moved.matches).toEqual(data.matches)
  const orphan = deleteRecord(moved, id)
  validateData(orphan)
  expect(renderToStaticMarkup(<Records data={orphan} commit={vi.fn()} />)).toContain('元の試合記録が見つからない振り返り')
  expect(deleteMatch(data, id, true)).toEqual(initialData())
  expect(() => saveRecord(initialData(), { ...draft, kind: '自主練' }, undefined, now)).toThrow('有効な練習メニュー')
})

test('復元データの試合IDと既存記録IDが同じでも編集先を取り違えない', () => {
  const linkedDraft = { ...draft, menuId: 'swing', amount: '3' }
  const data = saveRecord(saveMatch(initialData(), draft, undefined, now), linkedDraft, undefined, now)
  const recordId = data.records[0].id
  const restored = { ...data, matches: [{ ...data.matches![0], id: recordId }] }
  const linked = saveMatch(restored, linkedDraft, { recordId }, now)
  const updated = saveMatch(linked, { ...draft, good: '独立した試合のみ変更' }, { matchId: recordId }, now)
  expect(updated.records).toEqual(data.records)
  expect(updated.matches?.find(item => item.recordId === recordId)?.good).toBe(draft.good.trim())
  expect(updated.matches?.find(item => item.id === recordId)?.good).toBe('独立した試合のみ変更')
  expect(() => validateData(updated)).not.toThrow()
})

test('バックアップで旧データと試合データを検証し、同件数の上書きも検知する', () => {
  const old = initialData()
  const next = saveMatch(old, draft, undefined, now)
  expect(decodeBackup(encodeBackup(old, now)).data.matches).toBeUndefined()
  expect(decodeBackup(encodeBackup(next, now)).data.matches?.[0].good).toBe(draft.good.trim())
  expect(() => validateData({ ...next, matches: [{ ...next.matches![0], improve: 1 }] })).toThrow('試合')
  expect(compareBackupCounts(next, old).find(row => row.key === 'matches')).toMatchObject({ current: 1, restored: 0 })
  expect(replacesMatches(next, old)).toBe(true)
  expect(replacesMatches(next, next)).toBe(false)
  expect(replacesMatches(next, saveMatch(next, { ...draft, improve: '' }, { matchId: next.matches![0].id }, now))).toBe(true)
})

test('仮想クラウド同期は試合を別端末に復元し、古いrevisionの上書きを拒否する', async () => {
  let remote: RemoteSnapshot | null = null
  const api: SnapshotApi = {
    async read() { return structuredClone(remote) },
    async write(flight) {
      if ((remote?.revision ?? null) !== flight.revision) return null
      const data: unknown = JSON.parse(JSON.stringify(flight.data))
      validateData(data)
      remote = { data, revision: (flight.revision ?? 0) + 1 }
      return remote.revision
    },
  }
  const device = () => createAccountStorage('match', 'match-sync-' + crypto.randomUUID())
  async function settle(store: ReturnType<typeof device>) {
    for (let attempt = 0; attempt < 10; attempt++) {
      const result = await syncOnce(store, api, async () => initialData())
      if (result !== 'again') return result
    }
    throw new Error('sync did not settle')
  }
  const a = device(), b = device()
  const saved = await a.save(data => saveMatch(data, draft, undefined, now))
  expect(await settle(a)).toBe('synced')
  expect(await settle(b)).toBe('synced')
  expect((await b.read()).data.matches).toEqual(saved.data.matches)
  const id = saved.data.matches![0].id
  await b.save(data => deleteMatch(data, id, false))
  await a.save(data => saveMatch(data, { ...draft, good: '同期更新' }, { matchId: id }, now))
  expect(await settle(a)).toBe('synced')
  expect(await settle(b)).toMatchObject({ kind: 'conflict' })
})

test('公開フラグOFFと非ループバックでは新機能の変更を拒否し履歴は読める', () => {
  const data = saveMatch(initialData(), draft, undefined, now)
  vi.stubGlobal('window', { location: { hostname: 'aoba-test.invalid' } })
  expect(canEditMatches()).toBe(false)
  vi.stubGlobal('window', { location: { hostname: 'localhost' } })
  vi.stubGlobal('__LOCAL_MATCH_RECORDS__', false)
  expect(() => saveMatch(data, draft, undefined, now)).toThrow('無効')
  expect(() => deleteMatch(data, data.matches![0].id, false)).toThrow('無効')
  const form = renderToStaticMarkup(<Records data={data} commit={vi.fn()} start={{ kind: '試合' }} />)
  expect(form).toContain('</time> · 試合')
  expect(form).not.toContain('良かったこと（任意）')
  expect(form).not.toContain('>編集</button>')
})

test('検証ビルドの試合書き込みは指定したセキュアオリジンに限定される', () => {
  const origin = 'https://aoba-match-test.invalid'
  vi.stubGlobal('__MATCH_TEST_BUILD__', { origin, build: 'test-build' })
  vi.stubGlobal('__LOCAL_MATCH_RECORDS__', false)
  vi.stubGlobal('window', { isSecureContext: true, location: { origin } })
  const data = saveMatch(initialData(), draft, undefined, now)
  const id = data.matches![0].id
  expect(saveMatch(data, { ...draft, good: '検証で更新' }, { matchId: id }, now).matches?.[0].good).toBe('検証で更新')
  expect(deleteMatch(data, id, false)).toEqual(initialData())
  for (const [candidate, secure] of [[origin, false], [origin + ':444', true], ['https://other.invalid', true]] as const) {
    vi.stubGlobal('window', { isSecureContext: secure, location: { origin: candidate } })
    expect(() => saveMatch(initialData(), draft, undefined, now)).toThrow('無効')
    expect(() => deleteMatch(data, id, false)).toThrow('無効')
  }
})

test('履歴は確定イベント、下書き、未記録と簡易集計を区別し、同日試合の操作を個別に表示する', () => {
  const data = saveMatch(saveMatch(initialData(), draft, undefined, now), draft, undefined, now)
  const [first, second] = data.matches!
  const details = emptyMatchDetails()
  data.matches = [
    { ...first, details: { ...details, opponent: '青葉クラブ', source: { ...details.source, batting: 'summary' },
      summary: { batting: { appearances: 8 } },
      plateAppearances: [{ id: 'p1', order: 1, status: 'complete', result: 'walk' }, { id: 'p2', order: 2, status: 'draft' }],
      baserunning: [
        { id: 'r1', order: 1, status: 'complete', from: 'third', to: 'home', result: 'stolenBase' },
        { id: 'r2', order: 2, status: 'complete', from: 'first', result: 'caughtStealing' },
        { id: 'r3', order: 3, status: 'complete', from: 'first', to: 'second', result: 'advanced' },
        { id: 'r4', order: 4, status: 'draft' },
      ],
      fielding: [{ id: 'f1', order: 1, status: 'draft' }],
    } },
    { ...second, details: { ...details, baserunning: [
      { id: 'r5', order: 1, status: 'complete', from: 'first', to: 'second', result: 'advanced' },
    ], fielding: [{ id: 'f2', order: 1, status: 'complete', position: 'SS', playType: 'grounder' }] } },
  ]
  const [withOpponent, withoutOpponent] = renderToStaticMarkup(<Records data={data} commit={vi.fn()} />)
    .split('<li class="match-history-entry">').slice(1)
  expect(withOpponent).toContain('対 青葉クラブ')
  expect(withOpponent).toContain('確定打席 1件 · 下書き 1件')
  expect(withOpponent).toContain('成績は簡易集計')
  expect(withOpponent).not.toContain('8件')
  expect(withOpponent).toContain('確定盗塁試行 2件 · 下書き 1件')
  expect(withOpponent).toContain('確定守備プレー 未記録 · 下書き 1件')
  expect(withoutOpponent).toContain('確定打席 未記録')
  expect(withoutOpponent).toContain('確定盗塁試行 0件')
  expect(withoutOpponent).toContain('確定守備プレー 1件')
  for (const label of ['打撃', '走塁', '守備']) {
    expect(withOpponent).toContain(`${label}を記録する`)
    expect(withOpponent).toContain(`${label}の成績を見る`)
  }
  expect(withOpponent).toContain('match-whole-actions')
  expect(withOpponent).toContain('>試合を編集</button>')
  expect(withOpponent).toContain('>試合を削除</button>')
})

test('対戦相手を新規・編集で保存し、同日試合と既存の詳細を保持する', async () => {
  const db = 'opponent-' + crypto.randomUUID()
  const store = createStorage(db)
  const withoutReflection = { ...draft, good: '', improve: '' }
  await store.update(data => saveMatch(data, { ...withoutReflection, opponent: ' 青葉クラブ ' }, undefined, now))
  await store.update(data => saveMatch(data, {
    ...withoutReflection, menuId: 'swing', amount: '3', opponent: 'みどりクラブ',
  }, undefined, now))
  const start = await createStorage(db).read()
  const [first, second] = start.matches!
  expect(first.details?.opponent).toBe('青葉クラブ')
  expect(second.details?.opponent).toBe('みどりクラブ')
  expect(second.recordId).toBe(start.records[0].id)
  const target = { matchId: first.id }
  const recorded = await store.update(data => updateMatchDetails(data, target, details => ({
    ...details, plateAppearances: [{ id: 'pa', order: 1, status: 'complete', result: 'single' }],
    baserunning: [{ id: 'run', order: 1, status: 'draft', plateAppearanceId: 'pa' }],
    fielding: [{ id: 'field', order: 1, status: 'draft', plateAppearanceId: 'pa', opportunity: {} }],
  }), now))
  const original = recorded.matches!.find(row => row.id === first.id)!
  await store.update(data => saveMatch(data, { ...withoutReflection, opponent: ' 新しい対戦相手 ' }, target, now))
  const edited = await createStorage(db).read()
  expect(edited.matches!.find(row => row.id === first.id)?.details).toEqual({ ...original.details, opponent: '新しい対戦相手' })
  expect(edited.matches!.find(row => row.id === second.id)).toEqual(second)
  const html = renderToStaticMarkup(<Records data={edited} commit={vi.fn()} />)
  expect(html).toContain('対 新しい対戦相手')
  expect(html).toContain('対 みどりクラブ')
  expect(html).toContain('同日第1試合')
  expect(html).toContain('同日第2試合')
  const unchanged = saveMatch(edited, withoutReflection, target, now)
  expect(unchanged.matches!.find(row => row.id === first.id)?.details?.opponent).toBe('新しい対戦相手')
  const cleared = saveMatch(unchanged, { ...withoutReflection, opponent: '   ' }, target, now)
  expect(cleared.matches!.find(row => row.id === first.id)?.details).toEqual({ ...original.details, opponent: undefined })
  const unnamed = saveMatch(initialData(), { ...withoutReflection, menuId: 'swing', amount: '3', opponent: ' ' }, undefined, now)
  expect(unnamed.matches).toBeUndefined()
})
