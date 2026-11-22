import migration from '../supabase/migrations/202611180001_training_log_snapshots.sql?raw'
import writeMigration from '../supabase/migrations/202611200001_training_log_snapshot_write_v2.sql?raw'
import rejectMatchDetailsMigration from '../supabase/migrations/202611200002_reject_local_match_details.sql?raw'
import protectSnapshotMigration from '../supabase/migrations/202611200003_deny_local_match_details_at_storage.sql?raw'
import audit from '../supabase/audit-snapshot-readonly.sql?raw'
import stopLegacy from '../supabase/cutover-stop-legacy.sql?raw'
import installV2 from '../supabase/cutover-install-v2.sql?raw'
import verifyCutover from '../supabase/cutover-verify-readonly.sql?raw'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { initialData } from './initialData'
import { decodeBackup, encodeBackup, validateData } from './backup'
import { emptyMatchDetails, requireCloudCompatibleMatchData, type MatchDetails } from './matchDetails'

const a = '00000000-0000-4000-8000-000000000001'
const b = '00000000-0000-4000-8000-000000000002'
const table = 'public.training_log_snapshots'
const data = JSON.stringify(initialData())
let db: PGlite

async function createFixtureDatabase() {
  const fixture = new PGlite()
  // Minimal stand-ins for the Supabase Auth schema and request JWT context.
  await fixture.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated;
    insert into auth.users values ('${a}'), ('${b}');
  `)
  await fixture.exec(migration)
  return fixture
}

beforeAll(async () => {
  db = await createFixtureDatabase()
  // Exercise the table guard while the old RPC and first-write INSERT are still enabled.
  await db.exec(protectSnapshotMigration)
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

test('監査SELECTは読取専用トランザクションで列権限と件数だけを確認できる', async () => {
  await db.exec('reset role; begin read only')
  try {
    const results = await db.exec(audit)
    expect(results[0].rows).toMatchObject([{ has_cli_history: false, transaction_read_only: true }])
    expect(results[1].rows).toMatchObject([{
      proname: 'training_log_update_snapshot', security_definer: true,
      authenticated_execute: true, anon_execute: false, public_execute: false,
    }])
    expect(results[2].rows).toMatchObject([{ authenticated_insert: true, authenticated_update: false }])
    expect(results.at(-1)?.rows).toMatchObject([{
      total_rows: 1, rows_with_match_details: 0, rows_with_uninspectable_match_format: 0,
    }])
  } finally {
    await db.exec('rollback')
  }
})

test('適用前からある試合詳細はNOT VALID制約の追加後も残り、詳細を省いた置換は制約だけでは防げない', async () => {
  const fixture = await createFixtureDatabase()
  try {
    const time = '2026-11-20T00:00:00.000Z'
    const details = JSON.stringify({ ...initialData(), matches: [{ id: 'legacy-detail', date: '2026-11-20',
      good: '', improve: '', createdAt: time, updatedAt: time, details: emptyMatchDetails() }] })
    await fixture.query(`insert into ${table}(user_id, data) values ($1, $2::jsonb)`, [a, details])
    await fixture.exec(writeMigration)
    await fixture.exec(rejectMatchDetailsMigration)
    await fixture.exec(protectSnapshotMigration)
    const read = () => fixture.query(`select revision, jsonb_path_exists(data, '$.matches[*] ? (exists (@.details))') as has_details from ${table}`)
    expect((await read()).rows).toEqual([{ revision: 1, has_details: true }])
    expect((await fixture.query("select convalidated from pg_constraint where conname = 'training_log_no_local_match_details'")).rows)
      .toEqual([{ convalidated: false }])
    await expect(fixture.exec(`alter table ${table} validate constraint training_log_no_local_match_details`))
      .rejects.toMatchObject({ code: '23514' })
    await fixture.exec('set role authenticated')
    await fixture.query("select set_config('request.jwt.claim.sub', $1, false)", [a])
    const write = (snapshot: string) => fixture.query('select * from public.training_log_write_snapshot_v2(1, $1::jsonb)', [snapshot])
    await expect(write(details)).rejects.toMatchObject({ code: '22023' })
    expect((await read()).rows).toEqual([{ revision: 1, has_details: true }])
    expect((await write(data)).rows).toEqual([{ status: 'written', revision: 2 }])
    expect((await read()).rows).toEqual([{ revision: 2, has_details: false }])
  } finally {
    await fixture.close()
  }
})

async function loginFixture(fixture: PGlite, user = a) {
  await fixture.exec('reset role; set role authenticated')
  await fixture.query("select set_config('request.jwt.claim.sub', $1, false)", [user])
}

async function expectLegacyWritesDenied(fixture: PGlite) {
  await expect(fixture.query('select * from public.training_log_update_snapshot(2, $1::jsonb)', [data]))
    .rejects.toMatchObject({ code: '42501' })
  await expect(fixture.query(`insert into ${table}(data) values ($1::jsonb)`, [data]))
    .rejects.toMatchObject({ code: '42501' })
  await expect(fixture.query(`update ${table} set data = $1::jsonb`, [data]))
    .rejects.toMatchObject({ code: '42501' })
}

const cutoverMigrations = [writeMigration, rejectMatchDetailsMigration, protectSnapshotMigration]
const withoutTransaction = (sql: string) => sql.replace(/^begin;\s*$/im, '').replace(/^commit;\s*$/im, '')

test('実行候補には正規の3マイグレーション本体を同じ順序で含める', () => {
  const bundled = installV2.split('-- BEGIN canonical migration bodies')[1].split('-- END canonical migration bodies')[0]
  const normalize = (sql: string) => sql.replace(/\r\n/g, '\n').trim()
  expect(normalize(bundled)).toEqual(cutoverMigrations.map(sql => normalize(withoutTransaction(sql))).join('\n\n'))
  expect(installV2.match(/^(BEGIN|COMMIT);\s*$/gim)).toHaveLength(2)
})

test('既存SQLを別々に確定すると旧書き込みは止まるが、詳細保護前の新版書き込みが開く', async () => {
  const fixture = await createFixtureDatabase()
  try {
    await fixture.exec(writeMigration)
    await loginFixture(fixture)
    await expectLegacyWritesDenied(fixture)
    const time = '2026-11-20T00:00:00.000Z'
    const details = JSON.stringify({ ...initialData(), matches: [{ id: 'gap', date: '2026-11-20',
      good: '', improve: '', createdAt: time, updatedAt: time, details: emptyMatchDetails() }] })
    expect((await fixture.query('select * from public.training_log_write_snapshot_v2(null, $1::jsonb)', [details])).rows)
      .toEqual([{ status: 'written', revision: 1 }])
  } finally {
    await fixture.close()
  }
}, 20_000)

test('旧権限を先に確定して停止し、途中失敗・復旧点・新版再適用を隔離DBで検証する', async () => {
  const fixture = await createFixtureDatabase()
  let recovered: PGlite | undefined
  try {
    await loginFixture(fixture)
    await fixture.query(`insert into ${table}(data) values ($1::jsonb)`, [data])
    expect((await fixture.query('select * from public.training_log_update_snapshot(1, $1::jsonb)', [data])).rows)
      .toEqual([{ status: 'updated', revision: 2 }])
    await fixture.exec('reset role')
    await expect(fixture.exec(installV2)).rejects.toThrow('Legacy effective write permission remains')
    await fixture.exec('rollback')
    await fixture.exec(stopLegacy)
    const snapshot = await fixture.dumpDataDir()
    await expect(fixture.exec(installV2.replace('-- END canonical migration bodies', 'select 1 / 0;')))
      .rejects.toMatchObject({ code: '22012' })
    await fixture.exec('rollback')
    expect((await fixture.query("select to_regprocedure('public.training_log_write_snapshot_v2(bigint,jsonb)') as rpc")).rows)
      .toEqual([{ rpc: null }])
    await loginFixture(fixture)
    await expectLegacyWritesDenied(fixture)
    expect((await fixture.query(`select data, revision from ${table}`)).rows).toEqual([{ data: initialData(), revision: 2 }])
    await loginFixture(fixture, b)
    await expectLegacyWritesDenied(fixture)

    recovered = new PGlite({ loadDataDir: snapshot })
    await loginFixture(recovered)
    await expectLegacyWritesDenied(recovered)
    expect((await recovered.query(`select data, revision from ${table}`)).rows).toEqual([{ data: initialData(), revision: 2 }])
    await recovered.exec('reset role')
    const before = await recovered.query(`select data, revision, updated_at from ${table}`)
    const beforeAudit = await recovered.exec(verifyCutover)
    await recovered.exec(installV2)
    const afterAudit = await recovered.exec(verifyCutover)
    const tally = (results: typeof afterAudit) => results.find(result => 'snapshot_count' in (result.rows[0] ?? {}))?.rows
    expect(tally(afterAudit)).toEqual(tally(beforeAudit))
    expect(tally(afterAudit)).toMatchObject([{ snapshot_count: 1, rows_with_match_details: 0, min_revision: 2 }])
    expect((await recovered.query(`select data, revision, updated_at from ${table}`)).rows).toEqual(before.rows)
    expect((await recovered.query(`select conname, convalidated from pg_constraint
      where conrelid = '${table}'::regclass and contype = 'c' order by conname`)).rows).toEqual([
      { conname: 'training_log_data_shape', convalidated: true },
      { conname: 'training_log_no_local_match_details', convalidated: true },
      { conname: 'training_log_snapshots_revision_check', convalidated: true },
    ])
    const { rows } = await recovered.query(`select p.prosecdef, p.proconfig,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated,
      has_function_privilege('anon', p.oid, 'EXECUTE') as anon
      from pg_proc p where p.oid = 'public.training_log_write_snapshot_v2(bigint,jsonb)'::regprocedure`)
    expect(rows).toEqual([{ prosecdef: true, proconfig: ['search_path=pg_catalog'], authenticated: true, anon: false }])
    await loginFixture(recovered)
    await expectLegacyWritesDenied(recovered)
    const time = '2026-11-20T00:00:00.000Z'
    const match = { id: 'recovery', date: '2026-11-20', good: '', improve: '', createdAt: time, updatedAt: time }
    const write = (revision: number | null, json = data) =>
      recovered!.query('select * from public.training_log_write_snapshot_v2($1, $2::jsonb)', [revision, json])
    await expect(write(2, JSON.stringify({ ...initialData(), matches: [{ ...match, details: emptyMatchDetails() }] })))
      .rejects.toMatchObject({ code: '22023' })
    expect((await write(2)).rows).toEqual([{ status: 'written', revision: 3 }])
    expect((await write(2)).rows).toEqual([{ status: 'conflict', revision: null }])
    await loginFixture(recovered, b)
    await expectLegacyWritesDenied(recovered)
    expect((await write(null)).rows).toEqual([{ status: 'written', revision: 1 }])
  } finally {
    await recovered?.close()
    await fixture.close()
  }
}, 30_000)

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

test('旧RPCと旧初回INSERTは詳細v1〜v3を拒否し、保存内容とrevisionを維持する', async () => {
  const fresh = '00000000-0000-4000-8000-000000000006'
  await db.exec('reset role')
  await db.query('insert into auth.users values ($1)', [fresh])
  const day = '2026-11-20'
  const timestamp = day + 'T12:00:00.000Z'
  const match = { id: 'legacy-match', date: day, good: '', improve: '', createdAt: timestamp, updatedAt: timestamp }
  const read = async () => (await db.query(`select data, revision, updated_at from ${table}`)).rows
  for (const details of [
    ...([1, 2, 3] as const).map(version => ({ ...emptyMatchDetails(), version })),
    null,
  ]) {
    const snapshot = JSON.stringify({ ...initialData(), matches: [{ ...match, details }] })
    await signIn(fresh)
    await expect(db.query(`insert into ${table}(data) values ($1::jsonb)`, [snapshot]))
      .rejects.toMatchObject({ code: '23514', constraint: 'training_log_no_local_match_details' })
    expect(await read()).toEqual([])
    await signIn(a)
    const before = await read()
    await expect(update(2, snapshot))
      .rejects.toMatchObject({ code: '23514', constraint: 'training_log_no_local_match_details' })
    expect(await read()).toEqual(before)
  }
  await signIn(fresh)
  const legacy = JSON.stringify({ ...initialData(), matches: [match] })
  await db.query(`insert into ${table}(data) values ($1::jsonb)`, [legacy])
  expect((await update(1, legacy)).rows).toEqual([{ status: 'updated', revision: 2 }])
})

describe('新版RPC', () => {
  const c = '00000000-0000-4000-8000-000000000003'
  const parityUser = '00000000-0000-4000-8000-000000000004'
  const write = (revision: number | null, snapshot = data) =>
    db.query('select * from public.training_log_write_snapshot_v2($1, $2::jsonb)', [revision, snapshot])

  beforeAll(async () => {
    await db.exec('reset role')
    await db.query('insert into auth.users values ($1), ($2)', [c, parityUser])
    await db.exec(writeMigration)
    await db.exec(rejectMatchDetailsMigration)
    await signIn(parityUser)
    await write(null)
    await write(1)
  })

  test('適用後のSQL権限は認証済みロールの本人読取と新版RPCに限定する', async () => {
    await db.exec('reset role')
    const { rows } = await db.query(`select
      has_function_privilege('authenticated', 'public.training_log_write_snapshot_v2(bigint,jsonb)', 'EXECUTE') as new_authenticated,
      has_function_privilege('anon', 'public.training_log_write_snapshot_v2(bigint,jsonb)', 'EXECUTE') as new_anon,
      has_function_privilege('authenticated', 'public.training_log_update_snapshot(bigint,jsonb)', 'EXECUTE') as old_authenticated,
      has_schema_privilege('authenticated', 'training_log_private', 'USAGE') as private_schema,
      has_table_privilege('authenticated', '${table}', 'SELECT') as read_authenticated,
      has_table_privilege('anon', '${table}', 'SELECT') as read_anon,
      has_any_column_privilege('authenticated', '${table}', 'INSERT') as insert_authenticated,
      has_any_column_privilege('authenticated', '${table}', 'UPDATE') as update_authenticated,
      has_table_privilege('authenticated', '${table}', 'DELETE') as delete_authenticated,
      (select relrowsecurity from pg_class where oid = '${table}'::regclass) as rls
    `)
    expect(rows).toEqual([{ new_authenticated: true, new_anon: false, old_authenticated: false, private_schema: false,
      read_authenticated: true, read_anon: false, insert_authenticated: false, update_authenticated: false,
      delete_authenticated: false, rls: true }])
  })

  test('仮に旧RPCを残すと同じrevisionの競合は防げても、再取得したrevisionで新しい項目を落とせる', async () => {
    await db.exec('reset role; begin')
    try {
      await db.exec('grant execute on function public.training_log_update_snapshot(bigint,jsonb) to authenticated')
      await signIn(parityUser)
      const match = { id: 'cutover', date: '2026-11-20', good: '試合の振り返り', improve: '',
        createdAt: '2026-11-20T00:00:00.000Z', updatedAt: '2026-11-20T00:00:00.000Z' }
      const newer = { ...initialData(), matches: [match] }
      expect((await write(2, JSON.stringify(newer))).rows).toEqual([{ status: 'written', revision: 3 }])
      expect((await update(2)).rows).toEqual([{ status: 'conflict', revision: null }])
      expect((await db.query(`select data, revision from ${table}`)).rows).toEqual([{ data: newer, revision: 3 }])
      expect((await update(3)).rows).toEqual([{ status: 'updated', revision: 4 }])
      expect((await db.query(`select data, revision from ${table}`)).rows).toEqual([{ data: initialData(), revision: 4 }])
      expect((await write(3, JSON.stringify(newer))).rows).toEqual([{ status: 'conflict', revision: null }])
    } finally {
      await db.exec('rollback; reset role')
    }
  })

  test('v2切り替えで旧書き込みを閉じ、本人の作成・更新と読み取りだけを維持する', async () => {
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

  const day = '2026-11-20' as const
  const time = day + 'T12:00:00.000Z'
  const match = { id: 'match-a', date: day, createdAt: time, updatedAt: time, good: '声かけ', improve: '' }
  const record = { id: 'record-a', date: day, kind: '自主練', menuId: 'swing', menuName: '素振り',
    category: '打撃', unit: '回', amount: 1, note: '', createdAt: time, updatedAt: time }
  const routine = { id: 'plan-a', startsOn: day, items: [{ id: 'item-a', name: '素振り', menuId: 'swing',
    weekdays: [5], schedule: 'weekdays', note: '', condition: '' }] }
  const json = (patch: Record<string, unknown>) => JSON.stringify({ ...initialData(), ...patch })

  test('端末内専用の試合詳細を作成・更新とも拒否し、保存内容とrevisionを維持する', async () => {
    await signIn(parityUser)
    const read = async () => (await db.query(`select data, revision, updated_at from ${table}`)).rows
    const before = await read()
    const details: MatchDetails = { ...emptyMatchDetails(), plateAppearances: [
      { id: 'pa', order: 1, status: 'complete', result: 'double', rbi: 2 },
    ] }
    const snapshot = json({ matches: [match, { ...match, id: 'detail-match', details }] })
    const parsed = JSON.parse(snapshot)
    validateData(parsed)
    expect(() => requireCloudCompatibleMatchData(parsed)).toThrow('端末内専用')
    const versions = ([1, 2, 3] as const).map(version => ({ ...details, version }))
    for (const value of [...versions, null, {}, [], 0, false, '']) {
      const forbidden = json({ matches: [match, { ...match, id: 'detail-match', details: value }] })
      await expect(write(2, forbidden)).rejects.toMatchObject({ code: '22023' })
      expect(await read()).toEqual(before)
    }
    // A new owner has no row. A conflict on an existing row cannot mask acceptance.
    const fresh = '00000000-0000-4000-8000-000000000005'
    await db.exec('reset role')
    await db.query('insert into auth.users values ($1)', [fresh])
    await signIn(fresh)
    for (const value of versions) {
      await expect(write(null, json({ matches: [{ ...match, details: value }] }))).rejects.toMatchObject({ code: '22023' })
      expect(await read()).toEqual([])
    }
    const legacy = decodeBackup(encodeBackup({ ...initialData(), matches: [match] })).data
    expect((await write(null, JSON.stringify(legacy))).rows).toEqual([{ status: 'written', revision: 1 }])
    expect((await write(1, json({ matches: [{ ...match, improve: '次回の目標' }] }))).rows)
      .toEqual([{ status: 'written', revision: 2 }])
    expect((await write(1)).rows).toEqual([{ status: 'conflict', revision: null }])
  })

  const cases: { name: string; accepted: boolean; input: string }[] = [
    { name: 'schemaVersion 3の旧JSONバックアップ', accepted: true, input: JSON.stringify(decodeBackup(JSON.stringify({
      appId: 'aoba-training-log', backupVersion: 1, dataVersion: 3, createdAt: time, data: initialData(),
    })).data) },
    { name: 'matches欠落', accepted: true, input: json({ records: [record] }) },
    { name: 'matches空配列', accepted: true, input: json({ matches: [] }) },
    { name: '孤立した振り返り', accepted: true, input: json({ matches: [{ ...match, recordId: 'deleted-record' }] }) },
    { name: '未知項目を内外に保持', accepted: true, input: json({ matches: [{ ...match, future: { value: 1 } }], future: [true] }) },
    { name: '同日の複数試合', accepted: true, input: json({ matches: [match, { ...match, id: 'match-b', improve: '送球' }] }) },
    { name: '西暦0000のISO時刻', accepted: true, input: json({ matches: [{ ...match, updatedAt: '0000-02-29T00:00:00.000Z' }] }) },
    { name: 'JSON読取時に最大安全整数へ丸められる数量', accepted: true,
      input: json({ records: [record] }).replace('"amount":1', '"amount":9007199254740991.1') },
    { name: '存在しない試合日', accepted: false, input: json({ matches: [{ ...match, date: '2026-02-30' }] }) },
    { name: '存在しないISO時刻', accepted: false, input: json({ matches: [{ ...match, updatedAt: day + 'T24:00:00.000Z' }] }) },
    { name: '必須配列の欠落', accepted: false, input: json({ records: undefined }) },
    { name: '試合の必須項目欠落', accepted: false, input: json({ matches: [{ ...match, good: undefined }] }) },
    { name: 'matchesがnull', accepted: false, input: json({ matches: null }) },
    { name: '空白だけのID', accepted: false, input: json({ matches: [{ ...match, id: '\u00a0' }] }) },
    { name: '試合IDの重複', accepted: false, input: json({ matches: [match, match] }) },
    { name: '紐づけ記録IDの重複', accepted: false, input: json({ matches: [{ ...match, recordId: 'a' }, { ...match, id: 'b', recordId: 'a' }] }) },
    { name: '記録のメニュー参照が存在しない', accepted: false, input: json({ records: [{ ...record, menuId: 'missing' }] }) },
    { name: '曜日別計画のメニュー参照が存在しない', accepted: false, input: json({
      routineVersions: [{ ...routine, items: [{ ...routine.items[0], menuId: 'missing' }] }],
    }) },
    { name: '完了チェックの計画参照が存在しない', accepted: false, input: json({
      routineVersions: [routine], routineCompletions: [{ date: day, itemId: 'missing' }],
    }) },
    { name: '未知のschemaVersion', accepted: false, input: json({ schemaVersion: 4 }) },
    { name: '安全整数を超える数量', accepted: false, input: json({ records: [{ ...record, amount: Number.MAX_SAFE_INTEGER + 1 }] }) },
  ]

  test.each(cases)('共通JSON: $name', async ({ accepted, input }) => {
    await signIn(parityUser)
    const read = () => db.query<{ data: unknown; revision: number }>(`select data, revision from ${table}`)
    const [before] = (await read()).rows
    const parsed: unknown = JSON.parse(input)
    if (accepted) {
      expect(() => validateData(parsed)).not.toThrow()
      expect((await write(before.revision, input)).rows).toEqual([{ status: 'written', revision: before.revision + 1 }])
      const [stored] = (await read()).rows
      expect(stored).toEqual({ data: parsed, revision: before.revision + 1 })
      expect(() => validateData(stored.data)).not.toThrow()
    } else {
      expect(() => validateData(parsed)).toThrow()
      await expect(write(before.revision, input)).rejects.toMatchObject({ code: expect.stringMatching(/^(22023|23514)$/) })
      expect((await read()).rows).toEqual([before])
    }
  })

  test.each([
    { revision: null, result: 'conflict' },
    { revision: 1, result: 'conflict' },
    { revision: -1, result: 'denied' },
    { revision: 0, result: 'denied' },
    { revision: Number.MAX_SAFE_INTEGER, result: 'denied' },
  ])('revisionの入力境界: $revision', async ({ revision, result }) => {
    await signIn(parityUser)
    validateData(JSON.parse(data))
    const read = () => db.query(`select data, revision from ${table}`)
    const before = (await read()).rows
    if (result === 'conflict') {
      expect((await write(revision)).rows).toEqual([{ status: 'conflict', revision: null }])
    } else {
      await expect(write(revision)).rejects.toMatchObject({ code: '22023' })
    }
    expect((await read()).rows).toEqual(before)
  })
})

