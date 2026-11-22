import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { checkTeacherApiUrl, createTeacherApiClient, TEACHER_AUTH_MESSAGES } from './client'
import type { TeacherApiClient, TeacherIdentity } from './client'

/**
 * سياق بوابة المعلمة: جلسة المعلمة (رمز معتم في sessionStorage) مستقلة تمامًا عن جلسة الإدارة (Supabase Auth).
 * يعمل فقط حين يُضبط VITE_TEACHER_API_URL (أو يُمرَّر client صراحةً في الاختبار)؛ وإلا يبقى `configured=false` فيعرض الدخول «غير متاح بعد».
 */
export type PortalPhase = 'initializing' | 'signed_out' | 'signed_in'
export interface TeacherPortalValue {
  configured: boolean
  client: TeacherApiClient | null
  phase: PortalPhase
  teacher: TeacherIdentity | null
  busy: boolean
  /** رسالة عربية جاهزة أو null. */
  error: string | null
  login: (code: string) => Promise<boolean>
  /** (r38) الصندوق الموحَّد: 'teacher' | 'failed' | جلسة إدارة تُسلَّم للمتحكّم. */
  loginAny: (code: string) => Promise<'teacher' | 'failed' | { accessToken: string; refreshToken: string }>
  logout: () => Promise<void>
  /** يُستدعى عند 401 من أي طلب بيانات. */
  expire: () => void
}

const NOT_CONFIGURED: TeacherPortalValue = {
  configured: false, client: null, phase: 'signed_out', teacher: null, busy: false, error: null,
  login: async () => false, loginAny: async () => 'failed' as const, logout: async () => {}, expire: () => {},
}
const Ctx = createContext<TeacherPortalValue>(NOT_CONFIGURED)

function defaultClient(): TeacherApiClient | null {
  const url = checkTeacherApiUrl(import.meta.env.VITE_TEACHER_API_URL)
  if (!url || typeof window === 'undefined') return null
  try { return createTeacherApiClient({ baseUrl: url, storage: window.sessionStorage }) } catch { return null }
}

export function TeacherPortalProvider({ client: injected, children }: { client?: TeacherApiClient | null; children: ReactNode }) {
  const client = useMemo(() => (injected !== undefined ? injected : defaultClient()), [injected])
  const [phase, setPhase] = useState<PortalPhase>(client && client.hasToken() ? 'initializing' : 'signed_out')
  const [teacher, setTeacher] = useState<TeacherIdentity | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  // استئناف جلسة محفوظة: يتحقق الخادم من الرمز؛ عطل الشبكة لا يمحو الجلسة (يبقى signed_out مع رسالة، والرمز محفوظ).
  useEffect(() => {
    if (!client || phase !== 'initializing') return
    void client.me().then((r) => {
      if (!alive.current) return
      if (r.ok) { setTeacher(r.value); setPhase('signed_in') } else { setPhase('signed_out'); if (r.error !== 'unauthenticated') setError(TEACHER_AUTH_MESSAGES[r.error]) }
    })
  }, [client, phase])

  const login = useCallback(async (code: string) => {
    if (!client) return false
    setBusy(true); setError(null)
    const r = await client.login(code)
    if (!alive.current) return false
    setBusy(false)
    if (r.ok) { setTeacher(r.value); setPhase('signed_in'); return true }
    setError(TEACHER_AUTH_MESSAGES[r.error]); return false
  }, [client])

  const loginAny = useCallback(async (code: string) => {
    if (!client) return 'failed' as const
    setBusy(true); setError(null)
    const r = await client.loginAny(code)
    if (!alive.current) return 'failed' as const
    setBusy(false)
    if (!r.ok) { setError(TEACHER_AUTH_MESSAGES[r.error]); return 'failed' as const }
    if (r.value.kind === 'teacher') { setTeacher(r.value.teacher); setPhase('signed_in'); return 'teacher' as const }
    return { accessToken: r.value.accessToken, refreshToken: r.value.refreshToken }
  }, [client])

  const logout = useCallback(async () => {
    if (!client) return
    await client.logout()
    if (!alive.current) return
    setTeacher(null); setPhase('signed_out'); setError(null)
  }, [client])

  const expire = useCallback(() => { setTeacher(null); setPhase('signed_out'); setError(TEACHER_AUTH_MESSAGES.unauthenticated) }, [])

  const value = useMemo<TeacherPortalValue>(() => ({ configured: client !== null, client, phase, teacher, busy, error, login, loginAny, logout, expire }), [client, phase, teacher, busy, error, login, logout, expire])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useTeacherPortal(): TeacherPortalValue { return useContext(Ctx) }
