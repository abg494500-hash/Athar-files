/**
 * عميل الواجهة الخادمية للمالكة والمديرة (الدفعة 8): تنزيل تسليمات المعلمات (مالكة/مديرة)، وإنشاء الأرشيفات وتنزيلها والتحقق من بصمتها (مالكة).
 * الهوية = رمز جلسة Supabase للمسؤولة يُمرَّر لكل طلب؛ **الخادم يتحقق منه ومن الدور** (لا يُعتمد على شيء من هنا). لا رمز يُخزَّن في هذا الملف.
 * **الحالة:** مُختبَر بـfetch وبديل للتجزئة فقط؛ لم يُجرَّب مع خادم أو R2 حقيقيين. تنزيل الأرشيف بـfetch من R2 يتطلب ضبط CORS (GET) على الحاوية.
 */
import { checkTeacherApiUrl } from '../teacherAuth/client'
import { YearArchiveBuildError, buildYearArchive } from '../yearArchive/build'
import type { BuildProgress, BuildResult, PartSink } from '../yearArchive/build'
import { DEFAULT_PART_BYTES } from '../yearArchive/paths'
import type { YearPlan } from '../yearArchive/types'
import { verifyArchiveSet, verifyPartFile } from '../yearArchive/verify'
import type { NamedBlob, PartReport, SetReport } from '../yearArchive/verify'

export type StaffFailure = 'unauthenticated' | 'forbidden' | 'network' | 'server' | 'rejected'
export type StaffResult<T> = { ok: true; value: T } | { ok: false; error: StaffFailure; code?: string }

export const STAFF_MESSAGES: Record<string, string> = {
  unauthenticated: 'انتهت الجلسة. سجّلي الدخول من جديد.',
  forbidden: 'هذا الإجراء للمالكة فقط.',
  network: 'تعذّر الاتصال بالخادم. أعيدي المحاولة.',
  server: 'حدث عطل مؤقت في الخادم. أعيدي المحاولة بعد قليل.',
  rejected: 'تعذّر تنفيذ الطلب.',
  not_found: 'العنصر غير موجود أو غير جاهز.',
  not_archived: 'لا يمكن حذف المعلمة قبل أرشفة كل تسليماتها وتنزيل الأرشيف والتحقق من بصمته (صفحة الأرشفة).',
  archive_build_failed: 'تعذّر بناء الأرشيف: ملف مفقود أو لا يطابق بصمته. لم يُنشأ أرشيف، ولم يُمسّ أي ملف أصلي.',
  hash_mismatch: 'بصمة الملف المنزَّل لا تطابق بصمة الأرشيف المسجَّلة. لا تعتمدي هذه النسخة.',
  audit_failed: 'تعذّر تسجيل الإجراء في سجل التدقيق، فلم يُنفَّذ.',
  not_configured: 'الخدمة غير مهيّأة في الخادم.',
  files_missing: 'بعض ملفات السنة غير موجودة في التخزين، فلا يمكن بناء أرشيف كامل. لم يُمسّ شيء.',
  year_changed: 'تغيّرت بيانات السنة أثناء البناء (تسليم جديد أو تعديل). أعيدي البناء بعد إيقاف الرفع.',
  year_too_large: 'يوجد ملف منفرد أكبر من 1 غيغابايت، وهو الحد التقني لملف واحد داخل جزء ZIP في المتصفح. راجعي دليل الأرشفة.',
  year_too_many_parts: 'عدد الأجزاء يتجاوز 60. اختاري حجم جزء أكبر.',
  year_app_missing: 'تعذّر تحميل نسخة أثَر المرفقة بالأرشيف (public/archive-app). أعيدي بناء المنصة ثم حاولي. لم يُمسّ شيء.',
  year_save_failed: 'تعذّر حفظ أحد الأجزاء على الجهاز (مساحة ناقصة أو إلغاء الحفظ). لم يُسجَّل شيء؛ احذفي الأجزاء المحفوظة جزئيًا وأعيدي.',
  year_fetch_failed: 'تعذّر تنزيل بعض الملفات من التخزين (انقطاع أو CORS أو انتهاء الرابط). لم يُبنَ أرشيف؛ أعيدي المحاولة.',
  year_source_mismatch: 'ملف في التخزين لا يطابق حجمه أو بصمته المسجَّلة في القاعدة. لم يُبنَ أرشيف ولا يُعتمد على هذه السنة قبل فحص الملف.',
  year_aborted: 'أُلغي البناء.',
  year_zip_error: 'تعذّر تجميع ملف ZIP (عدد المدخلات أو حجمه خارج الحد).',
  conflict: 'تعارض: الاسم مكرر أو توجد صفوف مكررة/معيبة. لم يُكتب شيء. راجعي المعاينة.',
  year_work_started: 'بدأ العمل على هذه السنة (تسليمات أو أرشفة أو تصفير)، فلا يُعدَّل تعريفها. عدّلي المواعيد من صفحة «المواعيد».',
  year_closed: 'هذه السنة أُغلقت بالتصفير ولا يمكن تفعيلها. أنشئي سنة جديدة.',
  not_ready: 'الإجراء قبل أوانه: تحقّقي من بصمة الملف المنزَّل أولًا (أو سُجِّل الإقرار مسبقًا).',
}
export const staffMessage = (f: { error: StaffFailure; code?: string }): string => (f.code && STAFF_MESSAGES[f.code]) || STAFF_MESSAGES[f.error] || STAFF_MESSAGES.rejected!

