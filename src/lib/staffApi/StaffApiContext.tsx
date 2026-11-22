import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { checkTeacherApiUrl } from '../teacherAuth/client'
import { createStaffApiClient } from './client'
import type { StaffApiClient } from './client'

/**
 * يوفّر عميل الواجهة الخادمية للوحات الإدارة **فقط حين** يُضبط VITE_TEACHER_API_URL (العنوان نفسه الذي تستعمله بوابة المعلمة) وتتوفر دالة رمز الوصول.
 * وإلا يكون null فتبقى الأزرار على سلوكها الحالي («غير متاح حاليًا»).
 */
const Ctx = createContext<StaffApiClient | null>(null)

export function StaffApiProvider({ getToken, client: injected, children }: { getToken?: () => Promise<string | null>; client?: StaffApiClient | null; children: ReactNode }) {
  const client = useMemo<StaffApiClient | null>(() => {
    if (injected !== undefined) return injected
    const url = checkTeacherApiUrl(import.meta.env.VITE_TEACHER_API_URL)
    if (!url || !getToken) return null
    try { return createStaffApiClient({ baseUrl: url, getToken }) } catch { return null }
  }, [injected, getToken])
  return <Ctx.Provider value={client}>{children}</Ctx.Provider>
}

export function useStaffApi(): StaffApiClient | null { return useContext(Ctx) }
