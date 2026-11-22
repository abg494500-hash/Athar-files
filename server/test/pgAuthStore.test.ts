// @vitest-environment node
// اختبار PgAuthStore على PostgreSQL محلي مؤقت. **لا يعمل إلا مع ATHAR_TEST_PG**؛ دونه يمرّ اختبار نائب لا يختبر شيئًا.
import { describe, it, expect } from 'vitest'
import { randomBytes } from 'node:crypto'
import { PgAuthStore } from '../auth/pgAuthStore'
import { TeacherAuthService } from '../auth/teacherAuth'
import { hashToken } from '../auth/teacherCrypto'
import { HAS_PG, createTestEnv } from './helpers/testDb'
import type { TestEnv } from './helpers/testDb'

const DRAFT = 'docs/phase5/drafts/006_teacher_sessions.DRAFT.sql'
const settings = `insert into public.app_settings (id, max_file_bytes, allowed_types, upload_window_minutes, login_max_failed_attempts, login_lock_minutes, login_attempts_retention_days) values (true, 50000000, '{pdf,docx,png}', 120, 5, 15, 90) on conflict (id) do update set login_max_failed_attempts = 5, login_lock_minutes = 15;`

if (!HAS_PG) {
  describe('PgAuthStore — تخطّي: لا ATHAR_TEST_PG (لم يُجرَّب على قاعدة)', () => { it('نائب: لا يختبر شيئًا', () => {}) })
} else {
  describe('PgAuthStore على Postgres محلي', () => {
    let env: TestEnv
    let store: PgAuthStore
    let svc: TeacherAuthService
    const T1 = '00000000-0000-0000-0000-000000000001'
    const T2 = '00000000-0000-0000-0000-000000000002'

    it('تهيئة: 001–004 + مسودة 006', async () => {
      env = await createTestEnv({ extraFiles: [DRAFT] })
      await env.admin.transaction((c) => c.exec(settings))
      store = new PgAuthStore(env.db)
      svc = new TeacherAuthService(store, { codePepper: randomBytes(32), ipPepper: randomBytes(32) })
    })

    it('إصدار ثم دخول ثم مصادقة ثم خروج على القاعدة', async () => {
      const a = await svc.issueCredentials(T1)
      const r = await svc.login({ code: a.code, ip: '203.0.113.5' })
      expect((await svc.authenticate(r.token)).teacherId).toBe(T1)
      const rows = await env.admin.transaction((c) => c.query<{ token_hash: string }>('select token_hash from public.teacher_sessions'))
      expect(rows.map((x) => x.token_hash)).toContain(hashToken(r.token))
      expect(JSON.stringify(rows).includes(r.token)).toBe(false)
      await svc.logout(r.token)
      let denied = false
      try { await svc.authenticate(r.token) } catch { denied = true }
      expect(denied).toBe(true)
    })

    it('تصادم code_hash يُرمى code_collision (فهرس 006 الفريد)', async () => {
      const row = await env.admin.transaction((c) => c.query<{ h: string }>('select code_hash as h from public.teacher_credentials where teacher_id = $1', [T1]))
      let code = ''
      try { await store.setCredentials(T2, { codeHash: row[0]!.h, codeExpiresAt: null }) } catch (e) { code = (e as { code?: string }).code ?? 'other' }
      expect(code).toBe('code_collision')
    })

    it('الحد العام والحد لكل عنوان من سجل المحاولات، والزمن من ساعة القاعدة', async () => {
      for (let i = 0; i < 3; i++) await store.logAttempt(null, 'h'.repeat(64), 'unknown_code')
      await store.logAttempt(null, 'h'.repeat(64), 'success')
      expect(await store.countIpFailures('h'.repeat(64), 15)).toBe(3)
      expect(await store.countRecentFailures(15)).toBeGreaterThanOrEqual(3)
      const t = await store.now()
      expect(Math.abs(t.getTime() - Date.now())).toBeLessThan(60_000)
    })

    it('تنظيف قاعدة الاختبار', async () => { await env.dispose() })
  })
}
