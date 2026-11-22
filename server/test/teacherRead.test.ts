// @vitest-environment node
// اختبار منطق خدمة القراءة وخدمة النقل بصفوف وقاعدة بديلة (لا SQL حقيقي). ما يُثبت: المواعيد المستقلة لكل فصل، الاستبدال، حجب المفاتيح، تفويض التنزيل.
import { describe, it, expect } from 'vitest'
import { assemble, TeacherReadService } from '../services/teacherReadService'
import { TransferService } from '../services/transferService'
import type { Presigner } from '../services/transferService'
import { ServiceError } from '../services/errors'
import type { Db } from '../db/types'

const T = '00000000-0000-0000-0000-000000000001'
const OTHER = '00000000-0000-0000-0000-000000000002'
const teacher = { id: T, name: 'معلمة', subject: 'علوم' }
// فصل 1: مواعيده قديمة (مغلق)؛ فصل 2: مواعيده مختلفة ومفتوحة. الزمن = 2026-10-24 (بتوقيت عُمان).
const terms = [
  { id: 'term-1', name: 'الأول', ord: 1, base: '2026-09-01', late: '2026-09-15', replace: '2026-09-30' },
  { id: 'term-2', name: 'الثاني', ord: 2, base: '2026-10-20', late: '2026-10-30', replace: '2026-11-15' },
]
const slots = [{ id: 'plan', title: 'خطة', optional: false, ord: 1 }, { id: 'extra', title: 'داعم', optional: true, ord: 2 }]
const ver = (o: Partial<Parameters<typeof assemble>[4][number]>) => ({ id: 'v', term_id: 'term-2', slot_id: 'plan', no: 1, kind: 'file', original_name: 'a.pdf', size_bytes: '10', ext: 'pdf', url: null, status_snapshot: 'on_time', submitted_at: '2026-10-10T00:00:00.000Z', storage_state: 'present', ...o })
const NOW = '2026-10-24T08:00:00.000Z'

describe('assemble — السنة وعدد البنود (r37: لا صفحة فارغة صامتة)', () => {
  it('بلا سنة ⇒ year=null وبلا فصول؛ ومع سنة ⇒ تُعاد مع slotsCount', () => {
    const none = assemble(NOW, teacher, [], [], [], null)
    expect(none.year).toBeNull(); expect(none.terms).toEqual([]); expect(none.slotsCount).toBe(0)
    const p = assemble(NOW, teacher, terms, slots, [], { id: 'y1', label: '2026-2027' })
    expect(p.year).toEqual({ id: 'y1', label: '2026-2027' }); expect(p.slotsCount).toBe(slots.length)
  })
})

