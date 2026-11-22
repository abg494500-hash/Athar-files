# تنفيذ الإصلاح على جهازكِ (r27) — خطوات مختصرة

الشرح والأسباب والتراجع في `docs/phase5/NPM_FIX_EXECUTION_AR.md`. **أهم قاعدة:** لا `npm audit fix --force` ولا `--legacy-peer-deps`. وأرسلي لي **نتيجة كل أمر** كما تظهر.

1. نسخ احتياطي: `Copy-Item package.json package.backup.json` و`Copy-Item package-lock.json package-lock.backup.json`.
2. انسخي من `athar-r27-patch.zip` (خفيف جدًا) إلى مجلد عملكِ فوق الموجود: `package.json` و`vite.config.ts` و`scripts\check-dependency-policy.mjs` و`server\test\dependencyPolicy.test.ts` و`docs\phase5\NPM_FIX_EXECUTION_AR.md`. (إن تعذّر فك الأرشيف فاستعملي `tar -xf` كما في `WINDOWS_ZIP_EXTRACT_AR.md`.)
3. `npm install --dry-run` ← إن ظهرت أخطاء توافق (ERESOLVE/EBADENGINE) فأرسلي المخرجات ولا تكملي.
4. `npm install` ثم `npm ls vite vitest react-router-dom react-router tinypool esbuild @vitest/mocker vite-node`.
5. `npm run typecheck` ثم `npm test` ثم `npm run build`.
6. `node scripts/check-no-secrets-in-frontend.mjs` ثم `node scripts/check-dependency-policy.mjs --allow-major=react-router-dom,react-router,vite,vitest,vite-node,esbuild,tinypool,@vitest/mocker`.
7. `node scripts/record-audit-batch.mjs "الدفعة 1: vitest 5.0.5 + vite 6.4.5 + react-router-dom 7.18.5"` ثم `npm audit` و`npm audit --omit=dev`.
8. أرسلي لي: مخرجات 3 و4 و5 و7، و`package.json` و`package-lock.json` الناتجين. عندها أبني r28 من قفلكِ الحقيقي وأقفل خط الأساس.
