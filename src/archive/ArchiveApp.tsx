import { useCallback, type ReactNode } from 'react'
import { HashRouter, Link, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { AlertCircle, CheckCircle2, Clock, FolderArchive, House, Info, LayoutDashboard, Lock, Users, TriangleAlert } from 'lucide-react'
import { StoreProvider, useStore } from '../data/store'
import type { DataRepository } from '../data/repository'
import type { Version } from '../data/types'
import { summarize } from '../data/selectors'
import { LogoMark } from '../components/layout/Brand'
import { SectionCard } from '../components/layout/SectionCard'
import { Alert, Card, PageHeader, Progress, SectionTitle, Stat } from '../components/ui/misc'
import { EmptyState } from '../components/ui/States'
import { StatusBar } from '../components/domain/StatusBar'
import { DeadlineTimeline } from '../components/domain/DeadlineTimeline'
import { TermPicker, useTermSelection } from '../components/domain/TermPicker'
import { ToastProvider, useToast } from '../components/ui/Toast'
import { StorageProvider } from '../lib/storage'
import { DownloadOverrideContext, PreviewOverrideContext } from '../lib/downloadOverride'
import TeachersList from '../pages/shared/TeachersList'
import TeacherDetail from '../pages/shared/TeacherDetail'
import { cn } from '../lib/cn'
import { fmtDateTime, fmtNum, fmtPercent } from '../lib/format'
import type { Section } from '../lib/sections'
import type { ArchiveData } from './archiveRepository'
import { PartsProvider, useParts } from './parts'

/**
 * نسخة أثَر «للقراءة فقط» داخل ملف الأرشيف: الصفحات والتصميم والمكوّنات هي نفسها المستعملة في المنصة، لكنها تقرأ من data.js
 * ولا تحوي أي مسار رفع أو تعديل أو حذف، ولا اتصالًا بأي خادم.
 */
const NAV = [
  { to: '/overview', label: 'نظرة عامة', icon: LayoutDashboard },
  { to: '/teachers', label: 'المعلمات والتسليم', icon: Users },
  { to: '/about', label: 'عن الأرشيف', icon: Info },
]

function PartsBanner() {
  const p = useParts()
  if (!p.settled || p.missing.length === 0) return null
  return (
    <Alert tone="warn" title="أرشيف ناقص">
      لم تُستخرج الأجزاء {p.missing.join('، ')} من أصل {p.total} في هذا المجلد. استخرجي كل الأجزاء في المجلد نفسه؛ ملفات الأجزاء الناقصة لا تُعرض إلى ذلك الحين.
    </Alert>
  )
}

function Shell({ data, children }: { data: ArchiveData; children: ReactNode }) {
  const { pathname } = useLocation()
  const home = pathname === '/'
  const base = 'inline-flex h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-4 text-[15px] font-medium transition-colors'
  const cls = ({ isActive }: { isActive: boolean }) => cn(base, isActive ? 'bg-steel-800 text-white shadow-soft' : 'bg-white text-steel-800 ring-1 ring-snow-300 hover:bg-frost-100')
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-snow-300 bg-white/90 backdrop-blur print:hidden">
        <div className="flex h-[4.5rem] w-full items-center gap-2 px-4 sm:px-8">
          <Link to="/" aria-label="أثَر — الصفحة الرئيسية" className="rounded-xl"><LogoMark height={58} /></Link>
          <div className="ms-auto flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-steel-100 px-3 py-1 text-[13px] font-medium text-steel-800"><Lock className="size-3.5" aria-hidden />أرشيف {data.year.label} · للقراءة فقط</span>
          </div>
        </div>
        {!home && (
          <nav aria-label="أقسام الأرشيف" className="border-t border-snow-300 bg-white/70">
            <ul className="mx-auto flex max-w-6xl gap-2 overflow-x-auto px-4 py-2.5 sm:px-6">
              <li><NavLink to="/" end className={cls}><House className="size-4" aria-hidden />الرئيسية</NavLink></li>
              {NAV.map((n) => <li key={n.to}><NavLink to={n.to} className={cls}><n.icon className="size-4" aria-hidden />{n.label}</NavLink></li>)}
            </ul>
          </nav>
        )}
      </header>
      <main className="mx-auto w-full max-w-6xl space-y-5 px-4 py-6 sm:px-6 lg:py-8"><PartsBanner />{children}</main>
    </div>
  )
}

