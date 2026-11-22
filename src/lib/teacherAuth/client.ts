/**
 * عميل دخول المعلمة في المتصفح (الدفعة 6). منطق نقي بلا React ولا اعتماديات: يتكلم مع طبقة HTTP الخادمية (server/api/handler.ts).
 * **الحالة:** مُختبَر بـ fetch وتخزين بديلين فقط. **لم يُربط بشاشة الدخول** (Login.tsx ما زالت تعرض «غير متاح بعد» عمدًا): لوحة المعلمة
 * تحتاج مسارات قراءة للمعلمة (تسليماتها وفصولها) لم تُبنَ بعد، ونموذج دخول بلا لوحة خلفه ادعاء غير صادق.
 * الرمز يُحفظ في تخزين الجلسة (sessionStorage) بتوصية TEACHER_LOGIN_DESIGN §5 (قرار صاحبة المشروع ما زال معلّقًا) ولا يُسجَّل في أي مكان.
 */
export interface TokenStorage { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }
export type TeacherAuthFailure = 'login_failed' | 'unauthenticated' | 'network' | 'rate_limited' | 'server' | 'bad_input' | 'rejected'
/** `code` = رمز الخطأ من الخادم عند الرفض (للرسالة العربية فقط). */
export type Result<T> = { ok: true; value: T } | { ok: false; error: TeacherAuthFailure; code?: string }

const TOKEN_KEY = 'athar.teacher.token'
const TOKEN_RE = /^[A-Za-z0-9._~+/=-]{10,4096}$/

export const TEACHER_AUTH_MESSAGES: Record<TeacherAuthFailure, string> = {
  login_failed: 'تعذّر الدخول، تحققي من الرمز.',
  unauthenticated: 'انتهت الجلسة. سجّلي الدخول من جديد.',
  network: 'تعذّر الاتصال بالخادم. تحققي من الإنترنت ثم أعيدي المحاولة.',
  rate_limited: 'محاولات كثيرة. انتظري قليلًا ثم أعيدي المحاولة.',
  server: 'حدث عطل مؤقت. أعيدي المحاولة بعد قليل.',
  bad_input: 'تحققي من الرمز.',
  rejected: 'تعذّر تنفيذ الطلب.',
}

/** رسائل رموز الخادم في الرفع والتنزيل (عربية، بلا تفاصيل داخلية). */
export const UPLOAD_MESSAGES: Record<string, string> = {
  deadline_closed: 'انتهى موعد التسليم أو الاستبدال لهذا الفصل.',
  active_session_exists: 'لديكِ عملية رفع جارية لهذه الخانة. انتظري اكتمالها ثم أعيدي المحاولة.',
  too_large: 'حجم الملف أكبر من المسموح.', type_not_allowed: 'نوع الملف غير مسموح.', empty: 'الملف فارغ.',
  size_mismatch: 'حجم الملف المرفوع لا يطابق المعلن. أعيدي المحاولة.', signature_mismatch: 'محتوى الملف لا يطابق نوعه.',
  expired: 'انتهت مهلة عملية الرفع. ابدئي من جديد.', session_closed: 'أُغلقت عملية الرفع. ابدئي من جديد.',
  session_busy: 'العملية قيد المعالجة. انتظري لحظات ثم أعيدي المحاولة.', verification_pending: 'وصل الملف ويجري التحقق منه. أعيدي المحاولة بعد قليل.',
  delete_not_latest: 'يمكن حذف آخر إصدار فقط.', delete_archive_exists: 'أُنشئ أرشيف لهذه السنة، فلا يمكن الحذف الآن. تواصلي مع الإدارة.',
  delete_year_inactive: 'السنة الدراسية غير نشطة.', year_closed: 'أُغلقت هذه السنة.', files_missing: 'تعذّر الوصول إلى الملف. أعيدي المحاولة.',
  bad_url: 'الرابط غير صالح (يلزم https).', bad_request: 'بيانات غير صالحة.', not_found: 'غير موجود.', upload_failed: 'تعذّر رفع الملف إلى التخزين. أعيدي المحاولة.',
}
export function uploadMessage(f: { error: TeacherAuthFailure; code?: string }): string {
  return (f.code && UPLOAD_MESSAGES[f.code]) || TEACHER_AUTH_MESSAGES[f.error]
}

export interface TeacherApiOptions { baseUrl: string; storage: TokenStorage; fetchImpl?: typeof fetch }
export interface TeacherIdentity { id: string; name: string }

