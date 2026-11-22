// مولَّد آليًا من server/auth/teacherAuth.ts بواسطة scripts/build-edge-function.mjs — لا تعدّليه يدويًا.
// خدمة دخول المعلمة. منذ r37 (A-122) **رمز واحد فقط** (حرفان من اسم المعلمة + رقمان، مثل SA-12) بلا رقم سري، بطلب صاحبة المشروع.
// **حدود صريحة وأمان:**
//  * فضاء الرمز صغير (≈100 رمز لكل بادئة، ≈67,600 كليًا)؛ لذا لا تُترك الحماية للرمز نفسه. الضوابط: (1) حد إخفاقات لكل عنوان IP مجزَّأ،
//    (2) حد عام لكل الإخفاقات من كل العناوين في النافذة نفسها (يوقف التخمين الموزَّع، وثمنه توقف مؤقت للدخول إن حدث هجوم)،
//    (3) سجل محاولات يطّلع عليه المالكة، (4) جلسة قصيرة (30 دقيقة خمول، 8 ساعات مطلقة)، (5) إمكان إلغاء الرمز أو تحديد انتهائه.
//  * لا قفل لكل معلمة: التخمين الصحيح يُنتج نجاحًا لا إخفاقًا، فلا يمكن نسبة الإخفاق لمعلمة بعينها.
//  * `issueCredentials`/`revokeCredentials` تفترض أن المتصل تحقق خادميًا أنه مالكة أو مديرة قبل الاستدعاء.
//  * المخزن يُحقن (اختبارًا: ذاكرة؛ إنتاجًا: PgAuthStore على Postgres).
import { Buffer } from 'node:buffer'
import { assertPepper, generateNameCode, generateToken, hashCode, hashIp, hashToken, isTokenShape, normalizeCode } from './teacherCrypto.ts'

export type AuthErrorCode = 'login_failed' | 'unauthenticated' | 'bad_request'

/** رسالة موحّدة بقصد: لا كشف لوجود الكود ولا لسبب الرفض (الخطأ/الإلغاء/التقييد). التفاصيل في login_attempts للمالكة فقط. */
export class AuthError extends Error {
  code: AuthErrorCode
  constructor(code: AuthErrorCode) {
    super(code === 'login_failed' ? 'تعذّر الدخول، تحققي من الرمز' : code === 'unauthenticated' ? 'الجلسة غير صالحة' : 'طلب غير صالح')
    this.name = 'AuthError'
    this.code = code
  }
}

export type LoginResult = 'success' | 'wrong_code' | 'wrong_pin' | 'locked' | 'unknown_code'

export interface CredentialRow {
  teacherId: string
  name: string
  isActive: boolean
  codeState: 'active' | 'revoked'
  codeExpiresAt: Date | null
}

export interface SessionRecord {
  teacherId: string
  name: string
  expiresAt: Date
  lastSeenAt: Date
  revokedAt: Date | null
  teacherActive: boolean
}

export interface TeacherAuthStore {
  /** ساعة القاعدة (لا ساعة الخادم) — مصدر الحقيقة الزمنية الوحيد. */
  now(): Promise<Date>
  findCredentialByCodeHash(codeHash: string): Promise<CredentialRow | null>
  logAttempt(teacherId: string | null, ipHash: string | null, result: LoginResult): Promise<void>
  /** عدد إخفاقات (wrong_code/unknown_code) لهذا العنوان المجزَّأ خلال النافذة. */
  countIpFailures(ipHash: string, windowMinutes: number): Promise<number>
  /** عدد الإخفاقات من كل العناوين خلال النافذة (الحد العام ضد التخمين الموزَّع). */
  countRecentFailures(windowMinutes: number): Promise<number>
  createSession(input: { teacherId: string; tokenHash: string; ttlMinutes: number }): Promise<{ expiresAt: Date }>
  findSession(tokenHash: string): Promise<SessionRecord | null>
  touchSession(tokenHash: string): Promise<void>
  revokeSession(tokenHash: string): Promise<void>
  revokeAllSessions(teacherId: string): Promise<void>
  /** يضبط بصمة الكود ويجعله active ويصفّر أي قفل قديم ويمحو أي بصمة رقم سري قديمة. يرمي {code:'code_collision'} عند تكرار code_hash. */
  setCredentials(teacherId: string, c: { codeHash: string; codeExpiresAt: Date | null }): Promise<void>
  /** يجعل الكود revoked (البصمات تبقى للتدقيق). */
  revokeCode(teacherId: string): Promise<void>
  /** اسم المعلمة لاشتقاق بادئة الرمز. null ⇒ المعلمة غير موجودة. */
  teacherName(teacherId: string): Promise<string | null>
  /** حذف المعلمة بعد الأرشفة (A-114): دالة SQL remove_teacher تتحقق من المالكة ومن أن كل إصداراتها في أرشيف متحقَّق منه. ترمي DbError (23514 غير مؤرشفة، P0002 غير موجودة، 42501 ليست المالكة). */
  removeTeacher?(actorUserId: string, teacherId: string): Promise<{ versions: number }>
}

