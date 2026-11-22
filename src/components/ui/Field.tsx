import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

interface FieldProps { label: string; hint?: string; error?: string | null; required?: boolean; children: (p: { id: string; describedBy?: string; invalid: boolean }) => ReactNode; className?: string }

export function Field({ label, hint, error, required, children, className }: FieldProps) {
  const id = useId()
  const hintId = `${id}-hint`
  const errId = `${id}-err`
  const describedBy = [hint ? hintId : '', error ? errId : ''].filter(Boolean).join(' ') || undefined
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={id} className="block text-sm font-medium text-ink-700">
        {label}
        {required && <span className="ms-1 text-miss-fg" aria-hidden>*</span>}
      </label>
      {children({ id, describedBy, invalid: !!error })}
      {hint && !error && <p id={hintId} className="text-[13px] text-ink-500">{hint}</p>}
      {error && <p id={errId} role="alert" className="text-[13px] font-medium text-miss-fg">{error}</p>}
    </div>
  )
}

const control = 'w-full rounded-xl border bg-white px-3.5 text-[15px] text-ink-900 placeholder:text-ink-300 transition-colors focus:border-steel-500 focus:outline-none focus:ring-2 focus:ring-steel-200 disabled:bg-snow-100 disabled:text-ink-500'
const ok = 'border-steel-200'
const bad = 'border-miss-fg bg-miss-bg/40'

export function Input({ invalid, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return <input aria-invalid={invalid || undefined} className={cn(control, 'h-11', invalid ? bad : ok, className)} {...rest} />
}
export function Select({ invalid, className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return <select aria-invalid={invalid || undefined} className={cn(control, 'h-11 appearance-none bg-[length:1rem] bg-[position:left_0.9rem_center] bg-no-repeat pe-3 ps-9', invalid ? bad : ok, className)} style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%235a687c'%3E%3Cpath d='M5.5 7.5 10 12l4.5-4.5' stroke='%235a687c' stroke-width='1.8' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")" }} {...rest}>{children}</select>
}
export function Textarea({ invalid, className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return <textarea aria-invalid={invalid || undefined} className={cn(control, 'min-h-24 py-2.5', invalid ? bad : ok, className)} {...rest} />
}
