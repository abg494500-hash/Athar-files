// مولَّد آليًا من server/services/transferService.ts بواسطة scripts/build-edge-function.mjs — لا تعدّليه يدويًا.
// خدمة النقل (الدفعة 7): رابط رفع موقّع قصير العمر لجلسة المعلمة، وتفويض تنزيل ملف إصدار برابط موقّع قصير العمر.
// **الصلاحيات:** المعلمة تنزّل ملفاتها فقط؛ المالكة والمديرة تنزّلان ملفات أي معلمة (docs/01_REQUIREMENTS §2). إصدار غير مملوك ⇒ not_found (لا كشف وجود).
// **لا تغيير في القاعدة:** قراءة فقط من upload_sessions وversions (أعمدة موجودة). **لم يُشغَّل SQL هنا على أي قاعدة**؛ الاختبار ببدائل.
import type { Db } from '../db/types.ts'
import { ServiceError } from './errors.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_UPLOAD_URL_SEC = 900
const DOWNLOAD_URL_SEC = 60
const PREVIEW_URL_SEC = 300 // المعاينة تبقى مفتوحة في إطار/صورة؛ أطول قليلًا من التنزيل المباشر
/** أنواع تُعرض بأمان: pdf وصور مباشرة، ومكتبية (docx/pptx/xlsx) عبر عارض Office المضمَّن؛ لا svg ولا html. غيرها يُنزَّل ولا يُعاين. */
const INLINE_EXT = new Set(['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'docx', 'pptx', 'xlsx'])
const OFFICE_EXT = new Set(['docx', 'pptx', 'xlsx'])
const OFFICE_PREVIEW_URL_SEC = 600 // العارض الخارجي يجلب الملف بنفسه وقد يعيد الطلب

export interface Presigner {
  presignPut(key: string, o: { sizeBytes: number; ttlSec: number }): { url: string; method: 'PUT'; headers: Record<string, string> }
  presignGet(key: string, o: { filename: string; ext: string; ttlSec: number; inline?: boolean }): { url: string; expiresAt: Date }
}

export type DownloadActor = { kind: 'teacher'; teacherId: string } | { kind: 'staff'; role: 'owner' | 'director' }

export interface UploadTarget { url: string; method: 'PUT'; headers: Record<string, string>; expiresAt: string }
export interface DownloadLink { url: string; expiresAt: string; filename: string }

interface SessRow { state: string; pending_key: string | null; declared_size: string | number; secs_left: string | number }
interface VerRow { teacher_id: string; kind: string; original_name: string | null; ext: string | null; storage_key: string | null; storage_state: string }

export class TransferService {
  private readonly db: Db
  private readonly signer: Presigner
  constructor(d: { db: Db; signer: Presigner }) { this.db = d.db; this.signer = d.signer }

  /** رابط PUT لمفتاح جلستها المعلّق. المفتاح نفسه لا يخرج؛ يخرج الرابط فقط. الحجم الموقّع = المعلن عند البدء. */
  async presignUpload(sessionId: string, teacherId: string): Promise<UploadTarget> {
    if (!UUID_RE.test(sessionId) || !UUID_RE.test(teacherId)) throw new ServiceError('bad_request')
    const row = (await this.db.transaction((c) => c.query<SessRow>(
      `select state, pending_key, declared_size, greatest(0, floor(extract(epoch from (expires_at - now()))))::int as secs_left
         from public.upload_sessions where id = $1 and teacher_id = $2`, [sessionId, teacherId])))[0]
    if (!row) throw new ServiceError('not_found')
    if (row.state !== 'started') throw new ServiceError('session_closed')
    const left = Number(row.secs_left)
    if (!row.pending_key || !(left > 0)) throw new ServiceError('session_closed')
    const ttl = Math.min(left, MAX_UPLOAD_URL_SEC)
    const p = this.signer.presignPut(row.pending_key, { sizeBytes: Number(row.declared_size), ttlSec: ttl })
    return { url: p.url, method: p.method, headers: p.headers, expiresAt: new Date(Date.now() + ttl * 1000).toISOString() }
  }

  /** inline=true ⇒ رابط معاينة (Content-Disposition: inline) لـ PDF والصور فقط؛ غير ذلك bad_request. */
  async authorizeDownload(versionId: string, actor: DownloadActor, o: { inline?: boolean } = {}): Promise<DownloadLink> {
    if (!UUID_RE.test(versionId)) throw new ServiceError('bad_request')
    if (actor.kind === 'teacher' && !UUID_RE.test(actor.teacherId)) throw new ServiceError('bad_request')
    const row = (await this.db.transaction((c) => c.query<VerRow>(
      'select teacher_id, kind, original_name, ext, storage_key, storage_state from public.versions where id = $1', [versionId])))[0]
    if (!row) throw new ServiceError('not_found')
    if (actor.kind === 'teacher' && row.teacher_id !== actor.teacherId) throw new ServiceError('not_found')
    // روابط (kind=link) لا تنزَّل من التخزين؛ ملف حُذف بعد الأرشفة ليس موجودًا للتنزيل.
    if (row.kind !== 'file' || row.storage_state !== 'present' || !row.storage_key || !row.ext) throw new ServiceError('not_found')
    const name = row.original_name ?? `file.${row.ext}`
    const inline = o.inline === true
    if (inline && !INLINE_EXT.has(row.ext.toLowerCase())) throw new ServiceError('bad_request')
    const g = this.signer.presignGet(row.storage_key, { filename: name, ext: row.ext, ttlSec: inline ? (OFFICE_EXT.has(row.ext.toLowerCase()) ? OFFICE_PREVIEW_URL_SEC : PREVIEW_URL_SEC) : DOWNLOAD_URL_SEC, ...(inline ? { inline: true } : {}) })
    return { url: g.url, expiresAt: g.expiresAt.toISOString(), filename: name }
  }
}
