import type { AuthEvent, BackendClient, BackendError, BackendResult, Query } from '../lib/supabase/types'

/** عميل Supabase وهمي للاختبارات (بلا شبكة). يسجّل الاستدعاءات ويتيح محاكاة كل فرع. */
export interface FakeAuthOpts {
  user?: { id: string } | null
  getUserError?: BackendError
  signInError?: BackendError
  profile?: { role: unknown; is_active: unknown } | null
  profileError?: BackendError
  rpcRole?: unknown
  rpcError?: BackendError
  rpcResults?: Record<string, BackendResult<unknown>>
  tables?: Record<string, { rows?: Record<string, unknown>[]; error?: BackendError; writeError?: BackendError; singleRow?: Record<string, unknown> }>
}
export interface FakeBackend extends BackendClient {
  calls: string[]
  signOutScopes: (string | undefined)[]
  writes: { table: string; op: string; values: unknown; filters: [string, unknown][] }[]
  emit(e: AuthEvent): void
  setSession(user: { id: string } | null): void
}

const ok = <T,>(data: T): BackendResult<T> => ({ data, error: null })
const err = <T,>(error: BackendError): BackendResult<T> => ({ data: null, error })

export function makeBackend(o: FakeAuthOpts = {}): FakeBackend {
  let user: { id: string } | null = o.user === undefined ? null : o.user
  const calls: string[] = []
  const signOutScopes: (string | undefined)[] = []
  const writes: FakeBackend['writes'] = []
  let cb: ((e: AuthEvent) => void) | null = null

  const builder = (table: string): Query => {
    let op = 'select'
    let values: unknown
    const filters: [string, unknown][] = []
    let range: [number, number] | null = null
    const cfg = o.tables?.[table]
    const isProfile = table === 'staff_profiles'
    const resolveRows = (): BackendResult<Record<string, unknown>[]> => {
      if (op !== 'select') {
        writes.push({ table, op, values, filters: [...filters] })
        if (cfg?.writeError) return err(cfg.writeError)
        return ok(cfg?.singleRow ? [cfg.singleRow] : [{ id: 'row-1' }])
      }
      if (isProfile) return o.profileError ? err(o.profileError) : ok(o.profile ? [o.profile as Record<string, unknown>] : [])
      if (cfg?.error) return err(cfg.error)
      const rows = cfg?.rows ?? []
      return ok(range ? rows.slice(range[0], range[1] + 1) : rows)
    }
    const q: Query = {
      select: () => q,
      insert: (v) => { op = 'insert'; values = v; return q },
      update: (v) => { op = 'update'; values = v; return q },
      eq: (c, v) => { filters.push([c, v]); return q },
      order: () => q,
      range: (a, b) => { range = [a, b]; return q },
      maybeSingle: async () => { calls.push(`query:${table}`); const r = resolveRows(); return r.error ? err(r.error) : ok(r.data![0] ?? null as unknown as Record<string, unknown>) },
      single: async () => { calls.push(`query:${table}`); const r = resolveRows(); return r.error ? err(r.error) : ok(r.data![0] ?? ({} as Record<string, unknown>)) },
      then: (res, rej) => { calls.push(`query:${table}`); return Promise.resolve(resolveRows()).then(res, rej) },
    }
    return q
  }

  const client: FakeBackend = {
    calls, writes, signOutScopes,
    emit: (e) => cb?.(e),
    setSession: (u) => { user = u },
    auth: {
      getUser: async () => {
        calls.push('getUser')
        if (o.getUserError) return err(o.getUserError)
        if (!user) return err({ name: 'AuthSessionMissingError', message: 'Auth session missing!' })
        return ok({ user })
      },
      signInWithPassword: async () => {
        calls.push('signIn')
        if (o.signInError) return err(o.signInError)
        user = o.user ?? { id: 'u-1' }
        return ok({ user })
      },
      signOut: async (opts) => { calls.push('signOut'); signOutScopes.push(opts?.scope); user = null; return { error: null } },
      onAuthStateChange: (f) => { cb = f; return { data: { subscription: { unsubscribe: () => { cb = null } } } } },
    },
    from: builder,
    rpc: async (fn) => {
      calls.push(`rpc:${fn}`)
      const custom = o.rpcResults?.[fn]
      if (custom) return custom
      if (fn === 'current_staff_role') return o.rpcError ? err(o.rpcError) : ok('rpcRole' in o ? o.rpcRole : ((o.profile as { role?: unknown } | null | undefined)?.role ?? null))
      return ok(null)
    },
  }
  return client
}
