## r40 — حذف المعلمة لملفها نهائيًا + التصفير بنقرة واحدة وللمديرة + الأرشيف = نسخة أثَر للقراءة فقط
- **حذف نهائي:** المعلمة تحذف آخر إصدار في خانتها (ملف أو رابط) ما دام الفصل مفتوحًا ولم يُنشأ أرشيف سنوي ولا رفع جارٍ: يُحذف الملف من R2 (النهائي والمؤقت) وصفوف القاعدة فلا أثر في المنصة ولا في صفحتي المديرة والمالكة (A-126). يبقى سطر واحد في `audit_log` (`teacher.delete_version`، معرّف الإصدار فقط). زر «حذف» + نافذة تأكيد في بوابة المعلمة.
- **التصفير السنوي:** نقرة تأكيد واحدة بلا كتابة اسم السنة، يعمل تلقائيًا حتى الاكتمال، وللمالكة والمديرة (`/staff/year-reset/*`، صفحة `/director/year-reset`). بوابة الأرشفة باقية.
- **الأرشيف:** ملف ZIP يحوي **نسخة أثَر نفسها** (نفس الصفحات والتصميم والشعار والخطوط) للقراءة فقط: لا رفع ولا تعديل ولا خادم، تُفتح بالنقر المزدوج على `index.html` دون إنترنت، مع معاينة/تنزيل الملفات من المجلد وكشف الأجزاء الناقصة. مصدرها `src/archive/*` وتُبنى بـ`npm run archive-app` (تلقائيًا ضمن `npm run build`) إلى `public/archive-app`؛ فشل تحميلها يوقف بناء الأرشيف (فشل مغلق).
- **التصفير بلا شروط الأرشفة الثقيلة (A-127):** يكفي أن يكون الأرشيف مبنيًّا ومسجَّلًا؛ أُلغيت النسخة الثانية والإقرار وتحقق الأجزاء (`014_reset_light_gate.sql` ضمن `01h`).
- الأرشيف يُنزَّل ملفًا واحدًا افتراضيًا (حتى 3.5 غيغابايت ثم يُقسَّم تلقائيًا).
- SQL جديد: `database/012_teacher_delete.sql` و`013_reset_for_staff.sql` ⇒ `supabase/01h_teacher_delete.sql` و`03g_post_check_delete.sql` (3 PASS).
- `scripts/r2-diagnose.mjs`: تشخيص رفع R2 من الطرفية (كشف مفتاح بطول خاطئ).
- الصفحة الرئيسية: الشعار أكبر وتحته سطر صغير «منصة ملف الإنجاز الإلكتروني» بدل العنوان الكبير والوصف.
- اختبارات: 676 ناجحًا (مع قاعدة محلية). **لم يُجرَّب على Supabase/R2 الحقيقيين.**

## 2026-11-16 — 1.0.0-rc.1 (r36) — إكمال المنصة: تصفير سنوي، إدارة السنوات والمعلمات، استيراد Excel/CSV (A-118…A-121)
- **التصفير السنوي الحقيقي:** `database/010_year_reset.sql` (+`01f`/`03e`) وخدمة `yearResetService` ومسارات `/owner/year-reset/{report,status,start,resume}` وصفحة «التصفير السنوي». بوابة صارمة، تقرير قبل التصفير، تأكيد مكتوب، حذف R2 على شرائح مع التحقق من الغياب، حذف القاعدة بمعاملة واحدة مع تحققات (السنوات الأخرى/الحسابات/audit_log)، سجل إغلاق موجز، قابل للاستئناف.
- **إزالة كل مسار أرشفة سحابية:** `ArchiveService` للنقل التراجعي فقط؛ `/owner/archives/legacy` يعرض ما رُفع سابقًا لتنزيله والتحقق منه قبل التصفير.
- **النسخة الثانية:** إقرار صريح بالاستقلال المادي إلزامي (الخادم يرفض بدونه)؛ الواجهة لا تُظهر «تحقق» لمجرد اختيار نوع الوسيط.
- **السنوات:** إنشاء سنة + فصلين + مواعيد في معاملة واحدة، تواريخ بداية/نهاية، تعديل قبل بدء العمل فقط، تفعيل سنة واحدة، سنة مغلقة لا تُفعَّل (`011` ← `01g`/`03f`).
- **المعلمات:** بحث/تصفية بالحالة/ترتيب، إيقاف وإعادة تفعيل، **استيراد Excel/CSV** بمعاينة وكشف تكرار وتصحيح وذرّية وتقرير وإصدار أكواد اختياري (ملف أكواد CSV يُنزَّل مرة واحدة).
- اعتماديتان جديدتان: `read-excel-file@9.3.17`, `write-excel-file@4.1.1` (خط الأساس حُدّث عمدًا).
- 12 دليلًا عربيًا في `guides/`. تقرير التدقيق `AUDIT_R36_AR.md`.
- اختبارات: دورة حياة كاملة (`server/test/lifecycle.test.ts`)، تصفير (`yearReset.test.ts`)، سنوات واستيراد (`adminService.test.ts`)، استيراد بملفات xlsx حقيقية، واجهات.
- **لم يُجرَّب على Supabase/R2 الحقيقيين** (انظر `FINAL_DELIVERY_AR.md`).

## 1.0.0-rc.1 (r36.2) — تصحيح 011/01g
- `update_year`: التحقق من بداية/نهاية السنة بعد دمج القيم الجديدة بالمحفوظة؛ الفصلان يجب أن يتأثرا فعلًا (صف واحد لكل فصل) وإلا تُلغى المعاملة.
- `year_work_started`: يشمل الآن وجود إصدارات (versions) في السنة.
- لم تتغير 01d/01e/01f. اختبارات جديدة: 3 (المجموع 650).

## 2026-11-15 — 0.8.2 (r35.2) — تدقيق المرحلة 1 وإصلاحها (A-117)
- **إيقاف الأرشفة السحابية القديمة:** `/owner/archives/create` ⇒ 410 `cloud_archive_disabled` (لا كتابة إلى R2)، وتعطيل الزر في الواجهة. لا SQL جديد.
- تحقق النسخة الثانية فحص كامل (ZIP/CRC/الملفات الداخلية) + اختيار مجلد اللابتوب/الهاردسك + سطر حالة (لم يبدأ/جارٍ/مكتمل/جزء مفقود/جزء تالف).
- جُرّب العارض في Chromium حقيقي من file:// دون إنترنت: صفر طلبات خارجية.
- تقرير التدقيق: `AUDIT_R35_1_AR.md`. التصفير لم يُبنَ بعد.

