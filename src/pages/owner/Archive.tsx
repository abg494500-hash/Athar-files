// صفحة «الأرشفة والتحقق» (A-118): الأرشفة الوحيدة هي السنوية المحلية (تُبنى في متصفح المالكة وتُحفظ على جهازها). لا إنشاء أرشيف سحابي ولا رفع إلى R2.
// قسم «أرشيفات سحابية قديمة» يظهر فقط إن وُجد أرشيف سبق رفعه قبل القرار: يُنزَّل إلى الجهاز ويُتحقَّق من بصمته، ثم يحذفه التصفير السنوي من R2.
import { useCallback, useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import { usePageState } from '../../lib/pageState'
import { Alert, Card, Chip, PageHeader } from '../../components/ui/misc'
import { Button } from '../../components/ui/Button'
import { ErrorState, PageSkeleton } from '../../components/ui/States'
import { fmtDateTime, fmtSize } from '../../lib/format'
import { useToast } from '../../components/ui/Toast'
import { useStaffApi } from '../../lib/staffApi/StaffApiContext'
import { staffMessage } from '../../lib/staffApi/client'
import type { LegacyArchiveRow, StaffApiClient } from '../../lib/staffApi/client'
import { YearArchivePanel } from './YearArchivePanel'

function saveBytes(name: string, bytes: Uint8Array) {
  const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: 'application/zip' }))
  const a = document.createElement('a')
  a.href = url; a.download = name; a.rel = 'noopener'
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

function LegacyCloudPanel({ staffApi }: { staffApi: StaffApiClient }) {
  const toast = useToast()
  const [list, setList] = useState<LegacyArchiveRow[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const refresh = useCallback(async () => { const r = await (staffApi.legacyArchives ? staffApi.legacyArchives() : Promise.resolve({ ok: false as const })); if (r.ok) setList(r.value) }, [staffApi])
  useEffect(() => { void refresh() }, [refresh])
  if (list.length === 0) return null
  const dl = async (id: string) => {
    setBusy(id)
    const r = await staffApi.downloadLegacyArchive(id)
    setBusy(null)
    if (!r.ok) { toast(staffMessage(r), 'info'); return }
    saveBytes(r.value.filename, r.value.bytes)
    toast('نُزّل الأرشيف وتطابقت بصمته. انسخيه إلى الهاردسك الخارجي.', 'info'); void refresh()
  }
  return (
    <Card className="space-y-3 p-4 sm:p-5" as="section">
      <h2 className="text-lg font-bold text-steel-900">أرشيفات سحابية قديمة (للنقل إلى جهازكِ)</h2>
      <Alert tone="warn" title="لن تُنشأ أرشيفات جديدة في Cloud">هذه أرشيفات سبق رفعها إلى R2 قبل اعتماد الأرشفة المحلية. نزّليها واحفظيها على اللابتوب والهاردسك؛ ولا يسمح التصفير السنوي بالمتابعة قبل نقل أرشيف السنة، ثم يحذفها من R2 مع بيانات السنة.</Alert>
      <ul className="space-y-3">
        {list.map((a) => (
          <li key={a.id} className="rounded-2xl border border-snow-300 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-bold text-steel-900">{a.title}</p>{a.transferredAt ? <Chip tone="steel">نُقل وتحقق {fmtDateTime(a.transferredAt)}</Chip> : <Chip>لم يُنقل بعد</Chip>}</div>
            <p className="mt-1 text-[13px] text-ink-500"><span className="num">{fmtSize(a.sizeBytes)}</span> · أُنشئ {fmtDateTime(a.createdAt)}</p>
            <div className="mt-3"><Button size="sm" variant="secondary" icon={Download} loading={busy === a.id} onClick={() => void dl(a.id)}>تنزيل والتحقق من البصمة</Button></div>
          </li>
        ))}
      </ul>
    </Card>
  )
}

export default function ArchivePage() {
  const staffApi = useStaffApi()
  const ps = usePageState('archive')
  if (ps.phase === 'loading') return <PageSkeleton />
  if (ps.phase === 'error') return <ErrorState onRetry={ps.retry} />
  return (
    <div className="space-y-5">
      <PageHeader title="الأرشفة والتحقق" subtitle="أرشيف السنة كاملة يُبنى في متصفحكِ ويُحفظ على اللابتوب ونسخة ثانية على هاردسك خارجي، ولا يُرفع إلى أي خدمة سحابية." />
      {staffApi ? <><YearArchivePanel staffApi={staffApi} /><LegacyCloudPanel staffApi={staffApi} /></> : (
        <Alert tone="info" title="غير متاح">الأرشفة السنوية تحتاج ضبط الواجهة الخادمية (START_HERE §7–8).</Alert>
      )}
    </div>
  )
}
