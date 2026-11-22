# تقرير الدفعة (0.6.18، حزمة r27) — تعديلات إصلاح ثغرات npm المبنية على أدلتكِ

> **الخلاصة الصريحة:** حلّلتُ `evidence.json` وحدّدتُ **أقل مجموعة** تعالج الحرجتين والعالية ومتوسطتي الإنتاج، وطبّقتُ تعديلاتها **في الملفات**. **لم أشغّل أي أمر npm** (لا سجل ولا `node_modules` عندي): **لا `npm install` ولا `typecheck` ولا `npm test` ولا `npm run build` ولا `npm audit`**. لذلك **الإصلاح غير مكتمل ولا أعلنه مكتملًا** حتى تشغّلي الخطوات وتُرجعي النتائج. القفل في الحزمة **قديم عمدًا** لأن npm وحده يولّد قفلًا صحيحًا. لم أُغيّر Supabase/SQL/Cloudflare ولم أنشر. النسخ r26 وما قبلها محفوظة دون تعديل.

## 1) الثغرات قبل الإصلاح (من تقريركِ) → ما سيعالجها
**8 ثغرات:** حرجة (tinypool، vitest)، عالية (vite)، متوسطة ×5 (esbuild، @vitest/mocker، vite-node، react-router، react-router-dom) — والإنتاج: react-router وreact-router-dom فقط (`postcss-selector-parser` عولجت عندكِ). الجدول الكامل بعناوين الثغرات ونطاقاتها وما يعالج كلًّا: `docs/phase5/NPM_FIX_EXECUTION_AR.md` §1. **المتوقع بعد التثبيت: `npm audit` = 0 — توقّع غير مؤكَّد.**

## 2) التعديلات المنفَّذة (كلها)
| الملف | التغيير |
|---|---|
| `package.json` | `react-router-dom ^6.30.6 → ^7.18.5` · `vite ^5.4.21 → ^6.4.5` · `vitest ^2.1.9 → ^5.0.5` · `engines.node >=20 → >=22.12.0` · الإصدار 0.6.18 |
| `vite.config.ts` | `defineConfig` من `vitest/config` (يعيد تصدير دالة Vite ويضمن نوع مفتاح `test`) |
| `scripts/check-dependency-policy.mjs` + اختبار | اختفاء حزمة بترقية مصرَّحة (`vite-node`/`tinypool`) ليس فشلًا مع `--allow-major` |
| وثائق | `NPM_FIX_EXECUTION_AR.md`، `WINDOWS_BATCH_R27_AR.md`، `HANDOVER_AR.md` (محدَّث)، هذا التقرير |
**لم يتغير:** كود التطبيق، الاختبارات، SQL، Supabase، Cloudflare، `@vitejs/plugin-react` (4.7.0)، `vite-plugin-singlefile` (2.3.4)، jsdom (29.1.1)، TypeScript (5.9.3)، React (18.3.1).

## 3) لماذا هذه المجموعة وماذا رُفض (بالأدلة)
- **`vitest ^5.0.5`**: الوحيد الذي تثبت الأدلة توافقه: `engines node ^22.12` (جهازكِ 22.20.0)، peer `vite ^6.4 || ^7 || ^8`، `@types/node ^22 || >=24`، `jsdom *`، **ولا يعتمد على tinypool ولا vite-node** (تختفي الحرجة). `@vitest/mocker` 5.0.5 خارج النطاق المصاب.
- **`vite ^6.4.5`** (وسم previous): فوق ≤6.4.3 المصاب، وتقبله الإضافات الحالية؛ **Vite 8.3.5 مرفوض** لأن `@vitejs/plugin-react` 4.7.0 لا يقبله والأحدث 6.1.2 يشترط vite ^8.
- **`react-router-dom ^7.18.5`**: لا إصلاح داخل 6.x؛ peers `react >=18` وengines `node >=20` ✓ مع React 18.3.1؛ **React Router 8.5.1 مرفوض** (React ≥19.2.7 وNode ≥22.22.0). أثره على كودنا محدود (توجيه تصريحي، مسارات مطلقة، مسار `*` واحد).
- **مرفوضة أيضًا:** jsdom 30 (Node ^22.22.2)، vitest 3.2.7 (يترك mocker متوسطًا)؛ **vitest 4.1.12** بديل احتياطي لأن الأدلة لا تحوي بياناته.

## 4) ما تحقّقتُ منه وما لا
| | |
|---|---|
| ✅ من الأدلة | الإصدارات موجودة في السجل؛ `react-router-dom 7.18.5` ← React 18/Node 20+؛ `vitest 5.0.5` ← vite 6.4/Node 22.20/@types/node/jsdom؛ `mocker 5.0.5` ← vite 6؛ plugin-react 4.7.0 وsinglefile 2.3.4 تقبلان Vite 6 (من القفل والأدلة) |
| ❌ غير مُتحقَّق | بيانات `vite 6.4.5` نفسه (engines، dependencies، أي esbuild يختار)؛ سلوك الاختبارات تحت Vitest 5 وReact Router 7 (`startTransition`)؛ ناتج `npm run build` مع Vite 6 (`build-review.mjs` يستعمل JS API لـVite وهو مستقر)؛ ناتج `npm audit` النهائي |
**نُفِّذ هنا:** مشغّل Node البديل **410/410** (ليس vitest) و`tsc` للأدوات، والفحوص الساكنة (بيئات الاختبار 4/4، SQL 39/30/28، التوافق، الأسرار 10/10، المولَّد مطابق)، وفك الحزم المولَّدة في مجلدات منفصلة وإعادة التشغيل.

## 5) ما عليكِ تنفيذه (مختصر؛ التفاصيل `WINDOWS_BATCH_R27_AR.md`)
نسخ احتياطي ← نسخ ملفات الحزمة الصغيرة `athar-r27-patch.zip` فوق مجلدكِ ← **`npm install --dry-run`** (يحسم التوافق؛ عند ERESOLVE/EBADENGINE توقفي وأرسلي المخرجات، لا `--force`) ← `npm install` ← `npm ls …` ← `npm run typecheck` ← `npm test` ← `npm run build` ← فحوص الأسرار والسياسة ← `record-audit-batch` ← `npm audit` و`npm audit --omit=dev`. التراجع بالنسخ الاحتياطية. بعدها أرسلي النتائج وقفلكِ الناتج.

## 6) المخاطر المتبقية
اختبارات واجهة قد تتأثر بتوقيت التنقل في React Router 7؛ سلوك Vitest 5 (`vi.fn` مرة واحدة والمؤقتات المزيّفة فقط في مشروعنا)؛ احتمال ظهور تحذيرات `EBADENGINE` إن كان Node عندكِ أقل من 22.12 (لديكِ 22.20.0)؛ وأي ثغرة جديدة في قاعدة npm بعد تاريخ الأدلة. **المنصة غير جاهزة للمدرسة ولا للنشر** (SQL غير منفَّذ، الدالة غير منشورة، R2 غير مجرَّب، لا حسابات) — انظر `docs/HANDOVER_AR.md`.
