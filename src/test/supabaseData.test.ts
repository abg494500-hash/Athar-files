import { describe, it, expect } from 'vitest'
import { createAuthController } from '../lib/auth/controller'
import { checkPublicEnv } from '../lib/supabase/env'
import { createSupabaseRepository, createUnavailableRepository } from '../data/supabase/supabaseRepository'
import { deriveCurrentTermId, mapArchive, mapAudit, mapSubmissions, mapTeacher, mapTerm, mapVersion, mapYear, MappingError } from '../data/supabase/mappers'
import { UnavailableError, describeCommandError, describeLoadError } from '../data/errors'
import { makeBackend, type FakeAuthOpts } from './fakeBackend'

const NOW = Date.parse('2026-10-20T10:00:00+04:00')
const tick = () => new Promise((r) => setTimeout(r, 10))

const DATA: FakeAuthOpts['tables'] = {
  years: { rows: [{ id: 'y1', label: '2026–2027', is_active: true }] },
  terms: { rows: [
    { id: 't1', year_id: 'y1', name: 'الفصل الدراسي الأول', ord: 1, deadline_base: '2026-10-15', deadline_late: '2026-10-22', deadline_replace: '2026-11-06' },
    { id: 't2', year_id: 'y1', name: 'الفصل الدراسي الثاني', ord: 2, deadline_base: '2027-03-05', deadline_late: '2027-03-12', deadline_replace: '2027-03-26' },
  ] },
  teachers: { rows: [{ id: 'th1', name: 'معلمة أ', subject: 'علوم', is_active: true, color_idx: 2, created_at: '2026-09-01T00:00:00Z' }] },
  teacher_credentials: { rows: [{ teacher_id: 'th1', code_state: 'active', code_issued_at: '2026-09-02T00:00:00Z' }] },
  submissions: { rows: [{ teacher_id: 'th1', term_id: 't1', slot_id: 's1' }] },
  versions: { rows: [{ id: 'v1', teacher_id: 'th1', term_id: 't1', slot_id: 's1', no: 1, kind: 'link', original_name: null, size_bytes: null, sha256: null, url: 'https://example.com/a', submitted_at: '2026-10-10T08:00:00Z', status_snapshot: 'on_time', replaced_note: null }] },
  archives: { rows: [] },
  audit_log: { rows: [{ id: 5, at: '2026-10-11T08:00:00Z', actor_role: 'owner', action: 'term.deadlines.update', target_type: 'term', target_id: 't1', detail: { reason: 'عطلة' } }] },
}

async function authorizedRepo(extra: FakeAuthOpts = {}, role: 'owner' | 'director' = 'owner') {
  const b = makeBackend({ user: { id: 'u-1' }, profile: { role, is_active: true }, tables: DATA, ...extra })
  const auth = createAuthController(b)
  const repo = createSupabaseRepository(b, auth, { now: () => NOW, tickMs: null })
  await auth.start()
  await tick()
  return { b, auth, repo }
}

describe('إعداد الاتصال (لا أسرار في الواجهة)', () => {
  it('مفقود أو ناقص ⇒ رفض بسبب واضح', () => {
    expect(checkPublicEnv(undefined).ok).toBe(false)
    expect(checkPublicEnv({ VITE_SUPABASE_URL: 'https://abc.supabase.co' }).ok).toBe(false)
  })
  it('عنوان غير صالح ⇒ رفض', () => {
    expect(checkPublicEnv({ VITE_SUPABASE_URL: 'https://evil.example.com', VITE_SUPABASE_ANON_KEY: 'k' }).ok).toBe(false)
  })
  it('مفتاح عام صالح ⇒ قبول', () => {
    expect(checkPublicEnv({ VITE_SUPABASE_URL: 'https://abcdefgh.supabase.co', VITE_SUPABASE_ANON_KEY: 'sb_publishable_xxx' }).ok).toBe(true)
  })
  it('مفتاح سري حديث ⇒ رفض', () => {
    expect(checkPublicEnv({ VITE_SUPABASE_URL: 'https://abcdefgh.supabase.co', VITE_SUPABASE_ANON_KEY: 'sb_secret_xxx' }).ok).toBe(false)
  })
  it('JWT بدور service_role ⇒ رفض، وبدور anon ⇒ قبول', () => {
    const jwt = (role: string) => `h.${btoa(JSON.stringify({ role })).replace(/=+$/, '')}.s`
    expect(checkPublicEnv({ VITE_SUPABASE_URL: 'https://abcdefgh.supabase.co', VITE_SUPABASE_ANON_KEY: jwt('service_role') }).ok).toBe(false)
    expect(checkPublicEnv({ VITE_SUPABASE_URL: 'https://abcdefgh.supabase.co', VITE_SUPABASE_ANON_KEY: jwt('anon') }).ok).toBe(true)
  })
})

