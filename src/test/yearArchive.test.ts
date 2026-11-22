// الأرشيف السنوي (A-115): كاتب/قارئ ZIP، بناء الأرشيف في المتصفح بحالاته الناجحة والفاشلة، التحقق من الملف المحفوظ، والعارض المستقل.
// كل الاختبارات في الذاكرة (لا شبكة ولا Supabase ولا R2): fetchBytes وgetUrls بدائل.
import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { buildYearArchive, YearArchiveBuildError } from '../lib/yearArchive/build'
import type { BuildOptions } from '../lib/yearArchive/build'
import { entriesDigestText, linkEntryText, partitionVersions, safeComponent, versionEntryPath } from '../lib/yearArchive/paths'
import type { PlanVersion, YearPlan } from '../lib/yearArchive/types'
import { verifyArchiveSet } from '../lib/yearArchive/verify'
import type { NamedBlob } from '../lib/yearArchive/verify'
import { ZipError, ZipWriter, readZip } from '../lib/yearArchive/zip'

const sha = async (d: Uint8Array) => createHash('sha256').update(d).digest('hex')
const shaS = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')
const enc = new TextEncoder()
const T1 = '00000000-0000-0000-0000-000000000001', T2 = '00000000-0000-0000-0000-000000000002'
const TERM1 = '00000000-0000-0000-0000-0000000000a1', TERM2 = '00000000-0000-0000-0000-0000000000a2'
const bytes = (s: string, n = 1) => enc.encode(s.repeat(n))

