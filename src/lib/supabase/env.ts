/** فحص إعدادات الاتصال العامة (نقي، بلا استيراد للمكتبة، ليُختبر دون شبكة). */
export interface PublicEnv { VITE_SUPABASE_URL?: string; VITE_SUPABASE_ANON_KEY?: string }

/** يتحقق من الإعداد دون إنشاء عميل: دالة نقية قابلة للاختبار. */
export function checkPublicEnv(env: PublicEnv | undefined): { ok: true; url: string; key: string } | { ok: false; reason: string } {
  const url = (env?.VITE_SUPABASE_URL ?? '').trim()
  const key = (env?.VITE_SUPABASE_ANON_KEY ?? '').trim()
  if (!url || !key) return { ok: false, reason: 'إعدادات الاتصال بقاعدة البيانات غير مكتملة (ملف .env.local).' }
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/i.test(url)) {
    return { ok: false, reason: 'عنوان المشروع في .env.local غير صالح.' }
  }
  // حارس دفاعي: مفتاح service_role هو JWT بدور service_role؛ يُرفض إن وُضع هنا بالخطأ. المفاتيح الحديثة السرية تبدأ بـ sb_secret_.
  if (/^sb_secret_/i.test(key)) return { ok: false, reason: 'وُضع مفتاح سري في إعدادات الواجهة. استعملي المفتاح العام فقط (publishable/anon).' }
  const payload = key.split('.')[1]
  if (payload) {
    try {
      const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as { role?: string }
      if (json.role === 'service_role') return { ok: false, reason: 'وُضع مفتاح service_role في إعدادات الواجهة. ارفضيه واستعملي المفتاح العام فقط.' }
    } catch { /* ليس JWT: مفتاح publishable الحديث */ }
  }
  return { ok: true, url, key }
}

