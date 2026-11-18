import migration from '../supabase/migrations/202611180001_training_log_snapshots.sql?raw'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { initialData } from './initialData'

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

