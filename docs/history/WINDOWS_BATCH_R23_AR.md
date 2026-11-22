# تشغيل واختبار حزمة r23 على Windows (خطوة واحدة في كل مرة)

> أرسلي لي الناتج كما يظهر، نجح أو فشل. **لا تنفّذي SQL على Supabase، ولا تنشري الدالة، ولا تضعي مفاتيح R2/Supabase أو `VITE_TEACHER_API_URL`.** الهدف: إثبات إصلاح إخفاقات r22 محليًا.

## ما الذي أُصلح (وما المتوقع)
في r22 فشل 29 اختبارًا في `teacherAuth` و`compose` وفشل `edgeBuild`. السبب (أُعيد إنتاجه بمحاكاة): بيئة **jsdom** الافتراضية تستبدل `Uint8Array` و`URL` العامين، فيفشل فحص `instanceof Uint8Array` لأسرار طولها 32/40 بايتًا وتظهر الرسالة المضلِّلة «أقصر من 32 بايتًا». الأسرار الاختبارية كانت صحيحة؛ **لم يُخفَّف أي شرط أمان**. الإصلاح: كل اختبارات `server/test` تعمل في بيئة Node. **المتوقع الآن: 0 إخفاق** — وهذا توقّع مبني على المحاكاة، **لم يُثبت إلا بتشغيلكِ الحقيقي.**

## الخطوات
1. فكّي `athar-handoff-r23-v0_6_14.zip` وافتحي PowerShell داخل `athar`، ثم `node -v` (**22.6 أو أحدث** مطلوب لاختبار `edgeBuild` الذي يشغّل عملية Node مستقلة) و`npm install`.
2. `npm run typecheck` — أرسلي الناتج (في r22 نجح عندكِ).
3. `npm test` — **أرسلي سطر الخلاصة (Test Files / Tests)**. المتوقع: لا ملف فاشل. إن فشل شيء، أرسلي أول 40 سطرًا من أول إخفاق **وأيضًا** سطر `FAIL` لكل اختبار فاشل.
4. `npm run build` ثم `node scripts/check-dist-no-mock.mjs` ثم `node scripts/check-no-secrets-in-frontend.mjs` (المتوقع 10/10 مع فحص `dist`).
5. فحوص ساكنة (بلا npm): `node scripts/check-test-environments.mjs` (4/4) و`check-sql-static.mjs` (39) و`check-stage3-static.mjs` (30) و`check-sql-additions-static.mjs` (28) و`check-code-sql-compat.mjs` و`node scripts/build-edge-function.mjs --check` («مطابق»).
6. **ثغرات npm:** `npm audit --json > audit.json` ثم `node --experimental-strip-types --no-warnings scripts/summarize-npm-audit.mjs audit.json > audit-summary.md` وأرسلي `audit-summary.md` (انظر `docs/phase5/NPM_AUDIT_AR.md`). **لا `npm audit fix --force`.**
7. اختياري: `sh scripts/node-test-runner/run.sh` (Git Bash) — المتوقع 385/385.

## قبل أي خدمات حقيقية (لم يتغير)
SQL على مشروع تجريبي (`docs/SUPABASE_SETUP_AR.md`)، R2 وCORS (`R2_INTEGRATION_AR.md`)، نشر الدالة (`EDGE_HOST_AR.md`): كلها بموافقتي وبعد نجاح الخطوات أعلاه.
