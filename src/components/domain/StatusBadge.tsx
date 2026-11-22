import { CheckCircle2, Clock, CircleDashed } from 'lucide-react'
import type { ItemStatus } from '../../data/types'
import { cn } from '../../lib/cn'

const MAP = {
  on_time: { label: 'تم التسليم', cls: 'bg-ok-bg text-ok-fg border-ok-line', Icon: CheckCircle2 },
  late: { label: 'تم التسليم متأخرًا', cls: 'bg-late-bg text-late-fg border-late-line', Icon: Clock },
  missing: { label: 'لم يُسلّم', cls: 'bg-miss-bg text-miss-fg border-miss-line', Icon: CircleDashed },
} as const

export const STATUS_LABEL: Record<ItemStatus, string> = { on_time: 'تم التسليم', late: 'تم التسليم متأخرًا', missing: 'لم يُسلّم' }

export function StatusBadge({ status, className }: { status: ItemStatus; className?: string }) {
  const { label, cls, Icon } = MAP[status]
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[13px] font-medium', cls, className)}>
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {label}
    </span>
  )
}
