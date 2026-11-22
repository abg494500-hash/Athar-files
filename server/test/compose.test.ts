// @vitest-environment node
// اختبار التركيب بإعدادات وهمية صريحة (قيم اختبار لا أسرار حقيقية) وقاعدة بديلة لا تُستدعى. لا شبكة.
import { describe, it, expect } from 'vitest'
import { composeApi, ComposeError } from '../api/compose'
import type { ServerEnv } from '../api/compose'
import type { Db } from '../db/types'

const db: Db = { async transaction() { throw new Error('db should not be touched') }, async close() {} }
const GOOD: ServerEnv = {
  SUPABASE_URL: 'https://proj.example.co', SUPABASE_ANON_KEY: 'anon-test-placeholder',
  R2_ACCOUNT_ID: 'a'.repeat(32), R2_BUCKET: 'athar-private', R2_ACCESS_KEY_ID: 'AKIA-TEST-ONLY', R2_SECRET_ACCESS_KEY: 'secret-test-only-123456',
  TEACHER_CODE_PEPPER: 'c'.repeat(40), TEACHER_IP_PEPPER: 'i'.repeat(40), ALLOWED_ORIGIN: 'https://athar.example',
}
const why = (e: ServerEnv): string => { try { composeApi(e, db) } catch (x) { return x instanceof ComposeError ? x.message : 'other:' + String(x) } return '' }

describe('composeApi', () => {
  it('إعداد سليم ⇒ معالج يرفض غير المصادَق عليهم دون لمس القاعدة', async () => {
    const h = composeApi(GOOD, db)
    const t = await h({ method: 'GET', path: '/teacher/me', headers: {}, body: null })
    const o = await h({ method: 'POST', path: '/owner/archives/download', headers: { 'content-type': 'application/json' }, body: '{}' })
    expect([t.status, o.status]).toEqual([401, 401])
  })
  it('أي إعداد ناقص يُسمّى باسمه فقط دون قيمة', () => {
    for (const k of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'R2_ACCOUNT_ID', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'TEACHER_CODE_PEPPER'] as const) {
      const e = { ...GOOD }; delete e[k]
      const m = why(e); expect(m).not.toBe(''); expect(m).not.toContain('secret-test-only'); expect(m).not.toContain('c'.repeat(40))
    }
  })
  it('أسرار الخلط: قصيرة أو متطابقة ⇒ رفض', () => {
    expect(why({ ...GOOD, TEACHER_IP_PEPPER: 'short' })).toContain('TEACHER_IP_PEPPER')
    expect(why({ ...GOOD, TEACHER_IP_PEPPER: GOOD.TEACHER_CODE_PEPPER })).toContain('يختلف')
  })
  it('أصل CORS: https بلا مسار فقط؛ والحد صحيح موجب', () => {
    for (const o of ['http://athar.example', 'https://athar.example/path', 'athar', 'https://athar.example/']) expect(why({ ...GOOD, ALLOWED_ORIGIN: o })).toContain('ALLOWED_ORIGIN')
    for (const n of ['0', '-5', '1.5', 'abc']) expect(why({ ...GOOD, MAX_OBJECT_BYTES: n })).toContain('MAX_OBJECT_BYTES')
    expect(why({ ...GOOD, MAX_OBJECT_BYTES: '50000000' })).toBe('')
    expect(why({ ...GOOD })).toBe('') // الافتراضي 30MB لا يعطّل التركيب
  })
  it('حساب R2 أو حاوية معيبة ⇒ رفض دون تسريب القيمة', () => {
    expect(why({ ...GOOD, R2_ACCOUNT_ID: 'zzz' })).toContain('R2_')
    expect(why({ ...GOOD, R2_BUCKET: 'BAD_NAME' })).toContain('R2_')
  })
})

describe('PgAuditSink والتدقيق الدائم في التركيب', () => {
  it('يكتب أحداث الموظفات فقط عبر log_audit_as بمعاملات مقيّدة', async () => {
    const { PgAuditSink } = await import('../api/auditSink')
    const stmts: { sql: string; params: unknown[] }[] = []
    const rec: Db = { async transaction(fn) { return fn({ query: async () => [] as never, exec: async (sql: string, params: unknown[] = []) => { stmts.push({ sql, params }) } }) }, async close() {} }
    const sink = new PgAuditSink(rec)
    const OWN = '11111111-1111-1111-1111-111111111111'
    await sink.record({ at: 't', actor: { kind: 'owner', id: OWN }, action: 'owner.create_archive', outcome: 'ok', target: 'x' })
    await sink.record({ at: 't', actor: { kind: 'director', id: OWN }, action: '/owner/uploads/release', outcome: 'denied' })
    await sink.record({ at: 't', actor: { kind: 'anonymous', id: null }, action: 'a', outcome: 'denied' })
    await sink.record({ at: 't', actor: { kind: 'teacher', id: OWN }, action: 'teacher.login', outcome: 'ok' })
    await sink.record({ at: 't', actor: { kind: 'owner', id: 'not-a-uuid' }, action: 'a', outcome: 'ok' })
    expect(stmts.length).toBe(2)
    expect(stmts[0]!.sql).toContain('public.log_audit_as'); expect(stmts[0]!.params.slice(0, 4)).toEqual([OWN, 'owner.create_archive', 'term', 'x'])
    expect(stmts[1]!.params[2]).toBeNull()
  })
  it('فشل كتابة التدقيق في التركيب ⇒ 500 audit_failed قبل تنفيذ إصدار الكود', async () => {
    const boom: Db = { async transaction() { throw new Error('db down') }, async close() {} }
    const jwt = 'aaaaaaaaaa.bbbbbbbbbb.cccccccccc'
    const f = (async (url: string) => (url.includes('/auth/v1/user') ? new Response(JSON.stringify({ id: '11111111-1111-1111-1111-111111111111' }), { status: 200 }) : new Response('{}', { status: 500 }))) as unknown as typeof fetch
    // التحقق من الدور يمرّ على القاعدة أيضًا؛ نجعلها تعيد دور owner للاستعلام الأول ثم تفشل للكتابة.
    let n = 0
    const db2: Db = { async transaction(fn) { n++; if (n === 1) return fn({ query: async () => [{ role: 'owner' }] as never, exec: async () => {} }); throw new Error('db down') }, async close() {} }
    void boom
    const h = composeApi(GOOD, db2, { fetchImpl: f })
    const r = await h({ method: 'POST', path: '/staff/teachers/issue-credentials', headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: JSON.stringify({ teacherId: '00000000-0000-0000-0000-000000000001' }) })
    expect([r.status, JSON.parse(r.body)]).toEqual([500, { error: 'audit_failed' }])
    expect(n).toBe(2) // التحقق من الدور ثم محاولة التدقيق؛ لا ثالثة (لم تُلمس بيانات الاعتماد)
  })
})
