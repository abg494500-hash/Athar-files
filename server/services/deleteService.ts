// حذف المعلمة لملفها حذفًا نهائيًا (A-126، r40): لا أثر للملف في R2 ولا في القاعدة (صف الإصدار وجلسة رفعه ومحاولاتها). السجل الوحيد الباقي: سطر تدقيق بمعرّف الإصدار فقط.
// الترتيب (R2 وPostgres ليسا في معاملة واحدة): 1) فحص (قراءة فقط) 2) حذف الكائنين من R2 (النهائي والمؤقت؛ idempotent) 3) حذف الصفوف في معاملة تعيد الفحص.
// فشل بين 2 و3 يترك صفًا يشير إلى ملف غير موجود؛ إعادة الحذف تكمل (حذف R2 idempotent). لا يُحذف أي شيء قبل اجتياز الفحص.
// الشروط: آخر إصدار في الخانة، سنة نشطة غير مصفَّرة، لا أرشيف سنوي قائم، لا جلسة رفع جارية (القاعدة)، وفصل غير مغلق بمواعيده (هنا، بنفس بوابة الرفع).
import type { Db } from '../db/types'
import { ServiceError } from './errors'
import { submissionGate } from './gate'
import type { TermDates } from './gate'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface DeleteStorage { removeTeacherObject(key: string): Promise<void> }

const MAP = {
  not_found: 'not_found', not_latest: 'delete_not_latest', archive_exists: 'delete_archive_exists', year_closed: 'year_closed',
  year_not_active: 'delete_year_inactive', session_busy: 'session_busy',
} as const

function mapDbError(e: unknown): never {
  const m = ((e as Error).message ?? '').trim()
  const code = (Object.keys(MAP) as (keyof typeof MAP)[]).find((k) => m.includes(k))
  if (code) throw new ServiceError(MAP[code])
  throw e
}

export class TeacherDeleteService {
  private readonly db: Db
  private readonly storage: DeleteStorage
  constructor(d: { db: Db; storage: DeleteStorage }) { this.db = d.db; this.storage = d.storage }

  private async check(teacherId: string, versionId: string): Promise<{ kind: string; storageKey: string | null; pendingKey: string | null; termId: string; slotId: string }> {
    return this.db.transaction(async (c) => {
      let r: { j: string }[]
      try { r = await c.query<{ j: string }>('select (public.teacher_delete_check($1::uuid, $2::uuid))::text as j', [teacherId, versionId]) } catch (e) { return mapDbError(e) }
      const j = JSON.parse(r[0]!.j) as { kind: string; storageKey: string | null; pendingKey: string | null; termId: string; slotId: string }
      // مواعيد الفصل (هنا لا في القاعدة كي تطابق بوابة الرفع بالضبط)
      const t = (await c.query<{ base: string; late: string; replace: string; now: string }>(
        `select deadline_base::text as base, deadline_late::text as late, deadline_replace::text as replace, to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as now from public.terms where id = $1`, [j.termId]))[0]
      if (!t) throw new ServiceError('not_found')
      const first = (await c.query<{ s: 'on_time' | 'late' }>(
        'select status_snapshot as s from public.versions where teacher_id = $1 and term_id = $2 and slot_id = $3 order by no asc limit 1', [teacherId, j.termId, j.slotId]))[0]
      if (submissionGate(Date.parse(t.now), { base: t.base, late: t.late, replace: t.replace } as TermDates, first ? first.s : null) === 'closed') throw new ServiceError('deadline_closed')
      return j
    })
  }

  async delete(teacherId: string, versionId: string): Promise<{ deleted: true }> {
    if (!UUID_RE.test(teacherId) || !UUID_RE.test(versionId)) throw new ServiceError('bad_request')
    const info = await this.check(teacherId, versionId)
    if (info.kind === 'file') {
      if (!info.storageKey) throw new ServiceError('files_missing')
      await this.storage.removeTeacherObject(info.storageKey)
      if (info.pendingKey) await this.storage.removeTeacherObject(info.pendingKey) // نسخة الرفع المؤقتة (لا تُحذف تلقائيًا عند الإتمام)
    }
    await this.db.transaction(async (c) => {
      try { await c.exec('select public.teacher_delete_version($1::uuid, $2::uuid)', [teacherId, versionId]) } catch (e) { mapDbError(e) }
    })
    return { deleted: true }
  }
}
