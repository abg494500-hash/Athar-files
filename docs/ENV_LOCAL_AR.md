# إعداد الاتصال محليًا (مختصر)

المرجع الكامل: `START_HERE_AR.md` (القسم 8).

1. القيم العامة فقط من Supabase ← Project Settings ← API: **Project URL** و**المفتاح العام** (publishable/anon). لا `service_role` ولا `secret` ولا كلمة مرور القاعدة (الواجهة ترفضها).
2. من جذر المشروع: `Copy-Item env-local-template.txt .env.local` ثم `notepad .env.local` وضعي:
```
VITE_SUPABASE_URL=https://REF.supabase.co
VITE_SUPABASE_ANON_KEY=المفتاح-العام
VITE_TEACHER_API_URL=https://REF.supabase.co/functions/v1/api
```
(الأخير بعد نشر الدالة فقط.) اسم الملف بالضبط `.env.local` لا `.env.local.txt`.
3. `npm ci` (مرة) ثم `npm run dev` وافتحي الرابط. للهاتف: `npm run dev -- --host`. الإيقاف: `Ctrl+C`.
4. رسالة «الاتصال بقاعدة البيانات غير مُعدّ» تعني أن `.env.local` ناقص أو خاطئ؛ أوقفي الخادم وأعيدي تشغيله بعد التصحيح.
