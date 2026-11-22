// @vitest-environment node
// ownerRelease وoverview. القسم الأول (تحقق المدخلات) يعمل بلا قاعدة بقاعدة وهمية ترمي إن استُعملت؛
// القسم الثاني يحتاج PostgreSQL محليًا (ATHAR_TEST_PG) وكُتب **ولم يُشغَّل** في بيئة الكتابة.
import { describe, it, expect } from 'vitest'
import { MemoryStorageAdapter } from '../../src/lib/storage/memory'
import type { Db } from '../db/types'
import { ServiceError } from '../services/errors'
import { UploadService } from '../services/uploadService'
import { HAS_PG, createTestEnv } from './helpers/testDb'

const neverDb: Db = {
  async transaction() { throw new Error('DB_TOUCHED') },
  async close() {},
}
async function code(p: Promise<unknown>): Promise<string> {
  try { await p } catch (e) { return e instanceof ServiceError ? `${e.code}` : `other:${(e as Error).message}` }
  return 'ok'
}
const SID = '11111111-1111-4111-8111-111111111111'
const svc0 = new UploadService({ db: neverDb, storage: new MemoryStorageAdapter() })

const ACTOR = '11111111-1111-1111-1111-111111111111'

describe('ownerRelease/overview — تحقق المدخلات قبل لمس القاعدة', () => {
  it('الملاحظة إلزامية ولا تُقبل فراغًا ولا مسافات', async () => {
    for (const note of ['', '   ', '\n\t', undefined as unknown as string, 5 as unknown as string]) expect(await code(svc0.ownerRelease({ sessionId: SID, note , actorUserId: ACTOR }))).toBe('note_required')
  })
  it('ملاحظة أطول من 1000 محرف تُرفض', async () => {
    expect(await code(svc0.ownerRelease({ sessionId: SID, note: 'x'.repeat(1001) , actorUserId: ACTOR }))).toBe('bad_request')
  })
  it('معرّف جلسة مشوّه ⇒ not_found بلا لمس القاعدة', async () => {
    for (const id of ['', 'x', '../x', "1' or '1'='1", SID.slice(1), 5 as unknown as string]) expect(await code(svc0.ownerRelease({ sessionId: id, note: 'عطل' , actorUserId: ACTOR }))).toBe('not_found')
  })
  it('منفِّذة غير صالحة (actorUserId) ⇒ bad_request قبل لمس القاعدة', async () => {
    for (const a of ['', 'x', undefined as unknown as string]) expect(await code(svc0.ownerRelease({ sessionId: SID, note: 'عطل', actorUserId: a }))).toBe('bad_request')
  })
  it('ملاحظة بطول 1000 بالضبط تتجاوز التحقق (تصل للقاعدة)', async () => {
    expect(await code(svc0.ownerRelease({ sessionId: SID, note: 'x'.repeat(1000) , actorUserId: ACTOR }))).toBe('other:DB_TOUCHED')
  })
  it('overview يرفض معرّف فصل مشوّهًا', async () => {
    for (const id of ['', 'x', "1;drop", 5 as unknown as string]) expect(await code(svc0.overview(id))).toBe('bad_request')
  })
})

if (!HAS_PG) {
  describe('ownerRelease/overview على قاعدة — تخطّي: لا ATHAR_TEST_PG (لم يُجرَّب على قاعدة)', () => { it('نائب: لا يختبر شيئًا', () => {}) })
} else {
  describe('ownerRelease/overview على Postgres محلي', () => {
    it('إفراج جلسة uploaded بملاحظة وعلامة عطل ثم رفض الإعادة وعدّ overview', async () => {
      const env = await createTestEnv({ withStaff: true, extraFiles: ['database/006_teacher_sessions.sql', 'database/007_server_additions.sql', 'database/012_teacher_delete.sql'] })
      await env.admin.transaction((c) => c.exec(`insert into auth.users (id, email) values ('${ACTOR}', 'o@example.invalid'); select public.bootstrap_staff('o@example.invalid', 'owner');`))
      try {
        const svc = new UploadService({ db: env.db, storage: new MemoryStorageAdapter() })
        const T = env.ids
        const s = await svc.start({ teacherId: T.teacher, termId: T.term, slotId: 's1', name: 'a.pdf', size: 100, idempotencyKey: 'k-1' })
        // نقل الجلسة إلى uploaded كأن الملف وصل (تجاوز المشغّلات لمشرف الاختبار فقط)
        await env.admin.transaction(async (c) => { await c.exec('set local session_replication_role = replica'); await c.exec("update public.upload_sessions set state = 'uploaded', uploaded_at = now() where id = $1", [s.sessionId]) })
        const before = await svc.overview(T.term)
        expect(before.sessionsByState.uploaded).toBe(1)
        expect(before.pending.length).toBe(1)
        expect(JSON.stringify(before).includes('pending/')).toBe(false) // لا مفاتيح تخزين
        const r = await svc.ownerRelease({ sessionId: s.sessionId, note: 'عطل في التخزين', platformFault: true , actorUserId: ACTOR })
        expect(r.state).toBe('cancelled')
        expect(await code(svc.ownerRelease({ sessionId: s.sessionId, note: 'مرة أخرى' , actorUserId: ACTOR }))).toBe('not_pending')
        const rows = await env.admin.transaction((c) => c.query<{ outcome: string; reason: string | null }>("select outcome, reason from public.upload_attempts where outcome = 'owner_released'"))
        expect(rows.map((x) => x.reason)).toEqual(['platform_fault: عطل في التخزين'])
        const after = await svc.overview(T.term)
        expect(after.pending.length).toBe(0)
        expect(after.sessionsByState.cancelled).toBe(1)
        expect(await code(svc.overview('00000000-0000-4000-8000-00000000dead'))).toBe('not_found')
      } finally { await env.dispose() }
    })
  })
}
