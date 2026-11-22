import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { cn } from '../../lib/cn'
import type { Section, SectionTone } from '../../lib/sections'

const TONE: Record<SectionTone, { icon: string; card: string }> = {
  frost: { icon: 'bg-frost-100 text-frost-700 ring-frost-200', card: 'from-frost-100/80' },
  lav: { icon: 'bg-lav-100 text-lav-700 ring-lav-200', card: 'from-lav-100/80' },
  steel: { icon: 'bg-steel-100 text-steel-700 ring-steel-200', card: 'from-steel-100/80' },
  mint: { icon: 'bg-mint-100 text-mint-700 ring-mint-200', card: 'from-mint-100/80' },
  blush: { icon: 'bg-blush-100 text-blush-700 ring-blush-200', card: 'from-blush-100/80' },
  sand: { icon: 'bg-sand-100 text-sand-700 ring-sand-200', card: 'from-sand-100/80' },
  aqua: { icon: 'bg-aqua-100 text-aqua-700 ring-aqua-200', card: 'from-aqua-100/80' },
}

/** بطاقة قسم في الصفحة الرئيسية: رابط كامل (هدف لمس كبير) مع أيقونة ووصف وسطر بيانات حقيقية اختياري. */
export function SectionCard({ section, meta, metaTone = 'neutral' }: { section: Section; meta?: string; metaTone?: 'neutral' | 'attention' }) {
  const Icon = section.icon
  return (
    <Link to={section.to}
      className={cn(
        'group relative flex min-h-[8.5rem] min-w-0 flex-col gap-3 rounded-xl2 border bg-gradient-to-br to-white p-4 shadow-soft transition duration-200 sm:p-5', TONE[section.tone].card,
        'hover:-translate-y-0.5 hover:shadow-pop motion-reduce:transition-none motion-reduce:hover:translate-y-0',
        section.sensitive ? 'border-miss-line hover:border-miss-fg/40' : 'border-snow-300 hover:border-frost-300',
      )}>
      <div className="flex items-start justify-between gap-3">
        <span className={cn('inline-flex size-12 shrink-0 items-center justify-center rounded-2xl ring-1', TONE[section.tone].icon)}><Icon className="size-6" aria-hidden /></span>
        <span aria-hidden className="inline-flex size-9 items-center justify-center rounded-full text-steel-400 transition group-hover:bg-frost-100 group-hover:text-steel-800"><ArrowLeft className="size-5" /></span>
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="text-[1.05rem] font-bold text-steel-900">{section.label}</h3>
        <p className="mt-0.5 text-[14px] leading-6 text-ink-500">{section.description}</p>
      </div>
      {(meta || section.sensitive) && (
        <div className="flex flex-wrap items-center gap-2">
          {meta && <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-[13px] font-medium', metaTone === 'attention' ? 'bg-late-bg text-late-fg' : 'bg-snow-200 text-ink-600')}>{meta}</span>}
          {section.sensitive && <span className="inline-flex items-center rounded-full bg-miss-bg px-2.5 py-0.5 text-[13px] font-medium text-miss-fg">إجراء حساس</span>}
        </div>
      )}
    </Link>
  )
}
