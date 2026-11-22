import type { BackendClient, BackendError } from '../supabase/types'

/**
 * متحكّم مصادقة المالكة والمديرة.
 * القاعدة: **فشل مغلق**. أي خطأ أو غياب بيانات أو تعارض ⇒ لا دخول (تسجيل خروج) — لا استثناء ولا افتراض.
 * هذا الملف يضبط تجربة الدخول فقط؛ الحماية الفعلية للبيانات في RLS (current_staff_role، ملف 005).
 *
 * قرار A-98 (2026-10-23): **أُلغي التحقق بخطوتين (TOTP)** للمالكة والمديرة بطلب صاحبة المشروع. الدخول المصرَّح الآن يشترط معًا:
 *  بريد مسجَّل + كلمة مرور صحيحة + صف نشط في staff_profiles بدور owner|director + تأكيد الدور من الخادم.
 *
 * تسلسل التحقق بعد كلمة المرور:
 *  1) getUser() من الخادم (لا الاكتفاء بالجلسة المخزَّنة).
 *  2) صف نشط للمستخدمة في staff_profiles بدور owner|director (سياسة staff_profiles_select تقرأ صفها هي فقط).
 *  3) تأكيد الدور من الخادم نفسه عبر current_staff_role() ومطابقته للصف (تعارض أو null ⇒ رفض).
 *
 * استمرار الجلسة (A-93):
 *  - **رفض قاطع** (حساب غير مخوَّل، تعارض دور، خطأ قاعدة/صلاحية غير مؤقت) ⇒ خروج محلي ورفض.
 *  - **عطل مؤقت** (انقطاع شبكة، 5xx، 429، 408) أثناء التحقق ⇒ لا دخول (الحالة check_failed، لا بيانات ولا لوحة)
 *    لكن **لا تُمحى الجلسة السليمة**؛ زر «إعادة المحاولة» يعيد التقييم الكامل دون كلمة مرور جديدة.
 *  - الخروج الاعتيادي والرفض بنطاق local: ينهيان جلسة هذا الجهاز فقط. الخروج من كل الأجهزة متاح برمجيًا (signOut('global')).
 */

export type StaffRole = 'owner' | 'director'
export type AuthErrorCode =
  | 'invalid_credentials' | 'not_staff' | 'profile_check_failed' | 'role_mismatch' | 'network' | 'rate_limited'
  | 'session_expired' | 'server_unavailable' | 'unknown'

export type AuthState = { busy: boolean; error?: AuthErrorCode } & (
  | { phase: 'initializing' }
  | { phase: 'signed_out' }
  /** تعذّر إكمال التحقق بسبب عطل مؤقت. الجلسة محفوظة ولا دخول: الخيار «إعادة المحاولة» أو «تسجيل الخروج». */
  | { phase: 'check_failed' }
  | { phase: 'authorized'; role: StaffRole; userId: string }
)

export interface AuthController {
  getState(): AuthState
  subscribe(listener: () => void): () => void
  /** يبدأ الاستماع لتغيّرات الجلسة ويقيّم الجلسة الحالية (إن وُجدت). */
  start(): Promise<void>
  dispose(): void
  signIn(email: string, password: string): Promise<void>
  /** (r38) تثبيت جلسة إدارة أصدرها الخادم من الصندوق الموحَّد، ثم التحقق الكامل نفسه (صف نشط + تأكيد الدور من الخادم). */
  signInWithTokens(accessToken: string, refreshToken: string): Promise<void>
  /** يعيد التقييم الكامل للجلسة المحفوظة بعد عطل مؤقت (check_failed) دون كلمة مرور جديدة. */
  retry(): Promise<void>
  /** local (الافتراضي): هذا الجهاز فقط. global: كل الأجهزة. */
  signOut(scope?: 'local' | 'global'): Promise<void>
  /** رمز الوصول الحالي للمسؤولة لإرساله إلى الواجهة الخادمية، أو null (لا يُخزَّن ولا يُسجَّل). */
  getAccessToken?(): Promise<string | null>
}

const isStaffRole = (v: unknown): v is StaffRole => v === 'owner' || v === 'director'

