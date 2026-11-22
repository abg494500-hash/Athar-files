import { useEffect, useMemo, useState } from 'react'
import { CalendarClock, Save, TriangleAlert } from 'lucide-react'
import { useStore } from '../../data/store'
import { describeCommandError } from '../../data/errors'
import { itemsFor } from '../../data/selectors'
import type { Deadlines } from '../../data/types'
import { endOfDay, validateDeadlines } from '../../lib/status'
import { fmtDay } from '../../lib/format'
import { usePageState } from '../../lib/pageState'
import { Alert, Card, PageHeader } from '../../components/ui/misc'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Overlay'
import { Field, Input, Textarea } from '../../components/ui/Field'
import { ErrorState, PageSkeleton } from '../../components/ui/States'
import { TermPicker, useTermSelection } from '../../components/domain/TermPicker'
import { DeadlineTimeline } from '../../components/domain/DeadlineTimeline'
import { useToast } from '../../components/ui/Toast'

const FIELDS: { k: keyof Deadlines; label: string; hint: string }[] = [
  { k: 'base', label: 'الموعد الأساسي', hint: 'التسليم بعده يُحسب متأخرًا.' },
  { k: 'late', label: 'آخر موعد للتسليم المتأخر', hint: 'بعده يُغلق باب التسليم الجديد.' },
  { k: 'replace', label: 'آخر موعد للاستبدال', hint: 'بعده لا يمكن استبدال الملفات.' },
]