describe('المحوّلات (المخطط → الواجهة)', () => {
  it('سنة وفصل ومعلمة وإصدار', () => {
    expect(mapYear({ id: 'y', label: '2026–2027', is_active: true }).active).toBe(true)
    const t = mapTerm((DATA!.terms!.rows as Record<string, unknown>[])[0])
    expect(t.deadlines.replace).toBe('2026-11-06')
    expect(t.order).toBe(1)
    const th = mapTeacher((DATA!.teachers!.rows as Record<string, unknown>[])[0], undefined)
    expect(th.codeState).toBe('revoked') // بلا صف اعتماد ⇒ لا رمز
    const v = mapVersion((DATA!.versions!.rows as Record<string, unknown>[])[0])
    expect(v.kind).toBe('link')
    expect(v.sha256).toBe('')
    expect(v.status).toBe('on_time')
  })
  it('صيغة غير متوقعة ⇒ MappingError لا بيانات مشوّهة', () => {
    let thrown: unknown = null
    try { mapTerm({ id: 't', year_id: 'y', name: 'x', ord: 3, deadline_base: '2026-10-15', deadline_late: '2026-10-22', deadline_replace: '2026-11-06' }) } catch (e) { thrown = e }
    expect(thrown instanceof MappingError).toBe(true)
  })
  it('إصدار بلا تسليم مطابق ⇒ خطأ', () => {
    let thrown: unknown = null
    try { mapSubmissions([], [(DATA!.versions!.rows as Record<string, unknown>[])[0]]) } catch (e) { thrown = e }
    expect(thrown instanceof MappingError).toBe(true)
  })
  it('سجل العمليات: ترجمة الإجراء واسم الفصل والسبب', () => {
    const a = mapAudit((DATA!.audit_log!.rows as Record<string, unknown>[])[0], { termName: () => 'الفصل الأول — 2026–2027' })
    expect(a.action).toBe('تعديل مواعيد')
    expect(a.target).toBe('الفصل الأول — 2026–2027')
    expect(a.detail).toBe('السبب: عطلة')
    expect(a.actor).toBe('المالكة')
  })
  it('الأرشيف: sent مشتق، وchecks غير صالحة تُتجاهل', () => {
    const a = mapArchive({ id: 'a', title: 't', year_id: 'y', term_id: null, teacher_id: null, created_at: '2026-01-01T00:00:00Z', state: 'verified', size_bytes: '123', entries_count: 4, sha256: null, checks: [{ label: 'x', state: 'ok' }, { bad: 1 }], download_completed_at: '2026-01-02T00:00:00Z', download_hash_verified_at: null, backup_ack_at: null, backup_ack_note: null, deleted_at: null })
    expect(a.sizeBytes).toBe(123)
    expect(a.checks).toHaveLength(1)
    expect(a.sent).toBe(false)
  })
  it('الفصل الحالي يُشتق من المواعيد', () => {
    const years = [{ id: 'y1', label: 'a', active: true }]
    const terms = (DATA!.terms!.rows as Record<string, unknown>[]).map(mapTerm)
    expect(deriveCurrentTermId(years, terms, NOW)).toBe('t1')
    expect(deriveCurrentTermId(years, terms, Date.parse('2027-01-10T10:00:00+04:00'))).toBe('t2')
    expect(deriveCurrentTermId(years, terms, Date.parse('2028-01-10T10:00:00+04:00'))).toBe('t2')
    expect(deriveCurrentTermId([], [], NOW)).toBe('')
  })
})

