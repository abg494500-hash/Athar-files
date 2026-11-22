// @vitest-environment node
// حذف المعلمة لملفها نهائيًا (A-126) على PostgreSQL محلي (ATHAR_TEST_PG) مع تخزين R2 بديل في الذاكرة.
// يثبت: لا أثر بعد الحذف (R2 النهائي والمؤقت، الإصدار، الجلسة والمحاولات، التسليم إن خلت الخانة)، آخر إصدار فقط، المواعيد، الأرشيف السنوي يمنع،
// معلمة أخرى لا تحذف، فشل R2 لا يحذف الصف، إعادة المحاولة تكمل، المشغّلات كلها مفعّلة بعد الحذف، وaudit_log لا يتغير.
import { describe, it, expect } from 'vitest'
import { ServiceError } from '../services/errors'
import { TeacherReadService } from '../services/teacherReadService'
import { TeacherDeleteService } from '../services/deleteService'
import type { DeleteStorage } from '../services/deleteService'
import { HAS_PG, createTestEnv } from './helpers/testDb'
import type { TestEnv } from './helpers/testDb'

const V = (n: number) => `00000000-0000-0000-0000-00000000d${String(n).padStart(3, '0')}`
const S = (n: number) => `00000000-0000-0000-0000-00000000e${String(n).padStart(3, '0')}`
const hex = (c: string) => c.repeat(64)
const code = async (p: Promise<unknown>): Promise<string> => { try { await p } catch (e) { return e instanceof ServiceError ? e.code : `other:${(e as { sqlstate?: string }).sqlstate ?? (e as Error).message}` } return 'ok' }

class MemR2 implements DeleteStorage {
  keys = new Set<string>(); removed: string[] = []; fail = false
  async removeTeacherObject(k: string) { if (this.fail) throw new Error('r2_delete_failed:500'); this.removed.push(k); this.keys.delete(k) }
}