export function isNetworkError(e: BackendError | null | undefined): boolean {
  if (!e) return false
  const m = `${e.name ?? ''} ${e.message ?? ''}`.toLowerCase()
  return m.includes('failed to fetch') || m.includes('networkerror') || m.includes('network request') || m.includes('fetch failed') || m.includes('retryablefetch')
}
const isSessionMissing = (e: BackendError) => (e.name ?? '') === 'AuthSessionMissingError' || /session missing/i.test(e.message ?? '')
/** عطل مؤقت لا يدل على بطلان الجلسة: شبكة، 5xx، 429، 408. */
export function isTransientError(e: BackendError | null | undefined): boolean {
  if (!e) return false
  const st = e.status ?? 0
  return isNetworkError(e) || st >= 500 || st === 429 || st === 408
}

export function describeAuthError(code: AuthErrorCode | undefined): string | null {
  switch (code) {
    case undefined: return null
    // رسالة واحدة لكلمة المرور الخاطئة وللحساب غير المخوَّل: لا نؤكد صحة بيانات حساب غير مخوَّل.
    case 'invalid_credentials':
    case 'not_staff':
      return 'تعذّر الدخول بهذه البيانات. تأكدي من البريد وكلمة المرور، أو تواصلي مع إدارة المنصة إن كنتِ تتوقعين أن حسابكِ مخوَّل.'
    case 'rate_limited': return 'محاولات كثيرة. انتظري قليلًا ثم أعيدي المحاولة.'
    case 'network': return 'تعذّر الاتصال بالخادم. تحققي من الإنترنت ثم أعيدي المحاولة.'
    case 'server_unavailable': return 'الخادم مشغول أو غير متاح مؤقتًا. أعيدي المحاولة بعد قليل.'
    case 'role_mismatch': return 'تعذّر تأكيد صلاحية الحساب من الخادم، فلم يُسمح بالدخول.'
    case 'profile_check_failed': return 'تعذّر التحقق من صلاحية الحساب، فلم يُسمح بالدخول. أعيدي المحاولة أو تواصلي مع إدارة المنصة.'
    case 'session_expired': return 'انتهت الجلسة. سجّلي الدخول من جديد.'
    default: return 'حدث خطأ غير متوقع. أعيدي المحاولة.'
  }
}

