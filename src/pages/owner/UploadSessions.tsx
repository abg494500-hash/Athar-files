import { useCallback, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { RefreshCw, Unlock, Wrench } from 'lucide-react'
import { useStore } from '../../data/store'
import { useStaffApi } from '../../lib/staffApi/StaffApiContext'
import { staffMessage } from '../../lib/staffApi/client'
import type { PendingUpload, UploadOverview } from '../../lib/staffApi/client'
import { Alert, Card, Chip, PageHeader } from '../../components/ui/misc'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Overlay'
import { Field, Input, Select } from '../../components/ui/Field'
import { useToast } from '../../components/ui/Toast'

/**
 * عمليات الرفع (المالكة): ملخص جلسات الرفع وتسليمات الفصل، والجلسات العالقة (uploaded/validating) مع **إفراج المالكة** (ملاحظة إلزامية وأثر دائم بهويتها)،
 * وزر صيانة لإنهاء الجلسات المنقضية. تعمل فقط حين تُضبط الواجهة الخادمية (VITE_TEACHER_API_URL)؛ وإلا تحوّل إلى لوحة المتابعة.
 * الصلاحية الفعلية في الخادم: الإفراج والصيانة للمالكة وحدها (المديرة 403). **كُتبت ولم تُجمَّع ولم تُجرَّب بعد.**
 */
const STATE_LABEL: Record<string, string> = { started: 'بدأت', uploaded: 'رُفع وينتظر التحقق', validating: 'قيد التحقق', accepted: 'مقبولة', rejected: 'مرفوضة', expired: 'منقضية', cancelled: 'ملغاة' }

export default function UploadSessions() {
  const staffApi = useStaffApi()
  const { terms, teachers, currentTermId } = useStore()
  const toast = useToast()
  const [termId, setTermId] = useState(currentTermId ?? terms[0]?.id ?? '')
  const [data, setData] = useState<UploadOverview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [releaseFor, setReleaseFor] = useState<PendingUpload | null>(null)
  const [note, setNote] = useState('')
  const [fault, setFault] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!staffApi || !termId) return
    setLoading(true); setError(null)
    const r = await staffApi.overview(termId)
    setLoading(false)
    if (r.ok) setData(r.value); else setError(staffMessage(r))
  }, [staffApi, termId])

  if (!staffApi) return <Navigate to="/owner/overview" replace />

  const nameOf = (id: string) => teachers.find((t) => t.id === id)?.name ?? 'معلمة'
  const release = async () => {
    if (!releaseFor) return
    setBusy(true)
    const r = await staffApi.releaseSession({ sessionId: releaseFor.sessionId, note: note.trim(), platformFault: fault })
    setBusy(false)
    if (!r.ok) { toast(staffMessage(r), 'error'); return }
    setReleaseFor(null); setNote(''); setFault(false)
    toast('أُفرج عن الجلسة وسُجّل الإجراء باسمكِ.')
    void load()
  }
  const sweep = async () => {
    setBusy(true)
    const r = await staffApi.sweepExpired()
    setBusy(false)
    if (!r.ok) { toast(staffMessage(r), 'error'); return }
    toast(r.value === 0 ? 'لا جلسات منقضية.' : `أُنهيت ${r.value} جلسة منقضية.`)
    void load()
  }

  return (
    <div className="space-y-5">
      <PageHeader title="عمليات الرفع" subtitle="الجلسات العالقة وملخص التسليمات لفصل واحد."
        actions={<><Button variant="ghost" icon={Wrench} loading={busy && !releaseFor} onClick={() => void sweep()}>إنهاء الجلسات المنقضية</Button><Button variant="secondary" icon={RefreshCw} loading={loading} onClick={() => void load()} disabled={!termId}>تحميل</Button></>} />
      <Card className="p-4 sm:p-5" as="div">
        <Field label="الفصل">{({ id }) => <Select id={id} value={termId} onChange={(e) => { setTermId(e.target.value); setData(null) }}>{terms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>}</Field>
      </Card>
      {error && <Alert tone="danger">{error}</Alert>}
      {data && (
        <>
          <Card className="space-y-2 p-4 sm:p-5" as="section">
            <h2 className="text-lg font-bold text-steel-900">ملخص الفصل</h2>
            <p className="text-[15px] text-ink-600">تسليمات: {data.submissions.slotsSubmitted} خانة من {data.submissions.teachersWithSubmissions} معلمة — في الموعد {data.submissions.onTime}، متأخرة {data.submissions.late}.</p>
            <div className="flex flex-wrap gap-2">{Object.entries(data.sessionsByState).map(([k, n]) => <Chip key={k} tone="neutral">{STATE_LABEL[k] ?? k}: {n}</Chip>)}</div>
          </Card>
          <Card className="space-y-3 p-4 sm:p-5" as="section">
            <h2 className="text-lg font-bold text-steel-900">جلسات عالقة ({data.pending.length})</h2>
            {data.pending.length === 0 ? <p className="text-[15px] text-ink-500">لا جلسات عالقة.</p> : (
              <ul className="divide-y divide-snow-200">
                {data.pending.map((p) => (
                  <li key={p.sessionId} className="flex flex-wrap items-center justify-between gap-2 py-3 text-[15px]">
                    <span><span className="font-medium text-steel-900">{nameOf(p.teacherId)}</span> — {p.declaredName} <span className="text-ink-500">({STATE_LABEL[p.state] ?? p.state}، منذ {p.waitingMinutes} د)</span></span>
                    <Button size="sm" variant="secondary" icon={Unlock} onClick={() => { setNote(''); setFault(false); setReleaseFor(p) }}>إفراج</Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
      <Dialog open={releaseFor !== null} onClose={() => setReleaseFor(null)} title="الإفراج عن جلسة عالقة" description={releaseFor ? `${nameOf(releaseFor.teacherId)} — ${releaseFor.declaredName}` : ''}
        footer={<><Button variant="secondary" onClick={() => setReleaseFor(null)}>تراجع</Button><Button variant="danger" loading={busy} disabled={note.trim() === ''} onClick={() => void release()}>إفراج</Button></>}>
        <div className="space-y-4">
          <Alert tone="warn">الإفراج يلغي الجلسة ويسمح للمعلمة بالبدء من جديد. لا يُحذف أي ملف أو إصدار. يُسجَّل الإجراء باسمكِ ولا يمكن تعديله.</Alert>
          <Field label="سبب الإفراج (إلزامي)">{({ id }) => <Input id={id} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} data-autofocus />}</Field>
          <label className="flex items-center gap-2 text-[15px] text-ink-600"><input type="checkbox" checked={fault} onChange={(e) => setFault(e.target.checked)} />العطل من المنصة لا من المعلمة</label>
        </div>
      </Dialog>
    </div>
  )
}
