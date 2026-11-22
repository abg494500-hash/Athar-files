import type { AppServices } from './services'
import { createAuthController } from '../lib/auth/controller'
import { createSupabaseClient } from '../lib/supabase/client'
import { createSupabaseRepository, createUnavailableRepository } from './supabase/supabaseRepository'

/**
 * نقطة التركيب الوحيدة لمصدر البيانات (المرحلة 3): Supabase الحقيقي دائمًا.
 * لا يستورد هذا الملف أي مصدر وهمي. إن فشل الإعداد ⇒ مصدر «غير متاح» بخطأ صريح، لا بيانات وهمية.
 */
export function createAppServices(env: { VITE_SUPABASE_URL?: string; VITE_SUPABASE_ANON_KEY?: string } | undefined): AppServices {
  const c = createSupabaseClient(env)
  if (!c.ok) return { repository: createUnavailableRepository(c.reason), auth: null, configError: c.reason }
  const auth = createAuthController(c.client)
  return { repository: createSupabaseRepository(c.client, auth), auth, configError: null }
}
