# تشغيل واختبار حزمة r21 على Windows (خطوة واحدة في كل مرة)

> لم يُجرَّب هذا الدليل على Windows. أرسلي لي ناتج كل خطوة كما يظهر، نجحت أو فشلت. **لا تنفّذي SQL على Supabase ولا تُدخلي مفاتيح R2/Supabase ولا تضعي `VITE_TEACHER_API_URL` في أي خطوة هنا.**

## أ) الواجهة والخادم (بلا قاعدة بيانات)
1. فكّي `athar-handoff-r21-v0_6_12.zip` وافتحي PowerShell داخل `athar`.
2. `node -v` (22 أو أحدث). `npm install` (وليس `npm ci`).
3. **`npm run typecheck`** وأرسلي الناتج كاملًا. هذه أهم خطوة: لم تُجمَّع قط `Portal.tsx` و`TeacherPortalContext.tsx` و`StaffApiContext.tsx` ولا تعديلات `Login.tsx` و`App.tsx` و`TeacherDetail.tsx` و`VersionList.tsx` و`Archive.tsx` و`controller.ts`.
4. `npm test` وأرسلي سطر الخلاصة. ملفات جديدة/موسّعة: `src/test/{teacherPortal.test.tsx, teacherAuthClient.test.ts, staffApiClient.test.ts}` و`server/test/{api,archiveBuilder,archiveService,compose,teacherRead,sigv4r2}.test.ts`. **اختبارات القاعدة ستمرّ بنائب** ما لم يتوفر PostgreSQL محلي.
5. `npm run build` ثم `node scripts/check-dist-no-mock.mjs`.
6. الفحوص الساكنة (لا تحتاج npm): `node scripts/check-sql-static.mjs` و`check-stage3-static.mjs` و`check-sql-additions-static.mjs` و`check-code-sql-compat.mjs`. المتوقع 39/39 و30/30 و28/28 و«لا عدم توافق».
7. (اختياري، Git Bash) المشغّل البديل `sh scripts/node-test-runner/run.sh` — المتوقع 346/346.

## ب) PostgreSQL محلي مؤقت (اختياري، **ليس Supabase**)
ثبّتي PostgreSQL 15+ محليًا ثم اتبعي `docs/phase5/WINDOWS_RUN_GUIDE.md`: `powershell -ExecutionPolicy Bypass -File tests\sql\run-sql-tests.ps1` (4 تشغيلات a وb وc وd؛ **d** يختبر 006 و007 لأول مرة). أرسلي المخرجات كاملة. وبعدها يمكن تشغيل اختبارات الخدمات على القاعدة (`ATHAR_TEST_PG`) حسب الدليل نفسه.

## ج) Supabase (بعد موافقتكِ فقط)
اتبعي **`docs/SUPABASE_SETUP_AR.md`** حرفيًا (مشروع تجريبي جديد، الملفات 1 ثم 2 ثم 3 ثم 4 ثم 5 ثم 6). لا تنفّذي شيئًا على مشروع فيه بيانات حقيقية.
