# تشغيل المشروع والاختبارات على Windows

> كل ما يلي محلي. لا Supabase ولا Cloudflare ولا بيانات حقيقية. لم تُجرَّب هذه الخطوات على Windows من قبلي (بيئة عملي Linux بلا شبكة)؛ أي خطأ تجدينه سجّليه.

## أ) المشروع والاختبارات (Node)
1. ثبّتي Node.js 20 أو أحدث (يُفضَّل LTS) من nodejs.org، ثم افتحي PowerShell في مجلد المشروع.
2. `npm install` (يحتاج إنترنت مرة واحدة؛ لا `npm ci` ما دام `package-lock.json` غير محدَّث — انظر docs/WINDOWS_TEST_STAGE3_AR.md) ثم `npm test` (vitest) و`npm run typecheck` و`npm run build`.
3. تشغيل الواجهة: `npm run dev` ثم افتحي العنوان الظاهر.
4. بديل بلا تثبيت vitest (منطق الرفع فقط): `sh scripts/node-test-runner/run.sh` (يحتاج Git Bash أو WSL) أو انظر الأمر داخل الملف وشغّليه بـNode 22.
5. فحص SQL النصي: `node scripts/check-sql-static.mjs`.

## ب) اختبار SQL على PostgreSQL محلي معزول (لم أستطع تنفيذه في بيئة عملي: لا PostgreSQL ولا شبكة)
**لماذا لا بديل عن PostgreSQL حقيقي:** المطلوب إثبات أن RLS والمنح والأدوار تعمل فعلًا. المحاكيات (مثل PGlite أو pg-mem) لم يُتحقَّق من أمانة محاكاتها للأدوار وRLS، فلا نعتمدها. وإنشاء مشروع Supabase للاختبار خدمة حقيقية (لاحقًا بإذنك).

**الخطوة 0 (دقيقة واحدة، قراءة فقط، لا تثبيت):** شغّلي `powershell -ExecutionPolicy Bypass -File tests\sql\detect-postgres.ps1` وأرسلي الناتج. إن وُجد PostgreSQL 15+ أو Docker أو WSL فنستعمله بلا تثبيت جديد.

**الخيارات بترتيب الأخف أثرًا على جهازك** (الحاجة: PostgreSQL **15 أو أحدث**، يُوصى بـ16):
1. **نسخة محمولة بلا تثبيت (موصى بها إن لم يوجد شيء):** من صفحة التنزيل الرسمية postgresql.org/download/windows (رابط «Download binaries» ملف zip) نزّلي ملف الإصدار 16 وفكّيه في مجلد مثل `C:\tools\pgsql`، ثم:
   `powershell -ExecutionPolicy Bypass -File tests\sql\run-portable.ps1 -PgBin "C:\tools\pgsql\bin"`.
   لا خدمة ولا سجل ولا كلمة مرور: يعمل على المنفذ 54329 محليًا، ويُحذف مجلد بياناته المؤقت بعد الانتهاء، وحذفه الكامل لاحقًا بحذف مجلد `pgsql`. الحجم التقريبي (من الذاكرة، غير مؤكد): تنزيل 200–300 MB. **لم يُجرَّب هذا السكربت بعد.**
2. **Docker Desktop إن كان موجودًا:** `docker run --rm -d --name athar-pg -p 54329:5432 -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16` ثم `tests\sql\run-sql-tests.ps1 -Psql "<مسار psql>" -Port 54329`، ثم `docker stop athar-pg`. (الصورة نحو 400 MB.)
3. **المثبّت الرسمي (الأثقل):** من postgresql.org (EDB)، Server وCommand Line Tools فقط، كلمة مرور لـ`postgres`، المنفذ 5432؛ ثم `$env:PGPASSWORD="..."; powershell -ExecutionPolicy Bypass -File tests\sql\run-sql-tests.ps1`. للإزالة: «Apps» ← Uninstall. الحجم التقريبي غير مؤكد: تنزيل 300–350 MB ومساحة 0.5–1 GB.

كل الخيارات محلية فقط: المشغّل ينشئ ويحذف قاعدتين باسمي `athar_test_a` و`athar_test_b` ويرفض أي خادم غير محلي. يستغرق التشغيل نحو دقيقتين (اختبار الانقضاء ينتظر 62 ثانية). للإبقاء على القاعدتين لاختبار التزامن اليدوي (`tests/sql/30_concurrency.md`): `-Keep`.

**ما أحتاجه منك بعد التشغيل:** مجلد `tests\sql\results` كاملًا (ملفا `athar_test_a.log` و`athar_test_b.log`). سطور `FAIL` تُصلَح وتُعاد، ولن أعلن النجاح قبل رؤية نتيجة فعلية. **محدّث 2026-10-21:** نُفِّذت هذه الاختبارات على PostgreSQL 16 على Linux ونجحت (A 62/62، B 57/57) بعد إصلاح S-1؛ المتوقع الآن نجاح كامل على Windows أيضًا، وأي إخفاق جديد يعني اختلاف بيئة يجب تسجيله. لم تُجرَّب على Windows بعد.
