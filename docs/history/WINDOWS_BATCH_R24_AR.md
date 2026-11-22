# أوامر Windows لحزمة r24 (ثغرات npm) — خطوة بخطوة

> لا تنفّذي `npm audit fix` ولا `--force`. **قفلكِ المحلي (`package-lock.json` عندكِ) هو الأحدث**؛ انظر `docs/phase5/NPM_REMEDIATION_AR.md` §2. لا تحذفيه ولا تستبدليه بقفل الحزمة.

1. فكّي `athar-handoff-r24-v0_6_15.zip` في مجلد **جديد** (لا فوق مجلد عملكِ).
2. **انسخي `package-lock.json` من مجلد عملكِ القديم إلى المجلد الجديد (فوق الموجود)**. (`package.json` متطابق باستثناء رقم الإصدار.)
3. في المجلد الجديد: `npm install` ثم `npm run typecheck` ثم `npm test` ثم `npm run build`. المتوقع: لا إخفاق (أرسلي سطر خلاصة `npm test`). إن اشتكى `npm ci`/`npm install` من القفل فأرسلي الرسالة.
4. النسخة الاحتياطية: `Copy-Item package.json package.backup.json` و`Copy-Item package-lock.json package-lock.backup.json`.
5. التقارير: `npm audit --json > audit.json` ثم `npm audit --omit=dev --json > audit-prod.json`.
6. الملخص العربي (يعرض لكل حزمة: الخطورة، إنتاج/تطوير، المثبَّت، مسار الاعتماد، كاسر/غير كاسر، وأوامر مقترحة لغير الكاسر):
   `node --experimental-strip-types --no-warnings scripts/summarize-npm-audit.mjs audit.json > audit-summary.md`
7. خط الأساس **من قفلكِ قبل أي تحديث** (مرة واحدة): `node scripts/check-dependency-policy.mjs --write-baseline` ثم `node scripts/check-dependency-policy.mjs` (المتوقع: كله PASS؛ إن فشل بند «القفل متّسق» أو «مصدر الحزم» فأرسلي المخرجات).
8. **أرسلي لي:** `audit.json` (أو `audit-summary.md`) و`package-lock.json` و`package.json` و`docs\dependency-baseline.json` من المجلد الجديد.
9. بعد أن أرسل لكِ خطة الإصلاح: لكل أمر أرسله لكِ، شغّلي بعده بالترتيب: `node scripts/check-dependency-policy.mjs` ثم `npm run typecheck` ثم `npm test` ثم `npm run build` ثم `npm audit`، وأرسلي نتيجة كلٍّ منها. للتراجع: `Copy-Item package.backup.json package.json -Force` و`Copy-Item package-lock.backup.json package-lock.json -Force` ثم `npm install`.
