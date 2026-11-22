// @vitest-environment node
// سكربت مسح البيانات التجريبية (supabase/99_wipe_all_data.sql، r41) على PostgreSQL محلي:
// بلا 'YES' لا يمسح شيئًا؛ مع 'YES' يمسح كل شيء ويُبقي المسؤولين والإعدادات والأنواع ولا يترك مشغّلًا معطّلًا.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { HAS_PG, createTestEnv } from './helpers/testDb'
import type { TestEnv } from './helpers/testDb'

const SCRIPT = readFileSync(new URL('../../supabase/99_wipe_all_data.sql', import.meta.url), 'utf8')
const FILES = ['database/006_teacher_sessions.sql', 'database/007_server_additions.sql', 'database/008_teacher_removal.sql', 'database/009_archive_parts.sql', 'database/010_year_reset.sql', 'database/011_years_teachers_import.sql', 'database/012_teacher_delete.sql', 'database/013_reset_for_staff.sql', 'database/014_reset_light_gate.sql', 'database/015_reset_teachers.sql']

if (!HAS_PG) {
  describe('مسح البيانات التجريبية — تخطٍّ: لا ATHAR_TEST_PG', () => { it('نائب', () => {}) })
} else {
  describe('supabase/99_wipe_all_data.sql', () => {
    let env: TestEnv
    const n = async (q: string) => Number((await env.admin.transaction((c) => c.query<{ n: string }>(`select count(*)::text as n from ${q}`)))[0]!.n)
    const run = (s: string) => env.admin.transaction(async (c) => { await c.exec(s.replace(/^begin;|^commit;/gm, '')) })

    it('تهيئة: بيانات تجريبية + مسؤولان', async () => {
      env = await createTestEnv({ withStaff: true, extraFiles: FILES })
      await env.admin.transaction(async (c) => {
        await c.exec('set local session_replication_role = replica')
        await c.exec(`insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'o@example.invalid'), ('00000000-0000-0000-0000-0000000000d1', 'd@example.invalid');
          insert into public.staff_profiles (user_id, role) values ('00000000-0000-0000-0000-0000000000a1', 'owner'), ('00000000-0000-0000-0000-0000000000d1', 'director')`)
      })
      expect(await n('public.teachers')).toBe(2)
      expect(await n('public.years')).toBe(1)
      expect(await n('public.staff_profiles')).toBe(2)
    })
    it('بلا YES: يرفض ولا يمسح شيئًا', async () => {
      await expect(run(SCRIPT)).rejects.toThrow()
      expect(await n('public.teachers')).toBe(2)
    })
    it('مع YES: يمسح كل شيء ويُبقي المسؤولين والإعدادات والأنواع وكل المشغّلات مفعّلة', async () => {
      const staff = await n('public.staff_profiles'); const slots = await n('public.slots'); const settings = await n('public.app_settings')
      await run(SCRIPT.replace("v_confirm       text    := 'NO'", "v_confirm       text    := 'YES'"))
      for (const t of ['teachers', 'teacher_credentials', 'submissions', 'versions', 'upload_sessions', 'archives', 'audit_log', 'years', 'terms']) expect(await n(`public.${t}`)).toBe(0)
      expect(await n('public.staff_profiles')).toBe(staff); expect(await n('public.slots')).toBe(slots); expect(await n('public.app_settings')).toBe(settings)
      expect(await n(`pg_trigger tg join pg_class c on c.oid = tg.tgrelid join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and not tg.tgisinternal and tg.tgenabled <> 'O'`)).toBe(0)
    })
    it('بعد المسح يمكن إنشاء سنة جديدة وتعمل المشغّلات (سلسلة التدقيق من جديد)', async () => {
      await env.admin.transaction(async (c) => { await c.exec(`insert into public.years (label, is_active) values ('2026-2027', true)`) })
      expect(await n('public.years')).toBe(1)
      await expect(env.admin.transaction(async (c) => { await c.exec('delete from public.years') })).rejects.toThrow()
    })
  })
}
