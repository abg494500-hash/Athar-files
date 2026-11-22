// @vitest-environment node
// إدارة السنوات واستيراد المعلمات (A-119) على PostgreSQL محلي: ذرّية، قبل بدء العمل فقط، تفعيل سنة واحدة، سنة مغلقة، تكرار، مالكة فقط.
import { describe, it, expect } from 'vitest'
import { AdminService } from '../services/adminService'
import { ServiceError } from '../services/errors'
import { HAS_PG, createTestEnv } from './helpers/testDb'
import type { TestEnv } from './helpers/testDb'

const OWNER = '00000000-0000-0000-0000-0000000000a1'
const DIRECTOR = '00000000-0000-0000-0000-0000000000d1'
const code = async (p: Promise<unknown>): Promise<string> => { try { await p } catch (e) { return e instanceof ServiceError ? e.code : `other:${(e as { sqlstate?: string }).sqlstate ?? (e as Error).message}` } return 'ok' }
const terms = (y = 2027) => [
  { ord: 1 as const, name: 'الفصل الأول', deadlineBase: `${y}-10-15`, deadlineLate: `${y}-10-22`, deadlineReplace: `${y}-11-06` },
  { ord: 2 as const, name: 'الفصل الثاني', deadlineBase: `${y + 1}-03-05`, deadlineLate: `${y + 1}-03-12`, deadlineReplace: `${y + 1}-03-26` },
]
const Y = (label: string, y = 2027) => ({ label, startsOn: `${y}-09-01`, endsOn: `${y + 1}-06-30`, terms: terms(y) })

describe('AdminService — مدخلات (بلا قاعدة)', () => {
  const s = new AdminService({ db: {} as never, issueCredentials: async () => ({ code: 'c' }) })
  it('تواريخ وأرقام فصول ومعرّفات مشوّهة ⇒ bad_request قبل القاعدة', async () => {
    expect(await code(s.createYear('x', Y('2027-2028')))).toBe('bad_request')
    expect(await code(s.createYear(OWNER, { ...Y('2027-2028'), startsOn: '2027-13-40' }))).toBe('bad_request')
    expect(await code(s.createYear(OWNER, { ...Y('2027-2028'), terms: [terms()[0]!] }))).toBe('bad_request')
    expect(await code(s.createYear(OWNER, { ...Y('2027-2028'), terms: [terms()[0]!, { ...terms()[1]!, ord: 3 as 1 }] }))).toBe('bad_request')
    expect(await code(s.importTeachers({ actor: OWNER, rows: [], issueCodes: false }))).toBe('bad_request')
    expect(await code(s.importTeachers({ actor: OWNER, rows: Array.from({ length: 301 }, () => ({ name: 'x', subject: 'y' })), issueCodes: false }))).toBe('bad_request')
  })
})

