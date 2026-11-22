// اختبار عميل دخول المعلمة بـ fetch وتخزين بديلين (لا شبكة). منطق نقي فلا يحتاج jsdom.
import { describe, it, expect } from 'vitest'
import { checkTeacherApiUrl, createTeacherApiClient, uploadMessage } from '../lib/teacherAuth/client'
import type { TokenStorage } from '../lib/teacherAuth/client'

const TOKEN = 'A'.repeat(43)
const mem = (): TokenStorage & { m: Map<string, string> } => { const m = new Map<string, string>(); return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) } }
const reply = (status: number, body: unknown = null) => (async () => new Response(status === 204 ? null : JSON.stringify(body), { status })) as unknown as typeof fetch
const mk = (f: typeof fetch, s = mem()) => ({ s, c: createTeacherApiClient({ baseUrl: 'https://api.example.org/fn', storage: s, fetchImpl: f }) })

describe('عميل دخول المعلمة', () => {
  it('عنوان الواجهة: https أو localhost فقط، بلا بيانات اعتماد/استعلام', () => {
    expect(checkTeacherApiUrl('https://a.example/fn/')).toBe('https://a.example/fn')
    expect(checkTeacherApiUrl('http://localhost:54321/fn')).toBe('http://localhost:54321/fn')
    for (const bad of ['http://a.example', 'https://u:p@a.example', 'https://a.example?x=1', 'ftp://a', 'x', null, 5]) expect(checkTeacherApiUrl(bad)).toBeNull()
  })
  it('دخول ناجح يحفظ الرمز ويعيد الهوية؛ ويُرسل الجسم صحيحًا بلا كوكيز', async () => {
    let seen: RequestInit | undefined; let url = ''
    const f = (async (u: string, i: RequestInit) => { url = u; seen = i; return new Response(JSON.stringify({ token: TOKEN, teacher: { id: 't1', name: 'معلمة' } }), { status: 200 }) }) as unknown as typeof fetch
    const { c, s } = mk(f)
    expect(await c.login('SA-12')).toEqual({ ok: true, value: { id: 't1', name: 'معلمة' } })
    expect(s.m.get('athar.teacher.token')).toBe(TOKEN)
    expect(url).toBe('https://api.example.org/fn/teacher/login'); expect(seen!.credentials).toBe('omit'); expect(JSON.parse(String(seen!.body))).toEqual({ code: 'SA-12' })
  })
  it('فشل الدخول: رسالة واحدة login_failed ولا حفظ رمز', async () => {
    const { c, s } = mk(reply(401, { error: 'login_failed' }))
    expect(await c.login('x')).toEqual({ ok: false, error: 'login_failed' }); expect(s.m.size).toBe(0)
  })
  it('مدخلات فارغة ⇒ bad_input دون طلب شبكة', async () => {
    let n = 0
    const { c } = mk((async () => { n++; return new Response('{}') }) as unknown as typeof fetch)
    expect((await c.login('')).ok).toBe(false); expect((await c.login('   ')).ok).toBe(false); expect(n).toBe(0)
  })
  it('رد 200 معيب (رمز بشكل غريب/بلا هوية) لا يُحفظ', async () => {
    for (const body of [{ token: 'short', teacher: { id: 'a', name: 'b' } }, { token: TOKEN }, {}]) {
      const { c, s } = mk(reply(200, body)); expect((await c.login('a')).ok).toBe(false); expect(s.m.size).toBe(0)
    }
  })
  it('انقطاع الشبكة ⇒ network؛ 5xx ⇒ server؛ 429 ⇒ rate_limited', async () => {
    expect(await mk((async () => { throw new Error('x') }) as unknown as typeof fetch).c.login('a')).toEqual({ ok: false, error: 'network' })
    expect(await mk(reply(503)).c.login('a')).toEqual({ ok: false, error: 'server' })
    expect(await mk(reply(429)).c.login('a')).toEqual({ ok: false, error: 'rate_limited' })
  })
  it('me: 401 يمحو الرمز؛ انقطاع الشبكة لا يمحوه', async () => {
    const s = mem(); s.setItem('athar.teacher.token', TOKEN)
    expect(await mk((async () => { throw new Error('x') }) as unknown as typeof fetch, s).c.me()).toEqual({ ok: false, error: 'network' })
    expect(s.m.size).toBe(1)
    expect(await mk(reply(401, { error: 'unauthenticated' }), s).c.me()).toEqual({ ok: false, error: 'unauthenticated' })
    expect(s.m.size).toBe(0)
  })
  it('me بلا رمز محفوظ أو برمز تالف ⇒ unauthenticated دون طلب', async () => {
    let n = 0; const f = (async () => { n++; return new Response('{}') }) as unknown as typeof fetch
    const s = mem(); expect((await mk(f, s).c.me()).ok).toBe(false)
    s.setItem('athar.teacher.token', 'bad token!'); expect((await mk(f, s).c.me()).ok).toBe(false); expect(n).toBe(0)
  })
  it('الخروج يمحو الرمز محليًا حتى مع فشل الاتصال، ويرسله للإبطال', async () => {
    const s = mem(); s.setItem('athar.teacher.token', TOKEN)
    let auth = ''
    const f = (async (_u: string, i: RequestInit) => { auth = (i.headers as Record<string, string>).authorization ?? ''; throw new Error('offline') }) as unknown as typeof fetch
    await mk(f, s).c.logout()
    expect(s.m.size).toBe(0); expect(auth).toBe(`Bearer ${TOKEN}`)
  })
  it('لا يُسرَّب الرمز في أي رسالة خطأ', async () => {
    const r = await mk(reply(500, { error: TOKEN })).c.login('a')
    expect(JSON.stringify(r)).not.toContain(TOKEN)
  })
})

