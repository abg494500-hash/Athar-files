import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { StoreProvider } from '../data/store'
import { createMockRepository, MOCK_NOW } from './mock'
import { ToastProvider } from '../components/ui/Toast'
import { AppRoutes } from '../App'
import type { Session } from '../data/store'

function mount(path: string, session: Session | null, now = MOCK_NOW) {
  return render(
    <StoreProvider repository={createMockRepository({ session, now })}><ToastProvider>
      <MemoryRouter initialEntries={[path]}><AppRoutes /></MemoryRouter>
    </ToastProvider></StoreProvider>,
  )
}

describe('حماية المسارات', () => {
  it('الزائر غير المسجّل يُحوَّل إلى الدخول', async () => {
    mount('/owner', null)
    expect(await screen.findByRole('heading', { name: 'تسجيل الدخول' })).toBeInTheDocument()
  })
  it('المعلمة لا ترى واجهة المالكة', async () => {
    mount('/owner/archive', { role: 'teacher', teacherId: 'th1' })
    expect(await screen.findByRole('heading', { name: 'تسجيل الدخول' })).toBeInTheDocument()
  })
  it('المديرة لا ترى صفحة التصفير السنوي', async () => {
    mount('/owner/year-reset', { role: 'director' })
    expect(await screen.findByRole('heading', { name: 'تسجيل الدخول' })).toBeInTheDocument()
  })
})

describe('شاشة الدخول عند نقص إعداد الاتصال (لا دخول وهمي)', () => {
  it('لا نموذج بريد/كلمة مرور ولا قبول لأي بيانات: رسالة نقص الإعداد فقط', async () => {
    mount('/login', null)
    expect(await screen.findByText('الاتصال بقاعدة البيانات غير مُعدّ')).toBeInTheDocument()
    expect(screen.queryByLabelText('كلمة المرور')).not.toBeInTheDocument()
  })
  it('لا تبويبات في شاشة الدخول ولا حقل رمز عند نقص الإعداد', async () => {
    mount('/login', null)
    await screen.findByText('الاتصال بقاعدة البيانات غير مُعدّ')
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('رمز الدخول')).not.toBeInTheDocument()
  })
})

