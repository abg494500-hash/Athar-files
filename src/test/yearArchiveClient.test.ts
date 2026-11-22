// عميل الأرشيف السنوي (A-115) بخادم وR2 بديلين في الذاكرة: التدفق الكامل (خطة ← بناء ← تسجيل ← تحقق من الملف المحفوظ ← تأكيد البصمة) ورموز الفشل.
import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { createStaffApiClient, staffMessage } from '../lib/staffApi/client'
import { entriesDigestText, linkEntryText, versionEntryPath } from '../lib/yearArchive/paths'
import type { YearPlan } from '../lib/yearArchive/types'
import type { NamedBlob } from '../lib/yearArchive/verify'

const sha256 = async (d: Uint8Array) => createHash('sha256').update(d).digest('hex')
const H = (s: string | Uint8Array) => createHash('sha256').update(s).digest('hex')
const YEAR = '00000000-0000-0000-0000-0000000000ff', T = '00000000-0000-0000-0000-000000000001', TERM = '00000000-0000-0000-0000-0000000000a1'
const V1 = '00000000-0000-0000-0000-00000000c001', V2 = '00000000-0000-0000-0000-00000000c002'
const fileBytes = new TextEncoder().encode('%PDF محتوى الملف')
const text = linkEntryText('https://example.com/e')

function plan(over: Partial<YearPlan> = {}): YearPlan {
  const versions: YearPlan['versions'] = [
    { id: V1, teacherId: T, termId: TERM, termOrd: 1, slotId: 's1', no: 1, kind: 'file', originalName: 'a.pdf', sizeBytes: fileBytes.length, mime: 'application/pdf', ext: 'pdf', sha256: H(fileBytes), url: null, partNo: 1, submittedAt: '2026-10-01T00:00:00Z', status: 'on_time', deadlines: {}, replacedNote: null, entrySize: fileBytes.length, entrySha256: H(fileBytes), entryPath: versionEntryPath({ id: V1, termOrd: 1, teacherId: T, slotId: 's1', no: 1, kind: 'file', ext: 'pdf', originalName: 'a.pdf' }) },
    { id: V2, teacherId: T, termId: TERM, termOrd: 1, slotId: 's2', no: 1, kind: 'link', originalName: null, sizeBytes: null, mime: null, ext: null, sha256: null, url: 'https://example.com/e', partNo: 1, submittedAt: '2026-10-02T00:00:00Z', status: 'late', deadlines: {}, replacedNote: null, entrySize: new TextEncoder().encode(text).length, entrySha256: H(text), entryPath: versionEntryPath({ id: V2, termOrd: 1, teacherId: T, slotId: 's2', no: 1, kind: 'link', ext: null, originalName: null }) },
  ]
  return {
    year: { id: YEAR, label: '2026-2027', active: true, createdAt: '2026-09-01T00:00:00Z' }, terms: [{ id: TERM, name: 'الفصل الأول', ord: 1, deadlineBase: '2026-11-01', deadlineLate: '2026-11-10', deadlineReplace: '2026-11-20' }],
    teachers: [{ id: T, name: 'سارة', subject: 'علوم', active: true, colorIdx: 0, createdAt: '2026-09-01T00:00:00Z', removedAt: null, credential: null }], slots: [{ id: 's1', title: 'أساسي', optional: false, ord: 1 }, { id: 's2', title: 'داعم', optional: true, ord: 2 }],
    submissions: [], versions, problems: [], totals: { teachers: 1, terms: 1, submissions: 0, versions: 2, files: 1, links: 1, fileBytes: fileBytes.length },
    layout: { targetBytes: 200_000_000, parts: [{ no: 1, entries: 2, bytes: versions.reduce((n, v) => n + v.entrySize, 0) }] },
    entriesDigest: H(entriesDigestText(versions.map((v) => ({ id: v.id, sha256: v.entrySha256, part: 1 })))), ...over,
  }
}

function mk(o: { plan?: YearPlan; r2?: Map<string, Uint8Array>; routes?: Record<string, { status: number; json?: unknown }> } = {}) {
  const calls: { path: string; body: Record<string, unknown> }[] = []
  const r2 = o.r2 ?? new Map([[V1, fileBytes]])
  const f = (async (url: string, init: RequestInit) => {
    const u = new URL(url)
    if (u.host === 'r2.example') { const d = r2.get(u.pathname.slice(1)); return d ? new Response(d as unknown as BodyInit, { status: 200 }) : new Response('x', { status: 404 }) }
    const path = u.pathname.replace('/fn', ''); const body = init.body ? JSON.parse(String(init.body)) : {}
    calls.push({ path, body })
    if (o.routes?.[path]) return new Response(JSON.stringify(o.routes[path]!.json ?? {}), { status: o.routes[path]!.status })
    if (path === '/owner/year-archive/plan') return new Response(JSON.stringify({ plan: o.plan ?? plan() }), { status: 200 })
    if (path === '/owner/year-archive/urls') return new Response(JSON.stringify({ urls: (body.versionIds as string[]).map((id) => ({ versionId: id, url: `https://r2.example/${id}` })) }), { status: 200 })
    if (path === '/owner/year-archive/register') return new Response(JSON.stringify({ archive: { id: 'A1', entries: 2, files: 1, links: 1, sizeBytes: 1, sha256: 'x', parts: (body.parts as unknown[]).length } }), { status: 200 })
    if (path.endsWith('/confirm-part') || path.endsWith('/confirm-copy')) return new Response(JSON.stringify({ ok: true }), { status: 200 })
    return new Response('{}', { status: 200 })
  }) as unknown as typeof fetch
  return { c: createStaffApiClient({ baseUrl: 'https://api.example.org/fn', getToken: async () => 'tok.en.value-xxxx', fetchImpl: f, sha256 }), calls }
}

