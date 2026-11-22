// مولَّد آليًا من src/lib/teacherImport/parse.ts بواسطة scripts/build-edge-function.mjs — لا تعدّليه يدويًا.
// استيراد المعلمات من CSV/Excel (A-119). منطق نقي بلا مكتبات: تحليل CSV، تحويل مصفوفة خلايا إلى صفوف، تطبيع، تحقق، كشف التكرار.
// نفس التحقق يعمل في المتصفح (للمعاينة) وفي الخادم (إعادة تحقق قبل الإدراج): لا يُوثَق بما يأتي من الواجهة.
// **لا يُستورد أي كود دخول أو رقم سري أو كلمة مرور**: عمود بهذه الأسماء يرفض الملف كله (تُصدَر الأكواد بعد الاستيراد من النظام نفسه).
export const MAX_IMPORT_ROWS = 300
export const MAX_IMPORT_BYTES = 2_000_000
export const NAME_MIN = 3, NAME_MAX = 80, SUBJECT_MIN = 2, SUBJECT_MAX = 60

export type CellValue = string | number | boolean | Date | null | undefined
export interface ImportRow { line: number; name: string; subject: string }
export type RowProblem = 'name_short' | 'name_long' | 'subject_short' | 'subject_long' | 'bad_chars' | 'formula' | 'duplicate_in_file' | 'duplicate_existing'
export interface CheckedRow extends ImportRow { problems: RowProblem[]; warnings: ('same_name_other_subject')[] }
export type FileError = 'empty' | 'too_many_rows' | 'missing_columns' | 'secret_column' | 'too_large' | 'unsupported_type' | 'unreadable'

const BIDI = /[‎‏‪-‮⁦-⁩؜﻿​-‍⁠]/g
const CTRL = /[\u0000-\u001f\u007f]/
const toStr = (v: CellValue): string => v === null || v === undefined ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v)
export const normalize = (s: string): string => s.replace(BIDI, '').normalize('NFC').replace(/\s+/g, ' ').trim()
/** مفتاح المقارنة (مطابق لـpublic.norm_text في القاعدة: lower + طي المسافات). */
export const keyOf = (name: string, subject: string): string => `${normalize(name).toLowerCase()}|${normalize(subject).toLowerCase()}`

const NAME_HEADERS = ['اسم المعلمة', 'الاسم', 'اسم', 'المعلمة', 'name', 'teacher', 'teacher name', 'full name']
const SUBJECT_HEADERS = ['المادة', 'مادة', 'التخصص', 'subject']
const SECRET_HEADERS = ['الكود', 'كود', 'رمز', 'رمز الدخول', 'كود الدخول', 'الرقم السري', 'رقم سري', 'كلمة المرور', 'كلمة السر', 'باسورد', 'pin', 'code', 'password', 'passcode', 'secret', 'token']
const hdr = (s: string) => normalize(s).toLowerCase().replace(/[:：]$/, '')

export const TEMPLATE_HEADERS = ['اسم المعلمة', 'المادة'] as const
export const TEMPLATE_EXAMPLES: [string, string][] = [['مثال: سارة بنت أحمد', 'رياضيات'], ['مثال: منى بنت سالم', 'علوم']]

/** CSV (RFC 4180): اقتباس مزدوج، فاصل «,» أو «;» أو tab يُكتشف من السطر الأول، BOM يُهمَل. */
export function parseCsv(text: string): string[][] {
  const t = text.replace(/^﻿/, '')
  const first = t.split(/\r?\n/, 1)[0] ?? ''
  const count = (c: string) => { let n = 0, q = false; for (const ch of first) { if (ch === '"') q = !q; else if (!q && ch === c) n++ } return n }
  const delim = [',', ';', '\t'].map((d) => [d, count(d)] as const).sort((a, b) => b[1] - a[1])[0]![0]
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let q = false
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]!
    if (q) { if (ch === '"') { if (t[i + 1] === '"') { cell += '"'; i++ } else q = false } else cell += ch }
    else if (ch === '"' && cell === '') q = true
    else if (ch === delim) { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = '' }
    else cell += ch
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows
}

/** يحوّل مصفوفة خلايا (من CSV أو Excel) إلى صفوف. أول صف غير فارغ = العناوين. */
export function matrixToRows(matrix: readonly (readonly CellValue[])[]): { rows: ImportRow[]; error?: FileError } {
  const nonEmpty = matrix.map((r, i) => ({ r, line: i + 1 })).filter((x) => x.r.some((c) => toStr(c).trim() !== ''))
  if (nonEmpty.length === 0) return { rows: [], error: 'empty' }
  const head = nonEmpty[0]!.r.map((c) => hdr(toStr(c)))
  if (head.some((h) => SECRET_HEADERS.includes(h))) return { rows: [], error: 'secret_column' }
  const ni = head.findIndex((h) => NAME_HEADERS.map(hdr).includes(h)), si = head.findIndex((h) => SUBJECT_HEADERS.map(hdr).includes(h))
  if (ni < 0 || si < 0) return { rows: [], error: 'missing_columns' }
  const body = nonEmpty.slice(1)
  if (body.length === 0) return { rows: [], error: 'empty' }
  if (body.length > MAX_IMPORT_ROWS) return { rows: [], error: 'too_many_rows' }
  return { rows: body.map(({ r, line }) => ({ line, name: toStr(r[ni]), subject: toStr(r[si]) })) }
}

