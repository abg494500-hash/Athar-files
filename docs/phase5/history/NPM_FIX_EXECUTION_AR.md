# تنفيذ إصلاح ثغرات npm (r27 / 0.6.18) — القرار، التوافق، الأوامر، والتراجع

> **صدق أولًا:** هذه الحزمة **تحوي التعديلات في الملفات**، لكن **لم يُشغَّل أي أمر npm** عندي (لا شبكة ولا `node_modules`): **لا `npm install` ولا `typecheck` ولا `npm test` ولا `build` ولا `npm audit` نُفِّذت.** لذلك لا أعلن اكتمال الإصلاح. القفل `package-lock.json` في الحزمة **قديم عمدًا** (npm وحده يولّد قفلًا صحيحًا ببصمات السجل)؛ تولّدينه على جهازكِ بـ`npm install` بالخطوات أدناه. مصدر القرارات: `evidence.json` الذي جمعتِه (Node v22.20.0، npm 10.9.3، Windows، 2026-10-29).

## 1) الثغرات قبل الإصلاح (من تقريركِ حرفيًا) وكيف يعالجها r27
| الحزمة | الخطورة | الثغرة (عنوانها في التقرير) | النطاق المصاب | يعالجها |
|---|---|---|---|---|
| `tinypool` | **حرجة** ×2 | Prototype Pollution gadget في worker options / في run() options ⇒ **RCE** | < 2.1.2 | `vitest 5.0.5` **لا يعتمد على tinypool أصلًا** (قائمة dependencies في الأدلة) |
| `vitest` | **حرجة** | عند عمل خادم Vitest UI يمكن قراءة وتنفيذ ملف تعسفي | < 3.2.6 (والحزمة ≤ 4.1.10 بحسب npm) | `vitest ^5.0.5` |
| `vite` | **عالية** | launch-editor: تجاوز فحص `fs.existsSync()` على Windows (عالية)، و7 أخرى متوسطة/منخفضة (path traversal للـ`.map`، NTLMv2 عبر UNC، `server.fs.deny/allow`، حقن أوامر محرر…) | ≤ 6.4.3 | `vite ^6.4.5` (6.4.4 و6.4.5 في السجل؛ وسم `previous` = 6.4.5) |
| `esbuild` | متوسطة | أي موقع يرسل طلبات لخادم التطوير ويقرأ الرد | ≤ 0.24.2 | يأتي تبعًا مع Vite 6 (يُتحقَّق بـ`npm ls esbuild`: المتوقع ≥ 0.25) |
| `@vitest/mocker` | متوسطة ×2 | Path traversal/قراءة ملف عبر Redirect Mock؛ وحقن كود عبر تسجيل mock يدوي بلا مصادقة | < 4.1.11 و< 4.1.12 | `vitest 5.0.5` يثبّت mocker **5.0.5** |
| `vite-node` | متوسطة | عبر vite | ≤ 2.2.0-beta.2 | تختفي (ليست ضمن dependencies لـvitest 5.0.5) |
| `react-router`, `react-router-dom` | متوسطة ×2 (**إنتاج**) | Open redirect عبر شرطة عكسية في `<Link>`/`useNavigate` (التفاف على CVE-2025-68470)؛ Arbitrary Constructor Injection في `deserializeErrors()` عند SSR hydration | 6.x – 7.17.x (< **7.18.0**) | `react-router-dom ^7.18.5` (يثبّت react-router 7.18.5) |
| `postcss-selector-parser` | متوسطة | PostCSS: تعقيد تربيعي في تحليل المحدّدات ⇒ استنزاف CPU | < 6.1.5 | **عولجت عندكِ** (6.1.5) |
الإجمالي في تقريركِ: 9 (2 حرجة، 1 عالية، 6 متوسطة)؛ للإنتاج `--omit=dev`: 2 متوسطة. **لا إصلاح داخل 6.x لـReact Router** (النطاق المصاب يغطي كل 6.x) فالترقية إلى 7 لازمة. ثغرة `vite` العالية والـmocker وesbuild كلها تتعلق بـ**خادم التطوير/الاختبار** لا بالموقع المنشور، بخلاف React Router.

