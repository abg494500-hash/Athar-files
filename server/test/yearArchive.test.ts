// @vitest-environment node
// الأرشيف السنوي المقسَّم (A-115/A-116) على PostgreSQL محلي (ATHAR_TEST_PG): plan/urls/register(أجزاء)/confirmPart/confirmCopy/ack/status/بوابة التصفير + التكامل مع التنزيل وحذف المعلمة.
// دون ATHAR_TEST_PG يمرّ اختبار نائب (لم يُجرَّب على قاعدة). + اختبار الخدمة في مسار لا يحتاج قاعدة (تحقق المدخلات).
import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { ArchiveService } from '../services/archiveService'
import { PgAuthStore } from '../auth/pgAuthStore'
import { TeacherAuthService } from '../auth/teacherAuth'
import { ServiceError } from '../services/errors'
import { YearArchiveService } from '../services/yearArchiveService'
import { HAS_PG, createTestEnv } from './helpers/testDb'
import type { TestEnv } from './helpers/testDb'
import type { Db } from '../db/types'

const OWNER = '00000000-0000-0000-0000-0000000000a1'
const OTHER_YEAR_VERSION = '00000000-0000-0000-0000-00000000f001'
const V = (n: number) => `00000000-0000-0000-0000-00000000c${String(n).padStart(3, '0')}`
const hex = (c: string) => c.repeat(64)
const signer = { presignGet: (k: string, o: { ttlSec: number; ext: string }) => ({ url: `https://get.example/${k}?ttl=${o.ttlSec}&e=${o.ext}`, expiresAt: new Date('2026-10-24T08:05:00Z') }) }
const code = async (p: Promise<unknown>): Promise<string> => { try { await p } catch (e) { return e instanceof ServiceError ? e.code : `other:${(e as { sqlstate?: string }).sqlstate ?? (e as Error).message}` } return 'ok' }
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')

const PART_NAMES = ['athar-archive-x-20270620-part-01-of-02.zip', 'athar-archive-x-20270620-part-02-of-02.zip']
const PSHA = [hex('a'), hex('b')]
const parts2 = (over: { sha?: string[]; names?: string[] } = {}) => [1, 2].map((no) => ({ no, filename: (over.names ?? PART_NAMES)[no - 1]!, sha256: (over.sha ?? PSHA)[no - 1]!, size: 1_000_000 * no }))
const BIG = 1_000_000_000 // هدف الجزء: 1 GB ⇒ ثلاثة ملفات 400MB تتوزع على جزأين دون حاجة لملفات حقيقية

describe('YearArchiveService — تحقق المدخلات (بلا قاعدة)', () => {
  const svc = new YearArchiveService({ db: {} as Db, signer })
  it('معرّفات وبصمات وأجزاء مشوّهة ⇒ bad_request قبل أي وصول للقاعدة', async () => {
    expect(await code(svc.plan('nope'))).toBe('bad_request')
    expect(await code(svc.plan(OWNER, 1000))).toBe('bad_request') // هدف أصغر من الحد الأدنى
    expect(await code(svc.plan(OWNER, 4_000_000_000))).toBe('bad_request') // أكبر من الحد الأقصى
    expect(await code(svc.urls(OWNER, []))).toBe('bad_request')
    expect(await code(svc.urls(OWNER, Array.from({ length: 41 }, (_, i) => V(i))))).toBe('bad_request')
    const base = { yearId: OWNER, title: 'x', targetBytes: BIG, parts: parts2(), entriesDigest: hex('a'), actorUserId: OWNER }
    expect(await code(svc.register({ ...base, entriesDigest: 'zz' }))).toBe('bad_request')
    expect(await code(svc.register({ ...base, title: '  ' }))).toBe('bad_request')
    expect(await code(svc.register({ ...base, parts: [] }))).toBe('bad_request')
    expect(await code(svc.register({ ...base, parts: parts2().map((p) => ({ ...p, no: p.no + 1 })) }))).toBe('bad_request') // ترقيم لا يبدأ من 1
    expect(await code(svc.register({ ...base, parts: parts2({ sha: ['zz', hex('b')] }) }))).toBe('bad_request')
    expect(await code(svc.register({ ...base, parts: parts2({ names: ['../x.zip', 'y.zip'] }) }))).toBe('bad_request')
    expect(await code(svc.register({ ...base, parts: parts2({ names: ['same.zip', 'same.zip'] }) }))).toBe('bad_request')
    expect(await code(svc.register({ ...base, targetBytes: 5 }))).toBe('bad_request')
    expect(await code(svc.register({ ...base, parts: Array.from({ length: 61 }, (_, k) => ({ no: k + 1, filename: `p${k}.zip`, sha256: hex('a'), size: 1 })) }))).toBe('bad_request')
    expect(await code(svc.ack({ archiveId: OWNER, kind: 'second_copy' as 'opened_locally', actorUserId: OWNER }))).toBe('bad_request') // الإقرار بلا تحقق لم يعد موجودًا
    expect(await code(svc.confirmPart({ archiveId: OWNER, partNo: 0, sha256: hex('a'), actorUserId: OWNER }))).toBe('bad_request')
    expect(await code(svc.confirmPart({ archiveId: OWNER, partNo: 1, sha256: 'zz', actorUserId: OWNER }))).toBe('bad_request')
    expect(await code(svc.confirmCopy({ archiveId: OWNER, partNo: 1, sha256: hex('a'), medium: 'same_laptop', independent: true, actorUserId: OWNER }))).toBe('bad_request')
  })
})

