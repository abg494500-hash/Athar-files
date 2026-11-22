import { CheckCircle2, CircleDashed, Loader2, XCircle } from 'lucide-react'
import type { ArchiveStatus } from '../../data/types'
import { cn } from '../../lib/cn'

const MAP: Record<ArchiveStatus, { label: string; cls: string; Icon: typeof CheckCircle2; spin?: boolean }> = {
  creating: { label: 'قيد المعالجة', cls: 'bg-info-bg text-info-fg border-info-line', Icon: Loader2, spin: true },
  awaiting_verification: { label: 'بانتظار التحقق', cls: 'bg-late-bg text-late-fg border-late-line', Icon: CircleDashed },
  verified: { label: 'تم التحقق', cls: 'bg-ok-bg text-ok-fg border-ok-line', Icon: CheckCircle2 },
  failed: { label: 'فشل التحقق', cls: 'bg-miss-bg text-miss-fg border-miss-line', Icon: XCircle },
}
export const ARCHIVE_STATUS_LABEL = (s: ArchiveStatus) => MAP[s].label

export function Badge({ status }: { status: ArchiveStatus }) {
  const { label, cls, Icon, spin } = MAP[status]
  return <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[13px] font-medium', cls)}><Icon className={cn('size-3.5', spin && 'animate-spin')} aria-hidden />{label}</span>
}
