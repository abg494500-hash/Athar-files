import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Loader2, type LucideIcon } from 'lucide-react'
import { cn } from '../../lib/cn'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'lav'
interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: 'sm' | 'md'
  icon?: LucideIcon
  loading?: boolean
  children?: ReactNode
}

const base = 'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 select-none whitespace-nowrap'
const variants: Record<Variant, string> = {
  primary: 'bg-steel-800 text-white hover:bg-steel-900 active:bg-steel-900',
  secondary: 'bg-white text-steel-900 border border-steel-300 hover:bg-steel-50',
  ghost: 'text-steel-800 hover:bg-steel-100',
  lav: 'bg-lav-200 text-lav-700 hover:bg-lav-300/70 border border-lav-300',
  danger: 'bg-miss-fg text-white hover:bg-[#6f2c37]',
}
const sizes = { sm: 'h-10 px-3.5 text-sm', md: 'h-11 px-5 text-[15px]' }

export function Button({ variant = 'primary', size = 'md', icon: Icon, loading, children, className, disabled, type = 'button', ...rest }: Props) {
  return (
    <button type={type} disabled={disabled || loading} className={cn(base, variants[variant], sizes[size], className)} {...rest}>
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : Icon ? <Icon className="size-4" aria-hidden /> : null}
      {children}
    </button>
  )
}

export function IconButton({ icon: Icon, label, className, ...rest }: { icon: LucideIcon; label: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" aria-label={label} title={label} className={cn('inline-flex size-11 items-center justify-center rounded-xl text-steel-800 hover:bg-steel-100', className)} {...rest}>
      <Icon className="size-5" aria-hidden />
    </button>
  )
}