## 2026-11-15 — 0.8.1 (r35.1) — أرشيف سنوي مقسَّم + تحقق الأجزاء + نسخة ثانية متحقَّق منها (A-116)
- **إزالة حد 1 غيغابايت للسنة:** تقسيم حتمي (نفس الدالة في الخادم والمتصفح) إلى أجزاء ZIP بحجم مستهدف 50 MB–1 GB (افتراضي 200 MB)، حتى 60 جزءًا، كل إصدار في جزء واحد؛ جزء واحد فقط في الذاكرة. الجزء 1: العارض + `archive-index.json` الرئيسي؛ كل جزء: `parts/part-NN.json` + `SHA256SUMS-part-NN.txt`.
- العارض المحلي يقرأ كل الأجزاء كأرشيف واحد، شريط أحمر لأي جزء ناقص، ورسالة عند معاينة ملف جزؤه ناقص، وصفحة «حول» بجدول الأجزاء.
- التحقق: `verifyArchiveSet` (حجم/بصمة/CRC/بيان كل جزء، ناقص/تالف باسمه، تكرار الإصدارات، ملخّص المحتوى)، و`/owner/year-archive/confirm-part`؛ حارس قاعدة يمنع ختم «نُزّل وتحقق» قبل تحقق كل الأجزاء؛ المسار القديم `confirmDownload` يرفض الأرشيف المحلي.
- **النسخة الثانية:** صارت تحققًا لا إقرارًا: `/owner/year-archive/confirm-copy` (بصمة كل جزء + نوع الوسيط)، ولا يُقبل قبل تحقق الأصل؛ حُذف إقرار `second_copy`. تنبيه في الواجهة: يجب أن تكون خارج اللابتوب (قرص خارجي).
- **بوابة التصفير (قراءة فقط):** `public.year_archive_gate(uuid)` وعرضها في الواجهة؛ **لا تصفير**.
- SQL جديد يدوي: `database/009_archive_parts.sql` ← `supabase/01e_archive_parts.sql` + `03d_post_check_parts.sql` (6 PASS). إصلاح اكتشفته الاختبارات: مقارنة `text[] || literal`.
- حذف المعلمة: لا حذف قبل تحقق كل الأجزاء (اختُبر)، والأرشيف المحلي يحفظ اسمها وملفاتها وإصداراتها بعد الحذف (اختُبر).
- إصلاح اختبار قديم (`releaseOverview`) كان يفتقر لتجهيز المالكة وملف 007 عند تشغيله على Postgres.
- اختبارات: 556 (بلا Postgres) / 613 (مع Postgres محلي)، كلها ناجحة.

## 2026-11-14 — 0.8.0 (r35) — المرحلة 1: الأرشيف السنوي التفاعلي (A-115)
- أرشيف واحد للسنة بفصليها يُبنى **في متصفح المالكة** (لا نسخة في R2): الملفات الفعلية بكل إصداراتها + نسخة أثَر مستقلة تعمل دون إنترنت + manifest.json + SHA256SUMS.txt؛ يفشل مغلقًا إن اختلف حجم/بصمة أي ملف عن القاعدة.
- الخادم: `server/services/yearArchiveService.ts` ومسارات `/owner/year-archive/{plan,urls,register,ack,status}`؛ التسجيل يعيد حساب ملخّص المحتوى من القاعدة ويملأ `archive_entries` لكل الإصدارات (تعارض قديم: أرشفة الفصل لا تملؤها). لا SQL جديد.
- المتصفح: `src/lib/yearArchive/*` (zip، build، verify، العارض)، وقسم «الأرشيف السنوي الكامل» في صفحة الأرشفة: بناء ← حفظ ← تحقق من الملف المحفوظ ← إقرار فتحه دون إنترنت ← نسخة ثانية.
- أدلة جديدة: ARCHIVE_AND_RESET_GUIDE_AR وDEPLOYMENT_GUIDE_AR وTROUBLESHOOTING_AR وPROJECT_STATUS_AR. التصفير (حذف فعلي) **لم يُبنَ بعد** (المرحلة 2).

## 2026-11-14 — 0.7.3 (r34) — حذف المعلمة بعد الأرشفة بدل التعطيل (A-114)
- زر «حذف المعلمة» للمالكة فقط: يُمحى الاسم، يُبطل الدخول، ويُرفض ما لم تُؤرشف كل تسليماتها وتُنزَّل ويُتحقق من بصمتها.
- SQL يدوي جديد: `supabase/01d_teacher_removal.sql` ثم `03c_post_check_removal.sql`؛ ويلزم إعادة نشر دالة Edge.
- الإصدارات والأرشيف والتدقيق تبقى.
- اختبارات: 500/500 + 10/10 على Postgres محلي.

## 2026-11-13 — 0.7.2 (r33) — صيغة رمز المعلمة: حرفان من الاسم + 3 أرقام (A-113)
- الرمز صار مثل `SA-482` (بادئة لاتينية من أول حرفين من اسم المعلمة بجدول تحويل ثابت + 3 أرقام عشوائية آمنة) بدل `XXXX-XXXX-XXXX`. الرقم السري (6 أرقام) باقٍ كما هو. الرموز القديمة الطويلة المُصدَرة سابقًا ما زالت تُقبل. إعادة المحاولة عند تكرار الرمز حتى 30 مرة. التطبيع يقبل الأحرف الصغيرة والشرطة والمسافة والأرقام الهندية.
- ملفات: `server/auth/teacherCrypto.ts` و`teacherAuth.ts` و`pgAuthStore.ts` (اسم المعلمة) + اختبارات جديدة + إعادة توليد `supabase/functions/_shared/athar` (يلزم إعادة نشر الدالة).

## 2026-11-13 — 0.7.1 (r32) — إصلاح: الرمز لا يظهر بعد إصداره (A-112)
- السبب: بعد الإصدار تستدعي الصفحة `reload()` وكانت تُظهر حالة «جارٍ التحميل» فتُفكَّك الصفحة (DataGate) ويضيع مربع الرمز المعروض مرة واحدة، مع أن الرمز أُصدر فعلًا. الإصلاح: `reload` صامتة إذا كانت البيانات جاهزة (`supabaseRepository.ts`) + اختبار انحدار (يفشل بدون الإصلاح). يشمل أيضًا صفحة الأرشيف التي تستعمل `reload`.
- اختبارات: 487/487.

## 2026-11-13 — 0.7.0 (r31) — النسخة النهائية النظيفة (A-111)
- حذف وضع المعاينة والمصدر الوهمي من المنتج ومعاينة الملفات المرسومة؛ نقل المصدر الوهمي إلى `src/test/mock`؛ `src/lib/pageState.ts` بدل `review.tsx`؛ حذف `vite-plugin-singlefile` و`build:review`.
- قفل جديد من سجل npm + `npm audit fix` (0 ثغرة) وخط أساس اعتماديات جديد؛ تنظيف الأرشيفات والتقارير القديمة؛ `START_HERE_AR.md` مرجعًا وحيدًا للتنفيذ.
- اختبارات: 486/486؛ لا تغيير في SQL ولا الخادم ولا الشعار.

## 2026-10-21 — المرحلة 2 (تحضير، بلا تغيير في كود الواجهة 0.5.4)

## 2026-10-23 — 0.6.9 (r18) — دخول المعلمة، أرشفة ZIP، إفراج المالكة وoverview (A-100)
- جديد: `server/archive/zip.ts` (كاتب/قارئ ZIP بلا ضغط + `manifest.csv` بـSHA-256 + `verifyArchive`)، `server/auth/{teacherCrypto,teacherAuth,pgAuthStore}.ts`، `ownerRelease` و`overview` في `uploadService`، مسودة `docs/phase5/drafts/006_teacher_sessions.DRAFT.sql` (غير مطبّقة).
- اختبارات جديدة: `server/test/{archive,teacherAuth,pgAuthStore,releaseOverview}.test.ts` + `helpers/memoryAuthStore.ts`؛ `testDb.createTestEnv` يقبل `extraFiles`. مشغّل Node 223/223 (اختبارات القاعدة نائبة هنا).
- لم يتغير: الواجهة `src/`، SQL 001–005، الشعار، المنطق المرجعي. لا Supabase ولا Cloudflare ولا أسرار. الإصدار 0.6.9.

## 2026-10-23 — 0.6.8 (r17) — محاكي القاعدة المحلي وخدمات الرفع (A-99)
- جديد: `server/db/` (واجهة `Db` + مشغّل psql محلي للاختبار)، `server/services/` (`uploadService`: start/complete/cancel/saveLink/sweepExpired/recoverStuck، `gate`, `observe`, `errors`)، `scripts/local-pg.sh`.
- اختبارات: `server/test/{gate,psqlDb,uploadService}.test.ts` (37). مشغّل Node مع Postgres محلي 190/190؛ `tests/sql` 62/62 و57/57 و36/36 (أُضيفت دورة 005)؛ حزمة `supabase/` محليًا 98/0 و8/8.
- `package.json`: `@types/node` (devDependency) و`tsconfig.json`: `"node"` في `types` (لم يُتحقق منه بـnpm).
- لم يتغير: الواجهة `src/`، SQL 001–005، الشعار، المنطق المرجعي. لا Supabase ولا أسرار.

