// خدمة الأرشيف السنوي (A-115 r35، وتقسيمه إلى أجزاء A-116 r35.1). **الأرشيف يُبنى في متصفح المالكة** (يسحب الملفات بروابط قصيرة العمر ويتحقق من بصماتها ويبني ZIP محليًا)،
// فلا تُحفظ منه أي نسخة في R2. دور الخادم: (1) plan: يعطي بيانات السنة كاملة (قراءة فقط) (2) urls: روابط GET قصيرة لدفعات من الملفات
// (3) register: يعيد حساب ملخّص «كل نسخة + بصمتها» من القاعدة ويقارنه بما بُني، فإن تطابق سجّل الأرشيف وعناصره (archive_entries) كلها
// (4) ack: إقرارات المالكة بعد التنزيل (فتحه محليًا، نسخة ثانية). **لا حذف ولا تعديل لأي بيانات أصلية هنا** (A-44).
import { createHash } from 'node:crypto'
import { Buffer } from 'node:buffer'
import type { Db } from '../db/types'
import { ServiceError } from './errors'
import type { PlanVersion, YearPlan } from '../../src/lib/yearArchive/types'
import { DEFAULT_PART_BYTES, MAX_FILE_BYTES, MAX_PARTS, MAX_PART_BYTES, MIN_PART_BYTES, PART_FILENAME_RE, entriesDigestText, linkEntryText, partitionVersions, partsDigestText, versionEntryPath } from '../../src/lib/yearArchive/paths'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HEX64 = /^[0-9a-f]{64}$/
export const MAX_URLS_PER_CALL = 40
const URL_TTL_SEC = 300
export const LOCAL_PROVIDER = 'local-download'

export interface YearUrlSigner { presignGet(key: string, o: { filename: string; ext: string; ttlSec: number }): { url: string; expiresAt: Date } }
const sha256Text = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')

interface VersionRow {
  id: string; teacher_id: string; term_id: string; term_ord: number | string; slot_id: string; no: number | string; kind: string
  original_name: string | null; size_bytes: string | number | null; mime_verified: string | null; ext: string | null; sha256: string | null
  url: string | null; submitted_at: string; status_snapshot: string; deadlines_snapshot: unknown; storage_state: string; replaced_note: string | null
  storage_key?: string | null
}

const VERSION_SELECT = `select v.id, v.teacher_id, v.term_id, t.ord as term_ord, v.slot_id, v.no, v.kind, v.original_name, v.size_bytes, v.mime_verified, v.ext, v.sha256, v.url,
       to_char(v.submitted_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as submitted_at, v.status_snapshot, v.deadlines_snapshot, v.storage_state, v.replaced_note`

export type { PlanVersion, YearPlan }
const targetOk = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= MIN_PART_BYTES && n <= MAX_PART_BYTES
const PART_MEDIA = ['external_drive', 'usb_flash', 'cloud', 'other_computer'] as const
export type CopyMedium = (typeof PART_MEDIA)[number]
const digestOf = (vs: PlanVersion[]) => sha256Text(entriesDigestText(vs.map((v) => ({ id: v.id, sha256: v.entrySha256, part: v.partNo }))))
/** يوزّع النسخ على الأجزاء (يعدّل partNo) ويعيد وصف الأجزاء. */
function layout(vs: PlanVersion[], targetBytes: number): YearPlan['layout'] {
  const { partOf, parts } = partitionVersions(vs, targetBytes)
  for (const v of vs) v.partNo = partOf.get(v.id)!
  return { targetBytes, parts }
}

export interface RegisterPart { no: number; filename: string; sha256: string; size: number }
export interface RegisterInput { yearId: string; title: string; targetBytes: number; parts: RegisterPart[]; entriesDigest: string; actorUserId: string }
export interface YearArchiveRecord { id: string; state: 'verified'; entries: number; files: number; links: number; sizeBytes: number; sha256: string; parts: number }

