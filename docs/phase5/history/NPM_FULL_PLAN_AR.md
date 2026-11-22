# خطة واحدة لمعالجة كل ثغرات npm التسع (إنتاج + تطوير + اختبار) — r25

> **صدق أولًا:** لا شبكة ولا سجل npm عندي (جرّبتُ `npm view` وفشل)، ولم يصلني `audit.json` ولا قفلكِ المحلي. بحسب شرطكِ (بند 10) **توقفتُ عن تخمين الإصدارات**: لم أغيّر أي اعتمادية، ولم أُنشئ `overrides`. ما يلي حقائق **مستخرجة من الملفات** (القفل والكود والإعدادات)، وخطة دفعات بقواعد قرار لا تتطلب تخمينًا، وأداة تجمع الأدلة اللازمة بأمر واحد على جهازكِ لأنتقل بعدها فورًا إلى التنفيذ. **الحقائق من قفل الحزمة (r24)؛ قفلكِ المحلي يزيد عليه `@types/node` فقط في الأرجح** (انظر `NPM_REMEDIATION_AR.md` §2) وأتحقق من ذلك عند استلامه.

## 1) الحقائق الثابتة من الملفات
### 1.1 بنية الاعتماديات (من package-lock.json) — الحزم التسع في **ثلاث عائلات**
| العائلة | الحزم المتأثرة | الجذر الذي يسحبها | النطاق |
|---|---|---|---|
| **أ. إنتاج** | `react-router` 6.30.6، `react-router-dom` 6.30.6 (وتحتهما `@remix-run/router` 1.23.4 وهي غير مُبلَّغ عنها) | `react-router-dom` (اعتمادية **مباشرة** `^6.30.0`) | **إنتاج — تُشحن للمتصفح** |
| **ب. سلسلة Vitest/Vite** | `vitest` 2.1.9، `vite-node` 2.1.9، `@vitest/mocker` 2.1.9، `tinypool` 1.1.1، `vite` 5.4.21، `esbuild` 0.21.5 | `vitest` (مباشرة `^2.1.9`) و`vite` (مباشرة) | تطوير/اختبار/بناء — لا تُشحن |
| **ج. سلسلة Tailwind** | `postcss-selector-parser` 6.1.4 | `tailwindcss` 3.4.19 (`^6.1.2`) و`postcss-nested` 6.2.0 (`^6.1.1`)؛ كلاهما يثبّت **6.x** | تطوير/بناء CSS — لا تُشحن |
تسع ثغرات = 2 + 6 + 1، وتطابق قولكِ (`--omit=dev`: اثنتان فقط في العائلة أ).

### 1.2 قيود التوافق الصلبة (حقائق، من `dependencies`/`peerDependencies` في القفل)
- **`vitest` 2.1.9 يثبّت `vite: ^5.0.0` اعتمادية مباشرة، وكذلك `vite-node` 2.1.9 و`@vitest/mocker` 2.1.9 (peer).** ⇒ **لا يمكن رفع Vite إلى 6 أو أعلى دون رفع Vitest معه** (رفعهما متلازم). أي إصلاح لـvite/esbuild لا يتوفر ضمن 5.x يعني رفع الاثنين معًا (major).
- **`@vitejs/plugin-react` 4.7.0** يقبل `vite ^4.2 || ^5 || ^6 || ^7`، و**`vite-plugin-singlefile` 2.3.4** يقبل `^5.4.21 || ^6 || ^7 || ^8` (ويطلب `rollup ^4.59` والمثبَّت 4.64.9): **الإضافتان لا تمنعان رفع Vite** حتى 7 (والثانية حتى 8).
- **`jsdom` 29.1.1** يتطلب Node `^20.19 || ^22.13 || >=24`، و**`@testing-library/jest-dom` 7.0.1** يتطلب Node ≥ 22 ويقبل `vitest >= 0.32`، و`@testing-library/react` 16.3.3 يقبل React 18/19: **لا قيد من هذه الحزم على vitest/vite**.
- **`tailwindcss` 3.4.19 و`postcss-nested` 6.2.0 يثبّتان `postcss-selector-parser ^6`.** ⇒ إن كان الإصلاح داخل 6.x فهو **تحديث قفل فقط** (غير كاسر). وإن كان الإصلاح في 7.x فلا يصل إليه أي من الأبوين دون ترقية **Tailwind 3 → 4** (major بتغيير الإعداد وإضافة PostCSS) أو إصدار ترقيع لـtailwind/postcss-nested.
- `react-router-dom`/`react-router` 6.30.6 يقبلان React `>=16.8`، ونسختنا React 18.3.1.

