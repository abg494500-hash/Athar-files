// نافذة إتمام الرفع (A-33، OQ-12). **ساعتان مؤقتة وغير نهائية**، وهي إعداد (app_settings.upload_window_minutes) لا ثابت.
// كل الأزمنة هنا بالميلي ثانية (epoch)، وتأتي من ساعة الخادم عند التطبيق الفعلي، لا من جهاز المستخدمة.
export const PROVISIONAL_UPLOAD_WINDOW_MINUTES = 120

// مهلة اعتبار جلسة validating «عالقة» (5.B/قرار 5.A-3): **10 دقائق افتراضيًا، وهي إعداد قابل للتعديل لا مدة نهائية**
// (app_settings.validating_stuck_minutes في مسودة SQL v4). لا تُرفض الجلسة بعدها؛ تعود إلى uploaded لاستئنافها.
export const DEFAULT_VALIDATING_STUCK_MINUTES = 10

/** عدد صحيح موجب آمن، أو null (يقبل أعدادًا أو نصوصًا رقمية فقط). */
export function parseWindowMinutes(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\s*\d+\s*$/.test(raw) ? Number(raw) : NaN
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

export function computeExpiresAt(startedAtMs: number, windowMinutes: number): number {
  return startedAtMs + windowMinutes * 60_000
}

export interface WindowStatus {
  expired: boolean
  /** الزمن المتبقي بالميلي ثانية (0 عند الانقضاء). */
  remainingMs: number
}

/** تنقضي النافذة عند اللحظة expiresAt نفسها (>=). */
export function windowStatus(expiresAtMs: number, nowMs: number): WindowStatus {
  const remaining = expiresAtMs - nowMs
  return remaining > 0 ? { expired: false, remainingMs: remaining } : { expired: true, remainingMs: 0 }
}