function toPlanVersion(r: VersionRow): PlanVersion {
  const kind = r.kind === 'link' ? 'link' : 'file'
  const entryPath = versionEntryPath({ id: r.id, termOrd: Number(r.term_ord), teacherId: r.teacher_id, slotId: r.slot_id, no: Number(r.no), kind, ext: r.ext, originalName: r.original_name })
  const text = kind === 'link' ? linkEntryText(r.url ?? '') : ''
  return {
    id: r.id, teacherId: r.teacher_id, termId: r.term_id, termOrd: Number(r.term_ord), slotId: r.slot_id, no: Number(r.no), kind,
    originalName: r.original_name, sizeBytes: r.size_bytes === null ? null : Number(r.size_bytes), mime: r.mime_verified, ext: r.ext, sha256: r.sha256, url: r.url,
    submittedAt: r.submitted_at, status: r.status_snapshot, deadlines: r.deadlines_snapshot, replacedNote: r.replaced_note, entryPath, partNo: 1,
    entrySize: kind === 'link' ? Buffer.byteLength(text, 'utf8') : Number(r.size_bytes ?? 0),
    entrySha256: kind === 'link' ? sha256Text(text) : String(r.sha256 ?? ''),
  }
}

export class YearArchiveService {
  private readonly db: Db
  private readonly signer: YearUrlSigner
  private readonly newId: () => string
  constructor(d: { db: Db; signer: YearUrlSigner; newId?: () => string }) {
    this.db = d.db; this.signer = d.signer
    this.newId = d.newId ?? (() => globalThis.crypto.randomUUID())
  }

  async plan(yearId: string, targetBytes: number = DEFAULT_PART_BYTES): Promise<YearPlan> {
    if (!UUID_RE.test(yearId) || !targetOk(targetBytes)) throw new ServiceError('bad_request')
    return this.db.transaction(async (c) => {
      const y = (await c.query<{ id: string; label: string; is_active: boolean; created_at: string }>(
        `select id, label, is_active, to_char(created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at from public.years where id = $1`, [yearId]))[0]
      if (!y) throw new ServiceError('not_found')
      const terms = await c.query<{ id: string; name: string; ord: number; b: string; l: string; r: string }>(
        `select id, name, ord, deadline_base::text as b, deadline_late::text as l, deadline_replace::text as r from public.terms where year_id = $1 order by ord`, [yearId])
      const teachers = await c.query<{ id: string; name: string; subject: string; is_active: boolean; color_idx: number; created_at: string; removed_at: string | null; code_state: string | null; issued: string | null; expires: string | null }>(
        `select t.id, t.name, t.subject, t.is_active, t.color_idx, to_char(t.created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at,
                case when t.removed_at is null then null else to_char(t.removed_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') end as removed_at,
                tc.code_state, to_char(tc.code_issued_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as issued, to_char(tc.code_expires_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as expires
           from public.teachers t left join public.teacher_credentials tc on tc.teacher_id = t.id order by t.created_at, t.id`)
      const slots = await c.query<{ id: string; title: string; optional: boolean; ord: number }>('select id, title, optional, ord from public.slots order by ord')
      const subs = await c.query<{ teacher_id: string; term_id: string; slot_id: string; created_at: string }>(
        `select s.teacher_id, s.term_id, s.slot_id, to_char(s.created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at
           from public.submissions s join public.terms t on t.id = s.term_id where t.year_id = $1 order by t.ord, s.teacher_id, s.slot_id`, [yearId])
      const vrows = await c.query<VersionRow>(
        `${VERSION_SELECT} from public.versions v join public.terms t on t.id = v.term_id where t.year_id = $1 order by t.ord, v.teacher_id, v.slot_id, v.no`, [yearId])
      const versions = vrows.map(toPlanVersion)
      const lay = layout(versions, targetBytes)
      const problems = [
        ...vrows.filter((r) => r.kind === 'file' && r.storage_state !== 'present').map((r) => ({ versionId: r.id, reason: 'file_not_present' })),
        ...vrows.filter((r) => r.kind === 'file' && Number(r.size_bytes ?? 0) > MAX_FILE_BYTES).map((r) => ({ versionId: r.id, reason: 'file_too_large' })),
      ]
      if (lay.parts.length > MAX_PARTS) problems.push({ versionId: '', reason: 'too_many_parts' })
      const files = versions.filter((v) => v.kind === 'file')
      return {
        year: { id: y.id, label: y.label, active: y.is_active, createdAt: y.created_at },
        terms: terms.map((t) => ({ id: t.id, name: t.name, ord: Number(t.ord), deadlineBase: t.b, deadlineLate: t.l, deadlineReplace: t.r })),
        teachers: teachers.map((t) => ({ id: t.id, name: t.name, subject: t.subject, active: t.is_active, colorIdx: Number(t.color_idx), createdAt: t.created_at, removedAt: t.removed_at,
          credential: t.code_state ? { state: t.code_state, issuedAt: t.issued, expiresAt: t.expires } : null })),
        slots: slots.map((s) => ({ id: s.id, title: s.title, optional: s.optional, ord: Number(s.ord) })),
        submissions: subs.map((s) => ({ teacherId: s.teacher_id, termId: s.term_id, slotId: s.slot_id, createdAt: s.created_at })),
        versions, problems, layout: lay,
        totals: { teachers: teachers.length, terms: terms.length, submissions: subs.length, versions: versions.length, files: files.length, links: versions.length - files.length, fileBytes: files.reduce((n, v) => n + (v.sizeBytes ?? 0), 0) },
        entriesDigest: digestOf(versions),
      }
    })
  }