## 2026-10-23 — 0.6.7 (r16) — إلغاء TOTP (A-98)
- كود: حُذف التحقق بخطوتين من `controller.ts` وصفحة الدخول وأنواع العميل؛ الدخول = بريد + كلمة مرور + صف نشط + تأكيد الدور من الخادم.
- SQL (غير مُنفَّذ): `database/005_staff_accounts.sql` بدل `005_staff_mfa.sql` (`current_staff_role` بلا aal؛ بقي الحارس و`bootstrap_staff`)، واختبارات `tests/sql/25_staff_accounts_005.sql`، وأُعيد توليد `supabase/01b_staff_accounts.sql` و`02_security_check.sql`. النسخ القديمة في `archive/`.
- اختبارات: مشغّل Node 153/153؛ فحوص ساكنة 39/39 و30/30. لم يُشغَّل vitest ولا SQL.
- لم يتغير: السياسات 001–004، الشعار، طبقة الرفع والتخزين، `server/objectKey.ts`.

## 2026-10-23 — 0.6.6 (r15) — الدفعة 2، العمل 1: `server/objectKey`
- جديد: `server/objectKey.ts` (اشتقاق وتحليل وعزل مفاتيح الكائنات خادميًا) و`server/test/objectKey.test.ts` (14 اختبارًا). `tsconfig.json` يشمل `server`. `scripts/node-test-runner/run.sh` يشغّل اختبار الخادم.
- لم يتغير: `src/` (واجهة، رفع مرجعي، تخزين)، SQL، الشعار، الاعتماديات.
- خطة بقية طبقة الخادم: `docs/phase5/SERVER_LAYER_PLAN.md`.


## 2026-10-23 — 0.6.5 (r14) — الدفعة 1: واجهة
- واجهة: حذف عبارتي «المالكة» و«مدرسة واحدة» من صفحة الدخول؛ ألوان باستيل متنوعة للبطاقات (tailwind: mint/blush/sand/aqua). اختبارات +2.
- `previous-versions/` صارت تحوي r13 مصدرًا فقط (بلا الحزم المضمّنة) لتبقى الحزمة تحت حد الإرسال 30 MB؛ r7–r12 محفوظة في ملفاتكِ المنزَّلة سابقًا.

## 2026-10-22 — 0.6.4 (r13) — بوابة ما قبل النشر (مراجعة، بلا تغيير وظيفي)
- جديد: `src/test/release-gate.test.ts` (6 اختبارات دخول حدّية: 429 وانقطاع الشبكة وTOTP)، و`docs/RELEASE_GATE_REPORT_AR.md`.
- لم يتغير: كود المنصة، SQL، الشعار. `previous-versions/` تحوي r12 فقط (وفيها r7 وr9 وr10 مضمّنة)؛ r11 ملف صاحبة المشروع.
- الإصدار 0.6.3 ← 0.6.4.

## 2026-10-22 — 0.6.3 (r12) — الصفحة الرئيسية بالبطاقات وتوحيد التنقل ومراجعة الجلسة
- جديد: `src/lib/sections.ts` (سجل أقسام واحد حسب الدور)، `SectionCard`، `pages/shared/Home.tsx` (مكوّن واحد للمالكة والمديرة)، `src/test/home.ui.test.tsx`.
- `AppShell` أُعيد بناؤه: ترويسة ثابتة وشريط أقسام أفقي؛ أُزيل الشريط الجانبي والدرج. المسارات: `/owner` و`/director` صارتا الصفحة الرئيسية؛ اللوحتان القديمتان إلى `/owner/overview` و`/director/overview` (العنوان «لوحة المتابعة» للمالكة). لم تتغير Guard ولا الصلاحيات.
- الجلسة (A-93): `signOut` بنطاق `local` افتراضيًا، وحالة `check_failed` + `retry()` للأعطال المؤقتة بدل محو الجلسة؛ واجهة «تعذّر التحقق من الجلسة مؤقتًا» وإعادة تلقائية عند عودة الاتصال. TOTP وaal2 وتأكيد الدور دون تغيير.
- `usePageState`: لا تأخير اصطناعي خارج بناء المعاينة (A-94).
- فحوص: بصمات الشعار وفحوص ساكنة جديدة؛ إزالة علامة «معاينة تصميم» من `check-dist-no-mock.mjs` (A-95). اختبارات: 180 ← 207.
- لم يتغير: SQL، قاعدة Supabase، الشعار، الاعتماديات. الإصدار 0.6.2 ← 0.6.3.

## 2026-10-22 — 0.6.2 (r11) — إعادة تصميم شاشة الدخول بعد ملاحظة صاحبة المشروع (بلا تغيير وظيفي)
- `AuthLayout`: عمود مركزي واحد بخلفية ثلجية-لافندرية، والشعار الأصلي (دون تعديل) مرة واحدة فوق النموذج؛ أُزيلت اللوحة الجانبية والتكرار.
- `Login.tsx`: عنوان وعنوان فرعي في الوسط، بطاقة أكبر، وإصلاح اتجاه النص في تنبيه «الاتصال غير مُعدّ» (`.env.local` والمسار داخل `bdi` LTR). خلفية التنبيه الأحمر أخف.
- جديد: `env-local-template.txt` (قالب بقيم نائبة فقط؛ لا مفاتيح). لم يُغيَّر أي منطق أو أمان أو SQL.
- **لم يُشغَّل:** typecheck/vitest/build/فحص بصري (فُحصت الصياغة فقط).

## 2026-10-22 — 0.6.1 (r10) — إعادة التصميم البصري (بلا تغيير وظيفي، المرحلة 3 ما زالت غير مكتملة)
- لوحة ألوان باردة: `tailwind.config.js` (`steel`/`frost`/`lav`/`snow`) بدل `brand`/`gold`/`cream`؛ أُعيدت تسمية الأصناف في 28 ملفًا من `src/` آليًا (brand→steel، cream→snow، gold→lav؛ وخيارا `tone`/`variant`).
- أُعيد تصميم: `AuthLayout` (لوحة ثلجية-لافندرية والشعار الأصلي في إطاره)، قائمة `AppShell` (عنصر نشط هادئ بشريط أزرق ثلجي)، `States` (حالات الفراغ/الخطأ)، شريط التقدم، خلفية الصفحة، حقول الإدخال، ألوان `StatusBar`/`Reports`/`FilePreview`.
- ألوان المعلمات الثمانية باردة (`TEACHER_COLORS`)؛ صفحة المعلمة: أفاتار بلونها وحد علوي بلونها. حالات التسليم ما زالت بألوانها الدلالية المستقلة.
- `PageHeader` يقبل `leading`، و`Card` يقبل `style`.
- لم يتغير: الشعار والرمز (بايتًا)، SQL، RLS، المصادقة، المستودعات، الاختبارات، الاعتماديات. الإصدار 0.6.0 ← 0.6.1 في `package.json` فقط.
- **فُحص فعليًا:** مشغّل Node 130/130، فحص ساكن 18/18 و35/35، صياغة 87 ملف TS/TSX بلا أخطاء. **لم يُشغَّل:** vitest، typecheck، build، فحص بصري.
- جديد: `docs/REDESIGN_REPORT.md`، `docs/DESIGN_PREVIEW_AR.md`، `docs/RESUME_WINDOWS_AR.md`. حزمة r9 محفوظة في `previous-versions/`.

