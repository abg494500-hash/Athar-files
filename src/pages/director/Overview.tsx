import { Link } from 'react-router-dom'
import { AlertCircle, CheckCircle2, Clock, Users, ArrowLeft } from 'lucide-react'
import { useStore } from '../../data/store'
import { itemsFor, summarize, teacherStatus } from '../../data/selectors'
import { usePageState } from '../../lib/pageState'
import { Card, PageHeader, Progress, SectionTitle, Stat } from '../../components/ui/misc'
import { EmptyState, ErrorState, PageSkeleton } from '../../components/ui/States'
import { TermPicker, useTermSelection } from '../../components/domain/TermPicker'
import { TeacherAvatar } from '../../components/domain/TeacherAvatar'
import { StatusBadge } from '../../components/domain/StatusBadge'
import { fmtDateTime, fmtNum, fmtPercent } from '../../lib/format'
import { StatusBar } from '../../components/domain/StatusBar'

export default function DirectorOverview({ base = '/director' }: { base?: string }) {
  const { teachers, submissions, terms, years } = useStore()
  const sel = useTermSelection()
  const ps = usePageState('director-overview')
  if (ps.phase === 'loading') return <PageSkeleton rows={3} />
  if (ps.phase === 'error') return <ErrorState onRetry={ps.retry} />

  const s = summarize(submissions, ps.empty ? [] : teachers, sel.termId)
  const term = terms.find((t) => t.id === sel.termId)!
  const year = years.find((y) => y.id === term.yearId)!
  const missing = teachers.filter((t) => t.active && teacherStatus(submissions, t.id, sel.termId) === 'missing')
  const recent = submissions
    .filter((x) => x.termId === sel.termId)
    .flatMap((x) => x.versions.map((v) => ({ v, x })))
    .sort((a, b) => Date.parse(b.v.submittedAt) - Date.parse(a.v.submittedAt))
    .slice(0, 6)

  return (
    <div className="space-y-6">
      <PageHeader title="نظرة عامة على التسليم" subtitle={`${year.label} · ${term.name}`} />
      <Card className="p-4" as="div"><div className="grid gap-3 sm:max-w-md sm:grid-cols-2"><TermPicker sel={sel} /></div></Card>

      {s.total === 0 ? (
        <Card as="div"><EmptyState icon={Users} title="لا توجد بيانات لعرضها" text="ستظهر هنا حالات التسليم عندما تُضاف المعلمات." /></Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="عدد المعلمات" value={fmtNum(s.total)} icon={Users} />
            <Stat label="تم التسليم" value={fmtNum(s.on_time)} icon={CheckCircle2} tone="ok" />
            <Stat label="تم التسليم متأخرًا" value={fmtNum(s.late)} icon={Clock} tone="late" />
            <Stat label="لم يُسلّم" value={fmtNum(s.missing)} icon={AlertCircle} tone="miss" />
          </div>
          <Card className="p-4 sm:p-5" as="div">
            <div className="mb-2 flex items-center justify-between"><p className="font-bold text-steel-900">نسبة من سلّمن</p><p className="num text-lg font-bold text-steel-900">{fmtPercent(s.rate)}</p></div>
            <Progress value={s.rate} label="نسبة التسليم" />
            <StatusBar on_time={s.on_time} late={s.late} missing={s.missing} className="mt-4" />
          </Card>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card className="p-4 sm:p-5">
              <SectionTitle title="تحتاج إلى متابعة" hint="معلمات لم يُسجَّل لهن تسليم بعد" action={<Link to={`${base}/teachers`} className="inline-flex items-center gap-1 text-sm font-medium text-steel-700 hover:underline">عرض الكل<ArrowLeft className="size-4" aria-hidden /></Link>} />
              {missing.length === 0 ? <p className="rounded-2xl bg-ok-bg p-4 text-sm text-ok-fg">جميع المعلمات سلّمن.</p> : (
                <ul className="divide-y divide-snow-200">
                  {missing.slice(0, 6).map((t) => (
                    <li key={t.id}><Link to={`${base}/teachers/${t.id}`} className="flex items-center gap-3 py-2.5 hover:bg-steel-50"><TeacherAvatar teacher={t} size={34} /><span className="min-w-0 flex-1"><span className="block truncate font-medium text-steel-900">{t.name}</span><span className="block truncate text-[13px] text-ink-500">{t.subject}</span></span><StatusBadge status="missing" /></Link></li>
                  ))}
                </ul>
              )}
            </Card>
            <Card className="p-4 sm:p-5">
              <SectionTitle title="آخر التسليمات" />
              {recent.length === 0 ? <p className="text-sm text-ink-500">لا توجد تسليمات في هذا الفصل بعد.</p> : (
                <ul className="divide-y divide-snow-200">
                  {recent.map(({ v, x }) => {
                    const t = teachers.find((tt) => tt.id === x.teacherId)!
                    const slot = itemsFor(submissions, t.id, sel.termId).find((i) => i.slot.id === x.slotId)!.slot
                    return (
                      <li key={v.id} className="flex items-center gap-3 py-2.5">
                        <TeacherAvatar teacher={t} size={34} />
                        <span className="min-w-0 flex-1"><span className="block truncate font-medium text-steel-900">{t.name}</span><span className="block truncate text-[13px] text-ink-500">{slot.title} · النسخة {v.no} · {fmtDateTime(v.submittedAt)}</span></span>
                        <StatusBadge status={v.status} />
                      </li>
                    )
                  })}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