### 1.3 أثر الترقيات الرئيسية على **كود المشروع الفعلي** (من فحص الملفات)
**React Router 6 → 7 (إن لزم):** التطبيق **تصريحي فقط** (declarative): الاستيراد من `react-router-dom` هو `HashRouter` (واحد) و`MemoryRouter` (اختبارات) و`Routes` و`Route` و`Navigate` و`Link` و`NavLink` و`Outlet` و`useLocation` و`useNavigate` و`useParams`. **لا** `createHashRouter`/`RouterProvider`/loaders/actions/`defer`/`useFetcher`/`Form`/`ScrollRestoration`، **لا** علامات `future` حاليًا، **كل** `Link`/`Navigate`/`navigate()` بمسارات **مطلقة** (فُحصت: لا نسبية)، وفيه **مسار `*` واحد** (`<Route path="*" element={<Home/>}/>`). ⇒ أعلام `v7_relativeSplatPath`/`v7_fetcherPersist`… لا أثر لها علينا؛ يبقى `v7_startTransition` (لفّ تحديثات الحالة بـ`startTransition`) وهو الأثر الوحيد المحتمل، ويُختبر بمجموعة اختبارات الواجهة. التعديلات المتوقعة عند الترقية: `package.json` (`react-router-dom` وربما حزمة `react-router` المباشرة بحسب إرشاد 7)، وربما `import` من `react-router` بدل `react-router-dom` (v7 تعيد تصدير الأخيرة)، **وتعديل 0 إلى 2 ملف مصدري** (`App.tsx` و`main.tsx`) — يتأكد بعد قراءة سجل تغييرات 7 وبيانات `npm view`.
**Vite/Vitest (إن لزم):** إعداد `vite.config.ts` بسيط (`defineConfig` من `vite`، `react()`، `viteSingleFile()` في وضع review، `define: __REVIEW_MODE__`، و`test: { environment: 'jsdom', globals: true, setupFiles, css: false }`). واجهات Vitest المستعملة في الاختبارات: `vi.fn` و`vi.useFakeTimers` و`vi.useRealTimers` و`vi.advanceTimersByTimeAsync` فقط (مستقرة عبر الإصدارات). **اختبارات الخادم بوسم `// @vitest-environment node`** (بدل `environmentMatchGlobs` الذي يُرجَّح أنه أُهمل في إصدارات أحدث — **غير مُتحقَّق منه هنا**، ويُؤكَّد من `evidence.json`) ⇒ **متوافقة أمامًا**. نقاط تحقق عند الترقية: (1) استيراد `defineConfig` من `vitest/config` بدل `vite` إن طلبت الإصدارات الأحدث ذلك لنوع `test`، (2) `tsconfig.json` يضم `vitest/globals` ضمن `types`، (3) `setup.ts` (top-level await + `@testing-library/jest-dom/vitest`) يعمل كما هو على الأرجح، (4) حقل `engines` للإصدار المرشَّح (يُقرأ من `evidence.json` لا من ذاكرتي) مقابل Node لديكِ (النسخة التي تعملين بها: أرسلي `node -v`). **لا تعديل لاختبارات الخادم أو الواجهة متوقع**، ويُثبت الأمر بتشغيلها.
**Tailwind 3 → 4 (آخر خيار):** تغيير كبير (إعداد CSS، إضافة PostCSS مستقلة)؛ لا يُنفَّذ إلا إن فرضته الثغرة وبقرار منفصل.

