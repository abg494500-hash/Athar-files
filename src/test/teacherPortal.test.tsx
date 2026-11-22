// اختبار واجهة بوابة المعلمة بعميل حقيقي فوق fetch وهمي. **كُتب ولم يُشغَّل** (لا npm/vitest في بيئة الكتابة): يُشغَّل على جهازكِ ضمن npm test.
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { StoreProvider } from '../data/store'
import { createMockRepository, MOCK_NOW } from './mock'
import { ToastProvider } from '../components/ui/Toast'
import { AppRoutes } from '../App'
import { createTeacherApiClient } from '../lib/teacherAuth/client'
import { TeacherPortalProvider } from '../lib/teacherAuth/TeacherPortalContext'

const TOKEN = 'B'.repeat(43)
const portfolio = {
  teacher: { id: 't1', name: 'معلمة الاختبار', subject: 'علوم' }, serverNow: '2026-10-24T08:00:00.000Z',
  terms: [{ id: 'term-1', name: 'الفصل الأول', ord: 1, deadlines: { base: '2026-10-20', late: '2026-10-30', replace: '2026-11-15' }, phase: 'late_window',
    slots: [{ slotId: 'plan', title: 'خطة العمل', optional: false, state: 'on_time', gate: 'on_time', canSubmit: false, canReplace: true,
      versions: [{ id: 'v1', no: 1, kind: 'file', name: 'خطة.pdf', sizeBytes: 2048, ext: 'pdf', url: null, status: 'on_time', submittedAt: '2026-10-10T00:00:00.000Z', downloadable: true }] }] }],
}

const deleteBodies: string[] = []
function fakeClient(loginOk: boolean) {
  const store = new Map<string, string>()
  const calls: string[] = []
  const f = (async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname.replace('/api', ''); calls.push(`${init.method} ${path}`)
    if (path === '/teacher/login' || path === '/auth/login') return loginOk ? new Response(JSON.stringify({ kind: 'teacher', token: TOKEN, teacher: { id: 't1', name: 'معلمة الاختبار' } }), { status: 200 }) : new Response(JSON.stringify({ error: 'login_failed' }), { status: 401 })
    if (path === '/teacher/me') return new Response(JSON.stringify({ teacher: { id: 't1', name: 'معلمة الاختبار' } }), { status: 200 })
    if (path === '/teacher/portfolio') return new Response(JSON.stringify({ portfolio }), { status: 200 })
    if (path === '/teacher/versions/delete') { deleteBodies.push(String(init.body)); return new Response(JSON.stringify({ deleted: true }), { status: 200 }) }
    if (path === '/teacher/logout') return new Response(null, { status: 204 })
    return new Response('{}', { status: 404 })
  }) as unknown as typeof fetch
  const client = createTeacherApiClient({ baseUrl: 'https://api.example.org/api', fetchImpl: f, storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: (k) => void store.delete(k) } })
  return { client, calls }
}

function mount(path: string, client: ReturnType<typeof createTeacherApiClient> | null) {
  return render(
    <StoreProvider repository={createMockRepository({ session: null, now: MOCK_NOW })}><ToastProvider><TeacherPortalProvider client={client}>
      <MemoryRouter initialEntries={[path]}><AppRoutes /></MemoryRouter>
    </TeacherPortalProvider></ToastProvider></StoreProvider>,
  )
}

describe('دخول المعلمة وبوابتها (عميل حقيقي، fetch وهمي)', () => {
  it('بلا واجهة خادمية مضبوطة ولا مصادقة: رسالة نقص الإعداد فقط ولا نموذج دخول', async () => {
    mount('/login', null)
    expect(await screen.findByText('الاتصال بقاعدة البيانات غير مُعدّ')).toBeInTheDocument()
    expect(screen.queryByLabelText('رمز الدخول')).not.toBeInTheDocument()
  })
  it('شاشة الدخول موحّدة: لا تبويبات ولا ذكر لنوع الحساب', async () => {
    const { client } = fakeClient(true)
    mount('/login', client)
    expect(await screen.findByLabelText('رمز الدخول')).toBeInTheDocument()
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('كلمة المرور')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('البريد الإلكتروني')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'دخول' })).toHaveLength(1)
  })
  it('مع واجهة مضبوطة: النموذج يظهر، والدخول الناجح ينقل إلى البوابة ويعرض الفصل والخانة', async () => {
    const { client } = fakeClient(true)
    mount('/login', client)
    await userEvent.type(await screen.findByLabelText('رمز الدخول'), 'SA-12')
    await userEvent.click(screen.getByRole('button', { name: 'دخول' }))
    expect(await screen.findByText('الفصل الأول')).toBeInTheDocument()
    expect(screen.getByText('خطة العمل')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /تنزيل/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /استبدال بملف جديد/ })).toBeInTheDocument() // canReplace=true من الخادم
    expect(screen.getByRole('button', { name: /استبدال برابط/ })).toBeInTheDocument()
  })
  it('حذف الملف نهائيًا (A-126): تأكيد واحد ثم طلب بمعرّف الإصدار وحده', async () => {
    const { client } = fakeClient(true)
    mount('/login', client)
    await userEvent.type(await screen.findByLabelText('رمز الدخول'), 'SA-12')
    await userEvent.click(screen.getByRole('button', { name: 'دخول' }))
    await screen.findByText('الفصل الأول')
    deleteBodies.length = 0
    await userEvent.click(screen.getByRole('button', { name: /حذف الملف/ }))
    expect(deleteBodies).toEqual([]) // لا طلب قبل التأكيد
    expect(await screen.findByText(/سيُحذف الملف نهائيًا ولا يمكن استرجاعه/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'نعم، احذفي' }))
    expect(await screen.findByText(/تم حذف الملف نهائيًا/)).toBeInTheDocument()
    expect(deleteBodies.map((b) => JSON.parse(b))).toEqual([{ versionId: 'v1' }])
  })
  it('فشل الدخول: رسالة موحّدة ولا انتقال', async () => {
    const { client } = fakeClient(false)
    mount('/login', client)
    await userEvent.type(await screen.findByLabelText('رمز الدخول'), 'ZZ-99')
    await userEvent.click(screen.getByRole('button', { name: 'دخول' }))
    expect(await screen.findByText('تعذّر الدخول، تحققي من الرمز.')).toBeInTheDocument()
    expect(screen.queryByText('الفصل الأول')).not.toBeInTheDocument()
  })
  it('البوابة بلا جلسة تُحوِّل إلى الدخول', async () => {
    const { client } = fakeClient(true)
    mount('/teacher/portal', client)
    expect(await screen.findByRole('heading', { name: 'تسجيل الدخول' })).toBeInTheDocument()
  })
})
