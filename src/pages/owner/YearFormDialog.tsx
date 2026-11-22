// نموذج إنشاء/تعديل السنة الدراسية (A-119): الاسم، بداية ونهاية السنة، وللفصلين (1 و2) مواعيد التسليم الأساسي والمتأخر والاستبدال.
// يتحقق من الترتيب في الواجهة للراحة، لكن **الخادم والقاعدة يعيدان التحقق** (معاملة واحدة: سنة وفصلان معًا أو لا شيء).
import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Overlay'
import { Alert } from '../../components/ui/misc'
import { Field, Input } from '../../components/ui/Field'
import type { YearForm } from '../../lib/staffApi/client'

export const defaultYearForm = (startYear: number): YearForm => ({
  label: `${startYear}–${startYear + 1}`, startsOn: `${startYear}-09-01`, endsOn: `${startYear + 1}-06-30`,
  terms: [
    { ord: 1, name: 'الفصل الدراسي الأول', deadlineBase: `${startYear}-10-15`, deadlineLate: `${startYear}-10-22`, deadlineReplace: `${startYear}-11-06` },
    { ord: 2, name: 'الفصل الدراسي الثاني', deadlineBase: `${startYear + 1}-03-05`, deadlineLate: `${startYear + 1}-03-12`, deadlineReplace: `${startYear + 1}-03-26` },
  ],
})

export function validateYearForm(f: YearForm): string | null {
  const label = f.label.trim()
  if (label.length < 3 || label.length > 30) return 'اسم السنة بين 3 و30 حرفًا (مثال: 2027–2028).'
  if (f.startsOn && f.endsOn && f.startsOn >= f.endsOn) return 'بداية السنة يجب أن تسبق نهايتها.'
  for (const t of f.terms) {
    if (!t.deadlineBase || !t.deadlineLate || !t.deadlineReplace) return `أكملي مواعيد ${t.name}.`
    if (!(t.deadlineBase <= t.deadlineLate && t.deadlineLate <= t.deadlineReplace)) return `مواعيد ${t.name} يجب أن تكون: الأساسي ثم المتأخر ثم الاستبدال.`
    if (f.startsOn && t.deadlineBase < f.startsOn) return `موعد ${t.name} قبل بداية السنة.`
    if (f.endsOn && t.deadlineReplace > f.endsOn) return `موعد استبدال ${t.name} بعد نهاية السنة.`
  }
  if (f.terms[0]!.deadlineReplace > f.terms[1]!.deadlineBase) return 'مواعيد الفصل الأول يجب أن تنتهي قبل بدء مواعيد الفصل الثاني.'
  return null
}

export function YearFormDialog({ open, title, initial, submitLabel, onClose, onSubmit }: {
  open: boolean; title: string; initial: YearForm; submitLabel: string; onClose: () => void; onSubmit: (f: YearForm) => Promise<string | null>
}) {
  const [f, setF] = useState<YearForm>(initial)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const setTerm = (i: 0 | 1, k: 'deadlineBase' | 'deadlineLate' | 'deadlineReplace', v: string) => setF({ ...f, terms: f.terms.map((t, j) => (j === i ? { ...t, [k]: v } : t)) as YearForm['terms'] })
  const go = async () => {
    const e = validateYearForm(f); if (e) { setErr(e); return }
    setBusy(true); const r = await onSubmit({ ...f, label: f.label.trim().replace('-', '–') }); setBusy(false)
    if (r) setErr(r)
  }
  return (
    <Dialog open={open} onClose={onClose} title={title} description="لكل سنة فصلان. تُحفظ السنة وفصلاها معًا أو لا يُحفظ شيء."
      footer={<><Button variant="secondary" onClick={onClose}>إلغاء</Button><Button loading={busy} onClick={() => void go()}>{submitLabel}</Button></>}>
      <div className="space-y-4">
        {err && <Alert tone="danger">{err}</Alert>}
        <Field label="اسم السنة الدراسية" hint="مثال: 2027–2028">{({ id }) => <Input id={id} value={f.label} dir="ltr" className="text-start" onChange={(e) => { setF({ ...f, label: e.target.value }); setErr(null) }} />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="بداية السنة">{({ id }) => <Input id={id} type="date" dir="ltr" value={f.startsOn ?? ''} onChange={(e) => setF({ ...f, startsOn: e.target.value || null })} />}</Field>
          <Field label="نهاية السنة">{({ id }) => <Input id={id} type="date" dir="ltr" value={f.endsOn ?? ''} onChange={(e) => setF({ ...f, endsOn: e.target.value || null })} />}</Field>
        </div>
        {f.terms.map((t, i) => (
          <fieldset key={t.ord} className="space-y-2 rounded-2xl border border-snow-300 p-3">
            <legend className="px-1 text-sm font-bold text-steel-900">{t.name}</legend>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="الموعد الأساسي">{({ id }) => <Input id={id} type="date" dir="ltr" value={t.deadlineBase} onChange={(e) => setTerm(i as 0 | 1, 'deadlineBase', e.target.value)} />}</Field>
              <Field label="آخر تسليم متأخر">{({ id }) => <Input id={id} type="date" dir="ltr" value={t.deadlineLate} onChange={(e) => setTerm(i as 0 | 1, 'deadlineLate', e.target.value)} />}</Field>
              <Field label="آخر استبدال">{({ id }) => <Input id={id} type="date" dir="ltr" value={t.deadlineReplace} onChange={(e) => setTerm(i as 0 | 1, 'deadlineReplace', e.target.value)} />}</Field>
            </div>
          </fieldset>
        ))}
      </div>
    </Dialog>
  )
}
