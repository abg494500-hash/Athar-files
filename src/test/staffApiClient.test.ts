// اختبار عميل الواجهة الخادمية للمالكة/المديرة بـfetch وتجزئة بديلين (لا شبكة ولا R2). منطق نقي.
import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { createStaffApiClient, staffMessage } from '../lib/staffApi/client'

const bytes = new TextEncoder().encode('PK-zip-bytes-محتوى')
const SHA = createHash('sha256').update(bytes).digest('hex')
const sha256 = async (d: Uint8Array) => createHash('sha256').update(d).digest('hex')
interface Call { url: string; method: string; auth: string; body: unknown }
function mk(routes: Record<string, { status: number; json?: unknown }>, o: { token?: string | null; download?: { status: number; body?: Uint8Array } } = {}) {
  const calls: Call[] = []
  const f = (async (url: string, init: RequestInit) => {
    const u = new URL(url)
    if (u.host === 'r2.example') { calls.push({ url, method: String(init.method), auth: '', body: null }); const d = o.download ?? { status: 200, body: bytes }; return new Response(d.body as unknown as BodyInit, { status: d.status }) }
    const path = u.pathname.replace('/fn', '')
    calls.push({ url, method: String(init.method), auth: (init.headers as Record<string, string>).authorization ?? '', body: init.body ? JSON.parse(String(init.body)) : null })
    const r = routes[path] ?? { status: 404, json: {} }
    return new Response(r.status === 204 ? null : JSON.stringify(r.json ?? {}), { status: r.status })
  }) as unknown as typeof fetch
  const c = createStaffApiClient({ baseUrl: 'https://api.example.org/fn', getToken: async () => (o.token === undefined ? 'tok.en.value-xxxx' : o.token), fetchImpl: f, sha256 })
  return { c, calls }
}
const link = (over: Record<string, unknown> = {}) => ({ status: 200, json: { download: { url: 'https://r2.example/a.zip?sig=1', expiresAt: 'e', filename: 'athar-archive-1.zip', sha256: SHA, sizeBytes: bytes.length, ...over } } })

