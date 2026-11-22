/**
 * أدنى واجهة بنيوية من عميل Supabase تستعملها طبقتا المصادقة والبيانات (المرحلة 3).
 * الغرض: أن لا يستورد أي ملف مكتبة `@supabase/supabase-js` سوى `src/lib/supabase/client.ts`،
 * فتُختبر الطبقتان بعميل وهمي دون شبكة، ويبقى سطح الاستعمال صغيرًا ومراجَعًا.
 * (الشكل مطابق لواجهة supabase-js v2؛ التحويل الوحيد في client.ts.)
 */

export interface BackendError {
  message: string
  name?: string
  code?: string
  status?: number
}
export interface BackendResult<T> { data: T | null; error: BackendError | null }

/** باني استعلام PostgREST المبسّط: قابل للانتظار، ويُرجع صفوفًا. */
export interface Query extends PromiseLike<BackendResult<Record<string, unknown>[]>> {
  select(columns: string): Query
  insert(values: Record<string, unknown> | Record<string, unknown>[]): Query
  update(values: Record<string, unknown>): Query
  eq(column: string, value: unknown): Query
  order(column: string, opts?: { ascending?: boolean }): Query
  range(from: number, to: number): Query
  maybeSingle(): PromiseLike<BackendResult<Record<string, unknown>>>
  single(): PromiseLike<BackendResult<Record<string, unknown>>>
}

export interface UserLike { id: string }

export type AuthEvent = 'INITIAL_SESSION' | 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED' | 'USER_UPDATED' | 'PASSWORD_RECOVERY'

export interface BackendClient {
  auth: {
    getUser(): Promise<BackendResult<{ user: UserLike | null }>>
    /** اختياري: الجلسة الحالية لإرسال رمز الوصول إلى الواجهة الخادمية (لا يُخزَّن). */
    getSession?(): Promise<BackendResult<{ session: { access_token: string } | null }>>
    /** اختياري: تثبيت جلسة حصل عليها الخادم من الصندوق الموحَّد (r38). */
    setSession?(t: { access_token: string; refresh_token: string }): Promise<BackendResult<{ user: UserLike | null }>>
    signInWithPassword(c: { email: string; password: string }): Promise<BackendResult<{ user: UserLike | null }>>
    /** scope: local = هذا الجهاز فقط، global = كل الأجهزة (الافتراضي في المكتبة). */
    signOut(opts?: { scope?: 'local' | 'global' | 'others' }): Promise<{ error: BackendError | null }>
    onAuthStateChange(cb: (event: AuthEvent) => void): { data: { subscription: { unsubscribe(): void } } }
  }
  from(table: string): Query
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<BackendResult<unknown>>
}
