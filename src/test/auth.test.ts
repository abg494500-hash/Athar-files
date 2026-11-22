import { describe, it, expect } from 'vitest'
import { createAuthController, describeAuthError } from '../lib/auth/controller'
import { makeBackend } from './fakeBackend'

const staffOwner = { role: 'owner', is_active: true }

describe('مصادقة الإدارة: فشل مغلق (المرحلة 3)', () => {
  it('بلا جلسة: signed_out بلا خطأ', async () => {
    const c = createAuthController(makeBackend({ user: null }))
    await c.start()
    expect(c.getState().phase).toBe('signed_out')
    expect(c.getState().error).toBeUndefined()
  })

  it('كلمة مرور خاطئة: رسالة عامة وبلا انتقال', async () => {
    const b = makeBackend({ signInError: { message: 'Invalid login credentials', status: 400 } })
    const c = createAuthController(b)
    await c.start()
    await c.signIn('a@b.co', 'x')
    expect(c.getState().phase).toBe('signed_out')
    expect(c.getState().error).toBe('invalid_credentials')
    expect(b.calls.includes('query:staff_profiles')).toBe(false)
  })

  it('حساب سليم غير مسجَّل مسؤولًا: يُرفض ويُسجَّل خروجه', async () => {
    const b = makeBackend({ user: { id: 'u-x' }, profile: null })
    const c = createAuthController(b)
    await c.start()
    await c.signIn('x@y.co', 'pw')
    expect(c.getState().phase).toBe('signed_out')
    expect(c.getState().error).toBe('not_staff')
    expect(b.calls.includes('signOut')).toBe(true)
  })

  it('رسالة المستخدمة واحدة لكلمة المرور الخاطئة وللحساب غير المخوَّل', () => {
    expect(describeAuthError('not_staff')).toBe(describeAuthError('invalid_credentials'))
  })

  it('مسؤولة غير نشطة أو بدور غير معروف: رفض', async () => {
    for (const profile of [{ role: 'owner', is_active: false }, { role: 'admin', is_active: true }, { role: 'teacher', is_active: true }]) {
      const b = makeBackend({ user: { id: 'u' }, profile })
      const c = createAuthController(b)
      await c.start()
      expect(c.getState().phase).toBe('signed_out')
      expect(c.getState().error).toBe('not_staff')
    }
  })

  it('خطأ أثناء جلب الملف الشخصي: يُرفض (لا يُفترض أي دور)', async () => {
    const b = makeBackend({ user: { id: 'u' }, profileError: { message: 'permission denied', code: '42501' } })
    const c = createAuthController(b)
    await c.start()
    expect(c.getState().phase).toBe('signed_out')
    expect(c.getState().error).toBe('profile_check_failed')
    expect(b.calls.includes('signOut')).toBe(true)
  })

  it('خطأ شبكة أثناء الجلب: لا دخول لكن الجلسة تبقى (check_failed) ولا خروج', async () => {
    const b = makeBackend({ user: { id: 'u' }, profileError: { message: 'TypeError: Failed to fetch' } })
    const c = createAuthController(b)
    await c.start()
    expect(c.getState().phase).toBe('check_failed')
    expect(c.getState().error).toBe('network')
    expect(b.calls.includes('signOut')).toBe(false)
  })

  it('بريد مسجَّل + كلمة مرور صحيحة + صف نشط + دور مؤكَّد من الخادم: authorized بالدور الصحيح (بلا أي خطوة إضافية)', async () => {
    const b = makeBackend({ user: { id: 'u-7' }, profile: staffOwner, rpcRole: 'owner' })
    const c = createAuthController(b)
    await c.start()
    await c.signIn('owner@example.test', 'pw')
    const s = c.getState()
    expect(s.phase).toBe('authorized')
    if (s.phase === 'authorized') { expect(s.role).toBe('owner'); expect(s.userId).toBe('u-7') }
    expect(b.calls.includes('rpc:current_staff_role')).toBe(true)
  })

  it('A-98: لا توجد أي حالة أو استدعاء للتحقق الإضافي في أي مسار', async () => {
    const seen = new Set<string>()
    for (const o of [
      { user: { id: 'u' }, profile: staffOwner },
      { user: { id: 'u' }, profile: { role: 'director', is_active: true } },
      { user: { id: 'u' }, profile: null },
      { user: { id: 'u' }, profile: staffOwner, rpcRole: null },
    ] as Parameters<typeof makeBackend>[0][]) {
      const b = makeBackend(o)
      const c = createAuthController(b)
      c.subscribe(() => seen.add(c.getState().phase))
      await c.start()
      seen.add(c.getState().phase)
      expect(b.calls.some((x) => /mfa|enroll|verify|unenroll/i.test(x))).toBe(false)
    }
    expect([...seen].some((p) => p.startsWith('mfa'))).toBe(false)
    expect(Object.keys(createAuthController(makeBackend()))).not.toContain('submitTotp')
  })

  it('لا authorized قبل تأكيد الدور من الخادم، ولا جلب بيانات قبله', async () => {
    const b = makeBackend({ user: { id: 'u' }, profile: staffOwner, rpcRole: 'owner' })
    const c = createAuthController(b)
    await c.start()
    const iRole = b.calls.indexOf('rpc:current_staff_role')
    expect(iRole).toBeGreaterThan(-1)
    expect(b.calls.slice(0, iRole).some((x) => x === 'query:teachers')).toBe(false)
  })

  it('تعارض الدور بين الصف والخادم: رفض وخروج', async () => {
    const b = makeBackend({ user: { id: 'u' }, profile: staffOwner, rpcRole: 'director' })
    const c = createAuthController(b)
    await c.start()
    expect(c.getState().phase).toBe('signed_out')
    expect(c.getState().error).toBe('role_mismatch')
    expect(b.calls.includes('signOut')).toBe(true)
  })

  it('الخادم لا يُرجع دورًا (null): رفض وخروج', async () => {
    const b = makeBackend({ user: { id: 'u' }, profile: staffOwner, rpcRole: null })
    const c = createAuthController(b)
    await c.start()
    expect(c.getState().phase).toBe('signed_out')
    expect(c.getState().error).toBe('role_mismatch')
  })

  it('مديرة بدور متطابق: authorized كمديرة', async () => {
    const b = makeBackend({ user: { id: 'u-d' }, profile: { role: 'director', is_active: true } })
    const c = createAuthController(b)
    await c.start()
    const s = c.getState()
    expect(s.phase).toBe('authorized')
    if (s.phase === 'authorized') expect(s.role).toBe('director')
  })

  it('انتهاء الجلسة أثناء الدخول (SIGNED_OUT): العودة إلى signed_out مع سبب', async () => {
    const b = makeBackend({ user: { id: 'u' }, profile: staffOwner })
    const c = createAuthController(b)
    await c.start()
    expect(c.getState().phase).toBe('authorized')
    b.emit('SIGNED_OUT')
    await new Promise((r) => setTimeout(r, 5))
    expect(c.getState().phase).toBe('signed_out')
    expect(c.getState().error).toBe('session_expired')
  })

  it('خروج المتحكّم بسبب رفض لا يمحو سبب الرفض', async () => {
    const b = makeBackend({ user: { id: 'u' }, profile: null })
    const c = createAuthController(b)
    await c.start()
    b.emit('SIGNED_OUT')
    await new Promise((r) => setTimeout(r, 5))
    expect(c.getState().error).toBe('not_staff')
  })

  it('signOut ينهي الجلسة', async () => {
    const b = makeBackend({ user: { id: 'u' }, profile: staffOwner })
    const c = createAuthController(b)
    await c.start()
    await c.signOut()
    expect(c.getState().phase).toBe('signed_out')
    expect(b.calls.includes('signOut')).toBe(true)
  })
})


