import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, Eye, ExternalLink, FileText, Link2, MousePointerClick } from 'lucide-react'
import { useStore } from '../../data/store'
import { itemsFor, teacherStatus } from '../../data/selectors'
import type { Teacher, Version } from '../../data/types'
import { Dialog } from '../ui/Overlay'
import { Button } from '../ui/Button'
import { Chip } from '../ui/misc'
import { StatusBadge } from './StatusBadge'
import { TeacherAvatar } from './TeacherAvatar'
import { FilePreviewPanel } from './FilePreviewPanel'
import { useFileAccess } from '../../lib/useFileAccess'
import { fmtDateTime, fmtSize } from '../../lib/format'
import { cn } from '../../lib/cn'

/**
 * نافذة ملفات معلمة (r41): عند الضغط على بطاقتها في صفحة التسليمات. على اليمين ملفاتها حسب العنصر ونسخها (معاينة/تنزيل)،
 * وعلى اليسار معاينة الملف المحدّد. الأحدث محدّد افتراضيًا.
 */
export function TeacherFilesDialog({ teacher, termId, termLabel, detailHref, onClose }: { teacher: Teacher; termId: string; termLabel: string; detailHref: string; onClose: () => void }) {
  const { submissions } = useStore()
  const access = useFileAccess()
  const items = useMemo(() => itemsFor(submissions, teacher.id, termId), [submissions, teacher.id, termId])
  const overall = teacherStatus(submissions, teacher.id, termId)
  const latest = useMemo(() => items.flatMap((i) => [...i.versions].sort((a, b) => b.no - a.no).slice(0, 1))[0] ?? null, [items])
  const [pickedId, setPickedId] = useState<string | null>(null)
  const all = items.flatMap((i) => i.versions)
  const active: Version | null = all.find((v) => v.id === pickedId) ?? latest

  return (
    <Dialog open onClose={onClose} size="2xl" title={teacher.name} description={`${teacher.subject} · ${termLabel}`}
      footer={<><Link to={detailHref} className="me-auto inline-flex h-11 items-center rounded-xl px-3 text-[15px] font-medium text-steel-700 hover:bg-frost-100">فتح صفحة المعلمة الكاملة</Link><Button variant="secondary" onClick={onClose}>إغلاق</Button></>}>
      <div className="mb-4 flex items-center gap-3"><TeacherAvatar teacher={teacher} size={44} /><StatusBadge status={overall} /></div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <div className="space-y-4">
          {items.map((it) => (
            <section key={it.slot.id} aria-label={it.slot.title} className="rounded-2xl border border-snow-300 bg-snow-50 p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-bold text-steel-900">{it.slot.title}{it.slot.optional && <span className="ms-2"><Chip tone="lav">اختياري</Chip></span>}</h3>
                {it.versions.length > 0 && <StatusBadge status={it.status} />}
              </div>
              {it.versions.length === 0 ? (
                <p className="rounded-xl bg-white p-3 text-sm text-ink-500">{it.slot.optional ? 'لم تستخدم المعلمة هذا العنصر، ولا يُعد ذلك نقصًا.' : 'لا توجد تسليمات لهذا العنصر.'}</p>
              ) : (
                <ol className="space-y-2">
                  {[...it.versions].sort((a, b) => b.no - a.no).map((v, i) => {
                    const picked = active?.id === v.id
                    return (
                      <li key={v.id} className={cn('rounded-xl border bg-white p-2.5 transition-colors', picked ? 'border-frost-300 ring-2 ring-frost-200' : 'border-snow-300')}>
                        <div className="flex items-start gap-2.5">
                          <span className={cn('mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-xl', picked ? 'bg-frost-100 text-frost-700' : 'bg-steel-100 text-steel-700')}>
                            {v.kind === 'link' ? <Link2 className="size-4" aria-hidden /> : <FileText className="size-4" aria-hidden />}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-steel-900">النسخة {v.no}{i === 0 && <span className="ms-2 rounded-full bg-mint-100 px-2 py-0.5 text-[12px] text-mint-700">الأحدث</span>}</p>
                            <p className="truncate text-[13px] text-ink-600" dir="auto">{v.kind === 'link' ? v.url : v.fileName}</p>
                            <p className="text-[12px] text-ink-500">{fmtDateTime(v.submittedAt)}{v.size ? ` · ${fmtSize(v.size)}` : ''}</p>
                          </div>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <Button size="sm" variant={picked ? 'primary' : 'secondary'} icon={Eye} aria-pressed={picked} onClick={() => setPickedId(v.id)}>معاينة</Button>
                          {v.kind === 'file'
                            ? <Button size="sm" variant="ghost" icon={Download} disabled={!access.download} onClick={() => access.download?.(v)}>تنزيل</Button>
                            : v.url && <a href={v.url} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-medium text-steel-800 hover:bg-frost-100"><ExternalLink className="size-4" aria-hidden />فتح الرابط</a>}
                        </div>
                      </li>
                    )
                  })}
                </ol>
              )}
            </section>
          ))}
        </div>
        <div className="min-w-0" aria-live="polite">
          {active ? (
            <>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="min-w-0 truncate text-sm font-medium text-steel-900" dir="auto">{active.kind === 'link' ? 'رابط' : active.fileName} — النسخة {active.no}</p>
                {active.kind === 'file' && <Button size="sm" icon={Download} disabled={!access.download} onClick={() => access.download?.(active)}>تنزيل هذا الملف</Button>}
              </div>
              <FilePreviewPanel key={active.id} version={active} access={access} />
            </>
          ) : (
            <div className="flex min-h-[16rem] flex-col items-center justify-center gap-2 rounded-2xl bg-frost-50 p-6 text-center text-ink-600"><MousePointerClick className="size-7 text-frost-700" aria-hidden /><p>لا توجد ملفات لعرضها بعد.</p></div>
          )}
        </div>
      </div>
    </Dialog>
  )
}
