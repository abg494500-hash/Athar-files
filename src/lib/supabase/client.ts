import { createClient } from '@supabase/supabase-js'
import type { BackendClient } from './types'
import { checkPublicEnv, type PublicEnv } from './env'

/**
 * الملف الوحيد الذي يستورد @supabase/supabase-js.
 * يقرأ عنوان المشروع والمفتاح العام (publishable/anon) فقط. لا يقبل ولا يطلب أي مفتاح سري:
 * مفاتيح الخدمة السرية وكلمات مرور القاعدة لا تدخل الواجهة ولا ملفات البناء إطلاقًا (A-81).
 */
export type { PublicEnv }
export type ClientResult = { ok: true; client: BackendClient } | { ok: false; reason: string }

export function createSupabaseClient(env: PublicEnv | undefined): ClientResult {
  const c = checkPublicEnv(env)
  if (!c.ok) return c
  const client = createClient(c.url, c.key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  }) as unknown as BackendClient
  return { ok: true, client }
}
