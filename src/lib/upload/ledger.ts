// المحاكي المرجعي لسجل الرفع (5.1): يجسّد في الذاكرة القواعد التي يجب أن تفرضها الطبقة الخادمية والقاعدة لاحقًا
// (جلسة واحدة ← إصدار واحد، الحالة تُثبَّت عند البدء، عزل المعلمات، تسجيل كل محاولة).
// **ليس أمانًا ولا تخزينًا دائمًا**: يعيش في ذاكرة المتصفح/الاختبار فقط ولا تستورده الواجهة بعد.
import { checkFile } from '../storage/settings'
import type { ProviderCapabilities, StorageSettings } from '../storage/settings'
import type { RejectReason, UploadState } from './session'
import { canTransition, isActive } from './session'
import { DEFAULT_VALIDATING_STUCK_MINUTES, computeExpiresAt, windowStatus } from './window'
import { verifyUpload } from './verify'
import type { Observed, ValidationResult } from './verify'

export type SubmissionGate = 'on_time' | 'late' | 'closed'

export type UploadErrorCode =
  | RejectReason
  | 'not_found'
  | 'session_closed'
  | 'session_busy'
  | 'idempotency_conflict'
  | 'bad_idempotency_key'
  | 'active_session_exists'
  /** ليس فشلًا: الملف وصل والتحقق لم يكتمل بعد؛ الجلسة تبقى قابلة للاستئناف ولا تُرفض بالتأخير (5.A). */
  | 'verification_pending'
  | 'note_required'
  | 'not_pending'

export class UploadError extends Error {
  code: UploadErrorCode
  constructor(code: UploadErrorCode) {
    super(code)
    this.name = 'UploadError'
    this.code = code
  }
}

export interface StartInput {
  teacherId: string
  termId: string
  slotId: string
  name: string
  size: number
  /** مفتاح عشوائي تولّده الواجهة لكل إجراء رفع؛ إعادة الإرسال بنفس المفتاح لا تُنشئ جلسة ثانية. */
  idempotencyKey: string
}

export interface SessionRecord {
  id: string
  teacherId: string
  termId: string
  slotId: string
  declaredName: string
  declaredSize: number
  idempotencyKey: string
  state: UploadState
  rejectReason: RejectReason | null
  startedAt: number
  expiresAt: number
  /** حالة التسليم مثبّتة عند البدء (A-33) لا عند الإتمام. */
  statusAtStart: 'on_time' | 'late'
  versionId: string | null
  /** لحظة وصول الملف كاملًا (خادمية) أو null. */
  uploadedAt: number | null
  /** لحظة آخر دخول إلى validating (لاكتشاف العالقة)، وتُمسح عند العودة إلى uploaded. */
  validatingAt: number | null
  /**
   * دليل خادمي اختياري على أول بايتات وصلت فعلًا (T1)، وهو **معلوماتي فقط**: لا يغيّر statusAtStart ولا قواعد التأخير
   * إلى أن تعتمد المالكة معنى submitted_at (Q-4). انظر docs/phase5/PHASE5_A_REPORT.md.
   */
  firstByteEvidenceAt: number | null
  firstByteEvidenceSource: string | null
  /** ملاحظة إفراج المالكة عن جلسة عالقة (إلزامية عند الإفراج). */
  releaseNote: string | null
  /**
   * وقت البدء المعتمد لحساب التسليم: = startedAt عادةً، أو وقت بدء الجلسة الأصلية فقط إذا ورثتْه الجلسة بإجراء صريح من المالكة
   * (إفراج بعلامة platformFault). لا يحدث تلقائيًا أبدًا.
   */
  effectiveStartAt: number
  /** الجلسة التي وُرثت منها حالة البدء (علامة التدقيق على الجلسة الوارثة) أو null. */
  inheritedFromSessionId: string | null
  /** إفراج المالكة بعلامة «عطل منصة»: يتيح لجلسة لاحقة واحدة لنفس (معلمة، فصل، خانة) أن ترث وقت البدء. */
  platformFault: boolean
  /** الجلسة الوارثة التي استهلكت هذا الإذن (مرة واحدة). */
  inheritanceConsumedBy: string | null
}

