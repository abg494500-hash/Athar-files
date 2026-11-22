// الأرشفة السنوية (A-115/A-116): تبني المالكة أرشيفًا للسنة كاملة داخل متصفحها مقسَّمًا إلى أجزاء ZIP (الملفات الفعلية + نسخة أثَر التفاعلية دون إنترنت)،
// يُسجَّل في القاعدة ثم يُحفظ على جهازها ويُتحقق من **كل جزء**، ثم تُتحقق نسخة ثانية على وسيط مستقل. **لا حذف هنا**: التصفير مرحلة منفصلة.
import { SINGLE_FILE_BYTES } from '../../lib/yearArchive/paths'
import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2, CircleDashed, FolderArchive, Loader2, ShieldCheck } from 'lucide-react'
import { useStore } from '../../data/store'
import { Alert, Card } from '../../components/ui/misc'
import { Button } from '../../components/ui/Button'
import { Field, Select } from '../../components/ui/Field'
import { fmtDateTime, fmtNum, fmtSize } from '../../lib/format'
import { useToast } from '../../components/ui/Toast'
import { staffMessage } from '../../lib/staffApi/client'
import type { CopyMedium, StaffApiClient, YearArchiveStatus } from '../../lib/staffApi/client'
import type { BuildResult, PartSink } from '../../lib/yearArchive/build'
import type { NamedBlob, SetReport } from '../../lib/yearArchive/verify'

const MEDIA: [CopyMedium, string][] = [['external_drive', 'قرص خارجي'], ['usb_flash', 'فلاشة USB'], ['other_computer', 'حاسوب آخر'], ['cloud', 'تخزين سحابي خاص بكِ']]
export const GATE_MSG: Record<string, string> = {
  no_year_archive: 'لا يوجد أرشيف سنوي محلي مسجَّل لهذه السنة', reset_already_started: 'بدأ تصفير هذه السنة من قبل', year_not_found: 'السنة غير موجودة',
  versions_entries_count_mismatch: 'عدد إصدارات السنة لا يطابق عدد عناصر الأرشيف', pending_uploads: 'توجد عمليات رفع معلّقة لم تُحسم', legacy_archives_not_transferred: 'أرشيفات سحابية قديمة لم تُنزَّل ويُتحقَّق منها بعد',
  archive_not_found: 'الأرشيف غير موجود', archive_not_verified: 'الأرشيف غير مسجَّل كاملًا', no_parts: 'لا توجد أجزاء', parts_not_contiguous: 'ترقيم الأجزاء غير متصل',
  entries_count_mismatch: 'عدد العناصر لا يطابق', download_not_verified: 'لم يُتحقق من حفظ كل الأجزاء على الجهاز', not_opened_locally: 'لم تُجرَّب النسخة المحلية دون إنترنت',
  parts_not_download_verified: 'أجزاء لم يُتحقق من حفظها على الجهاز', parts_second_copy_not_verified: 'أجزاء لم تُتحقق نسختها الثانية على وسيط مستقل',
  part_entries_mismatch: 'محتوى جزء لا يطابق التسجيل', versions_not_in_archive: 'إصدارات في السنة غير مشمولة بالأرشيف',
}
export const gateText = (p: string) => { const [k, v] = p.split(':'); return `${GATE_MSG[k ?? ''] ?? k}${v ? ` (${v})` : ''}` }
const overall = (r: SetReport | null, busy: boolean): string => busy ? 'جارٍ التحقق…' : !r ? 'لم يبدأ التحقق' : r.ok ? 'مكتمل بنجاح' : r.parts.some((p) => p.status === 'missing') ? 'فشل: يوجد جزء مفقود' : r.parts.some((p) => p.status === 'damaged') ? 'فشل: يوجد جزء تالف أو مختلف عن الأصل' : 'فشل'
const PART_STATUS: Record<string, string> = { ok: 'سليم', missing: 'ناقص (غير موجود)', damaged: 'تالف' }

