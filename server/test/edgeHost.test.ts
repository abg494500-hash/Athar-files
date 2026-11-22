// @vitest-environment node
// اختبار مضيف Edge بطلبات Request حقيقية (Node 22) ومعالج بديل. لا Deno ولا شبكة.
import { describe, it, expect } from 'vitest'
import { createEdgeHandler, normalizePath } from '../host/edge'
import type { ApiFn } from '../host/edge'
import type { ApiRequest } from '../api/handler'
import { ComposeError } from '../api/compose'

const BASE = 'https://proj.supabase.co/functions/v1/api'
function mk(over: { api?: ApiFn; getApi?: () => Promise<ApiFn> } = {}) {
  const seen: ApiRequest[] = []; const errors: unknown[] = []
  const api: ApiFn = over.api ?? (async (r) => { seen.push(r); return { status: 200, headers: { 'content-type': 'application/json', 'x-test': '1' }, body: '{"ok":true}' } })
  let builds = 0
  const h = createEdgeHandler({ getApi: over.getApi ?? (async () => { builds++; return api }), onError: (e) => errors.push(e), version: 'test' })
  return { h, seen, errors, get builds() { return builds } }
}
const post = (path: string, body: string, headers: Record<string, string> = {}) => new Request(BASE + path, { method: 'POST', body, headers: { 'content-type': 'application/json', ...headers } })

describe('normalizePath', () => {
  it('يزيل بادئة الدالة بالصيغتين ويثبّت الأخيرة', () => {
    expect(normalizePath('/api/teacher/login', 'api')).toBe('/teacher/login')
    expect(normalizePath('/functions/v1/api/teacher/me/', 'api')).toBe('/teacher/me')
    expect(normalizePath('/api', 'api')).toBe('/')
    expect(normalizePath('/teacher/login', 'api')).toBe('/teacher/login')
    expect(normalizePath('/apix/teacher', 'api')).toBe('/apix/teacher') // ليست بادئة حقيقية
  })
})

