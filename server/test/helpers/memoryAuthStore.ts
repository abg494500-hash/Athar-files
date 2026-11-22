// مخزن ذاكرة لاختبار منطق دخول المعلمة (بديل اختباري لـ TeacherAuthStore، **ليس** تنفيذًا للقاعدة).
// يحاكي عقد المخزن حرفيًا (بما فيه دلالات recordFailure) لكنه لا يختبر ذرّية SQL ولا تزامن الاتصالات.
import type { CredentialRow, LoginResult, SessionRecord, TeacherAuthStore } from '../../auth/teacherAuth'

interface SessionMem { teacherId: string; expiresAt: Date; lastSeenAt: Date; revokedAt: Date | null }
export interface AttemptLog { teacherId: string | null; ipHash: string | null; result: LoginResult; at: Date }

export class MemoryAuthStore implements TeacherAuthStore {
  clock = new Date('2026-10-23T08:00:00Z')
  teachers = new Map<string, { name: string; isActive: boolean }>()
  creds = new Map<string, { codeHash: string; codeState: 'active' | 'revoked'; codeExpiresAt: Date | null }>()
  sessions = new Map<string, SessionMem>()
  attempts: AttemptLog[] = []
  /** لاختبار إعادة المحاولة عند تصادم الكود. */
  collideNext = 0

  addTeacher(id: string, name: string, isActive = true): void { this.teachers.set(id, { name, isActive }) }
  advance(minutes: number): void { this.clock = new Date(this.clock.getTime() + minutes * 60_000) }

  async now(): Promise<Date> { return this.clock }

  async findCredentialByCodeHash(codeHash: string): Promise<CredentialRow | null> {
    for (const [teacherId, c] of this.creds) {
      if (c.codeHash !== codeHash) continue
      const t = this.teachers.get(teacherId)
      if (!t) return null
      return { teacherId, name: t.name, isActive: t.isActive, codeState: c.codeState, codeExpiresAt: c.codeExpiresAt }
    }
    return null
  }

  async logAttempt(teacherId: string | null, ipHash: string | null, result: LoginResult): Promise<void> {
    this.attempts.push({ teacherId, ipHash, result, at: this.clock })
  }

  async countRecentFailures(windowMinutes: number): Promise<number> {
    const since = this.clock.getTime() - windowMinutes * 60_000
    return this.attempts.filter((a) => a.at.getTime() >= since && (a.result === 'wrong_code' || a.result === 'wrong_pin' || a.result === 'unknown_code')).length
  }

  async countIpFailures(ipHash: string, windowMinutes: number): Promise<number> {
    const since = this.clock.getTime() - windowMinutes * 60_000
    return this.attempts.filter((a) => a.ipHash === ipHash && a.at.getTime() >= since && (a.result === 'wrong_code' || a.result === 'wrong_pin' || a.result === 'unknown_code')).length
  }

  async createSession(i: { teacherId: string; tokenHash: string; ttlMinutes: number }): Promise<{ expiresAt: Date }> {
    const expiresAt = new Date(this.clock.getTime() + i.ttlMinutes * 60_000)
    this.sessions.set(i.tokenHash, { teacherId: i.teacherId, expiresAt, lastSeenAt: this.clock, revokedAt: null })
    return { expiresAt }
  }

  async findSession(tokenHash: string): Promise<SessionRecord | null> {
    const s = this.sessions.get(tokenHash)
    if (!s) return null
    const t = this.teachers.get(s.teacherId)
    if (!t) return null
    return { teacherId: s.teacherId, name: t.name, expiresAt: s.expiresAt, lastSeenAt: s.lastSeenAt, revokedAt: s.revokedAt, teacherActive: t.isActive }
  }

  async touchSession(tokenHash: string): Promise<void> { const s = this.sessions.get(tokenHash); if (s) s.lastSeenAt = this.clock }
  async revokeSession(tokenHash: string): Promise<void> { const s = this.sessions.get(tokenHash); if (s && !s.revokedAt) s.revokedAt = this.clock }
  async revokeAllSessions(teacherId: string): Promise<void> { for (const s of this.sessions.values()) if (s.teacherId === teacherId && !s.revokedAt) s.revokedAt = this.clock }

  async setCredentials(teacherId: string, c: { codeHash: string; codeExpiresAt: Date | null }): Promise<void> {
    if (this.collideNext > 0) { this.collideNext--; throw Object.assign(new Error('collision'), { code: 'code_collision' }) }
    for (const [id, x] of this.creds) if (id !== teacherId && x.codeHash === c.codeHash) throw Object.assign(new Error('collision'), { code: 'code_collision' })
    this.creds.set(teacherId, { codeHash: c.codeHash, codeState: 'active', codeExpiresAt: c.codeExpiresAt })
  }

  removed = new Set<string>()
  async removeTeacher(_actor: string, teacherId: string): Promise<{ versions: number }> {
    const t = this.teachers.get(teacherId)
    if (!t || this.removed.has(teacherId)) throw Object.assign(new Error('not found'), { code: 'P0002' })
    this.removed.add(teacherId); t.isActive = false; t.name = 'معلمة محذوفة'
    const c = this.creds.get(teacherId); if (c) c.codeState = 'revoked'
    for (const s of this.sessions.values()) if (s.teacherId === teacherId && !s.revokedAt) s.revokedAt = this.clock
    return { versions: 0 }
  }
  async teacherName(teacherId: string): Promise<string | null> { return this.teachers.get(teacherId)?.name ?? null }
  async revokeCode(teacherId: string): Promise<void> { const c = this.creds.get(teacherId); if (c) c.codeState = 'revoked' }
}
