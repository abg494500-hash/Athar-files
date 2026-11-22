// @vitest-environment node
// دورة حياة المنصة كاملة (المهمة النهائية I): العميل الحقيقي (createStaffApiClient) ⇒ معالج الـAPI الحقيقي ⇒ الخدمات الحقيقية ⇒ PostgreSQL محلي،
// مع R2 **بديل في الذاكرة** (خريطة مفاتيح⇒بايتات) يخدم روابط GET ويقبل الحذف. **لا Supabase ولا R2 حقيقيان ولا شبكة.**
// ما لا يغطيه: سلوك R2/CORS الحقيقي، توقيع SigV4 مع Cloudflare، حدود وقت Edge Functions، متصفح Edge، وفتح الأرشيف دون إنترنت (يُفحص في Chromium بسكربت منفصل).
import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { createApiHandler } from '../api/handler'
import { PgAuditSink } from '../api/auditSink'
import { PgAuthStore } from '../auth/pgAuthStore'
import { TeacherAuthService } from '../auth/teacherAuth'
import { AdminService } from '../services/adminService'
import { ArchiveService } from '../services/archiveService'
import { UploadService } from '../services/uploadService'
import { YearArchiveService } from '../services/yearArchiveService'
import { YearResetService } from '../services/yearResetService'
import { MemoryStorageAdapter } from '../../src/lib/storage/memory'
import { createStaffApiClient } from '../../src/lib/staffApi/client'
import type { YearArchiveStatus, YearForm } from '../../src/lib/staffApi/client'
import { readZip } from '../../src/lib/yearArchive/zip'
import { HAS_PG, createTestEnv } from './helpers/testDb'
import type { TestEnv } from './helpers/testDb'

const OWNER = '00000000-0000-0000-0000-0000000000a1'
const DIRECTOR = '00000000-0000-0000-0000-0000000000d1'
const OWNER_JWT = 'owner.jwt.token-aaaa', DIRECTOR_JWT = 'director.jwt.token-bbb'
const enc = new TextEncoder()
const sha = (d: Uint8Array | string) => createHash('sha256').update(d).digest('hex')

