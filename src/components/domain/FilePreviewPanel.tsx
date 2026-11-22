import { useEffect, useRef, useState } from 'react'
import { Download, ExternalLink, FileQuestion, FolderOpen, Loader2 } from 'lucide-react'
import type { Version } from '../../data/types'
import { extOf, previewKind } from '../../lib/files'
import type { FileAccess } from '../../lib/useFileAccess'
import '../../lib/officeview/officeview.js'
import { Button } from '../ui/Button'

type State = { phase: 'loading' } | { phase: 'ready'; url: string } | { phase: 'error'; message: string }

const frame = 'overflow-hidden rounded-2xl border border-snow-300 bg-white'
const box = 'flex min-h-[16rem] flex-col items-center justify-center gap-3 rounded-2xl p-6 text-center'

/**
 * رابط تضمين لروابط شائعة (Google Docs/Sheets/Slides/Drive وYouTube) كي تُعرض داخل الصفحة؛ غيرها يُجرَّب كما هو
 * (قد يمنع الموقع التضمين، لذا يبقى زر «فتح الرابط» ظاهرًا دائمًا).
 */
export function linkEmbedUrl(raw: string): string {
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:') return ''
    const g = /^\/(document|spreadsheets|presentation)\/d\/([\w-]+)/.exec(u.pathname)
    if (u.hostname === 'docs.google.com' && g) return `https://docs.google.com/${g[1]}/d/${g[2]}/${g[1] === 'presentation' ? 'embed' : 'preview'}`
    const d = /^\/file\/d\/([\w-]+)/.exec(u.pathname)
    if (u.hostname === 'drive.google.com' && d) return `https://drive.google.com/file/d/${d[1]}/preview`
    const yt = u.hostname.endsWith('youtube.com') ? u.searchParams.get('v') : u.hostname === 'youtu.be' ? u.pathname.slice(1) : null
    if (yt && /^[\w-]{6,20}$/.test(yt)) return `https://www.youtube-nocookie.com/embed/${yt}`
    return raw
  } catch { return '' }
}

/** يعرض ملف Word/Excel/PowerPoint نصيًّا داخل الصفحة: من رابط (fetch) أو من ملف يختاره المستخدم. */
function OfficeLocal({ buf, ext, onFail }: { buf: ArrayBuffer; ext: string; onFail: (code: string) => void }) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const node = await window.AtharOffice!.render(buf, ext)
        if (alive && host.current) { host.current.textContent = ''; host.current.appendChild(node) }
      } catch (e) { if (alive) onFail((e as { code?: string }).code ?? 'corrupt') }
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buf, ext])
  return <div ref={host} className="max-h-[66vh] overflow-auto rounded-2xl border border-snow-300 bg-snow-50 p-3" />
}

function OfficePreview({ version, access }: { version: Version; access: FileAccess }) {
  const ext = extOf(version.fileName ?? '')
  const [phase, setPhase] = useState<'loading' | 'local' | 'embed' | 'pick' | 'error'>('loading')
  const [buf, setBuf] = useState<ArrayBuffer | null>(null)
  const [embed, setEmbed] = useState('')
  const [msg, setMsg] = useState('')
  const supported = !!window.AtharOffice?.SUPPORTED[ext]
  const archive = access.mode === 'archive'

  useEffect(() => {
    let alive = true
    setPhase('loading'); setBuf(null)
    const preview = access.preview
    if (!preview) { setMsg('المعاينة غير متاحة حاليًا.'); setPhase('error'); return }
    void (async () => {
      const r = await preview(version)
      if (!alive) return
      if (!r.ok) { setMsg(r.message); setPhase('error'); return }
      if (supported) {
        try {
          const res = await fetch(r.url, { credentials: 'omit', referrerPolicy: 'no-referrer' })
          if (!res.ok) throw new Error(String(res.status))
          const b = await res.arrayBuffer()
          if (alive) { setBuf(b); setPhase('local') }
          return
        } catch { /* CORS أو file:// أو انقطاع: نكمل بالبدائل أدناه */ }
      }
      if (!alive) return
      if (archive) { setPhase('pick'); return }
      // المنصة الحية: عارض Office المضمَّن (الرابط الموقّع قصير العمر يُمرَّر إليه)
      setEmbed(`https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(r.url)}`); setPhase('embed')
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version.id])

  const download = access.download
  const dl = <Button icon={Download} variant="secondary" onClick={() => (download ? download(version) : undefined)} disabled={!download}>تنزيل الملف</Button>
  if (phase === 'loading') return <div className="flex min-h-[16rem] items-center justify-center gap-2 rounded-2xl bg-frost-50 text-ink-600" role="status"><Loader2 className="size-5 animate-spin" aria-hidden />جارٍ تجهيز المعاينة…</div>
  if (phase === 'local' && buf) {
    return <div className="space-y-2"><OfficeLocal buf={buf} ext={ext} onFail={(c) => { setMsg(c === 'encrypted' ? 'الملف محمي بكلمة مرور.' : c === 'too_large' ? 'الملف كبير جدًا للمعاينة.' : 'تعذّر قراءة محتوى الملف.'); setPhase('error') }} /></div>
  }
  if (phase === 'embed') return <div className={frame}><iframe src={embed} title={`معاينة ${version.fileName ?? 'الملف'}`} referrerPolicy="no-referrer" className="h-[66vh] w-full bg-white" /></div>
  if (phase === 'pick') {
    return (
      <div className={`${box} bg-sand-50`}>
        <FolderOpen className="size-8 text-sand-700" aria-hidden />
        <p className="font-medium text-steel-900">اختاري الملف لمعاينته</p>
        <p className="max-w-sm text-sm text-ink-600">المتصفح لا يسمح بقراءة ملفات المجلد تلقائيًا عند الفتح من الجهاز. اضغطي الزر واختاري الملف <b dir="auto">{version.fileName}</b> من مجلد الأرشيف وسيُعرض هنا.</p>
        <div className="flex flex-wrap justify-center gap-2">
          <label className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-xl bg-steel-800 px-4 text-[15px] font-medium text-white hover:bg-steel-900 focus-within:ring-2 focus-within:ring-frost-300">
            <FolderOpen className="size-4" aria-hidden />اختيار الملف
            <input type="file" accept={`.${ext}`} className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void f.arrayBuffer().then((b) => { setBuf(b); setPhase('local') }) }} />
          </label>
          {dl}
        </div>
      </div>
    )
  }
  return (
    <div className={`${box} bg-blush-50`} role="alert">
      <FileQuestion className="size-8 text-blush-700" aria-hidden />
      <p className="font-medium text-steel-900">تعذّرت المعاينة</p>
      <p className="max-w-sm text-sm text-ink-600">{msg || 'جرّبي تنزيل الملف لفتحه في برنامجه.'}</p>
      {dl}
    </div>
  )
}

