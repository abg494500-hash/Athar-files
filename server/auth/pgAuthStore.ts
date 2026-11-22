// مخزن PostgreSQL لدخول المعلمة (الدفعة 5). **كُتب ولم يُشغَّل على أي قاعدة في هذه البيئة** (لا PostgreSQL فيها):
// اختباره في server/test/pgAuthStore.test.ts يعمل فقط حين يُضبط ATHAR_TEST_PG (انظر scripts/local-pg.sh).
// يفترض تطبيق database/006_teacher_sessions.sql. منذ r37 لا PIN ولا قفل لكل معلمة (A-122).
// كل عملية معاملة قصيرة مستقلة؛ الزمن من ساعة القاعدة (now()) دائمًا. لا يسجّل ولا يعيد أي سرّ.
import type { Db } from '../db/types'
import { DbError } from '../db/types'
import type { CredentialRow, LoginResult, SessionRecord, TeacherAuthStore } from './teacherAuth'

const d = (v: unknown): Date => new Date(String(v))
const dn = (v: unknown): Date | null => (v === null || v === undefined ? null : d(v))

export class PgAuthStore implements TeacherAuthStore {
  private readonly db: Db
  constructor(db: Db) {
    this.db = db
  }

  async now(): Promise<Date> {
    const r = await this.db.transaction((c) => c.query<{ now: string }>('select now() as now'))
    return d(r[0]!.now)
  }

  async removeTeacher(actorUserId: string, teacherId: string): Promise<{ versions: number }> {
    const r = await this.db.transaction((c) => c.query<{ r: unknown }>('select public.remove_teacher($1, $2) as r', [actorUserId, teacherId]))
    const raw = r[0]?.r
    const o = (typeof raw === 'string' ? JSON.parse(raw) : raw) as { versions?: unknown } | null
    return { versions: Number(o?.versions ?? 0) }
  }

  async teacherName(teacherId: string): Promise<string | null> {
    const r = await this.db.transaction((c) => c.query<{ name: string }>('select name from public.teachers where id = $1', [teacherId]))
    return r[0] ? String(r[0].name) : null
  }

  async findCredentialByCodeHash(codeHash: string): Promise<CredentialRow | null> {
    const r = await this.db.transaction((c) => c.query<Record<string, unknown>>(
      `select c.teacher_id, t.name, t.is_active, c.code_state, c.code_expires_at
         from public.teacher_credentials c join public.teachers t on t.id = c.teacher_id
        where c.code_hash = $1`, [codeHash]))
    const x = r[0]
    if (!x) return null
    return {
      teacherId: String(x.teacher_id), name: String(x.name), isActive: x.is_active === true || x.is_active === 't',
      codeState: x.code_state === 'revoked' ? 'revoked' : 'active', codeExpiresAt: dn(x.code_expires_at),
    }
  }

  async logAttempt(teacherId: string | null, ipHash: string | null, result: LoginResult): Promise<void> {
    await this.db.transaction((c) => c.exec('insert into public.login_attempts (teacher_id, ip_hash, result) values ($1, $2, $3)', [teacherId, ipHash, result]))
  }

  async countIpFailures(ipHash: string, windowMinutes: number): Promise<number> {
    const r = await this.db.transaction((c) => c.query<{ n: number }>(
      `select count(*)::int as n from public.login_attempts
        where ip_hash = $1 and at >= now() - make_interval(mins => $2) and result in ('wrong_code', 'wrong_pin', 'unknown_code')`, [ipHash, windowMinutes]))
    return Number(r[0]!.n)
  }

  async countRecentFailures(windowMinutes: number): Promise<number> {
    const r = await this.db.transaction((c) => c.query<{ n: number }>(
      `select count(*)::int as n from public.login_attempts
        where at >= now() - make_interval(mins => $1) and result in ('wrong_code', 'wrong_pin', 'unknown_code')`, [windowMinutes]))
    return Number(r[0]!.n)
  }

  async createSession(i: { teacherId: string; tokenHash: string; ttlMinutes: number }): Promise<{ expiresAt: Date }> {
    const r = await this.db.transaction((c) => c.query<{ e: string }>(
      `insert into public.teacher_sessions (teacher_id, token_hash, expires_at) values ($1, $2, now() + make_interval(mins => $3)) returning expires_at as e`,
      [i.teacherId, i.tokenHash, i.ttlMinutes]))
    return { expiresAt: d(r[0]!.e) }
  }

  async findSession(tokenHash: string): Promise<SessionRecord | null> {
    const r = await this.db.transaction((c) => c.query<Record<string, unknown>>(
      `select s.teacher_id, t.name, t.is_active, s.expires_at, s.last_seen_at, s.revoked_at
         from public.teacher_sessions s join public.teachers t on t.id = s.teacher_id where s.token_hash = $1`, [tokenHash]))
    const x = r[0]
    if (!x) return null
    return { teacherId: String(x.teacher_id), name: String(x.name), teacherActive: x.is_active === true || x.is_active === 't', expiresAt: d(x.expires_at), lastSeenAt: d(x.last_seen_at), revokedAt: dn(x.revoked_at) }
  }

  async touchSession(tokenHash: string): Promise<void> {
    await this.db.transaction((c) => c.exec('update public.teacher_sessions set last_seen_at = now() where token_hash = $1 and revoked_at is null', [tokenHash]))
  }

  async revokeSession(tokenHash: string): Promise<void> {
    await this.db.transaction((c) => c.exec('update public.teacher_sessions set revoked_at = now() where token_hash = $1 and revoked_at is null', [tokenHash]))
  }

  async revokeAllSessions(teacherId: string): Promise<void> {
    await this.db.transaction((c) => c.exec('update public.teacher_sessions set revoked_at = now() where teacher_id = $1 and revoked_at is null', [teacherId]))
  }

  async setCredentials(teacherId: string, k: { codeHash: string; codeExpiresAt: Date | null }): Promise<void> {
    try {
      // pin_hash = null: لا رقم سري منذ r37؛ إعادة الإصدار تمحو أي بصمة قديمة، وتصفّر أي قفل قديم.
      await this.db.transaction((c) => c.exec(
        `insert into public.teacher_credentials (teacher_id, code_hash, code_state, code_issued_at, code_expires_at, pin_hash, failed_attempts, locked_until)
         values ($1, $2, 'active', now(), $3, null, 0, null)
         on conflict (teacher_id) do update set code_hash = excluded.code_hash, code_state = 'active', code_issued_at = now(),
           code_expires_at = excluded.code_expires_at, pin_hash = null, failed_attempts = 0, locked_until = null`,
        [teacherId, k.codeHash, k.codeExpiresAt ? k.codeExpiresAt.toISOString() : null]))
    } catch (e) {
      if (e instanceof DbError && e.sqlstate === '23505') throw Object.assign(new Error('code_collision'), { code: 'code_collision' })
      throw e
    }
  }

  async revokeCode(teacherId: string): Promise<void> {
    await this.db.transaction((c) => c.exec("update public.teacher_credentials set code_state = 'revoked' where teacher_id = $1", [teacherId]))
  }
}