export interface AuthConfig {
  /** سرّان ≥ 32 بايتًا لكل منهما، مستقلان. */
  codePepper: Uint8Array
  ipPepper: Uint8Array
  sessionAbsoluteMinutes: number
  sessionIdleMinutes: number
  /** إخفاقات لكل عنوان في النافذة قبل الرفض. */
  ipMaxFailures: number
  ipWindowMinutes: number
  /** إخفاقات كل العناوين مجتمعة في النافذة قبل إيقاف الدخول مؤقتًا. */
  globalMaxFailures: number
}

export const DEFAULTS = {
  sessionAbsoluteMinutes: 8 * 60,
  sessionIdleMinutes: 30,
  ipMaxFailures: 20,
  ipWindowMinutes: 15,
  globalMaxFailures: 300,
} as const

export interface LoginInput { code: unknown; ip?: unknown }
export interface LoginSuccess { token: string; expiresAt: Date; teacher: { id: string; name: string } }
export interface AuthedTeacher { teacherId: string; name: string }

/** عدد محاولات توليد رمز غير مكرر قبل الفشل الصريح (≈100 رمز لكل بادئة). */
const ISSUE_ATTEMPTS = 60

export class TeacherAuthService {
  private readonly cfg: AuthConfig
  private readonly store: TeacherAuthStore
  constructor(store: TeacherAuthStore, cfg: Partial<AuthConfig> & Pick<AuthConfig, 'codePepper' | 'ipPepper'>) {
    this.store = store
    this.cfg = { ...DEFAULTS, ...cfg }
    assertPepper('CODE_PEPPER', this.cfg.codePepper)
    assertPepper('IP_PEPPER', this.cfg.ipPepper)
    // أسرار متطابقة تُفقد استقلال الطبقات (تسريب أحدها يكشف الآخر): نمنعه.
    if (Buffer.from(this.cfg.codePepper).equals(Buffer.from(this.cfg.ipPepper))) throw new AuthError('bad_request')
    for (const [k, v] of Object.entries({ sessionAbsoluteMinutes: this.cfg.sessionAbsoluteMinutes, sessionIdleMinutes: this.cfg.sessionIdleMinutes, ipMaxFailures: this.cfg.ipMaxFailures, ipWindowMinutes: this.cfg.ipWindowMinutes, globalMaxFailures: this.cfg.globalMaxFailures })) {
      if (!Number.isInteger(v) || v <= 0) throw new Error(`إعداد غير صالح: ${k}`)
    }
  }