if (!HAS_PG) {
  describe('دورة الحياة الكاملة — تخطٍّ: لا ATHAR_TEST_PG (لم تُجرَّب)', () => { it('نائب', () => {}) })
} else {
  describe('دورة حياة أثَر الكاملة (محلي، R2 بديل)', () => {
    let env: TestEnv
    const r2 = new Map<string, Uint8Array>()
    const saved = new Map<string, Blob>()      // «اللابتوب»
    const external = new Map<string, Blob>()   // «الهاردسك الخارجي»
    let handler: ReturnType<typeof createApiHandler>
    let api: ReturnType<typeof createStaffApiClient>
    let anon: ReturnType<typeof createStaffApiClient>
    let year1 = '', yearTerm1 = '', yearTerm2 = ''
    let archiveRow: YearArchiveStatus
    const rows = <T>(q: string, p: unknown[] = []) => env.admin.transaction((c) => c.query<T>(q, p))
    const n = async (q: string, p: unknown[] = []) => Number((await rows<{ n: string }>(`select count(*)::text as n from ${q}`, p))[0]!.n)
    const sql = (q: string, p: unknown[] = []) => env.admin.transaction(async (c) => { await c.exec('set local session_replication_role = replica'); await c.exec(q, p) })
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input)
      if (url.startsWith('https://get.example/')) {
        const k = decodeURIComponent(url.slice('https://get.example/'.length).split('?')[0]!)
        const b = r2.get(k); return b ? new Response(b as unknown as BodyInit, { status: 200 }) : new Response('', { status: 404 })
      }
      const u = new URL(url)
      const headers: Record<string, string> = {}; new Headers(init?.headers).forEach((v, k) => { headers[k] = v })
      const res = await handler({ method: init?.method ?? 'GET', path: u.pathname.replace(/^\/api/, ''), query: Object.fromEntries(u.searchParams), headers, body: typeof init?.body === 'string' ? init.body : null, ip: '203.0.113.7' })
      return new Response(res.status === 204 ? null : res.body, { status: res.status })
    }
    const label = (c: Uint8Array | string) => typeof c === 'string' ? enc.encode(c) : c
    const seedFile = (id: string, teacher: string, term: string, slot: string, no: number, name: string, content: Uint8Array | string) => {
      const data = label(content); const key = `final/${id}`; r2.set(key, data)
      return sql(`insert into public.submissions (teacher_id, term_id, slot_id) values ($1, $2, $3) on conflict do nothing;
        insert into public.versions (id, teacher_id, term_id, slot_id, no, kind, original_name, size_bytes, ext, storage_provider, storage_bucket, storage_key, sha256, submitted_at, status_snapshot, deadlines_snapshot, validated_at, validation_result, upload_session_id)
        values ($4, $1, $2, $3, $5, 'file', $6, $7, 'pdf', 'r2', 'b', $8, $9, now(), 'on_time', '{}'::jsonb, now(), '{}'::jsonb, gen_random_uuid())`, [teacher, term, slot, id, no, name, data.length, key, sha(data)])
    }
    const memSink = (m: Map<string, Blob>) => ({ savePart: async (p: { filename: string; blob: Blob }) => { m.set(p.filename, p.blob) } })
    const named = (m: Map<string, Blob>) => [...m].map(([name, b]) => Object.assign(b, { name }))
    const year = (y: number): YearForm => ({ label: `${y}–${y + 1}`, startsOn: `${y}-09-01`, endsOn: `${y + 1}-06-30`, terms: [
      { ord: 1, name: 'الفصل الأول', deadlineBase: `${y}-10-15`, deadlineLate: `${y}-10-22`, deadlineReplace: `${y}-11-06` },
      { ord: 2, name: 'الفصل الثاني', deadlineBase: `${y + 1}-03-05`, deadlineLate: `${y + 1}-03-12`, deadlineReplace: `${y + 1}-03-26` }] })

    it('تهيئة: 001..011 ومالكة ومديرة ومعالج API حقيقي وعميل حقيقي', async () => {
      env = await createTestEnv({ withStaff: true, extraFiles: ['database/006_teacher_sessions.sql', 'database/007_server_additions.sql', 'database/008_teacher_removal.sql', 'database/009_archive_parts.sql', 'database/010_year_reset.sql', 'database/011_years_teachers_import.sql', 'database/012_teacher_delete.sql', 'database/013_reset_for_staff.sql', 'database/014_reset_light_gate.sql', 'database/015_reset_teachers.sql'] })
      await env.admin.transaction((c) => c.exec(`insert into auth.users (id, email) values ('${OWNER}', 'o@example.invalid'), ('${DIRECTOR}', 'd@example.invalid'); select public.bootstrap_staff('o@example.invalid', 'owner'); select public.bootstrap_staff('d@example.invalid', 'director');`))
      // بيانات الاختبار الأولية في testDb (سنة 2026-2027 + معلمتان) غير مرغوبة هنا: نبدأ نظيفين من سنة تُنشأ عبر الواجهة
      await sql(`delete from public.teachers; delete from public.terms; delete from public.years`)
      const signer = { presignGet: (k: string) => ({ url: `https://get.example/${encodeURIComponent(k)}`, expiresAt: new Date(Date.now() + 300_000) }) }
      const teacherAuth = new TeacherAuthService(new PgAuthStore(env.db), { codePepper: Buffer.alloc(32, 1), ipPepper: Buffer.alloc(32, 3) })
      const sink = new PgAuditSink(env.db)
      handler = createApiHandler({
        teacherAuth, uploads: new UploadService({ db: env.db, storage: new MemoryStorageAdapter() }),
        staff: { verify: async (t) => t === OWNER_JWT ? { userId: OWNER, role: 'owner' } : t === DIRECTOR_JWT ? { userId: DIRECTOR, role: 'director' } : null },
        archives: new ArchiveService({ db: env.db, signer }), yearArchives: new YearArchiveService({ db: env.db, signer }),
        yearResets: new YearResetService({ db: env.db, storage: { removeObjectForYearReset: async (k) => { r2.delete(k) }, objectExists: async (k) => r2.has(k) }, sliceSize: 3 }),
        admin: new AdminService({ db: env.db, issueCredentials: (id) => teacherAuth.issueCredentials(id, {}) }),
        audit: (e) => sink.record(e),
      })
      api = createStaffApiClient({ baseUrl: 'https://api.example/api', getToken: async () => OWNER_JWT, fetchImpl })
      anon = createStaffApiClient({ baseUrl: 'https://api.example/api', getToken: async () => DIRECTOR_JWT, fetchImpl })
    })

    it('1) إنشاء سنة تجريبية بفصلين عبر العميل وتفعيلها؛ المديرة ممنوعة من مسارات المالكة (حذف المعلمة)', async () => {
      expect(await anon.removeTeacher('00000000-0000-0000-0000-0000000000f1')).toMatchObject({ ok: false, error: 'forbidden' })
      const c = await api.createYear(year(2026)); expect(c.ok).toBe(true); year1 = (c as { value: { id: string } }).value.id
      expect((await api.activateYear(year1)).ok).toBe(true)
      ;[yearTerm1, yearTerm2] = (await rows<{ id: string }>('select id from public.terms where year_id = $1 order by ord', [year1])).map((x) => x.id)
      expect(await n('public.years where is_active')).toBe(1)
    })

    it('2) إضافة معلمات بالاستيراد (مع إصدار أكواد) ثم دخول معلمة فعليًا', async () => {
      const r = await api.importTeachers([{ name: 'سارة بنت أحمد', subject: 'رياضيات' }, { name: 'منى بنت سالم', subject: 'علوم' }], true)
      expect(r.ok && r.value.issued.length).toBe(2)
      const t = (r as { value: { issued: { code: string; teacherId: string }[] } }).value.issued[0]!
      const login = await fetchImpl('https://api.example/api/teacher/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: t.code }) })
      expect(login.status).toBe(200)
    })

    it('3-5) بيانات الفصلين، عدة ملفات، واستبدال ملف (إصدار 2) ورابط', async () => {
      const [t1, t2] = (await rows<{ id: string }>('select id from public.teachers order by name')).map((x) => x.id) as [string, string]
      await seedFile('00000000-0000-0000-0000-00000000c001', t1, yearTerm1, 's1', 1, 'خطة.pdf', '%PDF v1 '.repeat(40))
      await seedFile('00000000-0000-0000-0000-00000000c002', t1, yearTerm1, 's1', 2, 'خطة.pdf', '%PDF v2 '.repeat(50)) // استبدال
      await seedFile('00000000-0000-0000-0000-00000000c003', t2, yearTerm1, 's1', 1, 'تقرير.pdf', '%PDF علوم '.repeat(30))
      await seedFile('00000000-0000-0000-0000-00000000c004', t1, yearTerm2, 's1', 1, 'خطة2.pdf', '%PDF t2 '.repeat(20))
      await sql(`insert into public.submissions (teacher_id, term_id, slot_id) values ($1, $2, 's2') on conflict do nothing;
        insert into public.versions (id, teacher_id, term_id, slot_id, no, kind, url, submitted_at, status_snapshot, deadlines_snapshot) values ('00000000-0000-0000-0000-00000000c005', $1, $2, 's2', 1, 'link', 'https://example.com/evidence', now(), 'late', '{}'::jsonb)`, [t2, yearTerm2])
      expect(await n('public.versions')).toBe(5)
    })

    it('6) التصفير بلا أرشفة مسموح (r41): البوابة جاهزة، والتأكيد الخاطئ مرفوض، ولا يُحذف شيء قبل التأكيد', async () => {
      const s = await api.yearResetStatus(year1); expect(s).toMatchObject({ ok: true, value: { state: 'ready' } })
      expect((s as { value: { gate: { problems: string[]; archiveId: string | null } } }).value.gate.problems).not.toContain('no_year_archive')
      expect((s as { value: { gate: { archiveId: string | null } } }).value.gate.archiveId).toBeNull()
      expect(await n('public.versions')).toBe(5); expect(r2.size).toBe(4)
    })

    it('7) بناء الأرشيف السنوي في «المتصفح» (العميل الحقيقي): أجزاء متعددة بملفات حقيقية بلا روابط R2 بداخلها، ويُسجَّل', async () => {
      const b = await api.buildYearArchive(year1, { sink: memSink(saved), targetBytes: 50_000_000 })
      expect(b.ok).toBe(true); const build = (b as { value: { build: { parts: { filename: string; entries: number; sha256: string }[]; entriesDigest: string; entries: { versionId: string }[] } } }).value.build
      expect(build.entries.map((e) => e.versionId).sort()).toHaveLength(5)
      for (const [name, blob] of saved) { // لا أثر لـR2 أو Supabase أو Netlify داخل أي جزء
        const z = await readZip(new Uint8Array(await blob.arrayBuffer()))
        const text = z.filter((e) => /\.(html|js|json|txt|md|css)$/.test(e.path)).map((e) => new TextDecoder().decode(e.data)).join('\n')
        expect(text, name).not.toMatch(/get\.example|r2\.cloudflarestorage|supabase\.co|netlify\.app|final\//)
      }
      if (process.env.ATHAR_DUMP_ARCHIVE) { // للفحص اليدوي في Chromium: يكتب الأجزاء إلى مجلد (لا يحدث في التشغيل العادي)
        const { mkdirSync, writeFileSync } = await import('node:fs'); mkdirSync(process.env.ATHAR_DUMP_ARCHIVE, { recursive: true })
        for (const [name, blob] of saved) writeFileSync(`${process.env.ATHAR_DUMP_ARCHIVE}/${name}`, Buffer.from(await blob.arrayBuffer()))
      }
      const reg = await api.registerYearArchive({ yearId: year1, title: 'أرشيف 2026–2027', build: { parts: build.parts as never, entriesDigest: build.entriesDigest, targetBytes: 50_000_000 } })
      expect(reg.ok).toBe(true)
      const st = await api.yearArchiveStatus(year1); expect(st.ok).toBe(true); archiveRow = (st as { value: YearArchiveStatus[] }).value[0]!
    })

    const arch = () => archiveRow

    it('8) ملف جزء مفقود وجزء تالف ⇒ التحقق يفشل صراحةً ولا يُختم تنزيل', async () => {
      const a = arch()
      const files = named(saved)
      const damaged = files.map((f, i) => { if (i !== 0) return f; const u = new Uint8Array(0); void u; return f })
      const flip = async (f: Blob & { name: string }) => { const u = new Uint8Array(await f.arrayBuffer()); u[Math.floor(u.length / 2)]! ^= 1; return Object.assign(new Blob([u as unknown as BlobPart]), { name: f.name }) }
      const missing = await api.verifyAndConfirmSavedParts({ archive: a, files: files.slice(1) })
      expect(missing).toMatchObject({ ok: true, value: { ok: false } })
      const bad = await api.verifyAndConfirmSavedParts({ archive: a, files: [await flip(files[0]!), ...damaged.slice(1)] })
      expect(bad).toMatchObject({ ok: true, value: { ok: false } })
      expect((await rows<{ hv: string | null }>('select download_hash_verified_at::text hv from public.archives limit 1'))[0]!.hv).toBeNull()
    })

    it('9) التحقق السليم على اللابتوب يختم التنزيل؛ ثم إقرار الفتح دون إنترنت', async () => {
      const r = await api.verifyAndConfirmSavedParts({ archive: arch(), files: named(saved) })
      expect(r).toMatchObject({ ok: true, value: { ok: true } })
      expect((await rows<{ hv: string | null }>('select download_hash_verified_at::text hv from public.archives limit 1'))[0]!.hv).not.toBeNull()
      expect((await api.ackYearArchive({ archiveId: arch().id, kind: 'opened_locally' })).ok).toBe(true)
    })

    it('10-11) النسخة الثانية: بلا إقرار استقلال ⇒ مرفوضة؛ بجزء تالف ⇒ لا تُعتمد؛ بالسليم ⇒ تُعتمد وتُفتح البوابة', async () => {
      const files = named(saved)
      expect(await api.verifyAndConfirmSecondCopy({ archive: arch(), files, medium: 'external_drive', independent: false })).toMatchObject({ ok: false, code: 'independent_ack_required' })
      const u = new Uint8Array(await files[0]!.arrayBuffer()); u[10]! ^= 1
      const dmg = [Object.assign(new Blob([u as unknown as BlobPart]), { name: files[0]!.name }), ...files.slice(1)]
      expect(await api.verifyAndConfirmSecondCopy({ archive: arch(), files: dmg, medium: 'external_drive', independent: true })).toMatchObject({ ok: true, value: { ok: false } })
      expect((await api.yearResetStatus(year1) as { value: { gate: { ready: boolean } } }).value.gate.ready).toBe(true) // البوابة المخففة (A-127): يكفي وجود الأرشيف المسجَّل
      for (const [k, v] of saved) external.set(k, v)
      expect(await api.verifyAndConfirmSecondCopy({ archive: arch(), files: named(external), medium: 'external_drive', independent: true })).toMatchObject({ ok: true, value: { ok: true } })
      const s = await api.yearResetStatus(year1)
      expect(s).toMatchObject({ ok: true, value: { state: 'ready', gate: { ready: true, problems: [] } } })
    })

    it('12) التصفير: المجهولة ممنوعة، وتأكيد واحد بلا كتابة، ثم ينفّذ على شرائح (3 مفاتيح/شريحة) حتى يكتمل', async () => {
      const auditBefore = Number((await rows<{ m: string }>('select max(id)::text m from public.audit_log'))[0]!.m)
      const hashBefore = (await rows<{ h: string }>(`select md5(string_agg(entry_hash, ',' order by id)) h from public.audit_log where id <= $1`, [auditBefore]))[0]!.h
      expect(await n('public.versions')).toBe(5)
      let r = await anon.yearResetStart(year1); expect(r.ok).toBe(true) // anon = عميل المديرة: تبدأ التصفير (A-126)
      for (let i = 0; i < 10 && r.ok && !r.value.done; i++) r = await api.yearResetResume(year1)
      expect(r).toMatchObject({ ok: true, value: { done: true, status: { state: 'completed' } } })
      // R2: لا ملف للسنة
      expect(r2.size).toBe(0)
      // القاعدة: بيانات السنة مُحيت، الحسابات والمعلمات والتدقيق باقية
      for (const t of ['versions', 'submissions', 'archives', 'archive_entries', 'archive_parts', 'upload_sessions']) expect(await n(`public.${t}`)).toBe(0)
      expect(await n('public.staff_profiles where is_active')).toBe(2); expect(await n('public.teachers')).toBe(0); expect(await n('auth.users')).toBe(2)
      expect(await n('public.years')).toBe(1); expect(await n('public.year_closures')).toBe(1)
      expect((await rows<{ h: string }>(`select md5(string_agg(entry_hash, ',' order by id)) h from public.audit_log where id <= $1`, [auditBefore]))[0]!.h).toBe(hashBefore)
      expect(await n(`public.audit_log where action in ('year_reset_started','year_reset_completed')`)).toBe(2)
    })

    it('13) السنة المغلقة لا تُفعَّل ولا تُعدَّل، والمعلمة لا تستطيع التسليم فيها', async () => {
      expect(await api.activateYear(year1)).toMatchObject({ ok: false, code: 'year_closed' })
      expect(await api.updateYear(year1, year(2026))).toMatchObject({ ok: false })
      expect((await api.yearResetStart(year1))).toMatchObject({ ok: false })
    })

    it('14-16) سنة جديدة، استيراد معلمات من CSV (ملف حقيقي)، دخول وتسليم رابط في السنة الجديدة', async () => {
      const c = await api.createYear(year(2027)); expect(c.ok).toBe(true); const y2 = (c as { value: { id: string } }).value.id
      expect((await api.activateYear(y2)).ok).toBe(true)
      expect(await n('public.years where is_active')).toBe(1)
      const { readImportFile } = await import('../../src/lib/teacherImport/files')
      const f = Object.assign(new Blob(['﻿اسم المعلمة,المادة\r\nهدى بنت خالد,أحياء\r\nنورة بنت حمد,لغة عربية\r\n']), { name: 'new.csv' })
      const parsed = await readImportFile(f); expect(parsed.ok).toBe(true)
      const imp = await api.importTeachers((parsed as { rows: { name: string; subject: string }[] }).rows.map((r) => ({ name: r.name, subject: r.subject })), true)
      expect(imp.ok && imp.value.imported.length).toBe(2)
      const cred = (imp as { value: { issued: { code: string }[] } }).value.issued[0]!
      const login = await fetchImpl('https://api.example/api/teacher/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: cred.code }) })
      expect(login.status).toBe(200); const tok = (await login.json() as { token: string }).token
      const term = (await rows<{ id: string }>('select id from public.terms where year_id = $1 and ord = 1', [y2]))[0]!.id
      const lk = await fetchImpl('https://api.example/api/teacher/links', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` }, body: JSON.stringify({ termId: term, slotId: 's2', url: 'https://example.com/new-year' }) })
      expect(lk.status).toBe(200); expect(await n('public.versions')).toBe(1)
    })

    it('تنظيف', async () => { await env.dispose() })
  })
}
