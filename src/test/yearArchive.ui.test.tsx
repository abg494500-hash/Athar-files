import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { StoreProvider } from '../data/store'
import { createMockRepository } from './mock'
import { ToastProvider } from '../components/ui/Toast'
import { AppRoutes } from '../App'
import { StaffApiProvider } from '../lib/staffApi/StaffApiContext'
import type { StaffApiClient, YearArchiveStatus } from '../lib/staffApi/client'

const st = (over: Partial<YearArchiveStatus> = {}): YearArchiveStatus => ({ id: 'A1', title: 'أرشيف السنة الدراسية 2026–2027 كاملة', createdAt: '2027-06-20T10:00:00Z', sizeBytes: 5000, entries: 7, sha256: 'a'.repeat(64), entriesDigest: 'b'.repeat(64), downloadVerifiedAt: null, openedLocally: false, secondCopyAt: null,
  parts: [{ no: 1, filename: 'athar-archive-x-20270620-part-01-of-02.zip', sha256: 'c'.repeat(64), sizeBytes: 3000, entries: 4, verified: false, copyVerified: false, copyMedium: null }, { no: 2, filename: 'athar-archive-x-20270620-part-02-of-02.zip', sha256: 'd'.repeat(64), sizeBytes: 2000, entries: 3, verified: false, copyVerified: false, copyMedium: null }],
  resetGate: { ready: false, problems: ['download_not_verified', 'parts_second_copy_not_verified:2'] }, ...over })
function mount(client: Partial<StaffApiClient> | null) {
  const repo = createMockRepository({ session: { role: 'owner' } })
  render(<StoreProvider repository={repo}><ToastProvider><StaffApiProvider client={client as StaffApiClient | null}>
    <MemoryRouter initialEntries={['/owner/archive']}><AppRoutes /></MemoryRouter></StaffApiProvider></ToastProvider></StoreProvider>)
}

describe('الأرشفة السنوية (واجهة المالكة)', () => {
  it('بلا خادم: لا قسم للأرشفة السنوية', async () => {
    mount(null)
    await screen.findByRole('heading', { name: 'الأرشفة والتحقق' })
    expect(screen.queryByText('الأرشيف السنوي الكامل')).not.toBeInTheDocument()
  })
  it('مراحل الأرشيف المسجَّل ظاهرة، ولا إقرار فتح قبل التحقق من الملف المحفوظ', async () => {
    mount({ yearArchiveStatus: vi.fn(async () => ({ ok: true as const, value: [st()] })) })
    expect(await screen.findByText('الأرشيف السنوي الكامل')).toBeInTheDocument()
    expect(await screen.findByText(/حفظ كل الأجزاء على الجهاز والتحقق منها/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'التحقق من نسخة اللابتوب (اختيار المجلد)' })).toBeInTheDocument()
    expect(screen.getByText('athar-archive-x-20270620-part-02-of-02.zip')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /فتحتُ الأرشيف/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/نسخة ثانية على وسيط مستقل.*النسخة الثانية/)).not.toBeInTheDocument()
  })
  it('بوابة التصفير للعرض فقط: تُظهر الموانع بالعربية ولا يوجد أي زر تصفير', async () => {
    mount({ yearArchiveStatus: vi.fn(async () => ({ ok: true as const, value: [st()] })) })
    expect(await screen.findByText('التصفير غير متاح بعد')).toBeInTheDocument()
    expect(screen.getByText(/لم يُتحقق من حفظ كل الأجزاء على الجهاز/)).toBeInTheDocument()
    expect(screen.getByText(/أجزاء لم تُتحقق نسختها الثانية على وسيط مستقل \(2\)/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /تصفير|حذف/ })).not.toBeInTheDocument()
  })
  it('النسخة الثانية: بعد تحقق الحفظ يظهر تحذير الوسيط المستقل (قرص خارجي) وزر التحقق، ولا زر إقرار بلا تحقق', async () => {
    mount({ yearArchiveStatus: vi.fn(async () => ({ ok: true as const, value: [st({ downloadVerifiedAt: '2027-06-20T11:00:00Z' })] })) })
    expect(await screen.findByText(/مستقل عن هذا اللابتوب/)).toBeInTheDocument()
    expect(screen.getByText(/قرص خارجي/, { selector: 'p b, p, div' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /اختيار مجلد الهاردسك الخارجي والتحقق من النسخة الثانية/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /حفظتُ نسخة ثانية/ })).not.toBeInTheDocument()
  })
  it('بعد تحقق البصمة يظهر إقرار الفتح دون إنترنت، ويستدعي الإقرار', async () => {
    const ackYearArchive = vi.fn(async () => ({ ok: true as const, value: true as const }))
    mount({ yearArchiveStatus: vi.fn(async () => ({ ok: true as const, value: [st({ downloadVerifiedAt: '2027-06-20T11:00:00Z' })] })), ackYearArchive })
    await userEvent.click(await screen.findByRole('button', { name: /فتحتُ الأرشيف وجرّبته دون إنترنت/ }))
    expect(ackYearArchive).toHaveBeenCalledWith({ archiveId: 'A1', kind: 'opened_locally' })
  })
  it('فشل البناء يعرض رسالة السبب بالعربية دون تسجيل', async () => {
    const buildYearArchive = vi.fn(async () => ({ ok: false as const, error: 'rejected' as const, code: 'year_source_mismatch' }))
    const registerYearArchive = vi.fn()
    mount({ yearArchiveStatus: vi.fn(async () => ({ ok: true as const, value: [] })), buildYearArchive: buildYearArchive as unknown as StaffApiClient['buildYearArchive'], registerYearArchive: registerYearArchive as unknown as StaffApiClient['registerYearArchive'] })
    await userEvent.click(await screen.findByRole('button', { name: 'بناء الأرشيف السنوي وتسجيله' }))
    expect(await screen.findByText(/لا يطابق حجمه أو بصمته/)).toBeInTheDocument()
    await waitFor(() => expect(registerYearArchive).not.toHaveBeenCalled())
  })
})