describe('عميل المعلمة — البيانات والتنزيل', () => {
  const tok = (s = mem()) => { s.setItem('athar.teacher.token', TOKEN); return s }
  const P = { teacher: { id: 't1', name: 'م', subject: 'ع' }, serverNow: 'x', terms: [] }
  it('portfolio: يرسل الرمز ويعيد العرض؛ 401 يمحو الرمز؛ شكل معيب ⇒ server', async () => {
    let auth = ''
    const f = (async (_u: string, i: RequestInit) => { auth = (i.headers as Record<string, string>).authorization ?? ''; return new Response(JSON.stringify({ portfolio: P }), { status: 200 }) }) as unknown as typeof fetch
    const r = await mk(f, tok()).c.portfolio()
    expect(r.ok && r.value.teacher.id).toBe('t1'); expect(auth).toBe(`Bearer ${TOKEN}`)
    const s = tok(); expect((await mk(reply(401, {}), s).c.portfolio()).ok).toBe(false); expect(s.m.size).toBe(0)
    expect(await mk(reply(200, { portfolio: { terms: 'x' } }), tok()).c.portfolio()).toEqual({ ok: false, error: 'server' })
    expect(await mk(reply(200, {}), tok()).c.portfolio()).toEqual({ ok: false, error: 'server' })
  })
  it('portfolio/signDownload بلا رمز ⇒ unauthenticated دون طلب', async () => {
    let n = 0; const f = (async () => { n++; return new Response('{}') }) as unknown as typeof fetch
    expect((await mk(f).c.portfolio()).ok).toBe(false); expect((await mk(f).c.signDownload('v')).ok).toBe(false); expect(n).toBe(0)
  })
  it('signDownload: يقبل https فقط ويرسل versionId فقط (لا هوية)', async () => {
    let body = ''
    const f = (async (_u: string, i: RequestInit) => { body = String(i.body); return new Response(JSON.stringify({ download: { url: 'https://get.example/x', expiresAt: 'e', filename: 'a.pdf' } }), { status: 200 }) }) as unknown as typeof fetch
    const r = await mk(f, tok()).c.signDownload('v1')
    expect(r.ok && r.value.url).toBe('https://get.example/x'); expect(JSON.parse(body)).toEqual({ versionId: 'v1' })
    expect((await mk(reply(200, { download: { url: 'http://x', expiresAt: 'e', filename: 'a' } }), tok()).c.signDownload('v1')).ok).toBe(false)
    expect((await mk(reply(200, { download: { url: 'javascript:alert(1)', expiresAt: 'e', filename: 'a' } }), tok()).c.signDownload('v1')).ok).toBe(false)
    expect(await mk(reply(404, { error: 'not_found' }), tok()).c.signDownload('v1')).toEqual({ ok: false, error: 'bad_input' })
  })
})

