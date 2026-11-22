import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { StoreProvider } from '../data/store'
import { createMockRepository, MOCK_NOW } from './mock'
import { ToastProvider } from '../components/ui/Toast'
import { AppRoutes } from '../App'
import type { Session } from '../data/store'
import { sectionsFor } from '../lib/sections'

function mount(path: string, session: Session | null) {
  return render(
    <StoreProvider repository={createMockRepository({ session, now: MOCK_NOW })}><ToastProvider>
      <MemoryRouter initialEntries={[path]}><AppRoutes /></MemoryRouter>
    </ToastProvider></StoreProvider>,
  )
}

const OWNER_ONLY = ['الأرشفة', 'التصفير السنوي', 'السنوات والفصول', 'المعلمات والأكواد', 'متابعة الملفات', 'لوحة المتابعة']

describe('الصفحة الرئيسية بالبطاقات (0.6.3)', () => {
  it('المالكة: ثماني بطاقات بالروابط الصحيحة، ولا شريط جانبي ولا زر قائمة', async () => {
    mount('/owner', { role: 'owner' })
    await screen.findByRole('heading', { name: 'أهلًا بكِ في لوحة المالكة' })
    const secs = sectionsFor('owner')
    expect(secs).toHaveLength(8)
    for (const s of secs) {
      const link = screen.getByRole('link', { name: new RegExp(s.label) })
      expect(link).toHaveAttribute('href', s.to)
    }
    expect(document.querySelector('aside')).toBeNull()
    expect(screen.queryByRole('button', { name: 'فتح القائمة' })).toBeNull()
  })

  it('المديرة: ست بطاقات (بلا التصفير السنوي: للمالكة فقط)، ولا أثر لأقسام المالكة', async () => {
    mount('/director', { role: 'director' }) // r41: الصفحة الافتتاحية للمديرة هي «التسليمات»
    await screen.findByRole('heading', { name: 'التسليمات' })
    const main = screen.getByRole('main')
    expect(sectionsFor('director')).toHaveLength(6)
    for (const label of OWNER_ONLY.filter((l) => !['متابعة الملفات', 'لوحة المتابعة', 'السنوات والفصول', 'المعلمات والأكواد'].includes(l))) {
      expect(within(main).queryByText(label)).toBeNull()
    }
    expect(within(screen.getByRole('navigation', { name: 'أقسام المنصة' })).getByRole('link', { name: /التقارير والإحصاءات/ })).toHaveAttribute('href', '/director/reports')
  })

  it('الأقسام مشتقة من البيانات: لا أرقام تظهر عند عدم وجود معلمات (حالة فراغ)', async () => {
    const repo = createMockRepository({ session: { role: 'owner' }, teachers: [], submissions: [] })
    render(<StoreProvider repository={repo}><ToastProvider><MemoryRouter initialEntries={['/owner']}><AppRoutes /></MemoryRouter></ToastProvider></StoreProvider>)
    await screen.findByRole('heading', { name: 'أهلًا بكِ في لوحة المالكة' })
    expect(screen.queryByText('حالة التسليم في الفصل الحالي')).toBeNull()
    expect(screen.queryByText(/معلمة نشطة/)).toBeNull()
  })

  it('كل مسارات سجل الأقسام تعمل للدور المناسب ولا تُحوَّل إلى الدخول', async () => {
    for (const role of ['owner', 'director'] as const) {
      for (const s of sectionsFor(role)) {
        const v = mount(s.to, { role })
        expect(await screen.findByRole('navigation', { name: 'أقسام المنصة' })).toBeInTheDocument()
        expect(screen.queryByRole('heading', { name: 'تسجيل الدخول' })).toBeNull()
        v.unmount()
      }
    }
  })

  it('شريط الأقسام في الصفحة الداخلية: القسم الحالي معلَّم والرئيسية تعيد إلى البطاقات', async () => {
    mount('/owner/archive', { role: 'owner' })
    const nav = await screen.findByRole('navigation', { name: 'أقسام المنصة' })
    expect(within(nav).getByRole('link', { name: 'الأرشفة' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getAllByRole('link')).toHaveLength(1 + 8)
    await userEvent.click(within(nav).getByRole('link', { name: 'الرئيسية' }))
    expect(await screen.findByRole('heading', { name: 'أهلًا بكِ في لوحة المالكة' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'أقسام المنصة' })).toBeNull()
  })

  it('شريط المديرة يحوي أقسامها فقط (6 + الرئيسية)', async () => {
    mount('/director/reports', { role: 'director' })
    const nav = await screen.findByRole('navigation', { name: 'أقسام المنصة' })
    expect(within(nav).getAllByRole('link')).toHaveLength(1 + 6)
    expect(within(nav).queryByRole('link', { name: 'الأرشفة' })).toBeNull()
    expect(within(nav).queryByRole('link', { name: 'التصفير السنوي' })).toBeNull() // r41: التصفير للمالكة فقط في الواجهة
  })

  it('الانتقال من بطاقة إلى صفحتها ثم الرجوع من تفاصيل معلمة يبقيان في القسم الصحيح', async () => {
    mount('/owner', { role: 'owner' })
    await userEvent.click(await screen.findByRole('link', { name: /متابعة الملفات/ }))
    expect(await screen.findByRole('heading', { name: 'المعلمات وحالات التسليم' })).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'أقسام المنصة' })
    expect(within(nav).getByRole('link', { name: 'متابعة الملفات' })).toHaveAttribute('aria-current', 'page')
  })

  it('الصلاحيات لم تتغير: المديرة تُحوَّل إلى الدخول من أي مسار للمالكة (كما قبل إعادة التصميم)', async () => {
    for (const path of ['/owner', '/owner/overview', '/owner/year-reset', '/owner/archive']) {
      const v = mount(path, { role: 'director' })
      expect(await screen.findByRole('heading', { name: 'تسجيل الدخول' })).toBeInTheDocument()
      v.unmount()
    }
  })

  it('المالكة لا تدخل مسارات المديرة، والمعلمة لا تدخل أيًا منهما', async () => {
    const cases: [string, Session][] = [['/director', { role: 'owner' }], ['/director/reports', { role: 'owner' }], ['/owner', { role: 'teacher', teacherId: 'th1' }], ['/director/overview', { role: 'teacher', teacherId: 'th1' }]]
    for (const [path, session] of cases) {
      const v = mount(path, session)
      expect(await screen.findByRole('heading', { name: 'تسجيل الدخول' })).toBeInTheDocument()
      v.unmount()
    }
  })

  it('لوحة المتابعة القديمة محفوظة وتعمل في /owner/overview و/director/overview', async () => {
    const o = mount('/owner/overview', { role: 'owner' })
    expect(await screen.findByRole('heading', { name: 'لوحة المتابعة' })).toBeInTheDocument()
    o.unmount()
    mount('/director/overview', { role: 'director' })
    expect(await screen.findByRole('heading', { name: 'نظرة عامة على التسليم' })).toBeInTheDocument()
  })

  it('المعلمة: ترويسة بلا شريط أقسام', async () => {
    mount('/teacher', { role: 'teacher', teacherId: 'th1' })
    await screen.findByText('مواعيد الفصل')
    expect(screen.queryByRole('navigation', { name: 'أقسام المنصة' })).toBeNull()
  })

  it('تسجيل الخروج متاح بزر واضح في الترويسة', async () => {
    mount('/owner', { role: 'owner' })
    await userEvent.click(await screen.findByRole('button', { name: 'تسجيل الخروج' }))
    expect(await screen.findByRole('heading', { name: 'تسجيل الدخول' })).toBeInTheDocument()
  })

  it('صفحة الدخول لا تحوي عبارتي «المالكة» و«مدرسة واحدة»', async () => {
    mount('/login', null)
    await screen.findByRole('heading', { name: 'تسجيل الدخول' })
    expect(document.body.textContent).not.toMatch(/المالكة|مالكة|مدرسة واحدة/)
  })

  it('بطاقات الأقسام بألوان باستيل متنوعة (4 ألوان مختلفة على الأقل لكل دور)', () => {
    for (const role of ['owner', 'director'] as const) {
      expect(new Set(sectionsFor(role).map((s) => s.tone)).size).toBeGreaterThanOrEqual(4)
    }
  })
})