describe('واجهة المعلمة', () => {
  it('تعرض الفصل والعنصر الثاني الاختياري', async () => {
    mount('/teacher', { role: 'teacher', teacherId: 'th1' })
    expect(await screen.findByText('عناصر ملف الإنجاز')).toBeInTheDocument()
    expect(screen.getByText('ملف داعم')).toBeInTheDocument()
    expect(screen.getByText(/ولا يُحتسب عدم تسليمه وحده نقصًا/)).toBeInTheDocument()
    expect(screen.getByText(/الفصل الدراسي الأول/)).toBeInTheDocument()
  })
  it('تنبيه التأخر لمعلمة لم تسلّم بعد الموعد الأساسي', async () => {
    mount('/teacher', { role: 'teacher', teacherId: 'th2' })
    expect(await screen.findByText('انتهى الموعد الأساسي')).toBeInTheDocument()
  })
  it('باب التسليم مغلق بعد آخر موعد متأخر', async () => {
    mount('/teacher', { role: 'teacher', teacherId: 'th2' }, Date.parse('2026-10-22T10:00:00+04:00'))
    expect(await screen.findByText('أُغلق باب التسليم', { selector: 'p' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'تسليم' })[0]).toBeDisabled()
  })
  it('سجل النسخ يُفتح للمعلمة التي لديها نسختان', async () => {
    mount('/teacher', { role: 'teacher', teacherId: 'th1' })
    await userEvent.click(await screen.findByRole('button', { name: /سجل النسخ \(2\)/ }))
    expect(screen.getByText('النسخة 2')).toBeInTheDocument()
    expect(screen.getByText('النسخة 1')).toBeInTheDocument()
  })
  it('رفض ملف غير مدعوم ثم تسليم رابط صحيح', async () => {
    mount('/teacher', { role: 'teacher', teacherId: 'th2' })
    await userEvent.click((await screen.findAllByRole('button', { name: 'تسليم' }))[0])
    const dlg = await screen.findByRole('dialog')
    const file = within(dlg).getByLabelText('الملف') as HTMLInputElement
    fireEvent.change(file, { target: { files: [new File(['x'], 'virus.exe')] } })
    expect(await within(dlg).findByText(/نوع الملف غير مدعوم/)).toBeInTheDocument()
    await userEvent.click(within(dlg).getByRole('tab', { name: 'رابط خارجي' }))
    await userEvent.type(within(dlg).getByLabelText('الرابط'), 'http://x.com')
    await userEvent.click(within(dlg).getByRole('button', { name: 'تسليم' }))
    expect(await within(dlg).findByText(/يجب أن يبدأ الرابط/)).toBeInTheDocument()
    await userEvent.clear(within(dlg).getByLabelText('الرابط'))
    await userEvent.type(within(dlg).getByLabelText('الرابط'), 'https://drive.example.org/a')
    await userEvent.click(within(dlg).getByRole('button', { name: 'تسليم' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await screen.findByText(/سجل النسخ \(1\)/)).toBeInTheDocument()
  })
})

describe('واجهة المديرة', () => {
  it('البحث بالاسم والتصفية بالحالة', async () => {
    mount('/director/teachers', { role: 'director' })
    await screen.findByRole('heading', { name: 'التسليمات' })
    await userEvent.click(screen.getByRole('tab', { name: /الكل/ }))
    await userEvent.type(screen.getByLabelText('بحث باسم المعلمة'), 'سلمى')
    await waitFor(() => expect(screen.getAllByText('سلمى البلوشية').length).toBeGreaterThan(0))
    expect(screen.queryAllByText('مريم الحارثية')).toHaveLength(0)
    await userEvent.type(screen.getByLabelText('بحث باسم المعلمة'), 'غير موجودة')
    expect(await screen.findByText('لا توجد نتائج')).toBeInTheDocument()
  })
  it('تعديل الموعد يتطلب سببًا ويعرض تحذير عدم الأثر الرجعي', async () => {
    mount('/director/deadlines', { role: 'director' })
    expect(await screen.findByText(/لا يغيّر حالة أي تسليم سابق/)).toBeInTheDocument()
    const late = screen.getByLabelText(/آخر موعد للتسليم المتأخر/)
    fireEvent.change(late, { target: { value: '2026-10-25' } })
    await userEvent.click(screen.getByRole('button', { name: 'مراجعة وحفظ' }))
    expect(await screen.findByText(/يرجى ذكر سبب التعديل/)).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText(/سبب التعديل/), 'تمديد')
    await userEvent.click(screen.getByRole('button', { name: 'مراجعة وحفظ' }))
    expect(await screen.findByText('تأكيد تعديل المواعيد')).toBeInTheDocument()
  })
  it('ترتيب مواعيد خاطئ يمنع الحفظ', async () => {
    mount('/director/deadlines', { role: 'director' })
    fireEvent.change(await screen.findByLabelText(/آخر موعد للاستبدال/), { target: { value: '2026-10-01' } })
    expect(await screen.findByText(/آخر موعد للاستبدال لا يسبق/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'مراجعة وحفظ' })).toBeDisabled()
  })
})

describe('واجهة المالكة', () => {
  it('التصفير السنوي: بلا الواجهة الخادمية يظهر «غير متاح» ولا زر تصفير (لا حذف من الواجهة وحدها)', async () => {
    mount('/owner/year-reset', { role: 'owner' })
    await screen.findByRole('heading', { name: 'التصفير السنوي' })
    expect(screen.getByText(/يحتاج ضبط الواجهة الخادمية/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /بدء التصفير|تنفيذ/ })).not.toBeInTheDocument()
  })
  it('لا صفحة لسجل العمليات للمالكة (r41): لا تُعرض له شاشة ولا رابط', async () => {
    mount('/owner/audit', { role: 'owner' })
    await screen.findByRole('heading', { name: /أهلًا بكِ في لوحة المالكة/ })
    expect(screen.queryByRole('heading', { name: 'سجل العمليات' })).not.toBeInTheDocument()
    expect(screen.queryByText('سجل العمليات')).not.toBeInTheDocument()
  })
  it('رمز الدخول يظهر مرة واحدة عند الإصدار', async () => {
    mount('/owner/teachers', { role: 'owner' })
    await screen.findByRole('heading', { name: 'المعلمات وأكواد الدخول' })
    await userEvent.click(screen.getAllByRole('button', { name: /إعادة إصدار|إصدار رمز/ })[0])
    await userEvent.click(await screen.findByRole('button', { name: 'إصدار رمز جديد' }))
    expect(await screen.findByText(/يظهر هذا الرمز الآن فقط/)).toBeInTheDocument()
  })
})