describe('assemble — المواعيد المستقلة لكل فصل', () => {
  it('كل فصل يحكم بمواعيده: الأول مغلق، الثاني (بعد الأساسي) في نافذة التأخر', () => {
    const p = assemble(NOW, teacher, terms, slots, [])
    expect(p.terms.map((t) => t.phase)).toEqual(['closed', 'late_window'])
    expect(p.terms[0]!.slots.map((s) => [s.gate, s.canSubmit])).toEqual([['closed', false], ['closed', false]])
    expect(p.terms[1]!.slots.map((s) => [s.gate, s.canSubmit])).toEqual([['late', true], ['late', true]])
  })
  it('تغيير موعد فصل لا يمس الآخر', () => {
    const moved = terms.map((t) => (t.id === 'term-1' ? { ...t, base: '2026-12-01', late: '2026-12-10', replace: '2026-12-20' } : t))
    const p = assemble(NOW, teacher, moved, slots, [])
    expect(p.terms.map((t) => t.phase)).toEqual(['before_base', 'late_window'])
  })
  it('الاستبدال: خانة بإصدار تبقى قابلة للاستبدال حتى موعد استبدال فصلها، وحالتها حالة أول إصدار', () => {
    const p = assemble(NOW, teacher, terms, slots, [ver({ status_snapshot: 'on_time' }), ver({ id: 'v2', no: 2, status_snapshot: 'late' })])
    const s = p.terms[1]!.slots[0]!
    expect([s.state, s.canReplace, s.canSubmit, s.versions.length]).toEqual(['on_time', true, false, 2])
  })
  it('بعد موعد الاستبدال: لا استبدال، وفصل آخر بإصدار مفتوح الاستبدال لا يتأثر', () => {
    const p = assemble('2026-12-01T00:00:00.000Z', teacher, terms, slots, [ver({ term_id: 'term-1' }), ver({ id: 'w', term_id: 'term-2' })])
    expect(p.terms[0]!.slots[0]!.canReplace).toBe(false); expect(p.terms[1]!.slots[0]!.canReplace).toBe(false)
    const p2 = assemble('2026-11-10T00:00:00.000Z', teacher, terms, slots, [ver({ term_id: 'term-1' }), ver({ id: 'w', term_id: 'term-2' })])
    expect([p2.terms[0]!.slots[0]!.canReplace, p2.terms[1]!.slots[0]!.canReplace]).toEqual([false, true])
  })
  it('نهاية يوم الموعد بتوقيت عُمان: 23:59 محلي لا تزال ضمن اليوم، وبعدها دقيقة مغلقة', () => {
    const one = [{ id: 't', name: 'x', ord: 1, base: '2026-10-24', late: '2026-10-24', replace: '2026-10-24' }]
    expect(assemble('2026-10-24T19:59:00.000Z', teacher, one, slots, []).terms[0]!.slots[0]!.canSubmit).toBe(true) // 23:59 عُمان
    expect(assemble('2026-10-24T20:00:30.000Z', teacher, one, slots, []).terms[0]!.slots[0]!.canSubmit).toBe(false) // 00:00:30 اليوم التالي
  })
  it('لا مفاتيح تخزين ولا بصمة في الناتج؛ رابط الرابط يبقى، وملف محذوف مؤرشف غير قابل للتنزيل', () => {
    const p = assemble(NOW, teacher, terms, slots, [ver({}), ver({ id: 'l', no: 2, kind: 'link', original_name: null, size_bytes: null, ext: null, url: 'https://x.example' }), ver({ id: 'd', no: 3, storage_state: 'deleted_archived' })])
    const json = JSON.stringify(p)
    expect(json).not.toMatch(/storage|pending|sha256|bucket/i)
    const vs = p.terms[1]!.slots[0]!.versions
    expect(vs.map((v) => [v.kind, v.downloadable])).toEqual([['file', true], ['link', false], ['file', false]])
  })
  it('الخانة الاختيارية غير المسلَّمة لا تُعدّ نقصًا هنا (state=missing فقط) وتحتفظ بعلم optional', () => {
    const s = assemble(NOW, teacher, terms, slots, []).terms[1]!.slots[1]!
    expect([s.state, s.optional]).toEqual(['missing', true])
  })
})

const mkDb = (rows: (sql: string) => unknown[]): Db => ({ async transaction(fn) { return fn({ query: async (sql: string) => rows(sql) as never, exec: async () => {} }) }, async close() {} })
describe('TeacherReadService.portfolio (قاعدة بديلة)', () => {
  it('يركّب من الصفوف؛ معلمة غير موجودة ⇒ not_found؛ معرّف مشوّه ⇒ bad_request', async () => {
    const dbOf = (hasTeacher: boolean) => mkDb((sql) => sql.includes('as now') ? [{ now: NOW }] : sql.includes('from public.teachers') ? (hasTeacher ? [teacher] : []) : sql.includes('from public.terms') ? terms : sql.includes('from public.slots') ? slots : [])
    expect((await new TeacherReadService({ db: dbOf(true) }).portfolio(T)).terms.length).toBe(2)
    const code = async (fn: () => Promise<unknown>) => { try { await fn() } catch (e) { return e instanceof ServiceError ? e.code : 'other' } return null }
    expect(await code(() => new TeacherReadService({ db: dbOf(false) }).portfolio(T))).toBe('not_found')
    expect(await code(() => new TeacherReadService({ db: dbOf(true) }).portfolio('x'))).toBe('bad_request')
  })
  it('الاستعلامات لا تختار أعمدة المفاتيح السرية (فحص نصي للـSQL)', async () => {
    const seen: string[] = []
    const db = mkDb((sql) => { seen.push(sql); return sql.includes('as now') ? [{ now: NOW }] : sql.includes('from public.teachers') ? [teacher] : [] })
    await new TeacherReadService({ db }).portfolio(T)
    expect(seen.join(' ')).not.toMatch(/storage_key|storage_bucket|pending_key|sha256/)
  })
})

