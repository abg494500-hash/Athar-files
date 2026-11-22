import { createContext, useContext } from 'react'
import type { Version } from '../data/types'

/**
 * يتيح لنسخة الأرشيف (للقراءة فقط) أن تحدد كيف يُفتح ملف المعلمة (من المجلد المحلي) بدل الواجهة الخادمية.
 * في المنصة الحية لا قيمة له (null) فيبقى السلوك الخادمي كما هو.
 */
export const DownloadOverrideContext = createContext<((v: Version) => void) | null>(null)
export function useDownloadOverride(): ((v: Version) => void) | null { return useContext(DownloadOverrideContext) }

/** معاينة ملف داخل الصفحة: في الأرشيف (للقراءة فقط) تُرجع مسار الملف المحلي أو null إن لم يوجد؛ في المنصة الحية null فتُستعمل الواجهة الخادمية. */
export const PreviewOverrideContext = createContext<((v: Version) => string | null) | null>(null)
export function usePreviewOverride(): ((v: Version) => string | null) | null { return useContext(PreviewOverrideContext) }