/**
 * معاينة ملف إصدار داخل الصفحة (r41): PDF والصور مباشرة، وWord/Excel/PowerPoint (عرض داخل الصفحة أو عارض Office)،
 * والروابط مضمَّنة في إطار مع زر فتح. الرابط الموقّع يُطلب عند الفتح ولا يُحفظ.
 */
export function FilePreviewPanel({ version, access }: { version: Version; access: FileAccess }) {
  const kind = version.kind === 'link' ? 'link' : previewKind(version.fileName ?? '')
  const [state, setState] = useState<State>({ phase: 'loading' })
  const preview = access.preview

  useEffect(() => {
    if (kind !== 'pdf' && kind !== 'image') return
    let alive = true
    setState({ phase: 'loading' })
    if (!preview) { setState({ phase: 'error', message: 'المعاينة غير متاحة حاليًا.' }); return }
    void preview(version).then((r) => { if (alive) setState(r.ok ? { phase: 'ready', url: r.url } : { phase: 'error', message: r.message }) })
    return () => { alive = false }
    // الطلب مرتبط بالإصدار فقط؛ تغيّر هوية دالة المعاينة بين الرسمات لا يعيد الطلب.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version.id, kind])

  if (kind === 'link') {
    const embed = version.url ? linkEmbedUrl(version.url) : ''
    return (
      <div className="space-y-3">
        {embed && <div className={frame}><iframe src={embed} title="معاينة الرابط" referrerPolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-popups allow-forms" className="h-[56vh] w-full bg-white" /></div>}
        <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-lav-50 p-3">
          <p className="min-w-0 flex-1 break-all text-sm text-ink-600" dir="ltr">{version.url}</p>
          {version.url && <a href={version.url} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center gap-2 rounded-xl bg-steel-800 px-4 text-[15px] font-medium text-white hover:bg-steel-900"><ExternalLink className="size-4" aria-hidden />فتح الرابط في تبويب جديد</a>}
        </div>
        <p className="text-[13px] text-ink-500">إن بقي الإطار فارغًا فالموقع يمنع عرض صفحاته داخل صفحات أخرى؛ استعملي زر الفتح.</p>
      </div>
    )
  }
  if (kind === 'office') return <OfficePreview version={version} access={access} />
  if (kind === 'download') {
    return (
      <div className={`${box} bg-sand-50`}>
        <FileQuestion className="size-8 text-sand-700" aria-hidden />
        <p className="font-medium text-steel-900">لا تتوفر معاينة لهذا النوع من الملفات</p>
        <p className="max-w-sm text-sm text-ink-600">نزّليه لفتحه في برنامجه.</p>
        <Button icon={Download} onClick={() => (access.download ? access.download(version) : undefined)} disabled={!access.download}>تنزيل الملف</Button>
      </div>
    )
  }
  if (state.phase === 'loading') {
    return <div className="flex min-h-[16rem] items-center justify-center gap-2 rounded-2xl bg-frost-50 text-ink-600" role="status"><Loader2 className="size-5 animate-spin" aria-hidden />جارٍ تجهيز المعاينة…</div>
  }
  if (state.phase === 'error') {
    return (
      <div className={`${box} bg-blush-50`} role="alert">
        <FileQuestion className="size-8 text-blush-700" aria-hidden />
        <p className="font-medium text-steel-900">تعذّرت المعاينة</p>
        <p className="max-w-sm text-sm text-ink-600">{state.message}</p>
      </div>
    )
  }
  return kind === 'pdf'
    ? <div className={frame}><iframe src={state.url} title={`معاينة ${version.fileName ?? 'الملف'}`} referrerPolicy="no-referrer" className="h-[62vh] w-full bg-white" /></div>
    : <div className={`${frame} flex justify-center bg-snow-100 p-2`}><img src={state.url} alt={version.fileName ?? 'معاينة الصورة'} referrerPolicy="no-referrer" className="max-h-[62vh] max-w-full rounded-xl object-contain" /></div>
}