const signer: Presigner = {
  presignPut: (key, o) => ({ url: `https://put.example/${key}?ttl=${o.ttlSec}`, method: 'PUT', headers: { 'content-length': String(o.sizeBytes) } }),
  presignGet: (key, o) => ({ url: `https://get.example/${key}?ttl=${o.ttlSec}${o.inline ? '&inline=1' : ''}`, expiresAt: new Date('2026-10-24T08:01:00Z') }),
}
describe('TransferService (قاعدة بديلة)', () => {
  const sessRow = (o: Record<string, unknown> = {}) => ({ state: 'started', pending_key: 'pending/k1', declared_size: '2048', secs_left: 5000, ...o })
  const svc = (rows: unknown[]) => new TransferService({ db: mkDb(() => rows), signer })
  const code = async (fn: () => Promise<unknown>) => { try { await fn() } catch (e) { return e instanceof ServiceError ? e.code : 'other' } return null }
  const S = '00000000-0000-0000-0000-0000000000b1'
  it('رابط الرفع: مدته min(المتبقي، 900) وحجمه المعلن، ولا يظهر المفتاح الخام في الاستجابة', async () => {
    const r = await svc([sessRow()]).presignUpload(S, T)
    expect(r.url).toContain('ttl=900'); expect(r.headers['content-length']).toBe('2048'); expect(Object.keys(r)).toEqual(['url', 'method', 'headers', 'expiresAt'])
    expect((await svc([sessRow({ secs_left: 40 })]).presignUpload(S, T)).url).toContain('ttl=40')
  })
  it('جلسة غير موجودة/غير مملوكة ⇒ not_found؛ غير started أو منتهية ⇒ session_closed؛ معرّف مشوّه ⇒ bad_request', async () => {
    expect(await code(() => svc([]).presignUpload(S, T))).toBe('not_found')
    for (const o of [{ state: 'uploaded' }, { state: 'expired' }, { secs_left: 0 }, { pending_key: null }]) expect(await code(() => svc([sessRow(o)]).presignUpload(S, T))).toBe('session_closed')
    expect(await code(() => svc([sessRow()]).presignUpload('x', T))).toBe('bad_request')
  })
  const V = '00000000-0000-0000-0000-0000000000c1'
  const verRow = (o: Record<string, unknown> = {}) => ({ teacher_id: T, kind: 'file', original_name: 'خطة.pdf', ext: 'pdf', storage_key: 'files/k', storage_state: 'present', ...o })
  it('تنزيل: المعلمة لملفها، والمالكة والمديرة لأي ملف', async () => {
    expect((await svc([verRow()]).authorizeDownload(V, { kind: 'teacher', teacherId: T })).url).toContain('ttl=60')
    for (const role of ['owner', 'director'] as const) expect((await svc([verRow()]).authorizeDownload(V, { kind: 'staff', role })).filename).toBe('خطة.pdf')
  })
  it('معاينة (r41): رابط inline لـ PDF والصور فقط وبمدة 300 ث؛ غيرها (docx/svg/html) ⇒ bad_request، والتنزيل العادي كما هو', async () => {
    const a = await svc([verRow()]).authorizeDownload(V, { kind: 'staff', role: 'director' }, { inline: true })
    expect(a.url).toContain('ttl=300'); expect(a.url).toContain('inline=1')
    for (const ext of ['png', 'jpg', 'jpeg', 'gif', 'webp']) expect((await svc([verRow({ ext })]).authorizeDownload(V, { kind: 'staff', role: 'owner' }, { inline: true })).url).toContain('inline=1')
    for (const ext of ['svg', 'html', 'zip']) expect(await code(() => svc([verRow({ ext })]).authorizeDownload(V, { kind: 'staff', role: 'owner' }, { inline: true }))).toBe('bad_request')
    for (const ext of ['docx', 'pptx', 'xlsx']) { const o = await svc([verRow({ ext })]).authorizeDownload(V, { kind: 'staff', role: 'owner' }, { inline: true }); expect(o.url).toContain('ttl=600'); expect(o.url).toContain('inline=1') }
    const plain = await svc([verRow()]).authorizeDownload(V, { kind: 'staff', role: 'owner' })
    expect(plain.url).toContain('ttl=60'); expect(plain.url).not.toContain('inline')
    // الملف غير المملوك للمعلمة يبقى not_found حتى بالمعاينة
    expect(await code(() => svc([verRow({ teacher_id: OTHER })]).authorizeDownload(V, { kind: 'teacher', teacherId: T }, { inline: true }))).toBe('not_found')
  })
  it('تنزيل ملف معلمة أخرى ⇒ not_found (لا كشف)، والرابط/المحذوف/بلا مفتاح ⇒ not_found', async () => {
    expect(await code(() => svc([verRow({ teacher_id: OTHER })]).authorizeDownload(V, { kind: 'teacher', teacherId: T }))).toBe('not_found')
    for (const o of [{ kind: 'link' }, { storage_state: 'deleted_archived' }, { storage_key: null }, { ext: null }]) expect(await code(() => svc([verRow(o)]).authorizeDownload(V, { kind: 'staff', role: 'owner' }))).toBe('not_found')
    expect(await code(() => svc([]).authorizeDownload(V, { kind: 'staff', role: 'owner' }))).toBe('not_found')
    expect(await code(() => svc([verRow()]).authorizeDownload('nope', { kind: 'staff', role: 'owner' }))).toBe('bad_request')
  })
})