  /** روابط GET قصيرة (≤ 300 ث) لدفعة نسخ ملفات تتبع هذه السنة فقط. */
  async urls(yearId: string, versionIds: readonly string[]): Promise<{ versionId: string; url: string; expiresAt: string }[]> {
    if (!UUID_RE.test(yearId) || !Array.isArray(versionIds) || versionIds.length === 0 || versionIds.length > MAX_URLS_PER_CALL || !versionIds.every((x) => typeof x === 'string' && UUID_RE.test(x))) throw new ServiceError('bad_request')
    const rows = await this.db.transaction((c) => c.query<{ id: string; kind: string; ext: string | null; original_name: string | null; storage_key: string | null; storage_state: string }>(
      `select v.id, v.kind, v.ext, v.original_name, v.storage_key, v.storage_state
         from public.versions v join public.terms t on t.id = v.term_id
        where t.year_id = $1 and v.id in (select value::uuid from jsonb_array_elements_text($2::jsonb))`, [yearId, JSON.stringify(versionIds)]))
    if (rows.length !== new Set(versionIds).size) throw new ServiceError('not_found')
    return rows.map((r) => {
      if (r.kind !== 'file' || r.storage_state !== 'present' || !r.storage_key || !r.ext) throw new ServiceError('files_missing')
      const g = this.signer.presignGet(r.storage_key, { filename: r.original_name ?? `file.${r.ext}`, ext: r.ext, ttlSec: URL_TTL_SEC })
      return { versionId: r.id, url: g.url, expiresAt: g.expiresAt.toISOString() }
    })
  }

