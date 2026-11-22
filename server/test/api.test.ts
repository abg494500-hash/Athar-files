// @vitest-environment node
// اختبار طبقة HTTP ببدائل للخدمات (UploadPort/TeacherAuthPort/StaffVerifier بدائل في الذاكرة) — **ليس** اختبار قاعدة ولا شبكة.
// ما يُثبته: استخراج الهوية من الجلسة وحدها، تفويض الدور خادميًا، رفض المدخلات المشوّهة، حجب مفاتيح التخزين، عدم تسرّب الأسرار.
import { describe, it, expect } from 'vitest'
import { createApiHandler } from '../api/handler'
import type { ApiDeps, ApiRequest, AuditEvent, TeacherAuthPort, UploadPort } from '../api/handler'
import { SupabaseStaffVerifier } from '../api/staffVerifier'
import type { StaffVerifier } from '../api/staffVerifier'
import { AuthError } from '../auth/teacherAuth'
import { ServiceError } from '../services/errors'
import { DbError } from '../db/types'
import type { Db } from '../db/types'

const T1 = '00000000-0000-0000-0000-000000000001'
const TERM = '00000000-0000-0000-0000-0000000000a1'
const SESS = '00000000-0000-0000-0000-0000000000b1'
const OWNER = '11111111-1111-1111-1111-111111111111'
const DIRECTOR = '22222222-2222-2222-2222-222222222222'
const TOKEN = 'T'.repeat(43)

interface Calls { start: unknown[]; complete: unknown[]; release: unknown[]; issue: unknown[]; overview: unknown[] }
function setup(over: Partial<ApiDeps> = {}) {
  const calls: Calls = { start: [], complete: [], release: [], issue: [], overview: [] }
  const audits: AuditEvent[] = []
  const teacherAuth: TeacherAuthPort = {
    async login(i) { if (i.code === 'SA-12') return { token: TOKEN, expiresAt: new Date('2026-10-24T00:00:00Z'), teacher: { id: T1, name: 'معلمة' } }; throw new AuthError('login_failed') },
    async authenticate(t) { if (t === TOKEN) return { teacherId: T1, name: 'معلمة' }; throw new AuthError('unauthenticated') },
    async logout() {},
    async issueCredentials(id, o) { calls.issue.push([id, o]); if (id === '00000000-0000-0000-0000-00000000dead') throw new DbError('23503', 'fk'); return { code: 'SA-12' } },
    async revokeCredentials() {},
    async removeTeacher(id) { if (id === '00000000-0000-0000-0000-00000000dead') throw new DbError('P0002', 'nf'); if (id === '00000000-0000-0000-0000-00000000beef') throw new DbError('23514', 'na'); return { versions: 2 } },
  }
  const uploads: UploadPort = {
    async start(i) { calls.start.push(i); return { sessionId: SESS, state: 'started', pendingKey: 'pending/secret-key', declaredName: i.name } },
    async complete(s, t) { calls.complete.push([s, t]); return { session: { sessionId: s, pendingKey: 'pending/k' }, version: { no: 1, storageKey: 'final/secret', sha256: 'a'.repeat(64) } } },
    async cancel() { return { sessionId: SESS, state: 'cancelled', pendingKey: 'p' } },
    async saveLink() { return { version: { no: 2, kind: 'link', storageKey: null, url: 'https://x.example' }, reused: false } },
    async ownerRelease(i) { calls.release.push(i); if (i.note.trim() === '') throw new ServiceError('note_required'); return { sessionId: i.sessionId, state: 'cancelled', pendingKey: 'p' } },
    async sweepExpired() { calls.overview.push('sweep'); return 3 },
    async overview(t) { calls.overview.push(t); if (t === '00000000-0000-0000-0000-00000000dead') throw new ServiceError('not_found'); return { termId: t, sessionsByState: {} } },
  }
  const staff: StaffVerifier = { async verify(t) { return t === 'owner.jwt.token-aaaa' ? { userId: OWNER, role: 'owner' } : t === 'director.jwt.token-bbb' ? { userId: DIRECTOR, role: 'director' } : null } }
  const unexpected: unknown[] = []
  const h = createApiHandler({ teacherAuth, uploads, staff, audit: (e) => { audits.push(e) }, onUnexpected: (e) => unexpected.push(e), ...over })
  return { h, calls, audits, unexpected }
}
const req = (method: string, path: string, o: { token?: string; body?: unknown; ct?: string; query?: Record<string, string>; origin?: string } = {}): ApiRequest => ({
  method, path, ...(o.query ? { query: o.query } : {}),
  headers: { ...(o.token ? { authorization: `Bearer ${o.token}` } : {}), ...(method === 'POST' ? { 'content-type': o.ct ?? 'application/json' } : {}), ...(o.origin ? { origin: o.origin } : {}) },
  body: method === 'POST' ? (typeof o.body === 'string' ? o.body : JSON.stringify(o.body ?? {})) : null, ip: '203.0.113.9',
})
const j = (r: { body: string }) => JSON.parse(r.body || 'null')

describe('API — دخول المعلمة', () => {
  it('نجاح: يعيد الرمز والاسم؛ فشل: 401 برمز واحد login_failed دون تفصيل', async () => {
    const { h } = setup()
    const ok = await h(req('POST', '/teacher/login', { body: { code: 'SA-12' } }))
    expect(ok.status).toBe(200); expect(j(ok).token).toBe(TOKEN)
    for (const body of [{ code: 'ZZ-99' }, { code: 'SA-13' }, {}]) {
      const r = await h(req('POST', '/teacher/login', { body }))
      expect(r.status).toBe(401); expect(j(r)).toEqual({ error: 'login_failed' })
    }
  })
  it('كل الردود no-store وnosniff', async () => {
    const { h } = setup()
    const r = await h(req('POST', '/teacher/login', { body: { code: 'SA-12' } }))
    expect(r.headers['cache-control']).toBe('no-store'); expect(r.headers['x-content-type-options']).toBe('nosniff')
  })
  it('الخروج بلا رمز صالح 204 دون كشف', async () => {
    const { h } = setup()
    expect((await h(req('POST', '/teacher/logout'))).status).toBe(204)
  })
})