const sinkOf = () => { const saved = new Map<string, Blob>(); return { saved, sink: { savePart: async (p: { filename: string; blob: Blob }) => { saved.set(p.filename, p.blob) } } } }
const stat = (b: { parts: { no: number; filename: string; sha256: string; size: number; entries: number }[]; entriesDigest: string }) => ({ id: 'A1', entriesDigest: b.entriesDigest, parts: b.parts.map((p) => ({ no: p.no, filename: p.filename, sha256: p.sha256, sizeBytes: p.size, entries: p.entries, verified: false, copyVerified: false, copyMedium: null })) })
const files = (m: Map<string, Blob>) => [...m].map(([n, b]) => new File([b], n) as NamedBlob)

describe('عميل الأرشيف السنوي (أجزاء)', () => {
  it('التدفق الكامل: خطة ← بناء ← تسجيل (بصمات فقط) ← تحقق الأجزاء المحفوظة ← تأكيد كل جزء لدى الخادم', async () => {
    const { c, calls } = mk(); const { saved, sink } = sinkOf()
    const b = await c.buildYearArchive(YEAR, { sink })
    expect(b.ok).toBe(true); if (!b.ok) return
    expect(calls.find((x) => x.path.endsWith('/plan'))!.body).toEqual({ yearId: YEAR, targetBytes: 200_000_000 })
    const reg = await c.registerYearArchive({ yearId: YEAR, title: 'أرشيف', build: b.value.build })
    expect(reg).toMatchObject({ ok: true, value: { id: 'A1' } })
    const sent = calls.find((x) => x.path === '/owner/year-archive/register')!.body
    expect(Object.keys(sent).sort()).toEqual(['entriesDigest', 'parts', 'targetBytes', 'title', 'yearId'])
    expect(sent.entriesDigest).toBe(b.value.build.entriesDigest)
    const parts = sent.parts as { no: number; sha256: string }[]; expect(parts[0]).toMatchObject({ no: 1, sha256: b.value.build.parts[0]!.sha256 })
    const v = await c.verifyAndConfirmSavedParts({ archive: stat(b.value.build), files: files(saved) })
    expect(v).toMatchObject({ ok: true, value: { ok: true } })
    expect(calls.filter((x) => x.path === '/owner/year-archive/confirm-part').map((x) => x.body)).toEqual([{ archiveId: 'A1', partNo: 1, sha256: b.value.build.parts[0]!.sha256 }])
  })
  it('جزء محفوظ تالف: التقرير فاشل، والخادم يستلم البصمة المحسوبة (المختلفة) لا المسجَّلة', async () => {
    const { c, calls } = mk(); const { saved, sink } = sinkOf()
    const b = await c.buildYearArchive(YEAR, { sink }); if (!b.ok) throw new Error('x')
    const n = b.value.build.parts[0]!.filename; const raw = new Uint8Array(await saved.get(n)!.arrayBuffer()); raw[70] = raw[70]! ^ 1; saved.set(n, new Blob([raw as unknown as BlobPart]))
    const v = await c.verifyAndConfirmSavedParts({ archive: stat(b.value.build), files: files(saved) })
    expect(v).toMatchObject({ ok: true, value: { ok: false } })
    expect(calls.filter((x) => x.path.endsWith('/confirm-part'))[0]!.body.sha256).not.toBe(b.value.build.parts[0]!.sha256)
  })
  it('جزء ناقص: لا يُرسل أي تأكيد، والتقرير يسمّي الجزء الناقص', async () => {
    const { c, calls } = mk(); const { sink } = sinkOf()
    const b = await c.buildYearArchive(YEAR, { sink }); if (!b.ok) throw new Error('x')
    const v = await c.verifyAndConfirmSavedParts({ archive: stat(b.value.build), files: [] })
    expect(v).toMatchObject({ ok: true, value: { ok: false, parts: [{ no: 1, status: 'missing' }] } })
    expect(calls.some((x) => x.path.endsWith('/confirm-part'))).toBe(false)
  })
  it('النسخة الثانية: تُرسل البصمة المحسوبة مع نوع الوسيط؛ ونسخة تالفة لا تُقبل', async () => {
    const { c, calls } = mk(); const { saved, sink } = sinkOf()
    const b = await c.buildYearArchive(YEAR, { sink }); if (!b.ok) throw new Error('x')
    const ok = await c.verifyAndConfirmSecondCopy({ archive: stat(b.value.build), files: files(saved), medium: 'external_drive', independent: true })
    expect(ok).toMatchObject({ ok: true, value: { ok: true } })
    expect(calls.filter((x) => x.path.endsWith('/confirm-copy'))[0]!.body).toEqual({ archiveId: 'A1', partNo: 1, sha256: b.value.build.parts[0]!.sha256, medium: 'external_drive', independent: true })
    const n = b.value.build.parts[0]!.filename; const raw = new Uint8Array(await saved.get(n)!.arrayBuffer()); raw[5] = raw[5]! ^ 1; saved.set(n, new Blob([raw as unknown as BlobPart]))
    expect(await c.verifyAndConfirmSecondCopy({ archive: stat(b.value.build), files: files(saved), medium: 'usb_flash', independent: true })).toMatchObject({ ok: true, value: { ok: false } })
  })
  it('فشل بناء: ملف ناقص أو تالف أو غير قابل للتنزيل ⇒ رموز year_* برسائل عربية، ولا طلب تسجيل', async () => {
    const a = mk({ r2: new Map([[V1, fileBytes.slice(0, 3)]]) }); const ra = await a.c.buildYearArchive(YEAR, { sink: sinkOf().sink })
    expect(ra).toMatchObject({ ok: false, code: 'year_source_mismatch' }); if (!ra.ok) expect(staffMessage(ra)).toMatch(/لا يطابق/)
    expect(a.calls.some((x) => x.path.endsWith('/register'))).toBe(false)
    expect(await mk({ r2: new Map() }).c.buildYearArchive(YEAR, { sink: sinkOf().sink })).toMatchObject({ ok: false, code: 'year_fetch_failed' })
    expect(await mk({ plan: plan({ problems: [{ versionId: V1, reason: 'file_not_present' }] }) }).c.buildYearArchive(YEAR, { sink: sinkOf().sink })).toMatchObject({ ok: false, code: 'files_missing' })
    const ts = await mk({ plan: plan({ problems: [{ versionId: 'x', reason: 'too_many_parts' }] }) }).c.buildYearArchive(YEAR, { sink: sinkOf().sink })
    expect(ts).toMatchObject({ ok: false, code: 'year_too_many_parts' }); if (!ts.ok) expect(staffMessage(ts)).toMatch(/60/)
  })
  it('فشل حفظ جزء على الجهاز ⇒ year_save_failed برسالة، ولا تسجيل', async () => {
    const { c, calls } = mk()
    const r = await c.buildYearArchive(YEAR, { sink: { savePart: async () => { throw new Error('disk full') } } })
    expect(r).toMatchObject({ ok: false, code: 'year_save_failed' }); if (!r.ok) expect(staffMessage(r)).toMatch(/تعذّر حفظ/)
    expect(calls.some((x) => x.path.endsWith('/register'))).toBe(false)
  })
  it('فشل الخادم في الخطة أو التسجيل ⇒ رمز الخادم برسالة واضحة', async () => {
    expect(await mk({ routes: { '/owner/year-archive/plan': { status: 403, json: { error: 'forbidden' } } } }).c.buildYearArchive(YEAR, { sink: sinkOf().sink })).toEqual({ ok: false, error: 'forbidden', code: 'forbidden' })
    const { c } = mk({ routes: { '/owner/year-archive/register': { status: 409, json: { error: 'year_changed' } } } })
    const b = await c.buildYearArchive(YEAR, { sink: sinkOf().sink }); if (!b.ok) throw new Error('x')
    const r = await c.registerYearArchive({ yearId: YEAR, title: 't', build: b.value.build })
    expect(r).toMatchObject({ ok: false, code: 'year_changed' }); if (!r.ok) expect(staffMessage(r)).toMatch(/تغيّرت بيانات السنة/)
  })
  it('انقطاع الشبكة أثناء تنزيل ملف ⇒ لا أرشيف (fetch_failed)', async () => {
    const f2 = createStaffApiClient({ baseUrl: 'https://api.example.org/fn', getToken: async () => 't.t.t-tttttt', sha256, fetchImpl: (async (url: string, init: RequestInit) => { if (String(url).includes('r2.example')) throw new TypeError('network'); const p = new URL(url).pathname.replace('/fn', ''); const body = JSON.parse(String(init.body)); return new Response(JSON.stringify(p.endsWith('plan') ? { plan: plan() } : { urls: (body.versionIds as string[]).map((id) => ({ versionId: id, url: `https://r2.example/${id}` })) }), { status: 200 }) }) as unknown as typeof fetch })
    expect(await f2.buildYearArchive(YEAR, { sink: sinkOf().sink })).toMatchObject({ ok: false, code: 'year_fetch_failed' })
  })
})
