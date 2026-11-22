// @vitest-environment node
// حذف المعلمة بعد الأرشفة (A-114): الدالة remove_teacher على PostgreSQL محلي (ATHAR_TEST_PG). دونه يمرّ اختبار نائب.
// + اختبار المنطق بالمخزن الذاكري (يعمل دائمًا).
import { describe, it, expect } from 'vitest'
import { randomBytes } from 'node:crypto'
import { PgAuthStore } from '../auth/pgAuthStore'
import { TeacherAuthService } from '../auth/teacherAuth'
import { DbError } from '../db/types'
import { HAS_PG, createTestEnv } from './helpers/testDb'
import { MemoryAuthStore } from './helpers/memoryAuthStore'
import type { TestEnv } from './helpers/testDb'

const T1 = '00000000-0000-0000-0000-000000000001'
const T2 = '00000000-0000-0000-0000-000000000002'
const OWNER = '00000000-0000-0000-0000-0000000000a1'
const DIRECTOR = '00000000-0000-0000-0000-0000000000b2'
const peppers = () => ({ codePepper: randomBytes(32), ipPepper: randomBytes(32) })

describe('حذف المعلمة — المخزن الذاكري', () => {
  it('الحذف يبطل الدخول ويمحو الاسم، ومرة ثانية ⇒ غير موجودة', async () => {
    const store = new MemoryAuthStore()
    store.addTeacher(T1, 'سارة')
    const svc = new TeacherAuthService(store, peppers())
    const a = await svc.issueCredentials(T1)
    expect((await svc.login({ code: a.code })).teacher.id).toBe(T1)
    await svc.removeTeacher(T1, OWNER)
    let denied = false
    try { await svc.login({ code: a.code }) } catch { denied = true }
    expect(denied).toBe(true)
    expect(store.teachers.get(T1)?.name).toBe('معلمة محذوفة')
    let code = ''
    try { await svc.removeTeacher(T1, OWNER) } catch (e) { code = (e as { code?: string }).code ?? '' }
    expect(code).toBe('P0002')
  })
})

