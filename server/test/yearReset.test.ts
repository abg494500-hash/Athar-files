// @vitest-environment node
// التصفير السنوي الحقيقي (A-118) على PostgreSQL محلي (ATHAR_TEST_PG) مع تخزين R2 بديل في الذاكرة.
// يثبت: البوابة تمنع، الحذف مقيّد بسنة واحدة، السنوات الأخرى والحسابات وaudit_log لا تتغير، الاستئناف بعد فشل ملف، التجميد، سجل الإغلاق.
import { describe, it, expect } from 'vitest'
import { ServiceError } from '../services/errors'
import { YearArchiveService } from '../services/yearArchiveService'
import { YearResetService } from '../services/yearResetService'
import type { ResetStorage } from '../services/yearResetService'
import { HAS_PG, createTestEnv } from './helpers/testDb'
import type { TestEnv } from './helpers/testDb'

const OWNER = '00000000-0000-0000-0000-0000000000a1'
const DIRECTOR = '00000000-0000-0000-0000-0000000000d1'
const OLD_YEAR = '00000000-0000-0000-0000-0000000000f0'
const OLD_TERM = '00000000-0000-0000-0000-0000000000f1'
const V = (n: number) => `00000000-0000-0000-0000-00000000c${String(n).padStart(3, '0')}`
const hex = (c: string) => c.repeat(64)
const signer = { presignGet: (k: string) => ({ url: `https://get.example/${k}`, expiresAt: new Date('2026-10-24T08:05:00Z') }) }
const code = async (p: Promise<unknown>): Promise<string> => { try { await p } catch (e) { return e instanceof ServiceError ? `${e.code}` : `other:${(e as { sqlstate?: string }).sqlstate ?? (e as Error).message}` } return 'ok' }
const PN = ['athar-archive-r-20270620-part-01-of-02.zip', 'athar-archive-r-20270620-part-02-of-02.zip']
const PSHA = [hex('a'), hex('b')]

class MemR2 implements ResetStorage {
  keys = new Set<string>()
  failOn = new Set<string>()
  stillThere = new Set<string>() // يحاكي حذفًا «ناجحًا» لكن الكائن ما زال موجودًا
  removed: string[] = []
  async removeObjectForYearReset(k: string) { if (this.failOn.has(k)) throw new Error('r2_delete_failed:500'); this.removed.push(k); if (!this.stillThere.has(k)) this.keys.delete(k) }
  async objectExists(k: string) { return this.keys.has(k) }
}

