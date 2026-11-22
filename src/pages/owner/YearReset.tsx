// صفحة «التصفير السنوي» (A-118): حذف بيانات سنة دراسية واحدة من Cloud (قاعدة البيانات وR2) بعد اكتمال أرشيفها المحلي ونسختيه المتحقَّق منهما.
// الحذف ينفّذه الخادم وحده بعد بوابة صارمة؛ هذه الصفحة تعرض الحالة والتقرير وتطلب تأكيدًا مكتوبًا، وتستأنف العملية على شرائح حتى تكتمل أو تتوقف بسبب.
// لا تظهر بلا الواجهة الخادمية. تحذف حسابات المعلمات اللاتي لا أثر لهن في سنة أخرى؛ ولا تحذف حساب المالكة/المديرة.
import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2, Circle, RotateCw, ShieldAlert, Trash2 } from 'lucide-react'
import { useStore } from '../../data/store'
import { usePageState } from '../../lib/pageState'
import { Alert, Card, PageHeader } from '../../components/ui/misc'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Overlay'
import { Field } from '../../components/ui/Field'
import { ErrorState, PageSkeleton } from '../../components/ui/States'
import { fmtSize } from '../../lib/format'
import { cn } from '../../lib/cn'
import { useToast } from '../../components/ui/Toast'
import { useStaffApi } from '../../lib/staffApi/StaffApiContext'
import { staffMessage } from '../../lib/staffApi/client'
import type { StaffApiClient, YearResetReport, YearResetState, YearResetStatus } from '../../lib/staffApi/client'
import { gateText } from './YearArchivePanel'

const STATE_TEXT: Record<YearResetState, string> = {
  not_started: 'لم يبدأ', ready: 'جاهز للتصفير', running: 'قيد التنفيذ', partial: 'اكتمل جزئيًا — يحتاج استئنافًا', failed: 'فشل — يحتاج استئنافًا', completed: 'اكتمل',
}
const TABLE_TEXT: Record<string, string> = {
  upload_attempts: 'سجلات محاولات الرفع', upload_sessions: 'جلسات الرفع', versions: 'الإصدارات', submissions: 'التسليمات', archive_entries: 'عناصر الأرشيف في Cloud',
  archive_parts: 'أجزاء الأرشيف في Cloud', archives: 'سجلات الأرشيف في Cloud', deletion_requests: 'طلبات الحذف القديمة', r2_objects: 'ملفات في R2', teachers: 'حسابات المعلمات',
}
const STAYS_TEXT: Record<string, string> = { staff_accounts: 'حسابا المالكة والمديرة', teachers: 'معلمات لهن بيانات في سنة أخرى (يبقين)', other_years_versions: 'إصدارات السنوات الأخرى' }
const MAX_ROUNDS = 400

function Row({ ok, children }: { ok: boolean; children: string }) {
  const Icon = ok ? CheckCircle2 : Circle
  return <li className={cn('flex items-start gap-2.5 text-[15px]', ok ? 'text-ok-fg' : 'text-late-fg')}><Icon className="mt-1 size-4 shrink-0" aria-hidden /><span>{children}</span></li>
}