if (!HAS_PG) {
  describe('remove_teacher على قاعدة — تخطٍّ: لا ATHAR_TEST_PG (لم يُجرَّب على قاعدة)', () => { it('نائب', () => {}) })
} else {
  describe('remove_teacher على Postgres محلي', () => {
    let env: TestEnv
    let svc: TeacherAuthService
    const sql = (q: string, p: unknown[] = []) => env.admin.transaction(async (c) => { await c.exec('set local session_replication_role = replica'); await c.exec(q, p) })
    const rows = <T>(q: string, p: unknown[] = []) => env.admin.transaction((c) => c.query<T>(q, p))
    const code = async (p: Promise<unknown>) => { try { await p } catch (e) { return e instanceof DbError ? e.sqlstate : `other:${(e as Error).message}` } return 'ok' }
    const addVersion = (teacher: string, no = 1) => sql(
      `insert into public.submissions (teacher_id, term_id, slot_id) values ($1, $2, 's1') on conflict do nothing;
       insert into public.versions (id, teacher_id, term_id, slot_id, no, kind, url, submitted_at, status_snapshot, deadlines_snapshot)
       values (gen_random_uuid(), $1, $2, 's1', ${no}, 'link', 'https://example.com/x', now(), 'on_time', '{}'::jsonb)`, [teacher, env.ids.term])
    const archiveAll = (teacher: string, opts: { verified?: boolean; downloaded?: boolean } = {}) => sql(
      `with a as (insert into public.archives (id, title, year_id, term_id, state, sha256, download_completed_at, download_hash_verified_at)
                  select gen_random_uuid(), 't', y.id, $2, $3, repeat('a', 64), ${opts.downloaded === false ? 'null' : 'now()'}, ${opts.downloaded === false ? 'null' : 'now()'} from public.years y limit 1 returning id)
       insert into public.archive_entries (archive_id, version_id, path_in_zip, sha256, size_bytes)
       select a.id, v.id, 'p/' || v.id, repeat('b', 64), 1 from a, public.versions v where v.teacher_id = $1`,
      [teacher, env.ids.term, opts.verified === false ? 'awaiting_verification' : 'verified'])

    it('تهيئة 001..008 + حسابا المالكة والمديرة', async () => {
      env = await createTestEnv({ withStaff: true, extraFiles: ['database/006_teacher_sessions.sql', 'database/007_server_additions.sql', 'database/008_teacher_removal.sql', 'database/012_teacher_delete.sql'] })
      await env.admin.transaction((c) => c.exec(
        `insert into public.app_settings (id, max_file_bytes, allowed_types, upload_window_minutes, login_max_failed_attempts, login_lock_minutes, login_attempts_retention_days) values (true, 50000000, '{pdf,docx,png}', 120, 5, 15, 90) on conflict (id) do nothing;
         insert into auth.users (id, email) values ('${OWNER}', 'o@example.invalid'), ('${DIRECTOR}', 'd@example.invalid');
         select public.bootstrap_staff('o@example.invalid', 'owner'); select public.bootstrap_staff('d@example.invalid', 'director');`))
      svc = new TeacherAuthService(new PgAuthStore(env.db), peppers())
    })

    it('المديرة لا تحذف (insufficient_privilege)', async () => {
      expect(await code(svc.removeTeacher(T1, DIRECTOR))).toBe('42501')
    })

    it('معلمة بلا إصدارات: تُحذف، يُمحى الاسم، يُبطل الدخول والجلسات، ويُسجَّل التدقيق بلا اسم', async () => {
      const a = await svc.issueCredentials(T1)
      const login = await svc.login({ code: a.code })
      const r = await svc.removeTeacher(T1, OWNER)
      expect(r.versions).toBe(0)
      const t = (await rows<{ name: string; is_active: boolean; removed_at: string | null }>('select name, is_active, removed_at from public.teachers where id = $1', [T1]))[0]!
      expect(t.name).toBe('معلمة محذوفة'); expect(t.is_active).toBe(false); expect(t.removed_at).not.toBeNull()
      const c = (await rows<{ code_state: string; code_hash: string | null; pin_hash: string | null }>('select code_state, code_hash, pin_hash from public.teacher_credentials where teacher_id = $1', [T1]))[0]!
      expect(c.code_state).toBe('revoked'); expect(c.code_hash).toBeNull(); expect(c.pin_hash).toBeNull()
      expect(await code(svc.login({ code: a.code }))).not.toBe('ok')
      expect(await code(svc.authenticate(login.token))).not.toBe('ok')
      const au = await rows<{ detail: unknown; target_id: string }>(`select detail, target_id from public.audit_log where action = 'owner.remove_teacher'`)
      expect(au.length).toBe(1); expect(au[0]!.target_id).toBe(T1)
      expect(JSON.stringify(au)).not.toContain('معلمة أولى')
    })

    it('حذف معلمة محذوفة أو غير موجودة ⇒ no_data_found', async () => {
      expect(await code(svc.removeTeacher(T1, OWNER))).toBe('P0002')
      expect(await code(svc.removeTeacher('00000000-0000-0000-0000-00000000dead', OWNER))).toBe('P0002')
    })

    it('إصدار غير مؤرشف ⇒ رفض (check_violation) ولا يتغير شيء', async () => {
      await addVersion(T2)
      expect(await code(svc.removeTeacher(T2, OWNER))).toBe('23514')
      expect((await rows<{ name: string }>('select name from public.teachers where id = $1', [T2]))[0]!.name).toBe('معلمة ثانية')
    })

    it('أرشيف غير متحقَّق منه أو غير منزَّل ⇒ رفض', async () => {
      await archiveAll(T2, { verified: false })
      expect(await code(svc.removeTeacher(T2, OWNER))).toBe('23514')
      await sql('delete from public.archive_entries; delete from public.archives')
      await archiveAll(T2, { downloaded: false })
      expect(await code(svc.removeTeacher(T2, OWNER))).toBe('23514')
      await sql('delete from public.archive_entries; delete from public.archives')
    })

    it('أرشيف متحقَّق ومنزَّل يغطي كل إصداراتها ⇒ يُحذف، وتبقى الإصدارات والأرشيف', async () => {
      await archiveAll(T2)
      const r = await svc.removeTeacher(T2, OWNER)
      expect(r.versions).toBe(1)
      expect((await rows<{ n: string }>('select count(*)::text as n from public.versions where teacher_id = $1', [T2]))[0]!.n).toBe('1')
      expect((await rows<{ n: string }>('select count(*)::text as n from public.archive_entries'))[0]!.n).toBe('1')
      expect((await rows<{ name: string; removed_at: string | null }>('select name, removed_at from public.teachers where id = $1', [T2]))[0]!.removed_at).not.toBeNull()
    })

    it('الدالة لا تُنفَّذ من authenticated ولا anon', async () => {
      const r = await rows<{ a: boolean; b: boolean; s: boolean }>(`select has_function_privilege('authenticated', 'public.remove_teacher(uuid,uuid)', 'execute') as a, has_function_privilege('anon', 'public.remove_teacher(uuid,uuid)', 'execute') as b, has_function_privilege('service_role', 'public.remove_teacher(uuid,uuid)', 'execute') as s`)
      expect(r[0]).toEqual({ a: false, b: false, s: true })
    })

    it('تنظيف', async () => { await env.dispose() })
  })
}