const looksFormula = (s: string) => /^[=+\-@]/.test(s) && !/^[+\-]?\d/.test(s) || /^[=@]/.test(s)

/** يتحقق من الصفوف ويكشف التكرار داخل الملف ومع القائمة الحالية. لا يعدّل الأصل. */
export function checkRows(rows: readonly ImportRow[], existing: readonly { name: string; subject: string }[]): CheckedRow[] {
  const have = new Set(existing.map((e) => keyOf(e.name, e.subject)))
  const names = new Set(existing.map((e) => normalize(e.name).toLowerCase()))
  const seen = new Set<string>()
  return rows.map((raw) => {
    const name = normalize(raw.name), subject = normalize(raw.subject)
    const problems: RowProblem[] = []; const warnings: CheckedRow['warnings'] = []
    if (name.length < NAME_MIN) problems.push('name_short'); else if (name.length > NAME_MAX) problems.push('name_long')
    if (subject.length < SUBJECT_MIN) problems.push('subject_short'); else if (subject.length > SUBJECT_MAX) problems.push('subject_long')
    if (CTRL.test(name) || CTRL.test(subject) || /[<>]/.test(name + subject)) problems.push('bad_chars')
    if (looksFormula(name) || looksFormula(subject)) problems.push('formula')
    const k = keyOf(name, subject)
    if (problems.length === 0) {
      if (seen.has(k)) problems.push('duplicate_in_file')
      else if (have.has(k)) problems.push('duplicate_existing')
      else if (names.has(name.toLowerCase())) warnings.push('same_name_other_subject')
      seen.add(k)
    }
    return { line: raw.line, name, subject, problems, warnings }
  })
}

export const PROBLEM_TEXT: Record<RowProblem, string> = {
  name_short: `الاسم قصير (أقل من ${NAME_MIN} أحرف)`, name_long: `الاسم طويل (أكثر من ${NAME_MAX})`, subject_short: 'المادة ناقصة', subject_long: `المادة طويلة (أكثر من ${SUBJECT_MAX})`,
  bad_chars: 'يحوي رموزًا غير مسموحة', formula: 'يبدأ برمز معادلة (= + - @)', duplicate_in_file: 'مكرر داخل الملف', duplicate_existing: 'موجودة مسبقًا (الاسم والمادة)',
}
export const FILE_ERROR_TEXT: Record<FileError, string> = {
  empty: 'الملف فارغ أو لا يحوي صفوف بيانات.', too_many_rows: `الملف يحوي أكثر من ${MAX_IMPORT_ROWS} صفًا. قسّميه إلى ملفات أصغر.`,
  missing_columns: 'لم أجد العمودين المطلوبين: «اسم المعلمة» و«المادة». استعملي القالب.', secret_column: 'الملف يحوي عمودًا للكود أو الرقم السري أو كلمة المرور. لا تُستورد الأسرار أبدًا؛ احذفي العمود. تُصدَر الأكواد من النظام بعد الاستيراد.',
  too_large: 'حجم الملف كبير جدًا.', unsupported_type: 'نوع الملف غير مدعوم. استعملي .xlsx أو .csv.', unreadable: 'تعذّرت قراءة الملف. تأكدي أنه غير تالف وغير محمي بكلمة مرور.',
}

/** نص قالب CSV (UTF-8 مع BOM ليفتحه Excel بالعربية صحيحًا). */
export function templateCsv(): string {
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`
  return '﻿' + [TEMPLATE_HEADERS.map(q).join(','), ...TEMPLATE_EXAMPLES.map((r) => r.map(q).join(','))].join('\r\n') + '\r\n'
}
/** CSV أكواد الدخول بعد الإصدار (لتسليمها للمعلمات؛ تُنزَّل مرة واحدة في المتصفح ولا تُخزَّن). تُحمى الخلايا من حقن المعادلات. */
export function credentialsCsv(rows: readonly { name: string; subject: string; code: string }[]): string {
  const q = (s: string) => `"${(/^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`
  return '﻿' + [['اسم المعلمة', 'المادة', 'رمز الدخول'].map(q).join(','), ...rows.map((r) => [r.name, r.subject, r.code].map(q).join(','))].join('\r\n') + '\r\n'
}
