// تركيب الواجهة الخادمية من إعدادات تُحقن وقت التشغيل (الدفعة 7). **لا يقرأ process.env ولا ملفات ولا يحوي أي سرّ**: المضيف (Edge/Worker) يمرّر `env` و`db`.
// فشل مغلق: أي إعداد ناقص أو معيب ⇒ يرمي ComposeError (يسمّي اسم المتغير فقط، لا قيمته).
// **الحالة:** يُختبر هنا بإعدادات وهمية وقاعدة بديلة. المضيف الفعلي: supabase/functions/api/index.ts (Deno) الذي يحقن `db` من server/db/postgresDb.ts.
// لم يُركَّب على مضيف حقيقي ولم يُنشر. حد الكائن الافتراضي 30MB لأن دالة Edge ذاكرتها محدودة (يُقرأ الكائن كاملًا في الذاكرة عند الإتمام والأرشفة).
import { ArchiveService } from '../services/archiveService'
import { PgAuthStore } from '../auth/pgAuthStore'
import { TeacherAuthService } from '../auth/teacherAuth'
import { StaffCodeLogin } from '../auth/staffCodeLogin'
import type { Db } from '../db/types'
import { R2StorageAdapter } from '../storage/r2'
import { TeacherReadService } from '../services/teacherReadService'
import { TransferService } from '../services/transferService'
import { UploadService } from '../services/uploadService'
import { YearArchiveService } from '../services/yearArchiveService'
import { AdminService } from '../services/adminService'
import { YearResetService } from '../services/yearResetService'
import { TeacherDeleteService } from '../services/deleteService'
import { PgAuditSink } from './auditSink'
import { createApiHandler } from './handler'
import type { ApiRequest, ApiResponse, AuditEvent } from './handler'
import { SupabaseStaffVerifier } from './staffVerifier'

const enc = new TextEncoder()

export const DEFAULT_MAX_OBJECT_BYTES = 30_000_000

export class ComposeError extends Error {
  constructor(name: string, why: string) { super(`إعداد غير صالح: ${name} (${why})`); this.name = 'ComposeError' }
}

export interface ServerEnv {
  SUPABASE_URL?: string
  SUPABASE_ANON_KEY?: string
  R2_ACCOUNT_ID?: string
  R2_BUCKET?: string
  R2_ACCESS_KEY_ID?: string
  R2_SECRET_ACCESS_KEY?: string
  /** أسرار الخلط (HMAC) لأكواد المعلمات وعناوين IP: ≥ 32 محرفًا لكلٍّ، ومختلفان. (TEACHER_PIN_PEPPER لم يعد مستعملًا منذ r37؛ وجوده في الأسرار لا يضر.) */
  TEACHER_CODE_PEPPER?: string
  TEACHER_IP_PEPPER?: string
  /** (r38) بريدا حسابَي الإدارة مفصولين بفاصلة؛ يجرّب الخادم الرمز المُدخَل ككلمة مرور عليهما. اختياري: غيابه ⇒ لا دخول إدارة من الصندوق الموحَّد. */
  STAFF_LOGIN_EMAILS?: string
  /** أصل الواجهة المسموح (CORS)، مثل https://athar.example */
  ALLOWED_ORIGIN?: string
  MAX_OBJECT_BYTES?: string
}

const need = (env: ServerEnv, k: keyof ServerEnv, minLen = 1): string => {
  const v = env[k]
  if (typeof v !== 'string' || v.trim().length < minLen) throw new ComposeError(k, minLen > 1 ? `قصير جدًا (≥ ${minLen})` : 'مفقود')
  return v.trim()
}

export interface ComposeOptions { audit?: (e: AuditEvent) => void; onUnexpected?: (e: unknown) => void; fetchImpl?: typeof fetch }