function ArchiveHome({ data }: { data: ArchiveData }) {
  const { terms, teachers, submissions, currentTermId } = useStore()
  const s = summarize(submissions, teachers, currentTermId)
  const term = terms.find((t) => t.id === currentTermId)
  const sections: (Section & { meta?: string })[] = [
    { id: 'overview', to: '/overview', label: 'نظرة عامة', description: 'نسب التسليم ومواعيد كل فصل كما كانت عند الأرشفة.', icon: LayoutDashboard, group: 'الأرشيف', tone: 'frost' },
    { id: 'teachers', to: '/teachers', label: 'المعلمات والتسليم', description: 'حالة تسليم كل معلمة وملفاتها ونسخها، مع معاينة الملف وتنزيله.', icon: Users, group: 'الأرشيف', tone: 'lav', meta: `${fmtNum(teachers.length)} معلمة` },
    { id: 'about', to: '/about', label: 'عن الأرشيف', description: 'تاريخ الإنشاء وبصمة المحتوى وحالة الأجزاء.', icon: FolderArchive, group: 'الأرشيف', tone: 'sand' },
  ]
  return (
    <div className="space-y-8">
      <PageHeader title={`أرشيف السنة الدراسية ${data.year.label}`} subtitle={`أُنشئ في ${fmtDateTime(data.createdAt)}${term ? ` · ${term.name}` : ''}`} />
      <Alert tone="info" title="نسخة للقراءة فقط">هذه نسخة مستقلة من أثَر محفوظة على جهازك. تعمل دون إنترنت، ولا يمكن فيها رفع ملفات أو تعديل أي بيانات.</Alert>
      {s.total > 0 && (
        <Card as="div" className="bg-gradient-to-l from-frost-50 via-white to-lav-50 p-4 sm:p-5">
          <h2 className="mb-3 font-bold text-steel-900">حالة التسليم في آخر فصل</h2>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <li className="flex items-center gap-3 rounded-2xl bg-ok-bg px-4 py-3 text-ok-fg"><CheckCircle2 className="size-5 shrink-0" aria-hidden /><span className="text-sm">تم التسليم</span><span className="num ms-auto text-xl font-bold">{fmtNum(s.on_time)}</span></li>
            <li className="flex items-center gap-3 rounded-2xl bg-late-bg px-4 py-3 text-late-fg"><Clock className="size-5 shrink-0" aria-hidden /><span className="text-sm">متأخر</span><span className="num ms-auto text-xl font-bold">{fmtNum(s.late)}</span></li>
            <li className="flex items-center gap-3 rounded-2xl bg-miss-bg px-4 py-3 text-miss-fg"><AlertCircle className="size-5 shrink-0" aria-hidden /><span className="text-sm">لم يُسلّم</span><span className="num ms-auto text-xl font-bold">{fmtNum(s.missing)}</span></li>
          </ul>
        </Card>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sections.map((x) => <SectionCard key={x.id} section={x} {...(x.meta ? { meta: x.meta } : {})} />)}
      </div>
    </div>
  )
}

function ArchiveOverview() {
  const { terms, teachers, submissions, now } = useStore()
  const sel = useTermSelection()
  const term = terms.find((t) => t.id === sel.termId)
  const s = summarize(submissions, teachers, sel.termId)
  return (
    <div className="space-y-6">
      <PageHeader title="نظرة عامة" subtitle={term?.name} />
      <Card className="p-4" as="div"><div className="grid gap-3 sm:grid-cols-2 sm:max-w-md"><TermPicker sel={sel} /></div></Card>
      {s.total === 0 ? <Card as="div"><EmptyState icon={Users} title="لا توجد بيانات لعرضها" /></Card> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="المعلمات" value={fmtNum(s.total)} icon={Users} />
            <Stat label="تم التسليم" value={fmtNum(s.on_time)} icon={CheckCircle2} tone="ok" />
            <Stat label="تم التسليم متأخرًا" value={fmtNum(s.late)} icon={Clock} tone="late" />
            <Stat label="لم يُسلّم" value={fmtNum(s.missing)} icon={AlertCircle} tone="miss" />
          </div>
          <Card className="p-4 sm:p-5" as="div">
            <div className="mb-2 flex items-center justify-between"><p className="font-bold text-steel-900">نسبة من سلّمن</p><p className="num text-lg font-bold text-steel-900">{fmtPercent(s.rate)}</p></div>
            <Progress value={s.rate} label="نسبة التسليم" />
            <StatusBar on_time={s.on_time} late={s.late} missing={s.missing} className="mt-4" />
          </Card>
        </>
      )}
      {term && <section><SectionTitle title="مواعيد الفصل" /><DeadlineTimeline deadlines={term.deadlines} now={now} /></section>}
    </div>
  )
}

