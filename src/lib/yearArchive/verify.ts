// التحقق من أجزاء الأرشيف المحفوظة على الجهاز (A-115، A-116). **جزءًا جزءًا** (لا يُحمَّل الأرشيف كاملًا في الذاكرة): لكل ملف جزء تُقارَن البصمة والحجم
// بالمسجَّل، ويُفحص ZIP وCRC، وتُطابَق ملفاته مع parts/part-NN.json وSHA256SUMS-part-NN.txt. ثم يُجمَع محتوى كل الأجزاء ويُقارَن ملخّص (نسخة، بصمة، جزء) بالمسجَّل.
// جزء ناقص أو تالف أو غير متوقع ⇒ فشل صريح باسم الجزء. التحقق من النسخة الثانية (shaOnly) يقارن بصمة وحجم كل ملف بالمسجَّل (نفس البايتات تمامًا).
import { ARCHIVE_FORMAT, entriesDigestText, pad2 } from './paths'
import { ZipError, readZip } from './zip'

export interface VerifyCheck { check: string; ok: boolean; detail?: string }
export interface PartEntry { versionId: string; path: string; sha256: string; size: number }
export interface ExpectedPart { no: number; filename: string; sha256: string; sizeBytes: number }
export type PartStatus = 'ok' | 'missing' | 'damaged'
export interface PartReport { no: number; filename: string; status: PartStatus; sha256: string | null; checks: VerifyCheck[]; entries: PartEntry[] }
export interface SetReport { ok: boolean; parts: PartReport[]; checks: VerifyCheck[]; unexpected: string[]; versions: number }
type Sha = (d: Uint8Array) => Promise<string>
export interface NamedBlob extends Blob { name: string }

const VIEWER_FILES = ['index.html', 'data.js', 'manifest.json', 'archive-index.json', 'README_AR.txt']

/** يفحص ملف جزء واحد فحصًا كاملًا (بنية + بصمات + محتوى). */
export async function verifyPartFile(file: Blob, exp: ExpectedPart, of: number, sha256: Sha): Promise<PartReport> {
  const checks: VerifyCheck[] = []
  const add = (check: string, ok: boolean, detail?: string) => { checks.push({ check, ok, ...(detail ? { detail } : {}) }); return ok }
  const rep = (status: PartStatus, sha: string | null, entries: PartEntry[] = []): PartReport => ({ no: exp.no, filename: exp.filename, status, sha256: sha, checks, entries })
  const bytes = new Uint8Array(await file.arrayBuffer())
  const sha = await sha256(bytes)
  if (!add('size_matches_registered', bytes.length === exp.sizeBytes, `${bytes.length} ≠ ${exp.sizeBytes}`)) return rep('damaged', sha)
  if (!add('sha256_matches_registered', sha === exp.sha256)) return rep('damaged', sha)
  let entries
  try { entries = readZip(bytes); add('zip_structure_and_crc', true) } catch (e) { add('zip_structure_and_crc', false, e instanceof ZipError ? e.message : 'zip'); return rep('damaged', sha) }
  const map = new Map(entries.map((e) => [e.path, e.data]))
  const nn = pad2(exp.no)
  const required = [`parts/part-${nn}.json`, `parts/part-${nn}.js`, `SHA256SUMS-part-${nn}.txt`, ...(exp.no === 1 ? VIEWER_FILES : [])]
  const missing = required.filter((p) => !map.has(p))
  if (exp.no === 1 && !(map.has('app.js') && map.has('app.css')) && !(map.has('viewer.js') && map.has('viewer.css'))) missing.push('app.js/app.css')
  if (!add('required_files_present', missing.length === 0, missing.join(', '))) return rep('damaged', sha)
  let pj: { format?: string; part?: number; of?: number; entries?: PartEntry[] }
  try { pj = JSON.parse(new TextDecoder().decode(map.get(`parts/part-${nn}.json`)!)) } catch { add('part_manifest_readable', false); return rep('damaged', sha) }
  if (!add('part_manifest_identity', pj.format === ARCHIVE_FORMAT && pj.part === exp.no && pj.of === of && Array.isArray(pj.entries), `${pj.format}/${pj.part}/${pj.of}`)) return rep('damaged', sha)
  const bad: string[] = []
  for (const e of pj.entries!) {
    const d = map.get(e.path)
    if (!d) { bad.push(`مفقود: ${e.path}`); continue }
    if (d.length !== e.size || (await sha256(d)) !== e.sha256) bad.push(`لا يطابق: ${e.path}`)
  }
  add('every_part_entry_matches', bad.length === 0, bad.slice(0, 5).join(' | '))
  const sumsBad: string[] = []
  for (const line of new TextDecoder().decode(map.get(`SHA256SUMS-part-${nn}.txt`)!).split('\n').filter(Boolean)) {
    const m = /^([0-9a-f]{64}) {2}(.+)$/.exec(line); const d = m ? map.get(m[2]!) : undefined
    if (!m || !d || (await sha256(d)) !== m[1]) sumsBad.push(line.slice(66))
  }
  add('sha256sums_matches', sumsBad.length === 0, sumsBad.slice(0, 5).join(' | '))
  // الجزء 1 يحمل الواجهة: data.js يجب أن يُحمَّل (صيغة صحيحة) وإلا فتح الأرشيف دون إنترنت يظهر فارغًا (r41: التحقق أن الأرشيف «يعمل»)
  if (exp.no === 1) {
    let ok = false
    try {
      const m = /^window\.ATHAR_ARCHIVE = ([\s\S]*);\s*$/.exec(new TextDecoder().decode(map.get('data.js')!))
      const d = m ? (JSON.parse(m[1]!) as { format?: string; versions?: unknown }) : null
      ok = !!d && d.format === ARCHIVE_FORMAT && Array.isArray(d.versions)
    } catch { ok = false }
    add('viewer_data_loadable', ok)
  }
  return rep(checks.every((c) => c.ok) ? 'ok' : 'damaged', sha, pj.entries!)
}