if (!HAS_PG) {
  describe('الأرشيف السنوي على قاعدة — تخطٍّ: لا ATHAR_TEST_PG (لم يُجرَّب على قاعدة)', () => { it('نائب', () => {}) })
} else {
  describe('الأرشيف السنوي المقسَّم على Postgres محلي', () => {
    let env: TestEnv
    let svc: YearArchiveService
    let year: string
    let digest: string
    let archiveId: string
    const sql = (q: string, p: unknown[] = []) => env.admin.transaction(async (c) => { await c.exec('set local session_replication_role = replica'); await c.exec(q, p) })
    const rows = <T>(q: string, p: unknown[] = []) => env.admin.transaction((c) => c.query<T>(q, p))
    const addFile = (n: number, teacher: string, term: string, slot: string, no: number, name: string) => sql(
      `insert into public.submissions (teacher_id, term_id, slot_id) values ($1, $2, $3) on conflict do nothing;
       insert into public.versions (id, teacher_id, term_id, slot_id, no, kind, original_name, size_bytes, ext, storage_provider, storage_bucket, storage_key, sha256, submitted_at, status_snapshot, deadlines_snapshot, validated_at, validation_result, upload_session_id)
       values ($4, $1, $2, $3, $5, 'file', $6, 400000000, 'pdf', 'r2', 'b', $7, $8, now(), 'on_time', '{}'::jsonb, now(), '{}'::jsonb, gen_random_uuid())`, [teacher, term, slot, V(n), no, name, `final/key-${n}`, hex(String(n))])
    const addLink = (n: number, teacher: string, term: string) => sql(
      `insert into public.submissions (teacher_id, term_id, slot_id) values ($1, $2, 's2') on conflict do nothing;
       insert into public.versions (id, teacher_id, term_id, slot_id, no, kind, url, submitted_at, status_snapshot, deadlines_snapshot)
       values ($3, $1, $2, 's2', 1, 'link', 'https://example.com/e', now(), 'late', '{}'::jsonb)`, [teacher, term, V(n)])
    const auth = () => new TeacherAuthService(new PgAuthStore(env.db), { codePepper: Buffer.alloc(32, 1), ipPepper: Buffer.alloc(32, 3) })
    const reg = (over: Record<string, unknown> = {}) => svc.register({ yearId: year, title: 'أرشيف 2026-2027', targetBytes: BIG, parts: parts2(), entriesDigest: digest, actorUserId: OWNER, ...over } as Parameters<YearArchiveService['register']>[0])
    const gate = async () => (await svc.status(year)).archives[0]!.resetGate

    it('تهيئة 001..009 + حساب المالكة + بيانات سنة (3 ملفات × 400MB + رابط) + سنة أخرى بنسخة', async () => {
      env = await createTestEnv({ withStaff: true, extraFiles: ['database/006_teacher_sessions.sql', 'database/007_server_additions.sql', 'database/008_teacher_removal.sql', 'database/009_archive_parts.sql', 'database/012_teacher_delete.sql'] })
      await env.admin.transaction((c) => c.exec(`insert into auth.users (id, email) values ('${OWNER}', 'o@example.invalid'); select public.bootstrap_staff('o@example.invalid', 'owner');`))
      year = (await rows<{ id: string }>('select id from public.years limit 1'))[0]!.id
      await addFile(1, env.ids.teacher, env.ids.term, 's1', 1, 'خطة.pdf'); await addFile(2, env.ids.teacher, env.ids.term, 's1', 2, 'خطة.pdf')
      await addFile(3, env.ids.teacher, env.ids.termClosed, 's1', 1, 'تقرير.pdf'); await addLink(4, env.ids.teacher2, env.ids.termClosed)
      await sql(`insert into public.years (id, label) values ('00000000-0000-0000-0000-0000000000f0', '2025-2026');
                 insert into public.terms (id, year_id, name, ord, deadline_base, deadline_late, deadline_replace) values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f0', 'ف1', 1, current_date, current_date, current_date)`)
      await addFile(9, env.ids.teacher, '00000000-0000-0000-0000-0000000000f1', 's1', 1, 'قديم.pdf')
      await sql(`update public.versions set id = $1 where id = $2`, [OTHER_YEAR_VERSION, V(9)])
      svc = new YearArchiveService({ db: env.db, signer, newId: () => '00000000-0000-0000-0000-00000000aaaa' })
    })

    it('plan: كل نسخ السنة فقط موزَّعة على جزأين (حد 1GB) كلٌّ في جزء واحد، ولا أسرار دخول', async () => {
      const p = await svc.plan(year, BIG)
      expect(p.totals).toMatchObject({ teachers: 2, terms: 2, versions: 4, files: 3, links: 1, fileBytes: 1_200_000_000 })
      expect(p.versions.map((v) => v.id).sort()).toEqual([V(1), V(2), V(3), V(4)])
      expect(p.versions.some((v) => v.id === OTHER_YEAR_VERSION)).toBe(false)
      expect(p.problems).toEqual([]); expect(p.entriesDigest).toMatch(/^[0-9a-f]{64}$/)
      expect(p.layout.parts.map((x) => x.entries)).toEqual([2, 2]); expect(p.layout.targetBytes).toBe(BIG)
      expect(p.versions.map((v) => v.partNo).sort()).toEqual([1, 1, 2, 2])
      expect(p.layout.parts.reduce((n, x) => n + x.entries, 0)).toBe(4) // لا يضيع ولا يتكرر إصدار
      expect(JSON.stringify(p)).not.toMatch(/code_hash|pin_hash|storage_key|final\/key/)
      for (const v of p.versions) expect(v.entryPath).toMatch(/^(files|links)\/t[12]\/[A-Za-z0-9_.-]+\/s[12]\/v\d+[A-Za-z0-9_.-]*$/)
      expect(new Set(p.versions.map((v) => v.entryPath)).size).toBe(4)
      digest = p.entriesDigest
      expect((await svc.plan(year, BIG)).entriesDigest).toBe(digest) // حتمي
      expect((await svc.plan(year, 100_000_000)).layout.parts.length).toBeGreaterThan(2)
    })

    it('plan: ملف أكبر من 1GB أو أجزاء أكثر من 60 ⇒ problems صريحة (لا أرشيف صامت)', async () => {
      await sql(`update public.versions set size_bytes = 1000000001 where id = $1`, [V(3)])
      expect((await svc.plan(year, BIG)).problems).toEqual([{ versionId: V(3), reason: 'file_too_large' }])
      await sql(`update public.versions set size_bytes = 400000000 where id = $1`, [V(3)])
      expect((await svc.plan(year, BIG)).problems).toEqual([])
    })

    it('plan لسنة غير موجودة ⇒ not_found', async () => { expect(await code(svc.plan('00000000-0000-0000-0000-00000000dead'))).toBe('not_found') })

    it('urls: روابط قصيرة لملفات السنة؛ نسخة سنة أخرى أو رابط أو مجهول مرفوض', async () => {
      const u = await svc.urls(year, [V(1), V(3)])
      expect(u.map((x) => x.url).sort()).toEqual(['https://get.example/final/key-1?ttl=300&e=pdf', 'https://get.example/final/key-3?ttl=300&e=pdf'])
      expect(await code(svc.urls(year, [OTHER_YEAR_VERSION]))).toBe('not_found')
      expect(await code(svc.urls(year, [V(1), '00000000-0000-0000-0000-00000000dead']))).toBe('not_found')
      expect(await code(svc.urls(year, [V(4)]))).toBe('files_missing')
    })

    it('register: ملخّص خاطئ أو عدد أجزاء لا يطابق تقسيم الخادم ⇒ year_changed ولا يُسجَّل شيء', async () => {
      expect(await code(reg({ entriesDigest: hex('f') }))).toBe('year_changed')
      expect(await code(reg({ parts: [parts2()[0]!] }))).toBe('year_changed') // جزء واحد بدل جزأين: فُقد جزء
      expect(await code(reg({ parts: [...parts2(), { no: 3, filename: 'p3.zip', sha256: hex('c'), size: 1 }] }))).toBe('year_changed')
      for (const t of ['archives', 'archive_entries', 'archive_parts']) expect((await rows<{ n: string }>(`select count(*)::text as n from public.${t}`))[0]!.n).toBe('0')
    })

    it('قبل التسجيل: حذف المعلمة مرفوض (لا أرشيف)', async () => { expect(await code(auth().removeTeacher(env.ids.teacher, OWNER))).toBe('other:23514') })

    it('register: التطابق ⇒ أرشيف على مستوى السنة بجزأين، وكل العناصر في archive_entries بـpart_no، ولا طوابع تنزيل', async () => {
      const r = await reg(); archiveId = r.id
      expect(r).toMatchObject({ state: 'verified', entries: 4, files: 3, links: 1, parts: 2, sizeBytes: 3_000_000 })
      const a = (await rows<Record<string, unknown>>('select state, term_id, teacher_id, storage_provider, entries_count, manifest_sha256, download_hash_verified_at from public.archives where id = $1', [archiveId]))[0]!
      expect(a).toMatchObject({ state: 'verified', term_id: null, teacher_id: null, storage_provider: 'local-download', entries_count: 4, manifest_sha256: digest, download_hash_verified_at: null })
      expect((await rows<{ part_no: number; filename: string; sha256: string; entries_count: number }>('select part_no, filename, sha256, entries_count from public.archive_parts where archive_id = $1 order by part_no', [archiveId])).map((x) => [x.part_no, x.filename, x.sha256, x.entries_count])).toEqual([[1, PART_NAMES[0], PSHA[0], 2], [2, PART_NAMES[1], PSHA[1], 2]])
      const ents = await rows<{ version_id: string; sha256: string; part_no: number }>('select version_id, sha256, part_no from public.archive_entries where archive_id = $1 order by version_id', [archiveId])
      expect(ents.map((e) => e.version_id)).toEqual([V(1), V(2), V(3), V(4)]); expect(ents.every((e) => e.part_no === 1 || e.part_no === 2)).toBe(true)
      expect(ents[3]!.sha256).toBe(sha('https://example.com/e\n'))
    })

    it('بعد التسجيل وقبل أي تحقق: الحذف مرفوض؛ الإقرار والنسخة الثانية ⇒ not_ready؛ البوابة تعدّد الموانع', async () => {
      expect(await code(auth().removeTeacher(env.ids.teacher2, OWNER))).toBe('other:23514')
      expect(await code(svc.ack({ archiveId, kind: 'opened_locally', actorUserId: OWNER }))).toBe('not_ready')
      expect(await code(svc.confirmCopy({ archiveId, partNo: 1, sha256: PSHA[0]!, medium: 'external_drive', independent: true, actorUserId: OWNER }))).toBe('not_ready') // لا نسخة ثانية قبل تحقق الأصل
      const g = await gate()
      expect(g.ready).toBe(false); expect(g.problems).toEqual(expect.arrayContaining(['download_not_verified', 'not_opened_locally']))
      expect(g.problems.some((x) => x.startsWith('parts_not_download_verified'))).toBe(true)
    })

    it('لا رابط تنزيل من الخادم لأرشيف محلي، ولا تأكيد تنزيل عبر المسار القديم', async () => {
      const arch = new ArchiveService({ db: env.db, signer })
      expect(await code(arch.authorizeDownload(archiveId))).toBe('not_found')
      expect(await code(arch.confirmDownload({ archiveId, sha256: PSHA[0]!, actorUserId: OWNER }))).toBe('not_found')
    })

    it('تحقق الأجزاء: بصمة خاطئة ⇒ لا طابع؛ جزء واحد سليم لا يكفي؛ ولا يمكن ختم التنزيل يدويًا قبل اكتمال الأجزاء (حارس القاعدة)', async () => {
      expect(await svc.confirmPart({ archiveId, partNo: 1, sha256: hex('9'), actorUserId: OWNER })).toMatchObject({ verified: false })
      expect((await rows<{ n: string }>('select count(*)::text as n from public.archive_parts where verified_at is not null'))[0]!.n).toBe('0')
      expect((await rows<{ n: string }>(`select count(*)::text as n from public.audit_log where action = 'archive.part_hash_mismatch'`))[0]!.n).toBe('1')
      expect(await svc.confirmPart({ archiveId, partNo: 1, sha256: PSHA[0]!, actorUserId: OWNER })).toMatchObject({ verified: true, allPartsVerified: false })
      expect((await rows<{ hv: string | null }>('select download_hash_verified_at::text as hv from public.archives where id = $1', [archiveId]))[0]!.hv).toBeNull()
      await expect(env.admin.transaction((c) => c.exec('update public.archives set download_hash_verified_at = now() where id = $1', [archiveId]))).rejects.toThrow()
      expect(await code(svc.confirmPart({ archiveId, partNo: 3, sha256: PSHA[0]!, actorUserId: OWNER }))).toBe('not_found')
    })

    it('جزء 2 غير متحقَّق منه ⇒ حذف المعلمة مرفوض والبوابة مغلقة (أرشيف ناقص لا يكفي)', async () => {
      expect(await code(auth().removeTeacher(env.ids.teacher2, OWNER))).toBe('other:23514')
      expect((await gate()).problems).toContain('parts_not_download_verified:1')
      expect((await rows<{ n: string }>('select count(*)::text as n from public.teachers where removed_at is not null'))[0]!.n).toBe('0')
    })

    it('اكتمال تحقق كل الأجزاء ⇒ يُختم التنزيل مرة واحدة ويُفتح إقرار الفتح المحلي', async () => {
      expect(await svc.confirmPart({ archiveId, partNo: 2, sha256: PSHA[1]!, actorUserId: OWNER })).toMatchObject({ verified: true, allPartsVerified: true })
      expect((await rows<{ hv: string | null }>('select download_hash_verified_at::text as hv from public.archives where id = $1', [archiveId]))[0]!.hv).not.toBeNull()
      expect((await svc.status(year)).archives[0]).toMatchObject({ id: archiveId, entries: 4, openedLocally: false, secondCopyAt: null, entriesDigest: digest })
      expect(await code(svc.ack({ archiveId, kind: 'opened_locally', note: 'جرّبته دون إنترنت', actorUserId: OWNER }))).toBe('ok')
      expect(await code(svc.ack({ archiveId, kind: 'opened_locally', actorUserId: OWNER }))).toBe('not_ready')
      const g = await gate(); expect(g.ready).toBe(false); expect(g.problems.some((x) => x.startsWith('parts_second_copy_not_verified'))).toBe(true) // ما زالت النسخة الثانية ناقصة
    })

    it('النسخة الثانية: بصمة خاطئة لا تُقبل؛ وسيط غير معروف مرفوض؛ البوابة تُفتح فقط بعد تحقق كل أجزاء النسخة', async () => {
      expect(await svc.confirmCopy({ archiveId, partNo: 1, sha256: hex('8'), medium: 'external_drive', independent: true, actorUserId: OWNER })).toMatchObject({ verified: false })
      expect(await code(svc.confirmCopy({ archiveId, partNo: 1, sha256: PSHA[0]!, medium: 'same_laptop', independent: true, actorUserId: OWNER }))).toBe('bad_request')
      expect((await svc.status(year)).archives[0]!.secondCopyAt).toBeNull()
      expect(await svc.confirmCopy({ archiveId, partNo: 1, sha256: PSHA[0]!, medium: 'external_drive', independent: true, actorUserId: OWNER })).toMatchObject({ verified: true, allCopiesVerified: false })
      expect((await svc.status(year)).archives[0]!.secondCopyAt).toBeNull(); expect((await gate()).ready).toBe(false)
      expect(await svc.confirmCopy({ archiveId, partNo: 2, sha256: PSHA[1]!, medium: 'external_drive', independent: true, actorUserId: OWNER })).toMatchObject({ verified: true, allCopiesVerified: true })
      const s = (await svc.status(year)).archives[0]!
      expect(s.secondCopyAt).not.toBeNull(); expect(s.parts.every((x) => x.verified && x.copyVerified && x.copyMedium === 'external_drive')).toBe(true)
      expect(await gate()).toEqual({ ready: true, problems: [] })
    })

    it('النسخة الثانية بلا إقرار الاستقلال ⇒ bad_request (لا اعتماد بنوع الوسيط وحده)', async () => {
      expect(await code(svc.confirmCopy({ archiveId, partNo: 1, sha256: PSHA[0]!, medium: 'external_drive', independent: false, actorUserId: OWNER }))).toBe('bad_request')
    })

    it('الأختام لا تُكتب مرتين ولا تُمحى (write-once) ولا يُحذف جزء', async () => {
      await expect(env.admin.transaction((c) => c.exec('update public.archive_parts set verified_at = null where archive_id = $1', [archiveId]))).rejects.toThrow()
      await expect(env.admin.transaction((c) => c.exec('delete from public.archive_parts where archive_id = $1', [archiveId]))).rejects.toThrow()
    })

    it('تكامل حذف المعلمة: بعد اكتمال كل الأجزاء يُسمح بحذف المعلمة المغطّاة نسخها فقط، وتبقى النسخ والعناصر والأجزاء', async () => {
      // معلمة ٢ لها رابط واحد مغطّى؛ معلمة ١ لها نسخة من سنة أخرى غير مغطّاة ⇒ مرفوض.
      expect(await code(auth().removeTeacher(env.ids.teacher, OWNER))).toBe('other:23514')
      expect(await code(auth().removeTeacher(env.ids.teacher2, OWNER))).toBe('ok')
      expect((await rows<{ n: string }>('select count(*)::text as n from public.versions'))[0]!.n).toBe('5')
      expect((await rows<{ n: string }>('select count(*)::text as n from public.archive_entries'))[0]!.n).toBe('4')
      expect((await rows<{ n: string }>('select count(*)::text as n from public.archive_parts'))[0]!.n).toBe('2')
      const t = (await rows<{ name: string; removed_at: string | null }>('select name, removed_at::text as removed_at from public.teachers where id = $1', [env.ids.teacher2]))[0]!
      expect(t.name).toBe('معلمة محذوفة'); expect(t.removed_at).not.toBeNull()
      expect((await svc.plan(year, BIG)).teachers.find((x) => x.id === env.ids.teacher2)).toMatchObject({ name: 'معلمة محذوفة' }) // الخطة الحية تُظهر الاسم المحذوف؛ الأرشيف المحفوظ يحتفظ بالأصل (يُختبر في المتصفح)
      expect((await rows<{ n: string }>(`select count(*)::text as n from public.audit_log where action = 'archive.part_verified'`))[0]!.n).toBe('2')
    })

    it('أي نسخة جديدة بعد البناء ⇒ year_changed عند تسجيل ما بُني قبلها', async () => {
      await addFile(5, env.ids.teacher, env.ids.term, 's1', 3, 'جديد.pdf')
      expect(await code(reg({ title: 'أرشيف ثانٍ' }))).toBe('year_changed')
    })

    it('ملف خارج التخزين (storage_state ≠ present) ⇒ problems في plan وfiles_missing عند register وurls', async () => {
      await sql(`update public.versions set storage_state = 'deleted_archived', archive_id = $2 where id = $1`, [V(5), archiveId])
      const p = await svc.plan(year, BIG)
      expect(p.problems).toEqual([{ versionId: V(5), reason: 'file_not_present' }])
      expect(await code(reg({ title: 'x', entriesDigest: p.entriesDigest }))).toBe('files_missing')
      expect(await code(svc.urls(year, [V(5)]))).toBe('files_missing')
    })

    it('تنظيف', async () => { await env.dispose() })
  })
}