## 2026-10-22 — r9 (وثائق فقط، الكود 0.6.0 بلا تغيير)
- جديد: `docs/WINDOWS_TEST_STAGE3_AR.md` (اختبار Windows خطوة بخطوة). تصحيح تعليمات `npm ci` ← `npm install` في `WINDOWS_RUN_GUIDE` و`SUPABASE_SETUP_AR` و`NEXT_STEPS` و`ENV_LOCAL_AR` لأن `package-lock.json` غير متزامن.
- حزمة r8 باقية (لم تُحذف).

## 2026-10-22 — 0.6.0 — المرحلة 3 (قيد التنفيذ): دخول المالكة والمديرة وربط البيانات
- جديد: `src/lib/supabase/*` (عميل عام + حارس مفاتيح)، `src/lib/auth/*` (فشل مغلق + TOTP)، `src/data/supabase/*`، `src/data/{errors,services}.ts`، `components/layout/DataGate.tsx`، `data/mock/review.ts`، `docs/ENV_LOCAL_AR.md`، `docs/phase5/STAGE3_REPORT.md`، فحوص `scripts/check-stage3-static.mjs` و`check-dist-no-mock.mjs`، واختبارات auth/supabaseData/login.ui.
- معدَّل: `Login.tsx` (أُزيل الدخول الوهمي)، `App.tsx` (services + DataGate)، `provider.ts` (Supabase فقط)، `main.tsx`، العقد `repository.ts` (load/reload/unavailable)، صفحات المالكة/المديرة (إعلان فشل حقيقي وتعطيل غير المتاح)، `package.json` (+`@supabase/supabase-js`، الإصدار 0.6.0).
- لم يتغير أي SQL. لم يُحدَّث `package-lock.json` (يلزم `npm install`).
- **غير مُشغَّل:** vitest الكامل، typecheck/build للواجهة، دخول حقيقي.
- جديد: database/005_staff_mfa.sql، supabase/01b_staff_mfa.sql، supabase/03_post_check.sql، tests/sql/25_staff_mfa_005.sql، وثيقتا STAFF_ACCOUNTS_AND_MFA وTEACHER_LOGIN_DESIGN.
- معدَّل: scripts/build-supabase-sql.mjs، scripts/check-sql-static.mjs، supabase/02_security_check.sql، tests/sql/00_bootstrap.sql (إضافة auth.jwt() وعمود email)، docs/SUPABASE_SETUP_AR.md. الأصول القديمة في archive/.
- 01_apply_all.sql بلا تغيير. كل SQL الجديد غير مُنفَّذ.

## [0.2.0] — 2026-10-18 — المرحلة الثانية: تصميم الواجهات
### أُضيف
- مشروع Vite/React/TypeScript/Tailwind كامل مع Tajawal، وهوية مستمدة من صورة الهوية (اقتطاعات الشعار دون تعديل).
- 14 شاشة: دخول، لوحة المعلمة ونافذة التسليم، لوحة المديرة وقائمة المعلمات وتفاصيلهن والتقارير والمواعيد، لوحة المالكة والسنوات والمعلمات والأكواد وسجل العمليات والأرشفة والحذف النهائي.
- منطق الحالات والمواعيد (`src/lib/status.ts`) وقواعد الملفات والروابط (`src/lib/files.ts`).
- 31 اختبارًا آليًا، وملف مراجعة `review/athar-ui-review.html`.
- `docs/RUN_GUIDE.md` و`PHASE2_REPORT.md`.
### أُصلح أثناء الاختبار
- تجاوز أفقي على الهاتف في لوحتي المديرة والمالكة؛ عكس نطاق السنة في RTL؛ تكرار الاسم في الترويسة؛ شريط المراجعة فوق النوافذ.
### لم يُنفَّذ (بحسب القواعد)
- لا SQL ولا Supabase ولا R2 ولا مصادقة ولا رفع ولا أرشفة ولا حذف حقيقية.

## [0.2.1] — 2026-10-18 — تحديث الحالة فقط
- توضيح أن المرحلة 2 منفّذة ولم تُعتمد نهائيًا؛ إضافة القرارات A-16…A-20. لا تغيير في الكود.

## [0.3.0] — 2026-10-19 — المرحلة الثالثة: معمارية وأمان ونموذج بيانات (وثائق فقط)
### أُضيف (`docs/phase3/`)
- `01_GLOSSARY.md` قاموس مصطلحات مبسط.
- `02_SERVICE_LIMITS_VERIFICATION.md` حدود وأسعار الخدمات من وثائق رسمية مع روابط ودرجات تأكد، وملخص القانون العُماني.
- `03_CRITICAL_DECISIONS.md` عشرة قرارات بخيارات وتوصيات غير معتمدة.
- `04_PROPOSED_ARCHITECTURE.md`، `05_DATA_MODEL.md` (نصي بلا SQL)، `06_THREAT_MODEL.md` (23 تهديدًا)، `07_TEST_PLAN_AND_COSTS.md`، `08_OPEN_QUESTIONS.md`.
- `PHASE3_REPORT.md`.
### حُدِّث
- PROJECT_STATUS، DECISIONS_LOG (A-21…A-27 وDP-01…DP-10)، NEXT_STEPS (برومبت جديد).
### لم يُنفَّذ (بحسب القواعد)
- لا كود ولا تعديل واجهات (الكود كما في 0.2.1) ولا SQL ولا اتصال بأي خدمة ولا حسابات.

## [0.3.1] — 2026-10-19 — تسجيل موافقات مبدئية (وثائق فقط)
- إضافة القسم «ز» في DECISIONS_LOG (A-29…A-36). لا تغيير في الكود. المرحلة 3 غير معتمدة بعد.

## [0.3.2] — 2026-10-19 — استكمال المرحلة 3: المجاني أولًا والتخزين (وثائق فقط)
### أُضيف
- `docs/phase3/09_FREE_FIRST_AND_STORAGE_ADDENDUM.md`: حقائق الخطط المجانية بمصادرها، طبقة تخزين قابلة للتبديل، حد حجم الملف كإعداد (المقترح المؤقت 50 MB)، سعة التخزين، التكاليف والمخاطر، مسودة النسخ الاحتياطي والاستعادة.
- DECISIONS_LOG: A-37…A-40 وجدول الحالة (قسم ط).
### حُدِّث
- ملفات `docs/phase3/03…08` بتنبيه الأولوية وتعديلات الاتساق (إلغاء توصية Pro، حد الحجم إعداد، `app_settings`).
- PHASE3_REPORT وPROJECT_STATUS وNEXT_STEPS وPROJECT_RULES.
### لم يُنفَّذ
- لا كود (الواجهة ما زال فيها ثابت 100 MiB)، لا SQL، لا اتصال بخدمات، لا بطاقة، لا بيانات حقيقية، لا اختبارات V-01…V-10.


## [0.3.3] — 2026-10-19 — مراجعة نهائية للمرحلة 3 (وثائق فقط)
### حُدِّث
- PROJECT_STATUS (عدد ملفات المرحلة 3، مسار الكود، قسم التعارضات المعروفة)، NEXT_STEPS (تنبيه الحد)، `docs/01_REQUIREMENTS.md` (تنبيه)، PHASE3_REPORT (صف الملحق 09 وقسم المراجعة النهائية)، DECISIONS_LOG (وسم DP-07 وOQ-09، وقسم «ي»).
### لم يُنفَّذ
- لا كود، ولا إعادة تشغيل للاختبارات (لا تبعيات ولا شبكة)، ولا معالجة لتعارض 100 MiB في الكود، ولا استعادة للقسمين المفقودين «أ» و«ب».

