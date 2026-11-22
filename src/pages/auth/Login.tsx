import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Eye, EyeOff, KeyRound, RotateCw } from 'lucide-react'
import { AuthHeading, AuthLayout } from '../../components/layout/AuthLayout'
import { Button } from '../../components/ui/Button'
import { Field, Input } from '../../components/ui/Field'
import { Alert } from '../../components/ui/misc'
import { Spinner } from '../../components/ui/States'
import { useStore } from '../../data/store'
import { VolatileDataNotice } from '../../components/domain/VolatileDataNotice'
import { useAuthController, useAuthState } from '../../lib/auth/AuthContext'
import { describeAuthError } from '../../lib/auth/controller'
import { useTeacherPortal } from '../../lib/teacherAuth/TeacherPortalContext'

/**
 * (r37) مساران منفصلان بلا خلط:
 *  - /login        دخول المعلمات: **رمز واحد فقط** (حرفان من الاسم + رقمان، مثل SA-12) — لا بريد ولا كلمة مرور ولا رقم سري.
 *  - /login/staff  دخول الإدارة (المالكة والمديرة): بريد وكلمة مرور (Supabase Auth + تأكيد الدور من الخادم).
 * لا تغيير في أي شرط أمني: كل مسار يمرّ بنفس تحققه الخادمي.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function Shell({ title, children, other }: { title: string; children: ReactNode; other: ReactNode }) {
  return (
    <AuthLayout>
      <AuthHeading title={title} />
      <div className="rounded-3xl border border-paper-300 bg-white p-6 shadow-soft sm:p-8">{children}</div>
      <VolatileDataNotice className="mt-4" />
      <div className="mt-5 flex flex-col items-center gap-1 text-[15px]">
        {other}
        <Link to="/" className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 font-medium text-forest-800 hover:underline"><ArrowRight className="size-4" aria-hidden />العودة إلى الصفحة الرئيسية</Link>
      </div>
    </AuthLayout>
  )
}

/** انتقال تلقائي بعد نجاح أي من الجلستين، ومعالجة حالات التحميل المشتركة. يعيد عنصرًا إن كان يجب عرضه بدل النموذج. */
function useSharedPhases(): ReactNode | null {
  const { load } = useStore()
  const auth = useAuthController()
  const state = useAuthState()
  const portal = useTeacherPortal()
  const go = useNavigate()

  useEffect(() => { if (state.phase === 'authorized') go(`/${state.role}`, { replace: true }) }, [state, go])
  useEffect(() => { if (portal.phase === 'signed_in') go('/teacher/portal', { replace: true }) }, [portal.phase, go])

  // عند عودة الاتصال أثناء عطل مؤقت: إعادة المحاولة تلقائيًا (الجلسة محفوظة؛ لا كلمة مرور جديدة).
  const failed = state.phase === 'check_failed'
  useEffect(() => {
    if (!failed || !auth) return
    const on = () => { void auth.retry() }
    window.addEventListener('online', on)
    return () => window.removeEventListener('online', on)
  }, [failed, auth])

  // لا مسار دخول متاح إطلاقًا: إعدادات الاتصال غير مكتملة.
  if (!auth && !portal.configured) {
    return (
      <Alert tone="danger" title="الاتصال بقاعدة البيانات غير مُعدّ">
        {load.phase === 'error' ? load.message : 'إعدادات الاتصال غير مكتملة.'} راجعي ملف <bdi dir="ltr" className="font-mono text-[13px]">docs/ENV_LOCAL_AR.md</bdi> لإعداد <bdi dir="ltr" className="font-mono text-[13px]">.env.local</bdi> ثم أعيدي تشغيل الخادم.
      </Alert>
    )
  }
  if (state.phase === 'initializing' || state.phase === 'authorized' || portal.phase === 'initializing' || portal.phase === 'signed_in') {
    return <div className="py-6 text-center"><Spinner label={state.phase === 'authorized' || portal.phase === 'signed_in' ? 'جارٍ الانتقال…' : 'جارٍ التحقق من الجلسة…'} /></div>
  }
  if (state.phase === 'check_failed' && auth) {
    return (
      <div className="space-y-4">
        <Alert tone="warn" title="تعذّر التحقق من الجلسة مؤقتًا">
          {describeAuthError(state.error) ?? 'حدث عطل مؤقت.'} جلستكِ محفوظة ولم يُسمح بالدخول بعد؛ لا حاجة لإدخال كلمة المرور من جديد. أعيدي المحاولة.
        </Alert>
        <Button className="w-full" icon={RotateCw} loading={state.busy} onClick={() => auth.retry()}>إعادة المحاولة</Button>
        <Button className="w-full" variant="ghost" onClick={() => auth.signOut()}>تسجيل الخروج</Button>
      </div>
    )
  }
  return null
}

