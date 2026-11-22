// أدوات اختبار الطبقة الخادمية على PostgreSQL محلي مؤقت. لا تتصل إلا بخادم محلي وبقاعدة تُنشأ ثم تُحذف (athar_test_svc_*).
// تُفعَّل بمتغير ATHAR_TEST_PG (مسار مجلد socket أو localhost)؛ دونه تُتخطّى اختبارات القاعدة (لا تفشل).
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { PsqlDb, assertLocalTestTarget } from '../../db/psqlDb'
import { resolve } from 'node:path'
import { projectRoot } from './projectRoot'

const ROOT = projectRoot()
export const PG_HOST = process.env.ATHAR_TEST_PG ?? ''
export const PG_PORT = Number(process.env.ATHAR_TEST_PG_PORT ?? process.env.PGPORT ?? 5432)
export const PG_USER = process.env.ATHAR_TEST_PG_USER ?? 'postgres'
export const HAS_PG = PG_HOST !== ''

function psql(db: string, args: string[]): string {
  return execFileSync('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-h', PG_HOST, '-p', String(PG_PORT), '-U', PG_USER, '-d', db, ...args], { encoding: 'utf8' })
}


export interface TestEnv {
  dbName: string
  db: PsqlDb
  admin: PsqlDb
  ids: { teacher: string; teacher2: string; term: string; termClosed: string }
  /** يزيح زمن جلسة (أو كل الجلسات) إلى الماضي بدقائق، متجاوزًا المشغّلات (مشرف قاعدة الاختبار فقط). */
  backdate(sessionId: string, minutes: number): Promise<void>
  /** يقدّم validating_at لجلسة عالقة. */
  backdateValidating(sessionId: string, minutes: number): Promise<void>
  /** يضبط مواعيد فصل (للاختبار فقط، بتجاوز الحارس). */
  setDeadlines(termId: string, d: { base: string; late: string; replace: string }): Promise<void>
  dispose(): Promise<void>
}

/** ينشئ قاعدة اختبار جديدة: bootstrap ثم 001..005، ثم يزرع بيانات وهمية. */
export async function createTestEnv(opts: { withStaff?: boolean; extraFiles?: string[] } = {}): Promise<TestEnv> {
  const dbName = `athar_test_svc_${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`
  assertLocalTestTarget(PG_HOST, dbName)
  psql('postgres', ['-c', `create database ${dbName}`])
  const files = ['tests/sql/00_bootstrap.sql', 'database/001_schema.sql', 'database/002_integrity.sql', 'database/003_rls.sql', 'database/004_upload_tables.sql',
    ...(opts.withStaff ? ['database/005_staff_accounts.sql'] : []), ...(opts.extraFiles ?? [])]
  for (const f of files) psql(dbName, ['-f', resolve(ROOT, f)])
  psql(dbName, ['-c', 'grant all on all tables in schema public to service_role; grant all on all sequences in schema public to service_role; grant execute on all functions in schema public to service_role;'])
  const ids = {
    teacher: '00000000-0000-0000-0000-000000000001',
    teacher2: '00000000-0000-0000-0000-000000000002',
    term: '00000000-0000-0000-0000-0000000000a1',
    termClosed: '00000000-0000-0000-0000-0000000000a2',
  }
  psql(dbName, ['-c', `
    insert into public.years (label, is_active) values ('2026-2027', true);
    insert into public.terms (id, year_id, name, ord, deadline_base, deadline_late, deadline_replace)
      select '${ids.term}', id, 'الفصل الأول', 1, current_date + 30, current_date + 40, current_date + 60 from public.years;
    insert into public.terms (id, year_id, name, ord, deadline_base, deadline_late, deadline_replace)
      select '${ids.termClosed}', id, 'الفصل الثاني', 2, current_date - 30, current_date - 20, current_date - 10 from public.years;
    insert into public.teachers (id, name, subject) values ('${ids.teacher}', 'معلمة أولى', 'رياضيات'), ('${ids.teacher2}', 'معلمة ثانية', 'علوم');
  `])
  const db = new PsqlDb({ host: PG_HOST, port: PG_PORT, user: PG_USER, database: dbName, role: 'service_role' })
  const admin = new PsqlDb({ host: PG_HOST, port: PG_PORT, user: PG_USER, database: dbName, role: 'postgres', maxConnections: 2 })
  const adminExec = (sql: string, params: unknown[] = []) => admin.transaction(async (c) => { await c.exec('set local session_replication_role = replica'); await c.exec(sql, params) })
  return {
    dbName, db, admin, ids,
    backdate: (id, minutes) => adminExec(`update public.upload_sessions set started_at = started_at - make_interval(mins => $2), expires_at = expires_at - make_interval(mins => $2), effective_start_at = effective_start_at - make_interval(mins => $2) where id = $1`, [id, minutes]),
    backdateValidating: (id, minutes) => adminExec(`update public.upload_sessions set validating_at = validating_at - make_interval(mins => $2) where id = $1`, [id, minutes]),
    setDeadlines: (termId, d) => adminExec(`update public.terms set deadline_base = $2, deadline_late = $3, deadline_replace = $4 where id = $1`, [termId, d.base, d.late, d.replace]),
    async dispose() {
      await db.close()
      await admin.close()
      await new Promise((r) => setTimeout(r, 300))
      psql('postgres', ['-c', `drop database if exists ${dbName} with (force)`])
    },
  }
}
