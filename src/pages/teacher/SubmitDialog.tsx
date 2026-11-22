import { useEffect, useRef, useState, type DragEvent } from 'react'
import { FileUp, Link2, Paperclip } from 'lucide-react'
import type { SlotDef } from '../../data/types'
import { Dialog } from '../../components/ui/Overlay'
import { Button } from '../../components/ui/Button'
import { Field, Input } from '../../components/ui/Field'
import { Alert, Progress, Tabs } from '../../components/ui/misc'
import { validateLink } from '../../lib/files'
import { checkFile, describeStorageError, effectiveMaxBytes, extOf, fmtLimit, pendingKey, typesLabel, useStorage } from '../../lib/storage'
import { fmtSize } from '../../lib/format'
import { useStore } from '../../data/store'
import { useToast } from '../../components/ui/Toast'
import { cn } from '../../lib/cn'

type Mode = 'file' | 'link'

export function SubmitDialog({ slot, termId, teacherId, replacing, status, onClose }: {
  slot: SlotDef | null; termId: string; teacherId: string; replacing: boolean; status: 'on_time' | 'late'; onClose: () => void
}) {
  const { submit } = useStore()
  const toast = useToast()
  const { adapter, settings } = useStorage()
  const maxBytes = effectiveMaxBytes(settings, adapter.capabilities)
  const acceptAttr = settings.allowedExtensions.map((e) => `.${e}`).join(',')
  const aborter = useRef<AbortController | null>(null)
  useEffect(() => () => aborter.current?.abort(), [])
  const [mode, setMode] = useState<Mode>('file')
  const [file, setFile] = useState<File | null>(null)
  const [fileErr, setFileErr] = useState<string | null>(null)
  const [link, setLink] = useState('')
  const [linkErr, setLinkErr] = useState<string | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [fail, setFail] = useState<string | null>(null)
  const [drag, setDrag] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  if (!slot) return null
  const busy = progress !== null

  const pick = (f: File | undefined | null) => {
    if (!f) return
    const r = checkFile(f, settings, adapter.capabilities)
    const e = r.ok ? null : r.message
    setFileErr(e)
    setFile(e ? null : f)
  }
  const onDrop = (e: DragEvent) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files?.[0]) }

  const finish = async (input: Parameters<typeof submit>[0]) => {
    const r = await submit(input)
    if (r.ok) { toast(replacing ? 'تم استبدال الملف وحُفظت النسخة السابقة.' : 'تم تسجيل التسليم.', 'ok'); onClose() }
    else { setProgress(null); setFail(r.reason === 'closed' ? 'أُغلق باب التسليم لهذا الفصل.' : 'انتهت مهلة الاستبدال.') }
  }

  const go = () => {
    setFail(null)
    if (mode === 'file') {
      if (!file) { setFileErr('يرجى اختيار ملف.'); return }
      setProgress(0)
      const ctl = new AbortController()
      aborter.current = ctl
      const key = pendingKey({ teacherId, termId, slotId: slot.id, ext: extOf(file.name) || 'bin' })
      adapter.put({ key, data: file, contentType: file.type || undefined, onProgress: setProgress, signal: ctl.signal })
        .then((res) => finish({ teacherId, termId, slotId: slot.id, kind: 'file', fileName: file.name, size: file.size, sha256: res.sha256, storageKey: res.key }))
        .catch((err) => { const m = describeStorageError(err, fmtLimit(maxBytes)); setProgress(null); if (m) setFail(m) })
    } else {
      const e = validateLink(link)
      setLinkErr(e)
      if (e) return
      setProgress(100)
      setTimeout(() => finish({ teacherId, termId, slotId: slot.id, kind: 'link', url: link.trim() }), 250)
    }
  }

  return (
    <Dialog open onClose={busy ? () => {} : onClose} title={replacing ? `استبدال: ${slot.title}` : `تسليم: ${slot.title}`}
      description={replacing ? 'ستُحفظ النسخة الحالية في سجل النسخ.' : undefined}
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>إلغاء</Button><Button icon={FileUp} onClick={go} loading={busy}>{replacing ? 'استبدال' : 'تسليم'}</Button></>}>
      <div className="space-y-4">
        {!replacing && status === 'late' && <Alert tone="warn" title="سيُسجَّل هذا التسليم متأخرًا">انتهى الموعد الأساسي لهذا الفصل.</Alert>}
        {fail && <Alert tone="danger">{fail}</Alert>}
        <Tabs<Mode> label="طريقة التسليم" value={mode} onChange={(m) => !busy && setMode(m)} items={[{ id: 'file', label: 'ملف', icon: Paperclip }, { id: 'link', label: 'رابط خارجي', icon: Link2 }]} />
        {mode === 'file' ? (
          <Field label="الملف" error={fileErr} hint={`الأنواع المقبولة: ${typesLabel(settings.allowedExtensions)} · الحد الأقصى ${fmtLimit(maxBytes)}.`}>
            {({ id, describedBy }) => (
              <div onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)} onDrop={onDrop}
                className={cn('rounded-2xl border-2 border-dashed p-5 text-center transition-colors', drag ? 'border-steel-500 bg-steel-50' : 'border-steel-300 bg-snow-50')}>
                <input ref={input} id={id} aria-describedby={describedBy} type="file" accept={acceptAttr} className="sr-only" onChange={(e) => pick(e.target.files?.[0])} disabled={busy} />
                {file ? (
                  <div className="space-y-2">
                    <p className="break-all font-bold text-steel-900" dir="auto">{file.name}</p>
                    <p className="text-sm text-ink-500">{fmtSize(file.size)}</p>
                    <Button size="sm" variant="secondary" onClick={() => input.current?.click()} disabled={busy}>اختيار ملف آخر</Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-[15px] text-ink-600">اسحبي الملف إلى هنا أو اختريه من جهازك</p>
                    <Button variant="secondary" icon={Paperclip} onClick={() => input.current?.click()}>اختيار ملف</Button>
                  </div>
                )}
              </div>
            )}
          </Field>
        ) : (
          <Field label="الرابط" error={linkErr} hint="رابط يبدأ بـ https:// ويكون متاحًا للاطلاع عليه من قِبل الإدارة.">
            {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} invalid={invalid} dir="ltr" type="url" value={link} onChange={(e) => { setLink(e.target.value); setLinkErr(null) }} placeholder="https://" className="text-start" disabled={busy} />}
          </Field>
        )}
        {busy && mode === 'file' && (
          <div className="space-y-1.5"><Progress value={progress ?? 0} label="تقدم الرفع" /><p className="text-sm text-ink-500">جارٍ إرسال الملف… {progress}%</p></div>
        )}
      </div>
    </Dialog>
  )
}
