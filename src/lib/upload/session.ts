// حالات جلسة الرفع وانتقالاتها المسموحة (5.1). تطابق قيد `state` في `upload_sessions` (database/001_schema.sql).
// منطق مرجعي نقي بلا اعتماد على مزوّد تخزين ولا على React. الإلزام الفعلي يجب أن يكون في الخادم/القاعدة (5.4)،
// وهذا الملف هو المرجع الذي تُقارَن به تلك الطبقة.
// 'cancelled' مقترح (C-5، A-56 مبدئي): إلغاء صريح لجلسة لم يصل ملفها بعد؛ لا يوجد في `database/001` الحالي.
export type UploadState = 'started' | 'uploaded' | 'validating' | 'accepted' | 'rejected' | 'expired' | 'cancelled'

/** أسباب الرفض/الفشل (رموز ثابتة؛ الرسائل العربية في الواجهة لاحقًا). */
export type RejectReason =
  | 'expired'
  | 'empty'
  | 'too_large'
  | 'type_not_allowed'
  | 'size_mismatch'
  | 'signature_mismatch'
  | 'hash_invalid'
  | 'deadline_closed'

export const TERMINAL_STATES: readonly UploadState[] = ['accepted', 'rejected', 'expired', 'cancelled']

/** الجلسات «النشطة» (C-5): جلسة واحدة منها فقط لكل (معلمة، فصل، خانة). */
export const ACTIVE_STATES: readonly UploadState[] = ['started', 'uploaded', 'validating']

// «expired» ممكن من started فقط: النافذة تحكم الوقت حتى استلام الملف كاملًا (uploaded).
// بعد uploaded لا تنقضي الجلسة بالنافذة، ولا تُرفض لمجرد تأخر التحقق (قرار 5.A: أُلغي سبب «stalled»).
// تأخر التحقق أو تعطّله ليس سببًا للرفض: validating → uploaded يعيد الجلسة لطابور التحقق لاستئنافه،
// وللمالكة وحدها إفراج مسجَّل بملاحظة إلزامية (uploaded/validating → cancelled) لجلسة عالقة فعلًا؛ يفرضه الخادم (وحقل release_note في القاعدة).
const TRANSITIONS: Record<UploadState, readonly UploadState[]> = {
  started: ['uploaded', 'rejected', 'expired', 'cancelled'],
  uploaded: ['validating', 'rejected', 'cancelled'],
  validating: ['accepted', 'rejected', 'uploaded', 'cancelled'],
  accepted: [],
  rejected: [],
  expired: [],
  cancelled: [],
}

export function canTransition(from: UploadState, to: UploadState): boolean {
  return TRANSITIONS[from].includes(to)
}

export function isTerminal(state: UploadState): boolean {
  return TERMINAL_STATES.includes(state)
}

/** جلسات وصل ملفها وتنتظر التحقق أو استئنافه (لا تنقضي بالنافذة ولا تُرفض بالتأخير). */
export const PENDING_VERIFICATION_STATES: readonly UploadState[] = ['uploaded', 'validating']

export function isActive(state: UploadState): boolean {
  return ACTIVE_STATES.includes(state)
}
