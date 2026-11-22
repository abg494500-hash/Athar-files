// @vitest-environment node
// اختبار خدمة الأرشفة: قاعدة بديلة تسجّل العبارات + تخزين ذاكرة (MemoryStorageAdapter) + مصدر من الذاكرة. لا SQL حقيقي ولا R2 حقيقي.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { ArchiveService } from '../services/archiveService'
import { ServiceError } from '../services/errors'
import { createApiHandler } from '../api/handler'
import type { Db } from '../db/types'

const TERM = '00000000-0000-0000-0000-0000000000a1'
const OWNER = '11111111-1111-1111-1111-111111111111'
const AID = '99999999-9999-9999-9999-999999999999'

function fakeDb(rows: Record<string, unknown>[] | Record<string, unknown> | undefined) {
  const stmts: { sql: string; params: unknown[] }[] = []
  const list = Array.isArray(rows) ? rows : rows ? [rows] : []
  const db: Db = { async transaction(fn) {
    return fn({
      query: async (sql: string, params: unknown[] = []) => { stmts.push({ sql, params }); return list as never },
      exec: async (sql: string, params: unknown[] = []) => { stmts.push({ sql, params }) },
    })
  }, async close() {} }
  return { db, stmts }
}
const signer = { presignGet: (k: string, o: { ttlSec: number }) => ({ url: `https://get.example/${k}?ttl=${o.ttlSec}`, expiresAt: new Date('2026-10-24T08:02:00Z') }) }
function mk(o: { row?: Record<string, unknown> | Record<string, unknown>[] } = {}) {
  const { db, stmts } = fakeDb(o.row)
  return { svc: new ArchiveService({ db, signer }), stmts }
}

