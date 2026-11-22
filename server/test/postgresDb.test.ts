// @vitest-environment node
// اختبار المحوّل بعميل بديل يحاكي واجهة postgres.js (begin/unsafe/end): تسلسل العبارات، الدور، الربط، تحويل الأخطاء، التمثيل. **ليس PostgreSQL.**
import { describe, it, expect } from 'vitest'
import { createPostgresDb } from '../db/postgresDb'
import type { PgPool, PgTx } from '../db/postgresDb'
import { DbError } from '../db/types'

function fakePool(handler: (q: string) => unknown[] | Error = () => []) {
  const log: string[] = []; let committed = 0, rolled = 0, ended: unknown = null
  const pool: PgPool = {
    async begin(fn) {
      const tx: PgTx = { unsafe: async (q) => { log.push(q); const r = handler(q); if (r instanceof Error) throw r; return r as Record<string, unknown>[] } }
      try { const r = await fn(tx); committed++; return r } catch (e) { rolled++; throw e }
    },
    async end(o) { ended = o ?? {} },
  }
  return { pool, log, get committed() { return committed }, get rolled() { return rolled }, get ended() { return ended } }
}
const pgErr = (code: string, message = 'boom') => Object.assign(new Error(message), { code })

describe('createPostgresDb', () => {
  it('كل معاملة تبدأ بـset local role service_role قبل أي استعلام', async () => {
    const f = fakePool(); const db = createPostgresDb(f.pool)
    await db.transaction((c) => c.exec('update public.t set a = $1', ['x']))
    expect(f.log[0]).toBe('set local role service_role'); expect(f.log[1]).toBe(`update public.t set a = 'x'`); expect(f.committed).toBe(1)
  })
  it('الدور قابل للضبط ويُتحقَّق منه (حقن مرفوض)', () => {
    expect(() => createPostgresDb(fakePool().pool, { role: 'service_role; drop table x' })).toThrow()
    expect(() => createPostgresDb(fakePool().pool, { role: 'Bad' })).toThrow()
    expect(() => createPostgresDb(fakePool().pool, { role: 'athar_api' })).not.toThrow()
  })
  it('query: تغليف jsonb_agg(to_jsonb) وربط literal مُهرَّب، وتُعاد الصفوف كما هي', async () => {
    const f = fakePool((q) => (q.startsWith('with __q') ? [{ rows: [{ id: 1, at: '2026-10-24T08:00:00+00:00' }] }] : []))
    const rows = await createPostgresDb(f.pool).transaction((c) => c.query<{ id: number; at: string }>(`select id, at from public.t where name = $1 and n = $2`, ["o'brien", 5]))
    expect(rows).toEqual([{ id: 1, at: '2026-10-24T08:00:00+00:00' }])
    expect(f.log[1]).toBe(`with __q as (select id, at from public.t where name = 'o''brien' and n = 5) select coalesce(jsonb_agg(to_jsonb(__q)), '[]'::jsonb) as rows from __q`)
  })
  it('jsonb قد يصل نصًا فيُحلَّل؛ وشكل غير متوقع ⇒ DbError XX000', async () => {
    const asText = fakePool(() => [{ rows: '[{"a":1}]' }])
    expect(await createPostgresDb(asText.pool).transaction((c) => c.query('select 1'))).toEqual([{ a: 1 }])
    const bad = fakePool(() => [{ rows: 'not-json-array' }])
    let code = ''
    try { await createPostgresDb(bad.pool).transaction((c) => c.query('select 1')) } catch (e) { code = e instanceof DbError ? e.sqlstate : (e as Error).name }
    expect(['XX000', 'SyntaxError']).toContain(code)
    const none = fakePool(() => [])
    code = ''
    try { await createPostgresDb(none.pool).transaction((c) => c.query('select 1')) } catch (e) { code = (e as DbError).sqlstate }
    expect(code).toBe('XX000')
  })
  it('أخطاء PostgreSQL بـSQLSTATE تصير DbError، وتتراجع المعاملة', async () => {
    const f = fakePool((q) => (q.startsWith('insert') ? pgErr('23505', 'duplicate key') : []))
    let err: unknown
    try { await createPostgresDb(f.pool).transaction((c) => c.exec('insert into public.t values ($1)', [1])) } catch (e) { err = e }
    expect(err instanceof DbError && err.sqlstate).toBe('23505'); expect(f.rolled).toBe(1); expect(f.committed).toBe(0)
  })
  it('خطأ استعلام داخل fn (query) يصل بـsqlstate أيضًا؛ وأخطاء غير SQLSTATE تمرّ كما هي', async () => {
    const f = fakePool((q) => (q.startsWith('with __q') ? pgErr('42501', 'permission denied') : []))
    let st = ''
    try { await createPostgresDb(f.pool).transaction((c) => c.query('select * from public.secret')) } catch (e) { st = (e as DbError).sqlstate }
    expect(st).toBe('42501')
    const net = fakePool(() => Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }))
    let e2: unknown
    try { await createPostgresDb(net.pool).transaction((c) => c.exec('select 1')) } catch (e) { e2 = e }
    expect(e2 instanceof DbError).toBe(false); expect((e2 as Error).message).toContain('ECONNREFUSED')
  })
  it('استثناء fn غير قاعدي يتراجع ويُعاد رميه كما هو', async () => {
    const f = fakePool(); let msg = ''
    try { await createPostgresDb(f.pool).transaction(async () => { throw new Error('app-level') }) } catch (e) { msg = (e as Error).message }
    expect([msg, f.rolled]).toEqual(['app-level', 1])
  })
  it('NUL في معامل يُرفض قبل الإرسال؛ ومعاملات غير مستعملة تُرفض', async () => {
    const f = fakePool(); const db = createPostgresDb(f.pool)
    let a = false, b = false
    try { await db.transaction((c) => c.exec('select $1', ['a\0b'])) } catch { a = true }
    try { await db.transaction((c) => c.exec('select 1', ['x'])) } catch { b = true }
    expect([a, b]).toEqual([true, true]); expect(f.log.filter((q) => q.startsWith('select')).length).toBe(0)
  })
  it('close ينهي المجمّع بمهلة', async () => {
    const f = fakePool(); await createPostgresDb(f.pool).close(); expect(f.ended).toEqual({ timeout: 5 })
  })
})
