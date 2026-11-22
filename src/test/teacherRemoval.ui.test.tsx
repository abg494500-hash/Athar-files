import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { StoreProvider } from '../data/store'
import { createMockRepository } from './mock'
import { ToastProvider } from '../components/ui/Toast'
import { AppRoutes } from '../App'
import { StaffApiProvider } from '../lib/staffApi/StaffApiContext'
import type { StaffApiClient } from '../lib/staffApi/client'

function mount(client: Partial<StaffApiClient> | null) {
  const repo = createMockRepository({ session: { role: 'owner' } })
  render(
    <StoreProvider repository={repo}><ToastProvider><StaffApiProvider client={client as StaffApiClient | null}>
      <MemoryRouter initialEntries={['/owner/teachers']}><AppRoutes /></MemoryRouter>
    </StaffApiProvider></ToastProvider></StoreProvider>,
  )
  return repo
}
const openEdit = async () => {
  await screen.findByRole('heading', { name: 'المعلمات وأكواد الدخول' })
  await userEvent.click(screen.getAllByRole('button', { name: 'تعديل' })[0]!)
}

describe('حذف المعلمة بعد الأرشفة (واجهة المالكة)', () => {
  it('زر إيقاف/إعادة تفعيل المعلمة موجود (المهمة النهائية F)، وبلا خادم لا يظهر زر حذف بل توضيح', async () => {
    mount(null)
    await openEdit()
    expect(screen.getByRole('button', { name: /إيقاف المعلمة|إعادة تفعيل المعلمة/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'حذف المعلمة' })).not.toBeInTheDocument()
    expect(await screen.findByText(/غير متاح قبل ربط الواجهة الخادمية/)).toBeInTheDocument()
  })
  it('بوجود الخادم: تأكيد ثم استدعاء الحذف برقم المعلمة ورسالة نجاح', async () => {
    const removeTeacher = vi.fn(async () => ({ ok: true as const, value: true as const }))
    const repo = mount({ removeTeacher })
    await openEdit()
    await userEvent.click(await screen.findByRole('button', { name: 'حذف المعلمة' }))
    expect(await screen.findByText(/كل<\/b> تسليماتها|لا يُسمح بالحذف إلا بعد/)).toBeInTheDocument()
    expect(removeTeacher).not.toHaveBeenCalled()
    const btns = await screen.findAllByRole('button', { name: 'حذف المعلمة' })
    await userEvent.click(btns[btns.length - 1]!)
    expect(removeTeacher).toHaveBeenCalledTimes(1)
    expect(repo.getSnapshot().teachers.map((x) => x.id)).toContain((removeTeacher.mock.calls[0] as unknown as [string])[0])
    expect(await screen.findByText('حُذفت المعلمة وأُبطل دخولها.')).toBeInTheDocument()
  })
  it('رفض الخادم (غير مؤرشفة): رسالة السبب بالعربية', async () => {
    const removeTeacher = vi.fn(async () => ({ ok: false as const, error: 'rejected' as const, code: 'not_archived' }))
    mount({ removeTeacher })
    await openEdit()
    await userEvent.click(await screen.findByRole('button', { name: 'حذف المعلمة' }))
    const btns = await screen.findAllByRole('button', { name: 'حذف المعلمة' })
    await userEvent.click(btns[btns.length - 1]!)
    expect(await screen.findByText(/لا يمكن حذف المعلمة قبل أرشفة كل تسليماتها/)).toBeInTheDocument()
  })
})
