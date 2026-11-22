// مولَّد آليًا من server/services/yearResetService.ts بواسطة scripts/build-edge-function.mjs — لا تعدّليه يدويًا.
// خدمة التصفير السنوي الحقيقي (A-118، r36). للمالكة والمديرة (يفرضه المعالج والقاعدة، A-126). **لا تحذف إلا سنة واحدة محددة، وبعد بوابة صارمة في القاعدة.**
// الترتيب الآمن (R2 وPostgres ليسا في معاملة واحدة، لذا العملية قابلة للاستئناف في أي نقطة):
//   1) begin (SQL): قفل السنة + إعادة فحص البوابة + تسجيل العملية + تجميد الكتابة + تسجيل مفاتيح R2 كلها قبل أي حذف.
//   2) حذف مفاتيح R2 على دفعات صغيرة، ثم التحقق من غياب كل مفتاح (HEAD) قبل وسمه verified_absent. مفتاح فاشل ⇒ يبقى failed ولا تكتمل العملية.
//   3) purge (SQL، معاملة واحدة): يرفض إن بقي مفتاح غير متحقَّق منه؛ يحذف بيانات السنة بترتيب المفاتيح الأجنبية؛ يتحقق أن لا بقايا للسنة
//      وأن السنوات الأخرى والحسابات وaudit_log لم تتغيّر؛ يكتب سجل الإغلاق الموجز؛ وإلا يتراجع كاملًا.
// الحالات: not_started (البوابة غير مجتازة) / ready / running / partial (تقدّم ثم توقف) / failed / completed.
// **لم يُجرَّب مع R2 حقيقي**: اختُبر بتخزين بديل وقاعدة محلية.
import type { Db } from '../db/types.ts'
import { ServiceError } from './errors.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface ResetStorage {
  removeObjectForYearReset(key: string): Promise<void>
  objectExists(key: string): Promise<boolean>
}

export type ResetState = 'not_started' | 'ready' | 'running' | 'partial' | 'failed' | 'completed'
export interface ResetKeysSummary { total: number; pending: number; deleted: number; verifiedAbsent: number; failed: number }
export interface ResetStatus {
  yearId: string
  state: ResetState
  gate: { ready: boolean; problems: string[]; archiveId: string | null }
  reset: { id: string; phase: string; startedAt: string; finishedAt: string | null; lastError: string | null; attempts: number; keys: ResetKeysSummary; counters: Record<string, number> } | null
  closure: { closedAt: string; yearLabel: string; archiveTitle: string | null; parts: { part: number; sha256: string; size: number }[]; verification: Record<string, unknown>; deleted: Record<string, number> } | null
}
export type ResetReport = { yearId: string; yearLabel: string; archiveTitle: string | null; gate: { ready: boolean; problems: string[]; archiveId: string | null } } & Record<string, unknown>

const j = <T>(s: unknown): T => (typeof s === 'string' ? JSON.parse(s) : s) as T

export class YearResetService {
  private readonly db: Db
  private readonly storage: ResetStorage
  private readonly slice: number
  constructor(d: { db: Db; storage: ResetStorage; sliceSize?: number }) { this.db = d.db; this.storage = d.storage; this.slice = d.sliceSize ?? 40 }

  private uuid(v: unknown): string { if (typeof v !== 'string' || !UUID_RE.test(v)) throw new ServiceError('bad_request'); return v }

  /** تقرير ما قبل التصفير (قراءة فقط). */
  async report(yearId: string): Promise<ResetReport> {
    this.uuid(yearId)
    const r = await this.db.transaction((c) => c.query<{ r: string | null }>('select (public.year_reset_report($1::uuid))::text as r', [yearId]))
    if (!r[0]?.r) throw new ServiceError('not_found')
    return j<ResetReport>(r[0].r)
  }

  async status(yearId: string): Promise<ResetStatus> {
    this.uuid(yearId)
    return this.db.transaction(async (c) => {
      const y = await c.query<{ id: string }>('select id from public.years where id = $1', [yearId])
      if (!y[0]) throw new ServiceError('not_found')
      const gate = j<{ ready: boolean; problems: string[]; archiveId: string | null }>((await c.query<{ g: string }>('select (public.year_reset_gate($1::uuid))::text as g', [yearId]))[0]!.g)
      const rs = await c.query<{ id: string; state: string; phase: string; started_at: string; finished_at: string | null; last_error: string | null; attempts: number; counters: string }>(
        `select id, state, phase, started_at::text, finished_at::text, last_error, attempts, counters::text as counters from public.year_resets where year_id = $1`, [yearId])
      if (!rs[0]) return { yearId, state: gate.ready ? 'ready' : 'not_started', gate, reset: null, closure: null }
      const k = await c.query<{ state: string; n: string }>('select state, count(*)::text as n from public.year_reset_keys where reset_id = $1 group by state', [rs[0].id])
      const cnt = (s: string) => Number(k.find((x) => x.state === s)?.n ?? 0)
      const keys: ResetKeysSummary = { pending: cnt('pending'), deleted: cnt('deleted'), verifiedAbsent: cnt('verified_absent'), failed: cnt('failed'), total: k.reduce((n, x) => n + Number(x.n), 0) }
      const cl = await c.query<{ closed_at: string; year_label: string; archive_title: string | null; parts: string; verification: string; deleted: string }>(
        'select closed_at::text, year_label, archive_title, parts::text, verification::text, deleted::text from public.year_closures where year_id = $1', [yearId])
      const closure = cl[0] ? { closedAt: cl[0].closed_at, yearLabel: cl[0].year_label, archiveTitle: cl[0].archive_title, parts: j<{ part: number; sha256: string; size: number }[]>(cl[0].parts), verification: j<Record<string, unknown>>(cl[0].verification), deleted: j<Record<string, number>>(cl[0].deleted) } : null
      const r = rs[0]
      return { yearId, state: r.state as ResetState, gate, closure,
        reset: { id: r.id, phase: r.phase, startedAt: r.started_at, finishedAt: r.finished_at, lastError: r.last_error, attempts: Number(r.attempts), keys, counters: j<Record<string, number>>(r.counters) } }
    })
  }