describe('API — الهوية من الجلسة وحدها', () => {
  it('بلا رمز أو برمز خاطئ ⇒ 401 ولا تُستدعى الخدمة', async () => {
    const { h, calls } = setup()
    for (const token of [undefined, 'x'.repeat(43), 'short']) {
      const r = await h(req('POST', '/teacher/uploads/start', { ...(token ? { token } : {}), body: { termId: TERM, slotId: 's1', name: 'a.pdf', size: 10, idempotencyKey: 'k' } }))
      expect(r.status).toBe(401)
    }
    expect(calls.start.length).toBe(0)
  })
  it('teacherId المُرسَل في الجسم يُتجاهل: تُستعمل هوية الجلسة', async () => {
    const { h, calls } = setup()
    const r = await h(req('POST', '/teacher/uploads/start', { token: TOKEN, body: { teacherId: '00000000-0000-0000-0000-000000000002', termId: TERM, slotId: 's1', name: 'a.pdf', size: 10, idempotencyKey: 'k' } }))
    expect(r.status).toBe(200)
    expect((calls.start[0] as { teacherId: string }).teacherId).toBe(T1)
    const c = await h(req('POST', '/teacher/uploads/complete', { token: TOKEN, body: { teacherId: 'other', sessionId: SESS } }))
    expect(c.status).toBe(200); expect((calls.complete[0] as string[])[1]).toBe(T1)
  })
  it('لا مفتاح تخزين ولا مفتاح معلّق في ردود المعلمة افتراضيًا', async () => {
    const { h } = setup()
    const s = await h(req('POST', '/teacher/uploads/start', { token: TOKEN, body: { termId: TERM, slotId: 's1', name: 'a.pdf', size: 10, idempotencyKey: 'k' } }))
    const c = await h(req('POST', '/teacher/uploads/complete', { token: TOKEN, body: { sessionId: SESS } }))
    const l = await h(req('POST', '/teacher/links', { token: TOKEN, body: { termId: TERM, slotId: 's1', url: 'https://x.example' } }))
    for (const r of [s, c, l]) { expect(r.body).not.toMatch(/secret|pendingKey|storageKey|pending\//); expect(r.status).toBe(200) }
  })
  it('exposePendingKey=true يُظهر pendingKey فقط (ولا storageKey أبدًا)', async () => {
    const { h } = setup({ exposePendingKey: true })
    const s = await h(req('POST', '/teacher/uploads/start', { token: TOKEN, body: { termId: TERM, slotId: 's1', name: 'a.pdf', size: 10, idempotencyKey: 'k' } }))
    expect(j(s).session.pendingKey).toBe('pending/secret-key')
    const c = await h(req('POST', '/teacher/uploads/complete', { token: TOKEN, body: { sessionId: SESS } }))
    expect(c.body).not.toContain('storageKey')
  })
})

describe('API — تفويض المالكة والمديرة خادميًا', () => {
  const issue = { teacherId: T1 }
  it('بلا رمز أو برمز غير معروف ⇒ 401 وتدقيق denied', async () => {
    const { h, calls, audits } = setup()
    expect((await h(req('POST', '/staff/teachers/issue-credentials', { body: issue }))).status).toBe(401)
    expect((await h(req('POST', '/staff/teachers/issue-credentials', { token: 'zzzz.zzzz.zzzzzzzz', body: issue }))).status).toBe(401)
    expect(calls.issue.length).toBe(0); expect(audits.every((a) => a.outcome === 'denied')).toBe(true)
  })
  it('المديرة تُرفض في مسارات المالكة (403) وتُقبل في overview', async () => {
    const { h, calls } = setup()
    const D = 'director.jwt.token-bbb'
    for (const [p, b] of [['/owner/teachers/remove', issue], ['/owner/uploads/release', { sessionId: SESS, note: 'x' }]] as const) {
      expect((await h(req('POST', p, { token: D, body: b }))).status).toBe(403)
    }
    expect(calls.issue.length + calls.release.length).toBe(0)
    // r37 (A-123): المديرة تسجّل المعلمات وتصدر الرموز عبر مسارات /staff
    expect((await h(req('POST', '/staff/teachers/issue-credentials', { token: D, body: issue }))).status).toBe(200)
    expect(calls.issue.length).toBe(1)
    expect((await h(req('GET', '/staff/overview', { token: D, query: { termId: TERM } }))).status).toBe(200)
  })
  it('رمز معلمة لا يفتح مسارات المالكة، ورمز مالكة لا يفتح مسارات المعلمة', async () => {
    const { h } = setup()
    expect((await h(req('POST', '/staff/teachers/issue-credentials', { token: TOKEN, body: issue }))).status).toBe(401)
    expect((await h(req('GET', '/teacher/me', { token: 'owner.jwt.token-aaaa' }))).status).toBe(401)
  })
  it('المالكة: إصدار الكود يعيد الكود وحده مرة واحدة، ويُدقَّق دون تسريبهما', async () => {
    const { h, audits } = setup()
    const r = await h(req('POST', '/staff/teachers/issue-credentials', { token: 'owner.jwt.token-aaaa', body: issue }))
    expect(r.status).toBe(200); expect(j(r)).toEqual({ code: 'SA-12' })
    expect(JSON.stringify(audits)).not.toMatch(/SA-12|SA12/)
    const { at: _a, ...a0 } = audits[0]!
    void _a
    expect(a0).toEqual({ actor: { kind: 'owner', id: OWNER }, action: 'owner.issue_credentials', outcome: 'ok', target: T1 })
  })
  it('معلمة غير موجودة ⇒ 404؛ انتهاء ماضٍ ⇒ 400', async () => {
    const { h } = setup()
    const O = 'owner.jwt.token-aaaa'
    expect((await h(req('POST', '/staff/teachers/issue-credentials', { token: O, body: { teacherId: '00000000-0000-0000-0000-00000000dead' } }))).status).toBe(404)
    expect((await h(req('POST', '/staff/teachers/issue-credentials', { token: O, body: { teacherId: T1, codeExpiresAt: '2020-01-01T00:00:00Z' } }))).status).toBe(400)
  })
  it('إفراج المالكة: ملاحظة إلزامية (400) وتدقيق عند النجاح', async () => {
    const { h, calls, audits } = setup()
    const O = 'owner.jwt.token-aaaa'
    expect((await h(req('POST', '/owner/uploads/release', { token: O, body: { sessionId: SESS, note: '  ' } }))).status).toBe(400)
    const ok = await h(req('POST', '/owner/uploads/release', { token: O, body: { sessionId: SESS, note: 'عطل المنصة', platformFault: true } }))
    expect(ok.status).toBe(200)
    // المنفِّذة تُمرَّر للخدمة (تُسجَّل في audit_log داخل معاملة الإفراج)، والمعالج لا يسجّل مرتين
    expect((calls.release[0] as { actorUserId: string }).actorUserId).toBe(OWNER)
    expect(audits.some((a) => a.action === 'owner.release_session')).toBe(false)
  })
  it('platformFault غير منطقية ⇒ 400', async () => {
    const { h } = setup()
    expect((await h(req('POST', '/owner/uploads/release', { token: 'owner.jwt.token-aaaa', body: { sessionId: SESS, note: 'x', platformFault: 'true' } }))).status).toBe(400)
  })
  it('overview: termId مشوّه 400، غير موجود 404', async () => {
    const { h } = setup()
    const O = 'owner.jwt.token-aaaa'
    expect((await h(req('GET', '/staff/overview', { token: O, query: { termId: 'abc' } }))).status).toBe(400)
    expect((await h(req('GET', '/staff/overview', { token: O }))).status).toBe(400)
    expect((await h(req('GET', '/staff/overview', { token: O, query: { termId: '00000000-0000-0000-0000-00000000dead' } }))).status).toBe(404)
  })
})

describe('API — صلابة المدخلات والأخطاء', () => {
  it('نوع محتوى خطأ 415، جسم كبير 413، JSON معطوب أو غير كائن 400', async () => {
    const { h } = setup()
    const base = { token: TOKEN }
    expect((await h(req('POST', '/teacher/uploads/cancel', { ...base, ct: 'text/plain', body: '{}' }))).status).toBe(415)
    expect((await h(req('POST', '/teacher/uploads/cancel', { ...base, body: JSON.stringify({ x: 'a'.repeat(20000) }) }))).status).toBe(413)
    expect((await h(req('POST', '/teacher/uploads/cancel', { ...base, body: '{oops' }))).status).toBe(400)
    expect((await h(req('POST', '/teacher/uploads/cancel', { ...base, body: '[1]' }))).status).toBe(400)
  })
  it('مسار مجهول 404، وأسلوب خطأ 405 مع allow', async () => {
    const { h } = setup()
    expect((await h(req('GET', '/nope'))).status).toBe(404)
    const r = await h(req('GET', '/teacher/login'))
    expect(r.status).toBe(405); expect(r.headers.allow).toBe('POST')
  })
  it('أخطاء الخدمة تُترجم بالرمز؛ verification_pending = 202', async () => {
    const mk = (code: ConstructorParameters<typeof ServiceError>[0]) => setup({ uploads: { start: async () => { throw new ServiceError(code) } } as unknown as UploadPort })
    for (const [code, st] of [['active_session_exists', 409], ['not_found', 404], ['bad_request', 400], ['verification_pending', 202]] as const) {
      const { h } = mk(code)
      const r = await h(req('POST', '/teacher/uploads/start', { token: TOKEN, body: { termId: TERM, slotId: 's1', name: 'a', size: 1, idempotencyKey: 'k' } }))
      expect(r.status).toBe(st); expect(j(r)).toEqual({ error: code })
    }
  })
  it('خطأ غير متوقع ⇒ 500 عامة بلا تفاصيل، ويُبلَّغ onUnexpected', async () => {
    const { h, unexpected } = setup({ uploads: { start: async () => { throw new Error('connection string postgres://secret@host') } } as unknown as UploadPort })
    const r = await h(req('POST', '/teacher/uploads/start', { token: TOKEN, body: { termId: TERM, slotId: 's1', name: 'a', size: 1, idempotencyKey: 'k' } }))
    expect(r.status).toBe(500); expect(r.body).toBe('{"error":"internal_error"}'); expect(unexpected.length).toBe(1)
  })
  it('CORS: أصل مطابق فقط يحصل على الترويسة؛ preflight لأصل غريب 404', async () => {
    const { h } = setup({ allowedOrigin: 'https://athar.example' })
    const good = await h(req('GET', '/teacher/me', { token: TOKEN, origin: 'https://athar.example' }))
    expect(good.headers['access-control-allow-origin']).toBe('https://athar.example')
    const bad = await h(req('GET', '/teacher/me', { token: TOKEN, origin: 'https://evil.example' }))
    expect(bad.headers['access-control-allow-origin']).toBeUndefined()
    const pre = await h({ method: 'OPTIONS', path: '/teacher/login', headers: { origin: 'https://evil.example' }, body: null })
    expect(pre.status).toBe(404)
    const pre2 = await h({ method: 'OPTIONS', path: '/teacher/login', headers: { origin: 'https://athar.example' }, body: null })
    expect(pre2.status).toBe(204)
  })
})

describe('SupabaseStaffVerifier (fetch وقاعدة بديلان — لا Supabase حقيقي)', () => {
  const JWT = 'aaaaaaaaaa.bbbbbbbbbb.cccccccccc'
  const mkDb = (rows: { role: string }[], boom = false): Db => ({ async transaction(fn) { if (boom) throw new Error('db'); return fn({ query: async () => rows as never, exec: async () => {} }) }, async close() {} })
  const mkFetch = (status: number, body: unknown): typeof fetch => (async () => new Response(JSON.stringify(body), { status })) as typeof fetch
  const mk = (f: typeof fetch, db: Db) => new SupabaseStaffVerifier({ supabaseUrl: 'https://proj.example.co', anonKey: 'anon-key-placeholder', db, fetchImpl: f })
  it('نجاح: مستخدمة صالحة بصف نشط owner/director', async () => {
    expect(await mk(mkFetch(200, { id: OWNER }), mkDb([{ role: 'owner' }])).verify(JWT)).toEqual({ userId: OWNER, role: 'owner' })
    expect((await mk(mkFetch(200, { id: DIRECTOR }), mkDb([{ role: 'director' }])).verify(JWT))?.role).toBe('director')
  })
  it('فشل مغلق: لا صف، دور غريب، رد غير 200، id معطوب، خطأ شبكة/قاعدة، شكل رمز غريب', async () => {
    expect(await mk(mkFetch(200, { id: OWNER }), mkDb([])).verify(JWT)).toBeNull()
    expect(await mk(mkFetch(200, { id: OWNER }), mkDb([{ role: 'teacher' }])).verify(JWT)).toBeNull()
    expect(await mk(mkFetch(200, { id: OWNER }), mkDb([{ role: 'owner' }, { role: 'owner' }])).verify(JWT)).toBeNull()
    expect(await mk(mkFetch(401, {}), mkDb([{ role: 'owner' }])).verify(JWT)).toBeNull()
    expect(await mk(mkFetch(401, { id: OWNER }), mkDb([{ role: 'owner' }])).verify(JWT)).toBeNull() // حتى لو حمل الرد معرّفًا صالحًا
    expect(await mk(mkFetch(200, { id: 'nope' }), mkDb([{ role: 'owner' }])).verify(JWT)).toBeNull()
    expect(await mk((async () => { throw new Error('net') }) as typeof fetch, mkDb([{ role: 'owner' }])).verify(JWT)).toBeNull()
    expect(await mk(mkFetch(200, { id: OWNER }), mkDb([], true)).verify(JWT)).toBeNull()
    expect(await mk(mkFetch(200, { id: OWNER }), mkDb([{ role: 'owner' }])).verify('not a jwt')).toBeNull()
  })
  it('يرسل الرمز وapikey إلى /auth/v1/user فقط ويرفض عنوانًا غير آمن', async () => {
    let seen: { url: string; headers: Record<string, string> } | null = null
    const f = (async (u: string, init: RequestInit) => { seen = { url: u, headers: init.headers as Record<string, string> }; return new Response(JSON.stringify({ id: OWNER }), { status: 200 }) }) as unknown as typeof fetch
    await mk(f, mkDb([{ role: 'owner' }])).verify(JWT)
    expect(seen!.url).toBe('https://proj.example.co/auth/v1/user'); expect(seen!.headers.authorization).toBe(`Bearer ${JWT}`)
    expect(() => new SupabaseStaffVerifier({ supabaseUrl: 'http://evil.example', anonKey: 'anon-key-placeholder', db: mkDb([]) })).toThrow()
  })
})

describe('API — صيانة الجلسات المنقضية', () => {
  it('المالكة فقط؛ المديرة 403؛ المجهول 401؛ ويُدقَّق قبل التنفيذ', async () => {
    const { h, calls, audits } = setup()
    expect((await h(req('POST', '/owner/maintenance/sweep', { token: 'director.jwt.token-bbb' }))).status).toBe(403)
    expect((await h(req('POST', '/owner/maintenance/sweep'))).status).toBe(401)
    expect(calls.overview.length).toBe(0)
    const r = await h(req('POST', '/owner/maintenance/sweep', { token: 'owner.jwt.token-aaaa' }))
    expect([r.status, j(r)]).toEqual([200, { expired: 3 }]); expect(audits.some((a) => a.action === 'owner.sweep_expired_sessions')).toBe(true)
  })
})

describe('API — القراءة والنقل والتنزيل (الدفعة 7، خدمات بديلة)', () => {
  const V = '00000000-0000-0000-0000-0000000000c1'
  const mk = () => {
    const seen: unknown[][] = []
    const reads = { portfolio: async (id: string) => { seen.push(['portfolio', id]); return { teacher: { id }, terms: [] } } }
    const transfer = {
      presignUpload: async (s: string, t: string) => { seen.push(['presign', s, t]); return { url: 'https://put.example/x', method: 'PUT', headers: {}, expiresAt: 'x' } },
      authorizeDownload: async (v: string, a: unknown, o?: unknown) => { seen.push(o && Object.keys(o as object).length ? ['dl', v, a, o] : ['dl', v, a]); return { url: 'https://get.example/y', expiresAt: 'x', filename: 'a.pdf' } },
    }
    return { seen, ...setup({ reads, transfer }) }
  }
  it('portfolio بهوية الجلسة وحدها؛ بلا رمز 401', async () => {
    const { h, seen } = mk()
    expect((await h(req('GET', '/teacher/portfolio'))).status).toBe(401)
    const r = await h(req('GET', '/teacher/portfolio', { token: TOKEN, query: { teacherId: 'other' } }))
    expect(r.status).toBe(200); expect(seen).toEqual([['portfolio', T1]])
  })
  it('رابط الرفع وتنزيل المعلمة: الهوية من الجلسة، وتنزيل المعلمة يُدقَّق', async () => {
    const { h, seen, audits } = mk()
    expect((await h(req('POST', '/teacher/uploads/presign', { token: TOKEN, body: { sessionId: SESS, teacherId: 'x' } }))).status).toBe(200)
    expect((await h(req('POST', '/teacher/downloads/sign', { token: TOKEN, body: { versionId: V } }))).status).toBe(200)
    expect(seen[0]).toEqual(['presign', SESS, T1]); expect(seen[1]).toEqual(['dl', V, { kind: 'teacher', teacherId: T1 }])
    expect(audits.some((a) => a.action === 'teacher.download')).toBe(true)
  })
  it('تنزيل الموظفات: المالكة والمديرة تُقبلان بدورهما، والمعلمة/المجهول لا (401)', async () => {
    const { h, seen } = mk()
    expect((await h(req('POST', '/staff/downloads/sign', { token: 'owner.jwt.token-aaaa', body: { versionId: V } }))).status).toBe(200)
    expect((await h(req('POST', '/staff/downloads/sign', { token: 'director.jwt.token-bbb', body: { versionId: V } }))).status).toBe(200)
    expect((await h(req('POST', '/staff/downloads/sign', { token: 'director.jwt.token-bbb', body: { versionId: V, inline: true } }))).status).toBe(200)
    expect(seen.some((x) => x[0] === 'dl' && JSON.stringify(x[3]) === '{"inline":true}')).toBe(true)
    expect((await h(req('POST', '/staff/downloads/sign', { token: TOKEN, body: { versionId: V } }))).status).toBe(401)
    expect(seen.map((s) => (s[2] as { role: string }).role)).toEqual(['owner', 'director', 'director'])
  })
  it('معرّفات مشوّهة 400؛ والخدمات غير المهيّأة 503 not_configured (فشل مغلق)', async () => {
    const { h } = mk()
    expect((await h(req('POST', '/teacher/downloads/sign', { token: TOKEN, body: { versionId: 'abc' } }))).status).toBe(400)
    expect((await h(req('POST', '/teacher/uploads/presign', { token: TOKEN, body: {} }))).status).toBe(400)
    const bare = setup().h
    for (const [m, p] of [['GET', '/teacher/portfolio'], ['POST', '/teacher/uploads/presign'], ['POST', '/teacher/downloads/sign']] as const) {
      const r = await bare(req(m, p, { token: TOKEN, body: { sessionId: SESS, versionId: V } }))
      expect(r.status).toBe(503); expect(j(r)).toEqual({ error: 'not_configured' })
    }
  })
  it('تنزيل غير مملوك ⇒ 404 من الخدمة دون تسريب', async () => {
    const { h } = setup({ transfer: { presignUpload: async () => ({}), authorizeDownload: async () => { throw new ServiceError('not_found') } } })
    const r = await h(req('POST', '/teacher/downloads/sign', { token: TOKEN, body: { versionId: V } }))
    expect([r.status, j(r)]).toEqual([404, { error: 'not_found' }])
  })
})

describe('API — حذف المعلمة بعد الأرشفة (A-114)', () => {
  const O = 'owner.jwt.token-aaaa'
  it('المالكة: 200، والمديرة 403، وبلا جلسة 401', async () => {
    const { h } = setup()
    const ok = await h(req('POST', '/owner/teachers/remove', { token: O, body: { teacherId: T1 } }))
    expect([ok.status, j(ok)]).toEqual([200, { removed: true, versions: 2 }])
    expect((await h(req('POST', '/owner/teachers/remove', { token: 'director.jwt.token-bbb', body: { teacherId: T1 } }))).status).toBe(403)
    expect((await h(req('POST', '/owner/teachers/remove', { body: { teacherId: T1 } }))).status).toBe(401)
  })
  it('غير موجودة 404، وغير مؤرشفة 409 not_archived، ومعرّف سيئ 400', async () => {
    const { h } = setup()
    const nf = await h(req('POST', '/owner/teachers/remove', { token: O, body: { teacherId: '00000000-0000-0000-0000-00000000dead' } }))
    expect([nf.status, j(nf)]).toEqual([404, { error: 'not_found' }])
    const na = await h(req('POST', '/owner/teachers/remove', { token: O, body: { teacherId: '00000000-0000-0000-0000-00000000beef' } }))
    expect([na.status, j(na)]).toEqual([409, { error: 'not_archived' }])
    expect((await h(req('POST', '/owner/teachers/remove', { token: O, body: { teacherId: 'x' } }))).status).toBe(400)
  })
})

describe('API — التدقيق الدائم يسبق الإجراء الحساس (فشل مغلق)', () => {
  const O = 'owner.jwt.token-aaaa'
  it('فشل كتابة التدقيق ⇒ 500 audit_failed ولا تنفيذ (إصدار كود، تنزيل موظفة، أرشيف)', async () => {
    let executed = 0
    const { h } = setup({
      audit: async () => { throw new Error('db down') },
      transfer: { presignUpload: async () => ({}), authorizeDownload: async () => { executed++; return {} } },
      archives: { listLegacy: async () => [], authorizeDownload: async () => { executed++; return {} }, confirmDownload: async () => { executed++; return {} } },
    } as never)
    const V = '00000000-0000-0000-0000-0000000000c1'
    const cases: [string, unknown][] = [['/staff/teachers/issue-credentials', { teacherId: T1 }], ['/staff/teachers/revoke-credentials', { teacherId: T1 }], ['/staff/downloads/sign', { versionId: V }],
      ['/owner/archives/download', { archiveId: V }]]
    for (const [p, b] of cases) { const r = await h(req('POST', p, { token: O, body: b })); expect([p, r.status, j(r)]).toEqual([p, 500, { error: 'audit_failed' }]) }
    expect(executed).toBe(0)
  })
  it('تدقيق غير متزامن ناجح يُنتظر قبل الإجراء (الترتيب: تدقيق ثم تنفيذ)', async () => {
    const order: string[] = []
    const { h } = setup({ audit: async (e) => { await Promise.resolve(); order.push('audit:' + e.action) }, archives: { listLegacy: async () => [], authorizeDownload: async () => { order.push('exec'); return {} }, confirmDownload: async () => ({}) } })
    expect((await h(req('POST', '/owner/archives/download', { token: O, body: { archiveId: '00000000-0000-0000-0000-0000000000c1' } }))).status).toBe(200)
    expect(order[order.length - 1]).toBe('exec'); expect(order[0]).toMatch(/^audit:/)
  })
  it('فشل تدقيق الرفض لا يُسقط الطلب (يبقى 401/403)', async () => {
    const { h } = setup({ audit: async () => { throw new Error('x') } })
    expect((await h(req('POST', '/staff/teachers/issue-credentials', { body: { teacherId: T1 } }))).status).toBe(401)
    expect((await h(req('POST', '/owner/teachers/remove', { token: 'director.jwt.token-bbb', body: { teacherId: T1 } }))).status).toBe(403)
  })
})

describe('API — الأرشيف السنوي (A-115)', () => {
  const YEAR = '00000000-0000-0000-0000-0000000000ff'
  const ARCH = '00000000-0000-0000-0000-00000000aaaa'
  const calls: Record<string, unknown[]> = { plan: [], urls: [], register: [], ack: [], status: [], confirmPart: [], confirmCopy: [] }
  const yearArchives = {
    async plan(y: string, tb?: number) { calls.plan!.push([y, tb]); if (y === '00000000-0000-0000-0000-00000000dead') throw new ServiceError('not_found'); return { year: { id: y } } },
    async urls(y: string, ids: string[]) { calls.urls!.push([y, ids]); return ids.map((id) => ({ versionId: id, url: 'https://x.example/' + id })) },
    async register(i: unknown) { calls.register!.push(i); if ((i as { entriesDigest: string }).entriesDigest === 'c'.repeat(64)) throw new ServiceError('year_changed'); return { id: ARCH, state: 'verified' } },
    async ack(i: unknown) { calls.ack!.push(i); return { archiveId: ARCH } },
    async confirmPart(i: unknown) { calls.confirmPart!.push(i); return { archiveId: ARCH, partNo: 1, verified: (i as { sha256: string }).sha256 !== 'd'.repeat(64), allPartsVerified: false } },
    async confirmCopy(i: unknown) { calls.confirmCopy!.push(i); return { archiveId: ARCH, partNo: 1, verified: (i as { sha256: string }).sha256 !== 'd'.repeat(64), allCopiesVerified: false } },
    async status(y: string) { calls.status!.push(y); return { archives: [] } },
  }
  const owner = 'owner.jwt.token-aaaa', director = 'director.jwt.token-bbb'
  const REG = (over: Record<string, unknown> = {}) => ({ yearId: YEAR, title: 'أرشيف', targetBytes: 200_000_000, entriesDigest: 'b'.repeat(64), parts: [{ no: 1, filename: 'a-part-01-of-02.zip', sha256: 'a'.repeat(64), size: 10 }, { no: 2, filename: 'a-part-02-of-02.zip', sha256: 'e'.repeat(64), size: 20 }], ...over })
  it('المالكة فقط: المديرة 403 والمجهولة 401 لكل المسارات، ولا يُستدعى أي منها', async () => {
    const { h } = setup({ yearArchives })
    for (const p of ['plan', 'urls', 'register', 'ack', 'status', 'confirm-part', 'confirm-copy']) {
      expect((await h(req('POST', `/owner/year-archive/${p}`, { token: director, body: { yearId: YEAR } }))).status).toBe(403)
      expect((await h(req('POST', `/owner/year-archive/${p}`, { body: { yearId: YEAR } }))).status).toBe(401)
    }
    expect(Object.values(calls).every((c) => c.length === 0)).toBe(true)
  })
  it('بلا الخدمة ⇒ 503 not_configured (فشل مغلق)', async () => {
    const { h } = setup()
    expect((await h(req('POST', '/owner/year-archive/plan', { token: owner, body: { yearId: YEAR } }))).status).toBe(503)
  })
  it('plan وurls وregister وack وstatus: تمرير المعرّفات المفحوصة، والتدقيق يسبق التنفيذ بهوية المالكة', async () => {
    const { h, audits } = setup({ yearArchives })
    expect(j(await h(req('POST', '/owner/year-archive/plan', { token: owner, body: { yearId: YEAR } }))).plan.year.id).toBe(YEAR)
    const u = await h(req('POST', '/owner/year-archive/urls', { token: owner, body: { yearId: YEAR, versionIds: [T1] } }))
    expect(j(u).urls[0].url).toBe('https://x.example/' + T1)
    const r = await h(req('POST', '/owner/year-archive/register', { token: owner, body: REG() }))
    expect(r.status).toBe(200); expect(calls.register![0]).toMatchObject({ yearId: YEAR, actorUserId: OWNER, targetBytes: 200_000_000, parts: [{ no: 1, size: 10 }, { no: 2, size: 20 }] })
    expect((await h(req('POST', '/owner/year-archive/ack', { token: owner, body: { archiveId: ARCH, kind: 'opened_locally' } }))).status).toBe(200)
    expect(calls.ack![0]).toMatchObject({ kind: 'opened_locally', actorUserId: OWNER })
    expect((await h(req('POST', '/owner/year-archive/status', { token: owner, body: { yearId: YEAR } }))).status).toBe(200)
    const acts = audits.map((a) => a.action)
    for (const a of ['owner.year_archive_plan', 'owner.year_archive_urls', 'owner.year_archive_register', 'owner.year_archive_ack_opened_locally']) expect(acts).toContain(a)
    expect(audits.find((a) => a.action === 'owner.year_archive_urls')!.target).toBe(`${YEAR}:1`) // عدد الملفات لا كل معرّف
  })
  it('مدخلات مشوّهة ⇒ 400؛ سنة غير موجودة ⇒ 404؛ سنة تغيّرت ⇒ 409 year_changed', async () => {
    const { h } = setup({ yearArchives })
    expect((await h(req('POST', '/owner/year-archive/plan', { token: owner, body: { yearId: 'x' } }))).status).toBe(400)
    expect((await h(req('POST', '/owner/year-archive/urls', { token: owner, body: { yearId: YEAR, versionIds: 'x' } }))).status).toBe(400)
    expect((await h(req('POST', '/owner/year-archive/ack', { token: owner, body: { archiveId: ARCH, kind: 'delete_everything' } }))).status).toBe(400)
    expect((await h(req('POST', '/owner/year-archive/plan', { token: owner, body: { yearId: '00000000-0000-0000-0000-00000000dead' } }))).status).toBe(404)
    const c = await h(req('POST', '/owner/year-archive/register', { token: owner, body: REG({ entriesDigest: 'c'.repeat(64) }) }))
    expect(c.status).toBe(409); expect(j(c).error).toBe('year_changed')
  })
  it('plan يمرّر حجم الجزء؛ التسجيل يرفض الأجزاء المشوّهة (400)؛ إقرار «نسخة ثانية» القديم مرفوض (400)', async () => {
    const { h } = setup({ yearArchives })
    await h(req('POST', '/owner/year-archive/plan', { token: owner, body: { yearId: YEAR, targetBytes: 500_000_000 } }))
    expect(calls.plan!.at(-1)).toEqual([YEAR, 500_000_000])
    expect((await h(req('POST', '/owner/year-archive/register', { token: owner, body: REG({ parts: 'x' }) }))).status).toBe(400)
    expect((await h(req('POST', '/owner/year-archive/register', { token: owner, body: REG({ targetBytes: 'x' }) }))).status).toBe(400)
    expect((await h(req('POST', '/owner/year-archive/ack', { token: owner, body: { archiveId: ARCH, kind: 'second_copy' } }))).status).toBe(400)
  })
  it('confirm-part وconfirm-copy: تطابق ⇒ 200؛ عدم تطابق ⇒ 409 hash_mismatch؛ مدخلات مشوّهة ⇒ 400', async () => {
    const { h } = setup({ yearArchives })
    const ok = await h(req('POST', '/owner/year-archive/confirm-part', { token: owner, body: { archiveId: ARCH, partNo: 1, sha256: 'a'.repeat(64) } }))
    expect(ok.status).toBe(200); expect(calls.confirmPart!.at(-1)).toMatchObject({ archiveId: ARCH, partNo: 1, actorUserId: OWNER })
    const bad = await h(req('POST', '/owner/year-archive/confirm-part', { token: owner, body: { archiveId: ARCH, partNo: 1, sha256: 'd'.repeat(64) } }))
    expect(bad.status).toBe(409); expect(j(bad).error).toBe('hash_mismatch')
    const c1 = await h(req('POST', '/owner/year-archive/confirm-copy', { token: owner, body: { archiveId: ARCH, partNo: 2, sha256: 'a'.repeat(64), medium: 'external_drive', independent: true } }))
    expect(c1.status).toBe(200); expect(calls.confirmCopy!.at(-1)).toMatchObject({ partNo: 2, medium: 'external_drive' })
    expect((await h(req('POST', '/owner/year-archive/confirm-copy', { token: owner, body: { archiveId: ARCH, partNo: 2, sha256: 'd'.repeat(64), medium: 'usb_flash', independent: true } }))).status).toBe(409)
    expect((await h(req('POST', '/owner/year-archive/confirm-part', { token: owner, body: { archiveId: 'x', partNo: 1, sha256: 'a'.repeat(64) } }))).status).toBe(400)
    expect((await h(req('POST', '/owner/year-archive/confirm-part', { token: owner, body: { archiveId: ARCH, partNo: 'one', sha256: 'a'.repeat(64) } }))).status).toBe(400)
  })
  it('فشل التدقيق ⇒ 500 audit_failed ولا تنفيذ', async () => {
    const { h } = setup({ yearArchives, audit: () => { throw new Error('down') } })
    const before = calls.register!.length
    expect((await h(req('POST', '/owner/year-archive/register', { token: owner, body: REG() }))).status).toBe(500)
    expect(calls.register!.length).toBe(before)
  })
})

describe('API — التصفير السنوي (A-118، A-126: للمالكة والمديرة بتأكيد واحد)', () => {
  const YEAR = '00000000-0000-0000-0000-0000000000ff'
  const calls: Record<string, unknown[]> = { report: [], status: [], start: [], resume: [] }
  const yearResets = {
    async report(y: string) { calls.report!.push(y); return { yearId: y } },
    async status(y: string) { calls.status!.push(y); return { yearId: y, state: 'ready' } },
    async start(i: unknown) { calls.start!.push(i); if ((i as { typedConfirmation?: string }).typedConfirmation === 'x') throw new ServiceError('bad_request'); return { done: true, status: {} } },
    async resume(i: unknown) { calls.resume!.push(i); return { done: false, status: {} } },
  }
  const owner = 'owner.jwt.token-aaaa', director = 'director.jwt.token-bbb'
  it('المجهولة 401 ولا يُستدعى أي مسار؛ والمديرة مسموح لها كالمالكة (A-126)', async () => {
    const { h } = setup({ yearResets })
    for (const p of ['report', 'status', 'start', 'resume']) {
      expect((await h(req('POST', `/staff/year-reset/${p}`, { body: { yearId: YEAR, confirm: true } }))).status).toBe(401)
      expect((await h(req('POST', `/owner/year-reset/${p}`, { token: owner, body: { yearId: YEAR, confirm: true } }))).status).toBe(404) // المسار القديم لم يعد موجودًا
    }
    expect(Object.values(calls).every((c) => c.length === 0)).toBe(true)
    expect((await h(req('POST', '/staff/year-reset/start', { token: director, body: { yearId: YEAR, confirm: true } }))).status).toBe(200)
    expect(calls.start!.at(-1)).toMatchObject({ yearId: YEAR })
    calls.start!.length = 0
  })
  it('بلا confirm=true ⇒ 400 قبل الخدمة (لا بدء عرَضي)', async () => {
    const { h } = setup({ yearResets })
    const before = calls.start!.length
    expect((await h(req('POST', '/staff/year-reset/start', { token: owner, body: { yearId: YEAR } }))).status).toBe(400)
    expect((await h(req('POST', '/staff/year-reset/start', { token: owner, body: { yearId: YEAR, confirm: 'true' } }))).status).toBe(400)
    expect(calls.start!.length).toBe(before)
  })
  it('بلا الخدمة ⇒ 503 (فشل مغلق)', async () => {
    const { h } = setup()
    expect((await h(req('POST', '/staff/year-reset/start', { token: owner, body: { yearId: YEAR, confirm: true } }))).status).toBe(503)
  })
  it('start وresume: تدقيق قبل التنفيذ بهوية المالكة، ومعرّف مشوّه ⇒ 400 قبل الخدمة، وخطأ الخدمة يُترجَم', async () => {
    const { h, audits } = setup({ yearResets })
    expect((await h(req('POST', '/staff/year-reset/start', { token: owner, body: { yearId: 'nope', confirm: true } }))).status).toBe(400)
    expect(calls.start!.length).toBe(0)
    expect((await h(req('POST', '/staff/year-reset/start', { token: owner, body: { yearId: YEAR, confirm: true } }))).status).toBe(200)
    expect(calls.start!.at(-1)).toMatchObject({ yearId: YEAR, actorUserId: OWNER })
    expect((await h(req('POST', '/staff/year-reset/start', { token: owner, body: { yearId: YEAR, confirm: true, typedConfirmation: 'x' } }))).status).toBe(400)
    expect((await h(req('POST', '/staff/year-reset/resume', { token: owner, body: { yearId: YEAR } }))).status).toBe(200)
    expect(audits.filter((a) => a.action.startsWith('owner.year_reset')).map((a) => `${a.action}:${a.actor.kind}`)).toEqual(expect.arrayContaining(['owner.year_reset_start:owner', 'owner.year_reset_resume:owner']))
    expect((await h(req('POST', '/staff/year-reset/report', { token: owner, body: { yearId: YEAR } }))).status).toBe(200)
  })
  it('فشل التدقيق ⇒ 500 ولا يبدأ التصفير (فشل مغلق)', async () => {
    const before = calls.start!.length
    const { h } = setup({ yearResets, audit: () => { throw new Error('audit down') } })
    expect((await h(req('POST', '/staff/year-reset/start', { token: owner, body: { yearId: YEAR, confirm: true } }))).status).toBe(500)
    expect(calls.start!.length).toBe(before)
  })
})

describe('API — الدخول الموحَّد /auth/login (r38)', () => {
  const staffLogin = { async login(i: { code: unknown }) { if (i.code === 'phrase-ok') return { accessToken: 'AT', refreshToken: 'RT' }; throw new AuthError('login_failed') } }
  it('شكل رمز معلمة ⇒ جلسة معلمة؛ غيره ⇒ جلسة إدارة؛ الفشل واحد (401 login_failed) في الحالتين', async () => {
    const { h } = setup({ staffLogin } as never)
    const t = await h(req('POST', '/auth/login', { body: { code: 'SA-12' } })); expect(t.status).toBe(200); expect((j(t) as { kind: string }).kind).toBe('teacher')
    const st = await h(req('POST', '/auth/login', { body: { code: 'phrase-ok' } })); expect(st.status).toBe(200); expect(j(st)).toEqual({ kind: 'staff', accessToken: 'AT', refreshToken: 'RT' })
    for (const code of ['ZZ-99', 'phrase-bad', '', 5]) { const r = await h(req('POST', '/auth/login', { body: { code } })); expect([r.status, j(r)]).toEqual([401, { error: 'login_failed' }]) }
  })
  it('بلا staffLogin مضبوط ⇒ رمز غير شبيه برمز معلمة يُرفض 401', async () => {
    const { h } = setup()
    expect((await h(req('POST', '/auth/login', { body: { code: 'phrase-ok' } }))).status).toBe(401)
  })
})

describe('API — حذف المعلمة لملفها نهائيًا (A-126)', () => {
  const VID = '00000000-0000-0000-0000-0000000000f9'
  const calls: [string, string][] = []
  const deleteVersion = { async delete(t: string, v: string) { calls.push([t, v]); if (v === '00000000-0000-0000-0000-0000000000f8') throw new ServiceError('delete_not_latest'); return { deleted: true as const } } }
  it('بلا رمز ⇒ 401، وبلا الخدمة ⇒ 503، ومعرّف مشوّه ⇒ 400 قبل الخدمة', async () => {
    expect((await setup({ deleteVersion }).h(req('POST', '/teacher/versions/delete', { body: { versionId: VID } }))).status).toBe(401)
    expect((await setup().h(req('POST', '/teacher/versions/delete', { token: TOKEN, body: { versionId: VID } }))).status).toBe(503)
    expect((await setup({ deleteVersion }).h(req('POST', '/teacher/versions/delete', { token: TOKEN, body: { versionId: 'nope' } }))).status).toBe(400)
    expect(calls.length).toBe(0)
  })
  it('الهوية من الجلسة لا من الجسم، والتدقيق قبل التنفيذ بمعرّف الإصدار فقط، وخطأ الخدمة يُترجَم', async () => {
    const { h, audits } = setup({ deleteVersion })
    const r = await h(req('POST', '/teacher/versions/delete', { token: TOKEN, body: { versionId: VID, teacherId: '00000000-0000-0000-0000-00000000dead' } }))
    expect(r.status).toBe(200); expect(JSON.parse(r.body)).toEqual({ deleted: true })
    expect(calls.at(-1)).toEqual([T1, VID])
    expect(audits.map((a) => `${a.action}:${a.actor.kind}:${a.target}`)).toContain(`teacher.delete_version:teacher:${VID}`)
    const bad = await h(req('POST', '/teacher/versions/delete', { token: TOKEN, body: { versionId: '00000000-0000-0000-0000-0000000000f8' } }))
    expect(bad.status).toBe(409); expect(JSON.parse(bad.body)).toEqual({ error: 'delete_not_latest' })
  })
  it('فشل التدقيق ⇒ 500 ولا حذف (فشل مغلق)', async () => {
    const before = calls.length
    const { h } = setup({ deleteVersion, audit: () => { throw new Error('audit down') } })
    expect((await h(req('POST', '/teacher/versions/delete', { token: TOKEN, body: { versionId: VID } }))).status).toBe(500)
    expect(calls.length).toBe(before)
  })
})