export interface VersionRecord {
  id: string
  sessionId: string
  teacherId: string
  termId: string
  slotId: string
  no: number
  originalName: string
  sizeBytes: number
  ext: string
  sha256: string
  statusSnapshot: 'on_time' | 'late'
  submittedAt: number
  validatedAt: number
  validationResult: ValidationResult
}

export type AttemptOutcome =
  | 'started' | 'start_rejected' | 'duplicate_start' | 'uploaded' | 'accepted' | 'rejected'
  | 'expired' | 'duplicate_complete' | 'denied' | 'cancelled'
  | 'validation_deferred' | 'validation_recovered' | 'owner_released' | 'evidence_recorded' | 'start_inherited'

export interface AttemptRecord {
  at: number
  teacherId: string
  sessionId: string | null
  outcome: AttemptOutcome
  reason: string | null
}

export interface LedgerOptions {
  settings: StorageSettings
  caps: ProviderCapabilities
  windowMinutes: number
  now: () => number
  /** مهلة اعتبار validating عالقة بالدقائق (إعداد؛ الافتراضي 10 وليس نهائيًا). */
  stuckValidatingMinutes?: number
  /** من مواعيد السنة: حالة التسليم لو بدأ الرفع في اللحظة المعطاة. */
  gate: (atMs: number) => SubmissionGate
}

export class UploadLedger {
  private readonly opts: LedgerOptions
  private readonly sessions = new Map<string, SessionRecord>()
  private readonly versions = new Map<string, VersionRecord>()
  private readonly attempts: AttemptRecord[] = []
  private seq = 0

  constructor(opts: LedgerOptions) {
    this.opts = opts
  }

  private nextId(prefix: string): string {
    this.seq += 1
    return `${prefix}-${this.seq}`
  }

  private log(teacherId: string, sessionId: string | null, outcome: AttemptOutcome, reason: string | null = null): void {
    this.attempts.push({ at: this.opts.now(), teacherId, sessionId, outcome, reason })
  }

  private move(s: SessionRecord, to: UploadState): void {
    if (!canTransition(s.state, to)) throw new Error(`انتقال غير مسموح: ${s.state} → ${to}`)
    s.state = to
  }

  private fail(s: SessionRecord, reason: RejectReason): never {
    this.move(s, 'rejected')
    s.rejectReason = reason
    this.log(s.teacherId, s.id, 'rejected', reason)
    throw new UploadError(reason)
  }

  /** ينهي جلسة started انقضت نافذتها. يُعيد true إن أنهاها الآن. لا يمس الجلسات بعد الوصول (uploaded وما بعدها). */
  private expireIfDue(s: SessionRecord): boolean {
    if (s.state !== 'started' || !windowStatus(s.expiresAt, this.opts.now()).expired) return false
    this.move(s, 'expired')
    s.rejectReason = 'expired'
    this.log(s.teacherId, s.id, 'expired', 'expired')
    return true
  }

