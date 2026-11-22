// مسارات الأرشيف السنوي (A-115). وحدة نقية يستعملها المتصفح (يبني ويتحقق) والخادم (يعيد حساب المتوقع من القاعدة) فيتطابق الطرفان.
// المسارات ASCII فقط: لا اعتماد على ترميز أسماء الملفات العربية داخل ZIP أو نظام الملفات. الاسم الأصلي يُحفظ في data.js ويُعرض في الواجهة.

export const ARCHIVE_FORMAT = 'athar-year-archive/2'
/** حجم الجزء المستهدف (بايت). كل جزء ZIP مستقل البنية؛ ملف أكبر من الهدف يأخذ جزءًا وحده. */
export const DEFAULT_PART_BYTES = 200_000_000
export const MIN_PART_BYTES = 50_000_000
/** أكبر جزء: ملف ZIP واحد بلا ZIP64 (حد 4GB) مع هامش للفهرس والعارض. السنة التي تتجاوزه تُقسَّم تلقائيًا. */
export const MAX_PART_BYTES = 3_500_000_000
/** خيار «ملف واحد» في الواجهة: أكبر جزء ممكن. */
export const SINGLE_FILE_BYTES = MAX_PART_BYTES
/** أكبر ملف منفرد يمكن بناؤه (حد ZIP بلا ZIP64 وحد قراءة الملف كاملًا لحساب بصمته في المتصفح). */
export const MAX_FILE_BYTES = 1_000_000_000
/** أقصى عدد أجزاء في أرشيف واحد (حد جسم الطلب في الخادم 16KB). مع جزء 200MB ⇒ حتى 12GB. */
export const MAX_PARTS = 60

export interface EntryVersion {
  id: string
  termOrd: number
  teacherId: string
  slotId: string
  no: number
  kind: 'file' | 'link'
  ext: string | null
  originalName: string | null
}

/** اسم آمن: ASCII (حروف وأرقام ونقطة وشرطة)، بلا نقطة طرفية، وبحد أقصى 40 محرفًا. */
export function safeComponent(s: string, fallback = 'x'): string {
  const t = s.normalize('NFKD').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._-]+|[._-]+$/g, '').slice(0, 40)
  return t === '' ? fallback : t
}

/** مسار مدخل نسخة داخل الأرشيف. الملفات تحت files/ والروابط (نص الرابط) تحت links/. */
export function versionEntryPath(v: EntryVersion): string {
  const base = `t${v.termOrd}/${safeComponent(v.teacherId)}/${safeComponent(v.slotId)}`
  if (v.kind === 'link') return `links/${base}/v${v.no}.url.txt`
  const ext = safeComponent(v.ext ?? 'bin', 'bin').toLowerCase()
  const stem = safeComponent((v.originalName ?? '').replace(/\.[^.]*$/, ''), 'file').slice(0, 30)
  return `files/${base}/v${v.no}-${stem}.${ext}`
}

/** محتوى مدخل الرابط (بايتات UTF-8 لنص الرابط + سطر جديد) كي يكون لكل نسخة بصمة وحجم. */
export function linkEntryText(url: string): string { return `${url}\n` }

/** مدخل الملخّص: كل نسخة وبصمة محتواها ورقم الجزء الذي يضمها. يُرتَّب ويُجمَّع ثم تُحسب بصمته على الطرفين. */
export function entriesDigestText(items: readonly { id: string; sha256: string; part: number }[]): string {
  return [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((i) => `${i.id}:${i.sha256}:${i.part}`).join('\n')
}

export interface PartSortKey { id: string; termOrd: number; teacherId: string; slotId: string; no: number; entrySize: number }
const cmp = (a: string | number, b: string | number) => (a < b ? -1 : a > b ? 1 : 0)
/** تقسيم حتمي: ترتيب ثابت (فصل، معلمة، خانة، رقم إصدار) ثم تعبئة جشعة حتى الحجم المستهدف. نفس الدالة في الخادم والمتصفح فلا يختلف التقسيم. */
export function partitionVersions(items: readonly PartSortKey[], targetBytes: number): { partOf: Map<string, number>; parts: { no: number; entries: number; bytes: number }[] } {
  const sorted = [...items].sort((a, b) => cmp(a.termOrd, b.termOrd) || cmp(a.teacherId, b.teacherId) || cmp(a.slotId, b.slotId) || cmp(a.no, b.no) || cmp(a.id, b.id))
  const partOf = new Map<string, number>(); const parts: { no: number; entries: number; bytes: number }[] = [{ no: 1, entries: 0, bytes: 0 }]
  for (const v of sorted) {
    let cur = parts[parts.length - 1]!
    if (cur.entries > 0 && cur.bytes + v.entrySize > targetBytes) { cur = { no: parts.length + 1, entries: 0, bytes: 0 }; parts.push(cur) }
    cur.entries++; cur.bytes += v.entrySize; partOf.set(v.id, cur.no)
  }
  return { partOf, parts }
}

export const pad2 = (n: number): string => String(n).padStart(2, '0')
export function partFilename(label: string, day: string, no: number, of: number): string { return `athar-archive-${safeComponent(label, 'year')}-${day}-part-${pad2(no)}-of-${pad2(of)}.zip` }
export const PART_FILENAME_RE = /^[A-Za-z0-9._-]{1,140}$/
/** بصمة الأرشيف الرئيسية: بصمات الأجزاء بترتيبها. */
export function partsDigestText(parts: readonly { no: number; sha256: string }[]): string { return [...parts].sort((a, b) => a.no - b.no).map((p) => `${p.no}:${p.sha256}`).join('\n') }
