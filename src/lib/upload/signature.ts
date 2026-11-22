// فحص توقيع الملف (أول البايتات) لمطابقة الامتداد المُعلَن. مرجع نقي لما سيفعله الخادم في 5.4.
// **حدّ معروف:** توقيع ZIP لا يُثبت أن الملف DOCX/PPTX/XLSX سليم (يلزم فحص [Content_Types].xml)،
// ولا يكشف ملفًا خبيثًا بتوقيع صحيح. هو طبقة أولى فقط وليس فحص برمجيات خبيثة.
export type DetectedKind = 'pdf' | 'png' | 'jpeg' | 'gif' | 'webp' | 'zip'

const startsWith = (b: Uint8Array, sig: readonly number[], at = 0): boolean =>
  b.length >= at + sig.length && sig.every((v, i) => b[at + i] === v)

export function sniffSignature(head: Uint8Array): DetectedKind | null {
  if (startsWith(head, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'pdf' // %PDF-
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png'
  if (startsWith(head, [0xff, 0xd8, 0xff])) return 'jpeg'
  if (startsWith(head, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) || startsWith(head, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])) return 'gif'
  if (startsWith(head, [0x52, 0x49, 0x46, 0x46]) && startsWith(head, [0x57, 0x45, 0x42, 0x50], 8)) return 'webp' // RIFF....WEBP
  if (startsWith(head, [0x50, 0x4b, 0x03, 0x04])) return 'zip'
  return null
}

const EXT_TO_KIND: Record<string, DetectedKind> = {
  pdf: 'pdf', png: 'png', jpg: 'jpeg', jpeg: 'jpeg', gif: 'gif', webp: 'webp', docx: 'zip', pptx: 'zip', xlsx: 'zip',
}

/** امتداد غير معروف لهذا الجدول يُعدّ غير مطابق (الأمان بالرفض). */
export function extMatchesSignature(ext: string, kind: DetectedKind | null): boolean {
  const expected = EXT_TO_KIND[ext.toLowerCase()]
  return expected !== undefined && kind === expected
}