  /** بدء التصفير: تأكيد مكتوب = اسم السنة حرفيًا. يفشل بسبب واضح إن لم تُجتز البوابة. ثم ينفّذ أول شريحة. */
  async start(i: { yearId: string; typedConfirmation?: string; actorUserId: string }): Promise<{ done: boolean; status: ResetStatus }> {
    this.uuid(i.yearId); this.uuid(i.actorUserId)
    const label = await this.db.transaction(async (c) => (await c.query<{ label: string }>('select label from public.years where id = $1', [i.yearId]))[0]?.label)
    if (!label) throw new ServiceError('not_found')
    // التأكيد بنقرة صريحة يفرضه المعالج (confirm=true)؛ إن وُجد نص مكتوب فيجب أن يطابق اسم السنة حرفيًا.
    if (i.typedConfirmation !== undefined && i.typedConfirmation.trim() !== label) throw new ServiceError('bad_request', 'typed_confirmation_mismatch')
    let resetId: string
    try {
      resetId = (await this.db.transaction((c) => c.query<{ id: string }>('select public.year_reset_begin($1::uuid, $2::uuid) as id', [i.yearId, i.actorUserId])))[0]!.id
    } catch (e) {
      const m = (e as Error).message ?? ''
      if ((e as { sqlstate?: string }).sqlstate === '42501') throw new ServiceError('bad_request', 'staff_only')
      if ((e as { sqlstate?: string }).sqlstate === '23514') throw new ServiceError('not_ready', m.slice(0, 300))
      throw e
    }
    return this.run(i.yearId, resetId)
  }

  /** استئناف عملية بدأت (بعد فشل أو توقف أو انتهاء شريحة). آمن للتكرار. */
  async resume(i: { yearId: string; actorUserId: string }): Promise<{ done: boolean; status: ResetStatus }> {
    this.uuid(i.yearId); this.uuid(i.actorUserId)
    const rs = await this.db.transaction((c) => c.query<{ id: string; state: string }>('select id, state from public.year_resets where year_id = $1', [i.yearId]))
    if (!rs[0]) throw new ServiceError('not_ready', 'reset_not_started')
    if (rs[0].state === 'completed') return { done: true, status: await this.status(i.yearId) }
    return this.run(i.yearId, rs[0].id)
  }

  private async run(yearId: string, resetId: string): Promise<{ done: boolean; status: ResetStatus }> {
    try {
      const keys = await this.db.transaction((c) => c.query<{ storage_key: string; state: string }>(
        `select storage_key, state from public.year_reset_keys where reset_id = $1 and state <> 'verified_absent' order by (state = 'failed'), storage_key limit $2`, [resetId, this.slice]))
      let anyFailed = false
      for (const k of keys) {
        try {
          if (k.state === 'pending' || k.state === 'failed') {
            await this.storage.removeObjectForYearReset(k.storage_key)
            await this.setKey(resetId, k.storage_key, 'deleted', null)
          }
          if (await this.storage.objectExists(k.storage_key)) throw new Error('still_exists_after_delete')
          await this.setKey(resetId, k.storage_key, 'verified_absent', null)
        } catch (e) {
          anyFailed = true
          await this.setKey(resetId, k.storage_key, 'failed', e instanceof Error ? e.message : 'error')
        }
      }
      const left = await this.db.transaction((c) => c.query<{ n: string }>(`select count(*)::text as n from public.year_reset_keys where reset_id = $1 and state <> 'verified_absent'`, [resetId]))
      if (Number(left[0]!.n) > 0) {
        await this.mark(resetId, anyFailed ? 'partial' : 'running', anyFailed ? 'some_files_failed' : null)
        return { done: false, status: await this.status(yearId) }
      }
      try {
        await this.db.transaction((c) => c.query('select public.year_reset_purge($1::uuid)::text', [resetId]))
      } catch (e) {
        await this.mark(resetId, 'partial', `database_purge_failed:${(e as { sqlstate?: string }).sqlstate ?? ''}:${((e as Error).message ?? '').slice(0, 200)}`)
        return { done: false, status: await this.status(yearId) }
      }
      return { done: true, status: await this.status(yearId) }
    } catch (e) {
      try { await this.mark(resetId, 'failed', (e as Error).message ?? 'error') } catch { /* لا نخفي الخطأ الأصلي */ }
      throw e
    }
  }

  private setKey(resetId: string, key: string, state: string, err: string | null): Promise<void> {
    return this.db.transaction((c) => c.exec(
      `update public.year_reset_keys set state = $3, last_error = left($4, 300), attempts = attempts + 1, updated_at = now() where reset_id = $1 and storage_key = $2`, [resetId, key, state, err]))
  }
  private mark(resetId: string, state: 'running' | 'partial' | 'failed', err: string | null): Promise<void> {
    return this.db.transaction((c) => c.exec('select public.year_reset_mark($1::uuid, $2, $3)', [resetId, state, err]))
  }
}
