// مولَّد آليًا من server/services/uploadService.ts بواسطة scripts/build-edge-function.mjs — لا تعدّليه يدويًا.
// خدمات الرفع الخادمية (الدفعة 2، العمل 3): بدء، إتمام، إلغاء، حفظ رابط، وصيانة (مسح المنقضية واستئناف العالقة).
// تطبّق عقد docs/phase5/UPLOAD_CONTRACT.md فوق قاعدة 001–004، وتُقارَن بالمحاكي المرجعي src/lib/upload/ledger.ts.
// **الحدود الصريحة:**
//  * تفترض أن `teacherId` جاء من دخول معلمة موثوق (العمل 4 لم يُبنَ بعد)؛ الخدمة لا تتحقق من هوية المتصل، بل تعزل بالمعرّف الممرَّر.
//  * مفاتيح الكائنات تُشتق هنا فقط (server/objectKey.ts)؛ لا تُقبل من العميل.
//  * لا اتصال بأي خدمة حقيقية: القاعدة والتخزين يُحقنان (اختبارًا: Postgres محلي + تخزين الذاكرة).
//  * لا حذف لأي كائن (A-44، D-11): الكائنات المعلّقة اليتيمة تبقى.
import { checkFile } from '../../src/lib/storage/settings.ts'
import type { ProviderCapabilities, StorageSettings } from '../../src/lib/storage/settings.ts'
import type { StorageAdapter } from '../../src/lib/storage/adapter.ts'
import { StorageError } from '../../src/lib/storage/errors.ts'
import { extOf } from '../../src/lib/storage/settings.ts'
import { verifyUpload } from '../../src/lib/upload/verify.ts'
import type { Db, SqlClient } from '../db/types.ts'
import { DbError } from '../db/types.ts'
import { assertExt, assertId, buildFinalObjectKey, buildPendingObjectKey, ObjectKeyError } from '../objectKey.ts'
import { ServiceError } from './errors.ts'
import type { ServiceErrorCode } from './errors.ts'
import { submissionGate } from './gate.ts'
import type { TermDates } from './gate.ts'
import { mimeFromSignature, readObject } from './observe.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_NAME = 255
const MAX_URL = 2048
const MAX_IDEM = 128
const MAX_NOTE = 1000
const MAX_ATTEMPTS = 3

type Failure = { readonly __fail: ServiceErrorCode }
const fail = (code: ServiceErrorCode): Failure => ({ __fail: code })
const isFail = (x: unknown): x is Failure => typeof x === 'object' && x !== null && '__fail' in x

interface SessionRow {
  id: string
  teacher_id: string
  term_id: string
  slot_id: string
  declared_name: string
  declared_size: number
  pending_key: string | null
  state: string
  reject_reason: string | null
  started_at: string
  expires_at: string
  status_at_start: 'on_time' | 'late'
  effective_start_at: string
  uploaded_at: string | null
  validating_at: string | null
  inherited_from: string | null
  platform_fault: boolean
}

interface SettingsRow {
  now: string
  max_file_bytes: number
  allowed_types: string[]
  upload_window_minutes: number
}

export interface SessionView {
  sessionId: string
  state: string
  /** المفتاح المؤقت المشتق في الخادم؛ يرفع العميل (أو مزوّد التخزين لاحقًا) إليه وحده. */
  pendingKey: string
  declaredName: string
  declaredSize: number
  statusAtStart: 'on_time' | 'late'
  startedAt: string
  expiresAt: string
  /** true إن أُعيد استعمال جلسة قائمة (تكرار طلب أو إعادة محاولة) بدل إنشاء جديدة. */
  reused: boolean
}

export interface VersionView {
  versionId: string
  no: number
  kind: 'file' | 'link'
  statusSnapshot: 'on_time' | 'late'
  submittedAt: string
  storageKey: string | null
  sizeBytes: number | null
  sha256: string | null
  url: string | null
}

export interface PendingSessionView {
  sessionId: string
  teacherId: string
  slotId: string
  state: string
  declaredName: string
  declaredSize: number
  uploadedAt: string | null
  validatingAt: string | null
  waitingMinutes: number
}

export interface OverviewView {
  termId: string
  asOf: string
  sessionsByState: Record<string, number>
  pending: PendingSessionView[]
  submissions: { slotsSubmitted: number; onTime: number; late: number; teachersWithSubmissions: number }
}

export interface StartInput {
  teacherId: string
  termId: string
  slotId: string
  name: string
  size: number
  idempotencyKey: string
}

