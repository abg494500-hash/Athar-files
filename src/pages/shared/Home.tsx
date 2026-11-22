import { Link } from 'react-router-dom'
import { AlertCircle, CheckCircle2, Clock } from 'lucide-react'
import { useStore } from '../../data/store'
import { summarize } from '../../data/selectors'
import { usePageState } from '../../lib/pageState'
import { groupedSections, type StaffRole } from '../../lib/sections'
import { Card, PageHeader } from '../../components/ui/misc'
import { ErrorState, PageSkeleton } from '../../components/ui/States'
import { SectionCard } from '../../components/layout/SectionCard'
import { fmtNum, fmtPercent } from '../../lib/format'

/**
 * الصفحة الرئيسية بعد الدخول للمالكة والمديرة (بدل الشريط الجانبي القديم).
 * مكوّن واحد للدورين: الأقسام المعروضة تأتي من سجل الأقسام حسب الدور، فلا ترى المديرة بطاقات المالكة.
 * كل رقم معروض مشتق من بيانات المصدر نفسه؛ لا أرقام ثابتة ولا بيانات وهمية.
 */
export default function Home({ role }: { role: StaffRole }) {
  const { terms, years, currentTermId, teachers, submissions, archives } = useStore()
  const ps = usePageState(`home-${role}`)
  if (ps.phase === 'loading') return <PageSkeleton rows={3} />
  if (ps.phase === 'error') return <ErrorState onRetry={ps.retry} />

  const term = terms.find((t) => t.id === currentTermId)
  const year = term && years.find((y) => y.id === term.yearId)
  const s = term ? summarize(submissions, ps.empty ? [] : teachers, term.id) : null
  const activeArchives = archives.filter((a) => !a.deleted)
  const pendingArchives = activeArchives.filter((a) => a.status !== 'verified').length

  const metaFor = (id: string): { text?: string; attention?: boolean } => {
    switch (id) {
      case 'overview': return s && s.total > 0 ? { text: `${fmtPercent(s.rate)} من المعلمات سلّمن` } : {}
      case 'teachers':
      case 'submissions': return s && s.total > 0 ? { text: `${fmtNum(s.total)} معلمة نشطة` } : {}
      case 'years': return year ? { text: `السنة النشطة: ${year.label}` } : {}
      case 'deadlines': return term ? { text: term.name } : {}
      case 'archive':
        if (pendingArchives > 0) return { text: `${fmtNum(pendingArchives)} يحتاج إلى انتباه`, attention: true }
        return activeArchives.length > 0 ? { text: `${fmtNum(activeArchives.length)} أرشيف` } : {}
      default: return {}
    }
  }

  const title = role === 'owner' ? 'أهلًا بكِ في لوحة المالكة' : 'أهلًا بكِ في لوحة مديرة المدرسة'
  return (
    <div className="space-y-8">
      <PageHeader title={title} subtitle={year && term ? `${year.label} · ${term.name}` : undefined} />

      {s && s.total > 0 && (
        <Card as="div" className="bg-gradient-to-l from-frost-50 via-white to-lav-50 p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-bold text-steel-900">حالة التسليم في الفصل الحالي</h2>
            <Link to={`/${role}/overview`} className="inline-flex h-10 items-center rounded-xl px-3 text-sm font-medium text-steel-700 hover:bg-frost-100">عرض التفاصيل</Link>
          </div>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <li className="flex items-center gap-3 rounded-2xl bg-ok-bg px-4 py-3 text-ok-fg"><CheckCircle2 className="size-5 shrink-0" aria-hidden /><span className="text-sm">تم التسليم</span><span className="num ms-auto text-xl font-bold">{fmtNum(s.on_time)}</span></li>
            <li className="flex items-center gap-3 rounded-2xl bg-late-bg px-4 py-3 text-late-fg"><Clock className="size-5 shrink-0" aria-hidden /><span className="text-sm">متأخر</span><span className="num ms-auto text-xl font-bold">{fmtNum(s.late)}</span></li>
            <li className="flex items-center gap-3 rounded-2xl bg-miss-bg px-4 py-3 text-miss-fg"><AlertCircle className="size-5 shrink-0" aria-hidden /><span className="text-sm">لم يُسلّم</span><span className="num ms-auto text-xl font-bold">{fmtNum(s.missing)}</span></li>
          </ul>
        </Card>
      )}

      {groupedSections(role).map((g, i) => (
        <section key={g.group} aria-labelledby={`grp-${i}`}>
          <h2 id={`grp-${i}`} className="mb-3 text-lg font-bold text-steel-900">{g.group}</h2>
          <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
            {g.items.map((sec) => {
              const m = metaFor(sec.id)
              return <SectionCard key={sec.id} section={sec} meta={m.text} metaTone={m.attention ? 'attention' : 'neutral'} />
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
