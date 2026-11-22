// إعدادات الملفات (R-02 / A-39): لا حد ثابت في منطق الواجهة. القيم تأتي من هنا ومن قدرات المزوّد.
// القيمة الافتراضية **مؤقتة وغير نهائية** وتطابق بذرة `database/001_schema.sql`.
export interface StorageSettings {
  maxFileBytes: number
  allowedExtensions: readonly string[]
}

export interface ProviderCapabilities {
  /** أكبر حجم يقبله المزوّد للكائن الواحد، أو null إن لم يُعرف/لا حد. */
  maxObjectBytes: number | null
}

/** مؤقت: 50 MB عشري (A-39، غير نهائي). */
export const PROVISIONAL_MAX_FILE_BYTES = 50_000_000
export const DEFAULT_ALLOWED_EXTENSIONS: readonly string[] = ['pdf', 'docx', 'pptx', 'xlsx', 'jpg', 'jpeg', 'png', 'webp', 'gif']

export function defaultSettings(): StorageSettings {
  return { maxFileBytes: PROVISIONAL_MAX_FILE_BYTES, allowedExtensions: DEFAULT_ALLOWED_EXTENSIONS }
}

/** عدد صحيح موجب آمن، أو null. تقبل أعدادًا أو نصوصًا رقمية فقط. */
export function parseMaxFileBytes(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\s*\d+\s*$/.test(raw) ? Number(raw) : NaN
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

/** تجاوز اختياري للتطوير المحلي فقط: VITE_ATHAR_MAX_FILE_BYTES. القيمة غير الصالحة تُتجاهل. */
export function settingsFromEnv(env: Record<string, unknown> | undefined): StorageSettings {
  const base = defaultSettings()
  const v = parseMaxFileBytes(env?.VITE_ATHAR_MAX_FILE_BYTES)
  return v === null ? base : { ...base, maxFileBytes: v }
}

/** الحد الفعلي = الأصغر بين الإعداد وحد المزوّد (إن وُجد). */
export function effectiveMaxBytes(settings: StorageSettings, caps: ProviderCapabilities): number {
  return caps.maxObjectBytes === null ? settings.maxFileBytes : Math.min(settings.maxFileBytes, caps.maxObjectBytes)
}

/** نص الحد للعرض: 50000000 → «50 ميغابايت»، و52428800 → «50 ميغابايت». */
export function fmtLimit(bytes: number): string {
  const trim = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))
  if (bytes % 1_000_000 === 0) return `${trim(bytes / 1_000_000)} ميغابايت`
  if (bytes % 1_048_576 === 0) return `${trim(bytes / 1_048_576)} ميغابايت`
  if (bytes >= 1_000_000) return `${trim(Math.round(bytes / 100_000) / 10)} ميغابايت`
  return `${trim(Math.round(bytes / 100) / 10)} كيلوبايت`
}

const TYPE_LABELS: Record<string, string> = {
  pdf: 'PDF', docx: 'DOCX', pptx: 'PPTX', xlsx: 'XLSX', jpg: 'JPG', jpeg: 'JPG', png: 'PNG', webp: 'WebP', gif: 'GIF',
}
export function typesLabel(exts: readonly string[]): string {
  const out: string[] = []
  for (const e of exts) {
    const l = TYPE_LABELS[e] ?? e.toUpperCase()
    if (!out.includes(l)) out.push(l)
  }
  return out.join(' · ')
}

export function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i < 0 ? '' : name.slice(i + 1).toLowerCase()
}

export type FileCheck =
  | { ok: true }
  | { ok: false; code: 'empty' | 'too_large' | 'type_not_allowed'; message: string }

/** فحص الملف في الواجهة (راحة للمستخدمة فقط). الفحص المُلزِم خادميًا وفي القاعدة (versions_guard_insert). */
export function checkFile(file: { name: string; size: number }, settings: StorageSettings, caps: ProviderCapabilities): FileCheck {
  if (!settings.allowedExtensions.includes(extOf(file.name)))
    return { ok: false, code: 'type_not_allowed', message: `نوع الملف غير مدعوم. الأنواع المقبولة: ${typesLabel(settings.allowedExtensions)}.` }
  if (file.size <= 0) return { ok: false, code: 'empty', message: 'الملف فارغ.' }
  const max = effectiveMaxBytes(settings, caps)
  if (file.size > max) return { ok: false, code: 'too_large', message: `حجم الملف أكبر من الحد المسموح (${fmtLimit(max)}).` }
  return { ok: true }
}
