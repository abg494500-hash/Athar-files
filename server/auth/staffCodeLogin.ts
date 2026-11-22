// دخول الإدارة (المالكة/المديرة) من صندوق الدخول الموحَّد (r38، قرار صاحبة المشروع).
// لا يُكتب أي رمز أو كلمة مرور في الكود: الرمز المُدخَل هو كلمة مرور حساب Supabase الحقيقي، يجرّبها الخادم على البريدين المضبوطين
// في سر البيئة STAFF_LOGIN_EMAILS (بريدان مفصولان بفاصلة)، ويعيد جلسة Supabase فقط عند النجاح. لا يكشف أي سبب للفشل.
// يتقاسم حدّي التخمين (IP/عام) مع دخول المعلمات عبر جدول login_attempts.
import { AuthError } from './teacherAuth'
import type { LoginResult } from './teacherAuth'
import { hashIp } from './teacherCrypto'

export interface StaffLoginStore {
  now(): Promise<Date>
  logAttempt(teacherId: string | null, ipHash: string | null, result: LoginResult): Promise<void>
  countIpFailures(ipHash: string, windowMinutes: number): Promise<number>
  countRecentFailures(windowMinutes: number): Promise<number>
}
export interface StaffSession { accessToken: string; refreshToken: string }
export interface StaffLoginOptions {
  supabaseUrl: string; anonKey: string; emails: readonly string[]; ipPepper: Uint8Array
  ipMaxFailures?: number; ipWindowMinutes?: number; globalMaxFailures?: number; fetchImpl?: typeof fetch
}

export class StaffCodeLogin {
  private readonly o: Required<Omit<StaffLoginOptions, 'fetchImpl'>> & { fetchImpl: typeof fetch }
  private readonly store: StaffLoginStore
  constructor(store: StaffLoginStore, o: StaffLoginOptions) {
    this.store = store
    this.o = { ipMaxFailures: 20, ipWindowMinutes: 15, globalMaxFailures: 300, ...o, fetchImpl: o.fetchImpl ?? fetch }
  }

  async login(i: { code: unknown; ip?: unknown }): Promise<StaffSession> {
    const ipHash = hashIp(this.o.ipPepper, i.ip)
    const w = this.o.ipWindowMinutes
    const limited = (ipHash !== null && (await this.store.countIpFailures(ipHash, w)) >= this.o.ipMaxFailures) || (await this.store.countRecentFailures(w)) >= this.o.globalMaxFailures
    if (limited) { await this.store.logAttempt(null, ipHash, 'locked'); throw new AuthError('login_failed') }
    const code = typeof i.code === 'string' ? i.code : ''
    if (code.length < 1 || code.length > 128 || this.o.emails.length === 0) { await this.store.logAttempt(null, ipHash, 'unknown_code'); throw new AuthError('login_failed') }
    for (const email of this.o.emails) {
      try {
        const res = await this.o.fetchImpl(`${this.o.supabaseUrl.replace(/\/+$/, '')}/auth/v1/token?grant_type=password`, {
          method: 'POST', headers: { apikey: this.o.anonKey, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: code }),
        })
        if (!res.ok) continue
        const j = (await res.json()) as { access_token?: unknown; refresh_token?: unknown }
        if (typeof j.access_token === 'string' && typeof j.refresh_token === 'string') {
          await this.store.logAttempt(null, ipHash, 'success')
          return { accessToken: j.access_token, refreshToken: j.refresh_token }
        }
      } catch { /* تجاهل: يُعامل كفشل */ }
    }
    await this.store.logAttempt(null, ipHash, 'unknown_code')
    throw new AuthError('login_failed')
  }
}