const primary = 'h-12 w-full rounded-full !bg-forest-800 text-base font-bold text-white hover:!bg-forest-900 active:!bg-forest-900'

/** دخول المعلمات: حقل واحد للرمز. */
export function TeacherLogin() {
  return (
    <Shell title="تسجيل الدخول" other={null}>
      <TeacherBody />
    </Shell>
  )
}

function TeacherBody() {
  const portal = useTeacherPortal()
  const auth = useAuthController()
  const shared = useSharedPhases()
  const [code, setCode] = useState('')
  const [err, setErr] = useState<string | null>(null)
  if (shared) return <>{shared}</>

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr(null)
    if (!code.trim()) { setErr('يرجى إدخال رمز الدخول.'); return }
    if (!portal.configured) { setErr('تعذّر الدخول بهذا الرمز.'); return }
    // صندوق موحَّد: الخادم يقرّر النوع من الرمز نفسه؛ الواجهة لا تذكر أي دور.
    const r = await portal.loginAny(code.trim())
    if (typeof r === 'object') {
      if (!auth) { setErr('تعذّر الدخول بهذا الرمز.'); return }
      await auth.signInWithTokens(r.accessToken, r.refreshToken)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <Field label="رمز الدخول" error={err} hint="اكتبي رمز الدخول الخاص بكِ.">
        {({ id, describedBy, invalid }) => (
          <Input id={id} aria-describedby={describedBy} invalid={invalid} dir="ltr" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={128}
            placeholder="رمز الدخول" value={code} onChange={(e) => setCode(e.target.value)} className="h-14 text-center text-xl font-bold tracking-wide placeholder:font-normal" />
        )}
      </Field>
      {portal.error && <Alert tone="danger">{portal.error}</Alert>}
      <Button type="submit" icon={KeyRound} loading={portal.busy} className={primary}>دخول</Button>
    </form>
  )
}

/** دخول الإدارة (المالكة والمديرة): بريد وكلمة مرور. */
export function StaffLogin() {
  return (
    <Shell title="دخول الإدارة" other={<Link to="/login" className="rounded-lg px-3 py-2 text-forest-700 underline-offset-4 hover:underline">دخول المعلمات برمز الدخول</Link>}>
      <StaffBody />
      <p className="mt-4 text-center text-[13px] text-ink-500">الحسابات تُنشأ من إدارة المنصة فقط. لا يوجد تسجيل ذاتي.</p>
    </Shell>
  )
}

function StaffBody() {
  const auth = useAuthController()
  const state = useAuthState()
  const shared = useSharedPhases()
  const [email, setEmail] = useState('')
  const [secret, setSecret] = useState('')
  const [show, setShow] = useState(false)
  const [errs, setErrs] = useState<{ email?: string; secret?: string }>({})
  const [localError, setLocalError] = useState<string | null>(null)
  if (shared) return <>{shared}</>

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const who = email.trim()
    const next: typeof errs = {}
    if (!who) next.email = 'يرجى إدخال البريد الإلكتروني.'
    else if (!EMAIL_RE.test(who)) next.email = 'يرجى إدخال بريد إلكتروني صحيح.'
    if (!secret) next.secret = 'يرجى إدخال كلمة المرور.'
    setErrs(next)
    setLocalError(null)
    if (next.email || next.secret) return
    if (!auth) { setLocalError('تعذّر الدخول بهذه البيانات.'); return }
    await auth.signIn(who, secret)
  }
  const error = localError ?? describeAuthError(state.error)

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <Field label="البريد الإلكتروني" error={errs.email}>
        {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} invalid={invalid} type="email" dir="ltr" autoComplete="username" autoCapitalize="none" spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} className="text-start" />}
      </Field>
      <Field label="كلمة المرور" error={errs.secret}>
        {({ id, describedBy, invalid }) => (
          <div className="relative">
            <Input id={id} aria-describedby={describedBy} invalid={invalid} type={show ? 'text' : 'password'} dir="ltr" autoComplete="current-password" value={secret} onChange={(e) => setSecret(e.target.value)} className="pe-12 text-start" />
            <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'} className="absolute end-1 top-1 inline-flex size-9 items-center justify-center rounded-lg text-ink-500 hover:bg-paper-200">
              {show ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
            </button>
          </div>
        )}
      </Field>
      {error && <Alert tone="danger">{error}</Alert>}
      <Button type="submit" loading={state.busy} className={primary}>دخول</Button>
    </form>
  )
}

export default TeacherLogin