if (!HAS_PG) {
  describe('حذف الملف على قاعدة — تخطٍّ: لا ATHAR_TEST_PG (لم يُجرَّب على قاعدة)', () => { it('نائب', () => {}) })
} else {
  describe('حذف المعلمة لملفها نهائيًا (Postgres محلي + R2 بديل)', () => {
    let env: TestEnv; let ds: TeacherDeleteService; const r2 = new MemR2()
    const sql = (q: string, p: unknown[] = []) => env.admin.transaction(async (c) => { await c.exec('set local session_replication_role = replica'); await c.exec(q, p) })
    const rows = <T>(q: string, p: unknown[] = []) => env.admin.transaction((c) => c.query<T>(q, p))
    const n = async (q: string, p: unknown[] = []) => Number((await rows<{ n: string }>(`select count(*)::text as n from ${q}`, p))[0]!.n)
    /** إصدار كامل: جلسة رفع مقبولة + محاولات + إصدار + كائنان في R2 (نهائي ومؤقت). */
    const add = async (k: number, teacher: string, term: string, slot: string, no: number, kind: 'file' | 'link' = 'file') => {
      if (kind === 'file') { r2.keys.add(`files/key-${k}.pdf`); r2.keys.add(`pending/key-${k}.pdf`) }
      await sql(`insert into public.submissions (teacher_id, term_id, slot_id) values ($1, $2, $3) on conflict do nothing`, [teacher, term, slot])
      if (kind === 'file') {
        await sql(`insert into public.upload_sessions (id, teacher_id, term_id, slot_id, declared_name, declared_size, pending_key, state, expires_at, idempotency_key, status_at_start, effective_start_at, finished_at, uploaded_at, validated_at, verified_size, verified_sha256, validation_result) values ($1, $2, $3, $4, 'سري.pdf', 1000, $5, 'accepted', now() + interval '1 hour', 'idem-' || $1::text, 'on_time', now(), now(), now(), now(), 1000, '${hex('a')}', '{}'::jsonb);
                   insert into public.upload_attempts (teacher_id, session_id, outcome) values ($2, $1, 'started'), ($2, $1, 'accepted')`, [S(k), teacher, term, slot, `pending/key-${k}.pdf`])
      }
      await sql(
        `insert into public.versions (id, teacher_id, term_id, slot_id, no, kind, original_name, size_bytes, ext, storage_provider, storage_bucket, storage_key, sha256, url, submitted_at, status_snapshot, deadlines_snapshot, validated_at, validation_result, upload_session_id)
         values ($4, $1, $2, $3, $5, $8, $9, $10, $11, $12, $13, $6, $7, $14, now(), 'on_time', '{}'::jsonb, now(), '{}'::jsonb, $15)`,
        [teacher, term, slot, V(k), no, kind === 'file' ? `files/key-${k}.pdf` : null, kind === 'file' ? hex(String(k % 10)) : null, kind,
          kind === 'file' ? 'f.pdf' : null, kind === 'file' ? 1000 : null, kind === 'file' ? 'pdf' : null, kind === 'file' ? 'r2' : null, kind === 'file' ? 'b' : null, kind === 'link' ? 'https://x.example/a' : null, kind === 'file' ? S(k) : null])
    }
    const gone = async (k: number) => (await n('public.versions where id = $1', [V(k)])) === 0
    const audit = async () => (await rows<{ h: string }>(`select md5(string_agg(entry_hash || prev_hash || detail::text, ',' order by id)) as h from public.audit_log`))[0]?.h ?? ''
    const triggersOn = () => n(`pg_trigger where tgname in ('versions_no_delete','submissions_no_delete','upload_sessions_no_delete','upload_sessions_guard_update_bu','upload_attempts_no_mutation') and tgenabled = 'O'`)

    it('تهيئة 001..013 + إصدارات', async () => {
      env = await createTestEnv({ withStaff: true, extraFiles: ['database/006_teacher_sessions.sql', 'database/007_server_additions.sql', 'database/008_teacher_removal.sql', 'database/009_archive_parts.sql', 'database/010_year_reset.sql', 'database/011_years_teachers_import.sql', 'database/012_teacher_delete.sql', 'database/013_reset_for_staff.sql', 'database/014_reset_light_gate.sql', 'database/015_reset_teachers.sql'] })
      ds = new TeacherDeleteService({ db: env.db, storage: r2 })
      await add(1, env.ids.teacher, env.ids.term, 's1', 1); await add(2, env.ids.teacher, env.ids.term, 's1', 2) // خانة بإصدارين
      await add(3, env.ids.teacher, env.ids.term, 's2', 1, 'link')
      await add(4, env.ids.teacher2, env.ids.term, 's1', 1)
      await add(5, env.ids.teacher, env.ids.termClosed, 's1', 1) // فصل مغلق المواعيد
    })

    it('ليس آخر إصدار ⇒ delete_not_latest، ولا يُمسّ شيء', async () => {
      expect(await code(ds.delete(env.ids.teacher, V(1)))).toBe('delete_not_latest')
      expect(r2.keys.has('files/key-1.pdf')).toBe(true); expect(await gone(1)).toBe(false); expect(r2.removed.length).toBe(0)
    })
    it('معلمة أخرى ⇒ not_found بلا أثر', async () => {
      expect(await code(ds.delete(env.ids.teacher2, V(2)))).toBe('not_found')
      expect(r2.keys.has('files/key-2.pdf')).toBe(true); expect(await gone(2)).toBe(false)
    })
    it('فصل انتهت مواعيده ⇒ deadline_closed بلا أثر', async () => {
      expect(await code(ds.delete(env.ids.teacher, V(5)))).toBe('deadline_closed')
      expect(r2.keys.has('files/key-5.pdf')).toBe(true); expect(await gone(5)).toBe(false)
    })
    it('رفع جارٍ للخانة ⇒ session_busy بلا أثر', async () => {
      await sql(`insert into public.upload_sessions (id, teacher_id, term_id, slot_id, declared_name, declared_size, pending_key, state, expires_at, idempotency_key, status_at_start, effective_start_at) values ($1, $2, $3, 's1', 'جار.pdf', 10, 'pending/busy.pdf', 'started', now() + interval '1 hour', 'idem-busy', 'on_time', now())`, [S(90), env.ids.teacher, env.ids.term])
      expect(await code(ds.delete(env.ids.teacher, V(2)))).toBe('session_busy')
      await sql(`delete from public.upload_sessions where id = $1`, [S(90)])
      expect(r2.keys.has('files/key-2.pdf')).toBe(true); expect(await gone(2)).toBe(false)
    })
    it('فشل R2 ⇒ خطأ والصف باقٍ (لا يُحذف سجل ملفه ما زال موجودًا)', async () => {
      r2.fail = true
      expect(await code(ds.delete(env.ids.teacher, V(2)))).toBe('other:r2_delete_failed:500')
      r2.fail = false
      expect(await gone(2)).toBe(false); expect(r2.keys.has('files/key-2.pdf')).toBe(true)
    })

    it('الحذف الناجح (خانة فيها إصدار آخر): يُحذف النهائي والمؤقت والصف والجلسة والمحاولات، ويبقى الإصدار 1 وتسليمه، ولا يتغير audit_log', async () => {
      const a0 = await audit()
      expect(await ds.delete(env.ids.teacher, V(2))).toEqual({ deleted: true })
      expect(r2.keys.has('files/key-2.pdf')).toBe(false); expect(r2.keys.has('pending/key-2.pdf')).toBe(false)
      expect(await gone(2)).toBe(true)
      expect(await n('public.upload_sessions where id = $1', [S(2)])).toBe(0)
      expect(await n('public.upload_attempts where session_id = $1', [S(2)])).toBe(0)
      expect(await n('public.versions where id = $1', [V(1)])).toBe(1); expect(await n('public.upload_sessions where id = $1', [S(1)])).toBe(1)
      expect(await n(`public.submissions where teacher_id = $1 and term_id = $2 and slot_id = 's1'`, [env.ids.teacher, env.ids.term])).toBe(1)
      expect(await audit()).toBe(a0) // الخدمة لا تلمس audit_log
      expect(await triggersOn()).toBe(5) // كل مشغّلات المنع عادت مفعّلة
      const pf = await new TeacherReadService({ db: env.db }).portfolio(env.ids.teacher)
      expect(pf.terms.find((t) => t.id === env.ids.term)!.slots.find((s) => s.slotId === 's1')!.versions.map((v) => v.no)).toEqual([1])
    })

    it('حذف الإصدار الأخير في الخانة: لا بقايا إطلاقًا (لا صف ولا جلسة ولا محاولات ولا تسليم)، وتعود الخانة «لم يُسلَّم» والترقيم يبدأ من 1', async () => {
      expect(await ds.delete(env.ids.teacher, V(1))).toEqual({ deleted: true })
      expect([...r2.keys].filter((k) => k.includes('key-1') || k.includes('key-2'))).toEqual([])
      expect(await n(`public.versions where teacher_id = $1 and term_id = $2 and slot_id = 's1'`, [env.ids.teacher, env.ids.term])).toBe(0)
      expect(await n(`public.upload_sessions where teacher_id = $1 and term_id = $2 and slot_id = 's1'`, [env.ids.teacher, env.ids.term])).toBe(0)
      expect(await n('public.upload_attempts where session_id in ($1, $2)', [S(1), S(2)])).toBe(0)
      expect(await n(`public.submissions where teacher_id = $1 and term_id = $2 and slot_id = 's1'`, [env.ids.teacher, env.ids.term])).toBe(0)
      const slot = (await new TeacherReadService({ db: env.db }).portfolio(env.ids.teacher)).terms.find((t) => t.id === env.ids.term)!.slots.find((s) => s.slotId === 's1')!
      expect(slot).toMatchObject({ state: 'missing', canSubmit: true, versions: [] })
      await add(6, env.ids.teacher, env.ids.term, 's1', 1) // تسليم جديد برقم 1 مقبول
      expect(await n('public.versions where id = $1', [V(6)])).toBe(1)
    })

    it('حذف مكرر لمعرّف حُذف ⇒ not_found، وإعادة المحاولة بعد حذف R2 دون حذف الصف تكمل', async () => {
      expect(await code(ds.delete(env.ids.teacher, V(2)))).toBe('not_found')
      r2.keys.delete('files/key-6.pdf'); r2.keys.delete('pending/key-6.pdf') // يحاكي نجاح R2 ثم انقطاع قبل حذف الصف
      expect(await ds.delete(env.ids.teacher, V(6))).toEqual({ deleted: true }); expect(await gone(6)).toBe(true)
    })

    it('رابط: يُحذف بلا نداء R2', async () => {
      const before = r2.removed.length
      expect(await ds.delete(env.ids.teacher, V(3))).toEqual({ deleted: true })
      expect(r2.removed.length).toBe(before); expect(await gone(3)).toBe(true)
      expect(await n(`public.submissions where teacher_id = $1 and slot_id = 's2'`, [env.ids.teacher])).toBe(0)
    })

    it('خارج الدالة يبقى الحذف والتعديل ممنوعين: delete على versions مرفوض، والمشغّلات مفعّلة', async () => {
      expect(await code(env.admin.transaction((c) => c.exec('delete from public.versions where id = $1', [V(4)])))).toMatch(/^other:/)
      expect(await gone(4)).toBe(false); expect(await triggersOn()).toBe(5)
    })

    it('الأرشيف السنوي القائم يمنع الحذف', async () => {
      await sql(`insert into public.archives (title, year_id) select 'أرشيف', id from public.years where is_active`)
      expect(await code(ds.delete(env.ids.teacher2, V(4)))).toBe('delete_archive_exists')
      expect(r2.keys.has('files/key-4.pdf')).toBe(true); expect(await gone(4)).toBe(false)
    })

    it('صلاحيات الدوال: service_role فقط، لا anon ولا authenticated', async () => {
      const r = (await rows<{ a: boolean; b: boolean; c: boolean }>(`select has_function_privilege('anon', 'public.teacher_delete_version(uuid,uuid)', 'execute') as a, has_function_privilege('authenticated', 'public.teacher_delete_version(uuid,uuid)', 'execute') as b, has_function_privilege('authenticated', 'public.teacher_delete_check(uuid,uuid)', 'execute') as c`))[0]!
      expect(r).toEqual({ a: false, b: false, c: false })
    })
  })
}
