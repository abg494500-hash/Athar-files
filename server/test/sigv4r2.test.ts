// @vitest-environment node
// اختبار التوقيع مقابل متجهَي AWS المنشورين (مرجع مستقل) + محوّل R2 بـfetch وهمي يحاكي S3. **لا R2 حقيقي.**
import { describe, it, expect } from 'vitest'
import { presign, signHeaders, sha256Hex, encodePath } from '../storage/sigv4'
import { R2StorageAdapter, R2ConfigError, R2RequestError, contentDisposition } from '../storage/r2'
import { StorageError } from '../../src/lib/storage/errors'

const AWS = { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' }
const T0 = new Date('2013-05-24T00:00:00Z')

describe('SigV4 — متجهات AWS المنشورة', () => {
  it('Presigned GET: التوقيع المنشور في توثيق S3', () => {
    const u = presign({ method: 'GET', url: 'https://examplebucket.s3.amazonaws.com/test.txt', region: 'us-east-1', creds: AWS, now: T0, expiresSec: 86400 })
    expect(u).toContain('X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404')
    expect(u.startsWith('https://examplebucket.s3.amazonaws.com/test.txt?')).toBe(true)
  })
  it('GET Object بترويسات (Range): التوقيع المنشور في توثيق S3', () => {
    const h = signHeaders({ method: 'GET', url: 'https://examplebucket.s3.amazonaws.com/test.txt', headers: { range: 'bytes=0-9' }, region: 'us-east-1', creds: AWS, now: T0, payloadHash: sha256Hex('') })
    expect(h.authorization).toContain('SignedHeaders=host;range;x-amz-content-sha256;x-amz-date')
    expect(h.authorization.endsWith('Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41')).toBe(true)
  })
  it('ترميز المسار: عربي ومسافة وأقواس؛ والفاصل يبقى', () => {
    expect(encodePath('a b/ملف(1).pdf')).toBe('a%20b/%D9%85%D9%84%D9%81%281%29.pdf')
  })
  it('مدة الرابط خارج النطاق ⇒ يرفض', () => {
    for (const e of [0, -1, 604801, 1.5]) expect(() => presign({ method: 'GET', url: 'https://h.example/k', region: 'auto', creds: AWS, now: T0, expiresSec: e })).toThrow()
  })
})

const ACC = 'a'.repeat(32)
interface Req { method: string; url: string; headers: Record<string, string>; bodyLen: number }
function fakeS3() {
  const objs = new Map<string, Uint8Array>(); const log: Req[] = []
  const f = (async (url: string, init: RequestInit) => {
    const h = init.headers as Record<string, string>
    const body = init.body as Uint8Array | undefined
    log.push({ method: String(init.method), url, headers: h, bodyLen: body?.byteLength ?? 0 })
    const key = new URL(url).pathname
    if (init.method === 'PUT') {
      if (h['if-none-match'] === '*' && objs.has(key)) return new Response(null, { status: 412 })
      if (sha256Hex(body!) !== h['x-amz-content-sha256']) return new Response(null, { status: 400 })
      objs.set(key, new Uint8Array(body!)); return new Response(null, { status: 200 })
    }
    if (init.method === 'GET') return objs.has(key) ? new Response(objs.get(key)! as unknown as BodyInit, { status: 200 }) : new Response(null, { status: 404 })
    return new Response(null, { status: 405 })
  }) as unknown as typeof fetch
  return { f, objs, log }
}
const mk = (o: Partial<ConstructorParameters<typeof R2StorageAdapter>[0]> = {}) => {
  const s = fakeS3()
  return { s, r2: new R2StorageAdapter({ accountId: ACC, bucket: 'athar-private', accessKeyId: 'AKIA-TEST-ONLY', secretAccessKey: 'secret-test-only-123456', fetchImpl: s.f, now: () => T0, ...o }) }
}
const blob = (s: string) => new Blob([new TextEncoder().encode(s)])

describe('R2StorageAdapter (fetch وهمي — لا R2 حقيقي)', () => {
  it('put ثم get: البايتات والبصمة والحجم', async () => {
    const { r2 } = mk()
    const p = await r2.put({ key: 'files/t1/term/plan/v1.pdf', data: blob('%PDF-1.4 محتوى') })
    expect(p.provider).toBe('r2'); expect(p.sha256).toBe(sha256Hex(new TextEncoder().encode('%PDF-1.4 محتوى')))
    const g = await r2.get('files/t1/term/plan/v1.pdf')
    expect(g!.sha256).toBe(p.sha256); expect(g!.sizeBytes).toBe(p.sizeBytes)
    expect(await g!.data.text()).toBe('%PDF-1.4 محتوى')
  })
  it('لا كتابة فوق كائن موجود (412 ⇒ already_exists) ويُرسَل If-None-Match: *', async () => {
    const { r2, s } = mk()
    await r2.put({ key: 'files/k1', data: blob('one') })
    let code = ''
    try { await r2.put({ key: 'files/k1', data: blob('two') }) } catch (e) { code = e instanceof StorageError ? e.code : 'other' }
    expect(code).toBe('already_exists'); expect(s.log[0]!.headers['if-none-match']).toBe('*')
  })
  it('كائن غير موجود ⇒ null؛ خطأ خادم ⇒ استثناء بلا تسريب', async () => {
    expect(await mk().r2.get('files/none')).toBeNull()
    const { r2 } = mk({ fetchImpl: (async () => new Response(null, { status: 503 })) as unknown as typeof fetch })
    let msg = ''
    try { await r2.get('files/x') } catch (e) { msg = e instanceof R2RequestError ? e.message : 'other' }
    expect(msg).toBe('r2_get_failed:503')
  })
  it('حد الحجم، الفارغ، والإلغاء', async () => {
    const { r2 } = mk({ maxObjectBytes: 5 })
    const code = async (fn: () => Promise<unknown>) => { try { await fn() } catch (e) { return e instanceof StorageError ? e.code : 'other' } return null }
    expect(await code(() => r2.put({ key: 'files/a', data: blob('123456') }))).toBe('provider_limit')
    expect(await code(() => r2.put({ key: 'files/b', data: new Blob([]) }))).toBe('empty')
    const ac = new AbortController(); ac.abort()
    expect(await code(() => r2.put({ key: 'files/c', data: blob('1'), signal: ac.signal }))).toBe('aborted')
  })
  it('مفتاح غير آمن يُرفض قبل أي طلب', async () => {
    const { r2, s } = mk()
    let threw = false
    try { await r2.get('../etc/passwd') } catch { threw = true }
    expect(threw).toBe(true); expect(s.log.length).toBe(0)
  })
  it('الحذف مرفوض دائمًا (A-44)', async () => {
    const { r2 } = mk(); let code = ''
    try { await r2.delete('files/x', undefined as never) } catch (e) { code = e instanceof StorageError ? e.code : 'other' }
    expect(code).toBe('delete_not_implemented')
  })
  it('الإعداد: حساب/حاوية/مفاتيح معيبة ⇒ R2ConfigError دون تسريب القيم', () => {
    for (const bad of [{ accountId: 'x' }, { bucket: 'A_B' }, { accessKeyId: '' }, { secretAccessKey: 'short' }]) {
      let msg = ''
      try { mk(bad) } catch (e) { msg = e instanceof R2ConfigError ? e.message : 'other' }
      expect(msg).not.toBe(''); expect(msg).not.toBe('other'); expect(msg).not.toContain('secret-test-only')
    }
  })
  it('رابط الرفع: PUT يوقّع content-length ومدته ≤ 900 ث، بلا مفاتيح سرية في الرابط', () => {
    const { r2 } = mk()
    const p = r2.presignPut('pending/t/term/slot/s1.pdf', { sizeBytes: 1234, ttlSec: 99999 })
    expect(p.method).toBe('PUT'); expect(p.headers['content-length']).toBe('1234')
    expect(p.url).toContain('X-Amz-Expires=900'); expect(p.url).toContain('X-Amz-SignedHeaders=content-length%3Bhost')
    expect(p.url).not.toContain('secret-test-only')
    expect(p.url.startsWith(`https://${ACC}.r2.cloudflarestorage.com/athar-private/pending/`)).toBe(true)
  })
  it('رابط الرفع: حجم صفري/فوق الحد يُرفض', () => {
    const { r2 } = mk({ maxObjectBytes: 10 })
    for (const n of [0, -1, 11, 1.5]) expect(() => r2.presignPut('pending/k', { sizeBytes: n, ttlSec: 60 })).toThrow()
  })
  it('رابط التنزيل: ≤ 300 ث، attachment، نوع من الامتداد، no-store', () => {
    const { r2 } = mk()
    const g = r2.presignGet('files/t/term/plan/v1.pdf', { filename: 'خطة "العمل".pdf', ext: 'pdf', ttlSec: 9999 })
    expect(g.url).toContain('X-Amz-Expires=300'); expect(g.expiresAt.getTime()).toBe(T0.getTime() + 300_000)
    const q = new URL(g.url).searchParams
    expect(q.get('response-content-type')).toBe('application/pdf'); expect(q.get('response-cache-control')).toBe('no-store')
    expect(q.get('response-content-disposition')!.startsWith('attachment; filename="')).toBe(true)
    expect(q.get('response-content-disposition')).not.toContain('"العمل"')
  })
  it('رابط المعاينة (r41): Content-Disposition inline فقط عند الطلب، والتنزيل الافتراضي attachment', () => {
    const { r2 } = mk()
    const q = new URL(r2.presignGet('files/t/term/plan/v1.pdf', { filename: 'خطة.pdf', ext: 'pdf', ttlSec: 300, inline: true }).url).searchParams
    expect(q.get('response-content-disposition')!.startsWith('inline; filename="')).toBe(true); expect(q.get('response-content-type')).toBe('application/pdf')
    const d = new URL(r2.presignGet('files/t/term/plan/v1.pdf', { filename: 'خطة.pdf', ext: 'pdf', ttlSec: 60 }).url).searchParams
    expect(d.get('response-content-disposition')!.startsWith('attachment;')).toBe(true)
  })
  it('Content-Disposition: لا حقن ترويسات ولا مسارات', () => {
    const d = contentDisposition('a"\r\nX-Evil: 1/../b.pdf')
    expect(d).not.toMatch(/[\r\n]/); expect(d).not.toContain('/'); expect(d.startsWith('attachment;')).toBe(true)
    expect(contentDisposition('')).toContain('filename="file"')
  })
})
