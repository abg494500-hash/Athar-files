import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { CalendarDays, CheckCircle2, Download, ExternalLink, FileText, Link2, LogOut, RefreshCw, Trash2, Upload } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Overlay'
import { Field, Input } from '../../components/ui/Field'
import { Alert } from '../../components/ui/misc'
import { LogoMark } from '../../components/layout/Brand'
import { ErrorState, PageSkeleton } from '../../components/ui/States'
import { TEACHER_AUTH_MESSAGES, uploadMessage } from '../../lib/teacherAuth/client'
import type { PortalSlot, PortalTerm, PortalVersion, Portfolio, UploadStage } from '../../lib/teacherAuth/client'
import { useTeacherPortal } from '../../lib/teacherAuth/TeacherPortalContext'
import { Credits } from '../../components/layout/Credits'

/**
 * بوابة المعلمة: فصولها بمواعيد كل فصل المستقلة، وخاناتها، وإصداراتها؛ رفع ملف جديد، واستبداله ضمن مهلة الفصل، وحفظ رابط خارجي، وتنزيل ملفاتها.
 * القرار النهائي في كل ذلك للخادم (المواعيد بساعة القاعدة، حجم/نوع/توقيع الملف يقيسها الخادم)؛ الأزرار هنا تعكس `canSubmit/canReplace` فقط.
 * لا تمرّ على DataGate ولا على مخزن Supabase: المعلمة لا تملك حساب Supabase، وبياناتها تأتي من الواجهة الخادمية وحدها.
 * **لم تُجمَّع ولم تُجرَّب بعد** (أول typecheck/vitest على جهاز صاحبة المشروع). الرفع الحقيقي يحتاج R2 مضبوطًا ومجرَّبًا.
 */
const PHASE: Record<PortalTerm['phase'], string> = {
  before_base: 'قبل الموعد الأساسي', late_window: 'نافذة التسليم المتأخر', replace_only: 'الاستبدال فقط', closed: 'مغلق',
}
const STATE: Record<PortalSlot['state'], string> = { missing: 'لم يُسلَّم', on_time: 'في الموعد', late: 'متأخر' }
const STAGE: Record<UploadStage, string> = { starting: 'جارٍ بدء الرفع…', uploading: 'جارٍ رفع الملف…', finishing: 'جارٍ التحقق من الملف…' }