export interface UploadServiceDeps {
  db: Db
  storage: StorageAdapter
  /** مولّد معرّفات الجلسات (UUID). يُحقن في الاختبار فقط. */
  newId?: () => string
}

export class UploadService {
  private readonly db: Db
  private readonly storage: StorageAdapter
  private readonly newId: () => string

  constructor(deps: UploadServiceDeps) {
    this.db = deps.db
    this.storage = deps.storage
    this.newId = deps.newId ?? (() => globalThis.crypto.randomUUID())
  }

  // ------------------------------------------------------------------ مساعدات
  private async tx<T>(fn: (c: SqlClient) => Promise<T | Failure>): Promise<T> {
    const r = await this.db.transaction(fn)
    if (isFail(r)) throw new ServiceError(r.__fail)
    return r
  }

  private async log(c: SqlClient, teacherId: string, sessionId: string | null, outcome: string, reason: string | null = null): Promise<void> {
    await c.exec('insert into public.upload_attempts (teacher_id, session_id, outcome, reason) values ($1, $2, $3, $4)', [teacherId, sessionId, outcome, reason])
  }

  private async settings(c: SqlClient): Promise<SettingsRow> {
    const r = (await c.query<SettingsRow>('select now() as now, max_file_bytes, allowed_types, upload_window_minutes from public.app_settings where id'))[0]
    if (!r) throw new ServiceError('bad_request', 'settings_missing')
    return r
  }

  private toSettings(s: SettingsRow): StorageSettings {
    return { maxFileBytes: Number(s.max_file_bytes), allowedExtensions: s.allowed_types }
  }

  private get caps(): ProviderCapabilities {
    return this.storage.capabilities
  }

  private async teacherActive(c: SqlClient, teacherId: string): Promise<boolean | null> {
    const r = (await c.query<{ is_active: boolean }>('select is_active from public.teachers where id = $1', [teacherId]))[0]
    return r ? r.is_active : null
  }

  private view(s: SessionRow, reused: boolean): SessionView {
    return {
      sessionId: s.id, state: s.state, pendingKey: s.pending_key as string, declaredName: s.declared_name, declaredSize: Number(s.declared_size),
      statusAtStart: s.status_at_start, startedAt: s.started_at, expiresAt: s.expires_at, reused,
    }
  }

  private checkIds(ids: Record<string, string>): void {
    try {
      for (const [k, v] of Object.entries(ids)) assertId(k, v)
    } catch (e) {
      if (e instanceof ObjectKeyError) throw new ServiceError('bad_request', e.message)
      throw e
    }
  }

  /** ينهي started المنقضية الآن (انقضاء كسول). يعيد true إن أنهاها. */
  private async expireIfDue(c: SqlClient, s: SessionRow): Promise<boolean> {
    if (s.state !== 'started') return false
    const r = await c.query<{ id: string }>(
      `update public.upload_sessions set state = 'expired', reject_reason = 'expired' where id = $1 and state = 'started' and now() >= expires_at returning id`, [s.id])
    if (r.length === 0) return false
    await this.log(c, s.teacher_id, s.id, 'expired', 'expired')
    return true
  }

