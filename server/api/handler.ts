// طبقة HTTP الخادمية (الدفعة 6): محوّل مستقل عن أي إطار (Edge Function/Worker/Node) يحوّل طلبًا إلى استدعاء خدمة.
// **المبادئ:**
//  * هوية المعلمة من رمز الجلسة وحده؛ أي teacherId في جسم الطلب يُتجاهل صراحة (لا يُقرأ أصلًا).
//  * مسارات المالكة/المديرة تتحقق من الدور خادميًا عبر StaffVerifier في كل طلب؛ الدور لا يأتي من العميل أبدًا.
//  * فشل مغلق: مدخلات مشوّهة/نوع محتوى خطأ/جسم كبير ⇒ رفض قبل أي خدمة؛ الأخطاء غير المعروفة ⇒ 500 عامة بلا تفاصيل.
//  * لا storage_key ولا pending_key للمعلمة افتراضيًا (مبدأ A-57)؛ `exposePendingKey` يُفعَّل بقرار DP-03 فقط.
// **الحالة:** منطق نقي اختُبر ببدائل للخدمات (لا قاعدة ولا شبكة). لم يُنشر كدالة Edge ولم يُربط بأي مضيف حقيقي.
import { Buffer } from 'node:buffer'
import { AuthError } from '../auth/teacherAuth'
import { normalizeCode } from '../auth/teacherCrypto'
import { DbError } from '../db/types'
import { ServiceError } from '../services/errors'
import type { StaffIdentity, StaffVerifier } from './staffVerifier'

export interface ApiRequest {
  method: string
  /** المسار بلا سلسلة الاستعلام. */
  path: string
  query?: Record<string, string | undefined>
  /** مفاتيح الترويسات بأحرف صغيرة. */
  headers: Record<string, string | undefined>
  /** النص الخام للجسم (أو null). */
  body: string | null
  /** عنوان العميل كما حدّده المضيف الموثوق (لا يُقرأ من ترويسات يرسلها العميل هنا). */
  ip?: string
}
export interface ApiResponse { status: number; headers: Record<string, string>; body: string }

export interface TeacherAuthPort {
  login(i: { code: unknown; ip?: unknown }): Promise<{ token: string; expiresAt: Date; teacher: { id: string; name: string } }>
  authenticate(token: unknown): Promise<{ teacherId: string; name: string }>
  logout(token: unknown): Promise<void>
  issueCredentials(teacherId: string, opts?: { codeExpiresAt?: Date | null }): Promise<{ code: string }>
  revokeCredentials(teacherId: string): Promise<void>
  removeTeacher(teacherId: string, actorUserId: string): Promise<{ versions: number }>
}

type Rec = Record<string, unknown>
/** الخدمات تُعيد واجهات مطبوعة؛ المحوّل يحتاجها كائنات عامة ليحجب الحقول، فنقبل `object` ونحوّل داخليًا. */
type Obj = object
export interface UploadPort {
  start(i: { teacherId: string; termId: string; slotId: string; name: string; size: number; idempotencyKey: string }): Promise<Obj>
  complete(sessionId: string, teacherId: string): Promise<{ session: Obj; version: Obj }>
  cancel(sessionId: string, teacherId: string): Promise<Obj>
  saveLink(i: { teacherId: string; termId: string; slotId: string; url: string }): Promise<{ version: Obj; reused: boolean }>
  ownerRelease(i: { sessionId: string; note: string; platformFault?: boolean; actorUserId: string }): Promise<Obj>
  overview(termId: string): Promise<Obj>
  sweepExpired(): Promise<number>
}

export interface ReadPort { portfolio(teacherId: string): Promise<Obj> }
export interface DeletePort { delete(teacherId: string, versionId: string): Promise<{ deleted: true }> }
export interface TransferPort {
  presignUpload(sessionId: string, teacherId: string): Promise<Obj>
  authorizeDownload(versionId: string, actor: { kind: 'teacher'; teacherId: string } | { kind: 'staff'; role: 'owner' | 'director' }, o?: { inline?: boolean }): Promise<Obj>
}

export interface ArchivePort {
  listLegacy(): Promise<Obj[]>
  authorizeDownload(archiveId: string): Promise<Obj>
  confirmDownload(i: { archiveId: string; sha256: string; actorUserId: string }): Promise<Obj>
}