  start(input: StartInput): SessionRecord {
    const key = input.idempotencyKey.trim()
    if (key === '') throw new UploadError('bad_idempotency_key')
    for (const s of this.sessions.values()) {
      if (s.teacherId === input.teacherId && s.idempotencyKey === key) {
        const same = s.termId === input.termId && s.slotId === input.slotId && s.declaredName === input.name && s.declaredSize === input.size
        if (!same) throw new UploadError('idempotency_conflict')
        // لا إحياء: إعادة الإرسال بنفس المفتاح تُعيد الحالة الفعلية للجلسة. جلسة started انقضت نافذتها تُنهى هنا (كسولًا)
        // فلا تبدو حيّة؛ والجلسات الملغاة/المنتهية/المرفوضة تبقى كما هي، والمحاولة الجديدة تتطلب مفتاحًا جديدًا.
        this.expireIfDue(s)
        this.log(s.teacherId, s.id, 'duplicate_start', s.state)
        return s
      }
    }
    const check = checkFile({ name: input.name, size: input.size }, this.opts.settings, this.opts.caps)
    if (!check.ok) {
      this.log(input.teacherId, null, 'start_rejected', check.code)
      throw new UploadError(check.code)
    }
    // C-5 (مقترح، غير معتمد نهائيًا): جلسة نشطة واحدة لكل (معلمة، فصل، خانة).
    for (const a of this.sessions.values()) {
      if (a.teacherId !== input.teacherId || a.termId !== input.termId || a.slotId !== input.slotId || !isActive(a.state)) continue
      // انقضاء كسول: لا يعتمد على المسح الدوري، فلا تُحجَز الخانة بجلسة منتهية فعلًا.
      if (this.expireIfDue(a)) continue
      if (a.state !== 'started') throw new UploadError('session_busy')
      if (a.declaredName === input.name && a.declaredSize === input.size) {
        // إعادة محاولة بمفتاح جديد (مثل إغلاق المتصفح): نفس الجلسة ونفس وقت البدء ونفس الانقضاء، دون تمديد النافذة.
        this.log(a.teacherId, a.id, 'duplicate_start', 'active_reused')
        return a
      }
      throw new UploadError('active_session_exists')
    }
    const startedAt = this.opts.now()
    // وراثة صريحة فقط: لا تحدث إلا إن وُجد إفراج من المالكة بعلامة platformFault لنفس الخانة ولم يُستهلك بعد.
    let grant: SessionRecord | null = null
    for (const g of this.sessions.values()) {
      if (g.teacherId !== input.teacherId || g.termId !== input.termId || g.slotId !== input.slotId) continue
      if (g.state === 'cancelled' && g.platformFault && g.inheritanceConsumedBy === null && (grant === null || g.startedAt > grant.startedAt)) grant = g
    }
    const gate = grant ? grant.statusAtStart : this.opts.gate(startedAt)
    if (gate === 'closed') {
      this.log(input.teacherId, null, 'start_rejected', 'deadline_closed')
      throw new UploadError('deadline_closed')
    }
    const s: SessionRecord = {
      id: this.nextId('ses'),
      teacherId: input.teacherId,
      termId: input.termId,
      slotId: input.slotId,
      declaredName: input.name,
      declaredSize: input.size,
      idempotencyKey: key,
      state: 'started',
      rejectReason: null,
      startedAt,
      expiresAt: computeExpiresAt(startedAt, this.opts.windowMinutes),
      statusAtStart: gate,
      versionId: null,
      effectiveStartAt: grant ? grant.effectiveStartAt : startedAt,
      inheritedFromSessionId: grant ? grant.id : null,
      platformFault: false,
      inheritanceConsumedBy: null,
      uploadedAt: null,
      validatingAt: null,
      firstByteEvidenceAt: null,
      firstByteEvidenceSource: null,
      releaseNote: null,
    }
    this.sessions.set(s.id, s)
    this.log(s.teacherId, s.id, 'started')
    if (grant) {
      grant.inheritanceConsumedBy = s.id
      this.log(s.teacherId, s.id, 'start_inherited', `from:${grant.id}`)
    }
    return s
  }

