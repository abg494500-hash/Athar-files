import type { ReactNode } from 'react'
import { CloudOff, Inbox, Loader2, type LucideIcon } from 'lucide-react'
import { Button } from './Button'
import { Card } from './misc'

export function EmptyState({ icon: Icon = Inbox, title, text, action }: { icon?: LucideIcon; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <span className="mb-4 inline-flex size-14 items-center justify-center rounded-2xl bg-frost-100 text-frost-700 ring-1 ring-frost-200"><Icon className="size-7" aria-hidden /></span>
      <h3 className="text-lg font-bold text-steel-900">{title}</h3>
      {text && <p className="mt-1 max-w-sm text-[15px] text-ink-500">{text}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function ErrorState({ onRetry, text = 'تعذّر تحميل البيانات. تحققي من الاتصال ثم أعيدي المحاولة.' }: { onRetry?: () => void; text?: string }) {
  return (
    <Card className="mx-auto max-w-lg" as="div">
      <div role="alert">
        <EmptyState icon={CloudOff} title="حدث خطأ أثناء التحميل" text={text} action={onRetry && <Button variant="secondary" onClick={onRetry}>إعادة المحاولة</Button>} />
      </div>
    </Card>
  )
}

export function PageSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div role="status" aria-label="جارٍ التحميل" className="space-y-5">
      <div className="skeleton h-9 w-56" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-28" />)}
      </div>
      <div className="space-y-3">{Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton h-14" />)}</div>
      <span className="sr-only">جارٍ التحميل…</span>
    </div>
  )
}

export function Spinner({ label = 'جارٍ التحميل' }: { label?: string }) {
  return <span role="status" className="inline-flex items-center gap-2 text-ink-500"><Loader2 className="size-4 animate-spin" aria-hidden />{label}</span>
}
