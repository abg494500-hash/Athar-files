# تعليمات الاستكمال من حساب آخر (بعد r28 / 0.6.19)

أرفقي هذه الحزمة وقولي: «أكمِل مشروع أثَر من الحزمة المرفقة». اقرئي أولًا: `HANDOFF.md` ثم `docs/DEPLOYMENT_GUIDE_AR.md` (خطة التنفيذ الكاملة) و`docs/phase5/BATCH_R28_REPORT.md` ثم `docs/phase5/NPM_FIX_EXECUTION_AR.md` و`docs/HANDOVER_AR.md` و`docs/phase5/BATCH_R26_REPORT.md` ثم `BATCH_R25_REPORT.md` و`NPM_FULL_PLAN_AR.md` ثم `BATCH_R24_REPORT.md` و`NPM_REMEDIATION_AR.md` ثم `BATCH_R23_REPORT.md` و`NPM_AUDIT_AR.md` ثم `BATCH_R22_REPORT.md` و`EDGE_HOST_AR.md` ثم `BATCH_R21_REPORT.md` و`BATCH_R20_REPORT.md` و`R2_INTEGRATION_AR.md`، وللقاعدة `docs/SUPABASE_SETUP_AR.md` و`database/README_SEQUENCE_AR.md`.

> **تصحيح (r19):** النسخة السابقة من هذا الملف وصفت الوضع بعد r17 (مشغّل 190/190، ودخول المعلمة وZIP وoverview «غير منجزة»). هذا لم يعد صحيحًا: r18 أنجز منطق دخول المعلمة وكاتب ZIP، وr19 أضاف طبقة HTTP ومُجمِّع الأرشفة. أرقام الاختبار الصحيحة الآن: **266 بلا PostgreSQL** (اختبارات القاعدة نائبة)، ومع PostgreSQL محلي يُتوقع أن يزيد العدد الفعلي بتشغيل اختبارات القاعدة المكتوبة ولم يُشغَّل بعضها قط (`pgAuthStore`، `releaseOverview` على قاعدة).

**قيود ثابتة:** لا اتصال بـSupabase الحقيقي ولا SQL عليه دون موافقة صريحة؛ لا تطبيق لمسودة 006 ولا تغيير قيود القاعدة دون شرح وموافقة؛ لا ادعاء نجاح دخول/رفع حقيقي قبل اختباره؛ لا حذف ملفات ولا تغيير تصميم/صلاحيات دون ضرورة موثقة؛ لا أسرار في الحزمة؛ بعد كل دفعة ZIP كامل وتقرير عربي.

**البيئة:** Node ≥ 22 (`--experimental-strip-types`: بلا parameter properties ولا enums في ملفات `server/`)، وPostgreSQL 15+ محلي. إن لم يصل npm فلا تحاولي الالتفاف؛ `sh scripts/local-pg.sh start` يحتاج ثنائيات PostgreSQL.

**التحقق السريع قبل أي عمل:**
```
sh scripts/node-test-runner/run.sh   # المتوقع 410/410 (بلا PG: اختبارات القاعدة نائبة)
node scripts/check-sql-static.mjs; node scripts/check-stage3-static.mjs   # 39/39 و30/30
# مع PostgreSQL محلي: sh scripts/local-pg.sh start && eval "$(sh scripts/local-pg.sh env)" ثم sh tests/sql/run-sql-tests.sh (المتوقع 62/62 و57/57 و36/36)
```

