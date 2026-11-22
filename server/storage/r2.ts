// تخزين Cloudflare R2 الخاص (واجهة S3). يطبّق StorageAdapter نفسها التي تستعملها خدمة الرفع، ويضيف روابط موقّعة قصيرة العمر للرفع والتنزيل.
// **الحالة:** كُتب واختُبر **ببدائل فقط** (fetch وهمي يحاكي S3)، والتوقيع مُتحقَّق منه مقابل متجهَي AWS المنشورين.
// **لم يُجرَّب إطلاقًا مع R2 حقيقي** (لا حساب ولا شبكة): لا يُدَّعى أن رفعًا أو تنزيلًا حقيقيًا نجح. نقاط تحتاج تجربة فعلية موثّقة في BATCH_R20_REPORT.
// الأسرار (مفاتيح الوصول) تُحقن من بيئة المضيف وقت التشغيل؛ لا تُقرأ من ملف ولا تُكتب في الحزمة ولا تظهر في أي رسالة خطأ.
import type { DeletionAuthorization, PutInput, PutResult, StorageAdapter, StoredObject } from '../../src/lib/storage/adapter'
import { StorageError } from '../../src/lib/storage/errors'
import { assertSafeKey } from '../../src/lib/storage/keys'
import type { ProviderCapabilities } from '../../src/lib/storage/settings'
import { encodePath, presign, sha256Hex, signHeaders } from './sigv4'

export interface R2Config {
  /** معرّف حساب Cloudflare (32 خانة سداسية). */
  accountId: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  /** حد الكائن الواحد (يطابق إعداد الحجم)؛ null = بلا حد من المحوّل. */
  maxObjectBytes?: number | null
  fetchImpl?: typeof fetch
  now?: () => Date
}

export class R2ConfigError extends Error {
  constructor(m: string) { super(m); this.name = 'R2ConfigError' }
}
export class R2RequestError extends Error {
  status: number
  constructor(op: string, status: number) { super(`r2_${op}_failed:${status}`); this.name = 'R2RequestError'; this.status = status }
}

const ACCOUNT_RE = /^[0-9a-f]{32}$/i
const BUCKET_RE = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/
const MIME: Record<string, string> = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', zip: 'application/zip',
}