  async register(i: RegisterInput): Promise<YearArchiveRecord> {
    const title = typeof i.title === 'string' ? i.title.trim() : ''
    const partsOk = Array.isArray(i.parts) && i.parts.length >= 1 && i.parts.length <= MAX_PARTS && i.parts.every((p, k) =>
      p && p.no === k + 1 && typeof p.filename === 'string' && PART_FILENAME_RE.test(p.filename) && HEX64.test(p.sha256) && Number.isSafeInteger(p.size) && p.size > 0)
    if (!UUID_RE.test(i.yearId) || !UUID_RE.test(i.actorUserId) || title === '' || title.length > 200 || /[\u0000-\u001f]/.test(title)
        || !HEX64.test(i.entriesDigest) || !targetOk(i.targetBytes) || !partsOk || new Set(i.parts.map((p) => p.filename)).size !== i.parts.length) throw new ServiceError('bad_request')
    const id = this.newId()
    return this.db.transaction(async (c) => {
      // قفل صف السنة: لا تسجيلان متزامنان لنفس السنة.
      const y = (await c.query<{ id: string }>('select id from public.years where id = $1 for update', [i.yearId]))[0]
      if (!y) throw new ServiceError('not_found')
      const vrows = await c.query<VersionRow>(`${VERSION_SELECT} from public.versions v join public.terms t on t.id = v.term_id where t.year_id = $1 order by v.id`, [i.yearId])
      if (vrows.some((r) => r.kind === 'file' && (r.storage_state !== 'present' || Number(r.size_bytes ?? 0) > MAX_FILE_BYTES))) throw new ServiceError('files_missing')
      const versions = vrows.map(toPlanVersion)
      const lay = layout(versions, i.targetBytes)
      // الأجزاء المبنية يجب أن تطابق تقسيم الخادم عددًا، وملخّص (نسخة، بصمة، جزء) يطابق القاعدة تمامًا.
      if (lay.parts.length !== i.parts.length || digestOf(versions) !== i.entriesDigest) throw new ServiceError('year_changed')
      const files = versions.filter((v) => v.kind === 'file').length
      const total = i.parts.reduce((n, p) => n + p.size, 0)
      await c.exec(
        `insert into public.archives (id, title, year_id, term_id, teacher_id, created_by, state, size_bytes, entries_count, sha256, storage_provider, storage_key, manifest_sha256, checks)
         values ($1, $2, $3, null, null, $4, 'awaiting_verification', $5, $6, $7, $8, $9, $10, $11::jsonb)`,
        [id, title, i.yearId, i.actorUserId, total, versions.length, sha256Text(partsDigestText(i.parts)), LOCAL_PROVIDER, `local/${id}`, i.entriesDigest,
         JSON.stringify([{ check: 'built_in_browser_sources_sha256_verified', ok: true }, { check: 'entries_digest_matches_database', ok: true }, { check: 'parts', ok: true, count: i.parts.length, targetBytes: i.targetBytes }])])
      await c.exec(
        `insert into public.archive_parts (archive_id, part_no, filename, sha256, size_bytes, entries_count)
         select $1::uuid, x.no, x.filename, x.sha, x.size, x.entries from jsonb_to_recordset($2::jsonb) as x(no int, filename text, sha text, size bigint, entries int)`,
        [id, JSON.stringify(i.parts.map((p) => ({ no: p.no, filename: p.filename, sha: p.sha256, size: p.size, entries: lay.parts[p.no - 1]!.entries })))])
      if (versions.length > 0) {
        await c.exec(
          `insert into public.archive_entries (archive_id, version_id, path_in_zip, sha256, size_bytes, part_no)
           select $1::uuid, x.version_id, x.path, x.sha, x.size, x.part from jsonb_to_recordset($2::jsonb) as x(version_id uuid, path text, sha text, size bigint, part int)`,
          [id, JSON.stringify(versions.map((v) => ({ version_id: v.id, path: v.entryPath, sha: v.entrySha256, size: v.entrySize, part: v.partNo })))])
      }
      await c.exec(`update public.archives set state = 'verified' where id = $1 and state = 'awaiting_verification'`, [id])
      return { id, state: 'verified' as const, entries: versions.length, files, links: versions.length - files, sizeBytes: total, sha256: sha256Text(partsDigestText(i.parts)), parts: i.parts.length }
    })
  }

  /** تحقق جزء من الأصل المحفوظ على الجهاز: البصمة المحسوبة محليًا تُقارَن بالمسجَّلة؛ عند تحقق كل الأجزاء يُختم «نُزّل وتحقق». */
  async confirmPart(i: { archiveId: string; partNo: number; sha256: string; actorUserId: string }): Promise<{ archiveId: string; partNo: number; verified: boolean; allPartsVerified: boolean }> {
    const claimed = typeof i.sha256 === 'string' ? i.sha256.trim().toLowerCase() : ''
    if (!UUID_RE.test(i.archiveId) || !UUID_RE.test(i.actorUserId) || !Number.isInteger(i.partNo) || i.partNo < 1 || !HEX64.test(claimed)) throw new ServiceError('bad_request')
    return this.db.transaction(async (c) => {
      const a = (await c.query<{ state: string }>(`select state from public.archives where id = $1 and term_id is null and teacher_id is null and storage_provider = $2 and deleted_at is null for update`, [i.archiveId, LOCAL_PROVIDER]))[0]
      if (!a || a.state !== 'verified') throw new ServiceError('not_found')
      const p = (await c.query<{ sha256: string }>('select sha256 from public.archive_parts where archive_id = $1 and part_no = $2 for update', [i.archiveId, i.partNo]))[0]
      if (!p) throw new ServiceError('not_found')
      const ok = p.sha256 === claimed
      await c.exec(`select public.log_audit_as($1::uuid, $2, 'archive', $3, $4::jsonb)`, [i.actorUserId, ok ? 'archive.part_verified' : 'archive.part_hash_mismatch', i.archiveId, JSON.stringify({ part: i.partNo, expected: p.sha256, claimed })])
      if (!ok) return { archiveId: i.archiveId, partNo: i.partNo, verified: false, allPartsVerified: false }
      await c.exec('update public.archive_parts set verified_at = coalesce(verified_at, now()) where archive_id = $1 and part_no = $2', [i.archiveId, i.partNo])
      const left = (await c.query<{ n: string }>('select count(*)::text as n from public.archive_parts where archive_id = $1 and verified_at is null', [i.archiveId]))[0]!.n
      const all = left === '0'
      if (all) {
        const r = await c.query<{ x: number }>(`update public.archives set download_completed_at = coalesce(download_completed_at, now()), download_hash_verified_at = coalesce(download_hash_verified_at, now()) where id = $1 returning 1 as x`, [i.archiveId])
        if (r[0]) await c.exec(`select public.log_audit_as($1::uuid, 'archive.download_verified', 'archive', $2, $3::jsonb)`, [i.actorUserId, i.archiveId, JSON.stringify({ parts: 'all' })])
      }
      return { archiveId: i.archiveId, partNo: i.partNo, verified: true, allPartsVerified: all }
    })
  }