/** عرض الفصول كما تعيده الواجهة الخادمية (بلا أي مفتاح تخزين). التحقق هنا شكلي؛ الخادم هو المرجع. */
export interface UploadOutcome { versionId: string; no: number; statusSnapshot: 'on_time' | 'late' }
export type UploadStage = 'starting' | 'uploading' | 'finishing'
export interface PortalVersion { id: string; no: number; kind: 'file' | 'link'; name: string | null; sizeBytes: number | null; ext: string | null; url: string | null; status: 'on_time' | 'late'; submittedAt: string; downloadable: boolean }
export interface PortalSlot { slotId: string; title: string; optional: boolean; state: 'missing' | 'on_time' | 'late'; gate: 'on_time' | 'late' | 'closed'; canSubmit: boolean; canReplace: boolean; versions: PortalVersion[] }
export interface PortalTerm { id: string; name: string; ord: number; deadlines: { base: string; late: string; replace: string }; phase: 'before_base' | 'late_window' | 'replace_only' | 'closed'; slots: PortalSlot[] }
/** year: السنة النشطة (null ⇒ لا سنة نشطة: تُعرض رسالة واضحة بدل صفحة فارغة). slotsCount: عدد البنود المعرَّفة. */
export interface Portfolio { teacher: { id: string; name: string; subject: string }; serverNow: string; year?: { id: string; label: string } | null; slotsCount?: number; terms: PortalTerm[] }
export interface DownloadLink { url: string; expiresAt: string; filename: string }

export function checkTeacherApiUrl(u: unknown): string | null {
  if (typeof u !== 'string') return null
  try {
    const p = new URL(u.trim())
    const local = p.hostname === 'localhost' || p.hostname === '127.0.0.1'
    if (p.protocol !== 'https:' && !(p.protocol === 'http:' && local)) return null
    if (p.username || p.password || p.search || p.hash) return null
    return p.origin + p.pathname.replace(/\/+$/, '')
  } catch { return null }
}

export type TeacherApiClient = ReturnType<typeof createTeacherApiClient>