/** ترويسة Content-Disposition آمنة: attachment دائمًا، واسم بلا محارف تحكم أو فواصل مسار أو اقتباس. */
export function contentDisposition(name: string, inline = false): string {
  const clean = name.replace(/[\u0000-\u001f\u007f"\\/:*?<>|;]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 150) || 'file'
  const ascii = clean.replace(/[^\x20-\x7e]/g, '_')
  const star = encodeURIComponent(clean).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${star}`
}

export class R2StorageAdapter implements StorageAdapter {
  readonly id = 'r2'
  readonly capabilities: ProviderCapabilities
  private readonly cfg: Required<Pick<R2Config, 'accountId' | 'bucket'>> & { accessKeyId: string; secretAccessKey: string }
  private readonly base: string
  private readonly f: typeof fetch
  private readonly now: () => Date

  constructor(c: R2Config) {
    if (!ACCOUNT_RE.test(c.accountId ?? '')) throw new R2ConfigError('accountId غير صالح')
    if (!BUCKET_RE.test(c.bucket ?? '')) throw new R2ConfigError('اسم الحاوية غير صالح')
    if (typeof c.accessKeyId !== 'string' || c.accessKeyId.length < 8 || typeof c.secretAccessKey !== 'string' || c.secretAccessKey.length < 16) throw new R2ConfigError('مفاتيح الوصول غير مهيّأة')
    this.cfg = { accountId: c.accountId.toLowerCase(), bucket: c.bucket, accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey }
    this.base = `https://${this.cfg.accountId}.r2.cloudflarestorage.com/${this.cfg.bucket}`
    this.capabilities = { maxObjectBytes: c.maxObjectBytes ?? null }
    this.f = c.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a))
    this.now = c.now ?? (() => new Date())
  }

  private url(key: string): string { assertSafeKey(key); return `${this.base}/${encodePath(key)}` }
  private get creds() { return { accessKeyId: this.cfg.accessKeyId, secretAccessKey: this.cfg.secretAccessKey } }

  async put(input: PutInput): Promise<PutResult> {
    const url = this.url(input.key)
    const size = input.data.size
    if (size <= 0) throw new StorageError('empty')
    const cap = this.capabilities.maxObjectBytes
    if (cap !== null && size > cap) throw new StorageError('provider_limit')
    if (input.signal?.aborted) throw new StorageError('aborted')
    const bytes = new Uint8Array(await input.data.arrayBuffer())
    const sha = sha256Hex(bytes)
    // If-None-Match: * ⇒ لا كتابة فوق كائن موجود (الإصدارات لا تُعدَّل، A-44). سلوكه الفعلي على R2 لم يُجرَّب.
    const headers = signHeaders({ method: 'PUT', url, headers: { 'if-none-match': '*', ...(input.contentType ? { 'content-type': input.contentType } : {}) }, region: 'auto', creds: this.creds, now: this.now(), payloadHash: sha })
    let res: Response
    try { res = await this.f(url, { method: 'PUT', headers, body: bytes, ...(input.signal ? { signal: input.signal } : {}) }) } catch (e) {
      if (input.signal?.aborted) throw new StorageError('aborted')
      throw e
    }
    if (res.status === 412) throw new StorageError('already_exists')
    if (res.status !== 200 && res.status !== 201) throw new R2RequestError('put', res.status)
    input.onProgress?.(100)
    return { provider: this.id, key: input.key, sizeBytes: size, sha256: sha }
  }

  async get(key: string): Promise<StoredObject | null> {
    const url = this.url(key)
    const headers = signHeaders({ method: 'GET', url, region: 'auto', creds: this.creds, now: this.now(), payloadHash: sha256Hex('') })
    const res = await this.f(url, { method: 'GET', headers })
    if (res.status === 404) return null
    if (res.status !== 200) throw new R2RequestError('get', res.status)
    const bytes = new Uint8Array(await res.arrayBuffer())
    return { key, sizeBytes: bytes.byteLength, sha256: sha256Hex(bytes), data: new Blob([bytes]) }
  }

  /** الحذف غير مبني عمدًا (A-44): لا مسار حذف معتمد بعد. */
  async delete(_key: string, _authorization: DeletionAuthorization): Promise<void> {
    void _key; void _authorization
    throw new StorageError('delete_not_implemented')
  }

  /**
   * حذف كائن واحد **لمسار التصفير السنوي وحده** (A-118). اسمه صريح عمدًا ولا يمرّ عبر delete() المغلقة (A-44).
   * DeleteObject في S3/R2 يعيد 204 حتى لو الكائن غائب (idempotent)، فيصلح للاستئناف. أي حالة غير 200/204/404 ⇒ خطأ (لا نجاح صامت).
   * **لم يُجرَّب مع R2 حقيقي**: اختُبر ببدائل فقط.
   */
  async removeObjectForYearReset(key: string): Promise<void> {
    const url = this.url(key)
    const headers = signHeaders({ method: 'DELETE', url, region: 'auto', creds: this.creds, now: this.now(), payloadHash: sha256Hex('') })
    const res = await this.f(url, { method: 'DELETE', headers })
    if (res.status !== 200 && res.status !== 204 && res.status !== 404) throw new R2RequestError('delete', res.status)
  }

  /**
   * حذف ملف **حذفته المعلمة** (A-126): النهائي (files/...) أو المؤقت المرتبط به (pending/...). اسمه صريح عمدًا ولا يمرّ عبر delete() المغلقة (A-44).
   * DeleteObject idempotent: 204 حتى لو غاب الكائن. **لم يُجرَّب مع R2 حقيقي.**
   */
  async removeTeacherObject(key: string): Promise<void> {
    assertSafeKey(key)
    if (!key.startsWith('files/') && !key.startsWith('pending/')) throw new StorageError('invalid_key', 'مفتاح غير مسموح بحذفه')
    const url = this.url(key)
    const headers = signHeaders({ method: 'DELETE', url, region: 'auto', creds: this.creds, now: this.now(), payloadHash: sha256Hex('') })
    const res = await this.f(url, { method: 'DELETE', headers })
    if (res.status !== 200 && res.status !== 204 && res.status !== 404) throw new R2RequestError('delete', res.status)
  }

  /** هل الكائن موجود؟ (HEAD). 404 ⇒ false. يُستعمل للتحقق من غياب الملف بعد حذفه. */
  async objectExists(key: string): Promise<boolean> {
    const url = this.url(key)
    const headers = signHeaders({ method: 'HEAD', url, region: 'auto', creds: this.creds, now: this.now(), payloadHash: sha256Hex('') })
    const res = await this.f(url, { method: 'HEAD', headers })
    if (res.status === 200) return true
    if (res.status === 404) return false
    throw new R2RequestError('head', res.status)
  }

  /** رابط رفع PUT قصير العمر لمفتاح معلّق. يُوقَّع content-length بالحجم المعلن: يرفض R2 (حسب المتوقع) أي جسم بحجم آخر. */
  presignPut(key: string, o: { sizeBytes: number; ttlSec: number }): { url: string; method: 'PUT'; headers: Record<string, string> } {
    if (!Number.isSafeInteger(o.sizeBytes) || o.sizeBytes <= 0) throw new StorageError('empty')
    const cap = this.capabilities.maxObjectBytes
    if (cap !== null && o.sizeBytes > cap) throw new StorageError('provider_limit')
    const ttl = Math.min(Math.max(Math.floor(o.ttlSec), 1), 900)
    const url = presign({ method: 'PUT', url: this.url(key), region: 'auto', creds: this.creds, now: this.now(), expiresSec: ttl, signedHeaders: { 'content-length': String(o.sizeBytes) } })
    return { url, method: 'PUT', headers: { 'content-length': String(o.sizeBytes) } }
  }

  /** رابط تنزيل GET قصير العمر (≤ 300 ث) يفرض attachment ونوعًا محددًا من الامتداد وno-store. */
  presignGet(key: string, o: { filename: string; ext: string; ttlSec: number; inline?: boolean }): { url: string; expiresAt: Date } {
    const ttl = Math.min(Math.max(Math.floor(o.ttlSec), 1), 300)
    const url = presign({
      method: 'GET', url: this.url(key), region: 'auto', creds: this.creds, now: this.now(), expiresSec: ttl,
      query: { 'response-content-disposition': contentDisposition(o.filename, o.inline === true), 'response-content-type': MIME[o.ext.toLowerCase()] ?? 'application/octet-stream', 'response-cache-control': 'no-store' },
    })
    return { url, expiresAt: new Date(this.now().getTime() + ttl * 1000) }
  }
}