  // ------------------------------------------------------------------ بدء
  async start(input: StartInput): Promise<SessionView> {
    this.checkIds({ teacherId: input.teacherId, termId: input.termId, slotId: input.slotId })
    const key = typeof input.idempotencyKey === 'string' ? input.idempotencyKey.trim() : ''
    if (key === '') throw new ServiceError('bad_idempotency_key')
    if (key.length > MAX_IDEM) throw new ServiceError('bad_request', 'idempotency_key_too_long')
    if (typeof input.name !== 'string' || input.name.length === 0 || input.name.length > MAX_NAME || /[\u0000-\u001f\u007f]/.test(input.name)) throw new ServiceError('bad_request', 'name')
    if (!Number.isSafeInteger(input.size)) throw new ServiceError('bad_request', 'size')
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.tx((c) => this.startTx(c, input, key))
      } catch (e) {
        // سباق مع طلب مواز (مفتاح التكرار أو الجلسة النشطة الفريدة): الإعادة تقرأ ما أنشأه الطلب الآخر وتحسم بالمنطق نفسه.
        if (e instanceof DbError && e.sqlstate === '23505' && attempt < MAX_ATTEMPTS) continue
        throw e
      }
    }
  }

  private async startTx(c: SqlClient, input: StartInput, key: string): Promise<SessionView | Failure> {
    const st = await this.settings(c)
    const nowMs = Date.parse(st.now)
    const active = await this.teacherActive(c, input.teacherId)
    if (active === null) return fail('not_found')
    if (!active) { await this.log(c, input.teacherId, null, 'denied', 'teacher_inactive'); return fail('not_found') }
    const term = (await c.query<{ base: string; late: string; replace: string }>(
      'select deadline_base::text as base, deadline_late::text as late, deadline_replace::text as replace from public.terms where id = $1', [input.termId]))[0]
    const slot = (await c.query<{ id: string }>('select id from public.slots where id = $1', [input.slotId]))[0]
    if (!term || !slot) { await this.log(c, input.teacherId, null, 'denied', 'unknown_term_or_slot'); return fail('not_found') }

    // 1) مفتاح التكرار
    const dup = (await c.query<SessionRow>('select * from public.upload_sessions where teacher_id = $1 and idempotency_key = $2', [input.teacherId, key]))[0]
    if (dup) {
      const same = dup.term_id === input.termId && dup.slot_id === input.slotId && dup.declared_name === input.name && Number(dup.declared_size) === input.size
      if (!same) return fail('idempotency_conflict')
      // لا إحياء: تُنهى started المنقضية كسولًا، والباقي يُعاد كما هو.
      const expired = await this.expireIfDue(c, dup)
      const cur = expired ? { ...dup, state: 'expired', reject_reason: 'expired' } : dup
      await this.log(c, input.teacherId, dup.id, 'duplicate_start', cur.state)
      return this.view(cur, true)
    }

    // 2) الملف: الإعدادات من القاعدة، وحد المزوّد من المحوّل
    const settings = this.toSettings(st)
    const check = checkFile({ name: input.name, size: input.size }, settings, this.caps)
    if (!check.ok) { await this.log(c, input.teacherId, null, 'start_rejected', check.code); return fail(check.code) }

    // 3) جلسة نشطة واحدة لكل (معلمة، فصل، خانة)
    const act = (await c.query<SessionRow>(
      `select * from public.upload_sessions where teacher_id = $1 and term_id = $2 and slot_id = $3 and state in ('started','uploaded','validating') for update`,
      [input.teacherId, input.termId, input.slotId]))[0]
    if (act && !(await this.expireIfDue(c, act))) {
      if (act.state !== 'started') return fail('session_busy')
      if (act.declared_name === input.name && Number(act.declared_size) === input.size) {
        await this.log(c, input.teacherId, act.id, 'duplicate_start', 'active_reused')
        return this.view(act, true)
      }
      return fail('active_session_exists')
    }

    // 4) الموعد: وراثة صريحة (إفراج مالكة بعلامة عطل منصة، لمرة واحدة) أو حساب من المواعيد
    const grant = (await c.query<SessionRow>(
      `select g.* from public.upload_sessions g
        where g.teacher_id = $1 and g.term_id = $2 and g.slot_id = $3 and g.state = 'cancelled' and g.platform_fault
          and not exists (select 1 from public.upload_sessions k where k.inherited_from = g.id)
        order by g.started_at desc limit 1`, [input.teacherId, input.termId, input.slotId]))[0]
    let status: 'on_time' | 'late'
    if (grant) status = grant.status_at_start
    else {
      const first = (await c.query<{ status_snapshot: 'on_time' | 'late' }>(
        'select status_snapshot from public.versions where teacher_id = $1 and term_id = $2 and slot_id = $3 order by no asc limit 1', [input.teacherId, input.termId, input.slotId]))[0]
      const g = submissionGate(nowMs, term as TermDates, first ? first.status_snapshot : null)
      if (g === 'closed') { await this.log(c, input.teacherId, null, 'start_rejected', 'deadline_closed'); return fail('deadline_closed') }
      status = g
    }

    // 5) إنشاء الجلسة: المفتاح المؤقت يُشتق من رقم الجلسة؛ الأزمنة تفرضها مشغّلات القاعدة (ساعة القاعدة).
    const id = this.newId()
    const ext = assertExt(extOf(input.name), settings.allowedExtensions)
    const pendingKey = buildPendingObjectKey({ teacherId: input.teacherId, termId: input.termId, slotId: input.slotId, sessionId: id, ext }, settings.allowedExtensions)
    const ins = (await c.query<SessionRow>(
      `insert into public.upload_sessions (id, teacher_id, term_id, slot_id, declared_name, declared_size, pending_key, idempotency_key, status_at_start, expires_at, effective_start_at, inherited_from)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), now(), $10) returning *`,
      [id, input.teacherId, input.termId, input.slotId, input.name, input.size, pendingKey, key, status, grant ? grant.id : null]))[0]
    await this.log(c, input.teacherId, id, 'started')
    if (grant) await this.log(c, input.teacherId, id, 'start_inherited', `from:${grant.id}`)
    return this.view(ins, false)
  }

  // ------------------------------------------------------------------ إتمام
  /**
   * إشعار اكتمال الرفع. الخادم يقرأ الكائن الفعلي من التخزين ويقيسه، ثم يسجّل الإصدار ذرّيًا.
   * التخزين لا يكون داخل معاملة قاعدة؛ لذلك تُقسَّم العملية إلى معاملات قصيرة، وأي انقطاع بينها يترك الجلسة uploaded/validating
   * فتُستأنف بإعادة complete أو recoverStuck (لا رفض بالتأخير، قرار 5.A).
   */
  async complete(sessionId: string, teacherId: string): Promise<{ session: SessionView; version: VersionView }> {
    this.checkIds({ teacherId })
    const a = await this.begin(sessionId, teacherId)
    if ('done' in a) return a.done
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const out = await this.measureAndRegister(a.s, teacherId)
      if (out !== 'retry') return out
    }
    // تزاحم متكرر على رقم الإصدار: لا رفض؛ تعود الجلسة uploaded وتُستأنف بإعادة complete.
    await this.tx(async (c) => {
      await c.exec(`update public.upload_sessions set state = 'uploaded' where id = $1 and state = 'validating'`, [a.s.id])
      await this.log(c, teacherId, a.s.id, 'validation_deferred', 'version_number_race')
      return true
    })
    throw new ServiceError('verification_pending')
  }

  private async begin(sessionId: string, teacherId: string): Promise<{ done: { session: SessionView; version: VersionView } } | { s: SessionRow }> {
    // المرحلة أ: فحص الجلسة والانتقال إلى validating
    return this.tx<{ done: { session: SessionView; version: VersionView } } | { s: SessionRow }>(async (c) => {
      if ((await this.teacherActive(c, teacherId)) === null) return fail('not_found')
      const s = UUID_RE.test(sessionId)
        ? (await c.query<SessionRow>('select * from public.upload_sessions where id = $1 for update', [sessionId]))[0]
        : undefined
      if (!s || s.teacher_id !== teacherId) {
        await this.log(c, teacherId, null, 'denied', 'not_found')
        return fail('not_found') // لا يُفرَّق بين «غير موجودة» و«لمعلمة أخرى»
      }
      if (s.state === 'accepted') {
        await this.log(c, teacherId, s.id, 'duplicate_complete')
        return { done: { session: this.view(s, true), version: await this.versionOfSession(c, s.id) } }
      }
      if (s.state === 'expired') return fail('expired')
      if (s.state === 'rejected' || s.state === 'cancelled') return fail('session_closed')
      if (s.state === 'validating') return fail('session_busy')
      if (s.state === 'started') {
        if (await this.expireIfDue(c, s)) return fail('expired') // الإنهاء يُثبَّت بالـcommit ثم يُرمى الخطأ
        await c.exec(`update public.upload_sessions set state = 'uploaded' where id = $1`, [s.id])
        await this.log(c, teacherId, s.id, 'uploaded')
      }
      await c.exec(`update public.upload_sessions set state = 'validating' where id = $1`, [s.id])
      return { s }
    })
  }

  private async measureAndRegister(s: SessionRow, teacherId: string): Promise<{ session: SessionView; version: VersionView } | 'retry'> {
    const defer = async (reason: string): Promise<never> => {
      await this.tx(async (c) => {
        await c.exec(`update public.upload_sessions set state = 'uploaded' where id = $1 and state = 'validating'`, [s.id])
        await this.log(c, teacherId, s.id, 'validation_deferred', reason)
        return true
      })
      throw new ServiceError('verification_pending')
    }

    const settingsRow = await this.db.transaction((c) => this.settings(c))
    const settings = this.toSettings(settingsRow)
    const read = await readObject(this.storage, s.pending_key as string)
    if (read === null) return defer('measurement_unavailable')

    const out = verifyUpload({ name: s.declared_name, size: Number(s.declared_size) }, read.observed, settings, this.caps)
    if (!out.ok) {
      const reason = out.reason
      await this.tx(async (c) => {
        await c.exec(`update public.upload_sessions set state = 'rejected', reject_reason = $2 where id = $1 and state = 'validating'`, [s.id, reason])
        await this.log(c, teacherId, s.id, 'rejected', reason)
        return true
      })
      throw new ServiceError(reason)
    }

    // رقم الإصدار المتوقع (القاعدة هي الحَكَم تحت القفل)، ثم النسخ إلى المفتاح النهائي من البايتات نفسها المقيسة.
    const no = (await this.db.transaction((c) => c.query<{ no: number }>(
      'select coalesce(max(no), 0) + 1 as no from public.versions where teacher_id = $1 and term_id = $2 and slot_id = $3', [s.teacher_id, s.term_id, s.slot_id])))[0].no
    const finalKey = buildFinalObjectKey({ teacherId: s.teacher_id, termId: s.term_id, slotId: s.slot_id, no, ext: out.result.ext }, settings.allowedExtensions)
    try {
      const put = await this.storage.put({ key: finalKey, data: read.data })
      if (put.sha256 !== out.result.sha256 || put.sizeBytes !== out.result.sizeBytes) return defer('final_copy_mismatch')
    } catch (e) {
      if (e instanceof StorageError && e.code === 'already_exists') {
        // بقية نسخ سابقة لم يكتمل تسجيلها: مقبولة فقط إن طابقت البايتات تمامًا، وإلا تأجيل مع سبب ظاهر للمتابعة اليدوية (لا حذف، A-44).
        const ex = await readObject(this.storage, finalKey)
        if (ex === null || ex.observed.sha256 !== out.result.sha256 || ex.observed.sizeBytes !== out.result.sizeBytes) return defer('final_key_conflict')
      } else return defer('final_copy_failed')
    }

    const providerId = this.storage.id
    const result = out.result
    const done = await this.tx<{ session: SessionView; version: VersionView } | 'retry'>(async (c) => {
      const cur = (await c.query<SessionRow>('select * from public.upload_sessions where id = $1 for update', [s.id]))[0]
      if (cur.state === 'accepted') return { session: this.view(cur, true), version: await this.versionOfSession(c, s.id) }
      if (cur.state !== 'validating') return fail('session_busy') // استُرجعت/أُفرج عنها أثناء القياس
      await c.exec('insert into public.submissions (teacher_id, term_id, slot_id) values ($1, $2, $3) on conflict do nothing', [s.teacher_id, s.term_id, s.slot_id])
      await c.query('select 1 as x from public.submissions where teacher_id = $1 and term_id = $2 and slot_id = $3 for update', [s.teacher_id, s.term_id, s.slot_id])
      const expected = (await c.query<{ no: number }>('select coalesce(max(no), 0) + 1 as no from public.versions where teacher_id = $1 and term_id = $2 and slot_id = $3', [s.teacher_id, s.term_id, s.slot_id]))[0].no
      if (expected !== no) return 'retry' // تزاحم على رقم الإصدار (مثل حفظ رابط بالتوازي): نعيد بمفتاح نهائي صحيح
      await c.exec(`update public.upload_sessions set verified_size = $2, verified_sha256 = $3, validation_result = $4::jsonb where id = $1`, [s.id, result.sizeBytes, result.sha256, JSON.stringify(result)])
      const v = (await c.query<VersionRow>(
        `insert into public.versions (teacher_id, term_id, slot_id, no, kind, original_name, size_bytes, mime_verified, ext, storage_provider, storage_key, sha256,
                                      submitted_at, status_snapshot, deadlines_snapshot, validated_at, validation_result, upload_session_id)
         select s.teacher_id, s.term_id, s.slot_id, $2, 'file', s.declared_name, $3, $4, $5, $6, $7, $8,
                s.effective_start_at, s.status_at_start,
                jsonb_build_object('base', t.deadline_base, 'late', t.deadline_late, 'replace', t.deadline_replace, 'status', s.status_at_start),
                now(), $9::jsonb, s.id
           from public.upload_sessions s join public.terms t on t.id = s.term_id where s.id = $1
         returning id, no, kind, status_snapshot, submitted_at, storage_key, size_bytes, sha256, url`,
        [s.id, no, result.sizeBytes, mimeFromSignature(result.signature), result.ext, providerId, finalKey, result.sha256, JSON.stringify(result)]))[0]
      const acc = (await c.query<SessionRow>(`update public.upload_sessions set state = 'accepted' where id = $1 returning *`, [s.id]))[0]
      await this.log(c, teacherId, s.id, 'accepted')
      return { session: this.view(acc, false), version: versionView(v) }
    })
    return done
  }

  private async versionOfSession(c: SqlClient, sessionId: string): Promise<VersionView> {
    const v = (await c.query<VersionRow>(
      'select id, no, kind, status_snapshot, submitted_at, storage_key, size_bytes, sha256, url from public.versions where upload_session_id = $1', [sessionId]))[0]
    return versionView(v)
  }

  // ------------------------------------------------------------------ إلغاء
  /** إلغاء صريح لجلسة لم يصل ملفها بعد (started فقط). */
  async cancel(sessionId: string, teacherId: string): Promise<SessionView> {
    this.checkIds({ teacherId })
    return this.tx(async (c) => {
      if ((await this.teacherActive(c, teacherId)) === null) return fail('not_found')
      const s = UUID_RE.test(sessionId)
        ? (await c.query<SessionRow>('select * from public.upload_sessions where id = $1 for update', [sessionId]))[0]
        : undefined
      if (!s || s.teacher_id !== teacherId) {
        await this.log(c, teacherId, null, 'denied', 'not_found')
        return fail('not_found')
      }
      if (s.state === 'started') {
        const r = (await c.query<SessionRow>(`update public.upload_sessions set state = 'cancelled' where id = $1 returning *`, [s.id]))[0]
        await this.log(c, teacherId, s.id, 'cancelled')
        return this.view(r, false)
      }
      if (s.state === 'uploaded' || s.state === 'validating') return fail('session_busy')
      return fail('session_closed')
    })
  }

  // ------------------------------------------------------------------ رابط
  /**
   * حفظ رابط https كإصدار (kind = 'link') دون جلسة رفع. الموعد يُحسب من ساعة القاعدة ويثبَّت في الإصدار.
   * إعادة حفظ الرابط نفسه كآخر إصدار تُعيد الإصدار القائم (حماية من الضغط المزدوج) ولا تنشئ آخر.
   * لا يوجد سجل محاولات للروابط في 004 (outcome محدد)؛ النجاح يُدوَّن في audit_log، والرفض لا يُدوَّن (توثيق في التقرير).
   */
  async saveLink(input: { teacherId: string; termId: string; slotId: string; url: string }): Promise<{ version: VersionView; reused: boolean }> {
    this.checkIds({ teacherId: input.teacherId, termId: input.termId, slotId: input.slotId })
    const url = validateLinkUrl(input.url)
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.tx(async (c) => {
          const st = await this.settings(c)
          const active = await this.teacherActive(c, input.teacherId)
          if (!active) return fail('not_found')
          const term = (await c.query<{ base: string; late: string; replace: string }>(
            'select deadline_base::text as base, deadline_late::text as late, deadline_replace::text as replace from public.terms where id = $1', [input.termId]))[0]
          const slot = (await c.query<{ id: string }>('select id from public.slots where id = $1', [input.slotId]))[0]
          if (!term || !slot) return fail('not_found')
          await c.exec('insert into public.submissions (teacher_id, term_id, slot_id) values ($1, $2, $3) on conflict do nothing', [input.teacherId, input.termId, input.slotId])
          await c.query('select 1 as x from public.submissions where teacher_id = $1 and term_id = $2 and slot_id = $3 for update', [input.teacherId, input.termId, input.slotId])
          const last = (await c.query<VersionRow & { url: string | null }>(
            'select id, no, kind, status_snapshot, submitted_at, storage_key, size_bytes, sha256, url from public.versions where teacher_id = $1 and term_id = $2 and slot_id = $3 order by no desc limit 1',
            [input.teacherId, input.termId, input.slotId]))[0]
          if (last && last.kind === 'link' && last.url === url) return { version: versionView(last), reused: true }
          const first = (await c.query<{ status_snapshot: 'on_time' | 'late' }>(
            'select status_snapshot from public.versions where teacher_id = $1 and term_id = $2 and slot_id = $3 order by no asc limit 1', [input.teacherId, input.termId, input.slotId]))[0]
          const gate = submissionGate(Date.parse(st.now), term as TermDates, first ? first.status_snapshot : null)
          if (gate === 'closed') return fail('deadline_closed')
          const no = (last ? last.no : 0) + 1
          const v = (await c.query<VersionRow>(
            `insert into public.versions (teacher_id, term_id, slot_id, no, kind, url, submitted_at, status_snapshot, deadlines_snapshot)
             values ($1, $2, $3, $4, 'link', $5, now(), $6, $7::jsonb)
             returning id, no, kind, status_snapshot, submitted_at, storage_key, size_bytes, sha256, url`,
            [input.teacherId, input.termId, input.slotId, no, url, gate, JSON.stringify({ ...term, status: gate })]))[0]
          await c.exec(`select public.log_audit('link.saved', 'version', $1, $2::jsonb)`, [v.id, JSON.stringify({ teacher_id: input.teacherId, term_id: input.termId, slot_id: input.slotId, no })])
          return { version: versionView(v), reused: false }
        })
      } catch (e) {
        if (e instanceof DbError && (e.sqlstate === '23505' || e.sqlstate === '23514') && attempt < MAX_ATTEMPTS) continue
        throw e
      }
    }
  }

  // ------------------------------------------------------------------ إفراج المالكة
  /**
   * إفراج المالكة عن جلسة وصل ملفها وعلقت (uploaded/validating → cancelled) بملاحظة إلزامية. لا حذف لأي كائن (A-44).
   * **الصلاحية:** هذه الدالة لا تتحقق أن المتصل هو المالكة؛ على الطبقة الأعلى التحقق خادميًا من دور المالكة قبل الاستدعاء (لم تُبنَ بعد).
   * `platformFault` وحده يمنح حق وراثة وقت البدء لاحقًا (بإجراء صريح منفصل)، ولا يرث شيئًا هنا.
   * **غير مُنفَّذة على قاعدة في هذه البيئة** (لا PostgreSQL): اختباراتها في uploadService.test.ts مكتوبة ولم تُشغَّل.
   */
  async ownerRelease(input: { sessionId: string; note: string; platformFault?: boolean; actorUserId: string }): Promise<SessionView> {
    const note = typeof input.note === 'string' ? input.note.trim() : ''
    if (note === '') throw new ServiceError('note_required')
    if (note.length > MAX_NOTE) throw new ServiceError('bad_request', 'note_too_long')
    if (typeof input.sessionId !== 'string' || !UUID_RE.test(input.sessionId)) throw new ServiceError('not_found')
    // المنفِّذة تُسجَّل في سجل التدقيق الدائم (audit_log عبر log_audit_as من 007) في **نفس المعاملة**: لا إفراج بلا أثر ولا أثر بلا إفراج.
    if (typeof input.actorUserId !== 'string' || !UUID_RE.test(input.actorUserId)) throw new ServiceError('bad_request', 'actor')
    const fault = input.platformFault === true
    return this.tx(async (c) => {
      const s = (await c.query<SessionRow>('select * from public.upload_sessions where id = $1 for update', [input.sessionId]))[0]
      if (!s) return fail('not_found')
      if (s.state !== 'uploaded' && s.state !== 'validating') return fail('not_pending')
      const r = (await c.query<SessionRow>(
        `update public.upload_sessions set state = 'cancelled', release_note = $2, platform_fault = $3 where id = $1 returning *`, [s.id, note, fault]))[0] as SessionRow
      await this.log(c, s.teacher_id, s.id, 'owner_released', (fault ? 'platform_fault: ' : '') + note)
      await c.exec(
        `select public.log_audit_as($1::uuid, 'upload.owner_release', 'upload_session', $2, $3::jsonb)`,
        [input.actorUserId, s.id, JSON.stringify({ teacher_id: s.teacher_id, term_id: s.term_id, slot_id: s.slot_id, platform_fault: fault, from_state: s.state, note })])
      return this.view(r, false)
    })
  }

  // ------------------------------------------------------------------ نظرة عامة
  /**
   * لقطة تشغيلية لفصل واحد للمالكة/المديرة: أعداد الجلسات بحسب الحالة، الجلسات التي تنتظر انتباهًا (uploaded/validating الأقدم أولًا)،
   * وملخص التسليمات المسجَّلة (آخر إصدار لكل خانة بحسب حالة أول إصدار). **لا تُعيد أي مفتاح تخزين ولا بصمة ولا رابطًا** (حجب storage_key عن المديرة).
   * التعريف هنا **تفسيري** (لا مواصفة سابقة لـ overview في الحزمة): يحتاج مراجعتكِ. **غير مُنفَّذة على قاعدة في هذه البيئة.**
   */
  async overview(termId: string): Promise<OverviewView> {
    if (typeof termId !== 'string' || !UUID_RE.test(termId)) throw new ServiceError('bad_request', 'term_id')
    return this.tx(async (c) => {
      const t = (await c.query<{ now: string }>('select now() as now from public.terms where id = $1', [termId]))[0]
      if (!t) return fail('not_found')
      const states = await c.query<{ state: string; n: number }>('select state, count(*)::int as n from public.upload_sessions where term_id = $1 group by state', [termId])
      const pending = await c.query<{ id: string; teacher_id: string; slot_id: string; state: string; declared_name: string; declared_size: number; uploaded_at: string | null; validating_at: string | null; waiting_minutes: number }>(
        `select id, teacher_id, slot_id, state, declared_name, declared_size, uploaded_at, validating_at,
                floor(extract(epoch from (now() - coalesce(validating_at, uploaded_at))) / 60)::int as waiting_minutes
           from public.upload_sessions where term_id = $1 and state in ('uploaded', 'validating')
          order by coalesce(validating_at, uploaded_at) asc, id asc limit 200`, [termId])
      const sub = (await c.query<{ slots: number; on_time: number; late: number; teachers: number }>(
        `select count(*)::int as slots, count(*) filter (where first_status = 'on_time')::int as on_time,
                count(*) filter (where first_status = 'late')::int as late, count(distinct teacher_id)::int as teachers
           from (select distinct on (teacher_id, slot_id) teacher_id, slot_id, status_snapshot as first_status
                   from public.versions where term_id = $1 order by teacher_id, slot_id, no asc) f`, [termId]))[0]
      const sessionsByState: Record<string, number> = {}
      for (const r of states) sessionsByState[r.state] = Number(r.n)
      return {
        termId, asOf: t.now, sessionsByState,
        pending: pending.map((p) => ({ sessionId: p.id, teacherId: p.teacher_id, slotId: p.slot_id, state: p.state, declaredName: p.declared_name, declaredSize: Number(p.declared_size), uploadedAt: p.uploaded_at, validatingAt: p.validating_at, waitingMinutes: Number(p.waiting_minutes) })),
        submissions: { slotsSubmitted: Number(sub?.slots ?? 0), onTime: Number(sub?.on_time ?? 0), late: Number(sub?.late ?? 0), teachersWithSubmissions: Number(sub?.teachers ?? 0) },
      }
    })
  }

  // ------------------------------------------------------------------ صيانة
  /** تنهي جلسات started المنقضية (المسح الدوري). تعيد عددها. */
  async sweepExpired(): Promise<number> {
    return this.db.transaction(async (c) => {
      const rows = await c.query<{ id: string; teacher_id: string }>(
        `update public.upload_sessions set state = 'expired', reject_reason = 'expired' where state = 'started' and now() >= expires_at returning id, teacher_id`)
      for (const r of rows) await this.log(c, r.teacher_id, r.id, 'expired', 'expired')
      return rows.length
    })
  }

  /** تعيد validating العالقة (أقدم من validating_stuck_minutes) إلى uploaded لاستئنافها. لا ترفض ولا تحذف. */
  async recoverStuck(): Promise<number> {
    return this.db.transaction(async (c) => {
      const rows = await c.query<{ id: string; teacher_id: string }>(
        `update public.upload_sessions set state = 'uploaded'
          where state = 'validating' and validating_at <= now() - make_interval(mins => (select validating_stuck_minutes from public.app_settings where id))
          returning id, teacher_id`)
      for (const r of rows) await this.log(c, r.teacher_id, r.id, 'validation_recovered')
      return rows.length
    })
  }
}