type DirHandle = { name: string; getFileHandle(n: string, o?: { create?: boolean }): Promise<{ createWritable(): Promise<{ write(b: Blob): Promise<void>; close(): Promise<void> }> }>; values(): AsyncIterable<{ kind: string; name: string; getFile(): Promise<File> }> }
const pickDir = (): Promise<DirHandle> | null => {
  const w = window as unknown as { showDirectoryPicker?: (o?: object) => Promise<DirHandle> }
  return w.showDirectoryPicker ? w.showDirectoryPicker({ mode: 'readwrite' }) : null
}
function saveBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = name; a.rel = 'noopener'
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
const loadLogo = async (): Promise<Uint8Array | null> => {
  try { const r = await fetch(new URL('brand/logo-light.png', document.baseURI).toString()); return r.ok ? new Uint8Array(await r.arrayBuffer()) : null } catch { return null }
}
/** نسخة أثَر للقراءة فقط المبنيّة مع المنصة (public/archive-app). تُتحقق بصماتها من manifest.json؛ أي نقص ⇒ يرمي فيفشل البناء بدل أرشيف بلا موقع. */
const loadApp = async (): Promise<{ path: string; data: Uint8Array }[]> => {
  const base = document.baseURI
  const m = await (await fetch(new URL('archive-app/manifest.json', base).toString(), { cache: 'no-store' })).json() as { files: { name: string; size: number; sha256: string }[] }
  const out: { path: string; data: Uint8Array }[] = []
  for (const f of m.files) {
    const r = await fetch(new URL(`archive-app/${f.name}`, base).toString(), { cache: 'no-store' })
    if (!r.ok) throw new Error('app_fetch')
    const data = new Uint8Array(await r.arrayBuffer())
    if (data.length !== f.size) throw new Error('app_size')
    out.push({ path: f.name, data })
  }
  return out
}
const SIZES: [number, string][] = [[SINGLE_FILE_BYTES, 'ملف واحد (الافتراضي — يُقسَّم تلقائيًا فقط إن تجاوزت السنة 3.5 غيغابايت)'], [1_000_000_000, 'أجزاء 1 غيغابايت'], [500_000_000, 'أجزاء 500 ميغابايت'], [200_000_000, 'أجزاء 200 ميغابايت']]

