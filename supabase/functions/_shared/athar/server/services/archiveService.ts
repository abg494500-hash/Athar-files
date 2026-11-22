// مولَّد آليًا من server/services/archiveService.ts بواسطة scripts/build-edge-function.mjs — لا تعدّليه يدويًا.
// خدمة نقل الأرشيفات السحابية القديمة (A-118). **لا إنشاء ولا رفع ولا كتابة في التخزين هنا إطلاقًا**: أُلغيت الأرشفة السحابية (فصل/معلمة/سنة)؛
// الأرشفة الوحيدة هي السنوية المحلية (yearArchiveService). تبقى هذه الخدمة لشيء واحد: أرشيفات قديمة سبق أن رُفعت إلى R2 قبل القرار —
// تُنزَّل إلى اللابتوب وتُتحقَّق بصمتها، ثم يحذفها التصفير السنوي من R2 مع سنتها (ويمنع التصفير ما لم يُتحقَّق تنزيلها).
import type { Db } from '../db/types.ts'
import { ServiceError } from './errors.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface ArchivePresigner { presignGet(key: string, o: { filename: string; ext: string; ttlSec: number }): { url: string; expiresAt: Date } }

export interface ArchiveDownload { url: string; expiresAt: string; filename: string; sha256: string; sizeBytes: number }
export interface DownloadConfirmation { archiveId: string; verified: boolean; confirmedAt: string | null }
export interface LegacyArchive { id: string; title: string; yearId: string; createdAt: string; sizeBytes: number; sha256: string; transferredAt: string | null }

export class ArchiveService {
  private readonly db: Db
  private readonly signer: ArchivePresigner
  constructor(d: { db: Db; signer: ArchivePresigner }) { this.db = d.db; this.signer = d.signer }

  /** الأرشيفات السحابية القديمة الموجودة فعلًا في التخزين (لم تُحذف بعد). */
  async listLegacy(): Promise<LegacyArchive[]> {
    const rows = await this.db.transaction((c) => c.query<{ id: string; title: string; year_id: string; created_at: string; size_bytes: string | number; sha256: string; hv: string | null }>(
      `select id, title, year_id, to_char(created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at, size_bytes, sha256,
              to_char(download_hash_verified_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as hv
         from public.archives where coalesce(storage_provider, '') <> 'local-download' and storage_key is not null and sha256 is not null and state = 'verified' and deleted_at is null order by created_at`))
    return rows.map((r) => ({ id: r.id, title: r.title, yearId: r.year_id, createdAt: r.created_at, sizeBytes: Number(r.size_bytes), sha256: r.sha256, transferredAt: r.hv }))
  }

  /** رابط تنزيل قصير العمر لأرشيف مسجَّل (المالكة فقط يُفرض في طبقة HTTP). يعيد البصمة لمقارنتها بعد التنزيل (DP-05). */
  async authorizeDownload(archiveId: string): Promise<ArchiveDownload> {
    if (!UUID_RE.test(archiveId)) throw new ServiceError('bad_request')
    const r = (await this.db.transaction((c) => c.query<{ state: string; storage_key: string | null; sha256: string | null; size_bytes: string | number | null; storage_provider: string | null }>(
      'select state, storage_key, sha256, size_bytes, storage_provider from public.archives where id = $1 and deleted_at is null', [archiveId])))[0]
    // أرشيف سنوي مبني في المتصفح (local-download) لا نسخة له في التخزين: لا رابط تنزيل له.
    if (!r || r.state !== 'verified' || !r.storage_key || !r.sha256 || r.size_bytes === null || r.storage_provider === 'local-download') throw new ServiceError('not_found')
    const filename = `athar-archive-${archiveId}.zip`
    const g = this.signer.presignGet(r.storage_key, { filename, ext: 'zip', ttlSec: 120 })
    return { url: g.url, expiresAt: g.expiresAt.toISOString(), filename, sha256: r.sha256, sizeBytes: Number(r.size_bytes) }
  }

  /**
   * تأكيد بصمة التنزيل (A-32/DP-05): المتصفح ينزّل الأرشيف ويحسب SHA-256 محليًا ويرسله؛ الخادم يقارنه بالبصمة المسجَّلة وقت الإنشاء.
   * التطابق ⇒ يُكتب download_completed_at وdownload_hash_verified_at (يُكتبان مرة واحدة؛ القاعدة تمنع تغييرهما بعد ضبطهما، 007) وأثر دائم؛
   * عدم التطابق ⇒ أثر دائم `archive.download_hash_mismatch` ولا يُكتب شيء آخر. هذا **لا** يعني اكتمال الإرسال (يلزمه إقرار النسخة الثانية يدويًا).
   */
  async confirmDownload(i: { archiveId: string; sha256: string; actorUserId: string }): Promise<DownloadConfirmation> {
    if (!UUID_RE.test(i.archiveId) || !UUID_RE.test(i.actorUserId)) throw new ServiceError('bad_request')
    const claimed = typeof i.sha256 === 'string' ? i.sha256.trim().toLowerCase() : ''
    if (!/^[0-9a-f]{64}$/.test(claimed)) throw new ServiceError('bad_request')
    return this.db.transaction(async (c) => {
      const r = (await c.query<{ state: string; sha256: string | null; storage_provider: string | null }>('select state, sha256, storage_provider from public.archives where id = $1 and deleted_at is null for update', [i.archiveId]))[0]
      // الأرشيف السنوي المحلي يُؤكَّد جزءًا جزءًا (confirmPart)؛ لا ختم تنزيل بتأكيد واحد.
      if (!r || r.state !== 'verified' || !r.sha256 || r.storage_provider === 'local-download') throw new ServiceError('not_found')
      const ok = r.sha256 === claimed
      await c.exec(`select public.log_audit_as($1::uuid, $2, 'archive', $3, $4::jsonb)`,
        [i.actorUserId, ok ? 'archive.download_verified' : 'archive.download_hash_mismatch', i.archiveId, JSON.stringify({ expected: r.sha256, claimed })])
      if (!ok) return { archiveId: i.archiveId, verified: false, confirmedAt: null }
      const u = (await c.query<{ at: string }>(
        `update public.archives set download_completed_at = coalesce(download_completed_at, now()), download_hash_verified_at = coalesce(download_hash_verified_at, now())
          where id = $1 returning to_char(download_hash_verified_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as at`, [i.archiveId]))[0]
      return { archiveId: i.archiveId, verified: true, confirmedAt: u?.at ?? null }
    })
  }
}