## 2) الخطة (دفعات صغيرة، كل واحدة بنفس البوابات)
**البوابات بعد كل دفعة بالترتيب:** `node scripts/check-dependency-policy.mjs` ← `npm run typecheck` ← `npm test` ← `npm run build` ← `node scripts/record-audit-batch.mjs "الدفعة n: …"` (يشغّل `npm audit` و`--omit=dev` ويسجّل المعالَج والمتبقي في `docs/phase5/AUDIT_LOG_AR.md`). فشل أي بوابة ⇒ تراجع (`package*.backup.json`).
| # | الدفعة | المحتوى | شرط التنفيذ |
|---|---|---|---|
| 0 | الأساس | نسخة عمل مستقلة (`Copy-Item -Recurse`)، نسخ احتياطي لـ`package*.json`، `node scripts/collect-audit-evidence.mjs`، تسجيل الدفعة 0 (الحالة قبل أي تغيير) | — |
| 1 | غير كاسر شامل | ما يقترحه npm نفسه كإصلاح **غير كاسر** لأي من التسع: `npm audit fix --dry-run` ثم مراجعة التغييرات ثم `npm audit fix` **بلا `--force`**. يُتوقع أن يحلّ العائلة ج إن كان الإصلاح في `postcss-selector-parser 6.x`، وأي ترقيع داخل `vitest 2.x`/`vite 5.x`/`tinypool 1.x`/`@vitest/mocker`/`vite-node` | `fixAvailable.isSemVerMajor: false` لكل منها |
| 2 | الإنتاج: React Router | إن وُجد إصلاح ضمن 6.x ⇒ `npm install react-router-dom@<الإصدار>`. وإلا الانتقال إلى 7 (انظر 1.3) بتغيير ملفات الكود المحدّدة وإضافة اختبارات تنقّل (حارس الأدوار، المسار `*`، رابط المعلمة) **قبل** التنفيذ | `npm view react-router-dom@<v> peerDependencies engines` يطابق React 18.3.1 وNode لديكِ |
| 3 | التطوير: Vitest+Vite+esbuild معًا | **إن بقي شيء بعد 1** ولم يُصلَح إلا بـmajor: يُرفعان **معًا** إلى أدنى مجموعة متوافقة يثبتها `npm view` (dependencies/peers لـvitest المرشَّح تقبل vite المرشَّح، وplugin-react وsingle-file يقبلانه، وإصدار Node لديكِ يكفي)، مع `--allow-major=vitest,vite,vite-node,@vitest/mocker,esbuild` للحارس وتعديلات 1.3 | أدلة `evidence.json` |
| 4 | Tailwind (إن لزم) | إن لم يُصلَح `postcss-selector-parser` إلا في 7.x: **لا تغيير**؛ أشرح الخيارين (انتظار ترقيع tailwind/postcss-nested، أو 3→4) والمخاطر وأطلب قراركِ | — |
| 5 | الإغلاق | `npm audit` و`npm audit --omit=dev` **كلاهما** يجب أن يظهرا 0، وإلا يُدرَج كل متبقٍّ بسببه (لا استثناءات). ZIP جديد وتقرير بالملفات والإصدارات | — |
**لن أستعمل:** `npm audit fix --force`، ولا `overrides` لإجبار إصدار غير مثبَت توافقه، ولا إخفاء ثغرة، ولا حذف اختبار، ولا ترقية major بلا تحليل.

## 3) كيف أنتقل من الخطة إلى التنفيذ بلا تخمين
على جهازكِ، وبالإنترنت: **`node scripts/collect-audit-evidence.mjs`** (قراءة فقط) ⇒ `audit-evidence/evidence.json`. يحوي: `npm audit` (كامل وإنتاج)، و`npm audit fix --dry-run` (ما سيتغيّر فعلًا)، و`npm outdated`، و`npm ls`، ولكل حزمة متأثرة/مراقبة (vite، vitest، plugin-react، singlefile، react-router(-dom)، tailwindcss، postcss، jsdom، testing-library، react…): الإصدارات وdist-tags، ولكل إصدار مرشَّح (إصلاح npm + الأحدث): `engines` و`peerDependencies` و`dependencies`. بهذه البيانات أحدّد **الإصدارات المحدّدة** وأتحقق من توافقها هنا حسابيًا قبل أن أعطيكِ أوامر التنفيذ.

## 4) نموذج تسجيل النتائج (يُملأ تلقائيًا بـ`record-audit-batch`)
| الدفعة | معالَج | متبقٍّ (الكل) | متبقٍّ (إنتاج) | سبب البقاء |
|---|---|---|---|---|
| 0 قبل | — | 9 (2 حرجة، 1 عالية، 6 متوسطة) | 2 (متوسطتان) | — |
| 1…5 | | | | |
