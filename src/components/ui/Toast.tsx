import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import { cn } from '../../lib/cn'

type Tone = 'ok' | 'error' | 'info'
interface T { id: number; text: string; tone: Tone }
const Ctx = createContext<(text: string, tone?: Tone) => void>(() => {})
let n = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<T[]>([])
  const push = useCallback((text: string, tone: Tone = 'ok') => {
    const id = ++n
    setItems((s) => [...s, { id, text, tone }])
    setTimeout(() => setItems((s) => s.filter((x) => x.id !== id)), 4500)
  }, [])
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4" role="status" aria-live="polite">
        {items.map((t) => {
          const Icon = t.tone === 'ok' ? CheckCircle2 : t.tone === 'error' ? AlertTriangle : Info
          return (
            <div key={t.id} className={cn('pointer-events-auto flex max-w-md items-center gap-2.5 rounded-2xl border px-4 py-3 text-sm font-medium shadow-pop',
              t.tone === 'ok' && 'border-ok-line bg-ok-bg text-ok-fg', t.tone === 'error' && 'border-miss-line bg-miss-bg text-miss-fg', t.tone === 'info' && 'border-info-line bg-info-bg text-info-fg')}>
              <Icon className="size-5 shrink-0" aria-hidden />
              {t.text}
            </div>
          )
        })}
      </div>
    </Ctx.Provider>
  )
}
export const useToast = () => useContext(Ctx)
