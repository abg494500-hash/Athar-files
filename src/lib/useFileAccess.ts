import type { Version } from '../data/types'
import { useToast } from '../components/ui/Toast'
import { useStaffApi } from './staffApi/StaffApiContext'
import { staffMessage } from './staffApi/client'
import { useDownloadOverride, usePreviewOverride } from './downloadOverride'

export type PreviewResult = { ok: true; url: string } | { ok: false; message: string }
/** ما تستطيعه الشاشة الحالية مع ملف إصدار: تنزيل ومعاينة. أي منهما غائب ⇒ غير متاح (لا واجهة خادمية مضبوطة). */
export interface FileAccess {
  download?: (v: Version) => void
  preview?: (v: Version) => Promise<PreviewResult>
  /** 'archive' = ملفات من مجلد الأرشيف المحلي (بلا اتصال)، 'live' = المنصة الحية. */
  mode?: 'live' | 'archive'
}

/**
 * مصدر واحد لتنزيل الملفات ومعاينتها للمالكة والمديرة (r41):
 * - المنصة الحية: روابط موقّعة قصيرة العمر من الخادم (التنزيل attachment، والمعاينة inline لـ PDF والصور فقط).
 * - الأرشيف (للقراءة فقط): الملف من المجلد المحلي عبر السياقين في downloadOverride.
 */
export function useFileAccess(): FileAccess {
  const staffApi = useStaffApi()
  const dl = useDownloadOverride()
  const pv = usePreviewOverride()
  const toast = useToast()
  const out: FileAccess = { mode: pv ? 'archive' : 'live' }
  if (dl) out.download = (v) => dl(v)
  else if (staffApi) {
    out.download = (v) => {
      void staffApi.signVersionDownload(v.id).then((r) => { if (r.ok) window.location.assign(r.value.url); else toast(staffMessage(r), 'info') })
    }
  }
  if (pv) {
    out.preview = async (v) => { const u = pv(v); return u ? { ok: true, url: u } : { ok: false, message: 'تعذّر العثور على الملف في مجلد الأرشيف. تأكدي من استخراج كل الأجزاء.' } }
  } else if (staffApi) {
    out.preview = async (v) => {
      const r = await staffApi.signVersionDownload(v.id, { inline: true })
      return r.ok ? { ok: true, url: r.value.url } : { ok: false, message: staffMessage(r) }
    }
  }
  return out
}
