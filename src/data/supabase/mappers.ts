import type { Archive, ArchiveCheck, ArchiveStatus, AuditEntry, ActorRole, Submission, Teacher, Term, Version, Year, SlotId } from '../types'

/**
 * تحويل صفوف قاعدة البيانات (001_schema.sql) إلى أنواع الواجهة. نقي وقابل للاختبار.
 * صيغة غير متوقعة ⇒ MappingError (يظهر كخطأ تحميل صريح) بدل عرض بيانات مشوَّهة بصمت.
 */
export class MappingError extends Error {
  constructor(message: string) { super(message); this.name = 'MappingError' }
}
type Row = Record<string, unknown>

const str = (r: Row, k: string): string => { const v = r[k]; if (typeof v !== 'string') throw new MappingError(`الحقل ${k} ليس نصًا`); return v }
const strOr = (r: Row, k: string, d: string): string => { const v = r[k]; return v === null || v === undefined ? d : str(r, k) }
const strN = (r: Row, k: string): string | null => { const v = r[k]; return v === null || v === undefined ? null : str(r, k) }
const bool = (r: Row, k: string): boolean => { const v = r[k]; if (typeof v !== 'boolean') throw new MappingError(`الحقل ${k} ليس منطقيًا`); return v }
const num = (r: Row, k: string): number => {
  const v = r[k]
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v) // bigint يصل نصًا أحيانًا
  throw new MappingError(`الحقل ${k} ليس رقمًا`)
}
const numOr = (r: Row, k: string, d: number): number => (r[k] === null || r[k] === undefined ? d : num(r, k))
const dateStr = (r: Row, k: string): string => {
  const v = str(r, k).slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new MappingError(`الحقل ${k} ليس تاريخًا`)
  return v
}

/** عرض فقط: عزل اتجاه النص حول «2027–2028» كما في البذرة القديمة (لا يُرسل إلى القاعدة؛ انظر stripBidi). */
export const displayYearLabel = (plain: string): string => `\u2066${plain.replace('–', '\u2060–\u2060')}\u2069`
export const stripBidi = (s: string): string => s.replace(/[\u2066\u2069\u2060]/g, '')

export function mapYear(r: Row): Year { return { id: str(r, 'id'), label: displayYearLabel(str(r, 'label')), active: bool(r, 'is_active') } }

export function mapTerm(r: Row): Term {
  const ord = num(r, 'ord')
  if (ord !== 1 && ord !== 2) throw new MappingError('ترتيب الفصل غير صالح')
  return {
    id: str(r, 'id'), yearId: str(r, 'year_id'), name: str(r, 'name'), order: ord,
    deadlines: { base: dateStr(r, 'deadline_base'), late: dateStr(r, 'deadline_late'), replace: dateStr(r, 'deadline_replace') },
  }
}

/** creds: صف teacher_credentials (إن وُجد). لا رمز ولا بصمة تصل إلى الواجهة (الأعمدة السرية غير ممنوحة أصلًا). */
export function mapTeacher(r: Row, creds: Row | undefined): Teacher {
  const ci = num(r, 'color_idx')
  const state = creds ? str(creds, 'code_state') : 'revoked'
  if (state !== 'active' && state !== 'revoked') throw new MappingError('حالة الرمز غير صالحة')
  return {
    id: str(r, 'id'), name: str(r, 'name'), subject: str(r, 'subject'), colorIdx: ci >= 0 && ci <= 7 ? ci : 0,
    active: bool(r, 'is_active'), codeState: state,
    codeIssuedAt: (creds ? strN(creds, 'code_issued_at') : null) ?? str(r, 'created_at'),
  }
}

export function mapVersion(r: Row): Version {
  const kind = str(r, 'kind')
  if (kind !== 'file' && kind !== 'link') throw new MappingError('نوع الإصدار غير صالح')
  const st = str(r, 'status_snapshot')
  if (st !== 'on_time' && st !== 'late') throw new MappingError('حالة الإصدار غير صالحة')
  return {
    id: str(r, 'id'), no: num(r, 'no'), kind,
    ...(r.original_name != null ? { fileName: str(r, 'original_name') } : {}),
    ...(r.size_bytes != null ? { size: num(r, 'size_bytes') } : {}),
    ...(r.url != null ? { url: str(r, 'url') } : {}),
    sha256: strOr(r, 'sha256', ''),
    submittedAt: str(r, 'submitted_at'), status: st,
    ...(r.replaced_note != null ? { replacedNote: str(r, 'replaced_note') } : {}),
    // storage_key/bucket غير ممنوحة لأي دور تطبيقي (C-10) ولا تُجلب أبدًا.
  }
}