describe('مستودع Supabase الحقيقي', () => {
  it('قبل الدخول: لا بيانات ولا جلسة ولا تحميل', async () => {
    const b = makeBackend({ user: null, tables: DATA })
    const auth = createAuthController(b)
    const repo = createSupabaseRepository(b, auth, { now: () => NOW, tickMs: null })
    await auth.start()
    const s = repo.getSnapshot()
    expect(s.session).toBeNull()
    expect(s.teachers).toHaveLength(0)
    expect(s.load.phase).toBe('idle')
    expect(b.calls.includes('query:teachers')).toBe(false)
  })

  it('بعد الدخول الكامل: يحمّل البيانات الحقيقية من الجداول', async () => {
    const { repo } = await authorizedRepo()
    const s = repo.getSnapshot()
    expect(s.load.phase).toBe('ready')
    expect(s.session?.role).toBe('owner')
    expect(s.years).toHaveLength(1)
    expect(s.terms).toHaveLength(2)
    expect(s.teachers[0].name).toBe('معلمة أ')
    expect(s.teachers[0].codeState).toBe('active')
    expect(s.submissions[0].versions).toHaveLength(1)
    expect(s.audit[0].action).toBe('تعديل مواعيد')
    expect(s.currentTermId).toBe('t1')
    expect(repo.meta.kind).toBe('supabase')
    expect(repo.meta.persistent).toBe(true)
  })

  it('لا يطلب أعمدة التخزين السرية من versions/archives', async () => {
    const { b } = await authorizedRepo()
    expect(b.calls.some((c) => /storage_key|storage_bucket/.test(c))).toBe(false)
  })

  it('فشل قراءة جدول ⇒ حالة خطأ صريحة وبيانات فارغة (لا بيانات وهمية)', async () => {
    const { repo } = await authorizedRepo({ tables: { ...DATA, teachers: { error: { message: 'relation does not exist', code: '42P01' } } } })
    const s = repo.getSnapshot()
    expect(s.load.phase).toBe('error')
    expect(s.teachers).toHaveLength(0)
    expect(s.years).toHaveLength(0)
    if (s.load.phase === 'error') expect(s.load.message).toMatch(/ملفات المرحلة الثانية/)
  })

  it('صلاحية مرفوضة (42501) ⇒ رسالة عن الجلسة والتحقق بخطوتين', async () => {
    const { repo } = await authorizedRepo({ tables: { ...DATA, years: { error: { message: 'permission denied', code: '42501' } } } })
    const s = repo.getSnapshot()
    expect(s.load.phase).toBe('error')
    if (s.load.phase === 'error') expect(s.load.message).toMatch(/التحقق بخطوتين/)
  })

  it('إعادة التحميل بعد جاهزية البيانات صامتة: لا تمر بحالة loading (حتى لا تُفكَّك الصفحة ويضيع الرمز المعروض مرة واحدة)', async () => {
    const { repo } = await authorizedRepo()
    expect(repo.getSnapshot().load.phase).toBe('ready')
    const phases: string[] = []
    repo.subscribe(() => phases.push(repo.getSnapshot().load.phase))
    await repo.reload()
    expect(phases.length).toBeGreaterThan(0)
    expect(phases).not.toContain('loading')
    expect(repo.getSnapshot().load.phase).toBe('ready')
  })
  it('الخروج يمحو كل البيانات من الذاكرة', async () => {
    const { auth, repo } = await authorizedRepo()
    expect(repo.getSnapshot().teachers).toHaveLength(1)
    await auth.signOut()
    const s = repo.getSnapshot()
    expect(s.session).toBeNull()
    expect(s.teachers).toHaveLength(0)
    expect(s.audit).toHaveLength(0)
    expect(s.load.phase).toBe('idle')
  })

  it('الأوامر غير المفتوحة ترفض بـUnavailableError ولا تكتب شيئًا', async () => {
    const { repo, b } = await authorizedRepo()
    const names = ['submit', 'setCurrentTerm', 'reissueCode', 'revokeCode', 'createArchive', 'verifyArchive', 'markSent', 'ackBackup', 'deleteArchive'] as const
    for (const n of names) {
      let e: unknown = null
      try { await (repo[n] as (...a: unknown[]) => Promise<unknown>)('x', 'y', 'z') } catch (x) { e = x }
      expect(e instanceof UnavailableError).toBe(true)
      expect(typeof repo.meta.unavailable?.[n]).toBe('string')
    }
    expect(b.writes).toHaveLength(0)
  })

  it('تعديل المواعيد عبر set_term_deadlines فقط (لا update مباشر على terms)', async () => {
    const { repo, b } = await authorizedRepo()
    await repo.updateDeadlines('t1', { base: '2026-10-16', late: '2026-10-23', replace: '2026-11-07' }, 'سبب')
    expect(b.calls.includes('rpc:set_term_deadlines')).toBe(true)
    expect(b.writes.filter((w) => w.table === 'terms' && w.op === 'update')).toHaveLength(0)
  })

  it('خطأ من set_term_deadlines يُرمى للصفحة (لا نجاح وهمي)', async () => {
    const { repo } = await authorizedRepo({ rpcResults: { set_term_deadlines: { data: null, error: { message: 'سبب التعديل مطلوب', code: '23514' } } } })
    let msg = ''
    try { await repo.updateDeadlines('t1', { base: 'a', late: 'b', replace: 'c' }, '') } catch (e) { msg = describeCommandError(e) }
    expect(msg).toBe('سبب التعديل مطلوب')
  })

  it('تعديل معلمة لا يطال صفوفًا (RLS) ⇒ خطأ NO_ROWS', async () => {
    const { repo } = await authorizedRepo({ tables: { ...DATA, teachers: { ...DATA!.teachers!, singleRow: undefined } } })
    // محاكاة update يُرجع صفرًا: نستبدل الاستجابة
    const b2 = makeBackend({ user: { id: 'u-1' }, profile: { role: 'owner', is_active: true }, tables: DATA })
    const origFrom = b2.from.bind(b2)
    b2.from = (t: string) => {
      const q = origFrom(t)
      if (t !== 'teachers') return q
      const upd = q.update.bind(q)
      q.update = (v) => { const r = upd(v); (r as unknown as { then: unknown }).then = (res: (x: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res); return r }
      return q
    }
    const auth = createAuthController(b2)
    const repo2 = createSupabaseRepository(b2, auth, { now: () => NOW, tickMs: null })
    await auth.start(); await tick()
    let e: unknown = null
    try { await repo2.updateTeacher('th1', { active: false }) } catch (x) { e = x }
    expect(describeCommandError(e)).toMatch(/السجل غير موجود أو ليس لديكِ صلاحية/)
    expect(repo.getSnapshot().load.phase).toBe('ready')
  })

  it('إضافة معلمة تكتب صفًا واحدًا بلا أي عمود سري', async () => {
    const { repo, b } = await authorizedRepo()
    await repo.addTeacher('معلمة ب', 'رياضيات')
    const w = b.writes.find((x) => x.table === 'teachers' && x.op === 'insert')!
    const v = w.values as Record<string, unknown>
    expect(v.name).toBe('معلمة ب')
    expect(v.created_by).toBe('u-1')
    expect('code_hash' in v || 'pin_hash' in v).toBe(false)
    expect(b.writes.some((x) => x.table === 'teacher_credentials')).toBe(false)
  })

  it('إضافة سنة: تُدخل السنة ثم فصلين بمواعيد مبدئية مرتبة', async () => {
    const { repo, b } = await authorizedRepo()
    await repo.addYear('⁦2027⁠–⁠2028⁩')
    const y = b.writes.find((x) => x.table === 'years' && x.op === 'insert')!
    expect((y.values as { label: string }).label).toBe('2027–2028')
    const t = b.writes.find((x) => x.table === 'terms' && x.op === 'insert')!
    expect((t.values as unknown[]).length).toBe(2)
  })

  it('نفس المستودع للمديرة: دور director فقط', async () => {
    const { repo } = await authorizedRepo({}, 'director')
    expect(repo.getSnapshot().session?.role).toBe('director')
  })

  it('مصدر الإعداد الناقص: خطأ دائم وأوامر مرفوضة (لا رجوع للوهمي)', async () => {
    const r = createUnavailableRepository('إعدادات ناقصة')
    expect(r.getSnapshot().load.phase).toBe('error')
    expect(r.getSnapshot().teachers).toHaveLength(0)
    let e: unknown = null
    try { await r.addTeacher('a', 'b') } catch (x) { e = x }
    expect(e instanceof UnavailableError).toBe(true)
  })
})

describe('رسائل الأخطاء', () => {
  it('أخطاء شائعة', () => {
    expect(describeCommandError({ message: 'Failed to fetch' })).toMatch(/الاتصال/)
    expect(describeCommandError({ code: '42501', message: 'new row violates row-level security policy' })).toMatch(/صلاحية/)
    expect(describeCommandError({ code: '23505', message: 'duplicate key' })).toMatch(/موجودة/)
    expect(describeCommandError(new UnavailableError('غير متاح'))).toBe('غير متاح')
    expect(describeLoadError({ code: 'PGRST301', message: 'JWT expired' })).toMatch(/انتهت الجلسة/)
  })
})