export interface YearArchivePort {
  plan(yearId: string, targetBytes?: number): Promise<Obj>
  urls(yearId: string, versionIds: string[]): Promise<Obj[]>
  register(i: { yearId: string; title: string; targetBytes: number; parts: { no: number; filename: string; sha256: string; size: number }[]; entriesDigest: string; actorUserId: string }): Promise<Obj>
  confirmPart(i: { archiveId: string; partNo: number; sha256: string; actorUserId: string }): Promise<{ verified: boolean } & Obj>
  confirmCopy(i: { archiveId: string; partNo: number; sha256: string; medium: string; independent: boolean; actorUserId: string }): Promise<{ verified: boolean } & Obj>
  ack(i: { archiveId: string; kind: 'opened_locally'; note?: string; actorUserId: string }): Promise<Obj>
  status(yearId: string): Promise<Obj>
}

export interface YearResetPort {
  report(yearId: string): Promise<Obj>
  status(yearId: string): Promise<Obj>
  start(i: { yearId: string; typedConfirmation?: string; actorUserId: string }): Promise<{ done: boolean } & Obj>
  resume(i: { yearId: string; actorUserId: string }): Promise<{ done: boolean } & Obj>
}

export interface AdminPort {
  createYear(actor: string, i: Obj): Promise<{ id: string }>
  updateYear(actor: string, yearId: string, i: Obj): Promise<void>
  activateYear(actor: string, yearId: string): Promise<void>
  existingTeachers(): Promise<Obj[]>
  importTeachers(i: { actor: string; rows: { name: unknown; subject: unknown }[]; issueCodes: boolean }): Promise<Obj>
}

export interface AuditEvent {
  at: string
  actor: { kind: 'owner' | 'director' | 'teacher' | 'anonymous'; id: string | null }
  action: string
  outcome: 'ok' | 'denied' | 'error'
  target?: string
}

export interface ApiDeps {
  teacherAuth: TeacherAuthPort
  uploads: UploadPort
  staff: StaffVerifier
  /** خدمات اختيارية: غيابها ⇒ 503 not_configured للمسارات المعنية (فشل مغلق). */
  reads?: ReadPort
  transfer?: TransferPort
  archives?: ArchivePort
  yearArchives?: YearArchivePort
  yearResets?: YearResetPort
  /** حذف المعلمة لملفها حذفًا نهائيًا (A-126). غيابه ⇒ 503. */
  deleteVersion?: DeletePort
  /** دخول الإدارة من الصندوق الموحَّد (r38): يعيد جلسة Supabase. غيابه ⇒ الرمز غير الشبيه برمز معلمة يُرفض 401. */
  staffLogin?: { login(i: { code: unknown; ip?: unknown }): Promise<{ accessToken: string; refreshToken: string }> }
  admin?: AdminPort
  /** أصل واجهة الموقع المسموح (CORS). فارغ ⇒ لا ترويسات CORS (نفس الأصل فقط). */
  allowedOrigin?: string
  exposePendingKey?: boolean
  /**
   * يُستدعى لكل إجراء حساس. لا يمرَّر إليه أي سرّ (لا رمز جلسة ولا كود دخول). قد يكون غير متزامن (كتابة سجل دائم).
   * إجراءات المالكة/التنزيل تُسجَّل **قبل** تنفيذها وفشل التسجيل ⇒ 500 audit_failed دون تنفيذ (فشل مغلق). إفراج الجلسات يُسجَّل داخل معاملته في الخدمة.
   */
  audit?: (e: AuditEvent) => void | Promise<void>
  now?: () => Date
  /** يُستدعى لأخطاء غير متوقعة (بلا بيانات الطلب). */
  onUnexpected?: (e: unknown) => void
}

const MAX_BODY = 16 * 1024
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const BASE_HEADERS: Record<string, string> = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
}
const HTTP_BY_CODE: Record<string, number> = {
  bad_request: 400, bad_url: 400, bad_idempotency_key: 400, note_required: 400,
  not_found: 404,
  idempotency_conflict: 409, session_closed: 409, session_busy: 409, active_session_exists: 409, not_pending: 409,
  // ليس فشلًا: الملف وصل والتحقق لم يكتمل؛ تُستأنف الجلسة (5.A).
  verification_pending: 202,
}

function resp(status: number, data: unknown, extra: Record<string, string> = {}): ApiResponse {
  return { status, headers: { ...BASE_HEADERS, ...extra }, body: status === 204 ? '' : JSON.stringify(data) }
}
const fail = (status: number, code: string, extra: Record<string, string> = {}) => resp(status, { error: code }, extra)

class HttpFail extends Error {
  status: number
  code: string
  constructor(status: number, code: string) {
    super(code)
    this.status = status
    this.code = code
  }
}

function bearer(req: ApiRequest): string | null {
  const h = req.headers['authorization']
  if (typeof h !== 'string') return null
  const m = /^Bearer ([A-Za-z0-9._~+/=-]{10,4096})$/.exec(h)
  return m ? (m[1] as string) : null
}

