import { Link, useParams } from 'react-router-dom'
import { ArrowRight, UserX } from 'lucide-react'
import { useStore } from '../../data/store'
import { itemsFor } from '../../data/selectors'
import { overallStatus } from '../../lib/status'
import { usePageState } from '../../lib/pageState'
import type { Version } from '../../data/types'
import { Card, Chip, PageHeader } from '../../components/ui/misc'
import { EmptyState, ErrorState, PageSkeleton } from '../../components/ui/States'
import { StatusBadge } from '../../components/domain/StatusBadge'
import { TeacherAvatar } from '../../components/domain/TeacherAvatar'
import { VersionList } from '../../components/domain/VersionList'
import { TermPicker, useTermSelection } from '../../components/domain/TermPicker'
import { DeadlineTimeline } from '../../components/domain/DeadlineTimeline'
import { useToast } from '../../components/ui/Toast'
import { useStaffApi } from '../../lib/staffApi/StaffApiContext'
import { staffMessage } from '../../lib/staffApi/client'
import { useDownloadOverride } from '../../lib/downloadOverride'

export default function TeacherDetail({ backTo }: { backTo: string }) {
  const { id } = useParams()
  const { teachers, submissions, terms, now } = useStore()
  const sel = useTermSelection()
  const ps = usePageState(`teacher-${id}`)
  const staffApi = useStaffApi()
  const override = useDownloadOverride()
  const toast = useToast()
  const teacher = teachers.find((t) => t.id === id)
  // تنزيل ملف معلمة: رابط خادمي قصير العمر (المالكة والمديرة). بلا واجهة خادمية مضبوطة يبقى الزر على «غير متاح».
  const download = override ? async (v: Version) => override(v) : staffApi ? async (v: Version) => {
    const r = await staffApi.signVersionDownload(v.id)
    if (r.ok) window.location.assign(r.value.url)
    else toast(staffMessage(r), 'info')
  } : undefined

  if (ps.phase === 'loading') return <PageSkeleton rows={3} />
  if (ps.phase === 'error') return <ErrorState onRetry={ps.retry} />
  if (!teacher) return <Card as="div"><EmptyState icon={UserX} title="لم يُعثر على المعلمة" action={<Link to={backTo} className="font-medium text-steel-700 underline">العودة إلى القائمة</Link>} /></Card>

  const term = terms.find((t) => t.id === sel.termId)!
  const items = itemsFor(submissions, teacher.id, sel.termId)
  const overall = overallStatus(items.map((i) => i.status))

  return (
    <div className="space-y-6">
      <Link to={backTo} className="inline-flex items-center gap-1.5 text-sm font-medium text-steel-700 hover:underline"><ArrowRight className="size-4" aria-hidden />العودة إلى القائمة</Link>
      <PageHeader title={teacher.name} subtitle={teacher.subject} actions={<StatusBadge status={overall} className="text-sm" />} />
      <div className="flex items-center gap-4"><TeacherAvatar teacher={teacher} size={56} /></div>
      <Card className="p-4" as="div">
        <div className="grid gap-3 sm:grid-cols-2 sm:max-w-md"><TermPicker sel={sel} /></div>
      </Card>
      <DeadlineTimeline deadlines={term.deadlines} now={now} compact />
      <div className="grid gap-5 lg:grid-cols-2">
        {items.map((it) => (
          <Card key={it.slot.id} className="p-4 sm:p-5" as="article">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2"><h2 className="text-lg font-bold text-steel-900">{it.slot.title}</h2>{it.slot.optional && <Chip tone="lav">اختياري</Chip>}</div>
              {it.status === 'missing' && it.slot.optional ? <Chip>لم يُستخدم</Chip> : <StatusBadge status={it.status} />}
            </div>
            {it.versions.length === 0
              ? <p className="rounded-2xl bg-snow-100 p-4 text-sm text-ink-500">{it.slot.optional ? 'لم تستخدم المعلمة هذا العنصر، ولا يُعد ذلك نقصًا.' : 'لا توجد تسليمات لهذا العنصر.'}</p>
              : <VersionList versions={it.versions} showHash {...(download ? { onDownload: (v: Version) => void download(v) } : {})} />}
          </Card>
        ))}
      </div>
    </div>
  )
}
