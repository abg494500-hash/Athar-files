import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarPlus, CheckCircle2, Pencil } from 'lucide-react'
import { useStore } from '../../data/store'
import { describeCommandError } from '../../data/errors'
import { usePageState } from '../../lib/pageState'
import { Alert, Card, Chip, PageHeader } from '../../components/ui/misc'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Overlay'
import { Field, Input } from '../../components/ui/Field'
import { ErrorState, PageSkeleton } from '../../components/ui/States'
import { fmtDay } from '../../lib/format'
import { useToast } from '../../components/ui/Toast'
import { useStaffApi } from '../../lib/staffApi/StaffApiContext'
import { staffMessage } from '../../lib/staffApi/client'
import type { YearForm } from '../../lib/staffApi/client'
import { YearFormDialog, defaultYearForm } from './YearFormDialog'

export default function YearsTerms() {
  const { years, terms, currentTermId, setActiveYear, addYear, setCurrentTerm, source, reload, session } = useStore()
  const staffApi = useStaffApi()
  const [form, setForm] = useState<{ id?: string; initial: YearForm } | null>(null)
  const toast = useToast()
  const ps = usePageState('years')
  const [adding, setAdding] = useState(false)
  const [label, setLabel] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [activate, setActivate] = useState<string | null>(null)

  if (ps.phase === 'loading') return <PageSkeleton rows={3} />
  if (ps.phase === 'error') return <ErrorState onRetry={ps.retry} />

  const create = async () => {
    const v = label.trim().replace('-', '–')
    if (!/^\d{4}–\d{4}$/.test(v)) { setErr('اكتبي السنة بصيغة 2027–2028'); return }
    const [a, b] = v.split('–').map(Number)
    if (b !== a + 1) { setErr('السنة الثانية يجب أن تلي الأولى مباشرة.'); return }
    if (years.some((y) => y.label.replace(/[\u2066\u2069\u2060]/g, '') === v)) { setErr('هذه السنة موجودة بالفعل.'); return }
    try { await addYear(v); setAdding(false); setLabel(''); setErr(null); toast('أُضيفت السنة مع فصليها الدراسيين.') }
    catch (e) { setErr(describeCommandError(e)) }
  }
  const target = years.find((y) => y.id === activate)

  return (
    <div className="space-y-6">
      <PageHeader title="السنوات الدراسية والفصول" subtitle="سنة دراسية نشطة واحدة في كل مرة، ولكل سنة فصلان." actions={<Button icon={CalendarPlus} onClick={() => staffApi ? setForm({ initial: defaultYearForm(Math.max(new Date().getFullYear(), ...years.map((y) => parseInt(y.label, 10) + 1).filter(Number.isFinite))) }) : setAdding(true)}>إضافة سنة</Button>} />
      <div className="space-y-5">
        {years.map((y) => (
          <Card key={y.id} className="p-4 sm:p-5" as="article">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-bold text-steel-900">{y.label}</h2>
                {y.active ? <Chip tone="steel">السنة النشطة</Chip> : <Chip>غير نشطة</Chip>}
              </div>
              <span className="flex flex-wrap gap-2">
                {staffApi && <Button size="sm" variant="ghost" icon={Pencil} onClick={() => { const ts = terms.filter((t) => t.yearId === y.id).sort((a, b) => a.order - b.order); if (ts.length === 2) setForm({ id: y.id, initial: { label: y.label, startsOn: null, endsOn: null, terms: ts.map((t) => ({ ord: t.order, name: t.name, deadlineBase: t.deadlines.base, deadlineLate: t.deadlines.late, deadlineReplace: t.deadlines.replace })) as YearForm['terms'] } }) }}>تعديل السنة</Button>}
                {!y.active && <Button size="sm" variant="secondary" icon={CheckCircle2} onClick={() => setActivate(y.id)}>تفعيل هذه السنة</Button>}
              </span>
            </div>
            <ul className="grid gap-3 md:grid-cols-2">
              {terms.filter((t) => t.yearId === y.id).map((t) => (
                <li key={t.id} className="rounded-2xl border border-snow-300 bg-snow-50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-bold text-steel-900">{t.name}</p>
                    {t.id === currentTermId && <Chip tone="lav">الفصل الحالي</Chip>}
                  </div>
                  <dl className="mt-3 space-y-1.5 text-sm">
                    <div className="flex justify-between gap-3"><dt className="text-ink-500">الموعد الأساسي</dt><dd className="font-medium">{fmtDay(t.deadlines.base)}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-ink-500">آخر تسليم متأخر</dt><dd className="font-medium">{fmtDay(t.deadlines.late)}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-ink-500">آخر استبدال</dt><dd className="font-medium">{fmtDay(t.deadlines.replace)}</dd></div>
                  </dl>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link to={`/${session?.role === 'director' ? 'director' : 'owner'}/deadlines`} className="inline-flex h-10 items-center gap-2 rounded-xl border border-steel-300 bg-white px-3.5 text-sm font-medium text-steel-900 hover:bg-steel-50"><Pencil className="size-4" aria-hidden />تعديل المواعيد</Link>
                    {y.active && t.id !== currentTermId && <Button size="sm" variant="ghost" disabled={!!source.unavailable?.setCurrentTerm} title={source.unavailable?.setCurrentTerm} onClick={() => { void setCurrentTerm(t.id).then(() => toast('تم تحديد الفصل الحالي.')).catch((e) => toast(describeCommandError(e), 'error')) }}>جعله الفصل الحالي</Button>}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>

      {form && staffApi && <YearFormDialog open title={form.id ? 'تعديل السنة الدراسية' : 'إضافة سنة دراسية'} submitLabel={form.id ? 'حفظ التعديل' : 'إضافة السنة'} initial={form.initial} onClose={() => setForm(null)}
        onSubmit={async (f) => { const r = form.id ? await staffApi.updateYear(form.id, f) : await staffApi.createYear(f); if (!r.ok) return staffMessage(r); setForm(null); toast(form.id ? 'حُفظ تعديل السنة.' : 'أُضيفت السنة مع فصليها ومواعيدها.'); await reload(); return null }} />}
      <Dialog open={adding} onClose={() => setAdding(false)} title="إضافة سنة دراسية" description="تُنشأ السنة مع فصلين بمواعيد مبدئية يمكن تعديلها."
        footer={<><Button variant="secondary" onClick={() => setAdding(false)}>إلغاء</Button><Button onClick={create}>إضافة</Button></>}>
        <Field label="السنة الدراسية" error={err} hint="مثال: 2027–2028">
          {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} invalid={invalid} value={label} onChange={(e) => { setLabel(e.target.value); setErr(null) }} dir="ltr" className="text-start" placeholder="2027–2028" data-autofocus />}
        </Field>
      </Dialog>

      <Dialog open={!!target} onClose={() => setActivate(null)} title={`تفعيل سنة ${target?.label ?? ''}`}
        footer={<><Button variant="secondary" onClick={() => setActivate(null)}>إلغاء</Button><Button onClick={() => { const id = activate!; setActivate(null); if (staffApi) { void staffApi.activateYear(id).then(async (r) => { if (!r.ok) toast(staffMessage(r), 'error'); else { toast('تم تفعيل السنة.'); await reload() } }); return } void setActiveYear(id).then(() => toast('تم تفعيل السنة.')).catch((e) => toast(describeCommandError(e), 'error')) }}>تأكيد التفعيل</Button></>}>
        <Alert tone="warn" title="سنة نشطة واحدة فقط">سيصبح تفعيل هذه السنة إيقافًا للسنة النشطة الحالية. تبقى جميع بياناتها محفوظة وللاطلاع.</Alert>
      </Dialog>
    </div>
  )
}
