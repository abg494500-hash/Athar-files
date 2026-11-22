/// <reference types="vite/client" />
interface ImportMetaEnv {
  /** عنوان مشروع Supabase (عام). يُضبط في .env.local على جهازكِ فقط. */
  readonly VITE_SUPABASE_URL?: string
  /** المفتاح العام (publishable/anon) فقط. ممنوع أي مفتاح سري. */
  readonly VITE_SUPABASE_ANON_KEY?: string
  /** اختياري للتطوير المحلي فقط: يتجاوز حد حجم الملف (بالبايت). القيم غير الصالحة تُتجاهل. */
  readonly VITE_ATHAR_MAX_FILE_BYTES?: string
  /** عنوان واجهة المعلمة الخادمية (https أو localhost). غير مضبوط ⇒ تبويب المعلمة يعرض «غير متاح بعد». ليس سرًّا لكن لا يُكتب في الحزمة. */
  readonly VITE_TEACHER_API_URL?: string
}