export function createAuthController(client: BackendClient): AuthController {
  let state: AuthState = { phase: 'initializing', busy: false }
  let seq = 0 // يُبطل نتائج التقييمات المتأخرة
  let started = false
  let unsub: (() => void) | null = null
  const listeners = new Set<() => void>()

  const set = (s: AuthState) => { state = s; listeners.forEach((l) => l()) }
  const out = (error?: AuthErrorCode): AuthState => ({ phase: 'signed_out', busy: false, ...(error ? { error } : {}) })

  /** خروج هادئ: لا يرمي أبدًا (الفشل المغلق لا يتوقف على نجاح الخروج). */
  const quietSignOut = async (scope: 'local' | 'global' = 'local') => { try { await client.auth.signOut({ scope }) } catch { /* تُهمَل: الحالة المحلية signed_out أصلًا */ } }
  const deny = async (code: AuthErrorCode, mySeq: number) => {
    await quietSignOut()
    if (mySeq === seq) set(out(code))
  }
  /** عطل مؤقت: لا دخول ولا محو للجلسة السليمة (انظر الوصف أعلاه). */
  const hold = (e: BackendError | null | undefined, mySeq: number) => {
    if (mySeq === seq) set({ phase: 'check_failed', busy: false, error: isNetworkError(e) ? 'network' : 'server_unavailable' })
  }

  /** يقيّم الجلسة الحالية من الصفر ويحدّد الحالة. كل فرع غير مصرَّح ينتهي برفض. */
  async function evaluate(): Promise<void> {
    const mySeq = ++seq
    set({ ...state, busy: true } as AuthState)
    try {
      const u = await client.auth.getUser()
      if (mySeq !== seq) return
      if (u.error || !u.data?.user) {
        if (u.error && !isSessionMissing(u.error)) {
          // عطل مؤقت لا يُسقط الجلسة المخزَّنة: ننتظر إعادة المحاولة. غير ذلك (401/403…): الجلسة باطلة فتُمحى محليًا.
          if (isTransientError(u.error)) return hold(u.error, mySeq)
          await quietSignOut()
          if (mySeq === seq) set(out('session_expired'))
          return
        }
        return set(out())
      }
      const userId = u.data.user.id

      const p = await client.from('staff_profiles').select('role,is_active').eq('user_id', userId).maybeSingle()
      if (mySeq !== seq) return
      if (p.error) {
        if (isTransientError(p.error)) return hold(p.error, mySeq)
        return await deny('profile_check_failed', mySeq)
      }
      const profile = p.data as { role?: unknown; is_active?: unknown } | null
      if (!profile || profile.is_active !== true || !isStaffRole(profile.role)) return await deny('not_staff', mySeq)
      const profileRole = profile.role

      // تأكيد الدور من الخادم (current_staff_role تشترط صفًا نشطًا للمستخدمة المصادَق عليها؛ لا دور ⇒ null ⇒ رفض).
      const r = await client.rpc('current_staff_role')
      if (mySeq !== seq) return
      if (r.error) {
        if (isTransientError(r.error)) return hold(r.error, mySeq)
        return await deny('role_mismatch', mySeq)
      }
      if (r.data !== profileRole) return await deny('role_mismatch', mySeq)
      return set({ phase: 'authorized', role: profileRole, userId, busy: false })
    } catch (e) {
      if (mySeq !== seq) return
      const thrown = { message: String((e as Error)?.message ?? e), name: (e as Error)?.name }
      if (isNetworkError(thrown)) return hold(thrown, mySeq)
      await deny('unknown', mySeq)
    }
  }

  const setBusy = (b: boolean) => set({ ...state, busy: b } as AuthState)

  return {
    getState: () => state,
    subscribe: (l) => { listeners.add(l); return () => { listeners.delete(l) } },

    async start() {
      if (started) return
      started = true
      const { data } = client.auth.onAuthStateChange((event) => {
        // لا استدعاء لواجهة المصادقة من داخل الـcallback مباشرة (تفادي تعليق معروف في supabase-js).
        if (event === 'SIGNED_OUT') {
          setTimeout(() => {
            // نتجاهل الخروج الصادر عن المتحكّم نفسه (الحالة signed_out أصلًا، وقد تحمل سبب الرفض).
            if (state.phase === 'signed_out' || state.phase === 'initializing') return
            const hadSession = state.phase === 'authorized' || state.phase === 'check_failed'
            seq++
            set(out(hadSession ? 'session_expired' : undefined))
          }, 0)
        }
      })
      unsub = () => data.subscription.unsubscribe()
      await evaluate()
    },
    dispose() { unsub?.(); unsub = null; started = false; seq++ },

    async signIn(email, password) {
      if (state.busy) return
      setBusy(true)
      try {
        const r = await client.auth.signInWithPassword({ email: email.trim(), password })
        if (r.error || !r.data?.user) {
          const code: AuthErrorCode = r.error && isNetworkError(r.error) ? 'network' : r.error?.status === 429 ? 'rate_limited' : 'invalid_credentials'
          return set(out(code))
        }
        await evaluate()
      } catch (e) {
        set(out(isNetworkError({ message: String((e as Error)?.message ?? e), name: (e as Error)?.name }) ? 'network' : 'unknown'))
      }
    },

    async signInWithTokens(accessToken, refreshToken) {
      if (state.busy) return
      setBusy(true)
      try {
        const r = client.auth.setSession ? await client.auth.setSession({ access_token: accessToken, refresh_token: refreshToken }) : null
        if (!r || r.error || !r.data?.user) return set(out('invalid_credentials'))
        await evaluate()
      } catch (e) {
        set(out(isNetworkError({ message: String((e as Error)?.message ?? e), name: (e as Error)?.name }) ? 'network' : 'unknown'))
      }
    },

    async retry() {
      if (state.phase !== 'check_failed' || state.busy) return
      await evaluate()
    },

    async signOut(scope = 'local') {
      seq++
      await quietSignOut(scope)
      set(out())
    },

    async getAccessToken() {
      try {
        const r = await client.auth.getSession?.()
        return r?.data?.session?.access_token ?? null
      } catch { return null }
    },
  }
}
