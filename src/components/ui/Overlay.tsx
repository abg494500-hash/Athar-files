import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '../../lib/cn'

interface Props {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  variant?: 'center' | 'drawer'
  size?: 'md' | 'lg' | 'xl' | '2xl'
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

/** نافذة حوار متاحة: تحبس التركيز، تُغلق بـ Esc، وتعيد التركيز لما قبلها. على الهاتف تظهر كورقة سفلية. */
export function Dialog({ open, onClose, title, description, children, footer, variant = 'center', size = 'md' }: Props) {
  const panel = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    const body = document.body
    const old = body.style.overflow
    body.style.overflow = 'hidden'
    const el = panel.current
    const first = el?.querySelector<HTMLElement>('[data-autofocus]') ?? el?.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? el)?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeRef.current(); return }
      if (e.key !== 'Tab' || !el) return
      const f = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (!f.length) return
      const a = f[0], z = f[f.length - 1]
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus() }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); body.style.overflow = old; prev?.focus?.() }
  }, [open])

  if (!open) return null
  const widths = { md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl', '2xl': 'sm:max-w-6xl' }
  return (
    <div className={cn('fixed inset-0 z-50 flex', variant === 'drawer' ? 'items-stretch justify-start' : 'items-end justify-center sm:items-center sm:p-6')}>
      <div className="absolute inset-0 bg-steel-900/40 backdrop-blur-[1px]" onClick={onClose} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          'relative flex max-h-[92dvh] w-full flex-col bg-white shadow-pop outline-none',
          variant === 'drawer' ? 'h-full max-h-none w-[19rem] max-w-[86vw]' : cn('rounded-t-3xl sm:rounded-3xl', widths[size]),
        )}
      >
        <div className="flex items-start gap-3 border-b border-snow-300 px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-steel-900">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-ink-500">{description}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="إغلاق" className="-m-1 inline-flex size-10 shrink-0 items-center justify-center rounded-xl text-ink-600 hover:bg-steel-100">
            <X className="size-5" aria-hidden />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-col-reverse gap-2 border-t border-snow-300 px-5 py-4 sm:flex-row sm:justify-end">{footer}</div>}
      </div>
    </div>
  )
}
