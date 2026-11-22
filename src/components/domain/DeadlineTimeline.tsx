import { CalendarCheck2, CalendarClock, CalendarX2 } from 'lucide-react'
import type { Deadlines } from '../../data/types'
import { endOfDay } from '../../lib/status'
import { daysUntil, fmtDay, fmtDaysText } from '../../lib/format'
import { cn } from '../../lib/cn'

/** المواعيد الثلاثة للفصل مع حالة كل موعد: منتهٍ / الحالي / قادم. */
export function DeadlineTimeline({ deadlines, now, compact }: { deadlines: Deadlines; now: number; compact?: boolean }) {
  const items = [
    { key: 'base', title: 'الموعد الأساسي', day: deadlines.base, Icon: CalendarCheck2 },
    { key: 'late', title: 'آخر موعد للتسليم المتأخر', day: deadlines.late, Icon: CalendarClock },
    { key: 'replace', title: 'آخر موعد للاستبدال', day: deadlines.replace, Icon: CalendarX2 },
  ]
  const firstOpen = items.findIndex((i) => now <= endOfDay(i.day))
  return (
    <ol className={cn('grid gap-3', compact ? 'sm:grid-cols-3' : 'md:grid-cols-3')}>
      {items.map((it, idx) => {
        const passed = now > endOfDay(it.day)
        const current = idx === firstOpen
        const d = daysUntil(endOfDay(it.day), now)
        return (
          <li key={it.key} className={cn('rounded-2xl border p-3.5', passed ? 'border-snow-300 bg-snow-50' : current ? 'border-steel-300 bg-steel-50' : 'border-snow-300 bg-white')}>
            <div className="flex items-center gap-2 text-sm font-medium text-steel-800">
              <it.Icon className="size-4" aria-hidden />
              {it.title}
            </div>
            <p className="mt-1.5 font-bold text-steel-900">{fmtDay(it.day)}</p>
            <p className="mt-0.5 text-[13px] text-ink-500">
              {passed ? 'انتهى' : `ينتهي ${fmtDaysText(d)}`}
              {current && !passed && <span className="ms-2 rounded-full bg-steel-200 px-2 py-0.5 text-[12px] font-medium text-steel-800">الحالي</span>}
            </p>
          </li>
        )
      })}
    </ol>
  )
}
