import migration from '../supabase/migrations/202611180001_training_log_snapshots.sql?raw'
import writeMigration from '../supabase/migrations/202611200001_training_log_snapshot_write_v2.sql?raw'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { initialData } from './initialData'
import { decodeBackup, encodeBackup, validateData } from './backup'

const a = '00000000-0000-4000-8000-000000000001'
const b = '00000000-0000-4000-8000-000000000002'
const table = 'public.training_log_snapshots'
const data = JSON.stringify(initialData())
let db: PGlite

beforeAll(async () => {
  db = new PGlite()
  // Minimal stand-ins for the Supabase Auth schema and request JWT context.
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated;
    insert into auth.users values ('${a}'), ('${b}');
  `)
  await db.exec(migration)
}, 15_000)

afterAll(async () => { await db?.close() })

async function signIn(id: string) {
  await db.exec('reset role; set role authenticated')
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id])
}

const update = (revision: number, snapshot = data) =>
  db.query('select * from public.training_log_update_snapshot($1, $2::jsonb)', [revision, snapshot])

test('同じrevisionの更新は一度だけ成功し、古い更新は競合を返す', async () => {
  await signIn(a)
  await db.query(`insert into ${table}(data) values ($1::jsonb)`, [data])
  const saved = { ...initialData(), routineVersions: [{ id: 'plan', startsOn: '2026-11-18', items: [] }], routineAdditions: [] }
  expect((await update(1, JSON.stringify(saved))).rows).toEqual([{ status: 'updated', revision: 2 }])
  expect((await update(1)).rows).toEqual([{ status: 'conflict', revision: null }])
  expect((await db.query(`select data, revision from ${table}`)).rows).toEqual([{ data: saved, revision: 2 }])
})

test('別ユーザーの行にアクセスできず、RPCは呼び出した本人の行だけを更新する', async () => {
  await signIn(b)
  expect((await db.query(`select * from ${table} where user_id = $1`, [a])).rows).toEqual([])
  expect((await update(2)).rows).toEqual([{ status: 'conflict', revision: null }])
  await expect(db.query(`insert into ${table}(user_id,data) values ($1,$2::jsonb)`, [a, data])).rejects.toMatchObject({ code: '42501' })
  await db.query(`insert into ${table}(data) values ($1::jsonb)`, [data])
  expect((await update(1)).rows).toEqual([{ status: 'updated', revision: 2 }])
  expect((await db.query(`select user_id from ${table}`)).rows).toEqual([{ user_id: b }])
  await signIn(a)
  expect((await db.query(`select revision from ${table}`)).rows).toEqual([{ revision: 2 }])
})

test('未認証、直接更新、不正なrevisionやJSONを拒否する', async () => {
  await db.exec("reset role; reset request.jwt.claim.sub; set role anon")
  await expect(db.query(`select * from ${table}`)).rejects.toMatchObject({ code: '42501' })
  await expect(update(1)).rejects.toMatchObject({ code: '42501' })
  await db.exec('reset role; set role authenticated')
  await expect(update(1)).rejects.toMatchObject({ code: '42501' })
  await signIn(a)
  await expect(db.query(`update ${table} set data = $1::jsonb`, [data])).rejects.toMatchObject({ code: '42501' })
  await expect(db.query(`update ${table} set revision = 1`)).rejects.toMatchObject({ code: '42501' })
  await expect(db.query(`update ${table} set user_id = $1`, [b])).rejects.toMatchObject({ code: '42501' })
  await expect(update(0)).rejects.toMatchObject({ code: '22023' })
  await expect(update(2, '{"schemaVersion":3}')).rejects.toMatchObject({ code: '23514' })
  expect((await db.query(`select revision from ${table}`)).rows).toEqual([{ revision: 2 }])
})

test('v2切り替えで旧書き込みを閉じ、本人の作成・更新と読み取りだけを維持する', async () => {
  await db.exec('reset role')
  const c = '00000000-0000-4000-8000-000000000003'
  await db.query('insert into auth.users values ($1)', [c])
  await db.exec(writeMigration)
  const write = (revision: number | null, snapshot = data) =>
    db.query('select * from public.training_log_write_snapshot_v2($1, $2::jsonb)', [revision, snapshot])
  await signIn(c)
  await expect(db.query(`insert into ${table}(data) values ($1::jsonb)`, [data])).rejects.toMatchObject({ code: '42501' })
  const [created, duplicate] = await Promise.all([write(null), write(null)])
  expect(created.rows).toEqual([{ status: 'written', revision: 1 }])
  expect(duplicate.rows).toEqual([{ status: 'conflict', revision: null }])
  const next = JSON.stringify({ ...initialData(), matches: [] })
  const [updated, stale] = await Promise.all([write(1, next), write(1)])
  expect(updated.rows).toEqual([{ status: 'written', revision: 2 }])
  expect(stale.rows).toEqual([{ status: 'conflict', revision: null }])
  await expect(update(2)).rejects.toMatchObject({ code: '42501' })
  await expect(db.query(`update ${table} set data = $1::jsonb`, [data])).rejects.toMatchObject({ code: '42501' })
  await expect(db.query(`delete from ${table}`)).rejects.toMatchObject({ code: '42501' })
  await expect(write(0)).rejects.toMatchObject({ code: '22023' })
  await expect(write(9007199254740991)).rejects.toMatchObject({ code: '22023' })
  await expect(write(2, '{"schemaVersion":3}')).rejects.toMatchObject({ code: '23514' })
  await expect(write(2, JSON.stringify({ ...initialData(), schemaVersion: 4 }))).rejects.toMatchObject({ code: '23514' })
  await expect(write(2, JSON.stringify({ ...initialData(), matches: null }))).rejects.toMatchObject({ code: '22023' })
  await expect(write(2, JSON.stringify({ ...initialData(), matches: [1] }))).rejects.toMatchObject({ code: '22023' })
  const match = { id: 'match', date: '2026-11-20', good: '', improve: '',
    createdAt: '2026-11-20T00:00:00.000Z', updatedAt: '2026-11-20T00:00:00.000Z' }
  for (const patch of [
    { matches: [{ ...match, date: '2026-02-30' }] },
    { matches: [{ ...match, updatedAt: '2026-11-20T25:00:00.000Z' }] },
    { matches: [match, { ...match, recordId: 'orphan' }] },
    { matches: [{ ...match, id: '\u00a0' }] },
    { menus: [null] },
    { plans: [{ date: match.date, kind: '試合', menuIds: ['missing-menu'] }] },
  ]) {
    const invalid = JSON.stringify({ ...initialData(), ...patch })
    expect(() => validateData(JSON.parse(invalid))).toThrow()
    await expect(write(2, invalid)).rejects.toMatchObject({ code: '22023' })
  }
  expect((await db.query(`select user_id, data, revision from ${table}`)).rows).toEqual([
    { user_id: c, data: JSON.parse(next), revision: 2 },
  ])
  const legacyBackup = decodeBackup(encodeBackup(initialData())).data
  const sample = {
    ...legacyBackup,
    matches: [{ ...match, recordId: 'legacy-deleted-record' }],
    plans: [{ date: match.date, kind: '試合', menuIds: ['swing'] }],
    reflections: [{ date: '2026-11-16', period: 'week', success: '', challenge: '', next: '', updatedAt: match.updatedAt }],
    routineVersions: [{ id: 'v1', startsOn: match.date, items: [{ id: 'i1', name: '素振り', menuId: 'swing',
      schedule: 'weekdays', weekdays: [5], note: '', condition: '', target: { unit: '回', amount: 10 } }] }],
    routineCompletions: [{ date: match.date, itemId: 'i1' }],
    futureField: { keep: true },
  }
  validateData(sample)
  expect((await write(2, JSON.stringify(sample))).rows).toEqual([{ status: 'written', revision: 3 }])
  expect((await db.query(`select data, revision from ${table}`)).rows).toEqual([{ data: sample, revision: 3 }])
  expect((await write(3, JSON.stringify(legacyBackup))).rows).toEqual([{ status: 'written', revision: 4 }])
  expect((await db.query(`select data, revision from ${table}`)).rows).toEqual([{ data: legacyBackup, revision: 4 }])
  await signIn(a)
  expect((await db.query(`select user_id from ${table} where user_id = $1`, [c])).rows).toEqual([])
  await db.exec('reset role; reset request.jwt.claim.sub; set role authenticated')
  await expect(write(null)).rejects.toMatchObject({ code: '42501' })
  await db.exec('reset role; set role anon')
  await expect(write(null)).rejects.toMatchObject({ code: '42501' })
})