function ArchiveAbout({ data }: { data: ArchiveData }) {
  const p = useParts()
  return (
    <div className="space-y-6">
      <PageHeader title="عن هذا الأرشيف" />
      <Card className="space-y-2 p-4 text-[15px] sm:p-5" as="div">
        <p>السنة الدراسية: <b>{data.year.label}</b></p>
        <p>تاريخ إنشاء الأرشيف: <b>{fmtDateTime(data.createdAt)}</b></p>
        <p>الصيغة: <span className="num">{data.format}</span> · عدد الأجزاء: <span className="num">{fmtNum(p.total || 1)}</span></p>
        <p>بصمة ملخّص المحتوى (SHA-256 لقائمة كل إصدار وبصمة محتواه):</p>
        <p className="num break-all rounded-xl bg-snow-100 p-3 text-[13px]" dir="ltr">{data.entriesDigest}</p>
      </Card>
      {(data.parts?.length ?? 0) > 0 && (
        <Card className="p-4 sm:p-5" as="div">
          <SectionTitle title="أجزاء الأرشيف" />
          <ul className="divide-y divide-snow-200">
            {data.parts!.map((x) => (
              <li key={x.no} className="flex flex-wrap items-center gap-3 py-2.5 text-[14px]">
                <span className="font-medium text-steel-900">جزء {fmtNum(x.no)}</span><span className="num min-w-0 flex-1 break-all text-ink-500" dir="ltr">{x.filename}</span>
                <span className={cn('rounded-full px-2.5 py-0.5 text-[13px] font-medium', !p.settled ? 'bg-snow-200 text-ink-600' : p.has(x.no) ? 'bg-ok-bg text-ok-fg' : 'bg-miss-bg text-miss-fg')}>{!p.settled ? 'يُفحص…' : p.has(x.no) ? 'موجود' : 'ناقص'}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Alert tone="info" title="للتحقق من سلامة الملفات">شغّلي التحقق من ملفات SHA256SUMS-part-NN.txt (انظري README_AR.txt) أو صفحة «الأرشفة والتحقق» في أثَر. رموز دخول المعلمات لا تُحفظ في الأرشيف أصلًا.</Alert>
    </div>
  )
}

/** يفتح ملف النسخة من المجلد المحلي (مسار نسبي)، ويفتح الروابط في تبويب جديد. لا يمسّ أي خادم. */
function Downloads({ children }: { children: ReactNode }) {
  const toast = useToast()
  const parts = useParts()
  const { teachers } = useStore()
  const open = useCallback((v: Version) => {
    void teachers
    if (v.kind === 'link') { if (v.url) window.open(v.url, '_blank', 'noopener,noreferrer'); return }
    const m = (window as unknown as { ATHAR_ARCHIVE?: ArchiveData }).ATHAR_ARCHIVE?.versions.find((x) => x.id === v.id)
    if (m && parts.settled && !parts.has(m.part)) { toast(`هذا الملف في الجزء ${m.part} وهو غير موجود في المجلد. استخرجي كل الأجزاء ثم أعيدي المحاولة.`, 'error'); return }
    if (!v.storageKey) { toast('تعذّر تحديد مكان الملف في الأرشيف.', 'error'); return }
    const a = document.createElement('a'); a.href = v.storageKey; a.download = v.fileName ?? ''; a.target = '_blank'; a.rel = 'noopener'
    document.body.appendChild(a); a.click(); a.remove()
  }, [parts, toast, teachers])
  // معاينة داخل الصفحة من المجلد المحلي (مسار نسبي)؛ تُرجع null إن كان الجزء غير موجود أو لا مسار.
  const preview = useCallback((v: Version): string | null => {
    const m = (window as unknown as { ATHAR_ARCHIVE?: ArchiveData }).ATHAR_ARCHIVE?.versions.find((x) => x.id === v.id)
    if (m && parts.settled && !parts.has(m.part)) return null
    return v.storageKey ?? null
  }, [parts])
  return <DownloadOverrideContext.Provider value={open}><PreviewOverrideContext.Provider value={preview}>{children}</PreviewOverrideContext.Provider></DownloadOverrideContext.Provider>
}

export default function ArchiveApp({ data, repository }: { data: ArchiveData; repository: DataRepository }) {
  return (
    <StorageProvider>
      <StoreProvider repository={repository}>
        <ToastProvider>
          <PartsProvider data={data}>
            <Downloads>
              <HashRouter>
                <Shell data={data}>
                  <Routes>
                    <Route path="/overview" element={<ArchiveOverview />} />
                    <Route path="/teachers" element={<TeachersList base="/teachers" />} />
                    <Route path="/teachers/:id" element={<TeacherDetail backTo="/teachers" />} />
                    <Route path="/about" element={<ArchiveAbout data={data} />} />
                    <Route path="*" element={<ArchiveHome data={data} />} />
                  </Routes>
                </Shell>
              </HashRouter>
            </Downloads>
          </PartsProvider>
        </ToastProvider>
      </StoreProvider>
    </StorageProvider>
  )
}

export function ArchiveMissing() {
  return <div dir="rtl" className="p-8 text-center"><TriangleAlert className="mx-auto mb-3 size-8" aria-hidden /><p>تعذّر تحميل بيانات الأرشيف (data.js). تأكدي من استخراج الأجزاء في المجلد نفسه ثم افتحي index.html.</p></div>
}