export interface PendingUpload { sessionId: string; teacherId: string; slotId: string; state: 'uploaded' | 'validating' | string; declaredName: string; declaredSize: number; waitingMinutes: number }
export interface UploadOverview { termId: string; asOf: string; sessionsByState: Record<string, number>; pending: PendingUpload[]; submissions: { slotsSubmitted: number; onTime: number; late: number; teachersWithSubmissions: number } }
export interface ArchiveDownloadLink { url: string; expiresAt: string; filename: string; sha256: string; sizeBytes: number }
export interface YearArchiveStatus {
  id: string; title: string; createdAt: string; sizeBytes: number; entries: number; sha256: string; entriesDigest: string
  downloadVerifiedAt: string | null; openedLocally: boolean; secondCopyAt: string | null
  parts: { no: number; filename: string; sha256: string; sizeBytes: number; entries: number; verified: boolean; copyVerified: boolean; copyMedium: string | null }[]
  resetGate: { ready: boolean; problems: string[] }
}
export interface YearArchiveRegistered { id: string; entries: number; files: number; links: number; sizeBytes: number; sha256: string; parts: number }
export type CopyMedium = 'external_drive' | 'usb_flash' | 'cloud' | 'other_computer'
export interface YearFormTerm { ord: 1 | 2; name: string; deadlineBase: string; deadlineLate: string; deadlineReplace: string }
export interface YearForm { label: string; startsOn: string | null; endsOn: string | null; terms: YearFormTerm[] }
export interface ImportResult {
  imported: { id: string; name: string; subject: string }[]
  issued: { teacherId: string; name: string; subject: string; code: string }[]
  issueFailed: string[]
}

export type YearResetState = 'not_started' | 'ready' | 'running' | 'partial' | 'failed' | 'completed'
export interface YearResetStatus {
  yearId: string; state: YearResetState
  gate: { ready: boolean; problems: string[]; archiveId: string | null }
  reset: { id: string; phase: string; startedAt: string; finishedAt: string | null; lastError: string | null; attempts: number
    keys: { total: number; pending: number; deleted: number; verifiedAbsent: number; failed: number }; counters: Record<string, number> } | null
  closure: { closedAt: string; yearLabel: string; archiveTitle: string | null; parts: { part: number; sha256: string; size: number }[]; verification: Record<string, unknown>; deleted: Record<string, number> } | null
}
export interface YearResetReport {
  yearId: string; yearLabel: string; archiveTitle: string | null; teachers: number; submissions: number; versions: number; files: number; links: number; fileBytes: number
  archivePartsCount: number; archiveParts: { part: number; filename: string; sha256: string; size: number; downloadVerified: boolean; copyVerified: boolean; copyMedium: string | null }[]
  gate: { ready: boolean; problems: string[]; archiveId: string | null }
  toDelete: Record<string, number>; stays: Record<string, number>
}