  /**
   * تُستدعى عند اكتمال وصول الملف (أو عند إعادة المحاولة من الواجهة لجلسة بانتظار التحقق).
   * `observed = null` تعني أن القياس غير متاح الآن (تعطّل تخزين/شبكة/مهلة): لا يُرفض التسليم، تبقى الجلسة uploaded
   * ويُرمى `verification_pending` (ليس فشلًا) لتُستأنف لاحقًا بـ complete أو recoverStuck.
   * إعادة الاستدعاء بعد القبول تُعيد نفس الإصدار دون تكرار.
   */
  complete(sessionId: string, teacherId: string, observed: Observed | null): { session: SessionRecord; version: VersionRecord } {
    const s = this.sessions.get(sessionId)
    if (!s || s.teacherId !== teacherId) {
      this.log(teacherId, null, 'denied', 'not_found')
      throw new UploadError('not_found') // لا نفرّق بين «غير موجودة» و«لمعلمة أخرى» حتى لا نُسرّب وجودها
    }
    if (s.state === 'accepted') {
      this.log(teacherId, s.id, 'duplicate_complete')
      return { session: s, version: this.versions.get(s.versionId as string) as VersionRecord }
    }
    if (s.state === 'expired') throw new UploadError('expired')
    if (s.state === 'rejected' || s.state === 'cancelled') throw new UploadError('session_closed')
    // validating: قيد المعالجة (أو عالقة)؛ لا تتزاحم المعالجات. العالقة تعود إلى uploaded بـ recoverStuck.
    if (s.state === 'validating') throw new UploadError('session_busy')

    if (s.state === 'started') {
      if (this.expireIfDue(s)) throw new UploadError('expired')
      this.move(s, 'uploaded')
      s.uploadedAt = this.opts.now()
      this.log(teacherId, s.id, 'uploaded')
    }
    // هنا الحالة uploaded: استئناف التحقق لا يخضع للنافذة (الملف وصل أصلًا).
    this.move(s, 'validating')
    s.validatingAt = this.opts.now()

    if (observed === null) {
      this.move(s, 'uploaded')
      s.validatingAt = null
      this.log(teacherId, s.id, 'validation_deferred', 'measurement_unavailable')
      throw new UploadError('verification_pending')
    }

    const out = verifyUpload({ name: s.declaredName, size: s.declaredSize }, observed, this.opts.settings, this.opts.caps)
    if (!out.ok) this.fail(s, out.reason)

    let maxNo = 0
    for (const v of this.versions.values())
      if (v.teacherId === s.teacherId && v.termId === s.termId && v.slotId === s.slotId) maxNo = Math.max(maxNo, v.no)
    const now = this.opts.now()
    const version: VersionRecord = {
      id: this.nextId('ver'),
      sessionId: s.id,
      teacherId: s.teacherId,
      termId: s.termId,
      slotId: s.slotId,
      no: maxNo + 1,
      originalName: s.declaredName,
      sizeBytes: out.result.sizeBytes,
      ext: out.result.ext,
      sha256: out.result.sha256,
      statusSnapshot: s.statusAtStart,
      submittedAt: s.effectiveStartAt,
      validatedAt: now,
      validationResult: out.result,
    }
    this.versions.set(version.id, version)
    s.versionId = version.id
    this.move(s, 'accepted')
    this.log(teacherId, s.id, 'accepted')
    return { session: s, version }
  }

  /** إلغاء صريح لجلسة لم يصل ملفها بعد (started فقط). بعدها يمكن بدء جلسة جديدة بوقت بدء جديد. */
  cancel(sessionId: string, teacherId: string): SessionRecord {
    const s = this.sessions.get(sessionId)
    if (!s || s.teacherId !== teacherId) {
      this.log(teacherId, null, 'denied', 'not_found')
      throw new UploadError('not_found')
    }
    if (s.state === 'started') {
      this.move(s, 'cancelled')
      this.log(teacherId, s.id, 'cancelled')
      return s
    }
    if (s.state === 'uploaded' || s.state === 'validating') throw new UploadError('session_busy')
    throw new UploadError('session_closed')
  }

  /** إفراج المالكة (وحدها، يفرضه الخادم) عن جلسة وصل ملفها وعلقت فعلًا. ملاحظة إلزامية؛ لا حذف لأي ملف. */
  ownerRelease(sessionId: string, note: string, opts: { platformFault?: boolean } = {}): SessionRecord {
    const s = this.sessions.get(sessionId)
    if (!s) throw new UploadError('not_found')
    if (note.trim() === '') throw new UploadError('note_required')
    if (s.state !== 'uploaded' && s.state !== 'validating') throw new UploadError('not_pending')
    this.move(s, 'cancelled')
    s.releaseNote = note.trim()
    s.validatingAt = null
    s.platformFault = opts.platformFault === true
    this.log(s.teacherId, s.id, 'owner_released', (s.platformFault ? 'platform_fault: ' : '') + s.releaseNote)
    return s
  }

