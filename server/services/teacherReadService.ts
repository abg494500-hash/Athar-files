// خدمة قراءة بيانات المعلمة (الدفعة 7): فصولها الحالية بمواعيد **كل فصل المستقلة**، وخاناتها، وإصداراتها، وما يحق لها فعله الآن.
// **الحارس الأمني:** لا تُعيد storage_key/storage_bucket/pending_key ولا بصمة؛ التنزيل عبر رابط موقّع منفصل (TransferService).
// الحالة الحاكمة تُحسب بساعة القاعدة (لا ساعة المتصفح) بنفس submissionGate المستعملة عند الرفع الفعلي، فلا يتناقض العرض مع القبول.
// **لا تغيير في القاعدة:** SELECT فقط على أعمدة موجودة. **لم يُشغَّل SQL هنا على أي قاعدة**؛ الاختبار يخص المنطق بصفوف بديلة.
import type { Db } from '../db/types'
import { endOfDay } from '../../src/lib/status'
import { ServiceError } from './errors'
import { submissionGate } from './gate'
import type { Gate } from './gate'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ISO = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`

export interface VersionSummary {
  id: string; no: number; kind: 'file' | 'link'; name: string | null; sizeBytes: number | null; ext: string | null; url: string | null
  status: 'on_time' | 'late'; submittedAt: string; downloadable: boolean
}
export interface SlotView {
  slotId: string; title: string; optional: boolean
  /** حالة أول إصدار، أو missing. */
  state: 'missing' | 'on_time' | 'late'
  gate: Gate
  canSubmit: boolean
  canReplace: boolean
  versions: VersionSummary[]
}
export interface TermView {
  id: string; name: string; ord: number
  deadlines: { base: string; late: string; replace: string }
  phase: 'before_base' | 'late_window' | 'replace_only' | 'closed'
  slots: SlotView[]
}
export interface TeacherPortfolio {
  teacher: { id: string; name: string; subject: string }
  serverNow: string
  /** السنة النشطة، أو null إن لم توجد (الواجهة تعرض رسالة واضحة بدل صفحة فارغة). */
  year: { id: string; label: string } | null
  slotsCount: number
  terms: TermView[]
}

interface TeacherRow { id: string; name: string; subject: string }
interface TermRow { id: string; name: string; ord: number | string; base: string; late: string; replace: string }
interface SlotRow { id: string; title: string; optional: boolean; ord: number | string }
interface VerRow {
  id: string; term_id: string; slot_id: string; no: number | string; kind: string; original_name: string | null; size_bytes: string | number | null
  ext: string | null; url: string | null; status_snapshot: string; submitted_at: string; storage_state: string
}

export class TeacherReadService {
  private readonly db: Db
  constructor(d: { db: Db }) { this.db = d.db }

  async portfolio(teacherId: string): Promise<TeacherPortfolio> {
    if (!UUID_RE.test(teacherId)) throw new ServiceError('bad_request')
    const raw = await this.db.transaction(async (c) => {
      const now = (await c.query<{ now: string }>(`select to_char(now() at time zone 'utc', ${ISO}) as now`))[0]
      const teacher = (await c.query<TeacherRow>('select id, name, subject from public.teachers where id = $1 and is_active', [teacherId]))[0]
      const year = (await c.query<{ id: string; label: string }>('select id, label from public.years where is_active'))[0] ?? null
      const terms = await c.query<TermRow>(
        `select t.id, t.name, t.ord, t.deadline_base::text as base, t.deadline_late::text as late, t.deadline_replace::text as replace
           from public.terms t join public.years y on y.id = t.year_id where y.is_active order by t.ord`)
      const slots = await c.query<SlotRow>('select id, title, optional, ord from public.slots order by ord')
      const vers = await c.query<VerRow>(
        `select v.id, v.term_id, v.slot_id, v.no, v.kind, v.original_name, v.size_bytes, v.ext, v.url, v.status_snapshot, to_char(v.submitted_at at time zone 'utc', ${ISO}) as submitted_at, v.storage_state
           from public.versions v
          where v.teacher_id = $1 and v.term_id in (select t.id from public.terms t join public.years y on y.id = t.year_id where y.is_active)
          order by v.term_id, v.slot_id, v.no`, [teacherId])
      return { now, teacher, year, terms, slots, vers }
    })
    if (!raw.teacher || !raw.now) throw new ServiceError('not_found') // معلمة غير موجودة أو موقوفة
    return assemble(raw.now.now, raw.teacher, raw.terms, raw.slots, raw.vers, raw.year)
  }
}

/** دالة نقية (تُختبر مباشرة): تركيب العرض من الصفوف. */
export function assemble(serverNow: string, teacher: TeacherRow, terms: TermRow[], slots: SlotRow[], vers: VerRow[], year: { id: string; label: string } | null = null): TeacherPortfolio {
  const nowMs = Date.parse(serverNow)
  const byKey = new Map<string, VerRow[]>()
  for (const v of vers) { const k = `${v.term_id}|${v.slot_id}`; byKey.set(k, [...(byKey.get(k) ?? []), v]) }
  const outTerms: TermView[] = terms.map((t) => {
    const d = { base: t.base, late: t.late, replace: t.replace }
    const phase: TermView['phase'] = nowMs <= endOfDay(d.base) ? 'before_base' : nowMs <= endOfDay(d.late) ? 'late_window' : nowMs <= endOfDay(d.replace) ? 'replace_only' : 'closed'
    const slotViews: SlotView[] = slots.map((s) => {
      const list = (byKey.get(`${t.id}|${s.id}`) ?? []).sort((a, b) => Number(a.no) - Number(b.no))
      const first = list[0]
      const firstStatus = first ? (first.status_snapshot === 'late' ? 'late' : 'on_time') : null
      const gate = submissionGate(nowMs, d, firstStatus)
      return {
        slotId: s.id, title: s.title, optional: s.optional, state: firstStatus ?? 'missing', gate,
        canSubmit: list.length === 0 && gate !== 'closed', canReplace: list.length > 0 && gate !== 'closed',
        versions: list.map((v) => ({
          id: v.id, no: Number(v.no), kind: v.kind === 'link' ? 'link' : 'file', name: v.original_name, sizeBytes: v.size_bytes === null ? null : Number(v.size_bytes),
          ext: v.ext, url: v.url, status: v.status_snapshot === 'late' ? 'late' : 'on_time', submittedAt: v.submitted_at,
          downloadable: v.kind === 'file' && v.storage_state === 'present',
        })),
      }
    })
    return { id: t.id, name: t.name, ord: Number(t.ord), deadlines: d, phase, slots: slotViews }
  })
  return { teacher: { id: teacher.id, name: teacher.name, subject: teacher.subject }, serverNow, year, slotsCount: slots.length, terms: outTerms }
}
