/**
 * أخطاء أوامر البيانات (نقي، بلا React). تستعمله طبقة Supabase والصفحات معًا ليُعرض للمستخدمة سبب مفهوم
 * بدل نجاح وهمي. لا تُعرض رسائل تقنية خام إلا إن كانت عربية كتبناها نحن في دوال القاعدة.
 */

/** أمر لم تُفتح صلاحيته بعد (مرحلة لاحقة في الخطة A-83). لا يُنفَّذ شيء ولا يُتجاوز RLS. */
export class UnavailableError extends Error {
  readonly unavailable = true
  constructor(message: string) { super(message); this.name = 'UnavailableError' }
}

export interface ErrorLike { message?: string; code?: string; status?: number; name?: string }

const hasArabic = (s: string) => /[؀-ۿ]/.test(s)

export function describeCommandError(e: unknown): string {
  if (e instanceof UnavailableError) return e.message
  const x = (e ?? {}) as ErrorLike
  const msg = String(x.message ?? '')
  const m = msg.toLowerCase()
  if (m.includes('failed to fetch') || m.includes('network') || m.includes('fetch failed')) return 'تعذّر الاتصال بالخادم. تحققي من الإنترنت ثم أعيدي المحاولة.'
  if (x.code === 'PGRST301' || m.includes('jwt expired') || x.status === 401) return 'انتهت الجلسة. سجّلي الدخول من جديد.'
  if (msg && hasArabic(msg) && x.code !== undefined) return msg // رسائل قاعدة البيانات العربية (مثل «سبب التعديل مطلوب»)
  if (x.code === '42501' || x.status === 403) return 'ليس لديكِ صلاحية لتنفيذ هذا الإجراء.'
  if (x.code === '23505') return 'هذه القيمة موجودة مسبقًا.'
  if (x.code === '23514' || x.code === '23502' || x.code === '22P02') return 'القيمة المُدخلة غير مقبولة.'
  if (x.code === 'NO_ROWS') return 'لم يُطبَّق التعديل: السجل غير موجود أو ليس لديكِ صلاحية عليه.'
  return `تعذّر تنفيذ العملية.${x.code ? ` (رمز: ${x.code})` : ''}`
}

/** وصف خطأ التحميل الأولي. */
export function describeLoadError(e: unknown): string {
  const x = (e ?? {}) as ErrorLike
  const m = String(x.message ?? '').toLowerCase()
  if (m.includes('failed to fetch') || m.includes('network') || m.includes('fetch failed')) return 'تعذّر الاتصال بالخادم. تحققي من الإنترنت ثم أعيدي المحاولة.'
  if (x.code === 'PGRST301' || m.includes('jwt expired') || x.status === 401) return 'انتهت الجلسة. سجّلي الدخول من جديد.'
  if (x.code === '42501' || x.status === 403) return 'لا تملك هذه الجلسة صلاحية قراءة البيانات. سجّلي الخروج ثم الدخول وأكملي التحقق بخطوتين.'
  if (x.code === '42P01' || x.code === 'PGRST205') return 'جداول المنصة غير موجودة أو غير مكتملة في قاعدة البيانات (تحققي من تطبيق ملفات المرحلة الثانية).'
  if (x.name === 'MappingError') return 'بيانات من الخادم بصيغة غير متوقعة، فلم تُعرض.'
  return `تعذّر تحميل البيانات.${x.code ? ` (رمز: ${x.code})` : ''}`
}