export interface LegacyArchiveRow { id: string; title: string; yearId: string; createdAt: string; sizeBytes: number; sha256: string; transferredAt: string | null }
export interface DownloadVerification { filename: string; bytes: Uint8Array; sha256: string }

export interface StaffApiOptions {
  baseUrl: string
  /** رمز الوصول الحالي للمسؤولة (Supabase) أو null. */
  getToken: () => Promise<string | null>
  fetchImpl?: typeof fetch
  /** بديل لحساب SHA-256 (للاختبار)؛ الافتراضي crypto.subtle. */
  sha256?: (data: Uint8Array) => Promise<string>
}

async function defaultSha256(data: Uint8Array): Promise<string> {
  const d = await globalThis.crypto.subtle.digest('SHA-256', data as unknown as BufferSource)
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function createStaffApiClient(o: StaffApiOptions) {
  const base = checkTeacherApiUrl(o.baseUrl)
  if (!base) throw new Error('عنوان الواجهة الخادمية غير صالح (يلزم https)')
  const f = o.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a))
  const sha = o.sha256 ?? defaultSha256

  async function post(path: string, body: unknown): Promise<StaffResult<Record<string, unknown>>> {
    const token = await o.getToken()
    if (!token) return { ok: false, error: 'unauthenticated' }
    let res: Response
    try {
      res = await f(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body), cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' })
    } catch { return { ok: false, error: 'network' } }
    let json: Record<string, unknown> = {}
    try { json = (await res.json()) as Record<string, unknown> } catch { json = {} }
    if (res.status === 200 || res.status === 204) return { ok: true, value: json }
    const code = typeof json.error === 'string' ? json.error : undefined
    const error: StaffFailure = res.status === 401 ? 'unauthenticated' : res.status === 403 ? 'forbidden' : res.status >= 500 ? 'server' : 'rejected'
    return { ok: false, error, ...(code ? { code } : {}) }
  }

  async function get(path: string, query: Record<string, string>): Promise<StaffResult<Record<string, unknown>>> {
    const token = await o.getToken()
    if (!token) return { ok: false, error: 'unauthenticated' }
    let res: Response
    try {
      res = await f(`${base}${path}?${new URLSearchParams(query).toString()}`, { method: 'GET', headers: { authorization: `Bearer ${token}` }, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' })
    } catch { return { ok: false, error: 'network' } }
    let json: Record<string, unknown> = {}
    try { json = (await res.json()) as Record<string, unknown> } catch { json = {} }
    if (res.status === 200) return { ok: true, value: json }
    const code = typeof json.error === 'string' ? json.error : undefined
    return { ok: false, error: res.status === 401 ? 'unauthenticated' : res.status === 403 ? 'forbidden' : res.status >= 500 ? 'server' : 'rejected', ...(code ? { code } : {}) }
  }

  return {
    /** نظرة عامة على عمليات الرفع في فصل (مالكة أو مديرة): أعداد الحالات، الجلسات المعلّقة، وملخص التسليمات. */
    async overview(termId: string): Promise<StaffResult<UploadOverview>> {
      const r = await get('/staff/overview', { termId })
      if (!r.ok) return r
      const ov = r.value.overview as Partial<UploadOverview> | undefined
      if (!ov || typeof ov.termId !== 'string' || !Array.isArray(ov.pending) || typeof ov.sessionsByState !== 'object') return { ok: false, error: 'server' }
      return { ok: true, value: ov as UploadOverview }
    },
    /** إفراج المالكة عن جلسة عالقة (uploaded/validating): ملاحظة إلزامية، وأثر دائم بهويتها. */
    async releaseSession(i: { sessionId: string; note: string; platformFault: boolean }): Promise<StaffResult<true>> {
      const r = await post('/owner/uploads/release', i)
      return r.ok ? { ok: true, value: true } : r
    },
    /** إنهاء جلسات الرفع المنقضية (صيانة؛ المالكة). يعيد عددها. */
    async sweepExpired(): Promise<StaffResult<number>> {
      const r = await post('/owner/maintenance/sweep', {})
      if (!r.ok) return r
      return typeof r.value.expired === 'number' ? { ok: true, value: r.value.expired } : { ok: false, error: 'server' }
    },
    /** رابط تنزيل قصير العمر لإصدار (مالكة أو مديرة). */
    async signVersionDownload(versionId: string, o: { inline?: boolean } = {}): Promise<StaffResult<{ url: string; filename: string }>> {
      // inline ⇒ رابط معاينة داخل الصفحة (PDF/صور فقط؛ الخادم يرفض غيرها). الجسم لا يتغير في التنزيل العادي.
      const r = await post('/staff/downloads/sign', o.inline === true ? { versionId, inline: true } : { versionId })
      if (!r.ok) return r
      const d = r.value.download as { url?: unknown; filename?: unknown } | undefined
      if (typeof d?.url !== 'string' || !/^https:\/\//.test(d.url) || typeof d.filename !== 'string') return { ok: false, error: 'server' }
      return { ok: true, value: { url: d.url, filename: d.filename } }
    },
    /** إصدار رمز دخول واحد لمعلمة (المالكة أو المديرة). يُعرض **مرة واحدة** ولا يُخزَّن ولا يُسجَّل هنا. إصدار جديد يلغي القديم. */
    async issueCredentials(teacherId: string): Promise<StaffResult<{ code: string }>> {
      const r = await post('/staff/teachers/issue-credentials', { teacherId })
      if (!r.ok) return r
      const v = r.value as { code?: unknown }
      if (typeof v.code !== 'string') return { ok: false, error: 'server' }
      return { ok: true, value: { code: v.code } }
    },
    /** إلغاء دخول المعلمة (يبطل الكود ويُنهي جلساتها). المالكة أو المديرة. */
    async revokeCredentials(teacherId: string): Promise<StaffResult<true>> {
      const r = await post('/staff/teachers/revoke-credentials', { teacherId })
      return r.ok ? { ok: true, value: true } : r
    },
    /** حذف المعلمة بعد الأرشفة (المالكة فقط): يمحو الاسم ويخفيها ويبطل دخولها. يرفض الخادم `not_archived` إن لم تكن كل إصداراتها في أرشيف متحقَّق منه ومنزَّل. */
    async removeTeacher(teacherId: string): Promise<StaffResult<true>> {
      const r = await post('/owner/teachers/remove', { teacherId })
      return r.ok ? { ok: true, value: true } : r
    },
    // ===== الأرشيف السنوي (A-115): يُبنى في متصفح المالكة ولا يُحفظ في R2 =====
    async yearArchivePlan(yearId: string, targetBytes: number = DEFAULT_PART_BYTES): Promise<StaffResult<YearPlan>> {
      const r = await post('/owner/year-archive/plan', { yearId, targetBytes })
      if (!r.ok) return r
      const p = r.value.plan as YearPlan | undefined
      return p && Array.isArray(p.versions) && typeof p.entriesDigest === 'string' && p.layout && Array.isArray(p.layout.parts) ? { ok: true, value: p } : { ok: false, error: 'server' }
    },
    /** يبني الأرشيف السنوي مقسَّمًا في المتصفح: يجلب ملفات كل جزء ويتحقق من بصماتها ويجمّع ZIP ويسلّمه للمخزِّن (sink) فورًا فلا يبقى في الذاكرة إلا جزء واحد. لا يكتب شيئًا في الخادم. */
    async buildYearArchive(yearId: string, opt: { sink: PartSink; targetBytes?: number; onProgress?: (p: BuildProgress) => void; signal?: AbortSignal; loadAsset?: (n: 'logo.png') => Promise<Uint8Array | null>; loadApp?: () => Promise<{ path: string; data: Uint8Array }[]> }): Promise<StaffResult<{ build: BuildResult; plan: YearPlan }>> {
      const pr = await this.yearArchivePlan(yearId, opt.targetBytes ?? DEFAULT_PART_BYTES)
      if (!pr.ok) return pr
      const plan = pr.value
      try {
        const build = await buildYearArchive({
          plan, sink: opt.sink, sha256: sha, ...(opt.onProgress ? { onProgress: opt.onProgress } : {}), ...(opt.signal ? { signal: opt.signal } : {}), ...(opt.loadAsset ? { loadAsset: opt.loadAsset } : {}), ...(opt.loadApp ? { loadApp: opt.loadApp } : {}),
          getUrls: async (ids) => {
            const u = await post('/owner/year-archive/urls', { yearId, versionIds: ids })
            if (!u.ok) throw new Error(u.code ?? u.error)
            const list = u.value.urls as { versionId?: unknown; url?: unknown }[] | undefined
            if (!Array.isArray(list) || list.some((x) => typeof x.versionId !== 'string' || typeof x.url !== 'string' || !/^https:\/\//.test(x.url))) throw new Error('bad_urls')
            return list as { versionId: string; url: string }[]
          },
          fetchBytes: async (url, signal) => {
            const res = await f(url, { method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', ...(signal ? { signal } : {}) })
            if (!res.ok) throw new Error(`http_${res.status}`)
            return new Uint8Array(await res.arrayBuffer())
          },
        })
        return { ok: true, value: { build, plan } }
      } catch (e) {
        if (e instanceof YearArchiveBuildError) return { ok: false, error: 'rejected', code: e.code === 'files_missing' ? 'files_missing' : `year_${e.code}` }
        return { ok: false, error: 'network' }
      }
    },
    /** تسجيل الأرشيف المبني: الخادم يعيد تقسيم السنة ويحسب ملخّص (نسخة، بصمة، جزء) من القاعدة ويقارنه؛ التطابق ⇒ سجل أرشيف وأجزائه وعناصره كلها. */
    async registerYearArchive(i: { yearId: string; title: string; build: Pick<BuildResult, 'parts' | 'entriesDigest' | 'targetBytes'> }): Promise<StaffResult<YearArchiveRegistered>> {
      const r = await post('/owner/year-archive/register', { yearId: i.yearId, title: i.title, targetBytes: i.build.targetBytes, entriesDigest: i.build.entriesDigest,
        parts: i.build.parts.map((p) => ({ no: p.no, filename: p.filename, sha256: p.sha256, size: p.size })) })
      if (!r.ok) return r
      const a = r.value.archive as Partial<YearArchiveRegistered> | undefined
      return typeof a?.id === 'string' ? { ok: true, value: a as YearArchiveRegistered } : { ok: false, error: 'server' }
    },
    /**
     * التحقق من الأجزاء المحفوظة على الجهاز (جزءًا جزءًا). كل جزء سليم يُؤكَّد لدى الخادم فورًا (بصمته المحسوبة محليًا)؛ الجزء الناقص أو التالف يُبلَّغ باسمه ولا يُؤكَّد.
     * «نُزّل وتحقق» لا يُختم إلا حين يتحقق **كل** الأجزاء (الخادم والقاعدة يفرضان ذلك).
     */
    /** فحص جزء مبنيّ في الذاكرة قبل تسليمه للمتصفح ليُحفظ (r41): بنية ZIP وCRC وبصمة كل ملف داخله وقابلية تحميل الواجهة. يُستعمل حين يتعذّر قراءة الملف بعد حفظه (تنزيل عادي). */
    async verifyBuiltPart(blob: Blob, p: { no: number; of: number; filename: string; sha256: string; size: number }): Promise<PartReport> {
      return verifyPartFile(blob, { no: p.no, filename: p.filename, sha256: p.sha256, sizeBytes: p.size }, p.of, sha)
    },
    async verifyAndConfirmSavedParts(i: { archive: Pick<YearArchiveStatus, 'id' | 'parts' | 'entriesDigest'>; files: readonly NamedBlob[]; onPart?: (no: number, status: string) => void }): Promise<StaffResult<SetReport>> {
      const expected = i.archive.parts.map((p) => ({ no: p.no, filename: p.filename, sha256: p.sha256, sizeBytes: p.sizeBytes }))
      let netFail = false
      let rep: SetReport
      try {
        rep = await verifyArchiveSet(i.files, expected, i.archive.entriesDigest, sha, { onPart: async (r) => {
          i.onPart?.(r.no, r.status)
          if (r.sha256 === null) return
          const c = await post('/owner/year-archive/confirm-part', { archiveId: i.archive.id, partNo: r.no, sha256: r.sha256 }) // البصمة المحسوبة؛ الخادم يقارنها (عدم التطابق يترك أثرًا ولا يختم)
          if (!c.ok && c.error !== 'rejected') netFail = true
        } })
      } catch { return { ok: false, error: 'rejected', code: 'hash_mismatch' } }
      return netFail ? { ok: false, error: 'network' } : { ok: true, value: rep }
    },
    /** التحقق من النسخة الثانية (وسيط مستقل عن اللابتوب): فحص كامل لكل جزء (حجم، SHA-256، ZIP وCRC، كل ملف داخلي) ومطابقته للمسجَّل، ويُؤكَّد كل جزء مطابق لدى الخادم. لا يُقبل إقرار بلا تحقق. */
    async verifyAndConfirmSecondCopy(i: { archive: Pick<YearArchiveStatus, 'id' | 'parts' | 'entriesDigest'>; files: readonly NamedBlob[]; medium: CopyMedium; independent: boolean; onPart?: (no: number, status: string) => void }): Promise<StaffResult<SetReport>> {
      if (i.independent !== true) return { ok: false, error: 'rejected', code: 'independent_ack_required' }
      const expected = i.archive.parts.map((p) => ({ no: p.no, filename: p.filename, sha256: p.sha256, sizeBytes: p.sizeBytes }))
      let netFail = false
      let rep: SetReport
      try {
        rep = await verifyArchiveSet(i.files, expected, i.archive.entriesDigest, sha, { onPart: async (r) => {
          i.onPart?.(r.no, r.status)
          if (r.sha256 === null) return
          const c = await post('/owner/year-archive/confirm-copy', { archiveId: i.archive.id, partNo: r.no, sha256: r.sha256, medium: i.medium, independent: i.independent === true })
          if (!c.ok && c.error !== 'rejected') netFail = true
        } })
      } catch { return { ok: false, error: 'rejected', code: 'hash_mismatch' } }
      return netFail ? { ok: false, error: 'network' } : { ok: true, value: rep }
    },
    async ackYearArchive(i: { archiveId: string; kind: 'opened_locally'; note?: string }): Promise<StaffResult<true>> {
      const r = await post('/owner/year-archive/ack', i)
      return r.ok ? { ok: true, value: true } : r
    },
    async yearArchiveStatus(yearId: string): Promise<StaffResult<YearArchiveStatus[]>> {
      const r = await post('/owner/year-archive/status', { yearId })
      if (!r.ok) return r
      const s = r.value.status as { archives?: YearArchiveStatus[] } | undefined
      return Array.isArray(s?.archives) ? { ok: true, value: s!.archives } : { ok: false, error: 'server' }
    },
    /** سنة + فصلان + مواعيد في معاملة واحدة (المالكة). */
    async createYear(year: YearForm): Promise<StaffResult<{ id: string }>> {
      const r = await post('/staff/years/create', { year })
      return r.ok ? (typeof r.value.id === 'string' ? { ok: true, value: { id: r.value.id } } : { ok: false, error: 'server' }) : r
    },
    /** تعديل تعريف سنة قبل بدء العمل عليها فقط (الخادم يرفض بعده). */
    async updateYear(yearId: string, year: YearForm): Promise<StaffResult<true>> {
      const r = await post('/staff/years/update', { yearId, year })
      return r.ok ? { ok: true, value: true } : r
    },
    async activateYear(yearId: string): Promise<StaffResult<true>> {
      const r = await post('/staff/years/activate', { yearId })
      return r.ok ? { ok: true, value: true } : r
    },
    /** المعلمات الحاليات (اسم+مادة) لكشف التكرار في معاينة الاستيراد. */
    async teachersForImportCheck(): Promise<StaffResult<{ name: string; subject: string }[]>> {
      const r = await post('/staff/teachers/import-check', {})
      return r.ok ? (Array.isArray(r.value.existing) ? { ok: true, value: r.value.existing as { name: string; subject: string }[] } : { ok: false, error: 'server' }) : r
    },
    /** استيراد ذرّي (كل الصفوف أو لا شيء). الأكواد المُصدَرة تُعاد مرة واحدة ولا تُخزَّن هنا. */
    async importTeachers(rows: { name: string; subject: string }[], issueCodes: boolean): Promise<StaffResult<ImportResult>> {
      const r = await post('/staff/teachers/import', { rows, issueCodes })
      if (!r.ok) return r
      const v = r.value as Partial<ImportResult>
      return Array.isArray(v.imported) ? { ok: true, value: { imported: v.imported, issued: v.issued ?? [], issueFailed: v.issueFailed ?? [] } } : { ok: false, error: 'server' }
    },
    /** تقرير ما قبل التصفير (قراءة فقط). */
    async yearResetReport(yearId: string): Promise<StaffResult<YearResetReport>> {
      const r = await post('/staff/year-reset/report', { yearId })
      return r.ok ? (r.value.report ? { ok: true, value: r.value.report as YearResetReport } : { ok: false, error: 'server' }) : r
    },
    async yearResetStatus(yearId: string): Promise<StaffResult<YearResetStatus>> {
      const r = await post('/staff/year-reset/status', { yearId })
      return r.ok ? (r.value.status ? { ok: true, value: r.value.status as YearResetStatus } : { ok: false, error: 'server' }) : r
    },
    /** يبدأ التصفير بتأكيد صريح (نقرة واحدة) وينفّذ أول شريحة. done=false ⇒ استأنفي بـyearResetResume. */
    async yearResetStart(yearId: string): Promise<StaffResult<{ done: boolean; status: YearResetStatus }>> {
      const r = await post('/staff/year-reset/start', { yearId, confirm: true })
      return r.ok ? { ok: true, value: { done: r.value.done === true, status: r.value.status as YearResetStatus } } : r
    },
    async yearResetResume(yearId: string): Promise<StaffResult<{ done: boolean; status: YearResetStatus }>> {
      const r = await post('/staff/year-reset/resume', { yearId })
      return r.ok ? { ok: true, value: { done: r.value.done === true, status: r.value.status as YearResetStatus } } : r
    },
    /** أرشيفات سحابية قديمة سبق رفعها إلى R2 (للنقل إلى الجهاز فقط؛ لا إنشاء ولا رفع). */
    async legacyArchives(): Promise<StaffResult<LegacyArchiveRow[]>> {
      const r = await post('/owner/archives/legacy', {})
      if (!r.ok) return r
      return Array.isArray(r.value.archives) ? { ok: true, value: r.value.archives as LegacyArchiveRow[] } : { ok: false, error: 'server' }
    },
    /**
     * تنزيل الأرشيف والتحقق من بصمته: رابط قصير ← تنزيل البايتات ← حساب SHA-256 محليًا ← مقارنة بالمسجَّلة ← إرسال البصمة المحسوبة للخادم ليسجّل التحقق.
     * عدم التطابق (محليًا أو عند الخادم) ⇒ فشل `hash_mismatch` ولا تُسلَّم البايتات للحفظ.
     */
    async downloadLegacyArchive(archiveId: string): Promise<StaffResult<DownloadVerification>> {
      const a = await post('/owner/archives/download', { archiveId })
      if (!a.ok) return a
      const link = a.value.download as Partial<ArchiveDownloadLink> | undefined
      if (typeof link?.url !== 'string' || !/^https:\/\//.test(link.url) || typeof link.sha256 !== 'string' || typeof link.filename !== 'string') return { ok: false, error: 'server' }
      let bytes: Uint8Array
      try {
        const res = await f(link.url, { method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' })
        if (!res.ok) return { ok: false, error: 'rejected', code: 'download_failed' }
        bytes = new Uint8Array(await res.arrayBuffer())
      } catch { return { ok: false, error: 'network' } }
      if (typeof link.sizeBytes === 'number' && bytes.byteLength !== link.sizeBytes) return { ok: false, error: 'rejected', code: 'hash_mismatch' }
      const computed = await sha(bytes)
      if (computed !== link.sha256) {
        await post('/owner/archives/confirm', { archiveId, sha256: computed }) // يُسجَّل أثر الاختلاف في سجل التدقيق؛ نتيجته لا تغيّر الفشل
        return { ok: false, error: 'rejected', code: 'hash_mismatch' }
      }
      const c = await post('/owner/archives/confirm', { archiveId, sha256: computed })
      if (!c.ok) return c
      return { ok: true, value: { filename: link.filename, bytes, sha256: computed } }
    },
  }
}
export type StaffApiClient = ReturnType<typeof createStaffApiClient>