interface VersionRow {
  id: string
  no: number
  kind: 'file' | 'link'
  status_snapshot: 'on_time' | 'late'
  submitted_at: string
  storage_key: string | null
  size_bytes: number | null
  sha256: string | null
  url: string | null
}

function versionView(v: VersionRow): VersionView {
  return {
    versionId: v.id, no: v.no, kind: v.kind, statusSnapshot: v.status_snapshot, submittedAt: v.submitted_at,
    storageKey: v.storage_key, sizeBytes: v.size_bytes === null ? null : Number(v.size_bytes), sha256: v.sha256, url: v.url,
  }
}

/** رابط https فقط، بلا بيانات اعتماد ولا مسافات/محارف تحكم، بنطاق فيه نقطة؛ الطول ≤ 2048. يعيد النص كما أُدخل بعد القص. */
export function validateLinkUrl(raw: unknown): string {
  if (typeof raw !== 'string') throw new ServiceError('bad_url')
  const u = raw.trim()
  if (u.length === 0 || u.length > MAX_URL || /[\s\u0000-\u001f\u007f]/.test(u) || !/^https:\/\//i.test(u)) throw new ServiceError('bad_url')
  let p: URL
  try { p = new URL(u) } catch { throw new ServiceError('bad_url') }
  if (p.protocol !== 'https:' || p.username !== '' || p.password !== '' || !p.hostname.includes('.')) throw new ServiceError('bad_url')
  // القاعدة تشترط ^https://[^[:space:]]+$ بحساسية حالة معطّلة؛ نُوحّد البادئة حتى لا يختلف الفحصان.
  return 'https://' + u.slice('https://'.length)
}
