# تشغيل واختبار حزمة r22 على Windows (خطوة واحدة في كل مرة)

> لم يُجرَّب هذا الدليل على Windows. أرسلي لي ناتج كل خطوة كما يظهر، نجحت أو فشلت. **لا تنفّذي SQL على Supabase، ولا تنشري الدالة، ولا تضعي مفاتيح R2/Supabase أو `VITE_TEACHER_API_URL` في أي خطوة هنا.** الهدف الآن: اختبار الكود محليًا فقط.

## أ) الواجهة والخادم
1. فكّي `athar-handoff-r22-v0_6_13.zip` وافتحي PowerShell داخل `athar`. `node -v` (22 أو أحدث). `npm install` (وليس `npm ci`).
2. **`npm run typecheck`** وأرسلي الناتج كاملًا. صفحات React التالية لم تُجمَّع قط ومتوقع أخطاء: `Portal`، `TeacherPortalContext`، `StaffApiContext`، `UploadSessions`، وتعديلات `Login` و`App` و`TeacherDetail` و`VersionList` و`Archive` و`TeachersAdmin` و`Dashboard` و`controller.ts`. **أسماء الأيقونات** `Unlock` و`Wrench` و`Link2` و`Upload` و`RefreshCw` غير مؤكدة في إصدار `lucide-react` المثبّت؛ إن اشتكى المترجم فهذا هو السبب وإصلاحه سطر واحد.
3. `npm test` وأرسلي سطر الخلاصة (اختبارات القاعدة تمرّ بنائب).
4. `npm run build` ثم `node scripts/check-dist-no-mock.mjs` ثم `node scripts/check-no-secrets-in-frontend.mjs` (الأخير يفحص `dist` أيضًا بعد البناء؛ المتوقع 10/10).
5. فحوص الملفات الساكنة (لا تحتاج npm): `node scripts/check-sql-static.mjs` (39) و`check-stage3-static.mjs` (30) و`check-sql-additions-static.mjs` (28) و`check-code-sql-compat.mjs` و`check-no-secrets-in-frontend.mjs` (10) و`build-edge-function.mjs --check` («مطابق»).
6. (اختياري، Git Bash) المشغّل البديل: `sh scripts/node-test-runner/run.sh` — المتوقع 377/377.

## ب) PostgreSQL محلي مؤقت (اختياري، **ليس Supabase**)
`docs/phase5/WINDOWS_RUN_GUIDE.md` ثم `powershell -ExecutionPolicy Bypass -File tests\sql\run-sql-tests.ps1` (التشغيلات a وb وc وd). أرسلي المخرجات كاملة. هذه أول مرة يُشغَّل فيها أي SQL من الحزمة.

## ج) لاحقًا وبموافقتي فقط
1. SQL على مشروع Supabase تجريبي: `docs/SUPABASE_SETUP_AR.md`.
2. R2 وCORS: `docs/phase5/R2_INTEGRATION_AR.md`.
3. نشر دالة Edge وتجارب النهاية إلى النهاية: `docs/phase5/EDGE_HOST_AR.md`.
