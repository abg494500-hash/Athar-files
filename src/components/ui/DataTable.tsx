import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

export interface Column<T> {
  key: string
  header: string
  cell: (row: T) => ReactNode
  /** يظهر كعنوان للبطاقة على الهاتف */
  primary?: boolean
  /** إخفاء العمود في بطاقة الهاتف */
  hideOnMobile?: boolean
  className?: string
}

/**
 * جدول على الشاشات الكبيرة، وبطاقات مكدّسة على الهاتف، فلا يتجاوز عرض الشاشة أبدًا.
 */
export function DataTable<T>({ columns, rows, rowKey, onRowClick, caption }: { columns: Column<T>[]; rows: T[]; rowKey: (r: T) => string; onRowClick?: (r: T) => void; caption: string }) {
  const primary = columns.find((c) => c.primary) ?? columns[0]
  const rest = columns.filter((c) => c !== primary && !c.hideOnMobile)
  return (
    <>
      <div className="hidden overflow-hidden rounded-xl2 border border-snow-300 bg-white shadow-soft md:block">
        <table className="w-full table-fixed border-collapse text-[15px]">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-snow-300 bg-snow-50 text-start text-sm text-ink-500">
              {columns.map((c) => <th key={c.key} scope="col" className={cn('px-4 py-3 text-start font-medium', c.className)}>{c.header}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={rowKey(r)} onClick={onRowClick ? () => onRowClick(r) : undefined}
                className={cn('border-b border-snow-200 last:border-0', onRowClick && 'cursor-pointer hover:bg-steel-50')}>
                {columns.map((c) => <td key={c.key} className={cn('px-4 py-3 align-middle', c.className)}>{c.cell(r)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="space-y-3 md:hidden" aria-label={caption}>
        {rows.map((r) => (
          <li key={rowKey(r)} className="rounded-xl2 border border-snow-300 bg-white p-4 shadow-soft">
            <div onClick={onRowClick ? () => onRowClick(r) : undefined} className={cn(onRowClick && 'cursor-pointer')}>
              <div className="mb-3 font-bold text-steel-900">{primary.cell(r)}</div>
              <dl className="space-y-2">
                {rest.map((c) => (
                  <div key={c.key} className="flex items-center justify-between gap-3 text-sm">
                    <dt className="shrink-0 text-ink-500">{c.header}</dt>
                    <dd className="min-w-0 text-end">{c.cell(r)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </li>
        ))}
      </ul>
    </>
  )
}
