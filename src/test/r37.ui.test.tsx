// r37: الصفحة الرئيسية، الدخول برمز واحد، رسائل الحالة الفارغة في بوابة المعلمة، وتسجيل المديرة للمعلمات.
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { StoreProvider } from '../data/store'
import type { Session } from '../data/store'
import { createMockRepository, MOCK_NOW } from './mock'
import { ToastProvider } from '../components/ui/Toast'
import { AppRoutes } from '../App'
import { createTeacherApiClient } from '../lib/teacherAuth/client'
import { TeacherPortalProvider } from '../lib/teacherAuth/TeacherPortalContext'

const TOKEN = 'C'.repeat(43)
const base = { teacher: { id: 't1', name: 'سارة', subject: 'علوم' }, serverNow: '2026-10-24T08:00:00.000Z' }
function client(portfolio: unknown, signedIn = true) {
  const store = new Map<string, string>(signedIn ? [['athar.teacher.token', TOKEN]] : [])
  const f = (async (url: string) => {
    const path = new URL(url).pathname.replace('/api', '')
    if (path === '/teacher/me') return new Response(JSON.stringify({ teacher: base.teacher }), { status: 200 })
    if (path === '/teacher/portfolio') return new Response(JSON.stringify({ portfolio }), { status: 200 })
    return new Response('{}', { status: 404 })
  }) as unknown as typeof fetch
  return createTeacherApiClient({ baseUrl: 'https://api.example.org/api', fetchImpl: f, storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: (k) => void store.delete(k) } })
}
function mount(path: string, c: ReturnType<typeof createTeacherApiClient> | null, session: Session | null = null) {
  return render(
    <StoreProvider repository={createMockRepository({ session, now: MOCK_NOW })}><ToastProvider><TeacherPortalProvider client={c}>
      <MemoryRouter initialEntries={[path]}><AppRoutes /></MemoryRouter>
    </TeacherPortalProvider></ToastProvider></StoreProvider>,
  )
}

describe('الصفحة الرئيسية والدخول', () => {
  it('الرئيسية: الشعار والعبارة وزر دخول المعلمات ورابط الإدارة', async () => {
    mount('/', null)
    expect(await screen.findByRole('heading', { name: 'منصة ملف الإنجاز الإلكتروني' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /تسجيل الدخول/ })).toHaveAttribute('href', '/login')
    expect(screen.queryByRole('link', { name: /الإدارة|المالكة|المديرة/ })).toBeNull()
    expect(screen.getAllByRole('img').length).toBeGreaterThan(0)
  })
  it('دخول المعلمات: حقل رمز واحد فقط بلا بريد ولا كلمة مرور ولا رقم سري', async () => {
    mount('/login', client(null, false))
    const box = await screen.findByLabelText('رمز الدخول')
    expect(box).toBeInTheDocument()
    expect(screen.queryByLabelText('كلمة المرور')).toBeNull()
    expect(screen.queryByLabelText(/الرقم السري|PIN/)).toBeNull()
    expect(screen.getAllByRole('textbox')).toHaveLength(1)
  })
  it('صفحة الدخول الموحّدة لا تذكر أي دور ولا رابطًا آخر', async () => {
    mount('/login', client(null, false))
    await screen.findByLabelText('رمز الدخول')
    expect(document.body.textContent).not.toMatch(/المالكة|المديرة|الإدارة|المعلمات/)
  })
  it('رمز إدارة: الخادم يعيد جلسة ⇒ تُسلَّم للمتحكّم (signInWithTokens) لا تُخزَّن كجلسة معلمة', async () => {
    const calls: string[] = []
    const store = new Map<string, string>()
    const f = (async () => new Response(JSON.stringify({ kind: 'staff', accessToken: 'AT', refreshToken: 'RT' }), { status: 200 })) as unknown as typeof fetch
    const c = createTeacherApiClient({ baseUrl: 'https://api.example.org/api', fetchImpl: f, storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: (k) => void store.delete(k) } })
    const r = await c.loginAny('any phrase'); calls.push(r.ok ? r.value.kind : 'fail')
    expect(calls).toEqual(['staff']); expect(store.size).toBe(0)
  })
  it('رمز فارغ ⇒ رسالة محلية بلا طلب شبكة', async () => {
    mount('/login', client(null, false))
    await userEvent.click(await screen.findByRole('button', { name: 'دخول' }))
    expect(await screen.findByText('يرجى إدخال رمز الدخول.')).toBeInTheDocument()
  })
})

describe('بوابة المعلمة: لا صفحة فارغة صامتة', () => {
  it('لا سنة نشطة ⇒ تنبيه صريح', async () => {
    mount('/teacher/portal', client({ ...base, year: null, terms: [], slotsCount: 0 }))
    expect(await screen.findByText('لا توجد سنة دراسية نشطة حاليًا')).toBeInTheDocument()
    expect(screen.getByText('مواعيد كل فصل مستقلة')).toBeInTheDocument()
  })
  it('سنة بلا فصول ⇒ تنبيه', async () => {
    mount('/teacher/portal', client({ ...base, year: { id: 'y', label: '2026-2027' }, terms: [], slotsCount: 0 }))
    expect(await screen.findByText('لا توجد فصول في السنة النشطة')).toBeInTheDocument()
  })
  it('فصول بلا بنود ⇒ تنبيه', async () => {
    const term = { id: 'term-1', name: 'الفصل الأول', ord: 1, deadlines: { base: '2026-10-20', late: '2026-10-30', replace: '2026-11-15' }, phase: 'open', slots: [] }
    mount('/teacher/portal', client({ ...base, year: { id: 'y', label: '2026-2027' }, terms: [term], slotsCount: 0 }))
    expect(await screen.findByText('لا توجد بنود تسليم معرَّفة')).toBeInTheDocument()
  })
})

describe('تسجيل المعلمات للمديرة', () => {
  it('المديرة تفتح صفحة التسجيل ولا تُحوَّل للدخول', async () => {
    mount('/director/register', null, { role: 'director' })
    expect(await screen.findByRole('navigation', { name: 'أقسام المنصة' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'تسجيل الدخول' })).toBeNull()
  })
  it('المعلمة لا تفتحها', async () => {
    mount('/director/register', client(null, false), { role: 'teacher', teacherId: 'th1' })
    expect(await screen.findByRole('heading', { name: 'تسجيل الدخول' })).toBeInTheDocument()
  })
})
