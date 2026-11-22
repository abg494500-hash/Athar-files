import type { CSSProperties, ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Info, OctagonAlert, type LucideIcon } from 'lucide-react'
import { cn } from '../../lib/cn'

export function Card({ children, className, style, as: Tag = 'section' }: { children: ReactNode; className?: string; style?: CSSProperties; as?: 'section' | 'div' | 'article' }) {
  return <Tag className={cn('min-w-0 rounded-xl2 border border-snow-300 bg-white shadow-soft', className)} style={style}>{children}</Tag>
}

export function SectionTitle({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-lg font-bold text-steel-900">{title}</h2>
        {hint && <p className="mt-0.5 text-sm text-ink-500">{hint}</p>}
      </div>
      {action}
    </div>
  )
}

export function PageHeader({ title, subtitle, actions, leading }: { title: string; subtitle?: string; actions?: ReactNode; leading?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      {leading}
      <div className="min-w-0 flex-1">
        <h1 className="text-2xl font-bold text-steel-900 sm:text-[1.7rem]">{title}</h1>
        {subtitle && <p className="mt-1 text-[15px] text-ink-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

const alertTone = {
  info: { cls: 'border-info-line bg-info-bg text-info-fg', Icon: Info },
  warn: { cls: 'border-late-line bg-late-bg text-late-fg', Icon: AlertTriangle },
  danger: { cls: 'border-miss-line bg-miss-bg text-miss-fg', Icon: OctagonAlert },
  ok: { cls: 'border-ok-line bg-ok-bg text-ok-fg', Icon: CheckCircle2 },
} as const

export function Alert({ tone = 'info', title, children, className }: { tone?: keyof typeof alertTone; title?: string; children?: ReactNode; className?: string }) {
  const { cls, Icon } = alertTone[tone]
  return (
    <div role={tone === 'danger' || tone === 'warn' ? 'alert' : 'note'} className={cn('flex gap-3 rounded-2xl border p-4', cls, className)}>
      <Icon className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div className="min-w-0 text-[15px] leading-7">
        {title && <p className="font-bold">{title}</p>}
        {children && <div className={title ? 'mt-0.5' : ''}>{children}</div>}
      </div>
    </div>
  )
}

export function Progress({ value, label, className }: { value: number; label: string; className?: string }) {
  const v = Math.max(0, Math.min(100, value))
  return (
    <div className={cn('h-2.5 w-full overflow-hidden rounded-full bg-steel-100', className)} role="progressbar" aria-label={label} aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-gradient-to-l from-frost-500 to-steel-500 transition-all" style={{ width: `${v}%` }} />
    </div>
  )
}

export function Tabs<T extends string>({ value, onChange, items, label }: { value: T; onChange: (v: T) => void; items: { id: T; label: string; icon?: LucideIcon }[]; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="grid auto-cols-fr grid-flow-col gap-1 rounded-2xl bg-steel-100 p-1">
      {items.map((it) => (
        <button key={it.id} role="tab" type="button" aria-selected={value === it.id} onClick={() => onChange(it.id)}
          className={cn('inline-flex h-10 items-center justify-center gap-2 rounded-xl px-3 text-[15px] font-medium transition-colors', value === it.id ? 'bg-white text-steel-900 shadow-soft' : 'text-steel-700 hover:bg-white/60')}>
          {it.icon && <it.icon className="size-4" aria-hidden />}
          {it.label}
        </button>
      ))}
    </div>
  )
}

export function Stat({ label, value, hint, icon: Icon, tone = 'steel' }: { label: string; value: ReactNode; hint?: string; icon?: LucideIcon; tone?: 'steel' | 'ok' | 'late' | 'miss' | 'lav' }) {
  const tones = { steel: 'bg-steel-100 text-steel-700', ok: 'bg-ok-bg text-ok-fg', late: 'bg-late-bg text-late-fg', miss: 'bg-miss-bg text-miss-fg', lav: 'bg-lav-100 text-lav-700' }
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-ink-500">{label}</p>
          <p className="num mt-1 text-3xl font-bold text-steel-900">{value}</p>
          {hint && <p className="mt-1 text-[13px] text-ink-500">{hint}</p>}
        </div>
        {Icon && <span className={cn('inline-flex size-10 shrink-0 items-center justify-center rounded-xl', tones[tone])}><Icon className="size-5" aria-hidden /></span>}
      </div>
    </Card>
  )
}

export function Chip({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'lav' | 'steel' }) {
  const t = { neutral: 'bg-snow-200 text-ink-600', lav: 'bg-lav-100 text-lav-700', steel: 'bg-steel-100 text-steel-700' }
  return <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-[13px] font-medium', t[tone])}>{children}</span>
}
