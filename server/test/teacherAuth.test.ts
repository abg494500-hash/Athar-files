// @vitest-environment node
// دخول المعلمة برمز واحد (A-122، r37): حرفان من الاسم + رقمان (SA-12) بلا رقم سري، مع حد لكل عنوان وحد عام ضد التخمين.
import { describe, it, expect } from 'vitest'
import { randomBytes } from 'node:crypto'
import { AuthError, TeacherAuthService } from '../auth/teacherAuth'
import { generateNameCode, generateToken, hashCode, hashIp, hashToken, isTokenShape, namePrefix, normalizeCode } from '../auth/teacherCrypto'
import { MemoryAuthStore } from './helpers/memoryAuthStore'

const T1 = '00000000-0000-0000-0000-000000000001'
const T2 = '00000000-0000-0000-0000-000000000002'
const T3 = '00000000-0000-0000-0000-000000000003'

function setup(over: Record<string, unknown> = {}) {
  const store = new MemoryAuthStore()
  store.addTeacher(T1, 'معلمة أولى')
  store.addTeacher(T2, 'معلمة ثانية')
  const peppers = { code: randomBytes(32), ip: randomBytes(32) }
  const svc = new TeacherAuthService(store, { codePepper: peppers.code, ipPepper: peppers.ip, ...over })
  return { store, svc, peppers }
}
async function errOf(p: Promise<unknown>): Promise<AuthError | null> {
  try { await p } catch (e) { return e as AuthError }
  return null
}

describe('صيغة الرمز: حرفان من الاسم + رقمان (مثل SA-12)', () => {
  it('بادئة الاسم: عربي ولاتيني وتشكيل وفراغات وناقص', () => {
    expect(namePrefix('سارة')).toBe('SA')
    expect(namePrefix('تهاني')).toBe('TH')
    expect(namePrefix('غادة')).toBe('GA')
    expect(namePrefix('  أمل')).toBe('AM')
    expect(namePrefix('Sarah')).toBe('SA')
    expect(namePrefix('د. نور')).toBe('DN')
    expect(namePrefix('م')).toBe('MX')
    expect(namePrefix('')).toBe('XX')
    expect(namePrefix(null)).toBe('XX')
    expect(namePrefix('١٢٣')).toBe('XX')
  })
  it('الصيغة XX-NN فقط: رقمان بالضبط وأرقام عشوائية متنوعة', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 400; i++) { const c = generateNameCode('سارة'); expect(c).toMatch(/^SA-[0-9]{2}$/); seen.add(c) }
    expect(seen.size).toBeGreaterThan(60)
  })
  it('التطبيع: حالة الأحرف والشرطة والمسافة والأرقام الهندية، ويرفض كل ما سواها (بما فيه الصيغ القديمة الأطول)', () => {
    expect(normalizeCode('SA-12')).toBe('SA12')
    expect(normalizeCode(' sa 12 ')).toBe('SA12')
    expect(normalizeCode('sa١٢')).toBe('SA12')
    for (const bad of ['SA-1', 'SA-123', 'S-12', 'SAA-12', '12-34', 'سا-12', 'ABCD-EFGH-JKMN', 'SA-482', '', 'A'.repeat(100)]) expect(normalizeCode(bad)).toBeNull()
    for (const bad of [null, undefined, 5, {}, ['SA12']]) expect(normalizeCode(bad)).toBeNull()
  })
  it('hashCode حتمي ويعتمد السر، ويرفض سرًّا قصيرًا', () => {
    const a = randomBytes(32); const b = randomBytes(32)
    expect(hashCode(a, 'SA12')).toBe(hashCode(a, 'SA12'))
    expect(hashCode(a, 'SA12')).not.toBe(hashCode(b, 'SA12'))
    expect(hashCode(a, 'SA12')).toMatch(/^[0-9a-f]{64}$/)
    expect(() => hashCode(randomBytes(31), 'X')).toThrow()
  })
  it('الرمز المميز للجلسة: 43 محرفًا base64url، فريد، وبصمته SHA-256', () => {
    const t = generateToken()
    expect(isTokenShape(t)).toBe(true)
    expect(new Set(Array.from({ length: 1000 }, generateToken)).size).toBe(1000)
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/)
    for (const bad of ['', 'a', t + 'a', t.slice(1), `${t.slice(1)}!`, null, 5]) expect(isTokenShape(bad)).toBe(false)
  })
  it('العنوان: HMAC، وفارغ/مجهول ⇒ null، ولا IP خام في الناتج', () => {
    const pep = randomBytes(32)
    expect(hashIp(pep, '203.0.113.9')).toMatch(/^[0-9a-f]{64}$/)
    expect(hashIp(pep, '203.0.113.9')).not.toBe(hashIp(randomBytes(32), '203.0.113.9'))
    for (const bad of ['', undefined, null, 5, 'x'.repeat(65)]) expect(hashIp(pep, bad)).toBeNull()
  })
})