## [0.3.4] — 2026-10-19 — معالجة R-01 وR-03 (وثائق فقط)
### أُضيف / حُدِّث
- A-41 في DECISIONS_LOG وتوضيح A-28؛ تنبيه «السجل غير مكتمل» وتفصيل القرارات المفقودة (قسم «ي»)؛ القاعدة 18 في PROJECT_RULES؛ القاعدتان 8 و9 في برومبت NEXT_STEPS؛ PROJECT_STATUS وPHASE3_REPORT.
### لم يُنفَّذ
- لم تُستعد A-01…A-15 (لم يُعثر عليها)، ولم يُصلَح حد 100 MiB في الكود (R-02)، ولا كود ولا اختبارات V-01…V-10.

## [0.3.5] — 2026-10-19 — فجوة A-01…A-15 واعتماديات المرحلة 4 (وثائق فقط)
### أُضيف / حُدِّث
- A-42 (A-01…A-15 فجوة تاريخية موثقة، غير معتمدة)؛ القسم «ك» (اعتماديات المرحلة 4)؛ القاعدة 19؛ تحديث R-01/R-02/R-03 في القسم «ي»؛ تصحيح بند قديم في PHASE3_REPORT؛ PROJECT_STATUS وNEXT_STEPS.
### لم يُنفَّذ
- لا كود (حد 100 MiB باقٍ، R-02)، لا مرحلة 4، لا V-01…V-10، لا خدمات أو حسابات أو بيانات حقيقية.

## [0.4.0] — 2026-10-19 — اعتماد المرحلة 3 وبدء المرحلة 4.0 (وثائق فقط)
### أُضيف / حُدِّث
- A-43 (اعتماد المرحلة 3 كأساس للتصميم والتخطيط مع بقاء A-01…A-15 وR-02)؛ `docs/phase4/PHASE4_0_REPORT.md` (خيارات DP-06 وDP-10 وتوصياتها، **غير مثبتة**)؛ تحديث PROJECT_STATUS وNEXT_STEPS وPHASE3_REPORT.
### لم يُنفَّذ
- لا كود ولا SQL؛ 4.1…4.4 لم تبدأ؛ حد 100 MiB باقٍ (R-02)؛ لا خدمات أو بيانات حقيقية أو V-01…V-10.

## [0.4.1] — 2026-10-19 — إتمام المرحلة 4.0 (وثائق فقط)
- تسجيل A-44 (DP-06 = أ + ب)، A-45 (DP-10 = ج + تصدير يدوي)، A-46 (سجل العمليات للمالكة فقط)؛ تحديث جدول DP ومصفوفة الوصول في `05`؛ إتمام `docs/phase4/PHASE4_0_REPORT.md`.
- لم يُنفَّذ: لا كود ولا SQL؛ 4.1…4.4 لم تبدأ؛ R-02 باقٍ.

## [0.4.2] — 2026-10-19 — المرحلة 4.1: ملفات SQL وRLS محلية (غير منفَّذة)
- أُضيف `database/001_schema.sql` و`002_integrity.sql` و`003_rls.sql` (15 جدولًا، سلسلة بصمات، حماية الإصدارات، RLS)، وتقرير `docs/phase4/PHASE4_1_REPORT.md`، وA-47 وقسم «ل» في السجل.
- فحص ساكن للبنية فقط؛ **لم يُنفَّذ SQL ولم يُجرَّب**. لم يتغير أي كود تطبيق؛ R-02 قائم حتى 4.2/4.3.

## [0.4.3] — 2026-10-19 — المرحلة 4.2: طبقة تخزين قابلة للتبديل + تخزين وهمي + معالجة R-02
### أُضيف
- `src/lib/storage/` (عقد التخزين، التخزين الوهمي، الإعدادات، SHA-256، المفاتيح، الأخطاء، السياق)، و`src/test/storage.test.ts` (21 اختبارًا)، و`HANDOFF.md`، و`docs/phase4/PHASE4_2_REPORT.md`، وA-48.
### عُدِّل
- `src/lib/files.ts` (إزالة الحد الثابت)، `SubmitDialog.tsx` (حد وأنواع من الإعدادات، حفظ عبر المحوّل)، `store.tsx`/`types.ts` (بصمة ومفتاح تخزين اختياريان)، `App.tsx` (StorageProvider)، `logic.test.ts` (اختبارات R-02)، `vite-env.d.ts`، `database/001_schema.sql` (إضافة jpeg)، `docs/RUN_GUIDE.md`، `NEXT_STEPS.md`، `PROJECT_STATUS.md`، `DECISIONS_LOG.md`.
### لم يُنفَّذ / لم يُتحقق
- vitest الحقيقي، `tsc -b`، البناء، إعادة بناء `review/athar-ui-review.html` (قديم)، أي رفع لمزوّد حقيقي، SQL على قاعدة، 4.3 و4.4.

## [0.4.4] — 2026-10-19 — المرحلة 4.3: طبقة بيانات منظَّمة قابلة للتبديل بدل `seed.ts`
### أُضيف
- `src/data/repository.ts` (عقد `DataRepository`)، `src/data/mock/` (المصدر الوهمي + البذرة المنقولة)، `src/data/provider.ts` (نقطة التبديل)، `VolatileDataNotice` (تنبيه أن البيانات مؤقتة)، واختبارات العقد والمعماري، `docs/phase4/PHASE4_3_REPORT.md`، A-49 وA-50.
### عُدِّل
- `store.tsx` (واجهة رقيقة)، `App.tsx`، `AppShell.tsx`، `ReviewBar.tsx`، `Login.tsx`، `SubmitDialog.tsx`، `TeachersAdmin.tsx`، `ui.test.tsx`، وثائق التشغيل والحالة، وأُعيد بناء `review/athar-ui-review.html`.
### تحقق (فعليًا، Linux/Node 22)
- `npm ci`، `npm test` الحقيقي **74/74** (الأساس قبل التعديل 52/52)، `typecheck`، `build`، `build:review`، فحص متصفح 390/1280.
### لم يُنفَّذ
- لا مصادقة/بيانات حقيقية/خدمات؛ لا SQL؛ لا V-01…V-10؛ لا تشغيل على Windows؛ 4.4 لم تبدأ؛ R-02 غير مغلق نهائيًا.

