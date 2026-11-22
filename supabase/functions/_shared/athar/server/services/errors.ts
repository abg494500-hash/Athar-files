// مولَّد آليًا من server/services/errors.ts بواسطة scripts/build-edge-function.mjs — لا تعدّليه يدويًا.
// أخطاء طبقة الخدمات. الرموز تطابق رموز المحاكي المرجعي (UploadLedger) حيث يتطابق المعنى، فتُقارَن السلوكيات بالرمز.
import type { UploadErrorCode } from '../../src/lib/upload/ledger.ts'

export type ServiceErrorCode =
  | UploadErrorCode
  /** مدخلات مشوّهة (معرّف/اسم/حجم/رابط) رُفضت قبل أي عمل. */
  | 'bad_request'
  | 'bad_url'
  /** الأرشيف السنوي: تغيّرت بيانات السنة بين البناء والتسجيل (نسخة جديدة/مختلفة) ⇒ أعيدي البناء. */
  | 'year_changed'
  /** ملفات السنة ناقصة في التخزين (حالة غير present) ⇒ لا بناء. */
  | 'files_missing'
  /** الإجراء قبل أوانه (مثل إقرار فتح الأرشيف قبل التحقق من بصمة التنزيل). */
  | 'not_ready'
  /** تعارض: اسم سنة مكرر، أو صفوف استيراد مكررة. */
  | 'conflict'
  /** السنة بدأ العمل عليها فلا يُعدَّل تعريفها. */
  | 'year_work_started'
  /** سنة أُغلقت بالتصفير. */
  | 'year_closed'
  /** حذف المعلمة لملفها (A-126): ليس آخر إصدار / أرشيف سنوي قائم / السنة غير نشطة / رفع جارٍ للخانة. */
  | 'delete_not_latest'
  | 'delete_archive_exists'
  | 'delete_year_inactive'

export class ServiceError extends Error {
  code: ServiceErrorCode
  constructor(code: ServiceErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code)
    this.name = 'ServiceError'
    this.code = code
  }
}