export function createTeacherApiClient(o: TeacherApiOptions) {
  const base = checkTeacherApiUrl(o.baseUrl)
  if (!base) throw new Error('عنوان واجهة المعلمة غير صالح (يلزم https)')
  const f = o.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a))

  const readToken = (): string | null => {
    try { const t = o.storage.getItem(TOKEN_KEY); return t && TOKEN_RE.test(t) ? t : null } catch { return null }
  }
  const clear = () => { try { o.storage.removeItem(TOKEN_KEY) } catch { /* تجاهل */ } }

  async function call(method: 'GET' | 'POST', path: string, body?: unknown, token?: string | null): Promise<{ status: number; json: unknown } | 'network'> {
    try {
      const res = await f(`${base}${path}`, {
        method,
        headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
      })
      let json: unknown = null
      try { json = res.status === 204 ? null : await res.json() } catch { json = null }
      return { status: res.status, json }
    } catch { return 'network' }
  }
  const failure = (status: number): TeacherAuthFailure => (status === 401 ? 'unauthenticated' : status === 429 ? 'rate_limited' : status >= 500 ? 'server' : 'bad_input')

  return {
    hasToken: (): boolean => readToken() !== null,
    async login(code: string): Promise<Result<TeacherIdentity>> {
      if (typeof code !== 'string' || code.trim() === '') return { ok: false, error: 'bad_input' }
      const r = await call('POST', '/teacher/login', { code })
      if (r === 'network') return { ok: false, error: 'network' }
      if (r.status === 401) return { ok: false, error: 'login_failed' } // رسالة موحّدة (لا كشف للسبب)
      const j = r.json as { token?: unknown; teacher?: { id?: unknown; name?: unknown } } | null
      if (r.status !== 200 || typeof j?.token !== 'string' || !TOKEN_RE.test(j.token) || typeof j.teacher?.id !== 'string' || typeof j.teacher?.name !== 'string') {
        return { ok: false, error: r.status === 200 ? 'server' : failure(r.status) }
      }
      try { o.storage.setItem(TOKEN_KEY, j.token) } catch { return { ok: false, error: 'server' } }
      return { ok: true, value: { id: j.teacher.id, name: j.teacher.name } }
    },
    /** (r38) الصندوق الموحَّد: رمز معلمة ⇒ جلسة معلمة تُحفظ هنا؛ غيره ⇒ جلسة Supabase للإدارة تُسلَّم للمتحكّم (لا تُخزَّن هنا). */
    async loginAny(code: string): Promise<Result<{ kind: 'teacher'; teacher: TeacherIdentity } | { kind: 'staff'; accessToken: string; refreshToken: string }>> {
      if (typeof code !== 'string' || code.trim() === '' || code.length > 128) return { ok: false, error: 'bad_input' }
      const r = await call('POST', '/auth/login', { code: code.trim() })
      if (r === 'network') return { ok: false, error: 'network' }
      if (r.status === 401) return { ok: false, error: 'login_failed' }
      const j = r.json as { kind?: unknown; token?: unknown; teacher?: { id?: unknown; name?: unknown }; accessToken?: unknown; refreshToken?: unknown } | null
      if (r.status !== 200) return { ok: false, error: failure(r.status) }
      if (j?.kind === 'teacher' && typeof j.token === 'string' && TOKEN_RE.test(j.token) && typeof j.teacher?.id === 'string' && typeof j.teacher?.name === 'string') {
        try { o.storage.setItem(TOKEN_KEY, j.token) } catch { return { ok: false, error: 'server' } }
        return { ok: true, value: { kind: 'teacher', teacher: { id: j.teacher.id, name: j.teacher.name } } }
      }
      if (j?.kind === 'staff' && typeof j.accessToken === 'string' && typeof j.refreshToken === 'string') return { ok: true, value: { kind: 'staff', accessToken: j.accessToken, refreshToken: j.refreshToken } }
      return { ok: false, error: 'server' }
    },
    async me(): Promise<Result<TeacherIdentity>> {
      const t = readToken()
      if (!t) return { ok: false, error: 'unauthenticated' }
      const r = await call('GET', '/teacher/me', undefined, t)
      if (r === 'network') return { ok: false, error: 'network' } // لا نمحو الجلسة عند عطل مؤقت
      if (r.status === 401) { clear(); return { ok: false, error: 'unauthenticated' } }
      const j = r.json as { teacher?: { id?: unknown; name?: unknown } } | null
      if (r.status !== 200 || typeof j?.teacher?.id !== 'string' || typeof j.teacher.name !== 'string') return { ok: false, error: failure(r.status) }
      return { ok: true, value: { id: j.teacher.id, name: j.teacher.name } }
    },
    async portfolio(): Promise<Result<Portfolio>> {
      const t = readToken()
      if (!t) return { ok: false, error: 'unauthenticated' }
      const r = await call('GET', '/teacher/portfolio', undefined, t)
      if (r === 'network') return { ok: false, error: 'network' }
      if (r.status === 401) { clear(); return { ok: false, error: 'unauthenticated' } }
      const p = (r.json as { portfolio?: Portfolio } | null)?.portfolio
      if (r.status !== 200 || !p || !Array.isArray(p.terms) || typeof p.teacher?.id !== 'string') return { ok: false, error: r.status === 200 ? 'server' : failure(r.status) }
      return { ok: true, value: p }
    },
    /** رابط تنزيل قصير العمر لإصدار تملكه المعلمة. لا يُخزَّن ولا يُسجَّل. */
    async signDownload(versionId: string): Promise<Result<DownloadLink>> {
      const t = readToken()
      if (!t) return { ok: false, error: 'unauthenticated' }
      const r = await call('POST', '/teacher/downloads/sign', { versionId }, t)
      if (r === 'network') return { ok: false, error: 'network' }
      if (r.status === 401) { clear(); return { ok: false, error: 'unauthenticated' } }
      const d = (r.json as { download?: DownloadLink } | null)?.download
      if (r.status !== 200 || !d || typeof d.url !== 'string' || !/^https:\/\//.test(d.url)) return { ok: false, error: r.status === 200 ? 'server' : failure(r.status) }
      return { ok: true, value: d }
    },
    /**
     * رفع ملف جديد أو استبدال (نسخة جديدة ضمن مهلة الفصل — الخادم يقرر): start ← رابط PUT موقّع ← رفع مباشر إلى التخزين ← complete (يقيس الخادم الكائن).
     * فشل الرفع إلى التخزين يلغي الجلسة (best-effort)؛ `verification_pending` يُعاد بعد مهلة قصيرة ولا تُلغى الجلسة (قابلة للاستئناف).
     */
    async uploadFile(i: { termId: string; slotId: string; file: Blob & { name: string }; idempotencyKey?: string }, h: { stage?: (s: UploadStage) => void; putImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> } = {}): Promise<Result<UploadOutcome>> {
      const t = readToken()
      if (!t) return { ok: false, error: 'unauthenticated' }
      const put = h.putImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a))
      const sleep = h.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
      const fail = (r: { status: number; json: unknown } | 'network'): { ok: false; error: TeacherAuthFailure; code?: string } => {
        if (r === 'network') return { ok: false, error: 'network' }
        if (r.status === 401) { clear(); return { ok: false, error: 'unauthenticated' } }
        const code = typeof (r.json as { error?: unknown } | null)?.error === 'string' ? (r.json as { error: string }).error : undefined
        return { ok: false, error: r.status >= 500 ? 'server' : 'rejected', ...(code ? { code } : {}) }
      }
      const key = i.idempotencyKey ?? globalThis.crypto.randomUUID()
      h.stage?.('starting')
      const st = await call('POST', '/teacher/uploads/start', { termId: i.termId, slotId: i.slotId, name: i.file.name, size: i.file.size, idempotencyKey: key }, t)
      if (st === 'network' || st.status !== 200) return fail(st)
      const sessionId = (st.json as { session?: { sessionId?: unknown } } | null)?.session?.sessionId
      if (typeof sessionId !== 'string') return { ok: false, error: 'server' }
      const cancel = async () => { await call('POST', '/teacher/uploads/cancel', { sessionId }, t) }
      const pr = await call('POST', '/teacher/uploads/presign', { sessionId }, t)
      if (pr === 'network' || pr.status !== 200) { await cancel(); return fail(pr) }
      const up = (pr.json as { upload?: { url?: unknown; method?: unknown } } | null)?.upload
      if (typeof up?.url !== 'string' || !/^https:\/\//.test(up.url) || up.method !== 'PUT') { await cancel(); return { ok: false, error: 'server' } }
      h.stage?.('uploading')
      try {
        const res = await put(up.url, { method: 'PUT', body: i.file, credentials: 'omit', referrerPolicy: 'no-referrer' })
        if (!res.ok) { await cancel(); return { ok: false, error: 'rejected', code: 'upload_failed' } }
      } catch { await cancel(); return { ok: false, error: 'network', code: 'upload_failed' } }
      h.stage?.('finishing')
      for (let attempt = 0; attempt < 4; attempt++) {
        const cr = await call('POST', '/teacher/uploads/complete', { sessionId }, t)
        if (cr !== 'network' && cr.status === 200) {
          const v = (cr.json as { version?: { versionId?: unknown; no?: unknown; statusSnapshot?: unknown } } | null)?.version
          if (typeof v?.versionId !== 'string' || typeof v.no !== 'number') return { ok: false, error: 'server' }
          return { ok: true, value: { versionId: v.versionId, no: v.no, statusSnapshot: v.statusSnapshot === 'late' ? 'late' : 'on_time' } }
        }
        const pending = cr !== 'network' && cr.status === 202
        if (!pending) return fail(cr) // لا نلغي هنا: الجلسة uploaded/validating قابلة للاستئناف
        await sleep(1500)
      }
      return { ok: false, error: 'rejected', code: 'verification_pending' }
    },
    /** حفظ رابط خارجي (https) لخانة. الخادم يتحقق من الرابط والموعد. */
    async saveLink(i: { termId: string; slotId: string; url: string }): Promise<Result<{ no: number; reused: boolean }>> {
      const t = readToken()
      if (!t) return { ok: false, error: 'unauthenticated' }
      const r = await call('POST', '/teacher/links', i, t)
      if (r === 'network') return { ok: false, error: 'network' }
      if (r.status === 401) { clear(); return { ok: false, error: 'unauthenticated' } }
      const j = r.json as { version?: { no?: unknown }; reused?: unknown; error?: unknown } | null
      if (r.status === 200 && typeof j?.version?.no === 'number') return { ok: true, value: { no: j.version.no, reused: j.reused === true } }
      return { ok: false, error: r.status >= 500 ? 'server' : 'rejected', ...(typeof j?.error === 'string' ? { code: j.error } : {}) }
    },
    /** حذف آخر إصدار في خانة نهائيًا (الفصل مفتوح). الخادم يحذف الملف من التخزين والصف من القاعدة. */
    async deleteVersion(versionId: string): Promise<Result<{ deleted: true }>> {
      const t = readToken()
      if (!t) return { ok: false, error: 'unauthenticated' }
      const r = await call('POST', '/teacher/versions/delete', { versionId }, t)
      if (r === 'network') return { ok: false, error: 'network' }
      if (r.status === 401) { clear(); return { ok: false, error: 'unauthenticated' } }
      const j = r.json as { deleted?: unknown; error?: unknown } | null
      if (r.status === 200 && j?.deleted === true) return { ok: true, value: { deleted: true } }
      return { ok: false, error: r.status >= 500 ? 'server' : 'rejected', ...(typeof j?.error === 'string' ? { code: j.error } : {}) }
    },
    /** يمحو الرمز محليًا دائمًا (حتى لو فشل الاتصال) ويحاول إبطاله في الخادم. */
    async logout(): Promise<void> {
      const t = readToken()
      clear()
      if (t) await call('POST', '/teacher/logout', {}, t)
    },
  }
}
