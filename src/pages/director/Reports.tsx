import { useMemo } from 'react'
import { BarChart3, Printer } from 'lucide-react'
import { useStore } from '../../data/store'
import { summarize, teacherStatus, termLabel, type Summary } from '../../data/selectors'
import { usePageState } from '../../lib/pageState'
import { Card, PageHeader, Progress, SectionTitle, Stat } from '../../components/ui/misc'
import { Button } from '../../components/ui/Button'
import { EmptyState, ErrorState, PageSkeleton } from '../../components/ui/States'
import { DataTable, type Column } from '../../components/ui/DataTable'
import { TermPicker, useTermSelection } from '../../components/domain/TermPicker'
import { fmtNum, fmtPercent, fmtShort } from '../../lib/format'

function Donut({ s }: { s: Summary }) {
  const total = s.total || 1
  const R = 42, C = 2 * Math.PI * R
  const segs = [
    { n: s.on_time, color: '#86bba6', label: 'تم التسليم' },
    { n: s.late, color: '#e2c77f', label: 'متأخر' },
    { n: s.missing, color: '#dea3ab', label: 'لم يُسلّم' },
  ]
  let acc = 0
  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg viewBox="0 0 120 120" className="size-40 shrink-0 -rotate-90" role="img" aria-label={`تم التسليم ${s.on_time}، متأخر ${s.late}، لم يُسلّم ${s.missing}`}>
        <circle cx="60" cy="60" r={R} fill="none" stroke="#e9eff6" strokeWidth="14" />
        {segs.map((g) => {
          const len = (g.n / total) * C
          const el = g.n > 0 ? <circle key={g.label} cx="60" cy="60" r={R} fill="none" stroke={g.color} strokeWidth="14" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-acc} /> : null
          acc += len
          return el
        })}
      </svg>
      <ul className="space-y-2 text-[15px]">
        {segs.map((g) => <li key={g.label} className="flex items-center gap-2.5"><span className="size-3 rounded-full" style={{ background: g.color }} aria-hidden />{g.label}: <span className="num font-bold">{fmtNum(g.n)}</span></li>)}
      </ul>
    </div>
  )
}

export default function Reports() {
  const { teachers, submissions, terms, years } = useStore()
  const sel = useTermSelection()
  const ps = usePageState('reports')

  const s = useMemo(() => summarize(submissions, teachers, sel.termId), [submissions, teachers, sel.termId])
  const bySubject = useMemo(() => {
    const m = new Map<string, { total: number; done: number }>()
    teachers.filter((t) => t.active).forEach((t) => {
      const e = m.get(t.subject) ?? { total: 0, done: 0 }
      e.total++
      if (teacherStatus(submissions, t.id, sel.termId) !== 'missing') e.done++
      m.set(t.subject, e)
    })
    return [...m.entries()].map(([subject, v]) => ({ subject, ...v })).sort((a, b) => b.total - a.total)
  }, [teachers, submissions, sel.termId])
  const perDay = useMemo(() => {
    const m = new Map<string, number>()
    submissions.filter((x) => x.termId === sel.termId).forEach((x) => x.versions.forEach((v) => {
      const d = v.submittedAt.slice(0, 10)
      m.set(d, (m.get(d) ?? 0) + 1)
    }))
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [submissions, sel.termId])

  if (ps.phase === 'loading') return <PageSkeleton rows={3} />
  if (ps.phase === 'error') return <ErrorState onRetry={ps.retry} />

  const empty = ps.empty || s.total === 0
  const maxDay = Math.max(1, ...perDay.map(([, n]) => n))
  const rows = terms.map((t) => ({ id: t.id, label: termLabel(terms, years, t.id), ...summarize(submissions, teachers, t.id) }))
  const cols: Column<(typeof rows)[number]>[] = [
    { key: 'l', header: 'الفصل', primary: true, cell: (r) => r.label },
    { key: 'a', header: 'تم التسليم', cell: (r) => <span className="num">{fmtNum(r.on_time)}</span> },
    { key: 'b', header: 'متأخر', cell: (r) => <span className="num">{fmtNum(r.late)}</span> },
    { key: 'c', header: 'لم يُسلّم', cell: (r) => <span className="num">{fmtNum(r.missing)}</span> },
    { key: 'd', header: 'نسبة التسليم', cell: (r) => <span className="num font-bold">{fmtPercent(r.rate)}</span> },
  ]

  return (
    <div className="space-y-6">
      <PageHeader title="التقارير والإحصاءات" subtitle={termLabel(terms, years, sel.termId)} actions={<Button variant="secondary" icon={Printer} onClick={() => window.print()} className="print:hidden">طباعة التقرير</Button>} />
      <Card className="p-4 print:hidden" as="div"><div className="grid gap-3 sm:max-w-md sm:grid-cols-2"><TermPicker sel={sel} /></div></Card>

      {empty ? (
        <Card as="div"><EmptyState icon={BarChart3} title="لا توجد بيانات لهذا الفصل" text="ستظهر الإحصاءات عند وجود معلمات وتسليمات." /></Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="نسبة التسليم" value={fmtPercent(s.rate)} tone="steel" />
            <Stat label="في الموعد الأساسي" value={fmtNum(s.on_time)} tone="ok" hint={`من ${fmtNum(s.total)} معلمة`} />
            <Stat label="متأخرات" value={fmtNum(s.late)} tone="late" />
            <Stat label="لم يُسلّمن" value={fmtNum(s.missing)} tone="miss" />
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card className="p-4 sm:p-5"><SectionTitle title="توزيع الحالات" /><Donut s={s} /></Card>
            <Card className="p-4 sm:p-5">
              <SectionTitle title="التسليمات حسب اليوم" hint="عدد النسخ المسلَّمة في كل يوم" />
              {perDay.length === 0 ? <p className="text-sm text-ink-500">لا تسليمات في هذا الفصل بعد.</p> : (
                <ul className="space-y-2">
                  {perDay.map(([d, n]) => (
                    <li key={d} className="flex items-center gap-3 text-sm">
                      <span className="w-20 shrink-0 text-ink-600">{fmtShort(d)}</span>
                      <span className="h-3 flex-1 overflow-hidden rounded-full bg-snow-200"><span className="block h-full rounded-full bg-steel-400" style={{ width: `${(n / maxDay) * 100}%` }} /></span>
                      <span className="num w-6 text-end font-medium">{fmtNum(n)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card className="p-4 sm:p-5">
            <SectionTitle title="التسليم حسب المادة" />
            <ul className="space-y-3">
              {bySubject.map((r) => (
                <li key={r.subject}>
                  <div className="mb-1 flex justify-between text-sm"><span className="font-medium text-steel-900">{r.subject}</span><span className="num text-ink-600">{fmtNum(r.done)} / {fmtNum(r.total)}</span></div>
                  <Progress value={(r.done / r.total) * 100} label={`نسبة تسليم ${r.subject}`} />
                </li>
              ))}
            </ul>
          </Card>

          <div>
            <SectionTitle title="مقارنة الفصول" />
            <DataTable caption="مقارنة التسليم بين الفصول" columns={cols} rows={rows} rowKey={(r) => r.id} />
          </div>
        </>
      )}
    </div>
  )
}
