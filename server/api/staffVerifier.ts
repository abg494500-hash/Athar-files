// التحقق الخادمي من هوية المالكة/المديرة (الدفعة 6). **لا يثق بأي ادعاء من العميل**: يتحقق من رمز Supabase Auth عند خدمة المصادقة نفسها،
// ثم يقرأ الدور من staff_profiles بمفتاح الخدمة (صف نشط فقط). أي فشل أو التباس ⇒ null (رفض مغلق).
// **الحالة:** اختُبر هنا بـ fetch وقاعدة بديلين فقط (لا Supabase حقيقي ولا PostgreSQL)؛ لم يُجرَّب على خدمة حقيقية.
import type { Db } from '../db/types'

export type StaffRole = 'owner' | 'director'
export interface StaffIdentity { userId: string; role: StaffRole }

export interface StaffVerifier {
  /** يعيد الهوية والدور أو null إن لم يثبت أنها مسؤولة نشطة. لا يرمي أبدًا لأسباب تخص الرمز. */
  verify(bearerToken: string): Promise<StaffIdentity | null>
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// JWT: ثلاثة أجزاء base64url. نرفض الأشكال الغريبة قبل أي طلب شبكة (ولا نُرسل نصًا عشوائيًا للخدمة).
const JWT_RE = /^[A-Za-z0-9_-]{10,4096}\.[A-Za-z0-9_-]{5,4096}\.[A-Za-z0-9_-]{5,4096}$/

export interface SupabaseStaffVerifierOptions {
  /** عنوان مشروع Supabase (https://xxxx.supabase.co). يُحقن من البيئة؛ لا قيمة حقيقية في الحزمة. */
  supabaseUrl: string
  /** المفتاح العام (anon) الذي تطلبه خدمة المصادقة في ترويسة apikey. ليس سرًّا لكن لا يُكتب في الحزمة. */
  anonKey: string
  /** قاعدة بدور خدمة لقراءة staff_profiles. */
  db: Db
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export class SupabaseStaffVerifier implements StaffVerifier {
  private readonly url: string
  private readonly anonKey: string
  private readonly db: Db
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number

  constructor(o: SupabaseStaffVerifierOptions) {
    let u: URL
    try { u = new URL(o.supabaseUrl) } catch { throw new Error('supabaseUrl غير صالح') }
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1'))) throw new Error('supabaseUrl يجب أن يكون https')
    if (typeof o.anonKey !== 'string' || o.anonKey.length < 10) throw new Error('anonKey غير مهيّأ')
    this.url = `${u.origin}/auth/v1/user`
    this.anonKey = o.anonKey
    this.db = o.db
    this.fetchImpl = o.fetchImpl ?? fetch
    this.timeoutMs = o.timeoutMs ?? 5000
  }

  async verify(bearerToken: string): Promise<StaffIdentity | null> {
    if (typeof bearerToken !== 'string' || !JWT_RE.test(bearerToken)) return null
    try {
      const res = await this.fetchImpl(this.url, {
        method: 'GET',
        headers: { authorization: `Bearer ${bearerToken}`, apikey: this.anonKey },
        signal: AbortSignal.timeout(this.timeoutMs),
      })
      if (res.status !== 200) return null
      const j = (await res.json()) as { id?: unknown }
      if (typeof j?.id !== 'string' || !UUID_RE.test(j.id)) return null
      const rows = await this.db.transaction((c) => c.query<{ role: string }>('select role from public.staff_profiles where user_id = $1 and is_active', [j.id]))
      const role = rows[0]?.role
      if (rows.length !== 1 || (role !== 'owner' && role !== 'director')) return null
      return { userId: j.id, role }
    } catch {
      return null // شبكة/مهلة/قاعدة: لا دخول (لا نفرّق بين الأسباب أمام المتصل)
    }
  }
}