describe('استمرار الجلسة الآمن (0.6.3، A-93): لا محو لجلسة سليمة عند عطل مؤقت، ولا تجاوز لأي شرط', () => {
  it('الخروج الاعتيادي يستعمل scope=local (لا يُسقط جلسات الأجهزة الأخرى)', async () => {
    const b = makeBackend({ user: { id: 'u' }, profile: staffOwner })
    const c = createAuthController(b)
    await c.start()
    await c.signOut()
    expect(b.signOutScopes).toEqual(['local'])
  })

  it('الخروج من كل الأجهزة متاح صراحةً فقط (global)', async () => {
    const b = makeBackend({ user: { id: 'u' }, profile: staffOwner })
    const c = createAuthController(b)
    await c.start()
    await c.signOut('global')
    expect(b.signOutScopes).toEqual(['global'])
  })

  it('الرفض القاطع يخرج محليًا فقط', async () => {
    const b = makeBackend({ user: { id: 'u' }, profile: null })
    const c = createAuthController(b)
    await c.start()
    expect(c.getState().error).toBe('not_staff')
    expect(b.signOutScopes).toEqual(['local'])
  })

  for (const [name, e] of [['503', { message: 'unavailable', status: 503 }], ['429', { message: 'too many', status: 429 }], ['408', { message: 'timeout', status: 408 }]] as const) {
    it(`عطل مؤقت ${name} في جلب الملف الشخصي: check_failed، لا خروج، ثم retry يكمل دون كلمة مرور`, async () => {
      const o = { user: { id: 'u' }, profile: staffOwner, profileError: e } as Parameters<typeof makeBackend>[0]
      const b = makeBackend(o)
      const c = createAuthController(b)
      await c.start()
      expect(c.getState().phase).toBe('check_failed')
      expect(c.getState().error).toBe('server_unavailable')
      expect(b.calls.includes('signOut')).toBe(false)
      delete o!.profileError
      await c.retry()
      expect(c.getState().phase).toBe('authorized')
      expect(b.calls.includes('signIn')).toBe(false)
    })
  }

  it('خطأ قاعدة بيانات غير مؤقت (42501) ما زال رفضًا مع خروج محلي', async () => {
    const b = makeBackend({ user: { id: 'u' }, profileError: { message: 'permission denied', code: '42501', status: 403 } })
    const c = createAuthController(b)
    await c.start()
    expect(c.getState().phase).toBe('signed_out')
    expect(c.getState().error).toBe('profile_check_failed')
    expect(b.signOutScopes).toEqual(['local'])
  })

  it('عطل مؤقت عند تأكيد الدور: check_failed بلا خروج', async () => {
    const cases: Parameters<typeof makeBackend>[0][] = [
      { user: { id: 'u' }, profile: staffOwner, rpcError: { message: 'x', status: 502 } },
      { user: { id: 'u' }, profile: staffOwner, rpcError: { message: 'Failed to fetch' } },
    ]
    for (const o of cases) {
      const b = makeBackend(o)
      const c = createAuthController(b)
      await c.start()
      expect(c.getState().phase).toBe('check_failed')
      expect(b.calls.includes('signOut')).toBe(false)
    }
  })

  it('check_failed لا يمنح دخولًا أبدًا: لا authorized ولا جلب بيانات', async () => {
    const b = makeBackend({ user: { id: 'u' }, profile: staffOwner, rpcError: { message: 'x', status: 500 } })
    const c = createAuthController(b)
    await c.start()
    expect(c.getState().phase).not.toBe('authorized')
    expect(b.calls.includes('query:teachers')).toBe(false)
  })

  it('retry بعد عطل في تأكيد الدور: لا يتجاوز التأكيد — null من الخادم يعني رفضًا لا دخولًا', async () => {
    const o = { user: { id: 'u' }, profile: staffOwner, rpcError: { message: 'x', status: 503 } } as Parameters<typeof makeBackend>[0]
    const b = makeBackend(o)
    const c = createAuthController(b)
    await c.start()
    expect(c.getState().phase).toBe('check_failed')
    delete o!.rpcError
    o!.rpcRole = null
    await c.retry()
    expect(c.getState().phase).toBe('signed_out')
    expect(c.getState().error).toBe('role_mismatch')
  })

  it('جلسة باطلة فعلًا (401): تُمحى محليًا ويُطلب دخول جديد', async () => {
    const b = makeBackend({ user: { id: 'u' }, getUserError: { message: 'invalid JWT', status: 401 } })
    const c = createAuthController(b)
    await c.start()
    expect(c.getState().phase).toBe('signed_out')
    expect(c.getState().error).toBe('session_expired')
    expect(b.signOutScopes).toEqual(['local'])
  })

  it('getUser بعطل خادم مؤقت: تبقى الجلسة (check_failed)', async () => {
    const b = makeBackend({ user: { id: 'u' }, getUserError: { message: 'oops', status: 500 } })
    const c = createAuthController(b)
    await c.start()
    expect(c.getState().phase).toBe('check_failed')
    expect(b.calls.includes('signOut')).toBe(false)
  })

  it('SIGNED_OUT أثناء check_failed (خروج من تبويب آخر): العودة إلى signed_out مع سبب', async () => {
    const b = makeBackend({ user: { id: 'u' }, profileError: { message: 'x', status: 503 } })
    const c = createAuthController(b)
    await c.start()
    b.emit('SIGNED_OUT')
    await new Promise((r) => setTimeout(r, 5))
    expect(c.getState().phase).toBe('signed_out')
    expect(c.getState().error).toBe('session_expired')
  })

  it('retry خارج حالة check_failed لا يفعل شيئًا', async () => {
    const b = makeBackend({ user: { id: 'u' }, profile: staffOwner })
    const c = createAuthController(b)
    await c.start()
    const before = b.calls.length
    await c.retry()
    expect(b.calls.length).toBe(before)
  })
})
