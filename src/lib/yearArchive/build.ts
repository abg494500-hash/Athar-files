// منسّق بناء الأرشيف السنوي المقسَّم إلى أجزاء في المتصفح (A-115، A-116). المدخلات: خطة السنة من الخادم + دالة تجلب روابط قصيرة العمر. المخرجات: Blob لـZIP كامل
// فيه الملفات الفعلية ونسخة أثَر التفاعلية (عارض مستقل) وبيان manifest.json وبصمات SHA256SUMS.txt. **يفشل مغلقًا**: أي ملف ناقص أو حجمه/بصمته
// لا تطابق سجل القاعدة ⇒ لا أرشيف. لا يكتب شيئًا في أي خدمة (التسجيل خطوة منفصلة بيد المالكة).
import indexHtml from './viewer/index.html?raw'
import viewerCss from './viewer/viewer.css?raw'
import viewerJs from './viewer/viewer.js?raw'
import officeJs from '../officeview/officeview.js?raw'
import { ARCHIVE_FORMAT, MAX_FILE_BYTES, MAX_PARTS, entriesDigestText, linkEntryText, pad2, partFilename } from './paths'
import type { YearPlan } from './types'
import { ZipError, ZipWriter } from './zip'

const BATCH = 40
const enc = new TextEncoder()

export type BuildFailureCode = 'files_missing' | 'too_large' | 'fetch_failed' | 'source_mismatch' | 'aborted' | 'zip_error' | 'save_failed' | 'too_many_parts' | 'app_missing'
export class YearArchiveBuildError extends Error {
  code: BuildFailureCode
  problems: { versionId: string; reason: string }[]
  constructor(code: BuildFailureCode, problems: { versionId: string; reason: string }[] = [], detail?: string) {
    super(detail ? `${code}: ${detail}` : code); this.name = 'YearArchiveBuildError'; this.code = code; this.problems = problems
  }
}

export interface BuildProgress { phase: 'download' | 'package'; done: number; total: number; part: number; parts: number }
export interface PartSink {
  /** يحفظ جزءًا على جهاز المالكة (مجلد تختاره أو تنزيل). بعد الاستدعاء لا يحتفظ المنسّق بالجزء: الذاكرة تتسع لجزء واحد فقط. يرمي عند الفشل. */
  savePart(p: { no: number; of: number; filename: string; blob: Blob; sha256: string; size: number }): Promise<void>
}
export interface BuildOptions {
  plan: YearPlan
  sink: PartSink
  /** روابط GET قصيرة لدفعة من نسخ الملفات (يعيد خطأ ⇒ يرمي). */
  getUrls: (versionIds: string[]) => Promise<{ versionId: string; url: string }[]>
  fetchBytes: (url: string, signal?: AbortSignal) => Promise<Uint8Array>
  loadAsset?: (name: 'logo.png') => Promise<Uint8Array | null>
  /** نسخة أثَر للقراءة فقط (index.html + app.js + app.css). إن أُعطيت حلّت محل العارض المبسّط؛ ويجب أن ترمي إن تعذّر تحميلها (فشل مغلق). */
  loadApp?: () => Promise<{ path: string; data: Uint8Array }[]>
  sha256: (data: Uint8Array) => Promise<string>
  onProgress?: (p: BuildProgress) => void
  signal?: AbortSignal
  now?: () => Date
  concurrency?: number
  retries?: number
}

export interface BuiltEntry { versionId: string; path: string; sha256: string; size: number; part: number }
export interface BuiltPart { no: number; filename: string; sha256: string; size: number; entries: number }
export interface BuildResult {
  parts: BuiltPart[]; entriesDigest: string; entries: BuiltEntry[]; createdAt: string; targetBytes: number; totalBytes: number
  counts: { teachers: number; terms: number; submissions: number; versions: number; files: number; links: number }
}

