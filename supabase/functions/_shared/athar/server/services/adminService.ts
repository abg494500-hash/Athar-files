// مولَّد آليًا من server/services/adminService.ts بواسطة scripts/build-edge-function.mjs — لا تعدّليه يدويًا.
// إدارة السنوات والفصول (للمالكة وحدها) واستيراد المعلمات (للمالكة والمديرة، r37). المعالج يفرض الدور، والقاعدة تعيد التحقق من المنفِّذة النشطة.
// كل عملية معاملة واحدة في القاعدة: إما تنجح كاملة أو لا يُكتب شيء (استيراد ذرّي). الأكواد تُصدَر بعد الاستيراد من النظام نفسه ولا تأتي من الملف.
import type { Db } from '../db/types.ts'
import { ServiceError } from './errors.ts'
import { MAX_IMPORT_ROWS, checkRows } from '../../src/lib/teacherImport/parse.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
export interface TermInput { ord: 1 | 2; name: string; deadlineBase: string; deadlineLate: string; deadlineReplace: string }
export interface YearInput { label: string; startsOn: string | null; endsOn: string | null; terms: TermInput[] }
export interface ImportOutcome { imported: { id: string; name: string; subject: string }[]; issued: { teacherId: string; name: string; subject: string; code: string }[]; issueFailed: string[] }

const date = (v: unknown, nullable = false): string | null => {
  if (v === null || v === undefined || v === '') { if (nullable) return null; throw new ServiceError('bad_request', 'date') }
  if (typeof v !== 'string' || !DATE_RE.test(v) || Number.isNaN(Date.parse(v + 'T00:00:00Z')) || new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) !== v) throw new ServiceError('bad_request', 'date')
  return v
}
function cleanYear(i: YearInput): { label: string; startsOn: string | null; endsOn: string | null; terms: string } {
  if (typeof i?.label !== 'string' || !Array.isArray(i.terms) || i.terms.length !== 2) throw new ServiceError('bad_request', 'year')
  const terms = i.terms.map((t) => ({ ord: t.ord, name: String(t.name ?? ''), deadline_base: date(t.deadlineBase), deadline_late: date(t.deadlineLate), deadline_replace: date(t.deadlineReplace) }))
  if (terms.some((t) => t.ord !== 1 && t.ord !== 2)) throw new ServiceError('bad_request', 'ord')
  return { label: i.label, startsOn: date(i.startsOn, true), endsOn: date(i.endsOn, true), terms: JSON.stringify(terms) }
}
const map = (e: unknown): never => {
  const s = (e as { sqlstate?: string }).sqlstate
  if (s === '42501') throw new ServiceError('bad_request', 'not_allowed')
  if (s === '23505') throw new ServiceError('conflict', ((e as Error).message ?? '').slice(0, 300))
  if (s === 'P0002') throw new ServiceError('not_found')
  if (s === '23514') { const m = (e as Error).message ?? ''; throw new ServiceError(/بدأ العمل/.test(m) ? 'year_work_started' : /أُغلقت/.test(m) ? 'year_closed' : 'bad_request', m.slice(0, 300)) }
  throw e
}

export class AdminService {
  private readonly db: Db
  private readonly issue: (teacherId: string) => Promise<{ code: string }>
  constructor(d: { db: Db; issueCredentials: (teacherId: string) => Promise<{ code: string }> }) { this.db = d.db; this.issue = d.issueCredentials }

  async createYear(actor: string, i: YearInput): Promise<{ id: string }> {
    if (!UUID_RE.test(actor)) throw new ServiceError('bad_request')
    const y = cleanYear(i)
    try { return { id: (await this.db.transaction((c) => c.query<{ id: string }>('select public.create_year_with_terms($1::uuid, $2, $3::date, $4::date, $5::jsonb) as id', [actor, y.label, y.startsOn, y.endsOn, y.terms])))[0]!.id } } catch (e) { return map(e) }
  }
  async updateYear(actor: string, yearId: string, i: YearInput): Promise<void> {
    if (!UUID_RE.test(actor) || !UUID_RE.test(yearId)) throw new ServiceError('bad_request')
    const y = cleanYear(i)
    try { await this.db.transaction((c) => c.exec('select public.update_year($1::uuid, $2::uuid, $3, $4::date, $5::date, $6::jsonb)', [actor, yearId, y.label, y.startsOn, y.endsOn, y.terms])) } catch (e) { map(e) }
  }
  async activateYear(actor: string, yearId: string): Promise<void> {
    if (!UUID_RE.test(actor) || !UUID_RE.test(yearId)) throw new ServiceError('bad_request')
    try { await this.db.transaction((c) => c.exec('select public.activate_year($1::uuid, $2::uuid)', [actor, yearId])) } catch (e) { map(e) }
  }
  /** المعلمات الموجودة (اسم+مادة فقط) لكشف التكرار في المعاينة. */
  async existingTeachers(): Promise<{ name: string; subject: string }[]> {
    const r = await this.db.transaction((c) => c.query<{ j: string }>('select (public.teachers_for_import_check())::text as j'))
    return JSON.parse(r[0]!.j)
  }
  /** استيراد ذرّي. يعيد التحقق خادميًا (لا يُوثَق بمعاينة الواجهة): أي صف معيب أو مكرر ⇒ رفض الدفعة كلها ولا يُكتب شيء. */
  async importTeachers(i: { actor: string; rows: { name: unknown; subject: unknown }[]; issueCodes: boolean }): Promise<ImportOutcome> {
    if (!UUID_RE.test(i.actor) || !Array.isArray(i.rows) || i.rows.length === 0 || i.rows.length > MAX_IMPORT_ROWS) throw new ServiceError('bad_request', 'rows')
    const raw = i.rows.map((r, k) => ({ line: k + 1, name: typeof r?.name === 'string' ? r.name : '', subject: typeof r?.subject === 'string' ? r.subject : '' }))
    const checked = checkRows(raw, await this.existingTeachers())
    if (checked.some((c) => c.problems.length)) throw new ServiceError('conflict', 'invalid_rows:' + checked.filter((c) => c.problems.length).map((c) => c.line).join(','))
    let ids: { id: string; index: number }[]
    try {
      const r = await this.db.transaction((c) => c.query<{ j: string }>('select (public.import_teachers($1::uuid, $2::jsonb))::text as j', [i.actor, JSON.stringify(checked.map((c) => ({ name: c.name, subject: c.subject })))]))
      ids = JSON.parse(r[0]!.j).imported
    } catch (e) { return map(e) }
    const imported = ids.map((x) => ({ id: x.id, name: checked[x.index - 1]!.name, subject: checked[x.index - 1]!.subject }))
    const issued: ImportOutcome['issued'] = []; const issueFailed: string[] = []
    if (i.issueCodes) for (const t of imported) {
      try { const c = await this.issue(t.id); issued.push({ teacherId: t.id, name: t.name, subject: t.subject, code: c.code }) } catch { issueFailed.push(t.id) }
    }
    return { imported, issued, issueFailed }
  }
}
