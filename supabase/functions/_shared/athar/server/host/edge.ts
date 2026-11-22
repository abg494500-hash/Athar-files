// مولَّد آليًا من server/host/edge.ts بواسطة scripts/build-edge-function.mjs — لا تعدّليه يدويًا.
// مضيف دالة Edge (Supabase/Deno): يحوّل Request المعيار إلى ApiRequest ويعيد Response. منطق نقي بلا Deno ولا اعتماديات، فيُختبر في Node.
// نقطة دخول Deno الفعلية (supabase/functions/api/index.ts) تحقن `getApi` (تركيب الخدمات من الأسرار) وتستدعي Deno.serve فقط.
// قرارات: (1) الأسرار تُقرأ عند **أول طلب** لا عند التحميل (فشل الإعداد يصير 503 not_configured لا انهيار)؛ (2) الجسم يُقرأ بحد 16KB+ بدل تحميله كاملًا؛
// (3) عنوان العميل من `cf-connecting-ip` فقط (تضعه البنية الأمامية)؛ غيابه ⇒ undefined ⇒ لا تقييد بالعنوان (التقييد بالحساب يبقى)؛
// (4) لا يُسجَّل جسم ولا ترويسات ولا رموز؛ يُسجَّل اسم المتغير الناقص فقط عند ComposeError.
import type { ApiRequest, ApiResponse } from '../api/handler.ts'

export type ApiFn = (r: ApiRequest) => Promise<ApiResponse>

export interface EdgeHostOptions {
  getApi: () => Promise<ApiFn>
  /** اسم الدالة في Supabase (يظهر في المسار: /api/teacher/login). */
  functionName?: string
  onError?: (e: unknown) => void
  version?: string
}

const MAX_BODY_BYTES = 16 * 1024
const READ_LIMIT = MAX_BODY_BYTES + 1
const IPV4_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/
const IPV6_RE = /^[0-9a-fA-F:]{2,45}$/
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }

const json = (status: number, data: unknown, extra: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...extra } })

/** يزيل بادئة اسم الدالة (و/functions/v1) ويثبّت الشرطة المائلة الأخيرة. */
export function normalizePath(pathname: string, fn: string): string {
  let p = pathname
  for (const prefix of [`/functions/v1/${fn}`, `/${fn}`]) {
    if (p === prefix || p.startsWith(prefix + '/')) { p = p.slice(prefix.length); break }
  }
  if (p === '') p = '/'
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1)
  return p
}

async function readLimited(req: Request): Promise<{ text: string } | { tooLarge: true } | { invalid: true }> {
  if (!req.body) return { text: '' }
  const declared = Number(req.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return { tooLarge: true }
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > READ_LIMIT) { void reader.cancel().catch(() => undefined); return { tooLarge: true } }
    chunks.push(value)
  }
  const all = new Uint8Array(total)
  let off = 0
  for (const c of chunks) { all.set(c, off); off += c.byteLength }
  try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(all) } } catch { return { invalid: true } }
}

export function createEdgeHandler(o: EdgeHostOptions): (req: Request) => Promise<Response> {
  const fn = o.functionName ?? 'api'
  let api: Promise<ApiFn> | null = null
  const getApi = (): Promise<ApiFn> => {
    // نخزّن النجاح فقط؛ فشل الإعداد يُعاد تجربته في الطلب التالي (بعد تصحيح الأسرار دون إعادة نشر).
    if (!api) api = o.getApi().catch((e) => { api = null; throw e })
    return api
  }

  return async (req) => {
    try {
      const url = new URL(req.url)
      const path = normalizePath(url.pathname, fn)
      if (req.method === 'GET' && path === '/health') return json(200, { ok: true, service: 'athar-api', ...(o.version ? { version: o.version } : {}) })
      if (req.method !== 'GET' && req.method !== 'POST' && req.method !== 'OPTIONS') return json(405, { error: 'method_not_allowed' }, { allow: 'GET, POST, OPTIONS' })

      let body: string | null = null
      if (req.method === 'POST') {
        const r = await readLimited(req)
        if ('tooLarge' in r) return json(413, { error: 'body_too_large' })
        if ('invalid' in r) return json(400, { error: 'bad_request' })
        body = r.text
      }

      const headers: Record<string, string> = {}
      req.headers.forEach((v, k) => { headers[k.toLowerCase()] = v })
      const query: Record<string, string> = {}
      url.searchParams.forEach((v, k) => { if (!(k in query)) query[k] = v })
      const cf = headers['cf-connecting-ip']
      const ip = cf && (IPV4_RE.test(cf) || IPV6_RE.test(cf)) ? cf : undefined

      let handle: ApiFn
      try { handle = await getApi() } catch (e) {
        o.onError?.(e)
        const notConfigured = e instanceof Error && e.name === 'ComposeError'
        return json(notConfigured ? 503 : 500, { error: notConfigured ? 'not_configured' : 'internal_error' })
      }
      const res = await handle({ method: req.method, path, query, headers, body, ...(ip ? { ip } : {}) })
      return new Response(res.status === 204 ? null : res.body, { status: res.status, headers: res.headers })
    } catch (e) {
      o.onError?.(e)
      return json(500, { error: 'internal_error' })
    }
  }
}
