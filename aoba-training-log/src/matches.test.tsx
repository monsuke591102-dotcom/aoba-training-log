import 'fake-indexeddb/auto'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createAccountStorage } from './accountStorage'
import { compareBackupCounts, decodeBackup, encodeBackup, replacesMatches, validateData } from './backup'
import { initialData } from './initialData'
import { canEditMatches, deleteMatch, saveMatch, type MatchDraft } from './matches'
import { Records } from './Records'
import { createStorage } from './storage'
import { hasLocalData, syncOnce, type RemoteSnapshot, type SnapshotApi } from './sync'
import { deleteRecord, saveRecord } from './training'

const now = new Date(2026, 10, 20, 12)
const draft: MatchDraft = { date: '2026-11-20', kind: '試合', menuId: '', amount: '', duration: '', note: '', rating: '',
  good: ' 守備で声を出した ', improve: ' 次は早めに準備する ' }

beforeEach(() => {
  vi.stubGlobal('__LOCAL_MATCH_RECORDS__', true)
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
  expect(html.match(/メニューなしの試合/g)).toHaveLength(2)
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
  expect(form).toContain('メニューなしの試合')
  expect(form).not.toContain('良かったこと（任意）')
  expect(form).not.toContain('>編集</button>')
})