export function buildReadme(label: string, createdAt: string, parts: number): string {
  return `أرشيف منصة أثَر — السنة الدراسية ${label}
تاريخ الإنشاء: ${createdAt}
عدد أجزاء الأرشيف: ${parts}  (ملف ZIP: ...-part-01-of-${pad2(parts)}.zip حتى ...-part-${pad2(parts)}-of-${pad2(parts)}.zip)

كيف أفتح الأرشيف؟
1) ضعي **كل الأجزاء** في مجلد واحد، ثم فكّي ضغط **كل جزء في المجلد نفسه** (زر يمين ← استخراج الكل ← إلى المجلد نفسه، ووافقي على دمج المجلدات). الأجزاء لا تتعارض: لكل جزء ملفاته الخاصة.
2) افتحي ملف index.html بالنقر المزدوج (Chrome أو Edge أو Firefox؛ دون إنترنت ودون تثبيت أي برنامج).
3) إن نقص جزء ظهر في أعلى الصفحة شريط أحمر يسمّي الجزء الناقص، ولا تُعرض ملفاته إلى أن تستخرجيه.

ماذا يوجد؟
- index.html + app.js + app.css + data.js : نسخة أثَر نفسها (الصفحات والتصميم نفسهما) للتصفح **قراءة فقط** — لا رفع ولا تعديل — وتعمل دون إنترنت. داخل الجزء 01.
- archive-index.json : الفهرس الرئيسي: كل الأجزاء وبصمة كل جزء وإصدارات كل جزء. manifest.json : بيان كل إصدار.
- files/ و links/ : الملفات الفعلية (موزّعة على الأجزاء). parts/part-NN.json : محتويات الجزء NN وبصماته.
- SHA256SUMS-part-NN.txt : بصمات ملفات كل جزء.

كيف أتحقق؟
- الأسهل: صفحة «الأرشفة والتحقق» في أثَر ← «التحقق من نسخة اللابتوب (اختيار المجلد)» واختاري مجلد الأجزاء (ملفات ZIP).
- بعد الفك، في PowerShell داخل المجلد: Get-ChildItem SHA256SUMS-part-*.txt | ForEach-Object { Get-Content $_ | ForEach-Object { $h,$p = $_ -split '  ',2; if ((Get-FileHash -Algorithm SHA256 -LiteralPath $p).Hash.ToLower() -ne $h) { "مختلف: $p" } } }
  إن لم يطبع شيئًا فكل الملفات سليمة.

ملاحظة: رموز دخول المعلمات لا تُحفظ نصيًا في أي مكان (المنصة تحفظ بصمات مشفّرة فقط)، ويحوي الأرشيف تاريخ إصدار الرمز وحالته.
`
}

function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0, failed: unknown = null
  const run = async () => { while (failed === null) { const k = i++; if (k >= items.length) return; try { await fn(items[k]!) } catch (e) { failed = e; return } } }
  return Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, run)).then(() => { if (failed !== null) throw failed })
}

