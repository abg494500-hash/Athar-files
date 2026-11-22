// @vitest-environment node
// اختبار خدمات الرفع على PostgreSQL محلي حقيقي (مشغّلات وقيود 001–004 كما هي) + تخزين الذاكرة. لا Supabase.
// يُشغَّل بـ ATHAR_TEST_PG؛ دونه تُتخطّى (لا تفشل).
import { describe, it, expect } from 'vitest'
import { MemoryStorageAdapter } from '../../src/lib/storage/memory'
import { hashBlob } from '../../src/lib/storage/sha256'
import { UploadLedger } from '../../src/lib/upload/ledger'
import { buildFinalObjectKey, buildPendingObjectKey, assertKeyInScope } from '../objectKey'
import { ServiceError } from '../services/errors'
import { UploadService } from '../services/uploadService'
import type { SessionView } from '../services/uploadService'
import { HAS_PG, createTestEnv } from './helpers/testDb'
import type { TestEnv } from './helpers/testDb'

const PDF_HEAD = [0x25, 0x50, 0x44, 0x46, 0x2d] // %PDF-
const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
function bytes(head: number[], size: number, fill = 7): Blob {
  const u = new Uint8Array(size).fill(fill)
  u.set(head)
  return new Blob([u])
}
async function code(p: Promise<unknown>): Promise<string> {
  try { await p } catch (e) { return e instanceof ServiceError ? e.code : `other:${(e as Error).message}` }
  return 'ok'
}

interface Ctx { env: TestEnv; storage: MemoryStorageAdapter; svc: UploadService; seq: number }
let ctx: Ctx | null = null
let n = 0
const key = () => `k-${++n}`

async function rows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (ctx as Ctx).env.admin.transaction((c) => c.query<T>(sql, params))
}
async function count(sql: string, params: unknown[] = []): Promise<number> {
  return Number((await rows<{ c: number }>(`select count(*)::int as c from (${sql}) z`, params))[0].c)
}
const attempts = async (sid: string) => (await rows<{ outcome: string; reason: string | null }>('select outcome, reason from public.upload_attempts where session_id = $1 order by id', [sid])).map((r) => r.outcome + (r.reason ? ':' + r.reason : ''))

let tseq = 100
/** معلمة جديدة نظيفة (تفصل الاختبارات عن بعضها). */
async function newTeacher(): Promise<string> {
  const id = `00000000-0000-0000-0000-${String(++tseq).padStart(12, '0')}`
  await (ctx as Ctx).env.admin.transaction((x) => x.exec(`insert into public.teachers (id, name, subject) values ($1, 'معلمة اختبار', 'مادة')`, [id]))
  return id
}

function mk(c: Ctx) {
  const T = c.env.ids
  const start = (over: Record<string, unknown> = {}) =>
    c.svc.start({ teacherId: T.teacher, termId: T.term, slotId: 's1', name: 'plan.pdf', size: 2000, idempotencyKey: key(), ...over } as never)
  const upload = (s: SessionView, head = PDF_HEAD, size = s.declaredSize) => c.storage.put({ key: s.pendingKey, data: bytes(head, size) })
  return { T, start, upload }
}