function size(n: number | null): string {
  if (n === null) return ''
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} ميغابايت` : `${Math.max(1, Math.round(n / 1000))} كيلوبايت`
}

interface Target { termId: string; slot: PortalSlot }

export default function Portal() {
  const portal = useTeacherPortal()
  const { client, phase, expire } = portal
  const [data, setData] = useState<Portfolio | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<{ tone: 'danger' | 'ok'; text: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null) // مفتاح الإجراء الجاري (للتعطيل)
  const [stage, setStage] = useState<UploadStage | null>(null)
  const [linkFor, setLinkFor] = useState<Target | null>(null)
  const [deleteFor, setDeleteFor] = useState<PortalVersion | null>(null)
  const [linkUrl, setLinkUrl] = useState('')
  const picker = useRef<HTMLInputElement>(null)
  const pending = useRef<Target | null>(null)

  const load = useCallback(async () => {
    if (!client) return
    setLoading(true); setError(null)
    const r = await client.portfolio()
    setLoading(false)
    if (r.ok) { setData(r.value); return }
    if (r.error === 'unauthenticated') { expire(); return }
    setError(TEACHER_AUTH_MESSAGES[r.error])
  }, [client, expire])

  useEffect(() => { if (phase === 'signed_in') void load() }, [phase, load])

  const fail = (f: { error: 'login_failed' | 'unauthenticated' | 'network' | 'rate_limited' | 'server' | 'bad_input' | 'rejected'; code?: string }) => {
    if (f.error === 'unauthenticated') { expire(); return }
    setNotice({ tone: 'danger', text: uploadMessage(f) })
  }

  const download = async (v: PortalVersion) => {
    if (!client) return
    setNotice(null); setBusy(`dl:${v.id}`)
    const r = await client.signDownload(v.id)
    setBusy(null)
    if (r.ok) { window.location.assign(r.value.url); return }
    fail(r)
  }

  // اختيار ملف: الزر يفتح منتقي الملفات الخفي، وبعد الاختيار يبدأ الرفع لخانة الهدف المحفوظة.
  const chooseFile = (t: Target) => { pending.current = t; picker.current?.click() }
  const onPicked = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    const t = pending.current
    e.target.value = '' // يسمح باختيار الملف نفسه مرة أخرى
    pending.current = null
    if (!file || !t || !client) return
    setNotice(null); setBusy(`up:${t.termId}:${t.slot.slotId}`); setStage('starting')
    const r = await client.uploadFile({ termId: t.termId, slotId: t.slot.slotId, file }, { stage: setStage })
    setBusy(null); setStage(null)
    if (r.ok) { setNotice({ tone: 'ok', text: `تم حفظ الإصدار ${r.value.no}${r.value.statusSnapshot === 'late' ? ' (مسجَّل متأخرًا)' : ''}.` }); void load(); return }
    fail(r)
    void load() // قد تكون الجلسة قائمة (verification_pending) أو تغيّرت المواعيد
  }

  const saveLink = async () => {
    if (!client || !linkFor) return
    setNotice(null); setBusy(`ln:${linkFor.termId}:${linkFor.slot.slotId}`)
    const r = await client.saveLink({ termId: linkFor.termId, slotId: linkFor.slot.slotId, url: linkUrl.trim() })
    setBusy(null)
    if (r.ok) { setLinkFor(null); setLinkUrl(''); setNotice({ tone: 'ok', text: r.value.reused ? 'الرابط محفوظ سابقًا بلا تغيير.' : `تم حفظ الرابط (الإصدار ${r.value.no}).` }); void load(); return }
    setLinkFor(null); fail(r)
  }

  const doDelete = async () => {
    if (!client || !deleteFor) return
    const v = deleteFor
    setNotice(null); setBusy(`dl2:${v.id}`)
    const r = await client.deleteVersion(v.id)
    setBusy(null); setDeleteFor(null)
    if (r.ok) { setNotice({ tone: 'ok', text: v.kind === 'file' ? 'تم حذف الملف نهائيًا. يمكنكِ رفع ملف جديد ما دام الموعد مفتوحًا.' : 'تم حذف الرابط. يمكنكِ إضافة رابط أو ملف جديد.' }); void load(); return }
    fail(r); void load()
  }

  if (!portal.configured || phase === 'signed_out') return <Navigate to="/login" replace />
  if (phase === 'initializing') return <main className="mx-auto max-w-5xl p-4"><PageSkeleton rows={3} /></main>

  const name = data?.teacher.name ?? portal.teacher?.name ?? 'ملف الإنجاز'
  const allSlots = data?.terms.flatMap((t) => t.slots) ?? []
  const required = allSlots.filter((s) => !s.optional)
  const delivered = required.filter((s) => s.versions.length > 0).length
  const lateCount = allSlots.filter((s) => s.state === 'late').length
  const pct = required.length ? Math.round((delivered / required.length) * 100) : 0
  const stateCls = (st: PortalSlot['state']) => st === 'on_time' ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : st === 'late' ? 'bg-amber-50 text-amber-800 ring-amber-200' : 'bg-paper-200 text-ink-600 ring-paper-300'
  const dates = (t: PortalTerm) => [['الموعد الأساسي', t.deadlines.base], ['آخر موعد للمتأخر', t.deadlines.late], ['آخر موعد للاستبدال', t.deadlines.replace]] as const

  return (
    <div className="min-h-screen bg-paper-100">
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
        <header className="flex flex-wrap items-center gap-4 rounded-3xl border border-paper-300 bg-white p-5 shadow-soft sm:p-6">
          <LogoMark height={56} />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-gold-700">منصة ملف الإنجاز الإلكتروني</p>
            <h1 className="truncate text-2xl font-bold text-forest-800 sm:text-3xl">{name}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px] text-ink-500">
              {data && <span>{data.teacher.subject}</span>}
              {data && data.year && <span>السنة الدراسية: <bdi>{data.year.label}</bdi></span>}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" icon={RefreshCw} onClick={() => void load()} disabled={loading || busy !== null}>تحديث</Button>
            <Button variant="ghost" icon={LogOut} onClick={() => void portal.logout()}>تسجيل الخروج</Button>
          </div>
        </header>

        <Alert tone="info" title="مواعيد كل فصل مستقلة" className="border-paper-300 bg-paper-200/60 text-ink-700">لكل فصل موعد تسليم وموعد استبدال خاصان به؛ إغلاق أحد الفصلين لا يغلق الآخر. الخادم هو الذي يقرر القبول بحسب ساعته.</Alert>
        {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
        {stage && <Alert tone="info">{STAGE[stage]}</Alert>}
        {loading && !data && <PageSkeleton rows={4} />}
        {data && data.year === null && (
          <Alert tone="warn" title="لا توجد سنة دراسية نشطة حاليًا">لم تُفعَّل سنة دراسية بعد، لذلك لا تظهر الفصول ولا بنود التسليم. تواصلي مع إدارة المدرسة لتفعيل السنة، ثم اضغطي «تحديث».</Alert>
        )}
        {data && data.year !== null && data.year !== undefined && data.terms.length === 0 && (
          <Alert tone="warn" title="لا توجد فصول في السنة النشطة">السنة النشطة ({data.year.label}) بلا فصول دراسية. تواصلي مع إدارة المدرسة.</Alert>
        )}
        {data && data.terms.length > 0 && data.slotsCount === 0 && (
          <Alert tone="warn" title="لا توجد بنود تسليم معرَّفة">لم تُعرَّف بنود الملف بعد. تواصلي مع إدارة المدرسة.</Alert>
        )}
        {error && <ErrorState text={error} onRetry={() => void load()} />}

        {data && required.length > 0 && (
          <section aria-label="ملخص التسليم" className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div className="col-span-2 rounded-2xl border border-paper-300 bg-white p-5 sm:col-span-1">
              <p className="text-[13px] text-ink-500">البنود المُسلَّمة</p>
              <p className="mt-1 text-2xl font-bold text-forest-800"><bdi>{delivered}</bdi> <span className="text-base font-medium text-ink-500">من <bdi>{required.length}</bdi></span></p>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-paper-200" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="نسبة التسليم"><div className="h-full rounded-full bg-forest-600" style={{ width: `${pct}%` }} /></div>
            </div>
            <div className="rounded-2xl border border-paper-300 bg-white p-5">
              <p className="text-[13px] text-ink-500">عدد الفصول</p>
              <p className="mt-1 text-2xl font-bold text-forest-800"><bdi>{data.terms.length}</bdi></p>
            </div>
            <div className="rounded-2xl border border-paper-300 bg-white p-5">
              <p className="text-[13px] text-ink-500">تسليمات متأخرة</p>
              <p className="mt-1 text-2xl font-bold text-forest-800"><bdi>{lateCount}</bdi></p>
            </div>
          </section>
        )}

        <input ref={picker} type="file" className="hidden" onChange={(e) => void onPicked(e)} aria-label="اختيار ملف للرفع" />

        <div className="grid items-start gap-6 lg:grid-cols-2">
          {data?.terms.map((t) => (
            <section key={t.id} className="overflow-hidden rounded-3xl border border-paper-300 bg-white shadow-soft">
              <div className="flex flex-wrap items-center justify-between gap-2 bg-forest-800 px-5 py-4 text-white">
                <h2 className="text-lg font-bold">{t.name}</h2>
                <span className="rounded-full bg-white/15 px-3 py-1 text-[13px] font-medium">{PHASE[t.phase]}</span>
              </div>
              <dl className="grid gap-2 border-b border-paper-200 bg-paper-50 px-5 py-4 text-[14px] sm:grid-cols-3">
                {dates(t).map(([k, v]) => (
                  <div key={k} className="flex items-start gap-2">
                    <CalendarDays className="mt-0.5 size-4 shrink-0 text-gold-600" aria-hidden />
                    <div><dt className="text-[12px] text-ink-500">{k}</dt><dd className="font-medium text-ink-700" dir="ltr">{v}</dd></div>
                  </div>
                ))}
              </dl>
              <ul className="divide-y divide-paper-200 px-5">
                {t.slots.map((s) => {
                  const target: Target = { termId: t.id, slot: s }
                  const key = `${t.id}:${s.slotId}`
                  const can = s.canSubmit || s.canReplace
                  return (
                    <li key={s.slotId} className="space-y-3 py-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="flex items-center gap-2 font-semibold text-forest-800">
                          {s.versions.length > 0 ? <CheckCircle2 className="size-5 text-forest-600" aria-hidden /> : <FileText className="size-5 text-ink-300" aria-hidden />}
                          {s.title}{s.optional ? ' (اختياري)' : ''}
                        </span>
                        <span className={`inline-flex items-center rounded-full px-3 py-0.5 text-[13px] font-medium ring-1 ${stateCls(s.state)}`}>{STATE[s.state]}</span>
                      </div>
                      {s.versions.length === 0 && <p className="text-[14px] text-ink-500">{s.canSubmit ? 'لم يُسلَّم بعد.' : 'لم يُسلَّم وأُغلق باب التسليم.'}</p>}
                      {s.versions.map((v, i) => (
                        <div key={v.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-paper-100 px-3 py-2 text-[14px] text-ink-700">
                          <span>الإصدار {v.no}{v.kind === 'file' ? ` — ${v.name ?? 'ملف'} ${size(v.sizeBytes)}` : ' — رابط'}</span>
                          {v.kind === 'file' && v.downloadable && <Button size="sm" variant="ghost" icon={Download} loading={busy === `dl:${v.id}`} onClick={() => void download(v)}>تنزيل</Button>}
                          {i === s.versions.length - 1 && can && <Button size="sm" variant="ghost" icon={Trash2} disabled={busy !== null} onClick={() => setDeleteFor(v)}>{v.kind === 'file' ? 'حذف الملف' : 'حذف الرابط'}</Button>}
                          {v.kind === 'link' && v.url && <a className="inline-flex items-center gap-1 text-forest-700 underline" href={v.url} target="_blank" rel="noopener noreferrer"><ExternalLink className="size-4" aria-hidden />فتح الرابط</a>}
                        </div>
                      ))}
                      {can ? (
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" variant="secondary" icon={Upload} loading={busy === `up:${key}`} disabled={busy !== null} onClick={() => chooseFile(target)}>{s.canReplace ? 'استبدال بملف جديد' : 'رفع ملف'}</Button>
                          <Button size="sm" variant="ghost" icon={Link2} disabled={busy !== null} onClick={() => { setLinkUrl(''); setLinkFor(target) }}>{s.canReplace ? 'استبدال برابط' : 'إضافة رابط'}</Button>
                        </div>
                      ) : s.versions.length > 0 ? <p className="text-[13px] text-ink-500">انتهت مهلة الاستبدال لهذا الفصل.</p> : null}
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>

        <Dialog open={deleteFor !== null} onClose={() => setDeleteFor(null)} title={deleteFor?.kind === 'link' ? 'حذف الرابط' : 'حذف الملف'}
          description={deleteFor?.kind === 'link' ? 'سيُحذف هذا الرابط نهائيًا.' : 'سيُحذف الملف نهائيًا ولا يمكن استرجاعه، ولا يبقى له أثر في المنصة. يمكنكِ رفع ملف جديد ما دام الموعد مفتوحًا.'}
          footer={<><Button variant="secondary" onClick={() => setDeleteFor(null)}>إلغاء</Button><Button variant="danger" icon={Trash2} onClick={() => void doDelete()} loading={busy?.startsWith('dl2:') ?? false}>نعم، احذفي</Button></>}>
          <p className="text-[15px] text-ink-700">{deleteFor ? `الإصدار ${deleteFor.no}${deleteFor.kind === 'file' ? ` — ${deleteFor.name ?? 'ملف'}` : ' — رابط'}` : ''}</p>
        </Dialog>
        <Dialog open={linkFor !== null} onClose={() => setLinkFor(null)} title="حفظ رابط خارجي" description="رابط https فقط. الإصدارات السابقة تبقى محفوظة."
          footer={<><Button variant="secondary" onClick={() => setLinkFor(null)}>إلغاء</Button><Button onClick={() => void saveLink()} loading={busy?.startsWith('ln:') ?? false} disabled={linkUrl.trim() === ''}>حفظ</Button></>}>
          <Field label="الرابط">{({ id }) => <Input id={id} dir="ltr" inputMode="url" autoComplete="off" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} className="text-start" placeholder="https://" />}</Field>
        </Dialog>
      </main>
      <Credits />
    </div>
  )
}
