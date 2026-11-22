import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, SearchX } from 'lucide-react'
import { useStore } from '../../data/store'
import { itemsFor, teacherStatus, lastActivity } from '../../data/selectors'
import type { ItemStatus } from '../../data/types'
import { usePageState } from '../../lib/pageState'
import { PageHeader, Card, Chip } from '../../components/ui/misc'
import { Field, Input, Select } from '../../components/ui/Field'
import { DataTable, type Column } from '../../components/ui/DataTable'
import { EmptyState, ErrorState, PageSkeleton } from '../../components/ui/States'
import { StatusBadge } from '../../components/domain/StatusBadge'
import { TeacherAvatar } from '../../components/domain/TeacherAvatar'
import { TermPicker, useTermSelection } from '../../components/domain/TermPicker'
import { fmtDateTime } from '../../lib/format'
import type { Teacher } from '../../data/types'

type Filter = 'all' | ItemStatus

export default function TeachersList({ base }: { base: string }) {
  const { teachers, submissions } = useStore()
  const sel = useTermSelection()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<Filter>('all')
  const ps = usePageState(`teachers-${base}`)
  const go = useNavigate()

  const rows = useMemo(() => {
    const needle = q.trim()
    return teachers
      .filter((t) => t.active)
      .filter((t) => !needle || t.name.includes(needle))
      .filter((t) => status === 'all' || teacherStatus(submissions, t.id, sel.termId) === status)
  }, [teachers, submissions, q, status, sel.termId])

  if (ps.phase === 'loading') return <PageSkeleton />
  if (ps.phase === 'error') return <ErrorState onRetry={ps.retry} />

  const data = ps.empty ? [] : rows
  const cols: Column<Teacher>[] = [
    { key: 'name', header: 'المعلمة', primary: true, className: 'w-[28%]', cell: (t) => (
      <span className="flex items-center gap-3"><TeacherAvatar teacher={t} size={36} /><span className="min-w-0"><span className="block truncate font-medium text-steel-900">{t.name}</span><span className="block truncate text-[13px] font-normal text-ink-500">{t.subject}</span></span></span>
    ) },
    { key: 's1', header: 'العنصر الأول', cell: (t) => <StatusBadge status={itemsFor(submissions, t.id, sel.termId)[0].status} /> },
    { key: 's2', header: 'العنصر الثاني', cell: (t) => { const s = itemsFor(submissions, t.id, sel.termId)[1].status; return s === 'missing' ? <Chip>لم يُستخدم (اختياري)</Chip> : <StatusBadge status={s} /> } },
    { key: 'all', header: 'الحالة الإجمالية', cell: (t) => <StatusBadge status={teacherStatus(submissions, t.id, sel.termId)} /> },
    { key: 'last', header: 'آخر نشاط', className: 'w-[18%]', cell: (t) => { const l = lastActivity(submissions, t.id, sel.termId); return <span className="text-sm text-ink-600">{l ? fmtDateTime(l) : '—'}</span> } },
  ]

  return (
    <div>
      <PageHeader title="المعلمات وحالات التسليم" subtitle="ابحثي باسم المعلمة وصفّي حسب السنة والفصل والحالة." />
      <Card className="mb-5 p-4" as="div">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="بحث باسم المعلمة">
            {({ id }) => (
              <div className="relative">
                <Search className="pointer-events-none absolute start-3 top-3 size-5 text-ink-300" aria-hidden />
                <Input id={id} value={q} onChange={(e) => setQ(e.target.value)} placeholder="اكتبي الاسم" className="ps-10" type="search" />
              </div>
            )}
          </Field>
          <TermPicker sel={sel} />
          <Field label="الحالة">
            {({ id }) => (
              <Select id={id} value={status} onChange={(e) => setStatus(e.target.value as Filter)}>
                <option value="all">كل الحالات</option><option value="on_time">تم التسليم</option><option value="late">تم التسليم متأخرًا</option><option value="missing">لم يُسلّم</option>
              </Select>
            )}
          </Field>
        </div>
      </Card>
      {data.length === 0 ? (
        <Card as="div"><EmptyState icon={SearchX} title="لا توجد نتائج" text="غيّري كلمة البحث أو عوامل التصفية وجرّبي مرة أخرى." /></Card>
      ) : (
        <>
          <p className="mb-2 text-sm text-ink-500" aria-live="polite">{data.length} معلمة</p>
          <DataTable caption="قائمة المعلمات وحالات التسليم" columns={cols} rows={data} rowKey={(t) => t.id} onRowClick={(t) => go(`${base}/${t.id}`)} />
        </>
      )}
    </div>
  )
}