if (!HAS_PG) {
  describe('خدمات الرفع — تخطّي: لا ATHAR_TEST_PG (لم تُجرَّب على قاعدة)', () => { it('تخطّي', () => {}) })
} else {
  describe('خدمات الرفع على Postgres محلي', () => {
    it('تهيئة قاعدة الاختبار', async () => {
      const env = await createTestEnv({ extraFiles: ['database/012_teacher_delete.sql'] })
      const storage = new MemoryStorageAdapter()
      ctx = { env, storage, svc: new UploadService({ db: env.db, storage }), seq: 0 }
      expect(ctx.env.dbName.startsWith('athar_test_svc_')).toBe(true)
    })

    it('بدء: المفتاح المؤقت يُشتق في الخادم من رقم الجلسة، والأزمنة من ساعة القاعدة (120 دقيقة)', async () => {
      const c = ctx as Ctx
      const { T, start } = mk(c)
      const s = await start({ teacherId: T.teacher2, name: 'Plan.PDF' })
      expect(s.state).toBe('started')
      expect(s.pendingKey).toBe(buildPendingObjectKey({ teacherId: T.teacher2, termId: T.term, slotId: 's1', sessionId: s.sessionId, ext: 'pdf' }))
      assertKeyInScope(s.pendingKey, { teacherId: T.teacher2, termId: T.term, slotId: 's1' })
      expect(Date.parse(s.expiresAt) - Date.parse(s.startedAt)).toBe(120 * 60_000)
      expect(s.statusAtStart).toBe('on_time')
      expect(await attempts(s.sessionId)).toEqual(['started'])
      await c.svc.cancel(s.sessionId, T.teacher2)
    })

    it('مفتاح التكرار: نفس البيانات تعيد الجلسة نفسها، وبيانات مختلفة idempotency_conflict', async () => {
      const c = ctx as Ctx
      const { T, start } = mk(c)
      const k = key()
      const a = await start({ idempotencyKey: k, slotId: 's2' })
      const b = await start({ idempotencyKey: k, slotId: 's2' })
      expect(b.sessionId).toBe(a.sessionId)
      expect(b.reused).toBe(true)
      expect(await count('select 1 from public.upload_sessions where idempotency_key = $1', [k])).toBe(1)
      expect(await code(start({ idempotencyKey: k, slotId: 's2', size: 2001 }))).toBe('idempotency_conflict')
      expect(await code(start({ idempotencyKey: k, slotId: 's2', name: 'other.pdf' }))).toBe('idempotency_conflict')
      expect(await attempts(a.sessionId)).toEqual(['started', 'duplicate_start:started'])
      await c.svc.cancel(a.sessionId, T.teacher)
    })

    it('مدخلات مشوّهة تُرفض قبل أي أثر؛ والملف المرفوض عند البدء يُسجَّل بلا جلسة', async () => {
      const c = ctx as Ctx
      const { T, start } = mk(c)
      const before = await count('select 1 from public.upload_sessions')
      for (const bad of [{ teacherId: '../x' }, { termId: 'a/b' }, { slotId: '' }, { name: '' }, { name: 'a\nb.pdf' }, { size: 1.5 }, { size: Number.NaN }, { idempotencyKey: '   ' }, { idempotencyKey: 'x'.repeat(129) }]) {
        const r = await code(start(bad))
        expect(['bad_request', 'bad_idempotency_key'].includes(r)).toBe(true)
      }
      expect(await count('select 1 from public.upload_sessions')).toBe(before)
      const a0 = await count('select 1 from public.upload_attempts where outcome = $1', ['start_rejected'])
      expect(await code(start({ size: 0 }))).toBe('empty')
      expect(await code(start({ size: 50_000_001 }))).toBe('too_large')
      expect(await code(start({ name: 'virus.exe' }))).toBe('type_not_allowed')
      expect(await code(start({ name: 'noext' }))).toBe('type_not_allowed')
      expect(await count('select 1 from public.upload_attempts where outcome = $1', ['start_rejected'])).toBe(a0 + 4)
      expect(await count('select 1 from public.upload_sessions')).toBe(before)
      // معلمة أو فصل أو خانة مجهولة: not_found
      expect(await code(start({ teacherId: '00000000-0000-0000-0000-00000000dead' }))).toBe('not_found')
      expect(await code(start({ termId: '00000000-0000-0000-0000-00000000dead' }))).toBe('not_found')
      expect(await code(start({ slotId: 's99' }))).toBe('not_found')
      expect(T.teacher).toBeTruthy()
    })

    it('جلسة نشطة واحدة لكل خانة: نفس الملف بمفتاح جديد يعيد الجلسة دون تمديد، وملف مختلف active_session_exists', async () => {
      const c = ctx as Ctx
      const { T, start } = mk(c)
      const a = await start({ teacherId: T.teacher2, slotId: 's2' })
      const b = await start({ teacherId: T.teacher2, slotId: 's2' })
      expect(b.sessionId).toBe(a.sessionId)
      expect(b.expiresAt).toBe(a.expiresAt)
      expect(await attempts(a.sessionId)).toEqual(['started', 'duplicate_start:active_reused'])
      expect(await code(start({ teacherId: T.teacher2, slotId: 's2', size: 3000 }))).toBe('active_session_exists')
      expect(await code(start({ teacherId: T.teacher2, slotId: 's2', name: 'b.pdf' }))).toBe('active_session_exists')
      await c.svc.cancel(a.sessionId, T.teacher2)
    })

    it('إتمام ناجح: قياس فعلي، نسخ إلى المفتاح النهائي، إصدار 1، وتكرار الإتمام يعيد الإصدار نفسه', async () => {
      const c = ctx as Ctx
      const { T, start, upload } = mk(c)
      const s = await start()
      await upload(s)
      const r = await c.svc.complete(s.sessionId, T.teacher)
      expect(r.session.state).toBe('accepted')
      expect(r.version.no).toBe(1)
      expect(r.version.kind).toBe('file')
      expect(r.version.statusSnapshot).toBe('on_time')
      expect(r.version.storageKey).toBe(buildFinalObjectKey({ teacherId: T.teacher, termId: T.term, slotId: 's1', no: 1, ext: 'pdf' }))
      const fin = await c.storage.get(r.version.storageKey as string)
      const pen = await c.storage.get(s.pendingKey)
      expect(fin).toBeTruthy()
      expect(pen).toBeTruthy() // المعلّق يبقى (لا حذف، A-44/D-11)
      expect(await hashBlob((fin as { data: Blob }).data)).toBe(r.version.sha256)
      const row = (await rows<{ mime_verified: string; upload_session_id: string; validated_at: string | null; deadlines_snapshot: { status: string } }>(
        'select mime_verified, upload_session_id, validated_at, deadlines_snapshot from public.versions where id = $1', [r.version.versionId]))[0]
      expect(row.mime_verified).toBe('application/pdf')
      expect(row.upload_session_id).toBe(s.sessionId)
      expect(row.validated_at).toBeTruthy()
      expect(row.deadlines_snapshot.status).toBe('on_time')
      expect(await attempts(s.sessionId)).toEqual(['started', 'uploaded', 'accepted'])
      const again = await c.svc.complete(s.sessionId, T.teacher)
      expect(again.version.versionId).toBe(r.version.versionId)
      expect(await count('select 1 from public.versions where upload_session_id = $1', [s.sessionId])).toBe(1)
      expect((await attempts(s.sessionId)).slice(-1)[0]).toBe('duplicate_complete')
    })

    it('الإصدار الثاني: رقم 2 ومفتاح v2 وحالة أول إصدار (استبدال)', async () => {
      const c = ctx as Ctx
      const { T, start, upload } = mk(c)
      const s = await start({ name: 'plan2.pdf', size: 2500 })
      await upload(s)
      const r = await c.svc.complete(s.sessionId, T.teacher)
      expect(r.version.no).toBe(2)
      expect(r.version.storageKey).toBe('files/' + T.teacher + '/' + T.term + '/s1/v2.pdf')
      expect(r.version.statusSnapshot).toBe('on_time')
    })

    it('الملف لم يصل بعد: verification_pending (لا رفض)، الجلسة uploaded، ثم تُستأنف وتُقبل', async () => {
      const c = ctx as Ctx
      const { T, start, upload } = mk(c)
      const s = await start({ teacherId: T.teacher2, slotId: 's1' })
      expect(await code(c.svc.complete(s.sessionId, T.teacher2))).toBe('verification_pending')
      expect((await rows<{ state: string; reject_reason: string | null }>('select state, reject_reason from public.upload_sessions where id = $1', [s.sessionId]))[0]).toEqual({ state: 'uploaded', reject_reason: null })
      expect(await attempts(s.sessionId)).toEqual(['started', 'uploaded', 'validation_deferred:measurement_unavailable'])
      expect(await code(c.svc.cancel(s.sessionId, T.teacher2))).toBe('session_busy')
      await upload(s)
      const r = await c.svc.complete(s.sessionId, T.teacher2)
      expect(r.session.state).toBe('accepted')
      expect(r.version.no).toBe(1)
    })

    it('الرفض عند التحقق: حجم مخالف، توقيع مخالف، فارغ؛ والجلسة المرفوضة لا تُستأنف', async () => {
      const c = ctx as Ctx
      const { T, start, upload } = mk(c)
      // أ) حجم مخالف لما أُعلن
      const a = await start({ teacherId: T.teacher2, slotId: 's2', size: 2000 })
      await upload(a, PDF_HEAD, 1999)
      expect(await code(c.svc.complete(a.sessionId, T.teacher2))).toBe('size_mismatch')
      expect(await code(c.svc.complete(a.sessionId, T.teacher2))).toBe('session_closed')
      expect((await attempts(a.sessionId)).slice(-1)[0]).toBe('rejected:size_mismatch')
      // ب) توقيع PNG باسم pdf
      const b = await start({ teacherId: T.teacher2, slotId: 's2', size: 100 })
      await upload(b, PNG_HEAD, 100)
      expect(await code(c.svc.complete(b.sessionId, T.teacher2))).toBe('signature_mismatch')
      // ج) لا إصدار من أي منها
      expect(await count('select 1 from public.versions where upload_session_id = any($1::uuid[])'.replace('$1::uuid[]', `array['${a.sessionId}','${b.sessionId}']::uuid[]`))).toBe(0)
      // د) بعد الرفض تبدأ جلسة جديدة بمفتاح جديد
      const d = await start({ teacherId: T.teacher2, slotId: 's2', size: 100 })
      expect(d.sessionId === a.sessionId || d.sessionId === b.sessionId).toBe(false)
      await c.svc.cancel(d.sessionId, T.teacher2)
    })

    it('عزل المعلمات: إتمام/إلغاء جلسة غيرها أو مجهولة أو بمعرّف مشوّه = not_found وتُسجَّل denied', async () => {
      const c = ctx as Ctx
      const { T, start } = mk(c)
      const s = await start({ teacherId: T.teacher2, slotId: 's2', size: 123 })
      const d0 = await count(`select 1 from public.upload_attempts where outcome = 'denied' and teacher_id = $1`, [T.teacher])
      expect(await code(c.svc.complete(s.sessionId, T.teacher))).toBe('not_found')
      expect(await code(c.svc.cancel(s.sessionId, T.teacher))).toBe('not_found')
      expect(await code(c.svc.complete('00000000-0000-0000-0000-00000000dead', T.teacher))).toBe('not_found')
      expect(await code(c.svc.complete("x'; drop table public.versions;--", T.teacher))).toBe('not_found')
      expect(await code(c.svc.complete(s.sessionId, '00000000-0000-0000-0000-00000000dead'))).toBe('not_found')
      expect(await count(`select 1 from public.upload_attempts where outcome = 'denied' and teacher_id = $1`, [T.teacher])).toBe(d0 + 4)
      expect((await rows<{ state: string }>('select state from public.upload_sessions where id = $1', [s.sessionId]))[0].state).toBe('started')
      await c.svc.cancel(s.sessionId, T.teacher2)
    })

    it('انقضاء النافذة: الإتمام بعد الانقضاء expired بلا إصدار، والمسح الدوري يعدّ المنقضية، ثم جلسة جديدة', async () => {
      const c = ctx as Ctx
      const { T, start, upload } = mk(c)
      const a = await start({ teacherId: T.teacher2, slotId: 's1', name: 'late.pdf', size: 500 })
      await upload(a, PDF_HEAD, 500)
      await c.env.backdate(a.sessionId, 121)
      expect(await code(c.svc.complete(a.sessionId, T.teacher2))).toBe('expired')
      expect(await count('select 1 from public.versions where upload_session_id = $1', [a.sessionId])).toBe(0)
      expect((await attempts(a.sessionId)).slice(-1)[0]).toBe('expired:expired')
      // مسح دوري
      const b = await start({ teacherId: T.teacher2, slotId: 's2', size: 700 })
      await c.env.backdate(b.sessionId, 130)
      const swept = await c.svc.sweepExpired()
      expect(swept >= 1).toBe(true)
      expect((await rows<{ state: string; reject_reason: string }>('select state, reject_reason from public.upload_sessions where id = $1', [b.sessionId]))[0]).toEqual({ state: 'expired', reject_reason: 'expired' })
      // بدء جديد يُنهي المنقضية كسولًا ولا يتعطل بالفهرس الفريد
      const e = await start({ teacherId: T.teacher2, slotId: 's2', size: 701 })
      expect(e.sessionId === b.sessionId).toBe(false)
      const f = await start({ teacherId: T.teacher2, slotId: 's2', size: 701, idempotencyKey: key() })
      expect(f.sessionId).toBe(e.sessionId)
      await c.svc.cancel(e.sessionId, T.teacher2)
      // تكرار بدء بمفتاح جلسة منقضية لا يُحييها
      const g = await start({ teacherId: T.teacher2, slotId: 's1', size: 10, idempotencyKey: 'exp-key' })
      await c.env.backdate(g.sessionId, 200)
      const g2 = await start({ teacherId: T.teacher2, slotId: 's1', size: 10, idempotencyKey: 'exp-key' })
      expect(g2.sessionId).toBe(g.sessionId)
      expect(g2.state).toBe('expired')
    })

    it('الإلغاء: started فقط؛ مكرر session_closed؛ بعد الإلغاء جلسة جديدة بمفتاح جديد', async () => {
      const c = ctx as Ctx
      const { T, start } = mk(c)
      const s = await start({ teacherId: T.teacher2, slotId: 's1', size: 321 })
      const r = await c.svc.cancel(s.sessionId, T.teacher2)
      expect(r.state).toBe('cancelled')
      expect(await code(c.svc.cancel(s.sessionId, T.teacher2))).toBe('session_closed')
      expect(await code(c.svc.complete(s.sessionId, T.teacher2))).toBe('session_closed')
      expect(await attempts(s.sessionId)).toEqual(['started', 'cancelled'])
      const n2 = await start({ teacherId: T.teacher2, slotId: 's1', size: 321 })
      expect(n2.sessionId === s.sessionId).toBe(false)
      await c.svc.cancel(n2.sessionId, T.teacher2)
    })

    it('المواعيد: خانة بعد الإغلاق deadline_closed (يُسجَّل)، ونافذة المتأخر late تُثبَّت ولا تتغير بتعديل المواعيد لاحقًا', async () => {
      const c = ctx as Ctx
      const { T, start, upload } = mk(c)
      expect(await code(start({ termId: T.termClosed }))).toBe('deadline_closed')
      expect(await count(`select 1 from public.upload_attempts where outcome = 'start_rejected' and reason = 'deadline_closed'`)).toBe(1)
      // الأساسي مضى بالأمس والمتأخر في المستقبل ⇒ late
      await c.env.setDeadlines(T.termClosed, { base: new Date(Date.now() - 2 * 86400e3).toISOString().slice(0, 10), late: new Date(Date.now() + 5 * 86400e3).toISOString().slice(0, 10), replace: new Date(Date.now() + 9 * 86400e3).toISOString().slice(0, 10) })
      const s = await start({ termId: T.termClosed, size: 400 })
      expect(s.statusAtStart).toBe('late')
      // يُعدَّل الأساسي إلى المستقبل بعد البدء: الحالة المثبتة لا تتغير (A-33)
      await c.env.setDeadlines(T.termClosed, { base: new Date(Date.now() + 3 * 86400e3).toISOString().slice(0, 10), late: new Date(Date.now() + 5 * 86400e3).toISOString().slice(0, 10), replace: new Date(Date.now() + 9 * 86400e3).toISOString().slice(0, 10) })
      await upload(s)
      const r = await c.svc.complete(s.sessionId, T.teacher)
      expect(r.version.statusSnapshot).toBe('late')
      // استبدال بعد انتهاء مهلة الاستبدال ⇒ مغلق
      await c.env.setDeadlines(T.termClosed, { base: '2020-01-01', late: '2020-01-02', replace: '2020-01-03' })
      expect(await code(start({ termId: T.termClosed, size: 401 }))).toBe('deadline_closed')
    })

    it('بقايا نسخة نهائية بمحتوى مختلف: تأجيل ظاهر (final_key_conflict) لا رفض ولا دهس', async () => {
      const c = ctx as Ctx
      const { T, start, upload } = mk(c)
      const s = await start({ teacherId: T.teacher2, slotId: 's2', size: 640 })
      await upload(s, PDF_HEAD, 640)
      // المفتاح النهائي المتوقع للإصدار 1 محجوز ببايتات مغايرة (محاكاة يتيم)
      await c.storage.put({ key: `files/${T.teacher2}/${T.term}/s2/v1.pdf`, data: bytes(PDF_HEAD, 99, 3) })
      expect(await code(c.svc.complete(s.sessionId, T.teacher2))).toBe('verification_pending')
      expect((await attempts(s.sessionId)).slice(-1)[0]).toBe('validation_deferred:final_key_conflict')
      expect(await count('select 1 from public.versions where upload_session_id = $1', [s.sessionId])).toBe(0)
      const o = await c.storage.get(`files/${T.teacher2}/${T.term}/s2/v1.pdf`)
      expect((o as { sizeBytes: number }).sizeBytes).toBe(99) // لم يُدهس
    })

    it('بقايا نسخة نهائية بالمحتوى نفسه (انقطاع سابق بعد النسخ): تُقبل وتُسجَّل', async () => {
      const c = ctx as Ctx
      const { T, start, upload } = mk(c)
      const s = await start({ teacherId: T.teacher2, slotId: 's1', size: 650 })
      await upload(s, PDF_HEAD, 650)
      // الإصدار 1 لهذه المعلمة/الخانة s1 غير موجود بعد (المعلمة2 أكملت s1 سابقًا في اختبار الاستئناف ⇒ هذا هو الثاني)
      const next = (await rows<{ no: number }>(`select coalesce(max(no),0)+1 as no from public.versions where teacher_id = $1 and term_id = $2 and slot_id = 's1'`, [T.teacher2, T.term]))[0].no
      await c.storage.put({ key: `files/${T.teacher2}/${T.term}/s1/v${next}.pdf`, data: bytes(PDF_HEAD, 650) })
      const r = await c.svc.complete(s.sessionId, T.teacher2)
      expect(r.version.no).toBe(next)
    })

    it('تعطّل التخزين أثناء القراءة: تأجيل لا رفض', async () => {
      const c = ctx as Ctx
      const { T, start } = mk(c)
      const broken = new MemoryStorageAdapter()
      broken.get = async () => { throw new Error('storage down') }
      const svc = new UploadService({ db: c.env.db, storage: broken })
      const s = await start({ teacherId: T.teacher, slotId: 's2', size: 55 })
      expect(await code(svc.complete(s.sessionId, T.teacher))).toBe('verification_pending')
      expect((await rows<{ state: string }>('select state from public.upload_sessions where id = $1', [s.sessionId]))[0].state).toBe('uploaded')
      await c.storage.put({ key: s.pendingKey, data: bytes(PDF_HEAD, 55) })
      const r = await c.svc.complete(s.sessionId, T.teacher)
      expect(r.session.state).toBe('accepted')
    })

    it('جلسة validating عالقة: recoverStuck تعيدها uploaded (بعد المهلة فقط) ثم تُستأنف', async () => {
      const c = ctx as Ctx
      const { start, upload } = mk(c)
      const tt = await newTeacher()
      const s = await start({ teacherId: tt, slotId: 's2', size: 800 })
      await upload(s, PDF_HEAD, 800)
      // محاكاة انقطاع بعد الانتقال إلى validating
      await c.env.admin.transaction(async (x) => { await x.exec(`update public.upload_sessions set state = 'uploaded' where id = $1`, [s.sessionId]); await x.exec(`update public.upload_sessions set state = 'validating' where id = $1`, [s.sessionId]) })
      expect(await code(c.svc.complete(s.sessionId, tt))).toBe('session_busy')
      expect(await c.svc.recoverStuck()).toBe(0) // لم تمضِ المهلة
      await c.env.backdateValidating(s.sessionId, 11)
      expect(await c.svc.recoverStuck()).toBe(1)
      expect((await attempts(s.sessionId)).slice(-1)[0]).toBe('validation_recovered')
      const r = await c.svc.complete(s.sessionId, tt)
      expect(r.session.state).toBe('accepted')
    })

    it('إفراج المالكة أثناء القياس: لا إصدار، وخطأ نظيف session_busy (القاعدة تحمي حتى لو غاب فحص الخدمة)', async () => {
      const c = ctx as Ctx
      const { start } = mk(c)
      const tt = await newTeacher()
      const s = await start({ teacherId: tt, slotId: 's1', size: 90 })
      await c.storage.put({ key: s.pendingKey, data: bytes(PDF_HEAD, 90) })
      const inner = c.storage
      const racing = new MemoryStorageAdapter()
      racing.get = async (k) => {
        const o = await inner.get(k)
        // أثناء القراءة: تفرج المالكة عن الجلسة (إجراء إداري يُحاكى هنا بالمشرف)
        await c.env.admin.transaction((x) => x.exec(`update public.upload_sessions set state = 'cancelled', release_note = 'إفراج أثناء التحقق' where id = $1`, [s.sessionId]))
        return o
      }
      const svc = new UploadService({ db: c.env.db, storage: racing })
      expect(await code(svc.complete(s.sessionId, tt))).toBe('session_busy')
      expect(await count('select 1 from public.versions where upload_session_id = $1', [s.sessionId])).toBe(0)
      expect((await rows<{ state: string }>('select state from public.upload_sessions where id = $1', [s.sessionId]))[0].state).toBe('cancelled')
    })

    it('الوراثة الصريحة: إفراج مُعلَّم بعطل منصة يورّث وقت البدء مرة واحدة فقط', async () => {
      const c = ctx as Ctx
      const { T, start } = mk(c)
      await c.env.setDeadlines(T.term, { base: new Date(Date.now() - 86400e3).toISOString().slice(0, 10), late: new Date(Date.now() + 5 * 86400e3).toISOString().slice(0, 10), replace: new Date(Date.now() + 9 * 86400e3).toISOString().slice(0, 10) })
      const slotTeacher = T.teacher2
      // معلمة2 لها إصدارات في s1/s2 بالفعل؛ نستعمل مجموعة جديدة: الفصل المغلق السابق مضبوط على 2020، فنعيد ضبطه
      await c.env.setDeadlines(T.termClosed, { base: new Date(Date.now() - 86400e3).toISOString().slice(0, 10), late: new Date(Date.now() + 5 * 86400e3).toISOString().slice(0, 10), replace: new Date(Date.now() + 9 * 86400e3).toISOString().slice(0, 10) })
      const a = await start({ teacherId: slotTeacher, termId: T.termClosed, slotId: 's2', size: 900 })
      expect(a.statusAtStart).toBe('late')
      await c.env.admin.transaction(async (x) => {
        await x.exec(`update public.upload_sessions set state = 'uploaded' where id = $1`, [a.sessionId])
        await x.exec(`update public.upload_sessions set state = 'cancelled', release_note = 'عطل التخزين', platform_fault = true where id = $1`, [a.sessionId])
      })
      // الموعد انتهى فعليًا الآن، لكن الوراثة تحفظ late
      await c.env.setDeadlines(T.termClosed, { base: '2020-01-01', late: '2020-01-02', replace: '2020-01-03' })
      const b = await start({ teacherId: slotTeacher, termId: T.termClosed, slotId: 's2', size: 900 })
      expect(b.statusAtStart).toBe('late')
      const row = (await rows<{ inherited_from: string; eff: boolean }>('select inherited_from, (effective_start_at = (select effective_start_at from public.upload_sessions where id = $2)) as eff from public.upload_sessions where id = $1', [b.sessionId, a.sessionId]))[0]
      expect(row.inherited_from).toBe(a.sessionId)
      expect(row.eff).toBe(true)
      expect((await attempts(b.sessionId)).includes(`start_inherited:from:${a.sessionId}`)).toBe(true)
      await c.svc.cancel(b.sessionId, slotTeacher)
      // الإذن استُهلك: جلسة ثالثة تُحسب من المواعيد (مغلق)
      expect(await code(start({ teacherId: slotTeacher, termId: T.termClosed, slotId: 's2', size: 900 }))).toBe('deadline_closed')
    })

    it('الروابط: https فقط، تكرار الرابط الأخير يعيد الإصدار، رقم الإصدار يتتابع مع الملفات، والمواعيد تُغلق', async () => {
      const c = ctx as Ctx
      const { T } = mk(c)
      // فصل نظيف بمواعيد مفتوحة
      await c.env.setDeadlines(T.term, { base: new Date(Date.now() + 5 * 86400e3).toISOString().slice(0, 10), late: new Date(Date.now() + 9 * 86400e3).toISOString().slice(0, 10), replace: new Date(Date.now() + 20 * 86400e3).toISOString().slice(0, 10) })
      const t3 = await newTeacher()
      const link = (url: string, slotId = 's2') => c.svc.saveLink({ teacherId: t3, termId: T.term, slotId, url })
      const a = await link('https://drive.example.com/file/abc?x=1')
      expect(a.reused).toBe(false)
      expect(a.version.kind).toBe('link')
      expect(a.version.no).toBe(1)
      expect(a.version.statusSnapshot).toBe('on_time')
      expect(a.version.storageKey).toBeNull()
      const same = await link('  https://drive.example.com/file/abc?x=1  ')
      expect(same.reused).toBe(true)
      expect(same.version.versionId).toBe(a.version.versionId)
      const b = await link('https://drive.example.com/file/xyz')
      expect(b.version.no).toBe(2)
      // رفض الروابط الرديئة
      for (const bad of ['http://drive.example.com/a', 'javascript:alert(1)', 'ftp://x.com/a', 'https://user:pw@drive.example.com/a', 'https://exa mple.com', 'https://localhost/a', 'https://', '', 'https://x.com/a\nb', 'data:text/html,hi', 'https://' + 'a'.repeat(2100) + '.com', 5 as unknown as string, 'HTTPS://\u0000x.com'])
        expect(await code(link(bad))).toBe('bad_url')
      expect(await count(`select 1 from public.versions where teacher_id = $1 and kind = 'link'`, [t3])).toBe(2)
      // ملف بعد رابطين = رقم 3 بلا تضارب
      const { start, upload } = mk(c)
      const s = await start({ teacherId: t3, slotId: 's2', size: 300 })
      await upload(s, PDF_HEAD, 300)
      const r = await c.svc.complete(s.sessionId, t3)
      expect(r.version.no).toBe(3)
      // وتدوين التدقيق
      expect(await count(`select 1 from public.audit_log where action = 'link.saved'`)).toBe(2)
      // خانة مجهولة / فصل مغلق
      expect(await code(link('https://ok.example.com/a', 's99'))).toBe('not_found')
      await c.env.setDeadlines(T.termClosed, { base: '2020-01-01', late: '2020-01-02', replace: '2020-01-03' })
      expect(await code(c.svc.saveLink({ teacherId: t3, termId: T.termClosed, slotId: 's1', url: 'https://ok.example.com/a' }))).toBe('deadline_closed')
    })

    it('التزامن الحقيقي: بدء متوازٍ بالمفتاح نفسه ينتج جلسة واحدة، وإتمام متوازٍ ينتج إصدارًا واحدًا', async () => {
      const c = ctx as Ctx
      const { T, start, upload } = mk(c)
      await c.env.setDeadlines(T.term, { base: new Date(Date.now() + 5 * 86400e3).toISOString().slice(0, 10), late: new Date(Date.now() + 9 * 86400e3).toISOString().slice(0, 10), replace: new Date(Date.now() + 20 * 86400e3).toISOString().slice(0, 10) })
      const t4 = await newTeacher()
      const k = key()
      const res = await Promise.allSettled(Array.from({ length: 6 }, () => start({ teacherId: t4, slotId: 's1', size: 1234, idempotencyKey: k })))
      const ok = res.filter((r): r is PromiseFulfilledResult<SessionView> => r.status === 'fulfilled')
      expect(ok.length).toBe(6)
      expect(new Set(ok.map((r) => r.value.sessionId)).size).toBe(1)
      expect(await count('select 1 from public.upload_sessions where teacher_id = $1', [t4])).toBe(1)
      // بدء متوازٍ بمفاتيح مختلفة لنفس الخانة والملف: جلسة واحدة نشطة
      const res2 = await Promise.allSettled(Array.from({ length: 6 }, () => start({ teacherId: t4, slotId: 's2', size: 77 })))
      const ids2 = new Set(res2.filter((r): r is PromiseFulfilledResult<SessionView> => r.status === 'fulfilled').map((r) => r.value.sessionId))
      expect(ids2.size).toBe(1)
      expect(await count(`select 1 from public.upload_sessions where teacher_id = $1 and slot_id = 's2' and state = 'started'`, [t4])).toBe(1)
      // إتمام متوازٍ
      const s = ok[0].value
      await upload(s, PDF_HEAD, 1234)
      const cr = await Promise.allSettled(Array.from({ length: 5 }, () => c.svc.complete(s.sessionId, t4)))
      const accepted = cr.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<UploadService['complete']>>> => r.status === 'fulfilled')
      expect(accepted.length >= 1).toBe(true)
      expect(new Set(accepted.map((r) => r.value.version.versionId)).size).toBe(1)
      for (const r of cr) if (r.status === 'rejected') expect((r.reason as ServiceError).code).toBe('session_busy')
      expect(await count('select 1 from public.versions where upload_session_id = $1', [s.sessionId])).toBe(1)
      expect((await rows<{ state: string }>('select state from public.upload_sessions where id = $1', [s.sessionId]))[0].state).toBe('accepted')
      // رابط وإتمام بالتوازي على خانة واحدة: أرقام الإصدارات بلا ثقوب ولا تكرار
      const s2r = ids2.values().next().value as string
      const sv = (await rows<{ pending_key: string }>('select pending_key from public.upload_sessions where id = $1', [s2r]))[0]
      await c.storage.put({ key: sv.pending_key, data: bytes(PDF_HEAD, 77) })
      const mix = await Promise.allSettled([
        c.svc.complete(s2r, t4),
        c.svc.saveLink({ teacherId: t4, termId: T.term, slotId: 's2', url: 'https://race.example.com/1' }),
        c.svc.saveLink({ teacherId: t4, termId: T.term, slotId: 's2', url: 'https://race.example.com/2' }),
      ])
      expect(mix.map((m) => (m.status === 'fulfilled' ? 'ok' : (m.reason as Error).message))).toEqual(['ok', 'ok', 'ok'])
      const nos = (await rows<{ no: number }>(`select no from public.versions where teacher_id = $1 and slot_id = 's2' order by no`, [t4])).map((r) => r.no)
      expect(nos).toEqual([1, 2, 3])
    })

    it('حفظ الإصدارات غير قابل للتعديل من الخدمة (service_role): تعديل/حذف مرفوضان من القاعدة نفسها', async () => {
      const c = ctx as Ctx
      let e1 = '', e2 = ''
      try { await c.env.db.transaction((x) => x.exec(`update public.versions set original_name = 'x'`)) } catch (e) { e1 = (e as { sqlstate: string }).sqlstate }
      try { await c.env.db.transaction((x) => x.exec(`delete from public.versions`)) } catch (e) { e2 = (e as { sqlstate: string }).sqlstate }
      expect(e1).toBe('42501')
      expect(e2).toBe('42501')
      let e3 = ''
      try { await c.env.db.transaction((x) => x.exec(`update public.upload_attempts set reason = 'x'`)) } catch (e) { e3 = (e as { sqlstate: string }).sqlstate }
      expect(e3).toBe('42501')
    })

    it('تنظيف قاعدة الاختبار', async () => {
      await (ctx as Ctx).env.dispose()
      ctx = null
      expect(true).toBe(true)
    })
  })

  // ---------------------------------------------------------------- مقارنة مع المحاكي المرجعي
  describe('تكافؤ الخدمات مع المحاكي المرجعي UploadLedger (نفس السيناريو ⇒ نفس النتائج ونفس سجل المحاولات)', () => {
    type Step =
      | { op: 'start'; key: string; name?: string; size?: number }
      | { op: 'put'; size?: number; head?: number[] }
      | { op: 'complete' }
      | { op: 'cancel' }
    const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    const SCENARIOS: Record<string, Step[]> = {
      'مسار سعيد + تكرارات': [
        { op: 'start', key: 'a' }, { op: 'start', key: 'a' }, { op: 'start', key: 'b' }, { op: 'start', key: 'c', size: 999 }, { op: 'start', key: 'a', size: 5 },
        { op: 'complete' }, { op: 'put' }, { op: 'complete' }, { op: 'complete' }, { op: 'cancel' },
        { op: 'start', key: 'n', name: 'second.pdf', size: 1500 }, { op: 'put', size: 1500 }, { op: 'complete' },
      ],
      'رفض عند البدء ثم حجم مخالف ثم إعادة': [
        { op: 'start', key: 'a', name: 'x.exe' }, { op: 'start', key: 'b', size: 0 }, { op: 'start', key: 'c', size: 60_000_000 }, { op: 'start', key: 'd' },
        { op: 'put', size: 1999 }, { op: 'complete' }, { op: 'complete' }, { op: 'cancel' }, { op: 'start', key: 'e' }, { op: 'cancel' }, { op: 'cancel' }, { op: 'complete' },
      ],
      'توقيع مخالف، وإلغاء بعد الوصول، واستئناف': [
        { op: 'start', key: 'a' }, { op: 'put', head: PNG }, { op: 'complete' }, { op: 'cancel' },
        { op: 'start', key: 'b' }, { op: 'complete' }, { op: 'cancel' }, { op: 'start', key: 'c' }, { op: 'put' }, { op: 'complete' }, { op: 'complete' },
      ],
    }
    for (const [name, steps] of Object.entries(SCENARIOS)) {
      it(name, async () => {
        const env = await createTestEnv({ extraFiles: ['database/012_teacher_delete.sql'] })
        try {
          const storage = new MemoryStorageAdapter()
          const svc = new UploadService({ db: env.db, storage })
          const ledger = new UploadLedger({
            settings: { maxFileBytes: 50_000_000, allowedExtensions: ['pdf', 'docx', 'pptx', 'xlsx', 'jpg', 'jpeg', 'png', 'webp', 'gif'] },
            caps: { maxObjectBytes: null }, windowMinutes: 120, now: () => Date.now(), gate: () => 'on_time',
          })
          const { teacher, term } = env.ids
          const errCode = (e: unknown) => (e as { code?: string }).code ?? `other:${(e as Error).message}`
          const seenR = new Set<string>()
          const seenL = new Set<string>()
          let cur: { id: string; key: string } | null = null
          let curL: string | null = null
          const obsL = new Map<string, { sizeBytes: number; sha256: string; head: Uint8Array } | undefined>()
          const real: string[] = []
          const model: string[] = []
          for (const st of steps) {
            if (st.op === 'start') {
              const input = { name: st.name ?? 'plan.pdf', size: st.size ?? 2000 }
              try {
                const v = await svc.start({ teacherId: teacher, termId: term, slotId: 's1', ...input, idempotencyKey: st.key })
                cur = { id: v.sessionId, key: v.pendingKey }
                real.push(`start:${v.state}:${seenR.has(v.sessionId) ? 'reused' : 'new'}`)
                seenR.add(v.sessionId)
              } catch (e) { real.push(`start:${errCode(e)}`) }
              try {
                const r = ledger.start({ teacherId: teacher, termId: term, slotId: 's1', ...input, idempotencyKey: st.key })
                curL = r.id
                model.push(`start:${r.state}:${seenL.has(r.id) ? 'reused' : 'new'}`)
                seenL.add(r.id)
              } catch (e) { model.push(`start:${errCode(e)}`) }
            } else if (st.op === 'put') {
              const blob = bytes(st.head ?? PDF_HEAD, st.size ?? 2000)
              if (cur) await storage.put({ key: cur.key, data: blob })
              if (curL) obsL.set(curL, { sizeBytes: blob.size, sha256: await hashBlob(blob), head: new Uint8Array(await blob.slice(0, 32).arrayBuffer()) })
              real.push('put'); model.push('put')
            } else if (st.op === 'complete') {
              try { const r = await svc.complete((cur as { id: string }).id, teacher); real.push(`complete:${r.session.state}:v${r.version.no}`) } catch (e) { real.push(`complete:${errCode(e)}`) }
              try { const r = ledger.complete(curL as string, teacher, obsL.get(curL as string) ?? null); model.push(`complete:${r.session.state}:v${r.version.no}`) } catch (e) { model.push(`complete:${errCode(e)}`) }
            } else {
              try { const r = await svc.cancel((cur as { id: string }).id, teacher); real.push(`cancel:${r.state}`) } catch (e) { real.push(`cancel:${errCode(e)}`) }
              try { const r = ledger.cancel(curL as string, teacher); model.push(`cancel:${r.state}`) } catch (e) { model.push(`cancel:${errCode(e)}`) }
            }
          }
          expect(real).toEqual(model)
          const dbAttempts = (await env.admin.transaction((c) => c.query<{ outcome: string; reason: string | null }>('select outcome, reason from public.upload_attempts order by id'))).map((r) => `${r.outcome}:${r.reason ?? ''}`)
          const ledgerAttempts = ledger.listAttempts().map((a) => `${a.outcome}:${a.reason ?? ''}`)
          expect(dbAttempts).toEqual(ledgerAttempts)
          expect(real.length).toBe(steps.length)
        } finally { await env.dispose() }
      })
    }
  })
}
