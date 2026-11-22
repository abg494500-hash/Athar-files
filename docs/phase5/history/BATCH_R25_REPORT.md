# تقرير الدفعة (0.6.16، حزمة r25) — خطة موحَّدة لمعالجة ثغرات npm التسع وأدوات جمع الأدلة

> **الخلاصة الصريحة:** **لم أعالج أي ثغرة ولم أغيّر أي اعتمادية ولم أنفّذ أي دفعة إصلاح.** السبب: لا شبكة ولا سجل npm في بيئتي (جرّبتُ `npm view vite version` وفشل)، ولم يصلني `audit.json` ولا قفلكِ المحلي، وتحديد الإصدار الذي يصلح كل ثغرة فعلًا يتطلب بيانات السجل. بحسب بند 10 في طلبكِ **توقفتُ عن التخمين** وحدّدتُ ما يلزم محليًا. لم أستعمل `--force` ولا `overrides` ولم أُخفِ ثغرة ولم أحذف اختبارًا، ولم أتصل بـSupabase أو Cloudflare ولم أنفّذ SQL ولم أنشر. النسخ r24 وما قبلها محفوظة (`previous-versions/INDEX_AR.md`). **المشروع ليس خاليًا من الثغرات؛ `npm audit` عندكِ ما زال يُظهر 9.**

## 1) نتائجكِ (من رسالتكِ، لا من تشغيلي)
r24: `typecheck` ✅ · `npm test` ✅ **476/476** · `npm run build` ✅ · `npm audit`: **9** (2 حرجة، 1 عالية، 6 متوسطة) · `npm audit --omit=dev`: **2 متوسطة** (react-router، react-router-dom). الحزم المتأثرة: vite، vitest، tinypool، @vitest/mocker، vite-node، esbuild، postcss-selector-parser، react-router (+react-router-dom).

## 2) ما استخلصتُه فعلًا من الملفات (حقائق، لا تخمين)
- **التسع في ثلاث عائلات:** (أ) إنتاج: `react-router` و`react-router-dom` 6.30.6 ← اعتمادية مباشرة. (ب) سلسلة الاختبار والبناء: `vitest` 2.1.9 ← `vite-node` و`@vitest/mocker` و`tinypool` 1.1.1 و`vite` 5.4.21 ← `esbuild` 0.21.5. (ج) `postcss-selector-parser` 6.1.4 ← `tailwindcss` 3.4.19 و`postcss-nested` 6.2.0.
- **vitest 2.1.9 يثبّت `vite ^5.0.0`** (وكذلك vite-node وmocker) ⇒ **رفع Vite إلى 6+ يستلزم رفع Vitest معه**؛ و**`@vitejs/plugin-react` 4.7.0 يقبل vite حتى 7 و`vite-plugin-singlefile` 2.3.4 حتى 8** ⇒ الإضافتان لا تمنعان الرفع.
- **tailwindcss وpostcss-nested يثبّتان `postcss-selector-parser ^6`** ⇒ إصلاح ضمن 6.x تحديث قفل غير كاسر؛ إصلاح في 7.x لا يصل دون Tailwind 4 (major كبير) أو ترقيع.
- **أثر React Router 7 على كودنا (إن لزم):** تصريحي فقط، مسارات مطلقة، مسار `*` واحد، بلا `future` ولا data-router ⇒ الأثر المرجَّح صغير (ملفان على الأكثر + اختبارات). **أثر Vitest/Vite:** إعداد بسيط وواجهات اختبار مستقرة (`vi.fn`/fake timers) ووسم `@vitest-environment node` متوافق أمامًا؛ نقاط التحقق في الخطة §1.3. التفاصيل: `docs/phase5/NPM_FULL_PLAN_AR.md`.
- **ما لا أعرفه (يحتاج السجل):** أي من التسع حرجة/عالية، وما الإصدار الذي يصلح كلًّا، وهل يقع الإصلاح داخل نطاق الحالي (غير كاسر) أم يتطلب major.

## 3) ما بُني
| الأداة | وظيفتها | اختُبرت |
|---|---|---|
| `scripts/collect-audit-evidence.mjs` | **أمر واحد يجمع كل الأدلة بقراءة فقط:** `npm audit` (كامل وإنتاج)، `npm audit fix --dry-run`، `npm outdated`، `npm ls --all`، ولكل حزمة متأثرة/مراقبة: dist-tags وقائمة الإصدارات، ولكل إصدار مرشَّح (إصلاح npm + الأحدث): `engines`/`peerDependencies`/`dependencies`. فشل أمر واحد لا يوقفه | 4 اختبارات بـnpm مزيَّف |
| `scripts/record-audit-batch.mjs "وصف"` | بعد كل دفعة: `npm audit` و`--omit=dev`، حفظ JSON، وسطر في `docs/phase5/AUDIT_LOG_AR.md` بالأعداد والمتبقي (الكل/الإنتاج) | 2 اختبار |
| `scripts/lib/npm.mjs` | تشغيل npm **قرائيًا فقط** بقائمة بيضاء: يرفض install/update/ci و`audit fix` بلا `--dry-run` والوسائط المحقونة (`;` `|` `$()` ومسافات ونطاقات `^`) | اختبار رفض (10 حالات) |
جميعها لا تعدّل `package.json` ولا القفل ولا `node_modules`.

## 4) الاختبارات: الحقيقي مقابل ما لم يُنفَّذ
**نُفِّذ هنا:** مشغّل Node البديل **408/408** (401 + 7 جديدة بـnpm مزيَّف) و`tsc --strict` نظيف على الأدوات واختباراتها (مترجم محلي لا سلسلتكِ) والفحوص الساكنة السابقة. **ليس vitest.**
**لم يُنفَّذ:** أي أمر npm حقيقي (`install`/`audit`/`view`)، `npm test` (vitest)، `npm run build`. اختبارات الأدوات على Windows تعتمد على غلاف `npm.cmd` مزيَّف صغير **لم يُجرَّب** هناك.

## 5) الخطوة التالية عندكِ (دقائق)
`docs/WINDOWS_BATCH_R25_AR.md`: مجلد جديد + **قفلكِ فوق قفل الحزمة** + `npm install` + اختبارات (يجب أن تبقى 476 ناجحة) ثم **`node scripts/collect-audit-evidence.mjs`** (يحتاج الإنترنت) و`node scripts/record-audit-batch.mjs "الدفعة 0"`، وأرسلي لي `audit-evidence/evidence.json` و`evidence-summary.md` و`package-lock.json` و`package.json`. عندها أحدّد الإصدارات المحدّدة من البيانات، وأتحقق حسابيًا من توافق كل مجموعة، وأعطيكِ أوامر الدفعات 1–5 واحدة واحدة بتعديلات الكود/الإعدادات المطلوبة (إن لزم major) وبوابات الاختبار، ثم ZIP بعد كل دفعة ناجحة.

## 6) ما بقي قبل أي خدمات حقيقية
معالجة الثغرات (هذه المهمة)، ثم SQL على مشروع تجريبي، R2/CORS، نشر الدالة، حسابات المسؤولين، واختبارات نهاية-إلى-نهاية — كلها بموافقتكِ. المنصة غير جاهزة للمدرسة ولا للنشر.