/**
 * يتحقق من مجموعة أجزاء مختارة (ملفات ZIP) مقابل المسجَّل. المطابقة بالاسم. shaOnly: للنسخة الثانية (بصمة وحجم كل ملف فقط).
 * onPart يُستدعى بعد كل جزء (لعرض التقدم وإرسال التأكيد للخادم فور نجاحه).
 */
export async function verifyArchiveSet(files: readonly NamedBlob[], expected: readonly ExpectedPart[], expectedDigest: string, sha256: Sha, o: { shaOnly?: boolean; onPart?: (r: PartReport) => void | Promise<void> } = {}): Promise<SetReport> {
  const byName = new Map<string, NamedBlob>()
  for (const f of files) byName.set(f.name, f)
  const parts: PartReport[] = []
  const of = expected.length
  for (const p of [...expected].sort((a, b) => a.no - b.no)) {
    const f = byName.get(p.filename)
    let r: PartReport
    if (!f) r = { no: p.no, filename: p.filename, status: 'missing', sha256: null, checks: [{ check: 'file_present', ok: false, detail: p.filename }], entries: [] }
    else if (o.shaOnly) {
      const bytes = new Uint8Array(await f.arrayBuffer()); const sha = await sha256(bytes)
      const ok = bytes.length === p.sizeBytes && sha === p.sha256
      r = { no: p.no, filename: p.filename, status: ok ? 'ok' : 'damaged', sha256: sha, checks: [{ check: 'size_and_sha256_match_registered', ok, ...(ok ? {} : { detail: `${bytes.length}/${p.sizeBytes}` }) }], entries: [] }
    } else r = await verifyPartFile(f, p, of, sha256)
    parts.push(r)
    await o.onPart?.(r)
  }
  const checks: VerifyCheck[] = []
  const unexpected = files.filter((f) => !expected.some((p) => p.filename === f.name)).map((f) => f.name)
  checks.push({ check: 'all_parts_present_and_intact', ok: parts.every((p) => p.status === 'ok'), detail: parts.filter((p) => p.status !== 'ok').map((p) => `الجزء ${p.no}: ${p.status === 'missing' ? 'ناقص' : 'تالف'}`).join(' | ') })
  let versions = 0
  if (!o.shaOnly) {
    const all = parts.flatMap((p) => p.entries.map((e) => ({ id: e.versionId, sha256: e.sha256, part: p.no })))
    versions = all.length
    const ids = new Set(all.map((e) => e.id))
    checks.push({ check: 'no_duplicate_versions_across_parts', ok: ids.size === all.length })
    if (parts.every((p) => p.status === 'ok')) {
      const enc = new TextEncoder()
      checks.push({ check: 'entries_digest_matches_registered', ok: (await sha256(enc.encode(entriesDigestText(all)))) === expectedDigest })
    }
  }
  // ملفات إضافية غير متوقعة لا تُفشل التحقق (تُعرض للمالكة فقط)؛ الفشل بجزء ناقص/تالف أو ملخّص لا يطابق.
  return { ok: checks.every((c) => c.ok), parts, checks, unexpected, versions }
}
