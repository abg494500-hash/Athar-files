import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { StoreProvider } from '../data/store'
import { createMockRepository } from './mock'
import { ToastProvider } from '../components/ui/Toast'
import { AppRoutes } from '../App'
import { StaffApiProvider } from '../lib/staffApi/StaffApiContext'
import type { StaffApiClient, YearResetReport, YearResetStatus } from '../lib/staffApi/client'

const keys = { total: 3, pending: 0, deleted: 0, verifiedAbsent: 0, failed: 0 }
const status = (over: Partial<YearResetStatus> = {}): YearResetStatus => ({ yearId: 'y', state: 'ready', gate: { ready: true, problems: [], archiveId: 'A' }, reset: null, closure: null, ...over })
const report: YearResetReport = { yearId: 'y', yearLabel: '', archiveTitle: 'أرشيف', teachers: 2, submissions: 3, versions: 3, files: 3, links: 0, fileBytes: 3000, archivePartsCount: 1,
  archiveParts: [{ part: 1, filename: 'p.zip', sha256: 'a'.repeat(64), size: 10, downloadVerified: true, copyVerified: true, copyMedium: 'external_drive' }], gate: { ready: true, problems: [], archiveId: 'A' },
  toDelete: { versions: 3, r2_objects: 3 }, stays: { staff_accounts: 2, audit_log: 10 } }

async function mount(client: Partial<StaffApiClient>) {
  const repo = createMockRepository({ session: { role: 'owner' } })
  render(<StoreProvider repository={repo}><ToastProvider><StaffApiProvider client={client as StaffApiClient}>
    <MemoryRouter initialEntries={['/owner/year-reset']}><AppRoutes /></MemoryRouter></StaffApiProvider></ToastProvider></StoreProvider>)
  await screen.findByRole('heading', { name: 'التصفير السنوي' })
  const sel = screen.getByLabelText('السنة الدراسية المراد تصفيرها') as HTMLSelectElement
  const opt = Array.from(sel.options).find((o) => o.value)!
  await userEvent.selectOptions(sel, opt.value)
  return opt.textContent!.replace(/ \(نشطة\)/, '')
}

describe('صفحة التصفير السنوي', () => {
  it('البوابة مغلقة: تُعرض الموانع بالعربية ولا يظهر زر البدء، ولا إشارة «جاهز» زائفة', async () => {
    await mount({ yearResetStatus: vi.fn(async () => ({ ok: true as const, value: status({ state: 'not_started', gate: { ready: false, problems: ['no_year_archive', 'pending_uploads:2'], archiveId: null } }) })), yearResetReport: vi.fn(async () => ({ ok: false as const, error: 'rejected' as const })) })
    expect(await screen.findByText('لا يوجد أرشيف سنوي محلي مسجَّل لهذه السنة')).toBeInTheDocument()
    expect(screen.getByText(/توجد عمليات رفع معلّقة لم تُحسم \(2\)/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /بدء التصفير/ })).not.toBeInTheDocument()
    expect(screen.queryByText('جاهز للتصفير')).not.toBeInTheDocument()
  })

  it('جاهز: يظهر تقرير ما قبل التصفير، والتنفيذ بنقرة تأكيد واحدة بلا كتابة اسم السنة (A-126)', async () => {
    const yearResetStart = vi.fn(async () => ({ ok: true as const, value: { done: true, status: status({ state: 'completed', closure: { closedAt: '2027-07-01T10:00:00Z', yearLabel: 'x', archiveTitle: 'أرشيف', parts: [{ part: 1, sha256: 'a'.repeat(64), size: 10 }], verification: {}, deleted: { versions: 3 } } }) } }))
    await mount({ yearResetStatus: vi.fn(async () => ({ ok: true as const, value: status() })), yearResetReport: vi.fn(async () => ({ ok: true as const, value: report })), yearResetStart })
    expect(await screen.findByText('تقرير ما قبل التصفير')).toBeInTheDocument()
    expect(screen.getByText('سيُحذف')).toBeInTheDocument(); expect(screen.getByText('سيبقى')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'تصفير هذه السنة' }))
    expect(yearResetStart).not.toHaveBeenCalled() // لا بدء قبل التأكيد
    expect(screen.queryByLabelText(/اكتبي اسم السنة/)).toBeNull() // لا حقل كتابة
    await userEvent.click(await screen.findByRole('button', { name: 'نعم، صفّري السنة' }))
    await waitFor(() => expect(yearResetStart).toHaveBeenCalledWith(expect.any(String)))
    expect(await screen.findByText('اكتمل التصفير.', { exact: false }) ?? true).toBeTruthy()
  })

  it('توقف جزئي (ملف فشل): تُعرض الحالة والسبب وزر الاستئناف، ولا تُعرض «اكتمل»', async () => {
    const partial = status({ state: 'partial', reset: { id: 'r', phase: 'files', startedAt: 'x', finishedAt: null, lastError: 'some_files_failed', attempts: 2, keys: { ...keys, verifiedAbsent: 2, failed: 1 }, counters: {} } })
    const yearResetResume = vi.fn(async () => ({ ok: true as const, value: { done: false, status: partial } }))
    await mount({ yearResetStatus: vi.fn(async () => ({ ok: true as const, value: partial })), yearResetReport: vi.fn(async () => ({ ok: true as const, value: report })), yearResetResume })
    expect(await screen.findByText('حالة التصفير: اكتمل جزئيًا — يحتاج استئنافًا')).toBeInTheDocument()
    expect(screen.getByText('some_files_failed')).toBeInTheDocument()
    expect(screen.queryByText('اكتمل التصفير')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'استئناف التصفير' }))
    await waitFor(() => expect(yearResetResume).toHaveBeenCalled())
  })

  it('مكتمل: سجل الإغلاق الموجز فقط، ولا زر تصفير', async () => {
    await mount({ yearResetStatus: vi.fn(async () => ({ ok: true as const, value: status({ state: 'completed', closure: { closedAt: '2027-07-01T10:00:00Z', yearLabel: '2026-2027', archiveTitle: 'أرشيف', parts: [{ part: 1, sha256: 'a'.repeat(64), size: 10 }], verification: {}, deleted: { versions: 3 } } }) })) })
    expect(await screen.findByText('اكتمل التصفير')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /بدء التصفير|استئناف/ })).not.toBeInTheDocument()
  })
})