interface Fixture { plan: YearPlan; store: Map<string, Uint8Array> }
function fixture(over: { teacherName?: string; targetBytes?: number } = {}): Fixture {
  const store = new Map<string, Uint8Array>()
  const mk = (i: number, teacherId: string, termId: string, termOrd: number, slotId: string, no: number, name: string, ext: string, data: Uint8Array): PlanVersion => {
    const id = `00000000-0000-0000-0000-0000000001${String(i).padStart(2, '0')}`
    store.set(id, data)
    const sha256 = createHash('sha256').update(data).digest('hex')
    return { id, teacherId, termId, termOrd, slotId, no, kind: 'file', originalName: name, sizeBytes: data.length, mime: ext === 'pdf' ? 'application/pdf' : 'image/png', ext, sha256, url: null, partNo: 1,
      submittedAt: '2026-10-01T08:00:00Z', status: 'on_time', deadlines: {}, replacedNote: null, entrySize: data.length, entrySha256: sha256,
      entryPath: versionEntryPath({ id, termOrd, teacherId, slotId, no, kind: 'file', ext, originalName: name }) }
  }
  const link = (i: number): PlanVersion => {
    const id = `00000000-0000-0000-0000-0000000001${String(i).padStart(2, '0')}`
    const text = linkEntryText('https://example.com/evidence')
    return { id, teacherId: T2, termId: TERM2, termOrd: 2, slotId: 's2', no: 1, kind: 'link', originalName: null, sizeBytes: null, mime: null, ext: null, sha256: null, url: 'https://example.com/evidence', partNo: 1,
      submittedAt: '2026-02-01T08:00:00Z', status: 'late', deadlines: {}, replacedNote: null, entrySize: enc.encode(text).length, entrySha256: shaS(text),
      entryPath: versionEntryPath({ id, termOrd: 2, teacherId: T2, slotId: 's2', no: 1, kind: 'link', ext: null, originalName: null }) }
  }
  const versions = [
    mk(1, T1, TERM1, 1, 's1', 1, 'خطة الدرس.pdf', 'pdf', bytes('%PDF-1 v1 ', 50)),
    mk(2, T1, TERM1, 1, 's1', 2, 'خطة الدرس.pdf', 'pdf', bytes('%PDF-1 v2 ', 60)),
    mk(3, T1, TERM2, 2, 's1', 1, 'صورة.png', 'png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6])),
    link(4),
  ]
  const plan: YearPlan = {
    year: { id: '00000000-0000-0000-0000-0000000000ff', label: '2026–2027', active: true, createdAt: '2026-09-01T00:00:00Z' },
    terms: [{ id: TERM1, name: 'الفصل الأول', ord: 1, deadlineBase: '2026-11-01', deadlineLate: '2026-11-10', deadlineReplace: '2026-11-20' }, { id: TERM2, name: 'الفصل الثاني', ord: 2, deadlineBase: '2027-03-01', deadlineLate: '2027-03-10', deadlineReplace: '2027-03-20' }],
    teachers: [{ id: T1, name: over.teacherName ?? 'سارة', subject: 'رياضيات', active: true, colorIdx: 0, createdAt: '2026-09-02T00:00:00Z', removedAt: null, credential: { state: 'active', issuedAt: '2026-09-02T00:00:00Z', expiresAt: null } },
      { id: T2, name: 'منى', subject: 'علوم', active: false, colorIdx: 1, createdAt: '2026-09-03T00:00:00Z', removedAt: null, credential: null }],
    slots: [{ id: 's1', title: 'خطة الدرس', optional: false, ord: 1 }, { id: 's2', title: 'شواهد', optional: true, ord: 2 }],
    submissions: [{ teacherId: T1, termId: TERM1, slotId: 's1', createdAt: '2026-10-01T08:00:00Z' }],
    versions, problems: [],
    totals: { teachers: 2, terms: 2, submissions: 1, versions: versions.length, files: 3, links: 1, fileBytes: versions.filter((v) => v.kind === 'file').reduce((n, v) => n + (v.sizeBytes ?? 0), 0) },
    layout: { targetBytes: 0, parts: [] }, entriesDigest: '',
  }
  const target = over.targetBytes ?? 200_000_000
  const pt = partitionVersions(versions, target)
  for (const v of versions) v.partNo = pt.partOf.get(v.id)!
  plan.layout = { targetBytes: target, parts: pt.parts }
  plan.entriesDigest = shaS(entriesDigestText(versions.map((v) => ({ id: v.id, sha256: v.entrySha256, part: v.partNo }))))
  return { plan, store }
}

/** مخزِّن في الذاكرة بدل القرص: يجمع أجزاء ZIP المحفوظة بأسمائها. */
function memSink() { const saved = new Map<string, Blob>(); const order: number[] = []; return { saved, order, sink: { savePart: async (p: { no: number; filename: string; blob: Blob }) => { saved.set(p.filename, p.blob); order.push(p.no) } } } }
const asFiles = (m: Map<string, Blob>): NamedBlob[] => [...m].map(([n, b]) => new File([b], n) as NamedBlob)
const expectedOf = (b: { parts: { no: number; filename: string; sha256: string; size: number }[] }) => b.parts.map((p) => ({ no: p.no, filename: p.filename, sha256: p.sha256, sizeBytes: p.size }))
const bytesOf = async (b: Blob) => new Uint8Array(await b.arrayBuffer())
async function buildSet(over: { targetBytes?: number; teacherName?: string } = {}, o: Partial<BuildOptions> = {}) {
  const f = fixture(over); const m = memSink(); const b = await buildYearArchive(opts(f, { sink: m.sink, ...o }))
  return { f, m, b }
}

function opts(f: Fixture, over: Partial<BuildOptions> = {}): BuildOptions {
  return {
    plan: f.plan, sha256: sha, sink: memSink().sink,
    getUrls: async (ids) => ids.map((id) => ({ versionId: id, url: `https://r2.example/${id}` })),
    fetchBytes: async (url) => { const d = f.store.get(url.split('/').pop()!); if (!d) throw new Error('http_404'); return d },
    loadAsset: async () => new Uint8Array([1, 2, 3]),
    now: () => new Date('2027-06-20T10:00:00Z'), retries: 1,
    ...over,
  }
}

describe('ZIP للمتصفح — كتابة وقراءة', () => {
  it('ذهاب وإياب: المسارات والمحتوى (بما فيها العربية) والـCRC', async () => {
    const w = new ZipWriter()
    w.add('a/b.txt', enc.encode('مرحبا')); w.add('c.bin', new Uint8Array([0, 1, 2, 255]))
    const out = readZip(new Uint8Array(await w.finish().arrayBuffer()))
    expect(out.map((e) => e.path)).toEqual(['a/b.txt', 'c.bin'])
    expect(new TextDecoder().decode(out[0]!.data)).toBe('مرحبا'); expect([...out[1]!.data]).toEqual([0, 1, 2, 255])
  })
  it('مسار خطر أو مكرر يُرفض عند الكتابة', () => {
    const w = new ZipWriter(); w.add('x.txt', new Uint8Array([1]))
    for (const p of ['../x', '/abs', 'a\\b', 'a//b', 'dir/', '', 'a/./b']) expect(() => w.add(p, new Uint8Array([1])), p).toThrow(ZipError)
    expect(() => w.add('x.txt', new Uint8Array([1]))).toThrow(/duplicate_path/)
  })
  it('تلف بايت أو اقتطاع ⇒ corrupt_zip', async () => {
    const w = new ZipWriter(); w.add('x.txt', enc.encode('hello world'))
    const good = new Uint8Array(await w.finish().arrayBuffer())
    const flipped = good.slice(); flipped[40] = flipped[40]! ^ 0xff
    expect(() => readZip(flipped)).toThrow(/corrupt_zip/)
    expect(() => readZip(good.slice(0, good.length - 10))).toThrow(/corrupt_zip/)
    expect(() => readZip(new Uint8Array(5))).toThrow(/corrupt_zip/)
  })
})

describe('مسارات الأرشيف', () => {
  it('ASCII فقط ولا تصطدم لإصدارين مختلفين', () => {
    const a = versionEntryPath({ id: 'i', termOrd: 1, teacherId: T1, slotId: 's1', no: 1, kind: 'file', ext: 'pdf', originalName: 'خطة الدرس.pdf' })
    const b = versionEntryPath({ id: 'i', termOrd: 1, teacherId: T1, slotId: 's1', no: 2, kind: 'file', ext: 'pdf', originalName: 'خطة الدرس.pdf' })
    expect(a).toMatch(/^files\/t1\/[A-Za-z0-9_.-]+\/s1\/v1-[A-Za-z0-9_.-]+\.pdf$/); expect(a).not.toBe(b)
    expect(safeComponent('../../etc/passwd')).not.toContain('/')
  })
})

describe('تقسيم حتمي للأجزاء', () => {
  const k = (id: string, termOrd: number, no: number, size: number) => ({ id, termOrd, teacherId: 't', slotId: 's', no, entrySize: size })
  it('نفس المدخلات بأي ترتيب ⇒ نفس التقسيم، وكل إصدار في جزء واحد فقط', () => {
    const items = [k('c', 1, 1, 40), k('a', 1, 2, 40), k('b', 2, 1, 40), k('d', 2, 2, 40)]
    const x = partitionVersions(items, 90), y = partitionVersions([...items].reverse(), 90)
    expect([...x.partOf]).toEqual(expect.arrayContaining([...y.partOf])); expect(x.parts).toEqual(y.parts)
    expect(x.parts.map((p) => p.entries)).toEqual([2, 2]); expect(x.partOf.size).toBe(4)
  })
  it('ملف أكبر من الهدف يأخذ جزءًا لنفسه ولا يُفقد شيء', () => {
    const r = partitionVersions([k('a', 1, 1, 500), k('b', 1, 2, 10), k('c', 1, 3, 10)], 100)
    expect(r.parts.map((p) => p.entries)).toEqual([1, 2]); expect(r.parts.reduce((n, p) => n + p.entries, 0)).toBe(3)
  })
  it('سنة بلا إصدارات ⇒ جزء واحد فارغ', () => { expect(partitionVersions([], 100).parts).toEqual([{ no: 1, entries: 0, bytes: 0 }]) })
})

describe('بناء الأرشيف السنوي المقسَّم في المتصفح', () => {
  it('جزء واحد: ZIP فيه الملفات الفعلية والعارض والفهرس، ويمرّ التحقق', async () => {
    const { f, m, b } = await buildSet()
    expect(b.parts).toHaveLength(1); expect(b.counts).toMatchObject({ versions: 4, files: 3, links: 1 })
    expect(b.parts[0]!.filename).toBe('athar-archive-2026_2027-20270620-part-01-of-01.zip')
    const z = new Map(readZip(await bytesOf(m.saved.get(b.parts[0]!.filename)!)).map((e) => [e.path, e.data]))
    for (const p of ['index.html', 'viewer.js', 'viewer.css', 'data.js', 'manifest.json', 'archive-index.json', 'README_AR.txt', 'assets/logo.png', 'SHA256SUMS-part-01.txt', 'parts/part-01.json', 'parts/part-01.js']) expect(z.has(p), p).toBe(true)
    for (const v of f.plan.versions.filter((x) => x.kind === 'file')) expect([...z.get(v.entryPath)!]).toEqual([...f.store.get(v.id)!])
    const rep = await verifyArchiveSet(asFiles(m.saved), expectedOf(b), b.entriesDigest, sha)
    expect(rep.ok, JSON.stringify(rep.checks.filter((c) => !c.ok))).toBe(true); expect(rep.versions).toBe(4)
  })
  it('عدة أجزاء: لا يضيع أي ملف أو إصدار ولا يتكرر، وفهرس الجزء الأول يسرد كل الأجزاء ومحتوياتها', async () => {
    const { f, m, b } = await buildSet({ targetBytes: 600 })
    expect(b.parts.length).toBe(3); expect(m.saved.size).toBe(3)
    expect(m.order).toEqual([3, 2, 1]) // الجزء 1 (العارض) آخرًا
    const seen = new Map<string, number>()
    for (const p of b.parts) for (const e of readZip(await bytesOf(m.saved.get(p.filename)!))) { const v = f.plan.versions.find((x) => x.entryPath === e.path); if (v) seen.set(v.id, (seen.get(v.id) ?? 0) + 1) }
    expect(seen.size).toBe(4); expect([...seen.values()].every((n) => n === 1)).toBe(true)
    const p1 = new Map(readZip(await bytesOf(m.saved.get(b.parts[0]!.filename)!)).map((e) => [e.path, new TextDecoder().decode(e.data)]))
    const idx = JSON.parse(p1.get('archive-index.json')!) as { parts: { no: number; filename: string; sha256: string | null; versionIds: string[] }[] }
    expect(idx.parts.map((x) => x.filename)).toEqual(b.parts.map((x) => x.filename))
    expect(idx.parts.flatMap((x) => x.versionIds).sort()).toEqual(f.plan.versions.map((v) => v.id).sort())
    expect(idx.parts[1]!.sha256).toBe(b.parts[1]!.sha256) // بصمة الجزء 2 مسجّلة في الفهرس الرئيسي
    for (const no of [2, 3]) { const names = readZip(await bytesOf(m.saved.get(b.parts[no - 1]!.filename)!)).map((e) => e.path); expect(names).not.toContain('index.html'); expect(names).toContain(`parts/part-0${no}.js`) }
    const rep = await verifyArchiveSet(asFiles(m.saved), expectedOf(b), b.entriesDigest, sha)
    expect(rep.ok, JSON.stringify(rep.checks.filter((c) => !c.ok))).toBe(true); expect(rep.versions).toBe(4)
  })
  it('الأرشيف مستقل: لا مفاتيح R2 ولا روابط مؤقتة ولا أسرار في أي جزء', async () => {
    const { m } = await buildSet({ targetBytes: 600 })
    let all = ''
    for (const z of m.saved.values()) all += readZip(await bytesOf(z)).filter((e) => /\.(js|json|html|txt|css)$/.test(e.path)).map((e) => new TextDecoder().decode(e.data)).join('\n')
    expect(all).not.toContain('r2.example'); expect(all).not.toMatch(/storage_key|storageKey|X-Amz|r2\.cloudflarestorage|code_hash|pin_hash/i)
  })
  it('ملف ناقص في التخزين (problems) ⇒ files_missing ولا يُحفظ جزء', async () => {
    const f = fixture(); f.plan.problems = [{ versionId: f.plan.versions[0]!.id, reason: 'file_not_present' }]; const m = memSink()
    await expect(buildYearArchive(opts(f, { sink: m.sink }))).rejects.toMatchObject({ code: 'files_missing' }); expect(m.saved.size).toBe(0)
  })
  it('تجاوز عدد الأجزاء ⇒ too_many_parts / ملف أكبر من 1GB ⇒ too_large', async () => {
    const f = fixture(); f.plan.problems = [{ versionId: 'x', reason: 'too_many_parts' }]
    await expect(buildYearArchive(opts(f))).rejects.toMatchObject({ code: 'too_many_parts' })
    const g = fixture(); g.plan.problems = [{ versionId: 'x', reason: 'file_too_large' }]
    await expect(buildYearArchive(opts(g))).rejects.toMatchObject({ code: 'too_large' })
  })
  it('فشل التنزيل ⇒ fetch_failed؛ بصمة مختلفة ⇒ source_mismatch؛ حجم مختلف ⇒ source_mismatch', async () => {
    const f = fixture({ targetBytes: 600 }); f.store.delete(f.plan.versions[1]!.id)
    const e = (await buildYearArchive(opts(f)).catch((x) => x)) as YearArchiveBuildError
    expect(e).toBeInstanceOf(YearArchiveBuildError); expect(e.code).toBe('fetch_failed')
    const g = fixture(); const id = g.plan.versions[0]!.id; const d = g.store.get(id)!.slice(); d[3] = d[3]! ^ 1; g.store.set(id, d)
    await expect(buildYearArchive(opts(g))).rejects.toMatchObject({ code: 'source_mismatch', problems: [{ versionId: id, reason: 'sha_mismatch' }] })
    const h = fixture(); const id2 = h.plan.versions[0]!.id; h.store.set(id2, h.store.get(id2)!.slice(0, 10))
    await expect(buildYearArchive(opts(h))).rejects.toMatchObject({ code: 'source_mismatch', problems: [{ reason: 'size_mismatch' }] })
  })
  it('ملخّص المحتوى لا يطابق خطة الخادم ⇒ source_mismatch', async () => {
    const f = fixture(); f.plan.entriesDigest = 'a'.repeat(64)
    await expect(buildYearArchive(opts(f))).rejects.toMatchObject({ code: 'source_mismatch' })
  })
  it('فشل حفظ جزء (امتلأ القرص) ⇒ save_failed، ولا يُعدّ ناجحًا', async () => {
    const f = fixture({ targetBytes: 600 }); let n = 0
    const sink = { savePart: async () => { if (++n === 2) throw new Error('disk full') } }
    await expect(buildYearArchive(opts(f, { sink }))).rejects.toMatchObject({ code: 'save_failed' })
  })
  it('إلغاء المستخدم ⇒ aborted', async () => {
    const f = fixture(); const ac = new AbortController(); ac.abort()
    await expect(buildYearArchive(opts(f, { signal: ac.signal }))).rejects.toMatchObject({ code: 'aborted' })
  })
  it('جزء واحد فقط في الذاكرة: لا تُحتفظ أجزاء سابقة بعد تسليمها للمخزِّن', async () => {
    const f = fixture({ targetBytes: 600 }); const held: Blob[] = []
    await buildYearArchive(opts(f, { sink: { savePart: async (p) => { held.push(p.blob) } } }))
    expect(held.length).toBe(3) // المنسّق لا يحتفظ بها؛ المرجع هنا للاختبار فقط
  })
  it('سنة بلا أي إصدار ⇒ أرشيف صالح من جزء واحد', async () => {
    const f = fixture(); f.plan.versions = []; f.plan.totals = { ...f.plan.totals, versions: 0, files: 0, links: 0, fileBytes: 0 }; f.plan.layout = { targetBytes: 200_000_000, parts: [{ no: 1, entries: 0, bytes: 0 }] }; f.plan.entriesDigest = shaS('')
    const m = memSink(); const b = await buildYearArchive(opts(f, { sink: m.sink }))
    expect((await verifyArchiveSet(asFiles(m.saved), expectedOf(b), b.entriesDigest, sha)).ok).toBe(true)
  })
})

describe('التحقق من أجزاء الأرشيف المحفوظة', () => {
  const corrupt = async (b: Blob, at = 100) => { const x = await bytesOf(b); x[at] = x[at]! ^ 1; return new Blob([x as unknown as BlobPart]) }
  it('جزء ناقص ⇒ يُبلَّغ باسمه ولا يُعدّ الأرشيف سليمًا', async () => {
    const { m, b } = await buildSet({ targetBytes: 600 }); m.saved.delete(b.parts[1]!.filename)
    const r = await verifyArchiveSet(asFiles(m.saved), expectedOf(b), b.entriesDigest, sha)
    expect(r.ok).toBe(false); expect(r.parts.map((p) => p.status)).toEqual(['ok', 'missing', 'ok']); expect(r.parts[1]!.filename).toBe(b.parts[1]!.filename)
    expect(r.checks.find((c) => c.check === 'all_parts_present_and_intact')?.ok).toBe(false)
  })
  it('بايت واحد متغيّر في جزء ⇒ تالف (والبقية سليمة)', async () => {
    const { m, b } = await buildSet({ targetBytes: 600 }); const n = b.parts[2]!.filename; m.saved.set(n, await corrupt(m.saved.get(n)!))
    const r = await verifyArchiveSet(asFiles(m.saved), expectedOf(b), b.entriesDigest, sha)
    expect(r.ok).toBe(false); expect(r.parts.map((p) => p.status)).toEqual(['ok', 'ok', 'damaged'])
  })
  it('جزء مقتطع (تنزيل ناقص) ⇒ تالف', async () => {
    const { m, b } = await buildSet({ targetBytes: 600 }); const n = b.parts[1]!.filename
    m.saved.set(n, m.saved.get(n)!.slice(0, m.saved.get(n)!.size - 40))
    expect((await verifyArchiveSet(asFiles(m.saved), expectedOf(b), b.entriesDigest, sha)).parts[1]!.status).toBe('damaged')
  })
  it('ZIP تالف بصمته سُجِّلت خطأً ⇒ يفشل (CRC/بنية)، وجزء مبدَّل بمحتوى مزوَّر ⇒ يفشل (البيان)', async () => {
    const { f, m, b } = await buildSet({ targetBytes: 600 })
    const n = b.parts[1]!.filename; const bad = await bytesOf(await corrupt(m.saved.get(n)!, 60))
    const r1 = await verifyArchiveSet([new File([bad as unknown as BlobPart], n) as NamedBlob], [{ no: 2, filename: n, sha256: await sha(bad), sizeBytes: bad.length }], b.entriesDigest, sha)
    expect(r1.parts[0]!.status).toBe('damaged')
    const victim = f.plan.versions.find((v) => v.partNo === 2 && v.kind === 'file')!.entryPath
    const w = new ZipWriter(); for (const e of readZip(await bytesOf(m.saved.get(n)!))) w.add(e.path, e.path === victim ? enc.encode('مزوَّر') : e.data)
    const t = await bytesOf(w.finish())
    const r2 = await verifyArchiveSet([new File([t as unknown as BlobPart], n) as NamedBlob], [{ no: 2, filename: n, sha256: await sha(t), sizeBytes: t.length }], b.entriesDigest, sha)
    expect(r2.parts[0]!.status).toBe('damaged')
  })
  it('جزء آخر مُسمّى باسم جزء صحيح ⇒ تالف؛ ملف زائد غير معروف يُذكر ولا يُفشل', async () => {
    const { m, b } = await buildSet({ targetBytes: 600 });
    const n = b.parts[1]!.filename; const files = asFiles(m.saved).filter((x) => x.name !== n)
    files.push(new File([m.saved.get(b.parts[2]!.filename)!], n) as NamedBlob, new File([new Uint8Array([1])], 'notes.txt') as NamedBlob)
    const r = await verifyArchiveSet(files, expectedOf(b), b.entriesDigest, sha)
    expect(r.parts[1]!.status).toBe('damaged'); expect(r.unexpected).toEqual(['notes.txt'])
    const ok = await verifyArchiveSet([...asFiles(m.saved), new File([new Uint8Array([1])], 'notes.txt') as NamedBlob], expectedOf(b), b.entriesDigest, sha)
    expect(ok.ok).toBe(true); expect(ok.unexpected).toEqual(['notes.txt'])
  })
  it('ملخّص محتوى مختلف عن المسجَّل ⇒ يفشل', async () => {
    const { m, b } = await buildSet({ targetBytes: 600 })
    const r = await verifyArchiveSet(asFiles(m.saved), expectedOf(b), 'b'.repeat(64), sha)
    expect(r.ok).toBe(false); expect(r.checks.find((c) => c.check === 'entries_digest_matches_registered')?.ok).toBe(false)
  })
})

describe('النسخة الثانية — تحقق بالبصمة (shaOnly)', () => {
  it('نسخة مطابقة ⇒ ok؛ جزء ناقص أو مغيَّر بايت ⇒ لا يُقبل', async () => {
    const { m, b } = await buildSet({ targetBytes: 600 })
    const copy = new Map(m.saved)
    expect((await verifyArchiveSet(asFiles(copy), expectedOf(b), b.entriesDigest, sha, { shaOnly: true })).ok).toBe(true)
    const x = await bytesOf(copy.get(b.parts[0]!.filename)!); x[x.length - 1] = x[x.length - 1]! ^ 1; copy.set(b.parts[0]!.filename, new Blob([x as unknown as BlobPart]))
    const r = await verifyArchiveSet(asFiles(copy), expectedOf(b), b.entriesDigest, sha, { shaOnly: true })
    expect(r.parts[0]!.status).toBe('damaged'); expect(r.ok).toBe(false)
    copy.delete(b.parts[2]!.filename)
    expect((await verifyArchiveSet(asFiles(copy), expectedOf(b), b.entriesDigest, sha, { shaOnly: true })).parts[2]!.status).toBe('missing')
  })
})

describe('العارض المستقل (نسخة أثَر التفاعلية) — jsdom', () => {
  /** يحاكي استخراج الأجزاء `present` في مجلد واحد: يملأ ATHAR_PARTS كما تفعل ملفات parts/part-NN.js ثم يطلق فحص الأجزاء. */
  async function load(name = 'سارة', hash = '#/', opt: { targetBytes?: number; present?: number[] } = {}) {
    const f = fixture({ teacherName: name, ...(opt.targetBytes ? { targetBytes: opt.targetBytes } : {}) }); const m = memSink(); const b = await buildYearArchive(opts(f, { sink: m.sink }))
    const z = new Map(readZip(await bytesOf(m.saved.get(b.parts[0]!.filename)!)).map((e) => [e.path, new TextDecoder().decode(e.data)]))
    const html = new DOMParser().parseFromString(z.get('index.html')!, 'text/html')
    document.body.innerHTML = html.body.innerHTML
    window.scrollTo = (() => {}) as typeof window.scrollTo
    location.hash = hash
    ;(window as unknown as { __x?: number; ATHAR_PARTS?: object }).__x = 0
    ;(window as unknown as { ATHAR_PARTS: Record<number, number> }).ATHAR_PARTS = Object.fromEntries((opt.present ?? b.parts.map((p) => p.no)).map((n) => [n, b.parts.length]))
    new Function(z.get('data.js')!)(); new Function(z.get('viewer.js')!)()
    window.dispatchEvent(new Event('athar-parts-check'))
    return { f, b, app: document.getElementById('app')! }
  }
  const go = (h: string) => { location.hash = h; window.dispatchEvent(new HashChangeEvent('hashchange')) }

  it('الرئيسية تعرض السنة والأعداد؛ المعلمات؛ صفحة المعلمة بفصليها وإصداراتها السابقة', async () => {
    const { app } = await load()
    expect(app.textContent).toContain('2026–2027'); expect(app.textContent).toContain('الفصل الأول')
    go('#/teachers'); expect(app.textContent).toContain('سارة'); expect(app.textContent).toContain('منى'); expect(app.textContent).toContain('غير نشطة')
    go(`#/teacher/${T1}`)
    expect(app.textContent).toContain('خطة الدرس'); expect(app.textContent).toContain('إصدار 2'); expect(app.textContent).toContain('إصدار 1')
    ;(app.querySelectorAll('.tabs button')[1] as HTMLButtonElement).click()
    expect(app.textContent).toContain('صورة.png')
  })
  it('أرشيف من 3 أجزاء مكتملة: يظهر كأرشيف واحد بلا تحذير، وصفحة «حول» تسرد الأجزاء كلها موجودة', async () => {
    const { app } = await load('سارة', '#/', { targetBytes: 600 })
    expect((document.getElementById('partsBanner') as HTMLElement).hidden).toBe(true)
    go('#/teachers'); expect(app.textContent).toContain('سارة'); expect(app.textContent).toContain('منى')
    go(`#/teacher/${T1}`); expect(app.textContent).toContain('إصدار 1'); expect(app.textContent).toContain('إصدار 2')
    go('#/about'); expect(app.textContent).toContain('عدد الأجزاء'); expect((app.textContent!.match(/موجود/g) ?? []).length).toBeGreaterThanOrEqual(3); expect(app.textContent).not.toContain('ناقص')
  })
  it('جزء ناقص في المجلد: لافتة حمراء باسم الجزء، والمعاينة تقول أين الملف، وما في الأجزاء الموجودة يعمل', async () => {
    const { app, f } = await load('سارة', '#/', { targetBytes: 600, present: [1, 3] })
    const banner = document.getElementById('partsBanner') as HTMLElement
    expect(banner.hidden).toBe(false); expect(banner.textContent).toContain('2'); expect(banner.textContent).toContain('ناقص')
    const v2 = f.plan.versions.find((v) => v.kind === 'file' && v.partNo === 2)!
    go(`#/teacher/${v2.teacherId}`)
    expect(app.textContent).toContain('خطة الدرس') // البيانات (الفهرس) من الجزء 1 تبقى ظاهرة
    ;(app.querySelector('table button') as HTMLButtonElement).click()
    expect(document.querySelector('.overlay')?.textContent).toContain('غير موجود في المجلد')
    go('#/about'); expect(app.textContent).toContain('ناقص')
  })
  it('حذف معلمة بعد الأرشفة (اختبار بيئة تجريبية فقط): الأرشيف المحلي المبني قبل الحذف يبقى يعرض اسمها وملفاتها وإصداراتها، وأرشيف ما بعد الحذف يعرض «معلمة محذوفة»', async () => {
    // قبل الحذف: نبني الأرشيف المقسَّم ونحفظ بصماته.
    const f = fixture({ teacherName: 'سارة', targetBytes: 600 }); const m = memSink(); const b = await buildYearArchive(opts(f, { sink: m.sink }))
    const before = await Promise.all([...m.saved].map(async ([n, bl]) => [n, await sha(await bytesOf(bl))] as const))
    // «الحذف» في المنصة الحية = إخفاء الاسم فقط (remove_teacher). لا يمسّ الأجزاء المحفوظة على الجهاز.
    const after = fixture({ teacherName: 'معلمة محذوفة', targetBytes: 600 })
    expect(after.plan.teachers[0]!.name).toBe('معلمة محذوفة')
    // الأجزاء المحفوظة لم تتغير بايتًا واحدًا وما زالت تتحقق كاملة.
    expect(await Promise.all([...m.saved].map(async ([n, bl]) => [n, await sha(await bytesOf(bl))] as const))).toEqual(before)
    expect((await verifyArchiveSet(asFiles(m.saved), expectedOf(b), b.entriesDigest, sha)).ok).toBe(true)
    // العارض المحلي المبني من الجزء 1 المحفوظ: اسم المعلمة الأصلي والملفات والإصدارات والمعاينة.
    const z = new Map(readZip(await bytesOf(m.saved.get(b.parts[0]!.filename)!)).map((e) => [e.path, new TextDecoder().decode(e.data)]))
    document.body.innerHTML = new DOMParser().parseFromString(z.get('index.html')!, 'text/html').body.innerHTML
    window.scrollTo = (() => {}) as typeof window.scrollTo; location.hash = '#/teachers'
    ;(window as unknown as { ATHAR_PARTS: Record<number, number> }).ATHAR_PARTS = Object.fromEntries(b.parts.map((p) => [p.no, b.parts.length]))
    new Function(z.get('data.js')!)(); new Function(z.get('viewer.js')!)(); window.dispatchEvent(new Event('athar-parts-check'))
    const app = document.getElementById('app')!
    expect(app.textContent).toContain('سارة'); expect(app.textContent).not.toContain('معلمة محذوفة')
    go(`#/teacher/${T1}`)
    expect(app.textContent).toContain('خطة الدرس'); expect(app.textContent).toContain('إصدار 1'); expect(app.textContent).toContain('إصدار 2')
    ;(app.querySelector('table button') as HTMLButtonElement).click()
    expect(document.querySelector('.overlay iframe')?.getAttribute('src')).toMatch(/^files\/t1\/.+\.pdf$/)
    expect(f.store.size).toBe(3) // الملفات الفعلية ما زالت داخل الأجزاء (تُقرأ أعلاه من ZIP لا من R2)
    for (const v of f.plan.versions.filter((x) => x.kind === 'file')) { const part = b.parts[v.partNo - 1]!; expect(readZip(await bytesOf(m.saved.get(part.filename)!)).some((e) => e.path === v.entryPath), v.entryPath).toBe(true) }
  })
  it('المعاينة: صورة وPDF وروابط', async () => {
    const { app } = await load(); go(`#/teacher/${T1}`)
    ;(app.querySelector('table button') as HTMLButtonElement).click()
    expect(document.querySelector('.overlay iframe')?.getAttribute('src')).toMatch(/^files\/t1\/.+\.pdf$/)
    ;(document.querySelector('.overlay .dlg-h button') as HTMLButtonElement).click(); expect(document.querySelector('.overlay')).toBeNull()
    ;(app.querySelectorAll('.tabs button')[1] as HTMLButtonElement).click()
    ;(app.querySelector('table button') as HTMLButtonElement).click()
    expect(document.querySelector('.overlay img')?.getAttribute('src')).toMatch(/^files\/t2\/.+\.png$/)
  })
  it('البحث عن معلمة وعن ملف (مع تطبيع الألف والتشكيل)', async () => {
    const { app } = await load()
    go('#/search/' + encodeURIComponent('سارَة')); expect(app.textContent).toContain('سارة')
    go('#/search/' + encodeURIComponent('صوره')); expect(app.textContent).toContain('صورة.png')
    go('#/search/' + encodeURIComponent('لاشيء')); expect(app.textContent).toContain('لا نتائج')
  })
  it('بيانات خبيثة في الاسم تُعرض نصًا ولا تُنفَّذ (لا innerHTML)', async () => {
    const evil = '<img src=x onerror="window.__x=1"><script>window.__x=2</script>'
    const { app } = await load(evil); go('#/teachers')
    expect(app.textContent).toContain(evil); expect(app.querySelector('img')).toBeNull(); expect((window as unknown as { __x: number }).__x).toBe(0)
  })
  it('للقراءة فقط: لا حقول إدخال ولا أزرار تعديل أو حذف سوى البحث', async () => {
    const { app } = await load(); go(`#/teacher/${T1}`)
    expect(document.querySelectorAll('input:not(#q)').length).toBe(0)
    expect(/حذف|تعديل|استبدال/.test(app.textContent ?? '')).toBe(false)
  })
})

describe('الأرشيف = نسخة أثَر للقراءة فقط', () => {
  const app = [{ path: 'index.html', data: enc.encode('<html>app</html>') }, { path: 'app.js', data: enc.encode('//js') }, { path: 'app.css', data: enc.encode('/*css*/') }]
  it('مع loadApp: يدخل index.html وapp.js وapp.css بدل العارض المبسّط، ويمرّ التحقق', async () => {
    const { m, b } = await buildSet({}, { loadApp: async () => app })
    const z = new Map(readZip(await bytesOf(m.saved.get(b.parts[0]!.filename)!)).map((e) => [e.path, e.data]))
    for (const p of ['index.html', 'app.js', 'app.css', 'data.js']) expect(z.has(p), p).toBe(true)
    expect(z.has('viewer.js')).toBe(false)
    expect(new TextDecoder().decode(z.get('index.html')!)).toBe('<html>app</html>')
    const rep = await verifyArchiveSet(asFiles(m.saved), expectedOf(b), b.entriesDigest, sha)
    expect(rep.ok, JSON.stringify(rep.checks.filter((c) => !c.ok))).toBe(true)
  })
  it('فشل تحميل النسخة أو نقص ملف منها ⇒ لا أرشيف (فشل مغلق)', async () => {
    const f1 = fixture(); await expect(buildYearArchive(opts(f1, { loadApp: async () => { throw new Error('x') } }))).rejects.toMatchObject({ code: 'app_missing' })
    const f2 = fixture(); await expect(buildYearArchive(opts(f2, { loadApp: async () => app.slice(0, 2) }))).rejects.toMatchObject({ code: 'app_missing' })
  })
  it('مصدر الأرشيف يقرأ البيانات ويرفض كل أمر كتابة', async () => {
    const { createArchiveRepository } = await import('../archive/archiveRepository')
    const D = { format: 'f', createdAt: '2027-06-20T10:00:00Z', entriesDigest: 'd', year: { id: 'y', label: '2026-2027' },
      terms: [{ id: 't1', name: 'الأول', ord: 1, deadlineBase: '2026-10-01', deadlineLate: '2026-10-10', deadlineReplace: '2026-10-20' }],
      teachers: [{ id: 'u1', name: 'أ', subject: 'ع', active: false, colorIdx: 3, removedAt: '2027-01-01', credential: null }], slots: [], totals: { teachers: 1, terms: 1, submissions: 1, versions: 1, files: 1, links: 0 },
      versions: [{ id: 'v1', teacherId: 'u1', termId: 't1', slotId: 's1', no: 1, kind: 'file' as const, name: 'a.pdf', size: 5, sha: 'h', url: null, submittedAt: '2026-10-02T00:00:00Z', status: 'late', replacedNote: null, path: 'files/a.pdf', part: 1 }] }
    const r = createArchiveRepository(D); const s = r.getSnapshot()
    expect(s.teachers[0]).toMatchObject({ active: true, codeState: 'revoked' }); expect(s.teachers[0]!.name).toContain('محذوفة')
    expect(s.submissions[0]!.versions[0]).toMatchObject({ storageKey: 'files/a.pdf', status: 'late', fileName: 'a.pdf' })
    expect(s.load.phase).toBe('ready'); expect(s.archives).toEqual([]); expect(s.audit).toEqual([])
    await expect(r.submit({ teacherId: 'u1', termId: 't1', slotId: 's1', kind: 'link', url: 'https://x.y' })).rejects.toThrow('للقراءة فقط')
    await expect(r.deleteArchive('a', 'b')).rejects.toThrow('للقراءة فقط'); await expect(r.updateTeacher('u1', { name: 'x' })).rejects.toThrow()
  })
})
