import { describe, it, expect } from 'vitest'
import { createAuthController, describeAuthError } from '../lib/auth/controller'
import { makeBackend } from './fakeBackend'

/**
 * بوابة ما قبل النشر (0.6.4): سيناريوهات الدخول الحدّية. كلها بعميل وهمي بلا شبكة:
 * **ليست دليلًا على نجاح الاتصال الحقيقي بـSupabase**، بل على سلوك الواجهة تجاه ما يُرجعه الخادم.
 */
const owner = { role: 'owner', is_active: true }

describe('الدخول: حالات حدّية (عميل وهمي)', () => {
  it('حدّ المحاولات 429 عند كلمة المرور: رسالة انتظار، بلا استعلام عن الملف الشخصي', async () => {
    const b = makeBackend({ signInError: { message: 'rate limit', status: 429 } })
    const c = createAuthController(b)
    await c.start()
    await c.signIn('a@b.co', 'x')
    expect(c.getState().error).toBe('rate_limited')
    expect(b.calls.includes('query:staff_profiles')).toBe(false)
  })

  it('انقطاع الشبكة أثناء الدخول: رسالة اتصال لا «بيانات خاطئة»', async () => {
    const b = makeBackend({ signInError: { message: 'TypeError: Failed to fetch' } })
    const c = createAuthController(b)
    await c.start()
    await c.signIn('a@b.co', 'x')
    expect(c.getState().error).toBe('network')
  })

  it('كلمة صحيحة لكن الخادم لا يؤكد الدور: لا authorized في أي مرحلة وسيطة', async () => {
    const seen: string[] = []
    const b = makeBackend({ user: { id: 'u' }, profile: owner, rpcRole: null })
    const c = createAuthController(b)
    c.subscribe(() => seen.push(c.getState().phase))
    await c.start()
    await c.signIn('a@b.co', 'pw')
    expect(seen.includes('authorized')).toBe(false)
    expect(c.getState().phase).toBe('signed_out')
  })

  it('رسالة الحساب غير المخوَّل لا تكشف وجود الحساب، ولا تذكر كلمة «غير مصرَّح»', () => {
    const m = describeAuthError('not_staff') ?? ''
    expect(m).toBe(describeAuthError('invalid_credentials'))
    expect(m).not.toMatch(/غير مصرح|غير مسجل/)
  })

  it('خروج الجلسة بعد الدخول لا يترك حالة authorized', async () => {
    const b = makeBackend({ user: { id: 'u' }, profile: owner })
    const c = createAuthController(b)
    await c.start()
    expect(c.getState().phase).toBe('authorized')
    await c.signOut()
    expect(c.getState().phase).toBe('signed_out')
  })
})