export default function YearResetPage() {
  const staffApi = useStaffApi()
  const { years } = useStore()
  const ps = usePageState('yearreset')
  const toast = useToast()
  const [yearId, setYearId] = useState<string>('')
  const [status, setStatus] = useState<YearResetStatus | null>(null)
  const [report, setReport] = useState<YearResetReport | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [running, setRunning] = useState(false)
  const stop = useRef(false)

  const year = years.find((y) => y.id === yearId)
  const load = useCallback(async (id: string) => {
    if (!staffApi || !id) return
    setLoadErr(null)
    const s = await staffApi.yearResetStatus(id)
    if (!s.ok) { setStatus(null); setReport(null); setLoadErr(staffMessage(s)); return }
    setStatus(s.value)
    if (s.value.state === 'completed') { setReport(null); return }
    const r = await staffApi.yearResetReport(id)
    setReport(r.ok ? r.value : null)
  }, [staffApi])
  useEffect(() => { if (yearId) void load(yearId) }, [yearId, load])
  useEffect(() => () => { stop.current = true }, [])

  if (ps.phase === 'loading') return <PageSkeleton rows={2} />
  if (ps.phase === 'error') return <ErrorState onRetry={ps.retry} />
  if (!staffApi) return (
    <div className="space-y-5"><PageHeader title="التصفير السنوي" subtitle="حذف بيانات سنة دراسية من Cloud بعد حفظ أرشيفها محليًا." />
      <Alert tone="info" title="غير متاح">التصفير يحتاج ضبط الواجهة الخادمية (START_HERE §7–8).</Alert></div>
  )

  const loop = async (first: () => ReturnType<StaffApiClient['yearResetStart']>) => {
    setRunning(true); stop.current = false
    try {
      let r = await first()
      for (let i = 0; i < MAX_ROUNDS && r.ok && !r.value.done && !stop.current; i++) {
        setStatus(r.value.status)
        if (r.value.status.state === 'partial' || r.value.status.state === 'failed') {
          // تقدّم بلا فشل جديد ⇒ نكرر؛ إن بقي مفتاح فاشل نتوقف ونعرض السبب (لا حلقة لا نهائية)
          if (r.value.status.reset && r.value.status.reset.keys.failed > 0 && r.value.status.reset.keys.pending === 0 && r.value.status.reset.keys.deleted === 0) break
        }
        r = await staffApi.yearResetResume(yearId)
      }
      if (!r.ok) { toast(staffMessage(r), 'info'); await load(yearId); return }
      setStatus(r.value.status)
      toast(r.value.done ? 'اكتمل التصفير.' : 'توقف التصفير قبل الاكتمال. راجعي السبب ثم اضغطي «استئناف التصفير».', 'info')
    } finally { setRunning(false) }
  }
  const begin = () => { setOpen(false); void loop(() => staffApi.yearResetStart(yearId)) }
  const resume = () => void loop(() => staffApi.yearResetResume(yearId))

  const st = status
  const done = st?.state === 'completed'
  const started = !!st?.reset && !done
  const k = st?.reset?.keys

  return (
    <div className="space-y-5">
      <PageHeader title="التصفير السنوي" subtitle="حذف بيانات سنة دراسية واحدة من Cloud (قاعدة البيانات وR2). يُنصح بالأرشفة أولًا لكنها غير مشترطة." />
      <Alert tone="danger" title="لا تراجع بعد التصفير">
        لا يبقى في Cloud بعد التصفير إلا سجل إغلاق موجز (اسم السنة وتاريخ الإغلاق ونتيجة التحقق وبصمات مرجعية). أرشيفكِ المحلي (إن بنيتِه) هو المرجع الوحيد لمحتوى السنة.
        تُحذف أيضًا حسابات المعلمات (الاسم والرمز) فتبدأ السنة الجديدة بقائمة معلمات جديدة تُستورد من Excel. تبقى حسابات المالكة والمديرة والإعدادات كما هي.
      </Alert>

      <Card className="space-y-3 p-4 sm:p-5" as="section">
        <Field label="السنة الدراسية المراد تصفيرها">{({ id }) => (
          <select id={id} className="w-full rounded-xl border border-snow-300 bg-white px-3 py-2.5 text-[15px]" value={yearId} onChange={(e) => { setStatus(null); setReport(null); setYearId(e.target.value) }} disabled={running}>
            <option value="">اختاري السنة…</option>
            {years.map((y) => <option key={y.id} value={y.id}>{y.label}{y.active ? ' (نشطة)' : ''}</option>)}
          </select>)}
        </Field>
        {loadErr && <Alert tone="danger" title="تعذّر تحميل الحالة">{loadErr}</Alert>}
      </Card>

      {st && (
        <Card className="space-y-4 p-4 sm:p-5" as="section" aria-label="حالة التصفير">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-steel-900">حالة التصفير: {STATE_TEXT[st.state]}</h2>
          </div>

          {!done && !started && (
            <>
              <h3 className="font-bold text-steel-900">شروط التصفير</h3>
              {st.gate.problems.length === 0
                ? <ul className="space-y-2">
                    {st.gate.archiveId
                      ? <Row ok>أُرشفت السنة وسُجّل أرشيفها. ولا رفع معلّق. يمكنكِ التصفير الآن.</Row>
                      : <Row ok>لا رفع معلّق. يمكنكِ التصفير الآن (الأرشفة غير مشترطة).</Row>}
                  </ul>
                : <ul className="space-y-2" aria-label="موانع التصفير">{st.gate.problems.map((p) => <Row key={p} ok={false}>{gateText(p)}</Row>)}</ul>}
              {st.gate.problems.length === 0 && !st.gate.archiveId && (
                <Alert tone="warn" title="لم تُبنَ نسخة أرشيف لهذه السنة">التصفير سيحذف ملفات السنة وتسليماتها من Cloud نهائيًا ولن تبقى منها أي نسخة. إن أردتِ الاحتفاظ بها فابني الأرشيف من صفحة «الأرشفة» أولًا.</Alert>
              )}
            </>
          )}

          {report && !done && (
            <div className="space-y-3">
              <h3 className="font-bold text-steel-900">تقرير ما قبل التصفير</h3>
              <p className="text-[15px] text-ink-700">السنة <b>{report.yearLabel}</b> · <span className="num">{report.teachers}</span> معلمة · <span className="num">{report.submissions}</span> تسليمًا · <span className="num">{report.versions}</span> إصدارًا ({report.files} ملف و{report.links} رابط) · <span className="num">{fmtSize(report.fileBytes)}</span> · أرشيف بـ<span className="num">{report.archivePartsCount}</span> جزء</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-late-line bg-late-bg p-3"><p className="mb-1 text-[13px] font-bold text-late-fg">سيُحذف</p>
                  <ul className="space-y-0.5 text-[14px]">{Object.entries(report.toDelete).map(([t, n]) => <li key={t}>{TABLE_TEXT[t] ?? t}: <span className="num">{n}</span></li>)}</ul></div>
                <div className="rounded-2xl border border-ok-line bg-ok-bg p-3"><p className="mb-1 text-[13px] font-bold text-ok-fg">سيبقى</p>
                  <ul className="space-y-0.5 text-[14px]">{Object.entries(report.stays).filter(([t]) => t !== 'audit_log').map(([t, n]) => <li key={t}>{STAYS_TEXT[t] ?? t}: <span className="num">{n}</span></li>)}</ul></div>
              </div>
              {report.archiveParts.length > 0 && (
                <details className="text-[14px]"><summary className="cursor-pointer font-medium">نتيجة التحقق من الأجزاء ({report.archiveParts.length})</summary>
                  <ul className="mt-2 space-y-1">{report.archiveParts.map((p) => <li key={p.part} className="num">جزء {p.part}: حفظ على الجهاز {p.downloadVerified ? '✓' : '✗'} · نسخة ثانية {p.copyVerified ? '✓' : '✗'}{p.copyMedium ? ` (${p.copyMedium})` : ''}</li>)}</ul></details>
              )}
              <Button variant="danger" icon={Trash2} disabled={!st.gate.ready || running} onClick={() => setOpen(true)}>تصفير هذه السنة</Button>
            </div>
          )}

          {started && st.reset && k && (
            <div className="space-y-3" aria-live="polite">
              <p className="text-[15px]">ملفات R2: <span className="num">{k.verifiedAbsent}</span> من <span className="num">{k.total}</span> حُذفت وتُحقق من غيابها{k.failed > 0 ? <> · <b className="text-late-fg">فشل <span className="num">{k.failed}</span></b></> : null}</p>
              <progress className="h-2 w-full" max={Math.max(k.total, 1)} value={k.verifiedAbsent} aria-label="تقدّم حذف ملفات R2" />
              <p className="text-[13px] text-ink-500">المرحلة: {st.reset.phase === 'files' ? 'حذف الملفات من R2' : st.reset.phase === 'database' ? 'حذف بيانات القاعدة' : 'منتهية'}. السنة مقفلة للكتابة أثناء التصفير.</p>
              {st.reset.lastError && <Alert tone="warn" title="سبب التوقف">{st.reset.lastError}</Alert>}
              <Button icon={RotateCw} loading={running} onClick={resume}>استئناف التصفير</Button>
              <p className="text-[13px] text-ink-500">الاستئناف آمن ويُكرَّر بلا ضرر: لا يُعدّ ملف محذوفًا حتى يُتحقق من غيابه، ولا تُحذف بيانات القاعدة حتى تنتهي كل الملفات.</p>
            </div>
          )}

          {done && st.closure && (
            <div className="space-y-3">
              <Alert tone="info" title="اكتمل التصفير">أُغلقت السنة {st.closure.yearLabel}. لم يبقَ في Cloud إلا هذا السجل الموجز.</Alert>
              <ul className="space-y-1 text-[14px]">
                <li>تاريخ الإغلاق: <span className="num" dir="ltr">{st.closure.closedAt}</span></li>
                <li>الأرشيف: {st.closure.archiveTitle ?? '—'}</li>
                <li>المحذوف: {Object.entries(st.closure.deleted).map(([t, n]) => `${TABLE_TEXT[t] ?? t} ${n}`).join(' · ')}</li>
                <li>أجزاء الأرشيف المرجعية: <span className="num">{st.closure.parts.length}</span> (البصمات محفوظة للمقارنة فقط)</li>
              </ul>
              <p className="text-[14px] text-ink-600">الخطوة التالية: أنشئي السنة الجديدة وفعّليها من «السنوات والفصول».</p>
            </div>
          )}
        </Card>
      )}

      {!st && yearId && !loadErr && <PageSkeleton rows={1} />}
      {!yearId && <Card as="div" className="p-5"><p className="flex items-center gap-2 text-ink-600"><ShieldAlert className="size-5" aria-hidden />اختاري سنة لعرض حالتها.</p></Card>}

      <Dialog open={open} onClose={() => setOpen(false)} title={`تصفير السنة ${year?.label ?? ''}`} description="تأكيد واحد، ثم يعمل التصفير تلقائيًا حتى يكتمل."
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>تراجع</Button><Button variant="danger" icon={Trash2} disabled={!year} onClick={begin}>نعم، صفّري السنة</Button></>}>
        <Alert tone="danger" title="هذا الإجراء لا يمكن التراجع عنه">ستُحذف ملفات السنة من R2 وبياناتها من قاعدة البيانات نهائيًا. الأرشيف المحلي ونسخته الثانية المتحقَّق منهما هما المرجع الوحيد بعد ذلك.</Alert>
      </Dialog>
    </div>
  )
}
