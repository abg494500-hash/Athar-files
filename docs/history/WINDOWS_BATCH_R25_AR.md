# أوامر Windows لحزمة r25 — جمع أدلة الثغرات (قراءة فقط) ثم التنفيذ بدفعات

> لا تنفّذي `npm audit fix` ولا `--force` ولا أي `npm install` الآن. هذه الخطوة **تجمع بيانات فقط**. كل ما يلي في **نسخة عمل منفصلة** كي يبقى مجلدكِ الأصلي كما هو.

1. فكّي `athar-handoff-r25-v0_6_16.zip` في مجلد جديد، **وانسخي `package-lock.json` من مجلد عملكِ الحالي فوق قفل الحزمة** (قفلكِ هو المرجع).
2. في المجلد الجديد: `npm install` ثم `npm run typecheck` ثم `npm test` ثم `npm run build` (المتوقع: نجاح كما في r24؛ أرسلي خلاصة `npm test`).
3. **جمع الأدلة (يحتاج الإنترنت، قراءة فقط):** `node scripts/collect-audit-evidence.mjs` — يستغرق دقائق ويطبع OK/FAIL لكل أمر. الناتج: `audit-evidence\evidence.json` و`audit-evidence\evidence-summary.md`.
4. الحالة قبل أي تغيير: `node scripts/record-audit-batch.mjs "الدفعة 0: قبل أي تغيير"` (يكتب `docs\phase5\AUDIT_LOG_AR.md` ومجلد `audit-log\`).
5. حارس السياسة من قفلكِ (مرة واحدة): `node scripts/check-dependency-policy.mjs --write-baseline` ثم `node scripts/check-dependency-policy.mjs` (المتوقع PASS كله).
6. **أرسلي لي:** `audit-evidence\evidence.json` و`audit-evidence\evidence-summary.md` و`package-lock.json` و`package.json` و`audit-log\*-full.json`. لا أسرار فيها (مخرجات npm العامة).
7. بعدها أعطيكِ أوامر **محددة** لكل دفعة (1 إلى 5 في `docs/phase5/NPM_FULL_PLAN_AR.md`) وبعد كل دفعة: `node scripts/check-dependency-policy.mjs` ثم `npm run typecheck` ثم `npm test` ثم `npm run build` ثم `node scripts/record-audit-batch.mjs "الدفعة n: ..."`، وترسلين لي نتيجة كلٍّ منها. للتراجع: `Copy-Item package.backup.json package.json -Force` و`Copy-Item package-lock.backup.json package-lock.json -Force` ثم `npm install`.