describe('عميل المعلمة — الرفع والاستبدال وحفظ الرابط', () => {
  const file = Object.assign(new Blob([new Uint8Array(2048)]), { name: 'خطة.pdf' })
  const tok = () => { const s = mem(); s.setItem('athar.teacher.token', TOKEN); return s }
  type Route = (body: Record<string, unknown>) => { status: number; json: unknown }
  const server = (routes: Record<string, Route>) => {
    const log: string[] = []
    const f = (async (u: string, i: RequestInit) => {
      const path = new URL(u).pathname.replace('/fn', ''); log.push(path)
      const r = routes[path]?.(i.body ? JSON.parse(String(i.body)) : {}) ?? { status: 404, json: {} }
      return new Response(JSON.stringify(r.json), { status: r.status })
    }) as unknown as typeof fetch
    return { f, log }
  }
  const ok = (json: unknown): Route => () => ({ status: 200, json })
  const happy = (over: Record<string, Route> = {}) => ({
    '/teacher/uploads/start': ok({ session: { sessionId: 'S1' } }),
    '/teacher/uploads/presign': ok({ upload: { url: 'https://put.example/k?sig=1', method: 'PUT', headers: {} } }),
    '/teacher/uploads/complete': ok({ session: {}, version: { versionId: 'V1', no: 2, statusSnapshot: 'late' } }),
    '/teacher/uploads/cancel': ok({ session: {} }),
    ...over,
  })
  const putOk = (log: { url: string; init: RequestInit }[] = []) => (async (url: string, init: RequestInit) => { log.push({ url, init }); return new Response(null, { status: 200 }) }) as unknown as typeof fetch
  const sleep = async () => {}

  it('المسار الكامل: start ← presign ← PUT مباشر بالملف نفسه ← complete، ويُبلَّغ بالمراحل', async () => {
    const sv = server(happy()); const puts: { url: string; init: RequestInit }[] = []; const stages: string[] = []
    const r = await mk(sv.f, tok()).c.uploadFile({ termId: 'T', slotId: 's1', file }, { putImpl: putOk(puts), sleep, stage: (x) => stages.push(x) })
    expect(r).toEqual({ ok: true, value: { versionId: 'V1', no: 2, statusSnapshot: 'late' } })
    expect(sv.log).toEqual(['/teacher/uploads/start', '/teacher/uploads/presign', '/teacher/uploads/complete'])
    expect(puts[0]!.url).toBe('https://put.example/k?sig=1'); expect(puts[0]!.init.body).toBe(file); expect(puts[0]!.init.credentials).toBe('omit')
    expect(stages).toEqual(['starting', 'uploading', 'finishing'])
  })
  it('start يرسل الاسم والحجم الحقيقيين ولا يرسل أي هوية', async () => {
    let body: Record<string, unknown> = {}
    const sv = server(happy({ '/teacher/uploads/start': (b) => { body = b; return { status: 200, json: { session: { sessionId: 'S1' } } } } }))
    await mk(sv.f, tok()).c.uploadFile({ termId: 'T', slotId: 's1', file, idempotencyKey: 'KEY-1' }, { putImpl: putOk(), sleep })
    expect(body).toEqual({ termId: 'T', slotId: 's1', name: 'خطة.pdf', size: 2048, idempotencyKey: 'KEY-1' })
  })
  it('رفض البدء (موعد مغلق/جلسة قائمة) ⇒ رسالة عربية ولا رفع للتخزين', async () => {
    for (const [code, msg] of [['deadline_closed', 'انتهى موعد'], ['active_session_exists', 'عملية رفع جارية']] as const) {
      const sv = server(happy({ '/teacher/uploads/start': () => ({ status: 409, json: { error: code } }) })); let puts = 0
      const r = await mk(sv.f, tok()).c.uploadFile({ termId: 'T', slotId: 's1', file }, { putImpl: (async () => { puts++; return new Response() }) as unknown as typeof fetch, sleep })
      expect(r.ok).toBe(false); expect(puts).toBe(0)
      if (!r.ok) expect(uploadMessage(r)).toContain(msg)
    }
  })
  it('فشل PUT إلى التخزين ⇒ تُلغى الجلسة، ولا complete', async () => {
    const sv = server(happy())
    const r = await mk(sv.f, tok()).c.uploadFile({ termId: 'T', slotId: 's1', file }, { putImpl: (async () => new Response(null, { status: 403 })) as unknown as typeof fetch, sleep })
    expect(r).toEqual({ ok: false, error: 'rejected', code: 'upload_failed' }); expect(sv.log).toContain('/teacher/uploads/cancel'); expect(sv.log).not.toContain('/teacher/uploads/complete')
    const sv2 = server(happy())
    const r2 = await mk(sv2.f, tok()).c.uploadFile({ termId: 'T', slotId: 's1', file }, { putImpl: (async () => { throw new Error('offline') }) as unknown as typeof fetch, sleep })
    expect(r2.ok).toBe(false); expect(sv2.log).toContain('/teacher/uploads/cancel')
  })
  it('رابط رفع غير https أو بطريقة غير PUT ⇒ رفض وإلغاء دون رفع', async () => {
    for (const up of [{ url: 'http://put.example/k', method: 'PUT' }, { url: 'https://put.example/k', method: 'POST' }, { url: 'javascript:1', method: 'PUT' }]) {
      const sv = server(happy({ '/teacher/uploads/presign': ok({ upload: up }) })); let puts = 0
      const r = await mk(sv.f, tok()).c.uploadFile({ termId: 'T', slotId: 's1', file }, { putImpl: (async () => { puts++; return new Response() }) as unknown as typeof fetch, sleep })
      expect(r.ok).toBe(false); expect(puts).toBe(0); expect(sv.log).toContain('/teacher/uploads/cancel')
    }
  })
  it('verification_pending (202): يُعاد complete ثم ينجح؛ وبعد 4 محاولات يُبلَّغ دون إلغاء الجلسة', async () => {
    let n = 0
    const sv = server(happy({ '/teacher/uploads/complete': () => (++n < 3 ? { status: 202, json: { error: 'verification_pending' } } : { status: 200, json: { version: { versionId: 'V9', no: 1, statusSnapshot: 'on_time' } } }) }))
    expect((await mk(sv.f, tok()).c.uploadFile({ termId: 'T', slotId: 's1', file }, { putImpl: putOk(), sleep })).ok).toBe(true); expect(n).toBe(3)
    const sv2 = server(happy({ '/teacher/uploads/complete': () => ({ status: 202, json: { error: 'verification_pending' } }) }))
    const r = await mk(sv2.f, tok()).c.uploadFile({ termId: 'T', slotId: 's1', file }, { putImpl: putOk(), sleep })
    expect(r).toEqual({ ok: false, error: 'rejected', code: 'verification_pending' }); expect(sv2.log).not.toContain('/teacher/uploads/cancel')
  })
  it('رفض complete (حجم/توقيع) ⇒ رسالة مناسبة؛ 401 يمحو الرمز؛ بلا رمز لا طلب', async () => {
    const sv = server(happy({ '/teacher/uploads/complete': () => ({ status: 409, json: { error: 'signature_mismatch' } }) }))
    const r = await mk(sv.f, tok()).c.uploadFile({ termId: 'T', slotId: 's1', file }, { putImpl: putOk(), sleep })
    expect(!r.ok && uploadMessage(r)).toContain('محتوى الملف')
    const s = tok(); const sv2 = server(happy({ '/teacher/uploads/start': () => ({ status: 401, json: { error: 'unauthenticated' } }) }))
    expect((await mk(sv2.f, s).c.uploadFile({ termId: 'T', slotId: 's1', file }, { putImpl: putOk(), sleep })).ok).toBe(false); expect(s.m.size).toBe(0)
    let n = 0
    expect((await mk((async () => { n++; return new Response('{}') }) as unknown as typeof fetch).c.uploadFile({ termId: 'T', slotId: 's1', file })).ok).toBe(false); expect(n).toBe(0)
  })
  it('حفظ الرابط: نجاح، ورفض رمزه من الخادم يظهر بالعربية', async () => {
    expect(await mk(reply(200, { version: { no: 3 }, reused: true }), tok()).c.saveLink({ termId: 'T', slotId: 's1', url: 'https://x.example' })).toEqual({ ok: true, value: { no: 3, reused: true } })
    const r = await mk(reply(400, { error: 'bad_url' }), tok()).c.saveLink({ termId: 'T', slotId: 's1', url: 'http://x' })
    expect(!r.ok && uploadMessage(r)).toContain('https')
    expect((await mk(reply(503, {}), tok()).c.saveLink({ termId: 'T', slotId: 's1', url: 'https://x.example' }))).toEqual({ ok: false, error: 'server' })
  })
})