function parseBody(req: ApiRequest): Rec {
  if (req.method === 'GET') return {}
  const ct = (req.headers['content-type'] ?? '').toLowerCase()
  if (!/^application\/json(\s*;.*)?$/.test(ct)) throw new HttpFail(415, 'unsupported_media_type')
  const raw = req.body ?? ''
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY) throw new HttpFail(413, 'body_too_large')
  let v: unknown
  try { v = JSON.parse(raw) } catch { throw new HttpFail(400, 'bad_request') }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new HttpFail(400, 'bad_request')
  return v as Rec
}

const uuid = (v: unknown, name: string): string => {
  if (typeof v !== 'string' || !UUID_RE.test(v)) throw new HttpFail(400, `bad_${name}`)
  return v
}

/** مفاتيح التخزين لا تخرج للمعلمة. */
function teacherSession(v: Rec, expose: boolean): Rec {
  const { pendingKey, ...rest } = v
  return expose ? { ...rest, pendingKey } : rest
}
function teacherVersion(v: Rec): Rec {
  const { storageKey: _omit, ...rest } = v
  void _omit
  return rest
}

type Kind = 'public' | 'teacher' | 'owner' | 'staff'
const KNOWN: Record<string, { method: string; kind: Kind }> = {
  '/teacher/login': { method: 'POST', kind: 'public' },
  '/auth/login': { method: 'POST', kind: 'public' },
  '/teacher/logout': { method: 'POST', kind: 'public' },
  '/teacher/me': { method: 'GET', kind: 'teacher' },
  '/teacher/uploads/start': { method: 'POST', kind: 'teacher' },
  '/teacher/uploads/complete': { method: 'POST', kind: 'teacher' },
  '/teacher/uploads/cancel': { method: 'POST', kind: 'teacher' },
  '/teacher/links': { method: 'POST', kind: 'teacher' },
  '/teacher/versions/delete': { method: 'POST', kind: 'teacher' },
  // تسجيل المعلمات (إصدار/إلغاء الرمز والاستيراد): للمالكة والمديرة معًا (r37). حذف المعلمة والسنوات والتصفير تبقى للمالكة وحدها.
  '/staff/teachers/issue-credentials': { method: 'POST', kind: 'staff' },
  '/staff/teachers/revoke-credentials': { method: 'POST', kind: 'staff' },
  '/owner/teachers/remove': { method: 'POST', kind: 'owner' },
  '/owner/uploads/release': { method: 'POST', kind: 'owner' },
  '/teacher/portfolio': { method: 'GET', kind: 'teacher' },
  '/teacher/uploads/presign': { method: 'POST', kind: 'teacher' },
  '/teacher/downloads/sign': { method: 'POST', kind: 'teacher' },
  '/staff/downloads/sign': { method: 'POST', kind: 'staff' },
  '/owner/archives/legacy': { method: 'POST', kind: 'owner' },
  '/owner/archives/download': { method: 'POST', kind: 'owner' },
  '/owner/archives/confirm': { method: 'POST', kind: 'owner' },
  '/owner/year-archive/plan': { method: 'POST', kind: 'owner' },
  '/owner/year-archive/urls': { method: 'POST', kind: 'owner' },
  '/owner/year-archive/register': { method: 'POST', kind: 'owner' },
  '/owner/year-archive/ack': { method: 'POST', kind: 'owner' },
  '/owner/year-archive/confirm-part': { method: 'POST', kind: 'owner' },
  '/owner/year-archive/confirm-copy': { method: 'POST', kind: 'owner' },
  '/owner/year-archive/status': { method: 'POST', kind: 'owner' },
  // السنوات والفصول: للمالكة والمديرة معًا (r39، قرار صاحبة المشروع)
  '/staff/years/create': { method: 'POST', kind: 'staff' },
  '/staff/years/update': { method: 'POST', kind: 'staff' },
  '/staff/years/activate': { method: 'POST', kind: 'staff' },
  '/staff/teachers/import-check': { method: 'POST', kind: 'staff' },
  '/staff/teachers/import': { method: 'POST', kind: 'staff' },
  // التصفير السنوي للمالكة والمديرة (A-126، بطلب صاحبة المشروع). البوابة في القاعدة (أرشيف متحقَّق منه) لا تتغير.
  '/staff/year-reset/report': { method: 'POST', kind: 'staff' },
  '/staff/year-reset/status': { method: 'POST', kind: 'staff' },
  '/staff/year-reset/start': { method: 'POST', kind: 'staff' },
  '/staff/year-reset/resume': { method: 'POST', kind: 'staff' },
  '/owner/maintenance/sweep': { method: 'POST', kind: 'owner' },
  '/staff/overview': { method: 'GET', kind: 'staff' },
}