  /** تحقق النسخة الثانية: بصمة ملف الجزء في الوسيط المستقل تُقارَن بالمسجَّلة. لا يُقبل قبل تحقق الأصل. عند تحقق كل الأجزاء يُختم إقرار النسخة الثانية (مُتحقَّقًا منه لا مجرد قول). */
  async confirmCopy(i: { archiveId: string; partNo: number; sha256: string; medium: string; independent: boolean; actorUserId: string }): Promise<{ archiveId: string; partNo: number; verified: boolean; allCopiesVerified: boolean }> {
    const claimed = typeof i.sha256 === 'string' ? i.sha256.trim().toLowerCase() : ''
    if (!UUID_RE.test(i.archiveId) || !UUID_RE.test(i.actorUserId) || !Number.isInteger(i.partNo) || i.partNo < 1 || !HEX64.test(claimed) || !(PART_MEDIA as readonly string[]).includes(i.medium) || i.independent !== true) throw new ServiceError('bad_request') // إقرار المالكة الصريح بأن الوسيط مستقل عن اللابتوب إلزامي (لا يُثبته المتصفح)
    return this.db.transaction(async (c) => {
      const a = (await c.query<{ state: string }>(`select state from public.archives where id = $1 and term_id is null and teacher_id is null and storage_provider = $2 and deleted_at is null for update`, [i.archiveId, LOCAL_PROVIDER]))[0]
      if (!a || a.state !== 'verified') throw new ServiceError('not_found')
      const p = (await c.query<{ sha256: string; verified_at: string | null }>('select sha256, verified_at::text as verified_at from public.archive_parts where archive_id = $1 and part_no = $2 for update', [i.archiveId, i.partNo]))[0]
      if (!p) throw new ServiceError('not_found')
      if (p.verified_at === null) throw new ServiceError('not_ready')
      const ok = p.sha256 === claimed
      await c.exec(`select public.log_audit_as($1::uuid, $2, 'archive', $3, $4::jsonb)`, [i.actorUserId, ok ? 'archive.copy_verified' : 'archive.copy_hash_mismatch', i.archiveId, JSON.stringify({ part: i.partNo, medium: i.medium, owner_declared_independent: true, expected: p.sha256, claimed })])
      if (!ok) return { archiveId: i.archiveId, partNo: i.partNo, verified: false, allCopiesVerified: false }
      await c.exec('update public.archive_parts set copy_verified_at = coalesce(copy_verified_at, now()), copy_medium = coalesce(copy_medium, $3) where archive_id = $1 and part_no = $2', [i.archiveId, i.partNo, i.medium])
      const left = (await c.query<{ n: string }>('select count(*)::text as n from public.archive_parts where archive_id = $1 and copy_verified_at is null', [i.archiveId]))[0]!.n
      const all = left === '0'
      if (all) await c.exec(`update public.archives set backup_ack_by = coalesce(backup_ack_by, $2), backup_ack_at = coalesce(backup_ack_at, now()), backup_ack_note = coalesce(backup_ack_note, $3) where id = $1`, [i.archiveId, i.actorUserId, `verified_copy:${i.medium}`])
      return { archiveId: i.archiveId, partNo: i.partNo, verified: true, allCopiesVerified: all }
    })
  }

