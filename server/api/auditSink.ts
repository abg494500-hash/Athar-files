// كاتب سجل التدقيق الدائم (الدفعة 8): يحوّل أحداث المعالج المنسوبة لموظفة (مالكة/مديرة) إلى سطر في audit_log المسلسَل بالهاش،
// عبر الدالة `public.log_audit_as` (007) التي تتحقق من أن المنفِّذة موظفة نشطة بدور مطابق ولا تُمنح إلا لـservice_role.
// أحداث غير المنسوبة (مجهول/معلمة) لا تُكتب هنا: محاولات الدخول لها جدولها (login_attempts)، ورفض المجهول لا فاعل له.
// **لم يُشغَّل على قاعدة**: الاختبار بقاعدة بديلة تسجّل العبارات.
import type { Db } from '../db/types'
import type { AuditEvent } from './handler'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TARGET_TYPE: Record<string, string> = {
  'owner.issue_credentials': 'teacher', 'owner.revoke_credentials': 'teacher', 'staff.download': 'version',
  'owner.create_archive': 'term', 'owner.download_archive': 'archive',
}

export class PgAuditSink {
  private readonly db: Db
  constructor(db: Db) { this.db = db }
  readonly record = async (e: AuditEvent): Promise<void> => {
    if (e.actor.kind !== 'owner' && e.actor.kind !== 'director') return
    if (!e.actor.id || !UUID_RE.test(e.actor.id)) return
    const action = e.action.slice(0, 100)
    await this.db.transaction((c) => c.exec(
      `select public.log_audit_as($1::uuid, $2, $3, $4, $5::jsonb)`,
      [e.actor.id, action, TARGET_TYPE[e.action] ?? null, e.target ?? null, JSON.stringify({ outcome: e.outcome, at: e.at })]))
  }
}