export function composeApi(env: ServerEnv, db: Db, o: ComposeOptions = {}): (req: ApiRequest) => Promise<ApiResponse> {
  const peppers = [need(env, 'TEACHER_CODE_PEPPER', 32), need(env, 'TEACHER_IP_PEPPER', 32)]
  if (new Set(peppers).size !== 2) throw new ComposeError('TEACHER_*_PEPPER', 'يجب أن يختلف السرّان')
  const origin = env.ALLOWED_ORIGIN ? need(env, 'ALLOWED_ORIGIN') : undefined
  if (origin) { try { const u = new URL(origin); if (u.origin !== origin || (u.protocol !== 'https:' && u.hostname !== 'localhost')) throw new Error('x') } catch { throw new ComposeError('ALLOWED_ORIGIN', 'أصل https فقط بلا مسار') } }
  const maxBytesRaw = env.MAX_OBJECT_BYTES
  const maxObjectBytes = maxBytesRaw === undefined ? DEFAULT_MAX_OBJECT_BYTES : Number(maxBytesRaw)
  if (!(Number.isSafeInteger(maxObjectBytes) && maxObjectBytes > 0)) throw new ComposeError('MAX_OBJECT_BYTES', 'عدد صحيح موجب')

  let storage: R2StorageAdapter
  try {
    storage = new R2StorageAdapter({ accountId: need(env, 'R2_ACCOUNT_ID'), bucket: need(env, 'R2_BUCKET'), accessKeyId: need(env, 'R2_ACCESS_KEY_ID'), secretAccessKey: need(env, 'R2_SECRET_ACCESS_KEY'), maxObjectBytes, ...(o.fetchImpl ? { fetchImpl: o.fetchImpl } : {}) })
  } catch (e) { if (e instanceof ComposeError) throw e; throw new ComposeError('R2_*', 'قيم غير صالحة') }

  const teacherAuth = new TeacherAuthService(new PgAuthStore(db), { codePepper: enc.encode(peppers[0]!), ipPepper: enc.encode(peppers[1]!) })
  const staff = new SupabaseStaffVerifier({ supabaseUrl: need(env, 'SUPABASE_URL'), anonKey: need(env, 'SUPABASE_ANON_KEY', 10), db, ...(o.fetchImpl ? { fetchImpl: o.fetchImpl } : {}) })
  const staffEmails = (env.STAFF_LOGIN_EMAILS ?? '').split(',').map((x) => x.trim()).filter((x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)).slice(0, 4)
  const authStore = new PgAuthStore(db)
  const staffLogin = new StaffCodeLogin(authStore, { supabaseUrl: need(env, 'SUPABASE_URL'), anonKey: need(env, 'SUPABASE_ANON_KEY', 10), emails: staffEmails, ipPepper: enc.encode(peppers[1]!), ...(o.fetchImpl ? { fetchImpl: o.fetchImpl } : {}) })
  const uploads = new UploadService({ db, storage })
  const archives = new ArchiveService({ db, signer: storage })

  const yearArchives = new YearArchiveService({ db, signer: storage })
  const yearResets = new YearResetService({ db, storage: { removeObjectForYearReset: (k) => storage.removeObjectForYearReset(k), objectExists: (k) => storage.objectExists(k) } })

  const sink = new PgAuditSink(db)
  return createApiHandler({
    teacherAuth, staff, uploads, staffLogin,
    reads: new TeacherReadService({ db }),
    transfer: new TransferService({ db, signer: storage }),
    archives,
    yearArchives,
    yearResets,
    deleteVersion: new TeacherDeleteService({ db, storage: { removeTeacherObject: (k) => storage.removeTeacherObject(k) } }),
    admin: new AdminService({ db, issueCredentials: (id) => teacherAuth.issueCredentials(id, {}) }),
    ...(origin ? { allowedOrigin: origin } : {}),
    // التدقيق الدائم إلزامي: يُكتب في audit_log قبل الإجراء الحساس؛ `o.audit` إضافي (مثلًا لسجل المضيف) ولا يلغيه.
    audit: async (e) => { const extra = o.audit?.(e); await sink.record(e); await extra },
    ...(o.onUnexpected ? { onUnexpected: o.onUnexpected } : {}),
  })
}