describe('الإعداد', () => {
  it('يرفض أسرارًا قصيرة أو متطابقة أو إعدادًا غير صالح', () => {
    const store = new MemoryAuthStore()
    const a = randomBytes(32)
    expect(() => new TeacherAuthService(store, { codePepper: randomBytes(16), ipPepper: randomBytes(32) })).toThrow()
    expect(() => new TeacherAuthService(store, { codePepper: a, ipPepper: a })).toThrow()
    expect(() => new TeacherAuthService(store, { codePepper: a, ipPepper: randomBytes(32), sessionIdleMinutes: 0 })).toThrow()
    expect(() => new TeacherAuthService(store, { codePepper: a, ipPepper: randomBytes(32), globalMaxFailures: 0 })).toThrow()
  })
})

describe('الإصدار والدخول برمز واحد', () => {
  it('الإصدار يعطي رمزًا من الاسم بلا أي رقم سري، والدخول بالرمز وحده ينجح بصيغ مختلفة', async () => {
    const { svc } = setup()
    const a = await svc.issueCredentials(T1)
    expect(Object.keys(a)).toEqual(['code'])
    expect(a.code).toMatch(/^MA-[0-9]{2}$/) // «معلمة أولى» ⇒ م ع
    expect((await svc.login({ code: a.code })).teacher.id).toBe(T1)
    expect((await svc.login({ code: a.code.toLowerCase().replace('-', ' ') })).teacher.id).toBe(T1)
  })
  it('معلمتان بالبادئة نفسها ⇒ رمزان مختلفان، وكلٌّ يدخل لملفها', async () => {
    const { svc } = setup()
    const a = await svc.issueCredentials(T1)
    const b = await svc.issueCredentials(T2)
    expect(a.code.slice(0, 2)).toBe(b.code.slice(0, 2))
    expect(a.code).not.toBe(b.code)
    expect((await svc.login({ code: a.code })).teacher.id).toBe(T1)
    expect((await svc.login({ code: b.code })).teacher.id).toBe(T2)
  })
  it('الرمز يعمل في authenticate ولا يُخزَّن إلا بصمته؛ والسجل لا يحوي الرمز', async () => {
    const { store, svc } = setup()
    const { code } = await svc.issueCredentials(T1)
    const r = await svc.login({ code, ip: '198.51.100.7' })
    expect(await svc.authenticate(r.token)).toEqual({ teacherId: T1, name: 'معلمة أولى' })
    expect(store.sessions.has(r.token)).toBe(false)
    expect(store.sessions.has(hashToken(r.token))).toBe(true)
    const dump = JSON.stringify([...store.creds.values()]) + JSON.stringify(store.attempts)
    expect(dump.includes(code)).toBe(false)
    expect(dump.includes(code.replace('-', ''))).toBe(false)
    expect(dump.includes('198.51.100.7')).toBe(false)
  })
  it('معلمة غير موجودة ⇒ خطأ صريح عند الإصدار (لا رمز)', async () => {
    const { svc } = setup()
    const e = await errOf(svc.issueCredentials(T3))
    expect((e as unknown as { code: string }).code).toBe('teacher_not_found')
  })
  it('كل أسباب الرفض تعيد الخطأ نفسه ولا تكشف السبب؛ والسجل يميّزها داخليًا', async () => {
    const { store, svc } = setup()
    store.addTeacher(T3, 'معطّلة', false)
    const a = await svc.issueCredentials(T1)
    const b = await svc.issueCredentials(T2)
    const c = await svc.issueCredentials(T3)
    await svc.revokeCredentials(T2)
    const cases: [string, unknown][] = [
      ['رمز مجهول', 'ZZ-99'], ['رمز مشوّه', 'x'], ['ملغى', b.code], ['معلمة معطّلة', c.code], ['أنواع خاطئة', { x: 1 }], ['صيغة قديمة', 'SA-482'],
    ]
    const msgs = new Set<string>()
    for (const [name, code] of cases) {
      const e = await errOf(svc.login({ code }))
      expect(`${name}:${e instanceof AuthError ? e.code : 'other'}`).toBe(`${name}:login_failed`)
      msgs.add(e!.message)
    }
    expect(msgs.size).toBe(1)
    await svc.login({ code: a.code })
    expect(store.attempts.map((x) => x.result)).toEqual(['unknown_code', 'unknown_code', 'wrong_code', 'wrong_code', 'unknown_code', 'unknown_code', 'success'])
  })
  it('رمز منتهي الصلاحية يُرفض بعد انتهائه ولا قبل ذلك', async () => {
    const { store, svc } = setup()
    const a = await svc.issueCredentials(T1, { codeExpiresAt: new Date(store.clock.getTime() + 60_000) })
    await svc.login({ code: a.code })
    store.advance(2)
    expect((await errOf(svc.login({ code: a.code })))!.code).toBe('login_failed')
  })
  it('إعادة الإصدار تُبطل الرمز القديم والجلسات القديمة', async () => {
    const { svc } = setup()
    const a = await svc.issueCredentials(T1)
    const s = await svc.login({ code: a.code })
    const b = await svc.issueCredentials(T1)
    expect(b.code).not.toBe(a.code)
    expect((await errOf(svc.authenticate(s.token)))!.code).toBe('unauthenticated')
    expect((await errOf(svc.login({ code: a.code })))!.code).toBe('login_failed')
    await svc.login({ code: b.code })
  })
  it('تصادم الرمز يُعاد بتوليد جديد، وعند الاستنفاد يفشل صراحة بلا حفظ', async () => {
    const { store, svc } = setup()
    store.collideNext = 2
    await svc.issueCredentials(T1)
    store.collideNext = 100
    expect(await errOf(svc.issueCredentials(T2))).not.toBeNull()
    expect(store.creds.has(T2)).toBe(false)
  })
  it('revokeCredentials: لا دخول بالرمز ولا بالجلسات القائمة', async () => {
    const { svc } = setup()
    const a = await svc.issueCredentials(T1)
    const s = await svc.login({ code: a.code })
    await svc.revokeCredentials(T1)
    expect((await errOf(svc.authenticate(s.token)))!.code).toBe('unauthenticated')
    expect((await errOf(svc.login({ code: a.code })))!.code).toBe('login_failed')
  })
})