export function YearArchivePanel({ staffApi }: { staffApi: StaffApiClient }) {
  const { years, reload } = useStore()
  const toast = useToast()
  const [yearId, setYearId] = useState(years.find((y) => y.active)?.id ?? years[0]?.id ?? '')
  const [list, setList] = useState<YearArchiveStatus[]>([])
  const [phase, setPhase] = useState<'idle' | 'building' | 'registering' | 'verifying'>('idle')
  const [progress, setProgress] = useState<{ done: number; total: number; part: number; parts: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [built, setBuilt] = useState<{ archiveId: string; build: BuildResult; where: string; autoVerified: 'saved' | 'memory' | 'failed' } | null>(null)
  const [report, setReport] = useState<{ title: string; r: SetReport } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [targetBytes, setTargetBytes] = useState(SINGLE_FILE_BYTES)
  const [medium, setMedium] = useState<CopyMedium>('external_drive')
  const [independent, setIndependent] = useState(false)
  const abort = useRef<AbortController | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const pending = useRef<{ a: YearArchiveStatus; mode: 'saved' | 'copy' } | null>(null)

  const refresh = useCallback(async () => {
    if (!yearId) return
    const r = await staffApi.yearArchiveStatus(yearId)
    if (r.ok) setList(r.value)
  }, [staffApi, yearId])
  useEffect(() => { void refresh() }, [refresh])

  const run = async () => {
    setError(null); setReport(null); setBuilt(null)
    let dir: DirHandle | null = null
    const dp = pickDir()
    if (dp) { try { dir = await dp } catch { return } }
    // r41: لا حفظ بلا تحقق. مع اختيار مجلد: يُحفظ الجزء ثم يُقرأ من المجلد ويُفحص بعد انتهاء البناء. دون مجلد (تنزيل عادي) لا يمكن قراءته بعد التنزيل،
    // فيُفحص الجزء في الذاكرة (بنية ZIP وCRC وبصمة كل ملف وقابلية تحميل الواجهة) **قبل** تسليمه للمتصفح؛ الجزء التالف لا يُنزَّل أصلًا ويفشل البناء.
    const issue: { v: string | null } = { v: null }
    const sink: PartSink = {
      savePart: async (p) => {
        if (dir) { const h = await (await dir.getFileHandle(p.filename, { create: true })).createWritable(); await h.write(p.blob); await h.close(); return }
        const rep = await staffApi.verifyBuiltPart(p.blob, p)
        if (rep.status !== 'ok') { issue.v = `الجزء ${p.no}: ${rep.checks.filter((c) => !c.ok).map((c) => c.check).join('، ') || 'تالف'}`; throw new Error('verify_failed') }
        saveBlob(p.filename, p.blob)
      },
    }
    setPhase('building'); setProgress({ done: 0, total: 0, part: 0, parts: 0 })
    abort.current = new AbortController()
    const y = years.find((x) => x.id === yearId)
    const r = await staffApi.buildYearArchive(yearId, { sink, targetBytes, signal: abort.current.signal, onProgress: (p) => setProgress({ done: p.done, total: p.total, part: p.part, parts: p.parts }), loadAsset: loadLogo, loadApp })
    if (!r.ok) { setPhase('idle'); setProgress(null); setError(issue.v ? `فشل فحص الأرشيف قبل حفظه (${issue.v}). لم يُنزَّل الجزء التالف ولم يُسجَّل شيء؛ أعيدي البناء.` : staffMessage(r)); return }
    setPhase('registering')
    const reg = await staffApi.registerYearArchive({ yearId, title: `أرشيف السنة الدراسية ${y?.label ?? ''} كاملة`, build: r.value.build })
    if (!reg.ok) { setPhase('idle'); setProgress(null); setError(staffMessage(reg)); return }
    // التحقق التلقائي من الملفات المحفوظة فعلًا في المجلد: قراءة كل جزء من القرص وفحصه كاملًا وتأكيد سلامته في القاعدة.
    let autoVerified: 'saved' | 'memory' | 'failed' = 'memory'
    if (dir) {
      setPhase('verifying')
      try {
        const st = await staffApi.yearArchiveStatus(yearId)
        const arch = st.ok ? st.value.find((a) => a.id === reg.value.id) : undefined
        const files: File[] = []
        for await (const e of dir.values()) if (e.kind === 'file' && /\.zip$/i.test(e.name)) files.push(await e.getFile())
        const vr = arch ? await staffApi.verifyAndConfirmSavedParts({ archive: arch, files: files as unknown as NamedBlob[] }) : null
        if (vr && vr.ok) { setReport({ title: 'نتيجة الفحص التلقائي للأجزاء المحفوظة', r: vr.value }); autoVerified = vr.value.ok ? 'saved' : 'failed' } else autoVerified = 'failed'
      } catch { autoVerified = 'failed' }
    }
    setPhase('idle'); setProgress(null)
    setBuilt({ archiveId: reg.value.id, build: r.value.build, where: dir ? `المجلد «${dir.name}»` : 'مجلد التنزيلات', autoVerified })
    toast(autoVerified === 'saved' ? 'بُني الأرشيف وسُجِّل وتحقّق تلقائيًا من كل الأجزاء المحفوظة.' : autoVerified === 'failed' ? 'بُني الأرشيف لكن فحص الأجزاء المحفوظة لم ينجح — راجعي النتيجة.' : 'بُني الأرشيف وفُحص قبل الحفظ وسُجِّل. اختاري مجلد الحفظ لتأكيد النسخة المحفوظة.', 'info')
    void refresh(); void reload()
  }

  const startPick = async (a: YearArchiveStatus, mode: 'saved' | 'copy') => {
    pending.current = { a, mode }
    const w = window as unknown as { showDirectoryPicker?: (o?: object) => Promise<DirHandle> }
    if (w.showDirectoryPicker) { // اختيار المجلد كاملًا (اللابتوب أو الهاردسك) أسهل وأدق من تحديد الملفات
      try { const d = await w.showDirectoryPicker({ mode: 'read' }); const fs: File[] = []; for await (const e of d.values()) if (e.kind === 'file' && /\.zip$/i.test(e.name)) fs.push(await e.getFile()); void onFiles(fs); return } catch { return }
    }
    fileInput.current?.click()
  }
  const onFiles = async (list: FileList | File[] | null) => {
    const cur = pending.current
    if (!list || !cur) return
    const files = Array.from(list) as unknown as NamedBlob[]
    setBusy(cur.mode); setReport(null); setError(null)
    const base = { archive: cur.a, files }
    const r = cur.mode === 'saved' ? await staffApi.verifyAndConfirmSavedParts(base) : await staffApi.verifyAndConfirmSecondCopy({ ...base, medium, independent })
    setBusy(null)
    if (!r.ok) { setError(staffMessage(r)); return }
    setReport({ title: cur.mode === 'saved' ? 'نتيجة فحص الأجزاء المحفوظة على الجهاز' : 'نتيجة فحص النسخة الثانية', r: r.value })
    if (r.value.ok) toast(cur.mode === 'saved' ? 'كل الأجزاء المحفوظة سليمة.' : 'النسخة الثانية مطابقة للأصل.', 'info')
    void refresh(); void reload()
  }

  const ack = async (archiveId: string) => {
    setBusy('opened')
    const r = await staffApi.ackYearArchive({ archiveId, kind: 'opened_locally' })
    setBusy(null)
    if (!r.ok) { toast(staffMessage(r), 'info'); return }
    toast('سُجّل الإقرار.', 'info'); void refresh()
  }

  const step = (ok: boolean, text: string) => (
    <li className="flex items-center gap-2.5 rounded-xl bg-snow-100 px-3.5 py-2.5 text-[15px]">
      {ok ? <CheckCircle2 className="size-5 text-ok-fg" aria-hidden /> : <CircleDashed className="size-5 text-ink-500" aria-hidden />}<span>{text}</span>
    </li>)

  return (
    <Card className="space-y-4 p-4 sm:p-5">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-bold text-steel-900"><FolderArchive className="size-5" aria-hidden />الأرشيف السنوي الكامل</h2>
        <p className="mt-1 text-sm text-ink-600">أرشيف للسنة بفصليها مقسَّم تلقائيًا إلى أجزاء ZIP مترابطة: كل المعلمات وكل التسليمات بإصداراتها وملفاتها الفعلية، مع <b>نسخة أثَر التفاعلية</b> تعمل دون إنترنت وتقرأ كل الأجزاء كأرشيف واحد. يُبنى في متصفحكِ ويُحفظ على جهازكِ ولا يُخزَّن في R2.</p>
      </div>
      <Alert tone="warn" title="قبل البدء">أوقفي الرفع للسنة المراد أرشفتها وابقي في هذه الصفحة حتى ينتهي البناء. يُنزَّل الأرشيف ملفًا واحدًا؛ ولا يتجاوز الملف الواحد من ملفات المعلمات 1 غيغابايت.</Alert>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="السنة الدراسية">{({ id }) => <Select id={id} value={yearId} onChange={(e) => { setYearId(e.target.value); setBuilt(null); setReport(null) }}>{years.map((y) => <option key={y.id} value={y.id}>{y.label}{y.active ? ' (الحالية)' : ''}</option>)}</Select>}</Field>
        <Field label="طريقة التنزيل">{({ id }) => <Select id={id} value={String(targetBytes)} onChange={(e) => setTargetBytes(Number(e.target.value))}>{SIZES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>}</Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button icon={FolderArchive} loading={phase !== 'idle'} disabled={!yearId} onClick={() => void run()}>{phase === 'verifying' ? 'يُتحقق من الملفات المحفوظة…' : phase === 'registering' ? 'يُسجَّل في القاعدة…' : phase === 'building' ? 'يُبنى الأرشيف…' : 'بناء الأرشيف السنوي وتسجيله'}</Button>
        {phase === 'building' && <Button variant="secondary" onClick={() => abort.current?.abort()}>إلغاء</Button>}
        {progress && phase === 'building' && <span className="num text-sm text-ink-600" role="status">{progress.total ? `الجزء ${fmtNum(progress.part)} من ${fmtNum(progress.parts)} — ${fmtNum(progress.done)} من ${fmtNum(progress.total)}` : 'تجهيز…'}</span>}
      </div>
      <p className="text-[13px] text-ink-500">في المتصفحات الداعمة (Chrome/Edge) تختارين مجلدًا فتُحفظ فيه الأجزاء مباشرة؛ غير ذلك تُنزَّل الأجزاء واحدًا واحدًا.</p>
      {progress && progress.total > 0 && phase === 'building' && <div className="h-2 overflow-hidden rounded-full bg-snow-300" aria-hidden><div className="h-full bg-steel-700 transition-all" style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} /></div>}
      {error && <Alert tone="danger" title="لم يكتمل">{error}</Alert>}

      {built && (
        <div className="rounded-2xl border border-ok-line bg-ok-bg/40 p-4">
          <p className="font-bold text-ok-fg">بُني الأرشيف وسُجِّل ({fmtNum(built.build.parts.length)} جزءًا · {fmtSize(built.build.totalBytes)} · {fmtNum(built.build.counts.versions)} إصدارًا)</p>
          {built.autoVerified === 'saved' && <p className="mt-1 text-sm text-ink-600">حُفظت الأجزاء في {built.where}، <b>وقُرئت من هناك وتحقّقت تلقائيًا</b>: ZIP سليم، بصمة كل ملف، مطابقة الأصل، وتحميل الواجهة. الأرشيف جاهز.</p>}
          {built.autoVerified === 'memory' && <p className="mt-1 text-sm text-ink-600">فُحص كل جزء <b>قبل تنزيله</b> (ZIP سليم، بصمة كل ملف، تحميل الواجهة) ثم نُزّل إلى {built.where}. لتأكيد النسخة المحفوظة على جهازكِ اضغطي «التحقق من نسخة اللابتوب (اختيار المجلد)» أدناه.</p>}
          {built.autoVerified === 'failed' && <p className="mt-1 text-sm text-miss-fg"><b>لم ينجح فحص الأجزاء المحفوظة في {built.where}</b> — لا تعتمدي هذه النسخة؛ راجعي النتيجة أدناه ثم أعيدي البناء.</p>}
        </div>
      )}

      {list.length > 0 && (
        <div className="space-y-4">
          <h3 className="font-bold text-steel-900">الأرشيفات السنوية المسجَّلة</h3>
          {list.map((a) => (
            <div key={a.id} className="rounded-2xl border border-snow-300 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2"><p className="font-bold text-steel-900">{a.title}</p><span className="text-[13px] text-ink-500">{fmtDateTime(a.createdAt)}</span></div>
              <dl className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3"><div><dt className="text-ink-500">الحجم</dt><dd className="num font-medium">{fmtSize(a.sizeBytes)}</dd></div><div><dt className="text-ink-500">عدد الإصدارات</dt><dd className="num font-medium">{fmtNum(a.entries)}</dd></div><div><dt className="text-ink-500">عدد الأجزاء</dt><dd className="num font-medium">{fmtNum(a.parts.length)}</dd></div></dl>
              <ul className="mt-3 space-y-1.5 text-sm" aria-label="الأجزاء">
                {a.parts.map((p) => (
                  <li key={p.no} className="flex flex-wrap items-center gap-x-3 rounded-lg bg-snow-100 px-3 py-1.5">
                    <span dir="ltr" className="num text-[12px]">{p.filename}</span><span className="num text-ink-500">{fmtSize(p.sizeBytes)}</span>
                    <span className={p.verified ? 'text-ok-fg' : 'text-ink-500'}>{p.verified ? 'حفظ متحقَّق' : 'لم يُتحقق'}</span>
                    <span className={p.copyVerified ? 'text-ok-fg' : 'text-ink-500'}>{p.copyVerified ? 'نسخة ثانية متحقَّقة' : 'بلا نسخة ثانية'}</span>
                  </li>))}
              </ul>
              <ul className="mt-3 space-y-2" aria-label="مراحل التحقق">
                {step(true, 'بُني وتحقق من بصمات كل الملفات المصدرية قبل التجميع')}
                {step(true, 'سُجِّل في القاعدة وطابق ملخّص المحتوى كل الإصدارات')}
                {step(!!a.downloadVerifiedAt, a.downloadVerifiedAt ? `كل الأجزاء حُفظت على الجهاز وتحقّقت بصماتها (${fmtDateTime(a.downloadVerifiedAt)})` : 'حفظ كل الأجزاء على الجهاز والتحقق منها')}
                {step(a.openedLocally, a.openedLocally ? 'جُرّب فتحه وتشغيل واجهته دون إنترنت' : 'تجربة فتحه وتشغيل واجهته دون إنترنت')}
                {step(!!a.secondCopyAt, a.secondCopyAt ? `نسخة ثانية على وسيط مستقل تحقّقت بصمات كل أجزائها (${fmtDateTime(a.secondCopyAt)})` : 'نسخة ثانية على وسيط مستقل ومتحقَّق منها بالبصمة')}
              </ul>
              <div className="mt-3 flex flex-wrap gap-2">
                {!a.downloadVerifiedAt && <Button size="sm" variant="secondary" icon={ShieldCheck} loading={busy === 'saved'} onClick={() => void startPick(a, 'saved')}>التحقق من نسخة اللابتوب (اختيار المجلد)</Button>}
                {a.downloadVerifiedAt && !a.openedLocally && <Button size="sm" variant="secondary" loading={busy === 'opened'} onClick={() => void ack(a.id)}>فتحتُ الأرشيف وجرّبته دون إنترنت</Button>}
              </div>
              {a.downloadVerifiedAt && !a.secondCopyAt && (
                <div className="mt-3 space-y-2 rounded-xl border border-snow-300 p-3">
                  <Alert tone="warn" title="النسخة الثانية">يجب أن تكون النسخة الثانية في مكان <b>مستقل عن هذا اللابتوب</b> (مثل قرص خارجي)، فنسخة على القرص نفسه لا تحميكِ إن فُقد. لا يستطيع المتصفح إثبات استقلال الوسيط، لكنه يتحقق من تطابق بصمة وحجم كل جزء فيه مع الأصل، ولا يُقبل إقرار بلا تحقق.</Alert>
                  <Field label="نوع الوسيط">{({ id }) => <Select id={id} value={medium} onChange={(e) => setMedium(e.target.value as CopyMedium)}>{MEDIA.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>}</Field>
                  <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={independent} onChange={(e) => setIndependent(e.target.checked)} /><span>أقرّ بأن هذا الوسيط <b>مستقل مادّيًا عن اللابتوب</b> (قرص خارجي أو فلاشة أو حاسوب آخر) ومحفوظ في مكان آخر. المتصفح لا يستطيع إثبات ذلك؛ هذا إقراري.</span></label>
                  <Button size="sm" variant="secondary" icon={ShieldCheck} loading={busy === 'copy'} disabled={!independent} onClick={() => void startPick(a, 'copy')}>اختيار مجلد الهاردسك الخارجي والتحقق من النسخة الثانية</Button>
                </div>
              )}
              {a.downloadVerifiedAt && !a.openedLocally && <p className="mt-2 text-[13px] text-ink-500">للتجربة: ضعي كل الأجزاء في مجلد واحد وفكّي ضغطها كلها فيه، افتحي index.html، أوقفي الإنترنت، تصفّحي معلمة وعاينّي ملفًا وجرّبي البحث، ثم اضغطي الزر.</p>}
              <div className={`mt-3 rounded-xl p-3 text-sm ${a.resetGate.ready ? 'bg-ok-bg/40' : 'bg-snow-100'}`} aria-label="جاهزية التصفير (للعرض فقط)">
                <p className="font-bold">{a.resetGate.ready ? 'شروط التصفير مكتملة (لم يُنفَّذ أي تصفير)' : 'التصفير غير متاح بعد'}</p>
                {!a.resetGate.ready && <ul className="mt-1 list-disc ps-5">{a.resetGate.problems.map((x) => <li key={x}>{gateText(x)}</li>)}</ul>}
              </div>
            </div>
          ))}
        </div>
      )}
      <input ref={fileInput} type="file" multiple accept=".zip,application/zip" className="hidden" aria-label="اختيار ملفات الأجزاء" onChange={(e) => { const f = e.target.files; void onFiles(f).finally(() => { e.target.value = '' }) }} />
      {busy && busy !== 'opened' && <p className="flex items-center gap-2 text-sm text-ink-600" role="status"><Loader2 className="size-4 animate-spin" aria-hidden />تُفحص الأجزاء…</p>}
      {report && (
        <div className="space-y-2" aria-label={report.title}>
          <p className="text-sm font-bold" role="status">الحالة: {overall(report.r, false)}</p>
          <Alert tone={report.r.ok ? 'ok' : 'danger'} title={report.r.ok ? `${report.title}: سليمة` : `${report.title}: غير سليمة — لا تعتمديها`}>{report.r.ok ? `${fmtNum(report.r.parts.length)} جزءًا طابقت بصماتها.` : 'الأجزاء الناقصة أو التالفة مذكورة أدناه؛ أعيدي حفظها (لا يُفتح التصفير إلا بعد اكتمالها).'}</Alert>
          <ul className="space-y-1.5 text-sm">{report.r.parts.map((p) => <li key={p.no} className="flex items-start gap-2">{p.status === 'ok' ? <CheckCircle2 className="mt-0.5 size-4 text-ok-fg" aria-hidden /> : <span className="mt-0.5 size-4 text-miss-fg" aria-hidden>✕</span>}<span dir="ltr" className="num">{p.filename}</span><span>— {PART_STATUS[p.status]}</span></li>)}</ul>
        </div>
      )}
    </Card>
  )
}