## 2) لماذا هذه المجموعة، ولماذا ليست ما اقترحه `npm audit` ولا أصغر منها
`npm audit` اقترح `vitest 5.0.5` و`vite 8.3.5` و`react-router-dom 7.18.5` (يقترح عادةً أحدث إصدار حين يكون الإصلاح major). اخترتُ **`vite 6.4.5`** بدل 8.3.5 وأبقيتُ بقية الأدوات:
| القرار | السبب (من `evidence.json` أو القفل) |
|---|---|
| **`vitest ^5.0.5`** (لا 4.1.12 ولا 3.2.7) | **الوحيد الذي تثبت الأدلة توافقه:** `engines node ^22.12 \|\| ^24 \|\| >=26` (جهازكِ 22.20.0 ✓)، و`peer vite ^6.4 \|\| ^7 \|\| ^8` (6.4.5 ✓)، و`@types/node ^22 \|\| >=24` (مشروعنا ^22 ✓)، و`jsdom *` ✓، و**بلا tinypool ولا vite-node** (تختفي الحرجة والمتوسطة معًا). **4.1.12** (وسم V4) أصغر قفزة لكن **لا بيانات في الأدلة** عن dependencies/peers/engines له (هل يعتمد tinypool ≥2.1.2؟ لا أعرف) ⇒ بديل احتياطي فقط. **3.2.7** يصلح الحرجة لكن `@vitest/mocker` 3.x ضمن النطاق المصاب (< 4.1.12) فتبقى ثغرة |
| **`vite ^6.4.5`** لا 8.3.5 | الأحدث 8.3.5 يعتمد `rolldown` ويشترط `esbuild ^0.27 \|\| ^0.28` كاختياري؛ و**`@vitejs/plugin-react` 4.7.0 لا يقبله** (يقبل حتى Vite 7) والأحدث 6.1.2 يشترط `vite ^8` فقط (ترقية major ثانية). 6.4.5 مقبول عند vitest 5.0.5 وplugin-react 4.7.0 وsinglefile 2.3.4 معًا |
| `react-router-dom ^7.18.5` لا 8.5.1 | 8.5.1 (latest) يتطلب **React ≥ 19.2.7 وNode ≥ 22.22.0** (جهازكِ 22.20.0 ومشروعنا React 18) |
| يبقى `jsdom 29.1.1` | الأحدث 30.1.3 يتطلب Node ^22.22.2 (جهازكِ 22.20.0) |
| يبقى `typescript 5.9.3`، `@vitejs/plugin-react 4.7.0`، `vite-plugin-singlefile 2.3.4`، React 18.3.1 | لا حاجة لتغييرها؛ التوافق أعلاه |
| احتياطي لـVite | `vite ^7.3.7` (موجود في السجل) إن رفض npm الجمع بين 6.4.5 والإضافات |

## 3) ما غُيِّر في الملفات (كل ما غُيِّر)
- `package.json`: **ثلاثة أسطر اعتماديات**: `react-router-dom` من `^6.30.6` إلى `^7.18.5`، و`vite` من `^5.4.21` إلى `^6.4.5`، و`vitest` من `^2.1.9` إلى `^5.0.5`؛ **و`engines.node` من `>=20` إلى `>=22.12.0`** (يتطلبه vitest 5 ويتطلبه أصلًا jest-dom 7 وjsdom 29)؛ والإصدار 0.6.18.
- `vite.config.ts`: `import { defineConfig } from 'vitest/config'` بدل `'vite'` (تعيد تصدير الدالة نفسها وتضمن نوع المفتاح `test` عبر Vitest 2→4). **لا تغيير في السلوك.**
- `scripts/check-dependency-policy.mjs`: حزمة اختفت بسبب ترقية مصرَّح بها (`vite-node`) لا تُفشل الحارس مع `--allow-major` (واختبار لذلك).
- **لا تغيير** في كود التطبيق ولا الاختبارات ولا SQL ولا Supabase ولا Cloudflare. لم يتغير `@vitejs/plugin-react` (4.7.0) ولا `vite-plugin-singlefile` (2.3.4) ولا jsdom ولا TypeScript ولا React 18.3.1.

## 4) جدول التوافق: ما تحقّقتُ منه وما لا
| الحلقة | الحالة | المصدر |
|---|---|---|
| `react-router-dom` 7.18.5 ← React 18.3.1 | ✅ مؤكَّد | `evidence.json`: peers `react >=18`، engines `node >=20` (جهازكِ 22.20) |
| `react-router-dom` 7.18.5 ← `react-router` 7.18.5 | ✅ | evidence: dependencies |
| الإصدارات موجودة في السجل: vite 6.4.5 (وسم previous)، vitest 5.0.5 (latest)، react-router-dom 7.18.5 | ✅ | evidence: قوائم الإصدارات ووسومها |
| `@vitejs/plugin-react` 4.7.0 ← Vite 6 | ✅ (نطاق peer `^4.2 \|\| ^5 \|\| ^6 \|\| ^7`) | قفل r26 |
| `vite-plugin-singlefile` 2.3.4 ← Vite 6 | ✅ (`^5.4.21 \|\| ^6 \|\| ^7 \|\| ^8`، rollup ^4.59) | قفل + evidence |
| `jsdom` 29.1.1 ← Node 22.20 | ✅ (`^22.13` فما فوق) | قفل |
| **`vitest` 5.0.5 ← vite 6.4.5 وNode 22.20 و@types/node ^22 وjsdom** | ✅ مؤكَّد من الأدلة (engines/peers أعلاه) | `evidence.json` |
| **`@vitest/mocker` 5.0.5 ← vite 6.4.5** | ✅ peer `vite ^6 \|\| ^7 \|\| ^8` | evidence |
| **`vite` 6.4.5 نفسه (engines/dependencies/اختيار esbuild)** | ❌ لم يتحقَّق (بياناته غير في الأدلة) | `--dry-run` ثم `npm ls esbuild vite` |
| سلوك الاختبارات تحت Vitest 5 وReact Router 7 | ❌ لا يُعرف إلا بالتشغيل | `npm test` |