function cors(deps: ApiDeps, req: ApiRequest): Record<string, string> {
  const o = req.headers['origin']
  if (!deps.allowedOrigin || !o || o !== deps.allowedOrigin) return {}
  return { 'access-control-allow-origin': o, vary: 'Origin' }
}

export function createApiHandler(deps: ApiDeps): (req: ApiRequest) => Promise<ApiResponse> {
  const now = () => (deps.now ?? (() => new Date()))().toISOString()
  const ev = (actor: AuditEvent['actor'], action: string, outcome: AuditEvent['outcome'], target?: string): AuditEvent => ({ at: now(), actor, action, outcome, ...(target ? { target } : {}) })
  /** تسجيل «لا يمنع»: للرفض وما لا ينسب لموظفة. أخطاؤه تُبلَّغ ولا تُسقط الطلب. */
  const audit = (actor: AuditEvent['actor'], action: string, outcome: AuditEvent['outcome'], target?: string): void => {
    try {
      const r = deps.audit?.(ev(actor, action, outcome, target))
      if (r && typeof (r as Promise<void>).catch === 'function') void (r as Promise<void>).catch((e) => deps.onUnexpected?.(e))
    } catch (e) { deps.onUnexpected?.(e) }
  }
  /** تسجيل «يمنع»: يُنتظر قبل تنفيذ الإجراء؛ فشله ⇒ لا تنفيذ. */
  const auditFirst = async (actor: AuditEvent['actor'], action: string, target?: string): Promise<void> => {
    try { await deps.audit?.(ev(actor, action, 'ok', target)) } catch (e) { deps.onUnexpected?.(e); throw new HttpFail(500, 'audit_failed') }
  }

  return async (req) => {
    const c = cors(deps, req)
    const withCors = (r: ApiResponse): ApiResponse => ({ ...r, headers: { ...r.headers, ...c } })
    try {
      const route = KNOWN[req.path]
      if (req.method === 'OPTIONS') {
        if (!route || !c['access-control-allow-origin']) return withCors(fail(404, 'not_found'))
        return { status: 204, body: '', headers: { ...BASE_HEADERS, ...c, 'access-control-allow-methods': route.method, 'access-control-allow-headers': 'authorization, content-type', 'access-control-max-age': '600' } }
      }
      if (!route) return withCors(fail(404, 'not_found'))
      if (req.method !== route.method) return withCors(fail(405, 'method_not_allowed', { allow: route.method }))

      // 1) الهوية أولًا، قبل قراءة الجسم (لا نعالج جسم طلب غير مخوَّل).
      let teacher: { teacherId: string; name: string } | null = null
      let staff: StaffIdentity | null = null
      if (route.kind === 'teacher') {
        try { teacher = await deps.teacherAuth.authenticate(bearer(req)) } catch (e) {
          if (e instanceof AuthError) return withCors(fail(401, 'unauthenticated'))
          throw e
        }
      } else if (route.kind === 'owner' || route.kind === 'staff') {
        const t = bearer(req)
        staff = t ? await deps.staff.verify(t) : null
        if (!staff) { audit({ kind: 'anonymous', id: null }, req.path, 'denied'); return withCors(fail(401, 'unauthenticated')) }
        // تفويض الدور خادميًا: مسارات المالكة لا تقبل المديرة.
        if (route.kind === 'owner' && staff.role !== 'owner') { audit({ kind: staff.role, id: staff.userId }, req.path, 'denied'); return withCors(fail(403, 'forbidden')) }
      }

      const body = parseBody(req)
      const out = await dispatch(req, body, teacher, staff)
      return withCors(out)
    } catch (e) {
      if (e instanceof HttpFail) return withCors(fail(e.status, e.code))
      if (e instanceof ServiceError) return withCors(fail(HTTP_BY_CODE[e.code] ?? 409, e.code))
      if (e instanceof AuthError) return withCors(fail(e.code === 'bad_request' ? 400 : 401, e.code))
      deps.onUnexpected?.(e)
      return withCors(fail(500, 'internal_error')) // لا رسالة ولا أثر مكدّس
    }
  }

  async function dispatch(req: ApiRequest, body: Rec, teacher: { teacherId: string; name: string } | null, staff: StaffIdentity | null): Promise<ApiResponse> {
    switch (req.path) {
      case '/teacher/login': {
        try {
          const r = await deps.teacherAuth.login({ code: body.code, ip: req.ip })
          audit({ kind: 'teacher', id: r.teacher.id }, 'teacher.login', 'ok')
          return resp(200, { token: r.token, expiresAt: r.expiresAt.toISOString(), teacher: r.teacher })
        } catch (e) {
          if (e instanceof AuthError) { audit({ kind: 'anonymous', id: null }, 'teacher.login', 'denied'); return fail(401, 'login_failed') }
          throw e
        }
      }
      case '/auth/login': {
        // صندوق موحَّد: شكل رمز المعلمة (حرفان+رقمان) ⇒ دخول معلمة؛ غير ذلك ⇒ محاولة دخول إدارة. الردّ عند الفشل واحد في الحالتين.
        try {
          if (normalizeCode(body.code) !== null) {
            const r = await deps.teacherAuth.login({ code: body.code, ip: req.ip })
            audit({ kind: 'teacher', id: r.teacher.id }, 'teacher.login', 'ok')
            return resp(200, { kind: 'teacher', token: r.token, expiresAt: r.expiresAt.toISOString(), teacher: r.teacher })
          }
          if (!deps.staffLogin) throw new AuthError('login_failed')
          const s = await deps.staffLogin.login({ code: body.code, ip: req.ip })
          audit({ kind: 'anonymous', id: null }, 'staff.login', 'ok')
          return resp(200, { kind: 'staff', accessToken: s.accessToken, refreshToken: s.refreshToken })
        } catch (e) {
          if (e instanceof AuthError) { audit({ kind: 'anonymous', id: null }, 'auth.login', 'denied'); return fail(401, 'login_failed') }
          throw e
        }
      }
      case '/teacher/logout':
        await deps.teacherAuth.logout(bearer(req))
        return resp(204, null)
      case '/teacher/me':
        return resp(200, { teacher: { id: teacher!.teacherId, name: teacher!.name } })
      case '/teacher/portfolio': {
        if (!deps.reads) return fail(503, 'not_configured')
        return resp(200, { portfolio: await deps.reads.portfolio(teacher!.teacherId) })
      }
      case '/teacher/uploads/presign': {
        if (!deps.transfer) return fail(503, 'not_configured')
        // الرابط لجلسة هذه المعلمة فقط (الخدمة تقيّد بـteacher_id)؛ المفتاح الخام لا يخرج.
        return resp(200, { upload: await deps.transfer.presignUpload(uuid(body.sessionId, 'session_id'), teacher!.teacherId) })
      }
      case '/teacher/downloads/sign': {
        if (!deps.transfer) return fail(503, 'not_configured')
        const vid = uuid(body.versionId, 'version_id')
        const d = await deps.transfer.authorizeDownload(vid, { kind: 'teacher', teacherId: teacher!.teacherId })
        audit({ kind: 'teacher', id: teacher!.teacherId }, 'teacher.download', 'ok', vid)
        return resp(200, { download: d })
      }
      case '/staff/downloads/sign': {
        if (!deps.transfer) return fail(503, 'not_configured')
        const vid = uuid(body.versionId, 'version_id')
        await auditFirst({ kind: staff!.role, id: staff!.userId }, 'staff.download', vid)
        // body.inline === true ⇒ رابط معاينة (PDF/صور فقط؛ الخدمة ترفض غيرها). الإجراء المسجَّل واحد: كل فتح لملف يُسجَّل.
        const d = await deps.transfer.authorizeDownload(vid, { kind: 'staff', role: staff!.role }, body.inline === true ? { inline: true } : {})
        return resp(200, { download: d })
      }
      case '/teacher/uploads/start': {
        // teacherId من الجلسة فقط؛ body.teacherId لا يُقرأ.
        const s = await deps.uploads.start({ teacherId: teacher!.teacherId, termId: uuid(body.termId, 'term_id'), slotId: asSlot(body.slotId), name: asStr(body.name, 'name'), size: asInt(body.size, 'size'), idempotencyKey: asStr(body.idempotencyKey, 'idempotency_key') })
        return resp(200, { session: teacherSession(s as Rec, deps.exposePendingKey === true) })
      }
      case '/teacher/uploads/complete': {
        const r = await deps.uploads.complete(uuid(body.sessionId, 'session_id'), teacher!.teacherId)
        return resp(200, { session: teacherSession(r.session as Rec, deps.exposePendingKey === true), version: teacherVersion(r.version as Rec) })
      }
      case '/teacher/uploads/cancel': {
        const s = await deps.uploads.cancel(uuid(body.sessionId, 'session_id'), teacher!.teacherId)
        return resp(200, { session: teacherSession(s as Rec, deps.exposePendingKey === true) })
      }
      case '/teacher/versions/delete': {
        if (!deps.deleteVersion) return fail(503, 'not_configured')
        const vid = uuid(body.versionId, 'version_id')
        // سطر التدقيق (معرّف الإصدار فقط، بلا اسم ملف) قبل الحذف؛ audit_log لا يُحذف أبدًا.
        await auditFirst({ kind: 'teacher', id: teacher!.teacherId }, 'teacher.delete_version', vid)
        return resp(200, await deps.deleteVersion.delete(teacher!.teacherId, vid))
      }
      case '/teacher/links': {
        const r = await deps.uploads.saveLink({ teacherId: teacher!.teacherId, termId: uuid(body.termId, 'term_id'), slotId: asSlot(body.slotId), url: asStr(body.url, 'url') })
        return resp(200, { version: teacherVersion(r.version as Rec), reused: r.reused })
      }
      case '/staff/teachers/issue-credentials': {
        const id = uuid(body.teacherId, 'teacher_id')
        let exp: Date | null = null
        if (body.codeExpiresAt !== undefined && body.codeExpiresAt !== null) {
          if (typeof body.codeExpiresAt !== 'string' || Number.isNaN(Date.parse(body.codeExpiresAt))) throw new HttpFail(400, 'bad_code_expires_at')
          exp = new Date(body.codeExpiresAt)
          if (exp.getTime() <= Date.now()) throw new HttpFail(400, 'bad_code_expires_at')
        }
        try {
          await auditFirst({ kind: staff!.role, id: staff!.userId }, `${staff!.role}.issue_credentials`, id)
          const r = await deps.teacherAuth.issueCredentials(id, { codeExpiresAt: exp })
          // الكود يظهر هنا **مرة واحدة** ولا يُسجَّل؛ ردّ غير قابل للتخزين المؤقت (BASE_HEADERS).
          return resp(200, { code: r.code })
        } catch (e) {
          if ((e instanceof DbError && e.sqlstate === '23503') || (e as { code?: string }).code === 'teacher_not_found') return fail(404, 'not_found') // معلمة غير موجودة
          throw e
        }
      }
      case '/owner/teachers/remove': {
        // حذف المعلمة بعد الأرشفة (A-114): القاعدة تتحقق من المالكة ومن أن كل إصداراتها في أرشيف متحقَّق منه ومنزَّل، وتسجّل التدقيق بلا اسم.
        const id = uuid(body.teacherId, 'teacher_id')
        try {
          const r = await deps.teacherAuth.removeTeacher(id, staff!.userId)
          return resp(200, { removed: true, versions: r.versions })
        } catch (e) {
          if (e instanceof DbError) {
            if (e.sqlstate === '23514') return fail(409, 'not_archived')
            if (e.sqlstate === 'P0002') return fail(404, 'not_found')
            if (e.sqlstate === '42501') return fail(403, 'forbidden')
          }
          throw e
        }
      }
      case '/staff/teachers/revoke-credentials': {
        const id = uuid(body.teacherId, 'teacher_id')
        await auditFirst({ kind: staff!.role, id: staff!.userId }, `${staff!.role}.revoke_credentials`, id)
        await deps.teacherAuth.revokeCredentials(id)
        return resp(204, null)
      }
      case '/owner/uploads/release': {
        const sid = uuid(body.sessionId, 'session_id')
        if (body.platformFault !== undefined && typeof body.platformFault !== 'boolean') throw new HttpFail(400, 'bad_platform_fault')
        const s = await deps.uploads.ownerRelease({ sessionId: sid, note: asStr(body.note, 'note'), platformFault: body.platformFault === true, actorUserId: staff!.userId })
        return resp(200, { session: teacherSession(s as Rec, false) })
      }
      case '/owner/archives/legacy': {
        // أرشيفات سحابية قديمة سبق رفعها (للنقل إلى الجهاز فقط؛ لا إنشاء ولا رفع، A-118).
        if (!deps.archives) return fail(503, 'not_configured')
        return resp(200, { archives: await deps.archives.listLegacy() })
      }
      case '/owner/archives/download': {
        if (!deps.archives) return fail(503, 'not_configured')
        const aid = uuid(body.archiveId, 'archive_id')
        await auditFirst({ kind: 'owner', id: staff!.userId }, 'owner.download_archive', aid)
        const d = await deps.archives.authorizeDownload(aid)
        return resp(200, { download: d })
      }
      case '/owner/archives/confirm': {
        if (!deps.archives) return fail(503, 'not_configured')
        const aid = uuid(body.archiveId, 'archive_id')
        const sha = asStr(body.sha256, 'sha256')
        const r = await deps.archives.confirmDownload({ archiveId: aid, sha256: sha, actorUserId: staff!.userId })
        if ((r as { verified?: unknown }).verified !== true) return resp(409, { error: 'hash_mismatch', confirmation: r })
        return resp(200, { confirmation: r })
      }
      case '/owner/year-archive/plan': {
        if (!deps.yearArchives) return fail(503, 'not_configured')
        const yid = uuid(body.yearId, 'year_id')
        await auditFirst({ kind: 'owner', id: staff!.userId }, 'owner.year_archive_plan', yid)
        return resp(200, { plan: await deps.yearArchives.plan(yid, body.targetBytes === undefined ? undefined : asInt(body.targetBytes, 'target_bytes')) })
      }
      case '/owner/year-archive/urls': {
        if (!deps.yearArchives) return fail(503, 'not_configured')
        const yid = uuid(body.yearId, 'year_id')
        if (!Array.isArray(body.versionIds)) throw new HttpFail(400, 'bad_request')
        const ids = body.versionIds.map((x) => uuid(x, 'version_id'))
        // تدقيق الدفعة بعدد الملفات فقط (لا سجل لكل ملف: السنة قد تضم آلاف الملفات).
        await auditFirst({ kind: 'owner', id: staff!.userId }, 'owner.year_archive_urls', `${yid}:${ids.length}`)
        return resp(200, { urls: await deps.yearArchives.urls(yid, ids) })
      }
      case '/owner/year-archive/register': {
        if (!deps.yearArchives) return fail(503, 'not_configured')
        const yid = uuid(body.yearId, 'year_id')
        if (!Array.isArray(body.parts)) throw new HttpFail(400, 'bad_request')
        const parts = body.parts.map((p) => { const o = (typeof p === 'object' && p !== null ? p : {}) as Rec; return { no: asInt(o.no, 'part_no'), filename: asStr(o.filename, 'filename'), sha256: asStr(o.sha256, 'sha256'), size: asInt(o.size, 'size') } })
        await auditFirst({ kind: 'owner', id: staff!.userId }, 'owner.year_archive_register', `${yid}:${parts.length}`)
        const a = await deps.yearArchives.register({ yearId: yid, title: asStr(body.title, 'title'), targetBytes: asInt(body.targetBytes, 'target_bytes'), parts, entriesDigest: asStr(body.entriesDigest, 'entries_digest'), actorUserId: staff!.userId })
        return resp(200, { archive: a })
      }
      case '/owner/year-archive/confirm-part': {
        if (!deps.yearArchives) return fail(503, 'not_configured')
        const aid = uuid(body.archiveId, 'archive_id'); const no = asInt(body.partNo, 'part_no')
        const r = await deps.yearArchives.confirmPart({ archiveId: aid, partNo: no, sha256: asStr(body.sha256, 'sha256'), actorUserId: staff!.userId })
        return r.verified === true ? resp(200, { confirmation: r }) : resp(409, { error: 'hash_mismatch', confirmation: r })
      }
      case '/owner/year-archive/confirm-copy': {
        if (!deps.yearArchives) return fail(503, 'not_configured')
        const aid = uuid(body.archiveId, 'archive_id'); const no = asInt(body.partNo, 'part_no')
        const r = await deps.yearArchives.confirmCopy({ archiveId: aid, partNo: no, sha256: asStr(body.sha256, 'sha256'), medium: asStr(body.medium, 'medium'), independent: body.independent === true, actorUserId: staff!.userId })
        return r.verified === true ? resp(200, { confirmation: r }) : resp(409, { error: 'hash_mismatch', confirmation: r })
      }
      case '/owner/year-archive/ack': {
        if (!deps.yearArchives) return fail(503, 'not_configured')
        const aid = uuid(body.archiveId, 'archive_id')
        const kind = body.kind === 'opened_locally' ? body.kind : null
        if (!kind) throw new HttpFail(400, 'bad_request')
        await auditFirst({ kind: 'owner', id: staff!.userId }, `owner.year_archive_ack_${kind}`, aid)
        return resp(200, { ack: await deps.yearArchives.ack({ archiveId: aid, kind, ...(typeof body.note === 'string' ? { note: body.note } : {}), actorUserId: staff!.userId }) })
      }
      case '/owner/year-archive/status': {
        if (!deps.yearArchives) return fail(503, 'not_configured')
        return resp(200, { status: await deps.yearArchives.status(uuid(body.yearId, 'year_id')) })
      }
      case '/staff/years/create': {
        if (!deps.admin) return fail(503, 'not_configured')
        await auditFirst({ kind: staff!.role, id: staff!.userId }, `${staff!.role}.year_create`)
        return resp(200, await deps.admin.createYear(staff!.userId, body.year as Obj))
      }
      case '/staff/years/update': {
        if (!deps.admin) return fail(503, 'not_configured')
        const yid = uuid(body.yearId, 'year_id')
        await auditFirst({ kind: staff!.role, id: staff!.userId }, `${staff!.role}.year_update`, yid)
        await deps.admin.updateYear(staff!.userId, yid, body.year as Obj)
        return resp(200, { ok: true })
      }
      case '/staff/years/activate': {
        if (!deps.admin) return fail(503, 'not_configured')
        const yid = uuid(body.yearId, 'year_id')
        await auditFirst({ kind: staff!.role, id: staff!.userId }, `${staff!.role}.year_activate`, yid)
        await deps.admin.activateYear(staff!.userId, yid)
        return resp(200, { ok: true })
      }
      case '/staff/teachers/import-check': {
        if (!deps.admin) return fail(503, 'not_configured')
        return resp(200, { existing: await deps.admin.existingTeachers() })
      }
      case '/staff/teachers/import': {
        if (!deps.admin) return fail(503, 'not_configured')
        if (!Array.isArray(body.rows)) throw new HttpFail(400, 'bad_rows')
        await auditFirst({ kind: staff!.role, id: staff!.userId }, `${staff!.role}.import_teachers`, String((body.rows as unknown[]).length))
        // الأكواد تظهر في هذا الرد مرة واحدة ولا تُسجَّل (BASE_HEADERS: no-store).
        return resp(200, await deps.admin.importTeachers({ actor: staff!.userId, rows: body.rows as { name: unknown; subject: unknown }[], issueCodes: body.issueCodes === true }))
      }
      case '/staff/year-reset/report': {
        if (!deps.yearResets) return fail(503, 'not_configured')
        return resp(200, { report: await deps.yearResets.report(uuid(body.yearId, 'year_id')) })
      }
      case '/staff/year-reset/status': {
        if (!deps.yearResets) return fail(503, 'not_configured')
        return resp(200, { status: await deps.yearResets.status(uuid(body.yearId, 'year_id')) })
      }
      case '/staff/year-reset/start': {
        if (!deps.yearResets) return fail(503, 'not_configured')
        const yid = uuid(body.yearId, 'year_id')
        // تأكيد صريح من الواجهة (نقرة تأكيد واحدة) بدل الكتابة؛ إن أُرسل typedConfirmation فيجب أن يطابق اسم السنة.
        if (body.confirm !== true) throw new HttpFail(400, 'confirm_required')
        await auditFirst({ kind: staff!.role, id: staff!.userId }, `${staff!.role}.year_reset_start`, yid)
        return resp(200, await deps.yearResets.start({ yearId: yid, ...(typeof body.typedConfirmation === 'string' ? { typedConfirmation: body.typedConfirmation } : {}), actorUserId: staff!.userId }))
      }
      case '/staff/year-reset/resume': {
        if (!deps.yearResets) return fail(503, 'not_configured')
        const yid = uuid(body.yearId, 'year_id')
        await auditFirst({ kind: staff!.role, id: staff!.userId }, `${staff!.role}.year_reset_resume`, yid)
        return resp(200, await deps.yearResets.resume({ yearId: yid, actorUserId: staff!.userId }))
      }
      case '/owner/maintenance/sweep': {
        // صيانة: إنهاء جلسات started المنقضية (لا يمسّ ملفات ولا إصدارات). تُدقَّق قبل التنفيذ.
        await auditFirst({ kind: 'owner', id: staff!.userId }, 'owner.sweep_expired_sessions')
        return resp(200, { expired: await deps.uploads.sweepExpired() })
      }
      case '/staff/overview': {
        const o = await deps.uploads.overview(uuid(req.query?.['termId'], 'term_id'))
        return resp(200, { overview: o })
      }
      default:
        return fail(404, 'not_found')
    }
  }
}

function asStr(v: unknown, name: string): string {
  if (typeof v !== 'string') throw new HttpFail(400, `bad_${name}`)
  return v
}
function asInt(v: unknown, name: string): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v)) throw new HttpFail(400, `bad_${name}`)
  return v
}
/** معرّف خانة (نص قصير بلا محارف تحكم): التحقق التفصيلي في الخدمة (assertId). */
function asSlot(v: unknown): string {
  if (typeof v !== 'string' || v.length === 0 || v.length > 64) throw new HttpFail(400, 'bad_slot_id')
  return v
}