**الوضع بعد r27:** أدلة `evidence.json` وصلت؛ التعديلات جاهزة في الملفات (vitest ^5.0.5، vite ^6.4.5، react-router-dom ^7.18.5، engines ≥22.12) **ولم يُشغَّل npm**. المطلوب منها: `WINDOWS_BATCH_R27_AR.md` ثم إرسال النتائج وقفلها الناتج لأبني r28 وأقفل خط الأساس. **(قديم) الوضع بعد r26:** فشل فك r25 عندها (Explorer) فلم تُجمع أدلة؛ بُني ملف مستقل `collect-audit-evidence.standalone.mjs`. **المطلوب منها:** تشغيله في مجلد عملها وإرسال `evidence.json` و`evidence-summary.md` و`package.json` و`package-lock.json`؛ ثم دفعات `NPM_FULL_PLAN_AR.md`. **نتيجتها لـr24:** typecheck ✅ و`npm test` 476/476 ✅ و`npm run build` ✅ و`npm audit` 9 (2 حرجة، 1 عالية، 6 متوسطة؛ إنتاج: 2 متوسطة react-router/react-router-dom). **التالي:** استلام `audit-evidence/evidence.json` (من `collect-audit-evidence.mjs`) ثم تنفيذ الدفعات 1–5 في `NPM_FULL_PLAN_AR.md`، والتحقق من كل إصدار من بيانات `evidence.json` لا من الذاكرة. **(قديم) نتيجتها لـr23:** typecheck ✅، `npm test` ✅ 460/460، build ✅ (تحذير حجم)، `npm audit` 11 ثغرة (8 متوسطة، 1 عالية، 2 حرجة). **المطلوب الآن قبل أي شيء:** استلام `audit.json` و`package-lock.json` المحلي (القفل في الحزمة غير متّسق: `@types/node`) ثم معالجة غير الكاسر أولًا ثم تحليل الكاسر (`NPM_REMEDIATION_AR.md`). **(قديم) نتيجتها لـr22:** typecheck ✅ و`npm test` 420/449 (29 فشلًا من jsdom/realm، أُصلحت في r23 **ولم تُثبت بعد بتشغيلها**). ابدئي بإرسالها لنتيجة `npm test` و`npm run build` و`npm audit` (انظر `WINDOWS_BATCH_R23_AR.md`).

**المتبقي بالترتيب (بعد r23):**
1. **على جهاز صاحبة المشروع:** `docs/WINDOWS_BATCH_R22_AR.md` — `npm install` ثم `typecheck` و`npm test` و`npm run build`. صفحات React الجديدة/المعدّلة لم تُجمَّع قط؛ أصلحي أخطاءها أولًا (وأسماء أيقونات lucide غير مؤكدة). ثم الفحوص الساكنة (`check-*.mjs` و`build-edge-function.mjs --check`).
2. **SQL:** اختياري على PostgreSQL محلي (`tests/sql/run-sql-tests.ps1`، التشغيلات a–d)، ثم على Supabase تجريبي **بموافقة صاحبة المشروع** بخطواتها: `docs/SUPABASE_SETUP_AR.md`. لم يُشغَّل أي SQL قط؛ أصلحي ما يظهر.
3. **R2** (حاوية خاصة + مفتاح محصور + CORS PUT وGET) وتجربة قائمة `R2_INTEGRATION_AR.md` قبل ادعاء أي رفع/تنزيل.
4. **نشر دالة Edge** `api` بعد 2 و3 وبموافقة: `docs/phase5/EDGE_HOST_AR.md` §3–§4 (أسرار، `verify_jwt=false`، `/health`، اختبار دخان، ثم تجارب كاملة بحساب مالكة ومعلمة تجريبيين). **أول تشغيل في Deno وأول اتصال `postgres.js`**: توقعي أخطاء توافق (`node:*`، SSL، `set local role`، ترويسة العنوان، زمن PBKDF2).
5. نواقص برمجية لاحقة: أرشفة سنة كاملة عبر الخادم؛ تدقيق أحداث المعلمة؛ جدولة تنظيف الجلسات؛ تدفق الأرشيفات الكبيرة؛ الحذف النهائي و`archive_entries`؛ تقييد معدّل عام؛ مراقبة؛ اختبار شامل نهاية-إلى-نهاية؛ اختبار أمني وحمل؛ القرارات المعلّقة في `HANDOFF.md`.
6. قبل المدرسة: موافقة صريحة على كل إجراء حقيقي (SQL، نشر، حسابات)، ولا ادعاء نجاح قبل تجربته فعليًا.
