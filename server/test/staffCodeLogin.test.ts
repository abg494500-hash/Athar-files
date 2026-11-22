// @vitest-environment node
// الصندوق الموحَّد (r38): رمز معلمة ⇒ معلمة؛ غيره ⇒ تجربة ككلمة مرور على بريدي الإدارة؛ فشل موحّد وحدّا التخمين. Supabase وهمي (لا شبكة).
import { describe, it, expect } from 'vitest'
import { randomBytes } from 'node:crypto'
import { StaffCodeLogin } from '../auth/staffCodeLogin'
import { AuthError } from '../auth/teacherAuth'
import { MemoryAuthStore } from './helpers/memoryAuthStore'

const PASS = 'test-only-passphrase-not-real'
function mk(over: Record<string, unknown> = {}, emails = ['o@example.invalid', 'd@example.invalid']) {
  const store = new MemoryAuthStore()
  const calls: { email: string }[] = []
  const fetchImpl = (async (_u: string, i: RequestInit) => {
    const b = JSON.parse(String(i.body)) as { email: string; password: string }
    calls.push({ email: b.email })
    return b.email === 'd@example.invalid' && b.password === PASS ? new Response(JSON.stringify({ access_token: 'AT', refresh_token: 'RT' }), { status: 200 }) : new Response('{}', { status: 400 })
  }) as unknown as typeof fetch
  const svc = new StaffCodeLogin(store, { supabaseUrl: 'https://p.example.co', anonKey: 'anon-key-placeholder', emails, ipPepper: randomBytes(32), fetchImpl, ...over })
  return { store, svc, calls }
}
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return e instanceof AuthError } return false }

describe('StaffCodeLogin', () => {
  it('الرمز الصحيح يجرَّب على البريدين ويعيد جلسة Supabase فقط', async () => {
    const { svc, calls, store } = mk()
    expect(await svc.login({ code: PASS, ip: '203.0.113.1' })).toEqual({ accessToken: 'AT', refreshToken: 'RT' })
    expect(calls.map((c) => c.email)).toEqual(['o@example.invalid', 'd@example.invalid'])
    expect(store.attempts.at(-1)!.result).toBe('success')
  })
  it('رمز خاطئ/فارغ/طويل/غير نصي ⇒ فشل موحّد وتُسجَّل محاولة فاشلة', async () => {
    const { svc, store } = mk()
    for (const code of ['wrong', '', 'x'.repeat(200), 5, null]) expect(await fails(svc.login({ code }))).toBe(true)
    expect(store.attempts.every((a) => a.result === 'unknown_code')).toBe(true)
  })
  it('بلا بريدين مضبوطين ⇒ لا دخول ولا نداء شبكة', async () => {
    const { svc, calls } = mk({}, [])
    expect(await fails(svc.login({ code: PASS }))).toBe(true); expect(calls).toHaveLength(0)
  })
  it('حدّ العنوان: بعد 20 إخفاقًا يُرفض حتى الرمز الصحيح دون نداء Supabase', async () => {
    const { svc, calls } = mk()
    for (let i = 0; i < 20; i++) await fails(svc.login({ code: 'bad', ip: '203.0.113.9' }))
    const n = calls.length
    expect(await fails(svc.login({ code: PASS, ip: '203.0.113.9' }))).toBe(true)
    expect(calls.length).toBe(n)
  })
  it('انقطاع الشبكة يُعامل كفشل لا كخطأ', async () => {
    const { svc } = mk({ fetchImpl: (async () => { throw new Error('net') }) as unknown as typeof fetch })
    expect(await fails(svc.login({ code: PASS }))).toBe(true)
  })
})
