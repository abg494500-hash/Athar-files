// قواعد الروابط والمعاينة. حدود الملفات (الحجم/الأنواع) **ليست هنا**: تأتي من الإعدادات وقدرات المزوّد
// (انظر src/lib/storage/settings.ts) — معالجة R-02 وفق A-39. الفحص المُلزِم خادميًا ثم في القاعدة (C-03 مفتوح).
export { extOf } from './storage/settings'
import { extOf } from './storage/settings'

export function validateLink(raw: string): string | null {
  const v = raw.trim()
  if (!v) return 'يرجى إدخال الرابط.'
  let u: URL
  try { u = new URL(v) } catch { return 'الرابط غير صحيح. تأكدي من كتابته كاملًا.' }
  if (u.protocol !== 'https:') return 'يجب أن يبدأ الرابط بـ https://'
  if (!u.hostname.includes('.')) return 'الرابط غير صحيح. تأكدي من كتابته كاملًا.'
  return null
}

export type PreviewKind = 'pdf' | 'image' | 'office' | 'download'
export function previewKind(name: string): PreviewKind {
  const e = extOf(name)
  if (e === 'pdf') return 'pdf'
  if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(e)) return 'image'
  if (['docx', 'pptx', 'xlsx', 'doc', 'ppt', 'xls'].includes(e)) return 'office'
  return 'download'
}

export const KIND_LABEL: Record<string, string> = {
  pdf: 'PDF', docx: 'Word', pptx: 'PowerPoint', xlsx: 'Excel', jpg: 'صورة', jpeg: 'صورة', png: 'صورة', webp: 'صورة', gif: 'صورة',
}