## [0.4.4] (استكمال) — 2026-10-19 — المرحلة 4.4: مراجعة الاختبارات والوثائق وتعليمات Windows + تسليم المرحلة 4
### أُضيف
- `scripts/build-review.mjs`، `docs/phase4/PHASE4_4_REPORT.md`، A-51 وA-52، والقاعدة 20 (ZIP كامل بعد كل مرحلة فرعية).
### عُدِّل
- `package.json` (الإصدار 0.4.4، `engines.node`، سكربت `build:review`)، `package-lock.json` (الإصدار)، `.gitignore`، `docs/RUN_GUIDE.md` (Windows)، `PROJECT_RULES.md`، `PROJECT_STATUS.md`، `NEXT_STEPS.md`، `HANDOFF.md`، `DECISIONS_LOG.md`، وأُعيد بناء `review/athar-ui-review.html`.
### تحقق (فعليًا، Linux/Node 22)
- `npm test` الأصلي 74/74، `typecheck`، `build`، `build:review` (دون المساس بـ`dist`)، `npm run dev` (HTTP 200)، فحص Chromium (390 وملف المراجعة عبر file://).
### لم يُنفَّذ
- لا تغيير على سلوك المنتج أو القرارات؛ لا خدمات/بيانات حقيقية؛ لا V-01…V-10؛ لا تشغيل على Windows بيدك؛ المرحلة 5 لم تبدأ؛ R-02 غير مغلق نهائيًا.

## [0.4.4-docs] — 2026-10-19 — المرحلة 5.0: مراجعة وتقسيم (وثائق فقط)
### أُضيف
- `docs/phase5/PHASE5_0_REPORT.md`: مراجعة الحزمة، قراءة ساكنة لجاهزية SQL وواجهة التخزين ونافذة التسليم، فجوات G-1…G-9، تقسيم المرحلة 5 إلى 5.0…5.7، الخدمات والتكاليف، وقرارات D-1…D-7.
- A-53 في `DECISIONS_LOG.md`.
### لم يتغير
- الكود و`database/*.sql` و`package.json` (الإصدار البرمجي 0.4.4). لم تُشغَّل الاختبارات في هذه الجلسة (لا وصول لشبكة npm)، وأرقام 74/74 هي المسجّلة في 4.4.
### لم يُنفَّذ
- لا خدمات ولا حسابات ولا بطاقة ولا بيانات حقيقية ولا V-01…V-10.

## [0.5.1] — 2026-10-19 — المرحلة 5.1: عقد الرفع الآمن ومنطق حالات الرفع المرجعي
### أُضيف
- `src/lib/upload/` (`session.ts` · `window.ts` · `signature.ts` · `verify.ts` · `ledger.ts` · `index.ts`): حالات الجلسة، نافذة الرفع (إعداد)، توقيع الملف، التحقق المرجعي، ومحاكٍ في الذاكرة (جلسة واحدة ← إصدار واحد، تثبيت الحالة عند البدء، عزل المعلمات، تسجيل المحاولات).
- `src/test/upload.test.ts` (19 اختبارًا).
- `docs/phase5/UPLOAD_CONTRACT.md` و`UPLOAD_TABLES_PROPOSAL.md` و`drafts/004_upload_tables.DRAFT.sql` (غير منفَّذة) و`PHASE5_1_REPORT.md`.
- A-54 في `DECISIONS_LOG.md`.
### تغيّر
- رقم الإصدار إلى 0.5.1 (`package.json`/`package-lock.json`)، و`docs/RUN_GUIDE.md` (اسم الحزمة والعدد المتوقع للاختبارات).
### لم يتغير
- `database/001…003` والواجهة والصفحات؛ لا يستورد أي كود قائم الوحدة الجديدة.
### لم يُختبر
- اختبارات المشروع الكاملة وbuild (لا شبكة npm). الاختبارات الـ19 شُغّلت بمشغّل Node المدمج لا vitest. SQL المسودة لم يُنفَّذ.

## [0.5.1-docs-rev1] — 2026-10-20 — مراجعة المرحلة 5.1 وتسجيل موافقات مبدئية (وثائق فقط)
### أُضيف
- `docs/phase5/PHASE5_1_REVIEW.md`: سلامة الحزمة، نتائج الاختبارات الفعلية، مراجعة توافق الجداول (C-1…C-9)، وتحليل D-8…D-11 وحجم 50 MB وآثارها.
- A-55 في `DECISIONS_LOG.md` والقسم «م» (موافقات مبدئية لا نهائية).
### حُدِّث
- `PHASE5_1_REPORT` (القسم 7)، `UPLOAD_CONTRACT` (القسم 11)، `UPLOAD_TABLES_PROPOSAL` (حالة الاعتماد)، تعليقات مراجعة أعلى `drafts/004_upload_tables.DRAFT.sql` (دون تعديل أي جملة SQL)، `PROJECT_STATUS`، `HANDOFF`، `NEXT_STEPS`، `docs/RUN_GUIDE.md`.
- تصحيح ثلاث عبارات قديمة (4.4 «بانتظار المراجعة»، حالة NEXT_STEPS، «لم أتحقق بـvitest»).
### لم يتغير
- الكود (0.5.1) و`database/001…003` و`package.json`.
### جرى فعليًا
- نسخة معزولة: `npm ci` من القفل بلا إضافة اعتماديات، vitest **93/93**، `typecheck`، `build`، `build:review` ناجحة (Linux/Node 22).
### لم يُنفَّذ
- لا SQL (لا محلي ولا Supabase)، لا خدمات ولا حسابات ولا بطاقة ولا بيانات حقيقية، لا V-01…V-10، لا Windows، لا 5.2.

## [0.5.2] — 2026-10-20 — 5.1ب: معالجة ملاحظات المراجعة (A-56) — مبدئي
### أُضيف
- `docs/phase5/PHASE5_1B_REMEDIATION.md` (C-1…C-9، آلية بدء الرفع غير المعتمدة، قرارات Q-1…Q-15).
- `docs/phase5/SQL_LOCAL_TEST_PLAN.md` (خطة اختبار SQL محلي — لم تُنفَّذ).
- `docs/phase5/drafts/004_upload_tables.DRAFT-v2.sql` (مقترح — لم يُنفَّذ ولم تُفحص صياغته).
- A-56 والجدول المحدَّث في القسم «م» من `DECISIONS_LOG.md`.
### تغيّر (كود مرجعي، غير مربوط بالواجهة)
- `src/lib/upload/session.ts`: حالة `cancelled`، `ACTIVE_STATES`، `isActive`.
- `src/lib/upload/ledger.ts`: جلسة نشطة واحدة لكل (معلمة، فصل، خانة) مع إعادة الاستعمال دون تمديد النافذة، انقضاء كسول، `cancel()`، رمز خطأ `active_session_exists`.
- `src/test/upload.test.ts`: 7 اختبارات جديدة (19 → 26)، وتعديل اختبارين قائمين (كانا يفتحان جلستين نشطتين لخانة واحدة) وتوسيع اختبارين للحالات.
- `package.json`/`package-lock.json`: الإصدار 0.5.2؛ `docs/RUN_GUIDE.md` (اسم الحزمة والعدد 100).
### جرى فعليًا
- نسخة معزولة (`npm ci` من القفل بلا اعتماديات جديدة): vitest **100/100**، `typecheck`، `build`، `build:review`. أثناء ذلك كشف اختبار خطأً في الكود الجديد وأُصلح قبل التسليم.
### لم يتغير
- `database/001…003` (بايت ببايت)، والواجهة والصفحات، والمسودة الأصلية `004`.
### لم يُنفَّذ
- أي SQL، 5.2، Supabase/Cloudflare، V-01…V-10، Windows، أي مسح أو حذف، أي قياس على مزود.

## [0.5.2-docs-1c] — 2026-10-20 — 5.1ج: مبادئ معتمدة مبدئيًا وتوضيحات تصميمية (وثائق فقط)
### أُضيف
- `docs/phase5/PHASE5_1C_DESIGN_CLARIFICATIONS.md`: المبادئ السبعة (A-57)، C-10 (كشف مفاتيح التخزين وخيارات حجبها وما يحتاج خادمًا)، T0/T1/T2، سلوك إعادة المحاولة، الجلسات العالقة، مستويات الاختبار، القرارات المفتوحة مصنّفة، وتناقضات لم تُحسم.
- A-57 والقسم «ن» في `DECISIONS_LOG.md`.
### حُدِّث (تصحيح تناقضات قديمة)
- `PROJECT_STATUS.md`: سطر الإصدار (كان 0.4.4)، وبند «31 اختبارًا» (أصبح 100 معدَّدة مع بيان آخر تشغيل فعلي)، ومسار المصدر الوهمي (`src/data/mock/`)، وصفا 5.1ب و5.1ج، وبند 5.1ج.
- `HANDOFF.md`: العنوان، بند 5.1ج، بند «ما لم يُتحقق منه»، خريطة الملفات (A-16…A-57 وصف `docs/phase5/`)، الخطوة التالية، والبرومبت (`npm ci` بدل `npm install`، والوثيقتان الجديدتان).
- `NEXT_STEPS.md`: العنوان (كان 0.5.1)، قسم «ما ينتظرني منكِ»، «الحالة الحالية» (كانت 93/93 فقط) و«الخطوة التالية» في البرومبت، وتنبيه أن مخطط المرحلة 4 تاريخي، وملاحظات التحديث.
- توضيح تعارض T0 مع A-56 في `DECISIONS_LOG` (T0 افتراض احتياطي مؤقت لا دليل بدء).
### لم يتغير (بصمات SHA-256 قبل التعديل = بعده، وأُثبت بالمقارنة)
- `database/001_schema.sql` 5edbb992601d1cc6…، `002_integrity.sql` ec304fb202dd50f0…، `003_rls.sql` 987edc25a7ec9ab2…، ومسودتا `004_upload_tables.DRAFT.sql` و`DRAFT-v2.sql`، وكل ملفات `src/` و`package.json` و`package-lock.json`.
- عبارة «`database/001…003` بايت ببايت» في [0.5.2] لا يمكن إعادة التحقق منها هنا (الحزمة السابقة غير متاحة)؛ سُجّلت البصمات للمقارنة لاحقًا.
### جرى فعليًا
- بصمات الملفات قبل/بعد، وقراءة ساكنة لملفات SQL والكود، وفحص سلامة ZIP.
### لم يُنفَّذ
- **لم تُشغَّل أي اختبارات** (لا شبكة npm؛ لا PostgreSQL). لا SQL ولا اعتماديات ولا Supabase/Cloudflare ولا بيانات حقيقية ولا V-01…V-10 ولا Windows ولا 5.2. لا تغيير في سلوك الكود ولا في معنى `submitted_at`. المشروع غير جاهز للاستخدام المدرسي.


## [0.5.4] — 2026-10-21 — تحقق محلي (الدفعة 1، مجموعة 1)
### تغيّر
- وثائق الحالة فقط؛ الكود وSQL وpackage*.json بلا تغيير.
### اختُبر
- vitest 124/124، typecheck، build، build:review، مشغّل Node 83/83، فحص SQL ساكن 15/15.
### لم يُنفَّذ
- أي SQL، S-1، Windows، خدمات خارجية.

## [0.5.4 + تعديل SQL] — 2026-10-21 — الدفعة 1، المجموعة 2 (رقم `package.json` بقي 0.5.4؛ لم يتغير الكود)
### أُصلح
- S-1: منح أعمدة على `terms` (المواعيد عبر `set_term_deadlines` فقط)؛ الأصل في `database/archive/003_rls.v0.5.4.sql`.
### تغيّر
- `tests/sql/10_security_003.sql`: اختبارات انحدار S-1 (62 اختبارًا). الكود (`src/`) وpackage*.json بلا تغيير.
### اختُبر
- PostgreSQL 16 محلي معزول: A 62/62، B 57/57. Q-8: لا دمج.

## [0.5.4 + SQL/Supabase] — 2026-10-21 — الدفعة 1، المجموعة 3
### أُضيف
- `database/004_upload_tables.sql` (من v4 + سحب EXECUTE من 3 دوال مشغّلات)، `scripts/build-supabase-sql.mjs`، `supabase/01_apply_all.sql`، `supabase/02_security_check.sql`، `docs/SUPABASE_SETUP_AR.md`.
### تغيّر
- مشغّلات الاختبار تشير إلى `database/004_upload_tables.sql`.
### اختُبر
- A 62/62، B 57/57، محاكاة Supabase 62/62، التزامن 3/3. الكود `src/` بلا تغيير.

## 2026-10-24 — 0.6.10 (r19) — طبقة HTTP الخادمية، تفويض الأدوار، مُجمِّع الأرشفة، عميل دخول المعلمة (A-101)
- جديد: `server/api/{handler,staffVerifier}.ts`، `server/archive/builder.ts`، `src/lib/teacherAuth/client.ts`؛ اختبارات `server/test/{api,archiveBuilder}.test.ts` و`src/test/teacherAuthClient.test.ts`. مشغّل Node 266/266.
- معدّل: `scripts/node-test-runner/run.sh` (ملفات الاختبار الجديدة)، `package.json` (الإصدار 0.6.10)، وثائق الحالة، `docs/RESUME_NEXT_ACCOUNT_AR.md` (حُدّثت: كانت تصف ما بعد r17).
- لم يتغير: الواجهة `src/pages`، SQL 001–005، الشعار، المنطق المرجعي، مسودة 006 (غير مطبّقة). لا Supabase ولا Cloudflare ولا أسرار.

## 2026-10-24 — 0.6.11 (r20) — R2 بالبدائل، قراءة المعلمة، روابط موقّعة، أرشفة، تركيب، ربط واجهة الدخول (A-102)
- جديد خادمًا: `server/storage/{sigv4,r2}.ts`، `server/services/{teacherReadService,transferService,archiveService}.ts`، `server/api/compose.ts`، مسارات جديدة في `server/api/handler.ts` (portfolio، presign، downloads، archives).
- جديد واجهة: `src/lib/teacherAuth/TeacherPortalContext.tsx`، `src/pages/teacher/Portal.tsx`، تبويب «المعلمة» في `Login.tsx` يعرض نموذج الدخول **فقط** عند ضبط `VITE_TEACHER_API_URL`، مسار `/teacher/portal` في `App.tsx`، وطرق `portfolio`/`signDownload` في العميل.
- اختبارات جديدة: `server/test/{sigv4r2,teacherRead,archiveService,compose}.test.ts` وإضافات `api.test.ts`، `src/test/teacherAuthClient.test.ts` (موسّع) و`src/test/teacherPortal.test.tsx` (لم يُشغَّل). مشغّل Node 318/318.
- لم يتغير: SQL 001–005 (لا جداول ولا أعمدة جديدة)، مسودة 006 (غير مطبّقة)، `TeacherHome` والمخزن وصفحات الإدارة، الشعار. لا Supabase ولا Cloudflare ولا أسرار.

## 2026-10-24 — 0.6.12 (r21) — ربط الواجهات، تدقيق دائم، بيان الأرشيف، SQL 006/007 (A-103)
- SQL جديد للمراجعة (غير منفَّذ): `database/006_teacher_sessions.sql`، `database/007_server_additions.sql`، `tests/sql/35_server_additions_006_007.sql`، مولَّدات `supabase/01c_server_additions.sql` و`03b_post_check_additions.sql`، وتحديث `build-supabase-sql.mjs` وأسكربتات `run-sql-tests.sh/.ps1` (تشغيل d). مسودة 006 الأصلية باقية في docs/phase5/drafts.
- خادم: `ownerRelease` يتطلب `actorUserId` ويكتب أثرًا دائمًا في معاملته؛ `auditSink.ts`؛ تدقيق قبل الإجراء الحساس بفشل مغلق؛ `ArchiveService.confirmDownload` ومسار `/owner/archives/confirm`؛ `original_name` في بيان الأرشيف؛ `compose.ts` يركّب التدقيق.
- عملاء: رفع/استبدال/رابط في `teacherAuth/client.ts`؛ `staffApi/{client,StaffApiContext}`؛ `AuthController.getAccessToken` وBackendClient.getSession (اختياري).
- واجهة: بوابة المعلمة (رفع/استبدال/رابط/تنزيل)، تنزيل المديرة والمالكة في `TeacherDetail`/`VersionList`، وتنزيل الأرشيف والتحقق من بصمته وإنشاؤه عبر الخادم في `owner/Archive.tsx` (يعمل فقط عند ضبط `VITE_TEACHER_API_URL`).
- فحوص: `check-sql-additions-static.mjs`، `check-code-sql-compat.mjs`. مشغّل Node 346/346.
- وثائق: `docs/SUPABASE_SETUP_AR.md` أُعيدت كتابتها (القديمة في docs/archive)، `database/README_SEQUENCE_AR.md`، `docs/WINDOWS_BATCH_R21_AR.md`، `docs/phase5/BATCH_R21_REPORT.md`، `R2_INTEGRATION_AR.md` (CORS GET).
- لم يتغير: SQL 001–005، مسودة 006 الأصلية، المخزن وبقية الصفحات، الشعار. لا Supabase ولا Cloudflare ولا أسرار.

## 2026-10-24 — 0.6.13 (r22) — مشغّل القاعدة، مضيف Edge، وإغلاق ثغرات التشغيل (A-104)
- جديد خادمًا: `server/db/{postgresDb,bind}.ts`، `server/host/edge.ts`، `server/archive/crc32.ts`؛ `psqlDb.ts` يعيد تصدير `bindParams/sqlLiteral` من `bind.ts` (سلوك مطابق)؛ استيراد `node:buffer` صريح؛ `zip.ts` بلا `node:zlib`؛ سقف الأرشيف 40MB وحد الكائن الافتراضي 30MB؛ مسار `/owner/maintenance/sweep`.
- جديد استضافة: `supabase/functions/api/{index.ts,deno.json}`، `supabase/config.toml.example`، `supabase/functions/_shared/athar/**` (مولَّد)، `scripts/build-edge-function.mjs`، `scripts/check-no-secrets-in-frontend.mjs`، `.gitignore` (أسرار الدوال).
- جديد واجهة: إصدار/إلغاء أكواد المعلمات في `TeachersAdmin` (يعرض الكود والرقم السري مرة واحدة)، `pages/owner/UploadSessions.tsx` (مسار `/owner/uploads`) + رابط مشروط في `Dashboard`، وطرق `overview/releaseSession/sweepExpired/issueCredentials/revokeCredentials` في `staffApi/client.ts`.
- اختبارات جديدة: `server/test/{postgresDb,edgeHost,edgeBuild,crc32}.test.ts` وإضافات `api/archiveBuilder/compose` و`src/test/staffApiClient.test.ts`. مشغّل Node 377/377.
- وثائق: `docs/phase5/{EDGE_HOST_AR,BATCH_R22_REPORT}.md`، `docs/WINDOWS_BATCH_R22_AR.md`، تحديث `SUPABASE_SETUP_AR.md` وقالب البيئة.
- لم يتغير: SQL 001–007 (لا جداول ولا أعمدة جديدة)، التصميم العام، صلاحيات الأدوار. لا Supabase ولا Cloudflare ولا أسرار.

## 2026-10-25 — 0.6.14 (r23) — إصلاح إخفاقات vitest على Windows وأداة تصنيف ثغرات npm (A-105)
- اختبارات: وسم `// @vitest-environment node` في كل `server/test/*.test.ts`؛ `src/test/setup.ts` آمن بلا `window`؛ `edgeBuild.test.ts` أُعيدت كتابته (محتوى المولَّد فعليًا + عملية دخان مستقلة `scripts/edge-smoke.mjs`)؛ `helpers/projectRoot.ts`؛ اختبارا pepper (نوع/طول/عالم آخر)؛ `auditSummary.test.ts`.
- كود: `assertPepper` يفصل رسالة النوع عن الطول (الشرطان بلا تغيير)؛ `server/tools/auditSummary.ts` + `scripts/summarize-npm-audit.mjs` (قراءة محلية فقط).
- سكربتات: جذر المشروع بـ`fileURLToPath` في build-edge-function وcheck-code-sql-compat وcheck-no-secrets-in-frontend؛ جديد `check-test-environments.mjs`.
- وثائق: `docs/phase5/{BATCH_R23_REPORT,NPM_AUDIT_AR}.md`، `docs/WINDOWS_BATCH_R23_AR.md`. لم يتغير `package.json` إلا برقم الإصدار، ولا `package-lock.json`.

## 2026-10-26 — 0.6.15 (r24) — أدوات تحليل ثغرات npm وحارس سياسة الاعتماديات (A-106)
- جديد: `server/tools/depPaths.ts`، توسيع `auditSummary.ts` (مسارات + أوامر مقترحة)، `scripts/{dependency-paths,check-dependency-policy}.mjs`، `docs/dependency-baseline.json`، اختبارات `depPaths/dependencyPolicy` وتوسيع `auditSummary` (401/401 في المشغّل البديل).
- وثائق: `docs/phase5/{BATCH_R24_REPORT,NPM_REMEDIATION_AR}.md`، `docs/WINDOWS_BATCH_R24_AR.md`، تنبيه في `NPM_AUDIT_AR.md`.
- **لم يتغير** `package.json` (إلا رقم الإصدار) ولا `package-lock.json` (غير متّسق مع package.json: `@types/node` — يُستبدل بقفل المستخدمة في r25).

## 2026-10-27 — 0.6.16 (r25) — خطة ثغرات npm الموحّدة وأدوات جمع الأدلة (A-107)
- جديد: `scripts/{collect-audit-evidence,record-audit-batch}.mjs`، `scripts/lib/npm.mjs`، `server/test/auditTooling.test.ts` (7 اختبارات بـnpm مزيَّف). مشغّل Node 408/408.
- وثائق: `docs/phase5/{NPM_FULL_PLAN_AR,BATCH_R25_REPORT}.md`، `docs/WINDOWS_BATCH_R25_AR.md`.
- **لم يتغير** `package.json` (إلا رقم الإصدار) ولا `package-lock.json` ولا أي كود/إعداد: لا إصدارات بلا بيانات سجل.

## 2026-10-29 — 0.6.17 (r26) — جمع الأدلة بلا فك أرشيف، ودليل فك Windows، وملف التسليم (A-108)
- جديد: `scripts/collect-audit-evidence.standalone.mjs` (ملف واحد بلا استيرادات؛ حرّاس الأمان مطابقة نصيًا لـ`lib/npm.mjs` باختبار)، اختبار إضافي في `auditTooling.test.ts` (409/409).
- وثائق: `docs/HANDOVER_AR.md`، `docs/WINDOWS_ZIP_EXTRACT_AR.md`، `docs/WINDOWS_BATCH_R26_AR.md`، `docs/phase5/BATCH_R26_REPORT.md`.
- **لم يتغير** أي كود تطبيق ولا `package.json` (إلا رقم الإصدار) ولا `package-lock.json`.

## 2026-10-30 — 0.6.18 (r27) — تعديلات إصلاح ثغرات npm (بلا تنفيذ npm) (A-109)
- `package.json`: `react-router-dom ^7.18.5`، `vite ^6.4.5`، `vitest ^5.0.5`، `engines.node >=22.12.0`؛ `vite.config.ts`: `defineConfig` من `vitest/config`؛ `scripts/check-dependency-policy.mjs`: اختفاء حزمة بترقية مصرَّح بها ليس فشلًا (+اختبار). مشغّل Node 410/410.
- وثائق: `docs/phase5/{NPM_FIX_EXECUTION_AR,BATCH_R27_REPORT}.md`، `docs/WINDOWS_BATCH_R27_AR.md`، تحديث `HANDOVER_AR.md`.
- **لم يتغير** كود التطبيق ولا الاختبارات ولا SQL ولا Supabase ولا Cloudflare. `package-lock.json` **قديم عمدًا** (يولّده `npm install`).

## 2026-11-06 — 0.6.19 (r28) — الدليل التفصيلي للتشغيل والنشر وتقرير الحالة (A-110)
- جديد: `docs/DEPLOYMENT_GUIDE_AR.md` (إعداد الجهاز، الحسابات، المرحلة A لإصلاح الثغرات، Supabase وSQL، حسابات المسؤولات، R2، أسرار الدالة ونشرها، الواجهة والاستضافة وCORS، 17 تجربة، بوابة الإطلاق، التشغيل، أخطاء Windows، كراسة تسجيل)، `docs/phase5/BATCH_R28_REPORT.md`.
- لم يتغير أي كود أو إعداد أو اعتمادية سوى رقم الإصدار. `package-lock.json` ما زال قديمًا عمدًا (يولّده `npm install` عند المستخدمة).