export function mapSubmissions(subRows: Row[], versionRows: Row[]): Submission[] {
  const key = (t: string, tm: string, s: string) => `${t}|${tm}|${s}`
  const map = new Map<string, Submission>()
  for (const r of subRows) {
    const slot = str(r, 'slot_id')
    if (slot !== 's1' && slot !== 's2') throw new MappingError('خانة غير معروفة')
    map.set(key(str(r, 'teacher_id'), str(r, 'term_id'), slot), { teacherId: str(r, 'teacher_id'), termId: str(r, 'term_id'), slotId: slot as SlotId, versions: [] })
  }
  for (const r of versionRows) {
    const s = map.get(key(str(r, 'teacher_id'), str(r, 'term_id'), str(r, 'slot_id')))
    if (!s) throw new MappingError('إصدار بلا تسليم مطابق')
    s.versions.push(mapVersion(r))
  }
  for (const s of map.values()) s.versions.sort((a, b) => a.no - b.no)
  return [...map.values()]
}

const AUDIT_ACTIONS: Record<string, string> = {
  'term.deadlines.update': 'تعديل مواعيد',
  'settings.update': 'تعديل الإعدادات',
  'staff.bootstrap': 'إنشاء حساب مسؤولة',
}
const ROLE_LABEL: Record<ActorRole, string> = { owner: 'المالكة', director: 'مديرة المدرسة', teacher: 'معلمة', system: 'النظام' }

export interface AuditLookups { termName(id: string): string | null }

export function mapAudit(r: Row, lk: AuditLookups): AuditEntry {
  const role = str(r, 'actor_role')
  if (role !== 'owner' && role !== 'director' && role !== 'teacher' && role !== 'system') throw new MappingError('دور الفاعل غير صالح')
  const action = str(r, 'action')
  const tt = strN(r, 'target_type'), ti = strN(r, 'target_id')
  const target = tt === 'term' && ti ? (lk.termName(ti) ?? ti) : [tt, ti].filter(Boolean).join(': ')
  const d = r.detail as Record<string, unknown> | null | undefined
  let detail: string | undefined
  if (d && typeof d === 'object') {
    const reason = typeof d.reason === 'string' ? d.reason : undefined
    detail = reason ? `السبب: ${reason}` : JSON.stringify(d)
  }
  return { id: String(r.id), at: str(r, 'at'), actor: ROLE_LABEL[role], actorRole: role, action: AUDIT_ACTIONS[action] ?? action, target, ...(detail ? { detail } : {}) }
}

function mapChecks(v: unknown): ArchiveCheck[] {
  if (!Array.isArray(v)) return []
  return v.flatMap((c) => {
    const o = c as Row
    const state = o?.state
    return typeof o?.label === 'string' && (state === 'ok' || state === 'pending' || state === 'fail') ? [{ label: o.label, state }] : []
  })
}

export function mapArchive(r: Row): Archive {
  const st = str(r, 'state')
  if (st !== 'creating' && st !== 'awaiting_verification' && st !== 'verified' && st !== 'failed') throw new MappingError('حالة الأرشيف غير صالحة')
  const ackAt = strN(r, 'backup_ack_at')
  return {
    id: str(r, 'id'), title: str(r, 'title'), yearId: str(r, 'year_id'), termId: strN(r, 'term_id'), teacherId: strN(r, 'teacher_id'),
    createdAt: str(r, 'created_at'), status: st as ArchiveStatus, sizeBytes: numOr(r, 'size_bytes', 0), entries: numOr(r, 'entries_count', 0),
    sha256: strOr(r, 'sha256', ''), checks: mapChecks(r.checks),
    // «اكتمال الإرسال» (A-32): تنزيل + تحقق بصمة؛ التعريف النهائي ينتظر القرار C-05.
    sent: strN(r, 'download_completed_at') !== null && strN(r, 'download_hash_verified_at') !== null,
    ...(ackAt ? { backupAck: { at: ackAt, note: strOr(r, 'backup_ack_note', '') } } : {}),
    ...(strN(r, 'deleted_at') ? { deleted: true } : {}),
  }
}

/**
 * الفصل «الحالي» غير مخزَّن في القاعدة. نشتقه: أول فصل في السنة النشطة لم ينتهِ موعد استبداله بعد (نهاية اليوم بتوقيت عُمان)،
 * وإلا آخر فصل في السنة النشطة، وإلا أول فصل متاح. (قرار A-84؛ تحديده يدويًا غير متاح قبل المرحلة 6.)
 */
export function deriveCurrentTermId(years: Year[], terms: Term[], nowMs: number): string {
  const active = years.find((y) => y.active)
  const pool = (active ? terms.filter((t) => t.yearId === active.id) : terms).slice().sort((a, b) => a.order - b.order)
  if (pool.length === 0) return ''
  const endOfDay = (d: string) => Date.parse(`${d}T23:59:59+04:00`)
  return (pool.find((t) => endOfDay(t.deadlines.replace) >= nowMs) ?? pool[pool.length - 1]).id
}
