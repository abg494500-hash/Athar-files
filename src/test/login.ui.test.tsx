import { describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { StoreProvider } from '../data/store'
import { ToastProvider } from '../components/ui/Toast'
import { AuthProvider } from '../lib/auth/AuthContext'
import { createAuthController } from '../lib/auth/controller'
import { createSupabaseRepository } from '../data/supabase/supabaseRepository'
import { AppRoutes } from '../App'
import { makeBackend, type FakeAuthOpts } from './fakeBackend'

const TABLES: FakeAuthOpts['tables'] = {
  years: { rows: [{ id: 'y1', label: '2026–2027', is_active: true }] },
  terms: { rows: [
    { id: 't1', year_id: 'y1', name: 'الفصل الدراسي الأول', ord: 1, deadline_base: '2026-10-15', deadline_late: '2026-10-22', deadline_replace: '2026-11-06' },
    { id: 't2', year_id: 'y1', name: 'الفصل الدراسي الثاني', ord: 2, deadline_base: '2027-03-05', deadline_late: '2027-03-12', deadline_replace: '2027-03-26' },
  ] },
  teachers: { rows: [{ id: 'th1', name: 'معلمة حقيقية للاختبار', subject: 'علوم', is_active: true, color_idx: 1, created_at: '2026-09-01T00:00:00Z' }] },
}

async function mountLive(path: string, opts: FakeAuthOpts) {
  const merged: FakeAuthOpts = { tables: TABLES, ...opts }
  const backend = makeBackend(merged)
  const auth = createAuthController(backend)
  const repo = createSupabaseRepository(backend, auth, { tickMs: null })
  await auth.start()
  render(
    <AuthProvider controller={auth}><StoreProvider repository={repo}><ToastProvider>
      <MemoryRouter initialEntries={[path]}><AppRoutes /></MemoryRouter>
    </ToastProvider></StoreProvider></AuthProvider>,
  )
  return { backend, auth, repo, merged }
}

describe('الدخول الحقيقي بمصدر Supabase (عميل وهمي)', () => {
  it('زائر بلا جلسة لا يرى لوحة الإدارة', async () => {
    await mountLive('/owner', { user: null })
    expect(await screen.findByRole('heading', { name: 'تسجيل الدخول' })).toBeInTheDocument()
  })

  it('بيانات خاطئة: رسالة عامة وبقاء في الدخول', async () => {
    await mountLive('/login/staff', { user: null, signInError: { message: 'Invalid login credentials', status: 400 } })
    await userEvent.type(await screen.findByLabelText('البريد الإلكتروني'), 'a@b.co')
    await userEvent.type(screen.getByLabelText('كلمة المرور'), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: 'دخول' }))
    expect(await screen.findByText(/تعذّر الدخول بهذه البيانات/)).toBeInTheDocument()
  })

  it('بريد غير مسجَّل مسؤولًا: لا لوحة إدارة', async () => {
    await mountLive('/login/staff', { user: { id: 'u-x' }, profile: null })
    // الجلسة موجودة لكن لا صف مسؤولة: يبقى في الدخول
    expect(await screen.findByRole('heading', { name: 'دخول الإدارة' })).toBeInTheDocument()
    expect(screen.queryByText('التحقق بخطوتين')).not.toBeInTheDocument()
    expect(screen.queryByText('المالكة', { selector: 'p' })).not.toBeInTheDocument()
  })

  it('مسؤولة نشطة بكلمة المرور الصحيحة: تدخل مباشرة بلا شاشة رمز إضافي (A-98)', async () => {
    const { backend } = await mountLive('/login/staff', { user: { id: 'u-1' }, profile: { role: 'owner', is_active: true } })
    expect(await screen.findByText('المالكة', { selector: 'p' })).toBeInTheDocument()
    expect(screen.queryByText('التحقق بخطوتين')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('رمز التحقق')).not.toBeInTheDocument()
    expect(backend.calls.includes('rpc:current_staff_role')).toBe(true)
  })

  it('الخادم لا يؤكد الدور: لا لوحة وتبقى شاشة الدخول', async () => {
    await mountLive('/owner', { user: { id: 'u-1' }, profile: { role: 'owner', is_active: true }, rpcRole: null })
    expect(await screen.findByRole('heading', { name: 'تسجيل الدخول' })).toBeInTheDocument()
    expect(screen.queryByText('المالكة', { selector: 'p' })).not.toBeInTheDocument()
  })

  it('فشل تحميل البيانات: خطأ صريح بلا بيانات وهمية', async () => {
    await mountLive('/owner', { user: { id: 'u-1' }, profile: { role: 'owner', is_active: true }, tables: { ...TABLES, teachers: { error: { message: 'x', code: '42P01' } } } })
    expect(await screen.findByText('حدث خطأ أثناء التحميل')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'إعادة المحاولة' })).toBeInTheDocument()
    expect(screen.queryByText(/معلمة حقيقية للاختبار/)).not.toBeInTheDocument()
  })

  it('قاعدة بلا سنة دراسية: حالة فراغ مفهومة للمالكة', async () => {
    await mountLive('/owner', { user: { id: 'u-1' }, profile: { role: 'owner', is_active: true }, tables: {} })
    await waitFor(() => expect(screen.getByText('لا توجد سنة دراسية بعد')).toBeInTheDocument())
  })

  it('المديرة لا ترى صفحات المالكة: تُحوَّل إلى واجهتها', async () => {
    await mountLive('/owner/year-reset', { user: { id: 'u-2' }, profile: { role: 'director', is_active: true } })
    expect(await screen.findByText('مديرة المدرسة', { selector: 'p' })).toBeInTheDocument()
    expect(screen.queryByText('لا تراجع بعد التصفير')).not.toBeInTheDocument() // صفحة المالكة نفسها (/owner/year-reset) لا تُعرض للمديرة؛ مسارها هي /director/year-reset
  })

  it('عطل خادم مؤقت أثناء التحقق: رسالة واضحة بلا خروج، ثم إعادة المحاولة تدخل دون كلمة مرور جديدة', async () => {
    const { backend, merged } = await mountLive('/login/staff', { user: { id: 'u-1' }, profile: { role: 'owner', is_active: true }, profileError: { message: 'unavailable', status: 503 } })
    expect(await screen.findByText('تعذّر التحقق من الجلسة مؤقتًا')).toBeInTheDocument()
    expect(screen.queryByLabelText('كلمة المرور')).not.toBeInTheDocument()
    expect(backend.calls.includes('signOut')).toBe(false)
    delete merged.profileError
    await userEvent.click(screen.getByRole('button', { name: 'إعادة المحاولة' }))
    expect(await screen.findByText('المالكة', { selector: 'p' })).toBeInTheDocument()
    expect(backend.calls.includes('signIn')).toBe(false)
  })
})
