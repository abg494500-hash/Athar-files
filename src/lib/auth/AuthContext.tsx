import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react'
import type { AuthController, AuthState } from './controller'

const INITIAL: AuthState = { phase: 'signed_out', busy: false }
const Ctx = createContext<AuthController | null>(null)

/** يوفّر متحكّم المصادقة للواجهة. null إن لم يكتمل إعداد الاتصال. */
export function AuthProvider({ controller, children }: { controller: AuthController | null; children: ReactNode }) {
  return <Ctx.Provider value={controller}>{children}</Ctx.Provider>
}

export function useAuthController(): AuthController | null { return useContext(Ctx) }

export function useAuthState(): AuthState {
  const c = useContext(Ctx)
  return useSyncExternalStore(
    c ? c.subscribe : () => () => {},
    c ? c.getState : () => INITIAL,
    c ? c.getState : () => INITIAL,
  )
}
