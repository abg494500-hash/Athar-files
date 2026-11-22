import { cn } from '../../lib/cn'
import { fmtNum } from '../../lib/format'

/** شريط مكدّس لتوزيع الحالات مع مفتاح نصي (لا يعتمد على اللون وحده). */
export function StatusBar({ on_time, late, missing, className }: { on_time: number; late: number; missing: number; className?: string }) {
  const total = on_time + late + missing || 1
  const parts = [
    { k: 'on_time', n: on_time, label: 'تم التسليم', bar: 'bg-[#86bba6]', dot: 'bg-[#86bba6]' },
    { k: 'late', n: late, label: 'متأخر', bar: 'bg-[#e2c77f]', dot: 'bg-[#e2c77f]' },
    { k: 'missing', n: missing, label: 'لم يُسلّم', bar: 'bg-[#dea3ab]', dot: 'bg-[#dea3ab]' },
  ]
  return (
    <div className={className}>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-snow-200" role="img" aria-label={`تم التسليم ${on_time}، متأخر ${late}، لم يُسلّم ${missing}`}>
        {parts.map((p) => p.n > 0 && <div key={p.k} className={cn(p.bar, 'h-full border-s border-white first:border-s-0')} style={{ width: `${(p.n / total) * 100}%` }} />)}
      </div>
      <ul className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-600">
        {parts.map((p) => <li key={p.k} className="flex items-center gap-2"><span className={cn('size-2.5 rounded-full', p.dot)} aria-hidden />{p.label}: <span className="num font-medium">{fmtNum(p.n)}</span></li>)}
      </ul>
    </div>
  )
}