describe('عميل المسؤولات', () => {
  it('بلا رمز وصول ⇒ unauthenticated دون أي طلب', async () => {
    const { c, calls } = mk({}, { token: null })
    expect(await c.signVersionDownload('v1')).toEqual({ ok: false, error: 'unauthenticated' }); expect(calls.length).toBe(0)
  })
  it('تنزيل إصدار: يرسل الرمز وversionId فقط، ويقبل https فقط', async () => {
    const { c, calls } = mk({ '/staff/downloads/sign': { status: 200, json: { download: { url: 'https://r2.example/x', filename: 'a.pdf' } } } })
    expect(await c.signVersionDownload('v1')).toEqual({ ok: true, value: { url: 'https://r2.example/x', filename: 'a.pdf' } })
    expect(calls[0]!.auth).toBe('Bearer tok.en.value-xxxx'); expect(calls[0]!.body).toEqual({ versionId: 'v1' })
    expect((await mk({ '/staff/downloads/sign': { status: 200, json: { download: { url: 'http://x', filename: 'a' } } } }).c.signVersionDownload('v1')).ok).toBe(false)
    expect((await mk({ '/staff/downloads/sign': { status: 200, json: { download: { url: 'javascript:1', filename: 'a' } } } }).c.signVersionDownload('v1')).ok).toBe(false)
  })
  it('رموز الحالة: 401/403/5xx/رفض مع رمز الخادم', async () => {
    expect(await mk({ '/staff/downloads/sign': { status: 401 } }).c.signVersionDownload('v')).toEqual({ ok: false, error: 'unauthenticated' })
    expect(await mk({ '/staff/downloads/sign': { status: 403, json: { error: 'forbidden' } } }).c.signVersionDownload('v')).toEqual({ ok: false, error: 'forbidden', code: 'forbidden' })
    const s500 = await mk({ '/staff/downloads/sign': { status: 500, json: { error: 'internal_error' } } }).c.signVersionDownload('v')
    expect([s500.ok, !s500.ok && s500.error]).toEqual([false, 'server'])
    const af = await mk({ '/staff/downloads/sign': { status: 500, json: { error: 'audit_failed' } } }).c.signVersionDownload('v')
    expect(!af.ok && af.code).toBe('audit_failed')
  })
  it('A-118: العميل لا يملك أي وظيفة إنشاء أرشيف سحابي، ويجلب الأرشيفات القديمة للنقل فقط', async () => {
    const c = mk({ '/owner/archives/legacy': { status: 200, json: { archives: [{ id: 'A1', title: 'قديم', yearId: 'y', createdAt: '2026-01-01T00:00:00Z', sizeBytes: 5, sha256: SHA, transferredAt: null }] } } })
    expect((c.c as unknown as Record<string, unknown>).createArchive).toBeUndefined()
    expect((await c.c.legacyArchives())).toMatchObject({ ok: true, value: [{ id: 'A1', transferredAt: null }] })
  })
  it('تنزيل الأرشيف والتحقق: بصمة مطابقة ⇒ تُسلَّم البايتات وتُرسَل البصمة المحسوبة للتأكيد', async () => {
    const { c, calls } = mk({ '/owner/archives/download': link(), '/owner/archives/confirm': { status: 200, json: { confirmation: { verified: true } } } })
    const r = await c.downloadLegacyArchive('A1')
    expect(r.ok && r.value.sha256).toBe(SHA); expect(r.ok && [...r.value.bytes]).toEqual([...bytes])
    expect(calls.map((x) => new URL(x.url).pathname)).toEqual(['/fn/owner/archives/download', '/a.zip', '/fn/owner/archives/confirm'])
    expect(calls[2]!.body).toEqual({ archiveId: 'A1', sha256: SHA })
    expect(calls[1]!.auth).toBe('') // رابط التخزين الموقّع لا يحمل رمز الجلسة
  })
  it('تلف أثناء التنزيل (بايتات مختلفة) ⇒ hash_mismatch ولا بايتات، ويُسجَّل الاختلاف في الخادم', async () => {
    const tampered = new Uint8Array(bytes); tampered[3] = tampered[3]! ^ 1
    // الخادم هنا «يقبل» التأكيد (200) عمدًا: العميل يجب أن يرفض بمقارنته المحلية وحدها
    const { c, calls } = mk({ '/owner/archives/download': link(), '/owner/archives/confirm': { status: 200, json: { confirmation: { verified: true } } } }, { download: { status: 200, body: tampered } })
    const r = await c.downloadLegacyArchive('A1')
    expect(r).toEqual({ ok: false, error: 'rejected', code: 'hash_mismatch' })
    expect(calls.some((x) => x.url.endsWith('/owner/archives/confirm'))).toBe(true)
    expect(staffMessage({ error: 'rejected', code: 'hash_mismatch' })).toContain('لا تطابق')
  })
  it('حجم مختلف عن المسجَّل ⇒ رفض فوري دون تأكيد؛ فشل HTTP للتخزين ⇒ download_failed؛ انقطاع ⇒ network', async () => {
    const a = mk({ '/owner/archives/download': link({ sizeBytes: 5 }), '/owner/archives/confirm': { status: 200, json: {} } })
    expect(await a.c.downloadLegacyArchive('A1')).toEqual({ ok: false, error: 'rejected', code: 'hash_mismatch' }); expect(a.calls.some((x) => x.url.endsWith('/confirm'))).toBe(false)
    expect(await mk({ '/owner/archives/download': link() }, { download: { status: 403 } }).c.downloadLegacyArchive('A1')).toEqual({ ok: false, error: 'rejected', code: 'download_failed' })
    const f = (async (u: string) => { if (u.includes('/owner/archives/download')) return new Response(JSON.stringify(link().json), { status: 200 }); throw new Error('offline') }) as unknown as typeof fetch
    expect(await createStaffApiClient({ baseUrl: 'https://api.example.org/fn', getToken: async () => 't.t.t-aaaaaaaa', fetchImpl: f, sha256 }).downloadLegacyArchive('A1')).toEqual({ ok: false, error: 'network' })
  })
  it('رابط تنزيل غير https أو ناقص ⇒ server؛ تأكيد مرفوض (409) بعد مطابقة محلية ⇒ فشل', async () => {
    expect((await mk({ '/owner/archives/download': link({ url: 'http://r2.example/a' }) }).c.downloadLegacyArchive('A1')).ok).toBe(false)
    expect((await mk({ '/owner/archives/download': { status: 200, json: { download: { url: 'https://r2.example/a' } } } }).c.downloadLegacyArchive('A1')).ok).toBe(false)
    expect((await mk({ '/owner/archives/download': link(), '/owner/archives/confirm': { status: 409, json: { error: 'hash_mismatch' } } }).c.downloadLegacyArchive('A1')).ok).toBe(false)
  })
  it('إصدار الكود: يعيد الكود وحده مرة واحدة؛ وردّ معيب ⇒ server', async () => {
    const ok = mk({ '/staff/teachers/issue-credentials': { status: 200, json: { code: 'SA-12' } } })
    expect(await ok.c.issueCredentials('T1')).toEqual({ ok: true, value: { code: 'SA-12' } }); expect(ok.calls[0]!.body).toEqual({ teacherId: 'T1' })
    expect(await mk({ '/staff/teachers/issue-credentials': { status: 200, json: { nocode: 1 } } }).c.issueCredentials('T1')).toEqual({ ok: false, error: 'server' })
    const af = await mk({ '/staff/teachers/issue-credentials': { status: 500, json: { error: 'audit_failed' } } }).c.issueCredentials('T1')
    expect(!af.ok && staffMessage(af)).toContain('لم يُنفَّذ')
  })
  it('إلغاء الكود: 204 بلا جسم ⇒ نجاح، وفشل المصادقة ⇒ unauthenticated', async () => {
    expect(await mk({ '/staff/teachers/revoke-credentials': { status: 204 } }).c.revokeCredentials('T1')).toEqual({ ok: true, value: true })
    expect(await mk({ '/staff/teachers/revoke-credentials': { status: 401 } }).c.revokeCredentials('T1')).toEqual({ ok: false, error: 'unauthenticated' })
  })
  it('النظرة العامة: GET بالرمز وtermId، وتحقق الشكل؛ الإفراج والصيانة', async () => {
    const calls: string[] = []
    const f = (async (u: string, i: RequestInit) => {
      calls.push(`${i.method} ${new URL(u).pathname.replace('/fn', '')}${new URL(u).search} ${(i.headers as Record<string, string>).authorization}`)
      const p = new URL(u).pathname.replace('/fn', '')
      if (p === '/staff/overview') return new Response(JSON.stringify({ overview: { termId: 'T', asOf: 'x', sessionsByState: { uploaded: 1 }, pending: [{ sessionId: 'S', teacherId: 'U', slotId: 's1', state: 'uploaded', declaredName: 'a.pdf', declaredSize: 5, waitingMinutes: 7 }], submissions: { slotsSubmitted: 1, onTime: 1, late: 0, teachersWithSubmissions: 1 } } }), { status: 200 })
      if (p === '/owner/uploads/release') return new Response(JSON.stringify({ session: {} }), { status: 200 })
      if (p === '/owner/maintenance/sweep') return new Response(JSON.stringify({ expired: 4 }), { status: 200 })
      return new Response('{}', { status: 404 })
    }) as unknown as typeof fetch
    const c = createStaffApiClient({ baseUrl: 'https://api.example.org/fn', getToken: async () => 'tok.en.value-xxxx', fetchImpl: f, sha256 })
    const ov = await c.overview('T'); expect(ov.ok && ov.value.pending[0]!.waitingMinutes).toBe(7)
    expect(calls[0]).toBe('GET /staff/overview?termId=T Bearer tok.en.value-xxxx')
    expect(await c.releaseSession({ sessionId: 'S', note: 'عطل', platformFault: true })).toEqual({ ok: true, value: true })
    expect(await c.sweepExpired()).toEqual({ ok: true, value: 4 })
    const bad = createStaffApiClient({ baseUrl: 'https://api.example.org/fn', getToken: async () => 't.t.t-aaaaaaaa', fetchImpl: (async () => new Response(JSON.stringify({ overview: { termId: 'T' } }), { status: 200 })) as unknown as typeof fetch, sha256 })
    expect(await bad.overview('T')).toEqual({ ok: false, error: 'server' })
  })
  it('عنوان غير آمن يُرفض عند الإنشاء', () => {
    expect(() => createStaffApiClient({ baseUrl: 'http://evil.example', getToken: async () => null })).toThrow()
  })
})