  /** تُعيد جلسات validating التي مضى عليها `olderThanMs` أو أكثر إلى uploaded لاستئنافها. لا ترفض ولا تحذف. تُعيد عددها. */
  recoverStuck(olderThanMs: number = (this.opts.stuckValidatingMinutes ?? DEFAULT_VALIDATING_STUCK_MINUTES) * 60_000): number {
    let n = 0
    const now = this.opts.now()
    for (const s of this.sessions.values()) {
      if (s.state === 'validating' && s.validatingAt !== null && now - s.validatingAt >= olderThanMs) {
        this.move(s, 'uploaded')
        s.validatingAt = null
        this.log(s.teacherId, s.id, 'validation_recovered')
        n += 1
      }
    }
    return n
  }

  /** الجلسات التي وصل ملفها وتنتظر التحقق، بعمرها؛ للمتابعة اليدوية (لا ينقضي عمرها ولا تُرفض). */
  listPendingVerification(): readonly { session: SessionRecord; ageMs: number }[] {
    const now = this.opts.now()
    return [...this.sessions.values()]
      .filter((s) => s.state === 'uploaded' || s.state === 'validating')
      .map((session) => ({ session, ageMs: now - (session.uploadedAt ?? session.startedAt) }))
  }

  /** تسجيل دليل أول بايتات (T1) مرة واحدة. معلوماتي: لا يغيّر statusAtStart. */
  recordFirstByteEvidence(sessionId: string, atMs: number, source: string): SessionRecord {
    const s = this.sessions.get(sessionId)
    if (!s) throw new UploadError('not_found')
    if (source.trim() === '') throw new UploadError('note_required')
    if (s.firstByteEvidenceAt !== null) return s // يُكتب مرة واحدة
    if (!Number.isFinite(atMs) || atMs < s.startedAt) return s // لا يسبق البدء؛ يُتجاهل بصمت (لا يُسجَّل)
    s.firstByteEvidenceAt = atMs
    s.firstByteEvidenceSource = source.trim()
    this.log(s.teacherId, s.id, 'evidence_recorded', s.firstByteEvidenceSource)
    return s
  }

  /** مقارنة أثر اعتماد T1 بدل T0 على حالة التسليم (للتقرير فقط؛ لا تغيّر شيئًا). */
  timingComparison(sessionId: string): { t0: SubmissionGate; t1: SubmissionGate | null; differs: boolean } {
    const s = this.sessions.get(sessionId)
    if (!s) throw new UploadError('not_found')
    const t0 = this.opts.gate(s.startedAt)
    const t1 = s.firstByteEvidenceAt === null ? null : this.opts.gate(s.firstByteEvidenceAt)
    return { t0, t1, differs: t1 !== null && t1 !== t0 }
  }

  /** تُنهي الجلسات التي بدأت وانقضت نافذتها ولم تُستكمل. تُعيد عددها. */
  sweepExpired(): number {
    let n = 0
    for (const s of this.sessions.values()) {
      if (s.state === 'started' && windowStatus(s.expiresAt, this.opts.now()).expired) {
        this.move(s, 'expired')
        s.rejectReason = 'expired'
        this.log(s.teacherId, s.id, 'expired', 'expired')
        n += 1
      }
    }
    return n
  }

  getSession(id: string): SessionRecord | null {
    return this.sessions.get(id) ?? null
  }
  listAttempts(): readonly AttemptRecord[] {
    return this.attempts.slice()
  }
  listVersions(teacherId: string, termId: string, slotId: string): readonly VersionRecord[] {
    return [...this.versions.values()].filter((v) => v.teacherId === teacherId && v.termId === termId && v.slotId === slotId).sort((a, b) => a.no - b.no)
  }
}