describe('الحماية من التخمين (فضاء الرمز صغير)', () => {
  it('بعد 20 إخفاقًا من عنوان يُرفض حتى الرمز الصحيح منه، وعنوان آخر لا يتأثر', async () => {
    const { store, svc } = setup()
    const a = await svc.issueCredentials(T1)
    for (let i = 0; i < 20; i++) await errOf(svc.login({ code: 'ZZ-99', ip: '203.0.113.1' }))
    expect((await errOf(svc.login({ code: a.code, ip: '203.0.113.1' })))!.code).toBe('login_failed')
    expect(store.attempts.at(-1)!.result).toBe('locked')
    expect(store.attempts.at(-1)!.teacherId).toBeNull()
    await svc.login({ code: a.code, ip: '203.0.113.2' })
  })
  it('النافذة تنتهي فيُسمح من جديد؛ ومحاولات locked لا تمدّد التقييد', async () => {
    const { store, svc } = setup()
    const a = await svc.issueCredentials(T1)
    for (let i = 0; i < 20; i++) await errOf(svc.login({ code: 'ZZ-99', ip: '203.0.113.1' }))
    for (let i = 0; i < 5; i++) await errOf(svc.login({ code: a.code, ip: '203.0.113.1' }))
    store.advance(16)
    await svc.login({ code: a.code, ip: '203.0.113.1' })
  })
  it('الحد العام: تخمين موزَّع على عناوين كثيرة يوقف الدخول مؤقتًا للجميع ثم يُفكّ بانتهاء النافذة', async () => {
    const { store, svc } = setup({ globalMaxFailures: 30 })
    const a = await svc.issueCredentials(T1)
    for (let i = 0; i < 30; i++) await errOf(svc.login({ code: 'ZZ-99', ip: `198.51.100.${i}` }))
    expect((await errOf(svc.login({ code: a.code, ip: '192.0.2.1' })))!.code).toBe('login_failed')
    expect(store.attempts.at(-1)!.result).toBe('locked')
    store.advance(16)
    await svc.login({ code: a.code, ip: '192.0.2.1' })
  })
  it('محاولات الدخول الناجحة لا تُحتسب إخفاقًا', async () => {
    const { svc } = setup({ globalMaxFailures: 5 })
    const a = await svc.issueCredentials(T1)
    for (let i = 0; i < 20; i++) await svc.login({ code: a.code })
  })
  it('لا يُخزَّن أي عنوان خام', async () => {
    const { store, svc } = setup()
    await errOf(svc.login({ code: 'ZZ-99', ip: '203.0.113.77' }))
    expect(JSON.stringify(store.attempts).includes('203.0.113.77')).toBe(false)
  })
})

