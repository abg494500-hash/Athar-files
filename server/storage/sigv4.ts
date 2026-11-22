// AWS Signature V4 لخدمة متوافقة مع S3 (Cloudflare R2): توقيع ترويسات + روابط موقّعة مسبقًا. بلا اعتماديات (node:crypto فقط).
// **التحقق:** يُختبر مقابل متجهَي الاختبار المنشورين في توثيق AWS S3 (GET Object بترويسات، وPresigned GET)، وهما مرجع مستقل عن هذا الكود.
// لم يُجرَّب مع R2 الحقيقي (لا حساب ولا شبكة هنا).
import { Buffer } from 'node:buffer'
import { createHash, createHmac } from 'node:crypto'

export interface Credentials { accessKeyId: string; secretAccessKey: string }

const enc = (s: string): string => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
/** ترميز مسار S3: كل مقطع يُرمَّز مرة واحدة والفاصل «/» يبقى (S3 لا يضاعف الترميز). */
export const encodePath = (p: string): string => p.split('/').map(enc).join('/')
export const sha256Hex = (d: string | Uint8Array): string => createHash('sha256').update(d).digest('hex')
const hmac = (k: string | Buffer, d: string): Buffer => createHmac('sha256', k).update(d).digest()

export function amzDate(now: Date): { date: string; stamp: string } {
  const iso = now.toISOString().replace(/[-:]|\.\d{3}/g, '') // 20130524T000000Z
  return { stamp: iso, date: iso.slice(0, 8) }
}
function signingKey(secret: string, date: string, region: string, service: string): Buffer {
  return hmac(hmac(hmac(hmac('AWS4' + secret, date), region), service), 'aws4_request')
}
function canonicalQuery(q: Record<string, string>): string {
  return Object.keys(q).map((k) => [enc(k), enc(q[k] as string)] as const).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join('&')
}

export interface SignInput {
  method: string
  /** عنوان كامل https://host/path (بلا استعلام؛ الاستعلام في query). */
  url: string
  query?: Record<string, string>
  /** ترويسات تُوقَّع (أسماؤها بأحرف صغيرة). host يُضاف تلقائيًا. */
  headers?: Record<string, string>
  region: string
  service?: string
  creds: Credentials
  now: Date
}

/** توقيع بالترويسات: يعيد الترويسات الكاملة للإرسال (مع x-amz-date وx-amz-content-sha256 وAuthorization). */
export function signHeaders(i: SignInput & { payloadHash: string }): Record<string, string> {
  const u = new URL(i.url)
  const service = i.service ?? 's3'
  const { date, stamp } = amzDate(i.now)
  const h: Record<string, string> = { ...(i.headers ?? {}), host: u.host, 'x-amz-content-sha256': i.payloadHash, 'x-amz-date': stamp }
  const names = Object.keys(h).map((n) => n.toLowerCase()).sort()
  const lower = Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), v.trim().replace(/\s+/g, ' ')]))
  const canonicalHeaders = names.map((n) => `${n}:${lower[n]}\n`).join('')
  const signed = names.join(';')
  const canonical = [i.method.toUpperCase(), encodePath(decodeURIComponent(u.pathname)), canonicalQuery(i.query ?? {}), canonicalHeaders, signed, i.payloadHash].join('\n')
  const scope = `${date}/${i.region}/${service}/aws4_request`
  const sts = ['AWS4-HMAC-SHA256', stamp, scope, sha256Hex(canonical)].join('\n')
  const sig = createHmac('sha256', signingKey(i.creds.secretAccessKey, date, i.region, service)).update(sts).digest('hex')
  return { ...h, authorization: `AWS4-HMAC-SHA256 Credential=${i.creds.accessKeyId}/${scope}, SignedHeaders=${signed}, Signature=${sig}` }
}

export interface PresignInput extends SignInput {
  expiresSec: number
  /** ترويسات إضافية موقّعة يلزم أن يرسلها المتصل كما هي (مثل content-length). */
  signedHeaders?: Record<string, string>
}

/** رابط موقّع مسبقًا (الاستعلام): الحمولة UNSIGNED-PAYLOAD. expiresSec بين 1 و604800. */
export function presign(i: PresignInput): string {
  if (!Number.isInteger(i.expiresSec) || i.expiresSec < 1 || i.expiresSec > 604_800) throw new Error('expiresSec غير صالح')
  const u = new URL(i.url)
  const service = i.service ?? 's3'
  const { date, stamp } = amzDate(i.now)
  const extra = Object.fromEntries(Object.entries(i.signedHeaders ?? {}).map(([k, v]) => [k.toLowerCase(), v.trim()]))
  const hdr: Record<string, string> = { host: u.host, ...extra }
  const names = Object.keys(hdr).sort()
  const signed = names.join(';')
  const scope = `${date}/${i.region}/${service}/aws4_request`
  const q: Record<string, string> = {
    ...(i.query ?? {}),
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${i.creds.accessKeyId}/${scope}`,
    'X-Amz-Date': stamp,
    'X-Amz-Expires': String(i.expiresSec),
    'X-Amz-SignedHeaders': signed,
  }
  const cq = canonicalQuery(q)
  const canonical = [i.method.toUpperCase(), encodePath(decodeURIComponent(u.pathname)), cq, names.map((n) => `${n}:${hdr[n]}\n`).join(''), signed, 'UNSIGNED-PAYLOAD'].join('\n')
  const sts = ['AWS4-HMAC-SHA256', stamp, scope, sha256Hex(canonical)].join('\n')
  const sig = createHmac('sha256', signingKey(i.creds.secretAccessKey, date, i.region, service)).update(sts).digest('hex')
  return `${u.origin}${u.pathname}?${cq}&X-Amz-Signature=${sig}`
}