describe('createEdgeHandler', () => {
  it('/health بلا أي تركيب للخدمات ولا أسرار', async () => {
    const m = mk(); const r = await m.h(new Request(BASE + '/health'))
    expect([r.status, await r.json(), m.builds]).toEqual([200, { ok: true, service: 'athar-api', version: 'test' }, 0])
  })
  it('يمرّر المسار المبسَّط والاستعلام والترويسات (أحرف صغيرة) والجسم، ويعيد الاستجابة كما هي', async () => {
    const m = mk()
    const r = await m.h(post('/teacher/login?x=1&x=2', '{"code":"A"}', { Authorization: 'Bearer abc', Origin: 'https://site.example', 'cf-connecting-ip': '203.0.113.7' }))
    expect(r.status).toBe(200); expect(r.headers.get('x-test')).toBe('1'); expect(await r.json()).toEqual({ ok: true })
    const q = m.seen[0]!
    expect([q.method, q.path, q.query, q.body, q.ip]).toEqual(['POST', '/teacher/login', { x: '1' }, '{"code":"A"}', '203.0.113.7'])
    expect(q.headers.authorization).toBe('Bearer abc'); expect(q.headers.origin).toBe('https://site.example')
  })
  it('عنوان العميل: لا يُؤخذ من x-forwarded-for ولا من قيمة معيبة', async () => {
    const m = mk()
    await m.h(post('/teacher/login', '{}', { 'x-forwarded-for': '1.2.3.4' }))
    await m.h(post('/teacher/login', '{}', { 'cf-connecting-ip': 'not an ip; drop table' }))
    expect(m.seen.map((s) => s.ip)).toEqual([undefined, undefined])
  })
  it('جسم أكبر من 16KB ⇒ 413 دون استدعاء المعالج (بترويسة الطول وبالبث الفعلي)', async () => {
    const m = mk()
    expect((await m.h(post('/teacher/login', 'x'.repeat(20000)))).status).toBe(413)
    const stream = new ReadableStream<Uint8Array>({ start(c) { for (let i = 0; i < 40; i++) c.enqueue(new Uint8Array(1000)); c.close() } })
    const r = await m.h(new Request(BASE + '/teacher/login', { method: 'POST', body: stream, headers: { 'content-type': 'application/json' }, duplex: 'half' } as RequestInit))
    expect(r.status).toBe(413); expect(m.seen.length).toBe(0)
  })
  it('طول معلن كبير ⇒ 413 دون قراءة الجسم (الترويسة وحدها كافية)', async () => {
    const m = mk()
    const stream = new ReadableStream<Uint8Array>({ pull(c) { c.enqueue(new Uint8Array(10)); c.close() } })
    // Request في Node يتجاهل content-length الصريح؛ نحاكي ما يمرّره Deno من الشبكة بكائن مماثل (method/url/headers/body فقط).
    const fake = { method: 'POST', url: BASE + '/teacher/login', headers: new Headers({ 'content-type': 'application/json', 'content-length': '999999' }), body: stream } as unknown as Request
    const r = await m.h(fake)
    expect([r.status, m.seen.length]).toEqual([413, 0])
  })
  it('UTF-8 معيب ⇒ 400؛ أساليب غير GET/POST/OPTIONS ⇒ 405', async () => {
    const m = mk()
    const bad = new Request(BASE + '/teacher/login', { method: 'POST', body: new Uint8Array([0xff, 0xfe, 0xfd]), headers: { 'content-type': 'application/json' } })
    expect((await m.h(bad)).status).toBe(400)
    const d = await m.h(new Request(BASE + '/teacher/me', { method: 'DELETE' }))
    expect([d.status, d.headers.get('allow')]).toEqual([405, 'GET, POST, OPTIONS']); expect(m.seen.length).toBe(0)
  })
  it('204 بلا جسم؛ وOPTIONS يمرّ للمعالج (CORS هناك)', async () => {
    const m = mk({ api: async () => ({ status: 204, headers: { 'access-control-allow-origin': 'https://s.example' }, body: '' }) })
    const r = await m.h(new Request(BASE + '/teacher/login', { method: 'OPTIONS', headers: { origin: 'https://s.example' } }))
    expect([r.status, await r.text()]).toEqual([204, ''])
  })
  it('إعداد ناقص ⇒ 503 not_configured (واسم المتغير فقط في السجل)، ثم يُعاد المحاولة بعد التصحيح', async () => {
    let ready = false
    const api: ApiFn = async () => ({ status: 200, headers: {}, body: '{}' })
    const m = mk({ getApi: async () => { if (!ready) throw new ComposeError('R2_BUCKET', 'مفقود'); return api } })
    const r = await m.h(new Request(BASE + '/teacher/me'))
    expect([r.status, await r.json()]).toEqual([503, { error: 'not_configured' }])
    expect(String((m.errors[0] as Error).message)).toContain('R2_BUCKET')
    ready = true
    expect((await m.h(new Request(BASE + '/teacher/me'))).status).toBe(200)
  })
  it('خطأ غير متوقع في التركيب أو المعالج ⇒ 500 عامة بلا تفاصيل', async () => {
    const a = mk({ getApi: async () => { throw new Error('postgres://u:secret@h/db failed') } })
    const r = await a.h(new Request(BASE + '/teacher/me'))
    expect([r.status, await r.text()]).toEqual([500, '{"error":"internal_error"}'])
    const b = mk({ api: async () => { throw new Error('secret-detail') } })
    const r2 = await b.h(post('/teacher/login', '{}'))
    expect([r2.status, await r2.text()]).toEqual([500, '{"error":"internal_error"}'])
  })
  it('التركيب يُبنى مرة واحدة عبر الطلبات المتتالية', async () => {
    const m = mk(); await m.h(new Request(BASE + '/teacher/me')); await m.h(new Request(BASE + '/teacher/me'))
    expect(m.builds).toBe(1)
  })
})
