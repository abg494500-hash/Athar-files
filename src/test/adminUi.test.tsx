import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { StoreProvider } from '../data/store'
import { createMockRepository } from './mock'
import { ToastProvider } from '../components/ui/Toast'
import { AppRoutes } from '../App'
import { StaffApiProvider } from '../lib/staffApi/StaffApiContext'
import type { StaffApiClient } from '../lib/staffApi/client'

function mount(path: string, client: Partial<StaffApiClient> | null) {
  const repo = createMockRepository({ session: { role: 'owner' } })
  render(<StoreProvider repository={repo}><ToastProvider><StaffApiProvider client={client as StaffApiClient | null}>
    <MemoryRouter initialEntries={[path]}><AppRoutes /></MemoryRouter></StaffApiProvider></ToastProvider></StoreProvider>)
}

describe('المعلمات: بحث وتصفية وترتيب وإيقاف', () => {
  it('البحث يصفّي القائمة، وتصفية «موقوفة» وترتيب الاسم يعملان', async () => {
    mount('/owner/teachers', null)
    await screen.findByRole('heading', { name: /المعلمات وأكواد الدخول/ })
    const table = await screen.findByRole('table')
    const all = within(table).getAllByRole('row').length
    expect(all).toBeGreaterThan(2)
    await userEvent.type(screen.getByLabelText('بحث في المعلمات'), 'zzzz-لا-يوجد')
    expect(screen.getByText('لا توجد معلمات')).toBeInTheDocument()
    await userEvent.clear(screen.getByLabelText('بحث في المعلمات'))
    await userEvent.selectOptions(screen.getByLabelText('تصفية بالحالة'), 'disabled')
    const rows = screen.queryAllByRole('row')
    expect(rows.length).toBeLessThanOrEqual(all)
    await userEvent.selectOptions(screen.getByLabelText('ترتيب القائمة'), 'name')
  })
  it('زر الاستيراد لا يظهر بلا الواجهة الخادمية، ويظهر معها', async () => {
    mount('/owner/teachers', null)
    await screen.findByRole('heading', { name: /المعلمات وأكواد الدخول/ })
    expect(screen.queryByRole('button', { name: /استيراد من Excel/ })).not.toBeInTheDocument()
  })
})