export default function DeadlinesManager({ role }: { role: 'owner' | 'director' }) {
  const { terms, years, teachers, submissions, now, updateDeadlines } = useStore()
  const toast = useToast()
  const sel = useTermSelection()
  const ps = usePageState(`deadlines-${role}`)
  const term = terms.find((t) => t.id === sel.termId)!
  const year = years.find((y) => y.id === term.yearId)!
  const readOnly = !year.active && role === 'director'
  const [form, setForm] = useState<Deadlines>(term.deadlines)
  const [reason, setReason] = useState('')
  const [reasonErr, setReasonErr] = useState<string | null>(null)
  const [confirm, setConfirm] = useState(false)

  useEffect(() => { setForm(term.deadlines); setReason(''); setReasonErr(null) }, [term.id, term.deadlines])

  const errors = validateDeadlines(form)
  const dirty = FIELDS.some((f) => form[f.k] !== term.deadlines[f.k])
  const impact = useMemo(() => {
    const active = teachers.filter((t) => t.active)
    const without = active.filter((t) => itemsFor(submissions, t.id, term.id).every((i) => i.versions.length === 0)).length
    const submitted = active.length - without
    const inPast = FIELDS.filter((f) => form[f.k] !== term.deadlines[f.k] && endOfDay(form[f.k]) < now).map((f) => f.label)
    return { without, submitted, inPast }
  }, [teachers, submissions, term, form, now])

  if (ps.phase === 'loading') return <PageSkeleton rows={2} />
  if (ps.phase === 'error') return <ErrorState onRetry={ps.retry} />

  const review = () => {
    if (errors.length) return
    if (!reason.trim()) { setReasonErr('يرجى ذكر سبب التعديل ليُحفظ مع التعديل.'); return }
    setReasonErr(null); setConfirm(true)
  }
  const apply = async () => {
    try { await updateDeadlines(term.id, form, reason.trim()); setConfirm(false); setReason(''); toast('تم حفظ المواعيد وتسجيل التعديل.') }
    catch (e) { setConfirm(false); toast(describeCommandError(e), 'error') }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="المواعيد النهائية" subtitle="الموعد الأساسي، وآخر موعد للتسليم المتأخر، وآخر موعد للاستبدال لكل فصل." />
      <Card className="p-4" as="div"><div className="grid gap-3 sm:max-w-md sm:grid-cols-2"><TermPicker sel={sel} /></div></Card>

      <section aria-labelledby="cur"><h2 id="cur" className="mb-3 text-lg font-bold text-steel-900">المواعيد الحالية</h2><DeadlineTimeline deadlines={term.deadlines} now={now} /></section>

      <Card className="p-4 sm:p-6">
        <h2 className="mb-1 text-lg font-bold text-steel-900">تعديل المواعيد</h2>
        <p className="mb-4 text-sm text-ink-500">تُحسب نهاية كل موعد في آخر ثانية من يومه بتوقيت سلطنة عُمان.</p>
        {readOnly ? <Alert tone="info" title="فصل من سنة سابقة">مواعيد هذا الفصل للعرض فقط.</Alert> : (
          <div className="space-y-5">
            <Alert tone="warn" title="تنبيه قبل التعديل">
              تعديل الموعد لا يغيّر حالة أي تسليم سابق، ويسري على التسليمات والاستبدالات القادمة فقط. يُسجَّل كل تعديل باسمك.
            </Alert>
            <div className="grid gap-4 md:grid-cols-3">
              {FIELDS.map((f) => (
                <Field key={f.k} label={f.label} hint={form[f.k] ? `${f.hint} · ${fmtDay(form[f.k])}` : f.hint}>
                  {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="date" dir="ltr" value={form[f.k]} onChange={(e) => setForm({ ...form, [f.k]: e.target.value })} className="text-start" />}
                </Field>
              ))}
            </div>
            {errors.length > 0 && <Alert tone="danger" title="تحقّقي من ترتيب المواعيد"><ul className="list-disc ps-5">{errors.map((e) => <li key={e}>{e}</li>)}</ul></Alert>}
            {dirty && errors.length === 0 && (
              <Alert tone="warn" title="أثر التعديل">
                <ul className="list-disc ps-5">
                  <li>{impact.without} معلمة لم تُسلّم بعد وسيسري عليها الموعد الجديد.</li>
                  <li>{impact.submitted} معلمة لديها تسليمات سابقة، ولن تتغير حالاتها.</li>
                  {impact.inPast.length > 0 && <li className="font-bold">موعد جديد في الماضي ({impact.inPast.join('، ')}): سيُغلق ما بعده فورًا.</li>}
                </ul>
              </Alert>
            )}
            {dirty && (
              <Field label="سبب التعديل" required error={reasonErr}>
                {({ id, describedBy, invalid }) => <Textarea id={id} aria-describedby={describedBy} invalid={invalid} value={reason} onChange={(e) => { setReason(e.target.value); setReasonErr(null) }} placeholder="مثال: تمديد بسبب ظرف طارئ" />}
              </Field>
            )}
            <div className="flex flex-wrap gap-2">
              <Button icon={Save} onClick={review} disabled={!dirty || errors.length > 0}>مراجعة وحفظ</Button>
              {dirty && <Button variant="ghost" onClick={() => { setForm(term.deadlines); setReason(''); setReasonErr(null) }}>تراجع</Button>}
            </div>
          </div>
        )}
      </Card>

      <Dialog open={confirm} onClose={() => setConfirm(false)} title="تأكيد تعديل المواعيد" description={`${term.name} · ${year.label}`}
        footer={<><Button variant="secondary" onClick={() => setConfirm(false)}>رجوع</Button><Button icon={CalendarClock} onClick={apply}>تأكيد الحفظ</Button></>}>
        <div className="space-y-4">
          <ul className="space-y-2">
            {FIELDS.filter((f) => form[f.k] !== term.deadlines[f.k]).map((f) => (
              <li key={f.k} className="rounded-2xl bg-snow-100 p-3 text-sm"><p className="font-bold text-steel-900">{f.label}</p><p className="text-ink-600">من {fmtDay(term.deadlines[f.k])}</p><p className="font-medium text-steel-800">إلى {fmtDay(form[f.k])}</p></li>
            ))}
          </ul>
          <p className="flex items-start gap-2 text-sm text-late-fg"><TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />لن تتغير حالات التسليم السابقة بأثر رجعي.</p>
          <p className="text-sm text-ink-600"><span className="font-medium">السبب:</span> {reason}</p>
        </div>
      </Dialog>
    </div>
  )
}
