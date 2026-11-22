import { useState } from 'react'
import { ChevronDown, History, Send, RefreshCw, Lock } from 'lucide-react'
import { useStore } from '../../data/store'
import { itemsFor, type ItemView } from '../../data/selectors'
import { canReplace, canSubmitNew, deadlineAlert, overallStatus, phaseAt, endOfDay } from '../../lib/status'
import { fmtDateTime, fmtDay, fmtDaysText, daysUntil } from '../../lib/format'
import { usePageState } from '../../lib/pageState'
import { PageHeader, Card, Alert, Chip } from '../../components/ui/misc'
import { Button } from '../../components/ui/Button'
import { ErrorState, PageSkeleton } from '../../components/ui/States'
import { StatusBadge } from '../../components/domain/StatusBadge'
import { DeadlineTimeline } from '../../components/domain/DeadlineTimeline'
import { VersionList } from '../../components/domain/VersionList'
import { SubmitDialog } from './SubmitDialog'
import { cn } from '../../lib/cn'
import { TeacherAvatar } from '../../components/domain/TeacherAvatar'
import { TEACHER_COLORS } from '../../data/types'

export default function TeacherHome() {
  const { session, teachers, terms, years, currentTermId, submissions, now } = useStore()
  const ps = usePageState('teacher-home')
  const [dlg, setDlg] = useState<{ item: ItemView; replacing: boolean } | null>(null)

  const teacher = teachers.find((t) => t.id === session?.teacherId)
  const term = terms.find((t) => t.id === currentTermId)
  if (!teacher || !term) return null
  const year = years.find((y) => y.id === term.yearId)

  if (ps.phase === 'loading') return <PageSkeleton rows={2} />
  if (ps.phase === 'error') return <ErrorState onRetry={ps.retry} />

  const items = itemsFor(submissions, teacher.id, term.id)
  const overall = overallStatus(items.map((i) => i.status))
  const first = teacher.name.split(' ')[0]
  const phase = phaseAt(now, term.deadlines)

  const summary = overall === 'missing'
    ? { tone: 'info' as const, text: 'لم تُسلّمي أي عنصر في هذا الفصل بعد.' }
    : overall === 'on_time'
      ? { tone: 'ok' as const, text: 'سلّمتِ ملف الإنجاز ضمن الموعد الأساسي.' }
      : { tone: 'warn' as const, text: 'سُجّل أحد عناصر ملفك متأخرًا عن الموعد الأساسي.' }

  return (
    <div className="space-y-6">
      <PageHeader leading={<TeacherAvatar teacher={teacher} size={52} />} title={`أهلًا ${first}`} subtitle={`${year?.label ?? ''} · ${term.name}`} />

      <Card className="flex flex-wrap items-center justify-between gap-3 border-t-4 p-4 sm:p-5" as="div" style={{ borderTopColor: TEACHER_COLORS[teacher.colorIdx % TEACHER_COLORS.length].dot }}>
        <div>
          <p className="text-sm text-ink-500">حالة ملف الإنجاز في هذا الفصل</p>
          <p className="mt-1 font-medium text-steel-900">{summary.text}</p>
        </div>
        <StatusBadge status={overall} className="text-sm" />
      </Card>

      <section aria-labelledby="dl">
        <h2 id="dl" className="mb-3 text-lg font-bold text-steel-900">مواعيد الفصل</h2>
        <DeadlineTimeline deadlines={term.deadlines} now={now} />
        <p className="mt-2 text-[13px] text-ink-500">كل موعد ينتهي في نهاية يومه بتوقيت سلطنة عُمان.</p>
      </section>

      <section aria-labelledby="items" className="space-y-4">
        <h2 id="items" className="text-lg font-bold text-steel-900">عناصر ملف الإنجاز</h2>
        {items.map((it) => (
          <ItemCard key={it.slot.id} it={it} now={now} deadlines={term.deadlines} phase={phase}
            onAction={(replacing) => setDlg({ item: it, replacing })} />
        ))}
      </section>

      {dlg && (
        <SubmitDialog slot={dlg.item.slot} termId={term.id} teacherId={teacher.id} replacing={dlg.replacing}
          status={phase === 'before_base' ? 'on_time' : 'late'} onClose={() => setDlg(null)} />
      )}
    </div>
  )
}

function ItemCard({ it, now, deadlines, phase, onAction }: { it: ItemView; now: number; deadlines: import('../../data/types').Deadlines; phase: string; onAction: (replacing: boolean) => void }) {
  const [open, setOpen] = useState(false)
  const submitted = it.versions.length > 0
  const latest = it.versions.at(-1)
  const alert = deadlineAlert(now, deadlines, it.status, { optional: it.slot.optional }, { day: fmtDay, days: fmtDaysText })
  const allowed = submitted ? canReplace(now, deadlines) : canSubmitNew(now, deadlines)
  const nextDay = submitted ? deadlines.replace : phase === 'before_base' ? deadlines.base : deadlines.late
  const nextLabel = submitted ? 'آخر موعد للاستبدال' : phase === 'before_base' ? 'الموعد الأساسي' : 'آخر موعد للتسليم المتأخر'
  const left = daysUntil(endOfDay(nextDay), now)

  return (
    <Card className="p-4 sm:p-5" as="article">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-bold text-steel-900">{it.slot.title}</h3>
            {it.slot.optional && <Chip tone="lav">اختياري</Chip>}
          </div>
          <p className="mt-1 text-sm text-ink-500">{nextLabel}: <span className="font-medium text-ink-700">{fmtDay(nextDay)}</span>{allowed && left >= 0 ? ` (${fmtDaysText(left)})` : ''}</p>
        </div>
        <StatusBadge status={it.status} />
      </div>

      {it.slot.optional && (
        <p className="mt-3 rounded-xl bg-lav-100 px-3.5 py-2.5 text-sm text-lav-700">هذا العنصر اختياري، ولا يُحتسب عدم تسليمه وحده نقصًا في ملفك.</p>
      )}
      {alert && <Alert tone={alert.tone} title={alert.title} className="mt-3">{alert.text}</Alert>}

      {latest && (
        <div className="mt-4 rounded-2xl bg-snow-100 p-3.5 text-sm">
          <p className="text-ink-500">آخر نسخة مسلَّمة</p>
          <p className="mt-0.5 break-all font-medium text-steel-900" dir="auto">{latest.kind === 'link' ? latest.url : latest.fileName}</p>
          <p className="text-[13px] text-ink-500">النسخة {latest.no} · {fmtDateTime(latest.submittedAt)}</p>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button icon={submitted ? RefreshCw : Send} onClick={() => onAction(submitted)} disabled={!allowed} variant={submitted ? 'secondary' : 'primary'}>
          {submitted ? 'استبدال الملف' : 'تسليم'}
        </Button>
        {!allowed && <span className="inline-flex items-center gap-1.5 text-sm text-ink-500"><Lock className="size-4" aria-hidden />{submitted ? 'انتهت مهلة الاستبدال' : 'أُغلق باب التسليم'}</span>}
        {submitted && (
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
            className="ms-auto inline-flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-medium text-steel-800 hover:bg-steel-100">
            <History className="size-4" aria-hidden />سجل النسخ ({it.versions.length})
            <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} aria-hidden />
          </button>
        )}
      </div>

      {open && <div className="mt-4 border-t border-snow-300 pt-4"><VersionList versions={it.versions} /></div>}
    </Card>
  )
}