  async login(input: LoginInput): Promise<LoginSuccess> {
    const ipHash = hashIp(this.cfg.ipPepper, input.ip)
    const code = normalizeCode(input.code)

    // 1) تقييد العنوان (إن وُجد) ثم الحد العام: يُسجَّل locked بلا معلمة ولا يُحتسب ضمن الإخفاقات (لا يمدّد التقييد ذاتيًا).
    const limited = (ipHash && (await this.store.countIpFailures(ipHash, this.cfg.ipWindowMinutes)) >= this.cfg.ipMaxFailures)
      || (await this.store.countRecentFailures(this.cfg.ipWindowMinutes)) >= this.cfg.globalMaxFailures
    if (limited) {
      await this.store.logAttempt(null, ipHash, 'locked')
      throw new AuthError('login_failed')
    }

    // 2) مدخل مشوّه أو رمز مجهول: رفض موحّد وتسجيل unknown_code.
    const cred = code === null ? null : await this.store.findCredentialByCodeHash(hashCode(this.cfg.codePepper, code))
    if (!cred) {
      await this.store.logAttempt(null, ipHash, 'unknown_code')
      throw new AuthError('login_failed')
    }

    // 3) رمز معروف لكنه غير صالح للدخول (ملغى/منتهٍ/معلمة معطّلة): رفض موحّد، ويُسجَّل wrong_code.
    const now = await this.store.now()
    if (cred.codeState !== 'active' || !cred.isActive || (cred.codeExpiresAt && now >= cred.codeExpiresAt)) {
      await this.store.logAttempt(cred.teacherId, ipHash, 'wrong_code')
      throw new AuthError('login_failed')
    }

    // 4) نجاح: جلسة جديدة (الجلسات السابقة تبقى صالحة حتى انتهائها؛ تعدّد الأجهزة غير ممنوع).
    const token = generateToken()
    const { expiresAt } = await this.store.createSession({ teacherId: cred.teacherId, tokenHash: hashToken(token), ttlMinutes: this.cfg.sessionAbsoluteMinutes })
    await this.store.logAttempt(cred.teacherId, ipHash, 'success')
    return { token, expiresAt, teacher: { id: cred.teacherId, name: cred.name } }
  }

  /** الهوية من الجلسة وحدها. أي سبب رفض ⇒ unauthenticated بلا تمييز. يحدّث last_seen عند النجاح. */
  async authenticate(token: unknown): Promise<AuthedTeacher> {
    if (!isTokenShape(token)) throw new AuthError('unauthenticated')
    const h = hashToken(token)
    const s = await this.store.findSession(h)
    if (!s) throw new AuthError('unauthenticated')
    const now = await this.store.now()
    const idleMs = this.cfg.sessionIdleMinutes * 60_000
    if (s.revokedAt || !s.teacherActive || now >= s.expiresAt || now.getTime() - s.lastSeenAt.getTime() >= idleMs) throw new AuthError('unauthenticated')
    await this.store.touchSession(h)
    return { teacherId: s.teacherId, name: s.name }
  }

  async logout(token: unknown): Promise<void> {
    if (!isTokenShape(token)) return
    await this.store.revokeSession(hashToken(token))
  }

  /** يولّد رمزًا جديدًا (حرفان من الاسم + رقمان)، يخزّن بصمته فقط، يُلغي كل جلسات المعلمة، ويعيد النص **مرة واحدة**. المتصل مسؤول عن التحقق من أنه مالكة أو مديرة. */
  async issueCredentials(teacherId: string, opts: { codeExpiresAt?: Date | null } = {}): Promise<{ code: string }> {
    const name = await this.store.teacherName(teacherId)
    if (name === null) throw Object.assign(new Error('teacher_not_found'), { code: 'teacher_not_found' })
    // فضاء الرمز ≈100 لكل بادئة: نعيد المحاولة عند التكرار (code_hash فريد).
    for (let attempt = 0; attempt < ISSUE_ATTEMPTS; attempt++) {
      const code = generateNameCode(name)
      try {
        await this.store.setCredentials(teacherId, { codeHash: hashCode(this.cfg.codePepper, normalizeCode(code) as string), codeExpiresAt: opts.codeExpiresAt ?? null })
      } catch (e) {
        if ((e as { code?: string }).code === 'code_collision') continue
        throw e
      }
      await this.store.revokeAllSessions(teacherId)
      return { code }
    }
    throw new Error('تعذّر توليد رمز فريد: أغلب رموز هذه البادئة مستعملة')
  }

  /** حذف المعلمة بعد الأرشفة (محو الاسم وإخفاؤها وإبطال دخولها). المتصل تحقق خادميًا أنه المالكة، والقاعدة تتحقق ثانيةً. */
  async removeTeacher(teacherId: string, actorUserId: string): Promise<{ versions: number }> {
    if (!this.store.removeTeacher) throw new Error('حذف المعلمة غير مدعوم في هذا المخزن')
    return this.store.removeTeacher(actorUserId, teacherId)
  }

  /** إلغاء الكود وكل الجلسات فورًا (تعطيل/فقدان). */
  async revokeCredentials(teacherId: string): Promise<void> {
    await this.store.revokeCode(teacherId)
    await this.store.revokeAllSessions(teacherId)
  }
}