  /** إقرار المالكة بفتح الأرشيف المفكوك دون إنترنت (مرة واحدة؛ بعد تحقق التنزيل). النسخة الثانية لم تعد إقرارًا بل تحققًا (confirmCopy). */
  async ack(i: { archiveId: string; kind: 'opened_locally'; note?: string; actorUserId: string }): Promise<{ archiveId: string; kind: string; at: string }> {
    const note = (i.note ?? '').trim()
    if (!UUID_RE.test(i.archiveId) || !UUID_RE.test(i.actorUserId) || i.kind !== 'opened_locally' || note.length > 300 || /[\u0000-\u001f]/.test(note)) throw new ServiceError('bad_request')
    return this.db.transaction(async (c) => {
      const a = (await c.query<{ state: string; hv: string | null }>(
        `select state, download_hash_verified_at::text as hv from public.archives where id = $1 and term_id is null and teacher_id is null and storage_provider = $2 and deleted_at is null for update`, [i.archiveId, LOCAL_PROVIDER]))[0]
      if (!a || a.state !== 'verified') throw new ServiceError('not_found')
      if (a.hv === null) throw new ServiceError('not_ready')
      const r = await c.query<{ at: string }>(
        `update public.archives set checks = checks || $2::jsonb
          where id = $1 and not exists (select 1 from jsonb_array_elements(checks) e where e->>'check' = 'opened_locally_ack') returning now()::text as at`,
        [i.archiveId, JSON.stringify([{ check: 'opened_locally_ack', ok: true, by: i.actorUserId, note: note === '' ? null : note }])])
      if (!r[0]) throw new ServiceError('not_ready')
      return { archiveId: i.archiveId, kind: i.kind, at: r[0].at }
    })
  }

  /** حالة الأرشيفات السنوية: أجزاؤها وتحققها ونسخها الثانية وتقرير بوابة التصفير (قراءة فقط؛ لا تصفير في هذه النسخة). */
  async status(yearId: string): Promise<{ archives: YearArchiveStatus[] }> {
    if (!UUID_RE.test(yearId)) throw new ServiceError('bad_request')
    return this.db.transaction(async (c) => {
      const rows = await c.query<{ id: string; title: string; created_at: string; size_bytes: string | number; entries_count: number; sha256: string; manifest_sha256: string; hv: string | null; opened: boolean; sc: string | null }>(
        `select id, title, to_char(created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at, size_bytes, entries_count, sha256, manifest_sha256,
                to_char(download_hash_verified_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as hv,
                exists (select 1 from jsonb_array_elements(checks) e where e->>'check' = 'opened_locally_ack') as opened,
                to_char(backup_ack_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as sc
           from public.archives where year_id = $1 and term_id is null and teacher_id is null and storage_provider = $2 and state = 'verified' and deleted_at is null order by created_at desc`, [yearId, LOCAL_PROVIDER])
      const out: YearArchiveStatus[] = []
      for (const r of rows) {
        const parts = await c.query<{ part_no: number; filename: string; sha256: string; size_bytes: string | number; entries_count: number; verified_at: string | null; copy_verified_at: string | null; copy_medium: string | null }>(
          'select part_no, filename, sha256, size_bytes, entries_count, verified_at::text, copy_verified_at::text, copy_medium from public.archive_parts where archive_id = $1 order by part_no', [r.id])
        const g0 = (await c.query<{ g: string }>('select (public.year_archive_gate($1::uuid))::text as g', [r.id]))[0]!.g
        const gate = (typeof g0 === 'string' ? JSON.parse(g0) : g0) as { ready: boolean; problems: string[] }
        out.push({ id: r.id, title: r.title, createdAt: r.created_at, sizeBytes: Number(r.size_bytes), entries: Number(r.entries_count), sha256: r.sha256, entriesDigest: r.manifest_sha256,
          downloadVerifiedAt: r.hv, openedLocally: !!r.opened, secondCopyAt: r.sc,
          parts: parts.map((p) => ({ no: Number(p.part_no), filename: p.filename, sha256: p.sha256, sizeBytes: Number(p.size_bytes), entries: Number(p.entries_count), verified: p.verified_at !== null, copyVerified: p.copy_verified_at !== null, copyMedium: p.copy_medium })),
          resetGate: { ready: gate.ready === true, problems: Array.isArray(gate.problems) ? gate.problems : [] } })
      }
      return { archives: out }
    })
  }
}

export interface YearArchiveStatus {
  id: string; title: string; createdAt: string; sizeBytes: number; entries: number; sha256: string; entriesDigest: string
  downloadVerifiedAt: string | null; openedLocally: boolean; secondCopyAt: string | null
  parts: { no: number; filename: string; sha256: string; sizeBytes: number; entries: number; verified: boolean; copyVerified: boolean; copyMedium: string | null }[]
  resetGate: { ready: boolean; problems: string[] }
}
