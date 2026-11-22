import { Download, ExternalLink, Link2, FileText } from 'lucide-react'
import type { Version } from '../../data/types'
import { StatusBadge } from './StatusBadge'
import { Button } from '../ui/Button'
import { fmtDateTime, fmtSize } from '../../lib/format'
import { useToast } from '../ui/Toast'

/** سجل النسخ لعنصر واحد، الأحدث أولًا. showHash لواجهات الإدارة فقط. */
export function VersionList({ versions, showHash, onDownload }: { versions: Version[]; showHash?: boolean; onDownload?: (v: Version) => void }) {
  const toast = useToast()
  const sorted = [...versions].sort((a, b) => b.no - a.no)
  return (
    <ol className="space-y-2.5">
      {sorted.map((v, i) => {
        return (
          <li key={v.id} className="rounded-2xl border border-snow-300 bg-white p-3.5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex min-w-0 items-start gap-3">
                <span className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-steel-100 text-steel-700">
                  {v.kind === 'link' ? <Link2 className="size-4" aria-hidden /> : <FileText className="size-4" aria-hidden />}
                </span>
                <div className="min-w-0">
                  <p className="truncate font-medium text-steel-900">
                    النسخة {v.no}{i === 0 && <span className="ms-2 rounded-full bg-steel-200 px-2 py-0.5 text-[12px] text-steel-800">الأحدث</span>}
                  </p>
                  <p className="truncate text-sm text-ink-600" dir="auto">{v.kind === 'link' ? v.url : v.fileName}</p>
                  <p className="text-[13px] text-ink-500">{fmtDateTime(v.submittedAt)}{v.size ? ` · ${fmtSize(v.size)}` : ''}</p>
                </div>
              </div>
              <StatusBadge status={v.status} />
            </div>
            {showHash && <p className="mt-2 break-all text-[12px] text-ink-500"><span className="font-medium">SHA-256:</span> <span dir="ltr" className="num">{v.sha256.slice(0, 16)}…{v.sha256.slice(-6)}</span></p>}
            <div className="mt-3 flex flex-wrap gap-2">
              {v.kind === 'link' && (
                <a href={v.url} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center gap-2 rounded-xl border border-steel-300 bg-white px-3.5 text-sm font-medium text-steel-900 hover:bg-steel-50">
                  <ExternalLink className="size-4" aria-hidden />فتح الرابط
                </a>
              )}
              {v.kind === 'file' && <Button size="sm" variant="ghost" icon={Download} onClick={() => (onDownload ? onDownload(v) : toast('التنزيل غير متاح حاليًا.', 'info'))}>تنزيل</Button>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