describe('طبقة البيانات القابلة للتبديل (4.3)', () => {
  it('تنبيه أن البيانات مؤقتة يظهر في شاشة الدخول وفي كل واجهة', async () => {
    const first = mount('/login', null)
    expect(await screen.findByTestId('volatile-notice')).toHaveTextContent(/قد تضيع عند تحديث الصفحة/)
    first.unmount()
    for (const [path, session] of [['/teacher', { role: 'teacher', teacherId: 'th1' }], ['/director', { role: 'director' }], ['/owner', { role: 'owner' }]] as const) {
      const v = mount(path, session as Session)
      expect(await screen.findByTestId('volatile-notice')).toBeInTheDocument()
      v.unmount()
    }
  })
  it('لا يصف التنبيه البيانات بأنها محفوظة أو دائمة', async () => {
    mount('/login', null)
    const t = (await screen.findByTestId('volatile-notice')).textContent ?? ''
    expect(t).not.toMatch(/محفوظة بأمان|تُحفظ بشكل دائم|دائمة/)
    expect(t).not.toMatch(/تجريبي/)
  })
  it('يختفي التنبيه إن أعلن المصدر أنه دائم (دون تعديل الصفحات)', async () => {
    const base = createMockRepository({ session: { role: 'owner' } })
    const persistent = { ...base, meta: { ...base.meta, persistent: true } }
    render(<StoreProvider repository={persistent}><ToastProvider><MemoryRouter initialEntries={['/owner']}><AppRoutes /></MemoryRouter></ToastProvider></StoreProvider>)
    await screen.findByText('المالكة', { selector: 'p' })
    expect(screen.queryByTestId('volatile-notice')).not.toBeInTheDocument()
  })
  it('الواجهة تقرأ من المصدر المحقون لا من بيانات ثابتة', async () => {
    const base = createMockRepository({ session: { role: 'director' } })
    const snap = base.getSnapshot()
    const custom = createMockRepository({ session: { role: 'director' }, teachers: [{ ...snap.teachers[0], id: 'thx', name: 'معلمة من مصدر آخر' }], submissions: [] })
    render(<StoreProvider repository={custom}><ToastProvider><MemoryRouter initialEntries={['/director/teachers']}><AppRoutes /></MemoryRouter></ToastProvider></StoreProvider>)
    await userEvent.click(await screen.findByRole('tab', { name: /الكل/ }))
    expect((await screen.findAllByText('معلمة من مصدر آخر')).length).toBeGreaterThan(0)
    expect(screen.queryAllByText('مريم الحارثية')).toHaveLength(0)
  })
  it('تعديل عبر الواجهة ينعكس في اللقطة ويُسجَّل في السجل', async () => {
    const repo = createMockRepository({ session: { role: 'owner' } })
    render(<StoreProvider repository={repo}><ToastProvider><MemoryRouter initialEntries={['/owner/teachers']}><AppRoutes /></MemoryRouter></ToastProvider></StoreProvider>)
    await screen.findByRole('heading', { name: 'المعلمات وأكواد الدخول' })
    const before = repo.getSnapshot().audit.length
    await userEvent.click(screen.getAllByRole('button', { name: /إعادة إصدار|إصدار رمز/ })[0])
    await userEvent.click(await screen.findByRole('button', { name: 'إصدار رمز جديد' }))
    await screen.findByText(/يظهر هذا الرمز الآن فقط/)
    expect(repo.getSnapshot().audit).toHaveLength(before + 1)
    expect(repo.getSnapshot().audit[0].action).toBe('إعادة إصدار رمز دخول')
  })
})