describe('الجلسات', () => {
  it('انتهاء مطلق بعد 8 ساعات رغم النشاط', async () => {
    const { store, svc } = setup()
    const a = await svc.issueCredentials(T1)
    const { token } = await svc.login({ code: a.code })
    for (let i = 0; i < 16; i++) { store.advance(29); await svc.authenticate(token) }
    store.advance(29)
    expect((await errOf(svc.authenticate(token)))!.code).toBe('unauthenticated')
  })
  it('خمول 30 دقيقة ينهي الجلسة، والنشاط قبله يمدّد الخمول', async () => {
    const { store, svc } = setup()
    const a = await svc.issueCredentials(T1)
    const { token } = await svc.login({ code: a.code })
    store.advance(29); await svc.authenticate(token)
    store.advance(29); await svc.authenticate(token)
    store.advance(30)
    expect((await errOf(svc.authenticate(token)))!.code).toBe('unauthenticated')
  })
  it('الخروج يلغي الجلسة؛ رمز مجهول أو مشوّه مرفوض', async () => {
    const { svc } = setup()
    const a = await svc.issueCredentials(T1)
    const { token } = await svc.login({ code: a.code })
    await svc.logout(token)
    expect((await errOf(svc.authenticate(token)))!.code).toBe('unauthenticated')
    for (const bad of [generateToken(), 'x', '', null, undefined, 5, {}]) expect((await errOf(svc.authenticate(bad)))!.code).toBe('unauthenticated')
    await svc.logout('garbage')
  })
  it('تعطيل المعلمة يُسقط جلساتها فورًا؛ وجلسة معلمة لا تعطي هوية أخرى', async () => {
    const { store, svc } = setup()
    const a = await svc.issueCredentials(T1)
    const b = await svc.issueCredentials(T2)
    const ta = await svc.login({ code: a.code })
    const tb = await svc.login({ code: b.code })
    expect((await svc.authenticate(ta.token)).teacherId).toBe(T1)
    expect((await svc.authenticate(tb.token)).teacherId).toBe(T2)
    store.teachers.get(T1)!.isActive = false
    expect((await errOf(svc.authenticate(ta.token)))!.code).toBe('unauthenticated')
  })
})

describe('assertPepper — النوع والطول منفصلان', () => {
  it('32 بايتًا تُقبل؛ 31 تُرفض برسالة الطول؛ غير Uint8Array تُرفض برسالة النوع', async () => {
    const { assertPepper } = await import('../auth/teacherCrypto')
    expect(assertPepper('X', randomBytes(32)).byteLength).toBe(32)
    let m1 = '', m2 = ''
    try { assertPepper('X', randomBytes(31)) } catch (e) { m1 = (e as Error).message }
    try { assertPepper('X', 'a'.repeat(40)) } catch (e) { m2 = (e as Error).message }
    expect(m1).toContain('أقصر من 32')
    expect(m2).toContain('ليس Uint8Array'); expect(m2).not.toContain('aaaa')
  })
})
