import { useMemo, useState } from 'react'
import { Ban, Copy, FileSpreadsheet, KeyRound, Palette, Pencil, Plus, Search, Trash2, Users } from 'lucide-react'
import { useStore } from '../../data/store'
import { describeCommandError } from '../../data/errors'
import { TEACHER_COLORS, type Teacher } from '../../data/types'
import { usePageState } from '../../lib/pageState'
import { Alert, Card, Chip, PageHeader } from '../../components/ui/misc'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Overlay'
import { Field, Input } from '../../components/ui/Field'
import { DataTable, type Column } from '../../components/ui/DataTable'
import { EmptyState, ErrorState, PageSkeleton } from '../../components/ui/States'
import { TeacherAvatar } from '../../components/domain/TeacherAvatar'
import { fmtDate } from '../../lib/format'
import { useToast } from '../../components/ui/Toast'
import { useStaffApi } from '../../lib/staffApi/StaffApiContext'
import { staffMessage } from '../../lib/staffApi/client'
import { cn } from '../../lib/cn'
import { TeacherImportDialog } from './TeacherImportDialog'

/** role: المالكة والمديرة كلتاهما تسجّل المعلمات وتصدر الرموز؛ حذف المعلمة بعد الأرشفة للمالكة وحدها (يفرضه الخادم والقاعدة أيضًا). */
export default function TeachersAdmin({ role = 'owner' }: { role?: 'owner' | 'director' }) {
  const { teachers, addTeacher, updateTeacher, reissueCode, revokeCode, reload, source } = useStore()
  // عند ضبط الواجهة الخادمية: الإصدار والإلغاء الحقيقيان عبر الخادم (المالكة والمديرة، بتدقيق دائم). وإلا يبقى الوضع «غير متاح» كما كان.
  const staffApi = useStaffApi()
  const unavailable = staffApi ? undefined : source.unavailable?.reissueCode
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const ps = usePageState('teachers-admin')
  const [form, setForm] = useState<{ id?: string; name: string; subject: string } | null>(null)
  const [errs, setErrs] = useState<{ name?: string; subject?: string }>({})
  const [colorFor, setColorFor] = useState<Teacher | null>(null)
  const [codeFor, setCodeFor] = useState<Teacher | null>(null)
  const [newCode, setNewCode] = useState<string | null>(null)
  const [revokeFor, setRevokeFor] = useState<Teacher | null>(null)
  const [removeFor, setRemoveFor] = useState<Teacher | null>(null)
  const [importing, setImporting] = useState(false)
  const [q, setQ] = useState('')
  const [statusF, setStatusF] = useState<'all' | 'active' | 'disabled' | 'nocode'>('all')
  const [sortBy, setSortBy] = useState<'status' | 'name' | 'subject'>('status')

  const sorted = useMemo(() => {
    const term = q.trim().toLowerCase()
    const list = teachers.filter((t) => (!term || `${t.name} ${t.subject}`.toLowerCase().includes(term))
      && (statusF === 'all' || (statusF === 'active' && t.active) || (statusF === 'disabled' && !t.active) || (statusF === 'nocode' && t.codeState !== 'active')))
    const byName = (a: Teacher, b: Teacher) => a.name.localeCompare(b.name, 'ar')
    return list.sort(sortBy === 'name' ? byName : sortBy === 'subject' ? (a, b) => a.subject.localeCompare(b.subject, 'ar') || byName(a, b) : (a, b) => Number(b.active) - Number(a.active) || byName(a, b))
  }, [teachers, q, statusF, sortBy])

  if (ps.phase === 'loading') return <PageSkeleton />
  if (ps.phase === 'error') return <ErrorState onRetry={ps.retry} />
  const data = ps.empty ? [] : sorted

  const save = async () => {
    const e: typeof errs = {}
    if (form!.name.trim().length < 3) e.name = 'يرجى إدخال اسم المعلمة.'
    if (!form!.subject.trim()) e.subject = 'يرجى إدخال المادة.'
    setErrs(e)
    if (e.name || e.subject) return
    try {
      if (form!.id) { await updateTeacher(form!.id, { name: form!.name.trim(), subject: form!.subject.trim() }); toast('تم حفظ التعديلات.') }
      else { await addTeacher(form!.name.trim(), form!.subject.trim()); toast(unavailable ? 'أُضيفت المعلمة.' : 'أُضيفت المعلمة. أصدري لها رمز دخول.') }
      setForm(null)
    } catch (e) { toast(describeCommandError(e), 'error') }
  }

  const issue = async (t: Teacher) => {
    if (!staffApi) { void reissueCode(t.id).then(setNewCode); return }
    setBusy(true)
    const r = await staffApi.issueCredentials(t.id)
    setBusy(false)
    if (!r.ok) { toast(staffMessage(r), 'error'); return }
    setNewCode(r.value.code)
    void reload()
  }
  const doRevoke = async (t: Teacher) => {
    if (!staffApi) { revokeCode(t.id); setRevokeFor(null); toast('أُلغي الرمز.'); return }
    setBusy(true)
    const r = await staffApi.revokeCredentials(t.id)
    setBusy(false)
    setRevokeFor(null)
    if (!r.ok) { toast(staffMessage(r), 'error'); return }
    toast('أُلغي الرمز وأُنهيت جلسات المعلمة.')
    void reload()
  }

  const doRemove = async (t: Teacher) => {
    if (!staffApi) return
    setBusy(true)
    const r = await staffApi.removeTeacher(t.id)
    setBusy(false)
    setRemoveFor(null)
    if (!r.ok) { toast(staffMessage(r), 'error'); return }
    toast('حُذفت المعلمة وأُبطل دخولها.')
    void reload()
  }

  const cols: Column<Teacher>[] = [
    { key: 'n', header: 'المعلمة', primary: true, className: 'w-[30%]', cell: (t) => (
      <span className="flex items-center gap-3"><TeacherAvatar teacher={t} size={36} /><span className="min-w-0"><span className={cn('block truncate font-medium', t.active ? 'text-steel-900' : 'text-ink-500')}>{t.name}</span><span className="block truncate text-[13px] font-normal text-ink-500">{t.subject}</span></span></span>
    ) },
    { key: 's', header: 'الحساب', cell: (t) => t.active ? <Chip tone="steel">فعّالة</Chip> : <Chip>موقوفة</Chip> },
    { key: 'c', header: 'رمز الدخول', cell: (t) => t.codeState === 'active'
      ? <span className="text-sm text-ink-600">صادر في {fmtDate(t.codeIssuedAt)}</span>
      : <span className="text-sm font-medium text-miss-fg">غير مُصدَر / ملغى</span> },
    { key: 'a', header: 'الإجراءات', className: 'w-[34%]', cell: (t) => (
      <span className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="secondary" icon={KeyRound} onClick={() => { setNewCode(null); setCodeFor(t) }} disabled={!t.active || !!unavailable} title={unavailable}>{t.codeState === 'active' ? 'إعادة إصدار' : 'إصدار رمز'}</Button>
        <Button size="sm" variant="ghost" icon={Palette} onClick={() => setColorFor(t)}>اللون</Button>
        <Button size="sm" variant="ghost" icon={Pencil} onClick={() => { setErrs({}); setForm({ id: t.id, name: t.name, subject: t.subject }) }}>تعديل</Button>
      </span>
    ) },
  ]

  return (
    <div className="space-y-5">
      <PageHeader title="المعلمات وأكواد الدخول" subtitle="إدارة قائمة المعلمات ورموز دخولهن وألوانهن."
        actions={<span className="flex flex-wrap gap-2">{staffApi && <Button variant="secondary" icon={FileSpreadsheet} onClick={() => setImporting(true)}>استيراد من Excel/CSV</Button>}<Button icon={Plus} onClick={() => { setErrs({}); setForm({ name: '', subject: '' }) }}>إضافة معلمة</Button></span>} />
      {unavailable && <Alert tone="info" title="إصدار الرموز غير متاح بعد">{unavailable}</Alert>}
      <Alert tone="info" title="عن رموز الدخول">
        الرمز واحد لكل معلمة (حرفان من اسمها ورقمان، مثل SA-12) وهو وحده يفتح صفحتها. يُعرض مرة واحدة عند إصداره ولا يمكن استرجاعه لاحقًا؛ عند الفقدان يُعاد إصدار رمز جديد ويُلغى القديم.
      </Alert>
      <Card as="div" className="flex flex-wrap items-end gap-3 p-3">
        <label className="relative min-w-[200px] flex-1"><span className="sr-only">بحث في المعلمات</span><Search className="pointer-events-none absolute start-3 top-3 size-4 text-ink-400" aria-hidden />
          <Input aria-label="بحث في المعلمات" placeholder="ابحثي بالاسم أو المادة" className="ps-9" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <label className="text-sm text-ink-600">الحالة <select aria-label="تصفية بالحالة" className="ms-1 rounded-xl border border-snow-300 bg-white px-2 py-2" value={statusF} onChange={(e) => setStatusF(e.target.value as typeof statusF)}>
          <option value="all">الكل</option><option value="active">فعّالة</option><option value="disabled">موقوفة</option><option value="nocode">بلا رمز دخول</option></select></label>
        <label className="text-sm text-ink-600">الترتيب <select aria-label="ترتيب القائمة" className="ms-1 rounded-xl border border-snow-300 bg-white px-2 py-2" value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)}>
          <option value="status">الحالة ثم الاسم</option><option value="name">الاسم</option><option value="subject">المادة</option></select></label>
      </Card>
      {data.length === 0 ? <Card as="div"><EmptyState icon={Users} title="لا توجد معلمات" text="ابدئي بإضافة المعلمات ثم أصدري لكل منهن رمز دخول." action={<Button icon={Plus} onClick={() => setForm({ name: '', subject: '' })}>إضافة معلمة</Button>} /></Card>
        : <DataTable caption="قائمة المعلمات" columns={cols} rows={data} rowKey={(t) => t.id} />}

      {data.length > 0 && (
        <p className="text-sm text-ink-500">لإيقاف معلمة أو إعادة تفعيلها افتحي «تعديل». الإيقاف يمنع دخولها فورًا ويُبقي ملفاتها كما هي.</p>
      )}

      <Dialog open={!!form} onClose={() => setForm(null)} title={form?.id ? 'تعديل بيانات المعلمة' : 'إضافة معلمة'}
        footer={<><Button variant="secondary" onClick={() => setForm(null)}>إلغاء</Button><Button onClick={save}>حفظ</Button></>}>
        {form && (
          <div className="space-y-4">
            <Field label="اسم المعلمة" required error={errs.name}>{({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} invalid={invalid} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-autofocus />}</Field>
            <Field label="المادة" required error={errs.subject}>{({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} invalid={invalid} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />}</Field>
            {form.id && (() => {
              const t = teachers.find((x) => x.id === form.id)!
              return (
                <div className="rounded-2xl bg-snow-100 p-3.5">
                  <p className="mb-2 text-sm text-ink-600">حالة الحساب: <span className="font-bold">{t.active ? 'فعّالة' : 'موقوفة'}</span></p>
                  <Button size="sm" variant="secondary" icon={Ban} onClick={() => { void updateTeacher(t.id, { active: !t.active }).then(() => { toast(t.active ? 'أُوقفت المعلمة ولا تستطيع الدخول.' : 'أُعيد تفعيل المعلمة.'); setForm(null) }).catch((e) => toast(describeCommandError(e), 'error')) }}>{t.active ? 'إيقاف المعلمة' : 'إعادة تفعيل المعلمة'}</Button>
                  {role !== 'owner'
                    ? <p className="text-[13px] text-ink-500">حذف المعلمة بعد الأرشفة للمالكة فقط.</p>
                    : staffApi
                    ? <Button size="sm" variant="danger" icon={Trash2} onClick={() => { setForm(null); setRemoveFor(t) }}>حذف المعلمة</Button>
                    : <p className="text-[13px] text-ink-500">حذف المعلمة غير متاح قبل ربط الواجهة الخادمية.</p>}
                  <p className="mt-2 text-[13px] text-ink-500">لا يتم الحذف إلا بعد أرشفة كل تسليمات المعلمة وتنزيل الأرشيف والتحقق من بصمته. لإيقاف دخولها فقط استعملي «إلغاء الرمز».</p>
                </div>
              )
            })()}
          </div>
        )}
      </Dialog>

      <Dialog open={!!colorFor} onClose={() => setColorFor(null)} title={`لون المعلمة: ${colorFor?.name ?? ''}`} description="يظهر اللون في الصورة الرمزية للمعلمة.">
        {colorFor && (
          <ul className="grid grid-cols-4 gap-3">
            {TEACHER_COLORS.map((c, i) => (
              <li key={c.name}>
                <button type="button" aria-pressed={colorFor.colorIdx === i} onClick={() => { const prev = colorFor; setColorFor({ ...colorFor, colorIdx: i }); void updateTeacher(prev.id, { colorIdx: i }).catch((e) => { setColorFor(prev); toast(describeCommandError(e), 'error') }) }}
                  className={cn('flex w-full flex-col items-center gap-1.5 rounded-2xl border-2 p-2.5 text-[13px]', colorFor.colorIdx === i ? 'border-steel-700 bg-steel-50' : 'border-transparent hover:bg-snow-100')}>
                  <TeacherAvatar teacher={{ name: colorFor.name, colorIdx: i }} size={44} />{c.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Dialog>

      <Dialog open={!!codeFor} onClose={() => { setCodeFor(null); setNewCode(null) }} title={newCode ? 'تم إصدار الرمز' : codeFor?.codeState === 'active' ? 'إعادة إصدار الرمز' : 'إصدار رمز دخول'} description={codeFor?.name}
        footer={newCode ? <Button onClick={() => { setCodeFor(null); setNewCode(null) }}>تم، سلّمتُ الرمز</Button> : <>
          {codeFor?.codeState === 'active' && <Button variant="ghost" icon={Ban} onClick={() => { setRevokeFor(codeFor); setCodeFor(null) }}>إلغاء الرمز دون إصدار جديد</Button>}
          <Button variant="secondary" onClick={() => setCodeFor(null)}>إلغاء</Button>
          <Button icon={KeyRound} loading={busy} onClick={() => void issue(codeFor!)}>{codeFor?.codeState === 'active' ? 'إصدار رمز جديد' : 'إصدار الرمز'}</Button></>}>
        {newCode ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-lav-300 bg-lav-100 p-5 text-center">
              <p dir="ltr" className="num select-all text-4xl font-bold tracking-[0.3em] text-steel-900">{newCode}</p>
            </div>
            <Button variant="secondary" icon={Copy} className="w-full" onClick={() => { navigator.clipboard?.writeText(newCode).catch(() => {}); toast('نُسخ الرمز.') }}>نسخ الرمز</Button>
            <Alert tone="warn">{staffApi ? 'يظهر الرمز الآن فقط ولا يمكن استرجاعه لاحقًا. سلّميه للمعلمة بطريقة تراها مناسبة؛ هو وحده يكفي لدخولها، فلا تشاركيه مع غيرها.' : 'يظهر هذا الرمز الآن فقط. سلّميه للمعلمة بطريقة تراها مناسبة. الرمز المعروض هنا توضيحي ولا يرتبط بأي نظام دخول فعلي حتى الآن.'}</Alert>
          </div>
        ) : codeFor?.codeState === 'active' ? (
          <Alert tone="warn" title="سيتوقف الرمز الحالي فورًا">لن تستطيع المعلمة الدخول بالرمز القديم بعد إصدار رمز جديد.</Alert>
        ) : <p className="text-[15px] text-ink-600">لا يوجد رمز دخول فعّال لهذه المعلمة. اضغطي «إصدار الرمز» لإنشاء رمز جديد.</p>}
      </Dialog>

      <Dialog open={!!removeFor} onClose={() => setRemoveFor(null)} title="حذف المعلمة" description={removeFor?.name}
        footer={<><Button variant="secondary" onClick={() => setRemoveFor(null)}>تراجع</Button><Button variant="danger" icon={Trash2} loading={busy} onClick={() => void doRemove(removeFor!)}>حذف المعلمة</Button></>}>
        <div className="space-y-3 text-[15px] text-ink-600">
          <p>يُمحى اسم المعلمة وتُزال من القوائم ويُبطل رمز دخولها وجلساتها. لا يمكن التراجع.</p>
          <p>لا يُسمح بالحذف إلا بعد أن تكون <b>كل</b> تسليماتها داخل أرشيف أُنشئ وتحقّق النظام منه ونُزِّل وتطابقت بصمته. إن لم يتحقق ذلك سيرفض النظام الحذف ويخبرك بالسبب.</p>
          <p>تبقى الملفات ونسخها محفوظة (بلا اسم المعلمة) إلى أن يُنفَّذ «التصفير السنوي» لسنتها.</p>
        </div>
      </Dialog>

      <Dialog open={!!revokeFor} onClose={() => setRevokeFor(null)} title="إلغاء رمز الدخول" description={revokeFor?.name}
        footer={<><Button variant="secondary" onClick={() => setRevokeFor(null)}>تراجع</Button><Button variant="danger" loading={busy} onClick={() => void doRevoke(revokeFor!)}>إلغاء الرمز</Button></>}>
        <p className="text-[15px] text-ink-600">لن تتمكن المعلمة من الدخول حتى يُصدَر لها رمز جديد. ملفاتها ونسخها السابقة تبقى كما هي.</p>
      </Dialog>
      {importing && staffApi && <TeacherImportDialog staffApi={staffApi} onClose={() => setImporting(false)} onDone={() => void reload()} />}
    </div>
  )
}