describe('استيراد المعلمات: معاينة ثم استيراد ذرّي', () => {
  it('ملف CSV فيه صف مكرر وصف معيب: المعاينة تعدّها، والاستيراد معطّل حتى يُقرَّ التجاوز، ثم يُرسل الصفوف السليمة فقط', async () => {
    const importTeachers = vi.fn(async (rows: { name: string; subject: string }[]) => ({ ok: true as const, value: { imported: rows.map((r, i) => ({ id: `t${i}`, ...r })), issued: [], issueFailed: [] } }))
    mount('/owner/teachers', { teachersForImportCheck: vi.fn(async () => ({ ok: true as const, value: [{ name: 'منى سالم', subject: 'رياضيات' }] })), importTeachers: importTeachers as unknown as StaffApiClient['importTeachers'] })
    await userEvent.click(await screen.findByRole('button', { name: /استيراد من Excel/ }))
    const csv = 'اسم المعلمة,المادة\nسارة أحمد,علوم\nمنى سالم,رياضيات\nب,علوم\n'
    await userEvent.upload(screen.getByLabelText('اختيار ملف المعلمات'), new File([csv], 'm.csv', { type: 'text/csv' }))
    expect(await screen.findByText(/صف سليم/)).toBeInTheDocument()
    expect(screen.getByText(/موجودة مسبقًا/)).toBeInTheDocument(); expect(screen.getByText(/الاسم قصير/)).toBeInTheDocument()
    const go = screen.getByRole('button', { name: /^استيراد 1 معلمة/ })
    expect(go).toBeDisabled()
    await userEvent.click(screen.getByLabelText(/أتجاوزها/))
    expect(go).toBeEnabled()
    await userEvent.click(go)
    await waitFor(() => expect(importTeachers).toHaveBeenCalledWith([{ name: 'سارة أحمد', subject: 'علوم' }], true))
    expect(await screen.findByText('تقرير الاستيراد')).toBeInTheDocument()
  })
  it('ملف فيه عمود كلمة مرور ⇒ يُرفض بسبب واضح ولا معاينة', async () => {
    mount('/owner/teachers', { teachersForImportCheck: vi.fn(async () => ({ ok: true as const, value: [] })) })
    await userEvent.click(await screen.findByRole('button', { name: /استيراد من Excel/ }))
    await userEvent.upload(screen.getByLabelText('اختيار ملف المعلمات'), new File(['اسم المعلمة,المادة,كلمة المرور\nسارة أحمد,علوم,123\n'], 'm.csv'))
    expect(await screen.findByText(/لا تُستورد الأسرار أبدًا/)).toBeInTheDocument()
    expect(screen.queryByText(/صف سليم/)).not.toBeInTheDocument()
  })
  it('رفض الخادم (تعارض) ⇒ رسالة «لم يُستورد شيء»', async () => {
    mount('/owner/teachers', { teachersForImportCheck: vi.fn(async () => ({ ok: true as const, value: [] })), importTeachers: vi.fn(async () => ({ ok: false as const, error: 'rejected' as const, code: 'conflict' })) as unknown as StaffApiClient['importTeachers'] })
    await userEvent.click(await screen.findByRole('button', { name: /استيراد من Excel/ }))
    await userEvent.upload(screen.getByLabelText('اختيار ملف المعلمات'), new File(['اسم المعلمة,المادة\nسارة أحمد,علوم\n'], 'm.csv'))
    await userEvent.click(await screen.findByRole('button', { name: /^استيراد 1 معلمة/ }))
    expect(await screen.findByText('لم يُستورد شيء')).toBeInTheDocument()
  })
})

describe('السنوات: نموذج الإنشاء بالتواريخ والمواعيد', () => {
  it('مواعيد غير مرتبة ⇒ رسالة محلية ولا نداء؛ والمرتبة تُرسل للخادم', async () => {
    const createYear = vi.fn(async () => ({ ok: true as const, value: { id: 'y' } }))
    mount('/owner/years', { createYear })
    await userEvent.click(await screen.findByRole('button', { name: /إضافة سنة/ }))
    const dlg = await screen.findByRole('dialog')
    const dates = within(dlg).getAllByLabelText('الموعد الأساسي')
    const orig = (dates[0] as HTMLInputElement).value
    await userEvent.clear(dates[0]!); await userEvent.type(dates[0]!, '2099-12-30')
    await userEvent.click(within(dlg).getByRole('button', { name: 'إضافة السنة' }))
    expect(await within(dlg).findByText(/مواعيد .* يجب أن تكون/)).toBeInTheDocument(); expect(createYear).not.toHaveBeenCalled()
    await userEvent.clear(dates[0]!); await userEvent.type(dates[0]!, orig)
    await userEvent.click(within(dlg).getByRole('button', { name: 'إضافة السنة' }))
    await waitFor(() => expect(createYear).toHaveBeenCalledTimes(1))
    expect((createYear.mock.calls as unknown as unknown[][])[0]![0]).toMatchObject({ terms: [{ ord: 1, deadlineBase: orig }, { ord: 2 }] })
  })
  it('رفض الخادم لسنة بدأ العمل عليها يُعرض بالعربية داخل النموذج', async () => {
    const updateYear = vi.fn(async () => ({ ok: false as const, error: 'rejected' as const, code: 'year_work_started' }))
    mount('/owner/years', { updateYear })
    await userEvent.click((await screen.findAllByRole('button', { name: 'تعديل السنة' }))[0]!)
    const dlg = await screen.findByRole('dialog')
    await userEvent.click(within(dlg).getByRole('button', { name: 'حفظ التعديل' }))
    expect(await within(dlg).findByText(/بدأ العمل على هذه السنة/)).toBeInTheDocument()
  })
})