if (!HAS_PG) {
  describe('التصفير السنوي على قاعدة — تخطٍّ: لا ATHAR_TEST_PG (لم يُجرَّب على قاعدة)', () => { it('نائب', () => {}) })
} else {
  describe('التصفير السنوي (Postgres محلي + R2 بديل)', () => {
    let env: TestEnv; let ya: YearArchiveService; let rs: YearResetService; const r2 = new MemR2()
    let year: string; let archiveId: string; let digest: string
    const sql = (q: string, p: unknown[] = []) => env.admin.transaction(async (c) => { await c.exec('set local session_replication_role = replica'); await c.exec(q, p) })
    const rows = <T>(q: string, p: unknown[] = []) => env.admin.transaction((c) => c.query<T>(q, p))
    const n = async (q: string, p: unknown[] = []) => Number((await rows<{ n: string }>(`select count(*)::text as n from ${q}`, p))[0]!.n)
    const addFile = (k: number, teacher: string, term: string, slot: string, no: number) => { r2.keys.add(`final/key-${k}`); return sql(
      `insert into public.submissions (teacher_id, term_id, slot_id) values ($1, $2, $3) on conflict do nothing;
       insert into public.versions (id, teacher_id, term_id, slot_id, no, kind, original_name, size_bytes, ext, storage_provider, storage_bucket, storage_key, sha256, submitted_at, status_snapshot, deadlines_snapshot, validated_at, validation_result, upload_session_id)
       values ($4, $1, $2, $3, $5, 'file', 'f.pdf', 1000, 'pdf', 'r2', 'b', $6, $7, now(), 'on_time', '{}'::jsonb, now(), '{}'::jsonb, gen_random_uuid())`, [teacher, term, slot, V(k), no, `final/key-${k}`, hex(String(k))]) }
    const auditHash = async (max: number) => (await rows<{ h: string }>(`select md5(string_agg(entry_hash || prev_hash || detail::text, ',' order by id)) as h from public.audit_log where id <= $1`, [max]))[0]!.h
    const auditMax = async () => Number((await rows<{ m: string }>('select coalesce(max(id),0)::text as m from public.audit_log'))[0]!.m)
    const allTriggersOn = async () => await n(`pg_trigger where tgname in ('versions_no_delete','submissions_no_delete','archives_no_delete','archive_entries_no_delete','archive_parts_no_delete','deletion_requests_no_delete','upload_sessions_no_delete','upload_sessions_guard_update_bu','upload_attempts_no_mutation','audit_log_chain_bi','audit_log_no_update_delete','audit_log_no_truncate') and tgenabled = 'O'`)

    it('تهيئة 001..010 + مالكة ومديرة + سنة بفصلين وملفات + سنة قديمة بنسخة', async () => {
      env = await createTestEnv({ withStaff: true, extraFiles: ['database/006_teacher_sessions.sql', 'database/007_server_additions.sql', 'database/008_teacher_removal.sql', 'database/009_archive_parts.sql', 'database/010_year_reset.sql', 'database/011_years_teachers_import.sql', 'database/012_teacher_delete.sql', 'database/013_reset_for_staff.sql', 'database/014_reset_light_gate.sql', 'database/015_reset_teachers.sql'] })
      await env.admin.transaction((c) => c.exec(`insert into auth.users (id, email) values ('${OWNER}', 'o@example.invalid'), ('${DIRECTOR}', 'd@example.invalid'); select public.bootstrap_staff('o@example.invalid', 'owner'); select public.bootstrap_staff('d@example.invalid', 'director');`))
      year = (await rows<{ id: string }>(`select id from public.years where label = '2026-2027'`))[0]!.id
      await addFile(1, env.ids.teacher, env.ids.term, 's1', 1); await addFile(2, env.ids.teacher2, env.ids.term, 's1', 1); await addFile(3, env.ids.teacher, env.ids.termClosed, 's1', 1)
      await sql(`insert into public.years (id, label) values ('${OLD_YEAR}', '2025-2026');
                 insert into public.terms (id, year_id, name, ord, deadline_base, deadline_late, deadline_replace) values ('${OLD_TERM}', '${OLD_YEAR}', 'ف1', 1, current_date, current_date, current_date)`)
      await addFile(9, env.ids.teacher, OLD_TERM, 's1', 1)
      ya = new YearArchiveService({ db: env.db, signer }); rs = new YearResetService({ db: env.db, storage: r2, sliceSize: 2 })
    })

    it('قبل وجود أرشيف (r41): البوابة جاهزة (التصفير بلا أرشفة مسموح)، والبدء بتأكيد خاطئ مرفوض، ولا يُحذف شيء', async () => {
      const s = await rs.status(year); expect(s.state).toBe('ready'); expect(s.gate.problems).not.toContain('no_year_archive'); expect(s.gate.ready).toBe(true); expect(s.gate.archiveId).toBeNull()
      expect(await code(rs.start({ yearId: year, typedConfirmation: 'خطأ', actorUserId: OWNER }))).not.toBeNull()
      expect(await n('public.versions')).toBe(4); expect(await n('public.year_resets')).toBe(0); expect(r2.keys.size).toBe(4)
    })

    it('بناء الأرشيف المحلي وتسجيله وتحقق الأجزاء والنسخة الثانية والإقرار ⇒ البوابة جاهزة (لكن لا تصفير بعد)', async () => {
      const p = await ya.plan(year, 1_000_000_000); digest = p.entriesDigest
      // ثلاثة ملفات صغيرة ⇒ جزء واحد؛ نسجّل جزأين فقط إن أنتج الخادم جزأين. نقرأ عدد الأجزاء من الخطة.
      const parts = p.layout.parts.map((_x, i) => ({ no: i + 1, filename: PN[i]!.replace('of-02', `of-0${p.layout.parts.length}`), sha256: PSHA[i % 2]!.replace(/./g, String.fromCharCode(97 + i)), size: 1000 * (i + 1) }))
      const reg = await ya.register({ yearId: year, title: 'أرشيف 2026-2027', targetBytes: 1_000_000_000, parts, entriesDigest: digest, actorUserId: OWNER })
      archiveId = reg.id
      for (const x of parts) { expect(await ya.confirmPart({ archiveId, partNo: x.no, sha256: x.sha256, actorUserId: OWNER })).toMatchObject({ verified: true }) }
      await ya.ack({ archiveId, kind: 'opened_locally', actorUserId: OWNER })
      expect((await rs.status(year)).gate.ready).toBe(true) // A-127: لا تُشترط النسخة الثانية ولا الإقرار
      for (const x of parts) await ya.confirmCopy({ archiveId, partNo: x.no, sha256: x.sha256, medium: 'external_drive', independent: true, actorUserId: OWNER })
      expect(await rs.status(year)).toMatchObject({ state: 'ready', gate: { ready: true, problems: [], archiveId } })
    })

    it('رفع معلّق في السنة يمنع البوابة؛ وعند انتهائه تُفتح ويُجمع مفتاحه المعلّق للحذف', async () => {
      r2.keys.add('pending/p1')
      await sql(`insert into public.upload_sessions (id, teacher_id, term_id, slot_id, declared_name, declared_size, pending_key, state, expires_at, idempotency_key, status_at_start, effective_start_at)
                 values ('00000000-0000-0000-0000-0000000005e1', $1, $2, 's2', 'x.pdf', 10, 'pending/p1', 'started', now() + interval '1 hour', 'idem-1', 'on_time', now())`, [env.ids.teacher, env.ids.term])
      expect((await rs.status(year)).gate.problems).toContain('pending_uploads:1')
      expect(await code(rs.start({ yearId: year, typedConfirmation: '2026-2027', actorUserId: OWNER }))).toBe('not_ready')
      await sql(`update public.upload_sessions set state = 'expired', finished_at = now(), reject_reason = 'expired' where id = '00000000-0000-0000-0000-0000000005e1'`)
      expect((await rs.status(year)).gate.ready).toBe(true)
    })

    it('أرشيف سحابي قديم لا يمنع البوابة (A-127) ويُحذف مفتاحه مع التصفير', async () => {
      await sql(`insert into public.archives (id, title, year_id, term_id, state, size_bytes, entries_count, sha256, storage_provider, storage_key) values ('00000000-0000-0000-0000-00000000a0e1', 'قديم', $1, $2, 'verified', 10, 0, $3, 'r2', 'legacy/arch-1.zip')`, [year, env.ids.term, hex('7')])
      r2.keys.add('legacy/arch-1.zip')
      expect((await rs.status(year)).gate.problems).not.toContain('legacy_archives_not_transferred:1')
      await sql(`update public.archives set download_hash_verified_at = now(), download_completed_at = now() where id = '00000000-0000-0000-0000-00000000a0e1'`)
      expect((await rs.status(year)).gate.ready).toBe(true)
    })

    it('تقرير ما قبل التصفير: أعداد السنة فقط، وما سيبقى', async () => {
      const r = await rs.report(year)
      expect(r).toMatchObject({ yearLabel: '2026-2027', teachers: 2, submissions: 3, versions: 3, files: 3, links: 0 })
      expect((r.toDelete as Record<string, number>).r2_objects).toBe(5) // 3 إصدارات + مفتاح معلّق + أرشيف سحابي قديم
      expect((r.stays as Record<string, number>).staff_accounts).toBe(2); expect((r.stays as Record<string, number>).other_years_versions).toBe(1)
      // r41: المعلمة الثانية لا أثر لها في سنة أخرى فتُحذف مع السنة؛ الأولى لها إصدار في سنة قديمة فتبقى
      expect((r.toDelete as Record<string, number>).teachers).toBe(1); expect((r.stays as Record<string, number>).teachers).toBe(1)
      expect(JSON.stringify(r)).not.toMatch(/final\/key|code_hash|pin_hash/)
    })

    it('نص تأكيد خاطئ إن أُرسل، أو حساب ليس مالكة ولا مديرة ⇒ مرفوض قبل أي أثر', async () => {
      expect(await code(rs.start({ yearId: year, typedConfirmation: 'تصفير', actorUserId: OWNER }))).toBe('bad_request')
      expect(await code(rs.start({ yearId: year, actorUserId: '00000000-0000-0000-0000-00000000dead' }))).toBe('bad_request')
      expect(await n('public.year_resets')).toBe(0); expect(r2.keys.size).toBe(6) // 5 للسنة + مفتاح السنة القديمة
    })

    it('حذف مباشر خارج المسار (purge قبل حذف R2) مرفوض، ولا يبقى مشغّل موقوفًا', async () => {
      // لا عملية بعد ⇒ نبدأها بتخزين يفشل في مفتاح واحد
      r2.failOn.add('final/key-2')
      const before = { audit: await auditMax() }
      const out = await rs.start({ yearId: year, actorUserId: DIRECTOR }) // المديرة تبدأ التصفير (A-126) بلا نص تأكيد؛ البوابة هي الحارس
      expect(out.done).toBe(false)
      expect(await code(env.db.transaction((c) => c.exec(`select public.year_reset_purge('${out.status.reset!.id}')`)))).toBe('other:23514')
      expect(await n('public.versions')).toBe(4) // لا شيء حُذف
      expect(await allTriggersOn()).toBe(12)
      expect(await auditHash(before.audit)).toBeTruthy()
    })

    it('الحالة بعد فشل ملف: partial لا completed، المفتاح الفاشل failed، السنة مجمّدة وغير نشطة', async () => {
      // شرائح 2: نكرر الاستئناف حتى لا يتقدم شيء (المفتاح الفاشل يبقى)
      let last = await rs.resume({ yearId: year, actorUserId: OWNER }); for (let i = 0; i < 5; i++) last = await rs.resume({ yearId: year, actorUserId: OWNER })
      expect(last.done).toBe(false); expect(last.status.state).toBe('partial')
      expect(last.status.reset!.keys).toMatchObject({ failed: 1, total: 5 }); expect(last.status.reset!.keys.verifiedAbsent).toBe(4)
      expect(await n('public.versions')).toBe(4)
      expect(await n(`public.years where id = $1 and is_active = false`, [year])).toBe(1)
      await expect(env.db.transaction((c) => c.exec(`insert into public.submissions (teacher_id, term_id, slot_id) values ('${env.ids.teacher2}', '${env.ids.term}', 's2')`))).rejects.toThrow(/مغلقة|قيد التصفير/)
      expect(r2.keys.has('final/key-9')).toBe(true) // ملف السنة القديمة لم يُمسّ
    })

    it('ملف يبقى بعد «حذف ناجح» ⇒ لا يُوسَم متحقَّقًا ولا تكتمل العملية', async () => {
      r2.failOn.clear(); r2.keys.add('final/key-2'); r2.stillThere.add('final/key-2')
      const out = await rs.resume({ yearId: year, actorUserId: OWNER })
      expect(out.status.state).toBe('partial'); expect(out.status.reset!.keys.failed).toBe(1)
      expect(await n('public.versions')).toBe(4)
    })

    it('بعد زوال العطل: الاستئناف يكمل ⇒ completed، وR2 خالٍ من ملفات السنة ويبقى ملف السنة الأخرى', async () => {
      r2.stillThere.clear()
      const auditBefore = await auditMax(); const hashBefore = await auditHash(auditBefore)
      const out = await rs.resume({ yearId: year, actorUserId: OWNER })
      expect(out.done).toBe(true); expect(out.status.state).toBe('completed'); expect(out.status.reset!.phase).toBe('done')
      expect([...r2.keys]).toEqual(['final/key-9'])
      for (const t of ['public.versions v join public.terms t on t.id = v.term_id where t.year_id = $1', 'public.submissions s join public.terms t on t.id = s.term_id where t.year_id = $1', 'public.upload_sessions s join public.terms t on t.id = s.term_id where t.year_id = $1', 'public.archives where year_id = $1']) expect(await n(t, [year])).toBe(0)
      expect(await n('public.archive_entries')).toBe(0); expect(await n('public.archive_parts')).toBe(0); expect(await n('public.upload_attempts where session_id is not null')).toBe(0)
      // السنة الأخرى كما هي
      expect(await n('public.versions')).toBe(1); expect(await n('public.submissions')).toBe(1)
      // الحسابات
      expect(await n('public.staff_profiles where is_active')).toBe(2); expect(await n('public.teachers')).toBe(1); expect(await n(`public.teachers where id = '${env.ids.teacher2}'`)).toBe(0); expect(await n(`public.teacher_credentials where teacher_id = '${env.ids.teacher2}'`)).toBe(0); expect(await n('auth.users')).toBe(2)
      // السنة وفصولها باقية بلا محتوى
      expect(await n('public.years')).toBe(2); expect(await n('public.terms')).toBe(3)
      // audit_log: السطور القديمة كما هي حرفيًا، وأُضيف سطران فقط
      expect(await auditHash(auditBefore)).toBe(hashBefore)
      expect((await rows<{ action: string }>('select action from public.audit_log where id > $1 order by id', [auditBefore])).map((x) => x.action)).toEqual(['year_reset_completed'])
      expect(await n(`public.audit_log where action = 'year_reset_started'`)).toBe(1)
      expect(await allTriggersOn()).toBe(12)
      // سجل الإغلاق: بصمات مرجعية بلا محتوى
      expect(out.status.closure).toMatchObject({ yearLabel: '2026-2027', archiveTitle: 'أرشيف 2026-2027' })
      expect(out.status.closure!.parts.length).toBeGreaterThan(0); expect(out.status.closure!.parts[0]!.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(out.status.closure!.deleted).toMatchObject({ versions: 3, submissions: 3, archives: 2 })
      expect(JSON.stringify(out.status.closure)).not.toMatch(/final\/key|storage_key/)
    })

    it('سلامة سلسلة audit_log بعد التصفير (حساب السلسلة نفسها)', async () => {
      const r = await rows<{ ok: boolean }>(`select (public.verify_audit_chain()).ok as ok`).catch(() => null)
      if (r) expect(r[0]!.ok).toBe(true)
      else {
        // verify_audit_chain يشترط جلسة المالكة؛ نتحقق بأن كل سطر يشير لسابقه
        const bad = await rows<{ n: string }>(`select count(*)::text as n from (select entry_hash, lag(entry_hash) over (order by id) as p, prev_hash from public.audit_log) q where p is not null and prev_hash <> p`)
        expect(bad[0]!.n).toBe('0')
      }
    })

    it('بعد الاكتمال: الاستئناف لا يفعل شيئًا، والبدء مرة ثانية مرفوض، والكتابة على السنة المغلقة مرفوضة', async () => {
      const before = r2.removed.length
      expect((await rs.resume({ yearId: year, actorUserId: OWNER })).done).toBe(true); expect(r2.removed.length).toBe(before)
      expect(await code(rs.start({ yearId: year, typedConfirmation: '2026-2027', actorUserId: OWNER }))).toBe('not_ready')
      await expect(env.db.transaction((c) => c.exec(`insert into public.submissions (teacher_id, term_id, slot_id) values ('${env.ids.teacher}', '${env.ids.term}', 's1')`))).rejects.toThrow(/مغلقة|قيد التصفير/)
      await expect(env.db.transaction((c) => c.exec(`update public.year_closures set year_label = 'x'`))).rejects.toThrow()
    })

    it('سنة جديدة بعد التصفير: تُنشأ وتُفعَّل ويُقبل التسليم فيها (لا خلط مع السنة المغلقة)', async () => {
      await sql(`insert into public.years (id, label, is_active) values ('00000000-0000-0000-0000-0000000000f9', '2027-2028', true);
                 insert into public.terms (id, year_id, name, ord, deadline_base, deadline_late, deadline_replace) values ('00000000-0000-0000-0000-0000000000f8', '00000000-0000-0000-0000-0000000000f9', 'الفصل الأول', 1, current_date + 30, current_date + 40, current_date + 60)`)
      await env.db.transaction((c) => c.exec(`insert into public.submissions (teacher_id, term_id, slot_id) values ('${env.ids.teacher}', '00000000-0000-0000-0000-0000000000f8', 's1')`))
      expect(await n('public.submissions')).toBe(2)
    })
  })
}

describe('YearResetService — مدخلات مشوّهة (بلا قاعدة)', () => {
  const rs = new YearResetService({ db: {} as never, storage: new MemR2() })
  it('معرّفات غير صالحة ⇒ bad_request قبل أي وصول', async () => {
    expect(await code(rs.report('x'))).toBe('bad_request'); expect(await code(rs.status('x'))).toBe('bad_request')
    expect(await code(rs.start({ yearId: 'x', typedConfirmation: 'y', actorUserId: OWNER }))).toBe('bad_request')
    expect(await code(rs.resume({ yearId: OLD_YEAR, actorUserId: 'z' }))).toBe('bad_request')
  })
})