describe('A-118: لا مسار في الخادم يرفع أرشيفًا إلى التخزين', () => {
  const root = join(__dirname, '..')
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? (e.name === 'test' ? [] : walk(join(d, e.name))) : [join(d, e.name)])
  const files = walk(root).filter((f) => f.endsWith('.ts'))
  it('لا استدعاء storage.put خارج خدمات الرفع الخاصة بملفات المعلمات (uploadService)', () => {
    const offenders = files.filter((f) => /\.put\(\s*\{/.test(readFileSync(f, 'utf8')) && !/uploadService\.ts$/.test(f) && !/storage[\\/]/.test(f))
    expect(offenders).toEqual([])
  })
  it('خدمات الأرشفة (قديمها وسنويها) لا تستورد مهايئ التخزين ولا تبني ZIP على الخادم', () => {
    for (const f of ['services/archiveService.ts', 'services/yearArchiveService.ts']) {
      const s = readFileSync(join(root, f), 'utf8')
      expect(s, f).not.toMatch(/StorageAdapter|storage\.put|buildTermArchive|archive\/zip/)
    }
  })
  it('لا ملف بناء أرشيف في server/archive غير crc32', () => { expect(readdirSync(join(root, 'archive')).sort()).toEqual(['crc32.ts']) })
  it('ArchiveService لا يملك create ولا أي كتابة', () => {
    expect((ArchiveService.prototype as unknown as Record<string, unknown>).create).toBeUndefined()
  })
})

describe('ArchiveService.listLegacy', () => {
  it('يعيد الأرشيفات السحابية القديمة فقط مع حالة النقل', async () => {
    const { svc, stmts } = mk({ row: [{ id: AID, title: 'قديم', year_id: 'y', created_at: '2026-01-01T00:00:00Z', size_bytes: '10', sha256: 'a'.repeat(64), hv: null }] })
    expect(await svc.listLegacy()).toEqual([{ id: AID, title: 'قديم', yearId: 'y', createdAt: '2026-01-01T00:00:00Z', sizeBytes: 10, sha256: 'a'.repeat(64), transferredAt: null }])
    expect(stmts[0]!.sql).toMatch(/<> 'local-download'/)
  })
})

describe('ArchiveService.authorizeDownload', () => {
  const row = { state: 'verified', storage_key: `archives/${AID}.zip`, sha256: 'a'.repeat(64), size_bytes: '100' }
  it('أرشيف verified ⇒ رابط قصير + البصمة والحجم للمقارنة', async () => {
    const d = await mk({ row }).svc.authorizeDownload(AID)
    expect([d.sha256, d.sizeBytes, d.filename]).toEqual(['a'.repeat(64), 100, `athar-archive-${AID}.zip`]); expect(d.url).toContain('ttl=120')
  })
  it('غير موجود أو غير verified أو بلا مفتاح ⇒ not_found', async () => {
    for (const r of [undefined, { ...row, state: 'failed' }, { ...row, state: 'creating' }, { ...row, storage_key: null }]) {
      let c = ''
      try { await mk(r ? { row: r } : {}).svc.authorizeDownload(AID) } catch (e) { c = (e as ServiceError).code }
      expect(c).toBe('not_found')
    }
  })
})

describe('ArchiveService.confirmDownload', () => {
  const row = { state: 'verified', sha256: 'a'.repeat(64) }
  const run = async (claimed: string, r: Record<string, unknown> | null = row) => {
    const m = mk(r ? { row: r } : {})
    let out: unknown, code = ''
    try { out = await m.svc.confirmDownload({ archiveId: AID, sha256: claimed, actorUserId: OWNER }) } catch (e) { code = (e as ServiceError).code }
    return { out, code, stmts: m.stmts }
  }
  it('بصمة مطابقة ⇒ verified + تحديث الطابعين + أثر دائم', async () => {
    const { out, stmts } = await run('A'.repeat(64)) // حروف كبيرة تُطبَّع
    expect((out as { verified: boolean }).verified).toBe(true)
    expect(stmts.some((s) => /download_hash_verified_at = coalesce/.test(s.sql))).toBe(true)
    const a = stmts.find((s) => s.sql.includes('log_audit_as'))!; expect(a.params[1]).toBe('archive.download_verified'); expect(a.params[0]).toBe(OWNER)
  })
  it('بصمة مختلفة ⇒ verified=false، أثر mismatch، ولا تحديث للأرشيف', async () => {
    const { out, stmts } = await run('b'.repeat(64))
    expect((out as { verified: boolean }).verified).toBe(false)
    expect(stmts.find((s) => s.sql.includes('log_audit_as'))!.params[1]).toBe('archive.download_hash_mismatch')
    expect(stmts.some((s) => /update public.archives/.test(s.sql))).toBe(false)
  })
  it('أرشيف غير موجود/غير verified ⇒ not_found؛ بصمة معيبة ⇒ bad_request بلا قاعدة', async () => {
    expect((await run('a'.repeat(64), null)).code).toBe('not_found')
    expect((await run('a'.repeat(64), { ...row, state: 'awaiting_verification' })).code).toBe('not_found')
    for (const bad of ['', 'xyz', 'a'.repeat(63), 'g'.repeat(64)]) { const r = await run(bad); expect([r.code, r.stmts.length]).toEqual(['bad_request', 0]) }
  })
})

describe('API — الأرشفة للمالكة فقط', () => {
  const stub = { listLegacy: async () => [], authorizeDownload: async () => ({ url: 'u' }), confirmDownload: async () => ({ verified: true }) }
  const mkH = (archives?: typeof stub) => createApiHandler({
    teacherAuth: { login: async () => { throw new Error('x') }, authenticate: async () => { throw new Error('x') }, logout: async () => {}, issueCredentials: async () => ({ code: '' }), revokeCredentials: async () => {}, removeTeacher: async () => ({ versions: 0 }) },
    uploads: {} as never, staff: { verify: async (t) => (t === 'owner.jwt.token-aaaa' ? { userId: OWNER, role: 'owner' as const } : t === 'director.jwt.token-bbb' ? { userId: '22222222-2222-2222-2222-222222222222', role: 'director' as const } : null) },
    ...(archives ? { archives } : {}),
  })
  const call = (h: ReturnType<typeof mkH>, path: string, token: string | undefined, body: unknown) => h({ method: 'POST', path, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })
  it('المديرة 403 والمجهول 401 والمالكة 200؛ بلا خدمة 503', async () => {
    const h = mkH(stub)
    for (const p of ['/owner/archives/download']) {
      const b = { archiveId: AID }
      expect((await call(h, p, 'director.jwt.token-bbb', b)).status).toBe(403)
      expect((await call(h, p, undefined, b)).status).toBe(401)
      expect((await call(h, p, 'owner.jwt.token-aaaa', b)).status).toBe(200)
      expect((await call(mkH(), p, 'owner.jwt.token-aaaa', b)).status).toBe(503)
    }
  })
  it('A-118: مسار الإنشاء السحابي القديم غير موجود أصلًا (404) حتى للمالكة', async () => {
    const h = mkH(stub)
    for (const p of ['/owner/archives/create', '/owner/archives/upload', '/owner/archives/build']) expect([p, (await call(h, p, 'owner.jwt.token-aaaa', { termId: TERM, title: 't' })).status]).toEqual([p, 404])
  })
  it('تأكيد البصمة: المالكة فقط؛ عدم التطابق ⇒ 409 hash_mismatch', async () => {
    const h = mkH(stub), body = { archiveId: AID, sha256: 'a'.repeat(64) }
    expect((await call(h, '/owner/archives/confirm', 'director.jwt.token-bbb', body)).status).toBe(403)
    expect((await call(h, '/owner/archives/confirm', undefined, body)).status).toBe(401)
    expect((await call(h, '/owner/archives/confirm', 'owner.jwt.token-aaaa', body)).status).toBe(200)
    const bad = mkH({ ...stub, confirmDownload: async () => ({ verified: false }) })
    expect((await call(bad, '/owner/archives/confirm', 'owner.jwt.token-aaaa', body)).status).toBe(409)
    expect((await call(h, '/owner/archives/confirm', 'owner.jwt.token-aaaa', { archiveId: AID })).status).toBe(400)
  })
})
