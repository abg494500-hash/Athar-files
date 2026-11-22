// قراءة ملفات الاستيراد وتوليد القوالب في المتصفح. Excel عبر read-excel-file/write-excel-file (MIT، اعتماد fflate فقط للكتابة) بلا خادم.
// نقرأ الورقة الأولى فقط، ونرفض أي نوع غير .xlsx/.csv. .xls القديم غير مدعوم عمدًا (لا مكتبة موثوقة صغيرة له).
import { readSheet } from 'read-excel-file/universal'
import writeXlsxFile from 'write-excel-file/universal'
import { MAX_IMPORT_BYTES, TEMPLATE_EXAMPLES, TEMPLATE_HEADERS, matrixToRows, parseCsv } from './parse'
import type { CellValue, FileError, ImportRow } from './parse'

export type ReadResult = { ok: true; rows: ImportRow[] } | { ok: false; error: FileError }

export async function readImportFile(file: Blob & { name?: string }): Promise<ReadResult> {
  if (file.size > MAX_IMPORT_BYTES) return { ok: false, error: 'too_large' }
  const name = (file.name ?? '').toLowerCase()
  try {
    let matrix: CellValue[][]
    if (name.endsWith('.csv') || name.endsWith('.txt')) matrix = parseCsv(await file.text())
    else if (name.endsWith('.xlsx')) matrix = (await readSheet(file)) as unknown as CellValue[][]
    else return { ok: false, error: 'unsupported_type' }
    const r = matrixToRows(matrix)
    return r.error ? { ok: false, error: r.error } : { ok: true, rows: r.rows }
  } catch { return { ok: false, error: 'unreadable' } }
}

/** قالب Excel: عنوانان + مثالان (يُحذفان قبل الرفع أو يُستبدلان). */
export async function templateXlsxBlob(): Promise<Blob> {
  const head = TEMPLATE_HEADERS.map((h) => ({ value: h, fontWeight: 'bold' as const, type: String }))
  const rows = TEMPLATE_EXAMPLES.map((r) => r.map((v) => ({ value: v, type: String })))
  return (await writeXlsxFile([head, ...rows], {})).toBlob()
}