export async function buildYearArchive(o: BuildOptions): Promise<BuildResult> {
  const { plan } = o
  const createdAt = (o.now ?? (() => new Date()))().toISOString()
  const day = createdAt.slice(0, 10).replaceAll('-', '')
  const aborted = () => { if (o.signal?.aborted) throw new YearArchiveBuildError('aborted') }
  if (plan.problems.length > 0) throw new YearArchiveBuildError(plan.problems.some((p) => p.reason === 'too_many_parts') ? 'too_many_parts' : plan.problems.some((p) => p.reason === 'file_too_large') ? 'too_large' : 'files_missing', plan.problems)
  const N = plan.layout.parts.length
  if (N < 1 || N > MAX_PARTS) throw new YearArchiveBuildError('too_many_parts')
  if (plan.versions.some((v) => v.kind === 'file' && (v.sizeBytes ?? 0) > MAX_FILE_BYTES)) throw new YearArchiveBuildError('too_large')
  const names = Array.from({ length: N }, (_, k) => partFilename(plan.year.label, day, k + 1, N))
  const builtParts = new Map<number, BuiltPart>()
  const allEntries: BuiltEntry[] = []
  const total = plan.versions.length
  let done = 0
  const tick = (part: number, phase: BuildProgress['phase'] = 'download') => o.onProgress?.({ phase, done, total, part, parts: N })
  tick(1)

  async function fetchPartEntries(no: number): Promise<{ entries: BuiltEntry[]; zip: ZipWriter }> {
    const zip = new ZipWriter(); const entries: BuiltEntry[] = []
    const mine = plan.versions.filter((v) => v.partNo === no)
    const add = (path: string, data: Uint8Array) => { try { zip.add(path, data) } catch (e) { throw new YearArchiveBuildError('zip_error', [], e instanceof ZipError ? e.code : 'zip') } }
    for (const v of mine.filter((x) => x.kind === 'link')) {
      const data = enc.encode(linkEntryText(v.url ?? ''))
      add(v.entryPath, data); entries.push({ versionId: v.id, path: v.entryPath, sha256: await o.sha256(data), size: data.length, part: no }); done++
    }
    const files = mine.filter((x) => x.kind === 'file')
    for (let b = 0; b < files.length; b += BATCH) {
      aborted()
      const batch = files.slice(b, b + BATCH)
      let urls: { versionId: string; url: string }[]
      try { urls = await o.getUrls(batch.map((v) => v.id)) } catch { throw new YearArchiveBuildError('fetch_failed', batch.map((v) => ({ versionId: v.id, reason: 'url_failed' }))) }
      const byId = new Map(urls.map((u) => [u.versionId, u.url]))
      const got = new Map<string, { data: Uint8Array; sha: string }>(); const problems: { versionId: string; reason: string }[] = []
      await pool(batch, o.concurrency ?? 4, async (v) => {
        aborted()
        const url = byId.get(v.id)
        if (!url) { problems.push({ versionId: v.id, reason: 'no_url' }); return }
        let data: Uint8Array | null = null
        for (let t = 0; t <= (o.retries ?? 2) && data === null; t++) { try { data = await o.fetchBytes(url, o.signal) } catch { aborted(); data = null } }
        if (data === null) { problems.push({ versionId: v.id, reason: 'download_failed' }); return }
        const sha = await o.sha256(data)
        if (data.length !== v.sizeBytes || sha !== v.sha256) { problems.push({ versionId: v.id, reason: data.length !== v.sizeBytes ? 'size_mismatch' : 'sha_mismatch' }); return }
        got.set(v.id, { data, sha }); done++; tick(no)
      })
      if (problems.length > 0) throw new YearArchiveBuildError(problems.some((p) => p.reason === 'sha_mismatch' || p.reason === 'size_mismatch') ? 'source_mismatch' : 'fetch_failed', problems)
      for (const v of batch) { const f = got.get(v.id)!; add(v.entryPath, f.data); entries.push({ versionId: v.id, path: v.entryPath, sha256: f.sha, size: f.data.length, part: no }) }
    }
    return { entries, zip }
  }

  const sumsFor = async (list: { path: string; data: Uint8Array }[], entries: BuiltEntry[]) => {
    const rows = [...entries.map((e) => ({ path: e.path, sha: e.sha256 })), ...(await Promise.all(list.map(async (x) => ({ path: x.path, sha: await o.sha256(x.data) }))))]
    return `${rows.sort((a, b) => (a.path < b.path ? -1 : 1)).map((x) => `${x.sha}  ${x.path}`).join('\n')}\n`
  }

  async function finishPart(no: number, zip: ZipWriter, entries: BuiltEntry[], extra: { path: string; data: Uint8Array }[], digest: string): Promise<void> {
    const sums = `SHA256SUMS-part-${pad2(no)}.txt`
    const list = [...extra]
    list.push({ path: `parts/part-${pad2(no)}.json`, data: enc.encode(JSON.stringify({ format: ARCHIVE_FORMAT, part: no, of: N, yearId: plan.year.id, createdAt, entriesDigest: digest, entries: entries.map((e) => ({ versionId: e.versionId, path: e.path, sha256: e.sha256, size: e.size })) }, null, 1)) })
    list.push({ path: `parts/part-${pad2(no)}.js`, data: enc.encode(`(window.ATHAR_PARTS=window.ATHAR_PARTS||{})[${no}]=${N};\n`) })
    list.push({ path: sums, data: enc.encode(await sumsFor(list, entries)) })
    try { for (const x of list) zip.add(x.path, x.data) } catch (e) { throw new YearArchiveBuildError('zip_error', [], e instanceof ZipError ? e.code : 'zip') }
    let blob: Blob
    try { blob = zip.finish() } catch (e) { throw new YearArchiveBuildError('zip_error', [], e instanceof ZipError ? e.code : 'zip') }
    o.onProgress?.({ phase: 'package', done, total, part: no, parts: N })
    const sha256 = await o.sha256(new Uint8Array(await blob.arrayBuffer()))
    try { await o.sink.savePart({ no, of: N, filename: names[no - 1]!, blob, sha256, size: blob.size }) } catch (e) { aborted(); throw new YearArchiveBuildError('save_failed', [], e instanceof Error ? e.message.slice(0, 60) : 'save') }
    builtParts.set(no, { no, filename: names[no - 1]!, sha256, size: blob.size, entries: entries.length })
    allEntries.push(...entries)
  }

  // الأجزاء 2..N أولًا ثم الجزء 1 (يحمل العارض والفهرس الرئيسي ويحتاج بصمات كل الأجزاء الأخرى).
  for (let no = N; no >= 2; no--) {
    aborted(); tick(no)
    const { entries, zip } = await fetchPartEntries(no)
    await finishPart(no, zip, entries, [], plan.entriesDigest)
  }
  aborted(); tick(1)
  const { entries: e1, zip: z1 } = await fetchPartEntries(1)
  allEntries.push(...e1)
  const entriesDigest = await o.sha256(enc.encode(entriesDigestText(allEntries.map((e) => ({ id: e.versionId, sha256: e.sha256, part: e.part })))))
  allEntries.length -= e1.length // finishPart يضيفها
  if (entriesDigest !== plan.entriesDigest) throw new YearArchiveBuildError('source_mismatch', [], 'digest')
  const sorted = [...allEntries, ...e1].sort((a, b) => (a.versionId < b.versionId ? -1 : 1))
  const byVersion = new Map(sorted.map((e) => [e.versionId, e]))
  const partsInfo = Array.from({ length: N }, (_, k) => { const b = builtParts.get(k + 1); return { no: k + 1, filename: names[k]!, sizeBytes: b?.size ?? null, sha256: b?.sha256 ?? null, entries: plan.layout.parts[k]!.entries } })
  const data = {
    format: ARCHIVE_FORMAT, createdAt, entriesDigest, year: plan.year, terms: plan.terms, teachers: plan.teachers, slots: plan.slots, submissions: plan.submissions, totals: plan.totals, parts: partsInfo,
    versions: plan.versions.map((v) => ({ id: v.id, teacherId: v.teacherId, termId: v.termId, slotId: v.slotId, no: v.no, kind: v.kind, name: v.originalName, size: v.sizeBytes, ext: v.ext, mime: v.mime,
      sha: byVersion.get(v.id)!.sha256, url: v.url, submittedAt: v.submittedAt, status: v.status, deadlines: v.deadlines, replacedNote: v.replacedNote, path: v.entryPath, part: v.partNo })),
  }
  const extra: { path: string; data: Uint8Array }[] = []
  const put = (path: string, text: string) => extra.push({ path, data: enc.encode(text) })
  if (o.loadApp) {
    let app: { path: string; data: Uint8Array }[]
    try { app = await o.loadApp() } catch { throw new YearArchiveBuildError('app_missing') }
    if (!['index.html', 'app.js', 'app.css'].every((n) => app.some((f) => f.path === n && f.data.length > 0))) throw new YearArchiveBuildError('app_missing')
    for (const f of app) extra.push(f)
  } else { put('index.html', indexHtml); put('viewer.css', viewerCss); put('viewer.js', viewerJs); put('officeview.js', officeJs) }
  put('data.js', `window.ATHAR_ARCHIVE = ${JSON.stringify(data)};\n`)
  put('README_AR.txt', buildReadme(plan.year.label, createdAt, N))
  const logo = (await o.loadAsset?.('logo.png').catch(() => null)) ?? null
  if (logo) extra.push({ path: 'assets/logo.png', data: logo })
  put('manifest.json', JSON.stringify({ format: ARCHIVE_FORMAT, createdAt, year: plan.year, entriesDigest, counts: { ...plan.totals }, entries: sorted.map((e) => ({ versionId: e.versionId, path: e.path, sha256: e.sha256, size: e.size, part: e.part })) }, null, 1))
  put('archive-index.json', JSON.stringify({ format: ARCHIVE_FORMAT, createdAt, year: { id: plan.year.id, label: plan.year.label }, entriesDigest, targetBytes: plan.layout.targetBytes,
    parts: partsInfo.map((p) => ({ no: p.no, filename: p.filename, sizeBytes: p.sha256 === null ? null : p.sizeBytes, sha256: p.sha256, versionIds: plan.versions.filter((v) => v.partNo === p.no).map((v) => v.id) })) }, null, 1))
  await finishPart(1, z1, e1, extra, entriesDigest)
  allEntries.sort((a, b) => (a.versionId < b.versionId ? -1 : 1))
  const parts = Array.from({ length: N }, (_, k) => builtParts.get(k + 1)!)
  return {
    parts, entriesDigest, entries: allEntries, createdAt, targetBytes: plan.layout.targetBytes, totalBytes: parts.reduce((n, p) => n + p.size, 0),
    counts: { teachers: plan.totals.teachers, terms: plan.totals.terms, submissions: plan.totals.submissions, versions: plan.totals.versions, files: plan.totals.files, links: plan.totals.links },
  }
}
