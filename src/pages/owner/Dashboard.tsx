import { Link } from 'react-router-dom'
import { AlertCircle, ArrowLeft, CheckCircle2, Clock, FolderArchive, Users } from 'lucide-react'
import { useStore } from '../../data/store'
import { summarize } from '../../data/selectors'
import { usePageState } from '../../lib/pageState'
import { Alert, Card, PageHeader, Progress, SectionTitle, Stat } from '../../components/ui/misc'
import { ErrorState, PageSkeleton, EmptyState } from '../../components/ui/States'
import { DeadlineTimeline } from '../../components/domain/DeadlineTimeline'
import { StatusBar } from '../../components/domain/StatusBar'
import { fmtNum, fmtPercent } from '../../lib/format'
import { Badge } from './parts'
import { useStaffApi } from '../../lib/staffApi/StaffApiContext'

export default function OwnerDashboard() {
  const staffApi = useStaffApi()
  const { terms, years, currentTermId, teachers, submissions, archives, now } = useStore()
  const ps = usePageState('owner-dashboard')
  if (ps.phase === 'loading') return <PageSkeleton rows={3} />
  if (ps.phase === 'error') return <ErrorState onRetry={ps.retry} />

  const term = terms.find((t) => t.id === currentTermId)!
  const year = years.find((y) => y.id === term.yearId)!
  const s = summarize(submissions, ps.empty ? [] : teachers, term.id)
  const pendingArchives = archives.filter((a) => !a.deleted && a.status !== 'verified')

  return (
    <div className="space-y-6">
      <PageHeader title="لوحة المتابعة" subtitle={`السنة النشطة: ${year.label} · ${term.name}`} />

      {pendingArchives.length > 0 && (
        <Alert tone="warn" title="أرشيفات تحتاج إلى انتباه">
          يوجد {fmtNum(pendingArchives.length)} أرشيف لم يكتمل التحقق منه. <Link to="/owner/archive" className="font-bold underline">فتح الأرشفة</Link>
        </Alert>
      )}

      {s.total === 0 ? (
        <Card as="div"><EmptyState icon={Users} title="لا توجد بيانات لعرضها" text="أضيفي المعلمات من صفحة المعلمات والأكواد." /></Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="المعلمات" value={fmtNum(s.total)} icon={Users} />
            <Stat label="تم التسليم" value={fmtNum(s.on_time)} icon={CheckCircle2} tone="ok" />
            <Stat label="تم التسليم متأخرًا" value={fmtNum(s.late)} icon={Clock} tone="late" />
            <Stat label="لم يُسلّم" value={fmtNum(s.missing)} icon={AlertCircle} tone="miss" />
          </div>
          <Card className="p-4 sm:p-5" as="div">
            <div className="mb-2 flex items-center justify-between"><p className="font-bold text-steel-900">نسبة من سلّمن</p><p className="num text-lg font-bold text-steel-900">{fmtPercent(s.rate)}</p></div>
            <Progress value={s.rate} label="نسبة التسليم" />
            <StatusBar on_time={s.on_time} late={s.late} missing={s.missing} className="mt-4" />
          </Card>
        </>
      )}

      <section aria-labelledby="dl">
        <SectionTitle title="مواعيد الفصل الحالي" action={<Link to="/owner/deadlines" className="inline-flex items-center gap-1 text-sm font-medium text-steel-700 hover:underline">إدارة المواعيد<ArrowLeft className="size-4" aria-hidden /></Link>} />
        <DeadlineTimeline deadlines={term.deadlines} now={now} />
      </section>
      {staffApi && <p className="text-sm"><Link to="/owner/uploads" className="font-medium text-steel-700 hover:underline">عمليات الرفع والجلسات العالقة</Link></p>}

      <div className="grid gap-5">
        <Card className="p-4 sm:p-5">
          <SectionTitle title="الأرشفة" action={<Link to="/owner/archive" className="text-sm font-medium text-steel-700 hover:underline">إدارة الأرشفة</Link>} />
          <ul className="divide-y divide-snow-200">
            {archives.filter((a) => !a.deleted).slice(0, 4).map((a) => (
              <li key={a.id} className="flex items-center gap-3 py-2.5">
                <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-steel-100 text-steel-700"><FolderArchive className="size-4" aria-hidden /></span>
                <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-steel-900">{a.title}</span>
                <Badge status={a.status} />
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  )
}
