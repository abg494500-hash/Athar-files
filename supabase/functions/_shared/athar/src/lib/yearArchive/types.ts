// مولَّد آليًا من src/lib/yearArchive/types.ts بواسطة scripts/build-edge-function.mjs — لا تعدّليه يدويًا.
// أنواع خطة الأرشيف السنوي المشتركة بين الخادم (يُنتجها) والمتصفح (يستهلكها). أنواع فقط.
export interface PlanVersion {
  id: string; teacherId: string; termId: string; termOrd: number; slotId: string; no: number; kind: 'file' | 'link'
  originalName: string | null; sizeBytes: number | null; mime: string | null; ext: string | null; sha256: string | null; url: string | null
  submittedAt: string; status: string; deadlines: unknown; replacedNote: string | null; entryPath: string
  /** رقم الجزء الذي يضم هذه النسخة (تقسيم حتمي يحسبه الخادم). */
  partNo: number
  /** حجم المدخل داخل الأرشيف (للملف حجمه، وللرابط طول نصه) وبصمته (للرابط تُحسب في الخادم). */
  entrySize: number; entrySha256: string
}
export interface PlanTeacher { id: string; name: string; subject: string; active: boolean; colorIdx: number; createdAt: string; removedAt: string | null; credential: { state: string; issuedAt: string | null; expiresAt: string | null } | null }
export interface YearPlan {
  year: { id: string; label: string; active: boolean; createdAt: string }
  terms: { id: string; name: string; ord: number; deadlineBase: string; deadlineLate: string; deadlineReplace: string }[]
  teachers: PlanTeacher[]
  slots: { id: string; title: string; optional: boolean; ord: number }[]
  submissions: { teacherId: string; termId: string; slotId: string; createdAt: string }[]
  versions: PlanVersion[]
  totals: { teachers: number; terms: number; submissions: number; versions: number; files: number; links: number; fileBytes: number }
  /** نسخ ملفاتها غير موجودة في التخزين (storage_state ≠ present): تمنع البناء. */
  problems: { versionId: string; reason: string }[]
  entriesDigest: string
  layout: { targetBytes: number; parts: { no: number; entries: number; bytes: number }[] }
}
