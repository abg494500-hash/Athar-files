import { useMemo, useState } from 'react'
import { CheckCircle2, CircleDashed, Clock, Search, SearchX, Users } from 'lucide-react'
import { useStore } from '../../data/store'
import { itemsFor, lastActivity, termLabel as termLabelOf } from '../../data/selectors'
import type { ItemStatus, Teacher } from '../../data/types'
import { usePageState } from '../../lib/pageState'
import { Card, PageHeader, Tabs } from '../../components/ui/misc'
import { Field, Input } from '../../components/ui/Field'
import { EmptyState, ErrorState, PageSkeleton } from '../../components/ui/States'
import { StatusBadge } from '../../components/domain/StatusBadge'
import { TeacherAvatar } from '../../components/domain/TeacherAvatar'
import { TeacherFilesDialog } from '../../components/domain/TeacherFilesDialog'
import { TermPicker, useTermSelection } from '../../components/domain/TermPicker'
import { overallStatus } from '../../lib/status'
import { fmtDateTime, fmtNum } from '../../lib/format'
import { cn } from '../../lib/cn'

type Filter = 'submitted' | 'missing' | 'all'

// ألوان هادئة بحسب حالة التسليم (دلالة بصرية خفيفة؛ النص هو الحامل الأساسي للمعنى).
const TINT: Record<ItemStatus, string> = {
  on_time: 'border-mint-200 from-mint-50 hover:border-mint-700/40',
  late: 'border-sand-200 from-sand-50 hover:border-sand-700/40',
  missing: 'border-snow-300 from-snow-100 hover:border-steel-300',
}
const SLOT_ICON = { on_time: CheckCircle2, late: Clock, missing: CircleDashed } as const
const SLOT_COLOR: Record<ItemStatus, string> = { on_time: 'text-mint-700', late: 'text-sand-700', missing: 'text-ink-300' }

/**
 * صفحة التسليمات (r41): بطاقات المعلمات اللاتي سلّمن، وعند الضغط على البطاقة تُفتح ملفاتها مع معاينة وتنزيل.
 * تستعمل للمديرة (الصفحة الافتتاحية بعد الدخول) وللمالكة (متابعة الملفات).
 */
export default function SubmissionsBoard({ base }: { base: string }) {
  const { teachers, submissions, terms, years } = useStore()
  const sel = useTermSelection()
  const ps = usePageState(`submissions-${base}`)
  const [filter, setFilter] = useState<Filter>('submitted')
  const [q, setQ] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)

  const rows = useMemo(() => teachers.filter((t) => t.active).map((t) => {
    const items = itemsFor(submissions, t.id, sel.termId)
    return { t, items, submitted: items.some((i) => i.versions.length > 0), overall: overallStatus(items.map((i) => i.status)), last: lastActivity(submissions, t.id, sel.termId) }
  }), [teachers, submissions, sel.termId])
  const counts = useMemo(() => ({ submitted: rows.filter((r) => r.submitted).length, missing: rows.filter((r) => !r.submitted).length, all: rows.length }), [rows])
  const shown = useMemo(() => {
    const needle = q.trim()
    return rows
      .filter((r) => filter === 'all' || (filter === 'submitted' ? r.submitted : !r.submitted))
      .filter((r) => !needle || r.t.name.includes(needle))
      .sort((a, b) => (b.last ?? '').localeCompare(a.last ?? '') || a.t.name.localeCompare(b.t.name, 'ar'))
  }, [rows, filter, q])

  if (ps.phase === 'loading') return <PageSkeleton />
  if (ps.phase === 'error') return <ErrorState onRetry={ps.retry} />

  const label = termLabelOf(terms, years, sel.termId)
  const opened: Teacher | undefined = openId ? teachers.find((t) => t.id === openId) : undefined
  const data = ps.empty ? [] : shown

  return (
    <div>
      <PageHeader title="التسليمات" subtitle="بطاقات المعلمات حسب التسليم. اضغطي على بطاقة لمعاينة ملفاتها وتنزيلها." />
      <Card className="mb-5 space-y-4 p-4" as="div">
        <Tabs<Filter> label="تصفية البطاقات" value={filter} onChange={setFilter} items={[
          { id: 'submitted', label: `المسلِّمات (${fmtNum(counts.submitted)})`, icon: CheckCircle2 },
          { id: 'missing', label: `لم يسلّمن (${fmtNum(counts.missing)})`, icon: CircleDashed },
          { id: 'all', label: `الكل (${fmtNum(counts.all)})`, icon: Users },
        ]} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="بحث باسم المعلمة">
            {({ id }) => (
              <div className="relative">
                <Search className="pointer-events-none absolute start-3 top-3 size-5 text-ink-300" aria-hidden />
                <Input id={id} value={q} onChange={(e) => setQ(e.target.value)} placeholder="اكتبي الاسم" className="ps-10" type="search" />
              </div>
            )}
          </Field>
          <TermPicker sel={sel} />
        </div>
      </Card>

      {data.length === 0 ? (
        <Card as="div"><EmptyState icon={SearchX} title={q.trim() ? 'لا توجد نتائج' : filter === 'submitted' ? 'لا توجد تسليمات في هذا الفصل بعد' : 'لا توجد معلمات في هذه القائمة'}
          text={q.trim() ? 'غيّري كلمة البحث أو اختاري «الكل».' : 'غيّري الفصل أو اختاري «الكل» لرؤية جميع المعلمات.'} /></Card>
      ) : (
        <>
          <p className="mb-3 text-sm text-ink-500" aria-live="polite">{fmtNum(data.length)} معلمة · {label}</p>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="بطاقات المعلمات">
            {data.map(({ t, items, overall, last }) => (
              <li key={t.id}>
                <button type="button" onClick={() => setOpenId(t.id)} aria-haspopup="dialog" aria-label={`${t.name}: عرض الملفات`}
                  className={cn('group flex h-full min-h-[10.5rem] w-full flex-col gap-3 rounded-xl2 border bg-gradient-to-br to-white p-4 text-start shadow-soft transition duration-200',
                    'hover:-translate-y-0.5 hover:shadow-pop focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-frost-300 motion-reduce:transition-none motion-reduce:hover:translate-y-0', TINT[overall])}>
                  <span className="flex items-start gap-3">
                    <TeacherAvatar teacher={t} size={48} />
                    <span className="min-w-0 flex-1"><span className="block truncate text-[17px] font-bold text-steel-900">{t.name}</span><span className="block truncate text-sm text-ink-600">{t.subject}</span></span>
                  </span>
                  <span><StatusBadge status={overall} /></span>
                  <span className="mt-auto space-y-1.5 border-t border-snow-300/70 pt-2.5 text-[13px] text-ink-600">
                    {items.map((it) => { const Icon = SLOT_ICON[it.status]; return (
                      <span key={it.slot.id} className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-1.5"><Icon className={cn('size-4 shrink-0', SLOT_COLOR[it.status])} aria-hidden /><span className="truncate">{it.slot.title}</span></span>
                        <span className="num shrink-0 text-ink-500">{it.versions.length ? `${fmtNum(it.versions.length)} ${it.versions.length === 1 ? 'نسخة' : 'نسخ'}` : it.slot.optional ? 'اختياري' : '—'}</span>
                      </span>) })}
                    <span className="block text-[12px] text-ink-500">{last ? `آخر نشاط: ${fmtDateTime(last)}` : 'لا نشاط بعد'}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {opened && <TeacherFilesDialog teacher={opened} termId={sel.termId} termLabel={label} detailHref={`${base}/${opened.id}`} onClose={() => setOpenId(null)} />}
    </div>
  )
}