## 5) الأوامر على جهازكِ (PowerShell، في مجلد عملكِ الحالي الذي فيه قفلكِ)
```
# 0) نسخة احتياطية
Copy-Item package.json package.backup.json; Copy-Item package-lock.json package-lock.backup.json
# 1) انسخي من حزمة r27 فوق ملفاتكِ: package.json  vite.config.ts  scripts\check-dependency-policy.mjs  server\test\dependencyPolicy.test.ts  docs\phase5\NPM_FIX_EXECUTION_AR.md
# 2) تجربة جافة بلا تغيير: يتحقق npm نفسه من التوافق (peers/engines) ويطبع ما سيتغير
npm install --dry-run
#    إن ظهر ERESOLVE/peer conflict أو EBADENGINE: توقفي، لا تستعملي --force/--legacy-peer-deps، وأرسلي المخرجات كاملة.
# 3) التثبيت
npm install
# 4) التحقق من الإصدارات الفعلية (المتوقع: vite 6.4.5، vitest 5.0.5، react-router-dom وreact-router 7.18.5، esbuild >= 0.25، @vitest/mocker 5.0.5، ولا tinypool ولا vite-node)
npm ls vite vitest react-router-dom react-router tinypool esbuild @vitest/mocker vite-node
# 5) البوابات بالترتيب (أرسلي نتيجة كلٍّ منها)
npm run typecheck
npm test
npm run build
node scripts/check-no-secrets-in-frontend.mjs
node scripts/check-dependency-policy.mjs --allow-major=react-router-dom,react-router,vite,vitest,vite-node,esbuild,tinypool,@vitest/mocker
node scripts/record-audit-batch.mjs "الدفعة 1: vitest 5.0.5 + vite 6.4.5 + react-router-dom 7.18.5"
npm audit
npm audit --omit=dev
# 6) فقط بعد نجاح كل ما سبق وفحص النتائج: خط أساس جديد بقرار مقصود
node scripts/check-dependency-policy.mjs --write-baseline
```
**التراجع:** `Copy-Item package.backup.json package.json -Force; Copy-Item package-lock.backup.json package-lock.json -Force; npm install`.

## 6) ما أتوقعه وما قد يفشل (توقعات لا نتائج)
- **متوقع:** اختفاء الحرجتين والعالية وكل ثغرات التطوير ومتوسطتي الإنتاج؛ `npm audit` = 0. **غير مؤكد حتى تشغّلينه.**
- **قد يفشل:** (1) اختبارات واجهة تعتمد على توقيت التنقل بعد ترقية React Router 7 (التحديثات تُلَفّ بـ`startTransition`)؛ (2) نوع مفتاح `test` في `vite.config.ts` (عالجتُه باستيراد `vitest/config`)؛ (3) سلوك `vi.fn`/المؤقتات المزيّفة في Vitest 5 (الاستعمال في المشروع محدود: `vi.fn()` مرة واحدة في `repository.contract.ts` وواجهات الوقت المزيّف)؛ (4) حجم/محتوى ناتج Vite 6 (`npm run build` و`check-dist-no-mock`)؛ (5) تحذير حجم JavaScript قائم من قبل وليس ثغرة. أي إخفاق: أرسلي أول إخفاق كاملًا وأصلحه قبل المتابعة، ولا تحذفي اختبارًا.
- **بدائل إن رُفضت المجموعة:** `vite ^7.3.7` بدل `^6.4.5` (يتطلب Node ≥ 22.12 ✓ وplugin-react 4.7/singlefile يقبلانه)؛ أو `vitest ^4.1.12` (قفزة أصغر لكن بلا أدلة) إن ظهر أن 5.x غير مناسب؛ أو تقسيم الدفعات: (أ) `react-router-dom` وحده (الإنتاج، أهم دفعة) ثم (ب) `vite`+`vitest`.