if (!HAS_PG) {
  describe('إدارة السنوات والاستيراد على قاعدة — تخطٍّ: لا ATHAR_TEST_PG', () => { it('نائب', () => {}) })
} else {
  describe('إدارة السنوات والاستيراد على Postgres محلي', () => {
    let env: TestEnv; let s: AdminService; let issued = 0
    const rows = <T>(q: string, p: unknown[] = []) => env.admin.transaction((c) => c.query<T>(q, p))
    const n = async (q: string, p: unknown[] = []) => Number((await rows<{ n: string }>(`select count(*)::text as n from ${q}`, p))[0]!.n)
    it('تهيئة 001..011 + مالكة ومديرة', async () => {
      env = await createTestEnv({ withStaff: true, extraFiles: ['database/006_teacher_sessions.sql', 'database/007_server_additions.sql', 'database/008_teacher_removal.sql', 'database/009_archive_parts.sql', 'database/010_year_reset.sql', 'database/011_years_teachers_import.sql', 'database/012_teacher_delete.sql', 'database/013_reset_for_staff.sql', 'database/014_reset_light_gate.sql', 'database/015_reset_teachers.sql'] })
      await env.admin.transaction((c) => c.exec(`insert into auth.users (id, email) values ('${OWNER}', 'o@example.invalid'), ('${DIRECTOR}', 'd@example.invalid'); select public.bootstrap_staff('o@example.invalid', 'owner'); select public.bootstrap_staff('d@example.invalid', 'director');`))
      s = new AdminService({ db: env.db, issueCredentials: async () => ({ code: `CODE${++issued}` }) })
    })
    it('إنشاء سنة: سنة + فصلان بمواعيدها وتواريخ السنة في معاملة واحدة؛ غير نشطة؛ غير الموظفة مرفوضة', async () => {
      const { id } = await s.createYear(OWNER, Y('2027-2028'))
      expect(await n('public.terms where year_id = $1', [id])).toBe(2)
      expect((await rows<{ is_active: boolean; starts_on: string }>('select is_active, starts_on::text from public.years where id = $1', [id]))[0]).toMatchObject({ is_active: false, starts_on: '2027-09-01' })
      expect(await code(s.createYear('00000000-0000-0000-0000-0000000000ee', Y('2028-2029', 2028)))).toBe('bad_request') // غير موظفة ⇒ مرفوض
      expect(await n(`public.years where label = '2028-2029'`)).toBe(0)
    })
    it('اسم مكرر ⇒ conflict؛ مواعيد غير مرتبة أو خارج السنة ⇒ رفض ولا تبقى سنة نصف منشأة', async () => {
      expect(await code(s.createYear(OWNER, Y('2027-2028')))).toBe('conflict')
      const bad = Y('2029-2030', 2029); bad.terms[0]!.deadlineLate = '2029-10-01'
      expect(await code(s.createYear(OWNER, bad))).toBe('bad_request')
      expect(await code(s.createYear(OWNER, { ...Y('2030-2031', 2030), endsOn: '2030-12-01' }))).toBe('bad_request')
      expect(await n(`public.years where label in ('2029-2030','2030-2031')`)).toBe(0); expect(await n('public.terms')).toBe(4)
    })
    it('تعديل سنة قبل بدء العمل ينجح (الاسم والتواريخ والمواعيد)', async () => {
      const id = (await rows<{ id: string }>(`select id from public.years where label = '2027-2028'`))[0]!.id
      const upd = Y('2027-2028 معدلة'); upd.terms[0]!.deadlineBase = '2027-10-20'; upd.terms[0]!.deadlineLate = '2027-10-27'
      await s.updateYear(OWNER, id, upd)
      expect((await rows<{ label: string }>('select label from public.years where id = $1', [id]))[0]!.label).toBe('2027-2028 معدلة')
      expect((await rows<{ d: string }>(`select deadline_base::text d from public.terms where year_id = $1 and ord = 1`, [id]))[0]!.d).toBe('2027-10-20')
      expect(await code(s.updateYear('00000000-0000-0000-0000-0000000000ee', id, upd))).toBe('bad_request')
    })
    it('update_year: التحقق بعد دمج التواريخ المحفوظة (نهاية فارغة تُبقي المحفوظة) فلا يمرّ موعد خارج السنة، ولا يتغير شيء عند الرفض', async () => {
      const id = (await rows<{ id: string }>(`select id from public.years where label = '2027-2028 معدلة'`))[0]!.id
      const call = (ends: string | null, replace2: string) => env.admin.transaction((c) => c.exec(
        `select public.update_year($1::uuid, $2::uuid, '2027-2028 معدلة', '2027-09-01'::date, $3::date, $4::jsonb)`,
        [OWNER, id, ends, JSON.stringify([
          { ord: 1, name: 'الفصل الأول', deadline_base: '2027-10-20', deadline_late: '2027-10-27', deadline_replace: '2027-11-06' },
          { ord: 2, name: 'الفصل الثاني', deadline_base: '2028-03-05', deadline_late: '2028-03-12', deadline_replace: replace2 }])]))
      await expect(call(null, '2028-07-15')).rejects.toMatchObject({ sqlstate: '23514' }) // المحفوظة 2028-06-30
      expect((await rows<{ e: string }>('select ends_on::text e from public.years where id = $1', [id]))[0]!.e).toBe('2028-06-30')
      await call(null, '2028-03-26') // داخل الحدود: ينجح والنهاية المحفوظة باقية
      expect((await rows<{ e: string }>('select ends_on::text e from public.years where id = $1', [id]))[0]!.e).toBe('2028-06-30')
    })
    it('update_year: فصل ناقص ⇒ تُلغى المعاملة كلها (لا يبقى تعديل في السنة ولا في الفصل الأول)', async () => {
      const { id } = await s.createYear(OWNER, Y('2040-2041', 2040))
      await env.admin.transaction(async (c) => { await c.exec('set local session_replication_role = replica'); await c.exec(`delete from public.terms where year_id = $1 and ord = 2`, [id]) })
      await expect(env.admin.transaction((c) => c.exec(`select public.update_year($1::uuid, $2::uuid, 'اسم جديد', null, null, $3::jsonb)`, [OWNER, id, JSON.stringify([
        { ord: 1, name: 'عدّل', deadline_base: '2040-10-16', deadline_late: '2040-10-22', deadline_replace: '2040-11-06' },
        { ord: 2, name: 'الثاني', deadline_base: '2041-03-05', deadline_late: '2041-03-12', deadline_replace: '2041-03-26' }])]))).rejects.toMatchObject({ sqlstate: '23514' })
      expect((await rows<{ label: string }>('select label from public.years where id = $1', [id]))[0]!.label).toBe('2040-2041')
      expect((await rows<{ name: string }>('select name from public.terms where year_id = $1 and ord = 1', [id]))[0]!.name).toBe('الفصل الأول')
    })
    it('year_work_started: إصدار (version) وحده في السنة يكفي لاعتبار العمل بدأ', async () => {
      const { id } = await s.createYear(OWNER, Y('2041-2042', 2041))
      expect((await rows<{ b: boolean }>('select public.year_work_started($1::uuid) b', [id]))[0]!.b).toBe(false)
      const t = (await rows<{ id: string }>('select id from public.terms where year_id = $1 and ord = 1', [id]))[0]!.id
      await env.admin.transaction(async (c) => { await c.exec('set local session_replication_role = replica'); await c.exec(`insert into public.versions (id, teacher_id, term_id, slot_id, no, kind, url, submitted_at, status_snapshot, deadlines_snapshot) values ('00000000-0000-0000-0000-00000000e001', $1, $2, 's2', 1, 'link', 'https://example.com/e', now(), 'late', '{}'::jsonb)`, [env.ids.teacher, t]) })
      expect((await rows<{ b: boolean }>('select public.year_work_started($1::uuid) b', [id]))[0]!.b).toBe(true)
    })
    it('بعد أول تسليم في السنة: التعديل مرفوض year_work_started', async () => {
      const t = (await rows<{ id: string; year_id: string }>(`select id, year_id from public.terms where year_id = (select id from public.years where label like '2027-2028%') and ord = 1`))[0]!
      await env.admin.transaction(async (c) => { await c.exec('set local session_replication_role = replica'); await c.exec(`insert into public.submissions (teacher_id, term_id, slot_id) values ($1, $2, 's1')`, [env.ids.teacher, t.id]) })
      expect(await code(s.updateYear(OWNER, t.year_id, Y('2027-2028 معدلة')))).toBe('year_work_started')
    })
    it('تفعيل سنة واحدة فقط: التفعيل ينقل النشاط، وسنة مغلقة بالتصفير لا تُفعَّل', async () => {
      const [a, b] = (await rows<{ id: string }>(`select id from public.years order by label`)).map((x) => x.id)
      await s.activateYear(OWNER, a!); await s.activateYear(OWNER, b!)
      expect(await n('public.years where is_active')).toBe(1); expect((await rows<{ id: string }>('select id from public.years where is_active'))[0]!.id).toBe(b)
      expect(await code(s.activateYear('00000000-0000-0000-0000-0000000000ee', a!))).toBe('bad_request')
      await env.admin.transaction(async (c) => { await c.exec('set local session_replication_role = replica'); await c.exec(`insert into public.year_resets (year_id, started_by, report) values ($1, $2, '{}'::jsonb)`, [a, OWNER]) })
      expect(await code(s.activateYear(OWNER, a!))).toBe('year_closed')
      expect((await rows<{ id: string }>('select id from public.years where is_active'))[0]!.id).toBe(b) // لم يتغيّر
    })
    it('استيراد ذرّي: كل الصفوف تُدرج، وتُصدَر أكواد اختيارية، والأسماء تُطبَّع', async () => {
      const before = await n('public.teachers')
      const r = await s.importTeachers({ actor: OWNER, rows: [{ name: '  هدى   الكلباني ', subject: 'أحياء' }, { name: 'نورة الحارثية', subject: 'لغة عربية' }], issueCodes: true })
      expect(r.imported.map((x) => x.name)).toEqual(['هدى الكلباني', 'نورة الحارثية']); expect(r.issued).toHaveLength(2); expect(r.issueFailed).toEqual([])
      expect(await n('public.teachers')).toBe(before + 2)
      expect(JSON.stringify(r.imported)).not.toMatch(/code|pin/i)
    })
    it('تكرار مع الموجود أو داخل الدفعة أو صف معيب ⇒ رفض الدفعة كلها ولا يُدرج أي صف', async () => {
      const before = await n('public.teachers')
      expect(await code(s.importTeachers({ actor: OWNER, rows: [{ name: 'صفاء الراشدية', subject: 'علوم' }, { name: 'هدى الكلباني', subject: 'أحياء' }], issueCodes: false }))).toBe('conflict')
      expect(await code(s.importTeachers({ actor: OWNER, rows: [{ name: 'أمل البلوشية', subject: 'علوم' }, { name: 'أمل  البلوشية', subject: 'علوم' }], issueCodes: false }))).toBe('conflict')
      expect(await code(s.importTeachers({ actor: OWNER, rows: [{ name: 'أمل البلوشية', subject: 'علوم' }, { name: 'ب', subject: 'علوم' }], issueCodes: false }))).toBe('conflict')
      expect(await n('public.teachers')).toBe(before)
      expect(await code(s.importTeachers({ actor: DIRECTOR, rows: [{ name: 'أمل البلوشية', subject: 'علوم' }], issueCodes: false }))).toBe('ok') // r37: المديرة تسجّل المعلمات
    })
    it('فشل إصدار كود لمعلمة لا يلغي الاستيراد، ويُبلَّغ به', async () => {
      const s2 = new AdminService({ db: env.db, issueCredentials: async () => { throw new Error('x') } })
      const r = await s2.importTeachers({ actor: OWNER, rows: [{ name: 'عائشة المعمرية', subject: 'تاريخ' }], issueCodes: true })
      expect(r.imported).toHaveLength(1); expect(r.issueFailed).toEqual([r.imported[0]!.id]); expect(r.issued).toEqual([])
    })
    it('r39 (A-125): المديرة تنشئ سنة وتعدّلها وتفعّلها كالمالكة', async () => {
      const { id } = await s.createYear(DIRECTOR, Y('2051-2052', 2051))
      await s.updateYear(DIRECTOR, id, { ...Y('2051-2052 معدلة', 2051) })
      const cur = (await rows<{ id: string }>('select id from public.years where is_active'))[0]!.id
      await s.activateYear(DIRECTOR, id)
      expect((await rows<{ is_active: boolean }>('select is_active from public.years where id = $1', [id]))[0]!.is_active).toBe(true)
      await s.activateYear(OWNER, cur) // إعادة الحال
    })
    it('r37 (A-123): staff_actor_check تقبل المالكة والمديرة وترفض غيرهما', async () => {
      await rows('select public.staff_actor_check($1::uuid)', [OWNER]); await rows('select public.staff_actor_check($1::uuid)', [DIRECTOR])
      let st = ''
      try { await rows('select public.staff_actor_check($1::uuid)', ['00000000-0000-0000-0000-0000000000ee']) } catch (e) { st = (e as { sqlstate?: string }).sqlstate ?? 'other' }
      expect(st).toBe('42501')
    })
    it('r37: سياسات المعلمات تسمح للمديرة، ولا تحديث مباشر لعمود removed_at', async () => {
      const pol = await rows<{ policyname: string; qual: string | null; with_check: string | null }>(`select policyname, qual, with_check from pg_policies where schemaname='public' and tablename in ('teachers','teacher_credentials')`)
      const all = JSON.stringify(pol)
      expect(all).toMatch(/director/)
      const priv = await rows<{ ok: boolean }>(`select has_column_privilege('authenticated','public.teachers','removed_at','update') as ok`)
      expect(priv[0]!.ok).toBe(false)
      const ok = await rows<{ ok: boolean }>(`select has_column_privilege('authenticated','public.teachers','name','update') as ok`)
      expect(ok[0]!.ok).toBe(true)
    })
    it('r37: أول سنة تُنشأ عند عدم وجود سنة نشطة تصبح نشطة تلقائيًا (وتُتراجع التجربة)', async () => {
      let activeAfter: boolean | null = null
      try {
        await env.admin.transaction(async (c) => {
          await c.exec('update public.years set is_active = false')
          const id = (await c.query<{ id: string }>('select public.create_year_with_terms($1::uuid, $2, $3::date, $4::date, $5::jsonb) as id', [OWNER, 'تجربة-التفعيل-التلقائي', '2040-09-01', '2041-06-30', JSON.stringify(terms(2040).map((t) => ({ ord: t.ord, name: t.name, deadline_base: t.deadlineBase, deadline_late: t.deadlineLate, deadline_replace: t.deadlineReplace })))]))[0]!.id
          activeAfter = (await c.query<{ a: boolean }>('select is_active as a from public.years where id = $1', [id]))[0]!.a
          throw new Error('rollback-on-purpose')
        })
      } catch (e) { expect(JSON.stringify(e, Object.getOwnPropertyNames(e as object))).toContain('rollback-on-purpose') }
      expect(activeAfter).toBe(true)
      expect(await n(`public.years where label = 'تجربة-التفعيل-التلقائي'`)).toBe(0)
    })
    it('سجل التدقيق يسجّل العمليات', async () => {
      expect(await n(`public.audit_log where action in ('year.create','year.update','year.activate','teachers.import')`)).toBeGreaterThanOrEqual(5)
    })
  })
}
