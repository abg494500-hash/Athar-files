# ابدئي من هنا — تشغيل واختبار ونشر منصة «أثَر» (النسخة النهائية النظيفة r35.2 / 0.8.2)

> **ما الجديد في هذه النسخة:** حُذف كل ما كان تجريبيًا في المنتج: وضع «معاينة التصميم» وشريطه، وملف المعاينة `review/`، ومعاينة الملفات المرسومة (كانت تعرض صفحة مزيّفة بدل الملف الحقيقي، وبقي التنزيل الحقيقي)، وأُبعد المصدر الوهمي إلى `src/test/mock` للاختبارات وحدها (لا يدخل البناء؛ يتحقق منه `check-dist-no-mock.mjs`). وحُدّث `package-lock.json` فصار `npm ci` يعمل، وصار `npm audit` = **0 ثغرة**.
>
> **ما لم يتغير:** لم يُنفَّذ بعد على خدمات حقيقية: SQL على Supabase، نشر دالة الخادم، R2، تسجيل دخول حقيقي، رفع حقيقي. **لذلك الحزمة جاهزة للتنفيذ لا للإطلاق.** كل خطوة أدناه تُجرَّب لأول مرة عندكِ، وأي خطأ تُرسلينه لي (نص الخطأ فقط) فنصلحه.

## 0) قواعد تحميكِ
1. **لا تلصقي في المحادثة أي كلمة مرور أو مفتاح سري.** أرسلي نص الخطأ فقط (ولقطة شاشة بعد إخفاء الأسرار).
2. كل سر يُحفظ في **مدير كلمات المرور** لا في ملف داخل المشروع ولا في واتساب.
3. **لا تضعي أبدًا** `service_role` ولا أي مفتاح يبدأ بـ`sb_secret_` في الواجهة (الواجهة ترفضه تلقائيًا).
4. خطوة واحدة في كل مرة، ولا تنتقلي للتالية قبل أن يتحقق **«النجاح»** المكتوب تحتها. إن فشلت: أوقفي ولا تجرّبي حلولًا عشوائية.
5. ابدئي بمشروع **تجريبي ببيانات وهمية**. لا بيانات حقيقية قبل بوابة الإطلاق (القسم 11).
6. أنا لا أتصل بأي حساب لكِ ولا أملك أي مفتاح؛ كل تنفيذ على جهازكِ وفي حساباتكِ.

---

## 1) فور فك الضغط: ماذا أفعل بالضبط؟ (على Windows)

### 1.1 البرامج المطلوبة
- **Node.js 22.12 أو أحدث** (LTS) من nodejs.org. تحققي: افتحي PowerShell (الخطوة 1.3) واكتبي `node -v`. يجب أن يظهر `v22.…` أو أعلى.
- متصفح (Chrome أو Edge). **Notepad** موجود في Windows.

### 1.2 فك الحزمة
1. أنشئي مجلدًا قصيرًا خارج Downloads وOneDrive: افتحي PowerShell واكتبي `mkdir C:\athar-work` ثم Enter.
2. انسخي الملف `athar-r35.2-final-clean.zip` إلى `C:\athar-work`.
3. في PowerShell:
```
cd C:\athar-work
Unblock-File .\athar-r35.2-final-clean.zip
tar -xf .\athar-r35.2-final-clean.zip
cd .\athar
dir
```
**النجاح:** ترين `package.json` و`src` و`server` و`supabase` و`docs` و`START_HERE_AR.md`.
**الفشل (Access denied):** لا تفكّي بالنقر المزدوج؛ استعملي `tar -xf` كما فوق في `C:\athar-work`.

### 1.3 فتح PowerShell داخل المجلد
افتحي `C:\athar-work\athar` في مستكشف الملفات ← اضغطي **شريط العنوان** ← اكتبي `powershell` ← Enter. تفتح نافذة زرقاء مسارها المجلد. (إن ظهر `running scripts is disabled` نفّذي: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` ووافقي.)

### 1.4 تثبيت الاعتماديات وفحصها (بلا أي حساب)
اكتبي الأوامر **واحدًا واحدًا**:
```
npm ci
npm run typecheck
npm test
npm run build
npm audit
```
| الأمر | النجاح | إن فشل |
|---|---|---|
| `npm ci` | ينتهي بسطر `added … packages` | أرسلي المخرجات كاملة. **لا تستعملي** `--force` |
| `npm run typecheck` | لا يطبع أخطاء | أرسلي الأخطاء |
| `npm test` | `Test Files 42 passed` و`Tests 556 passed` | أرسلي أسماء الاختبارات الفاشلة |
| `npm run build` | `✓ built in …` (تحذير حجم 500 kB عادي) | أرسلي الخطأ |
| `npm audit` | `found 0 vulnerabilities` | أرسلي النتيجة |

ثم فحوص المشروع (كلها يجب أن تنجح):
```
node scripts/check-dependency-policy.mjs
node scripts/check-sql-static.mjs
node scripts/check-stage3-static.mjs
node scripts/check-no-secrets-in-frontend.mjs
node scripts/check-dist-no-mock.mjs
```
**النجاح:** «7/7 ناجح» ثم «39/39 ناجح» ثم «30/30 ناجح» ثم «10/10 ناجح» ثم «نجح: … بلا بيانات وهمية».

> ملاحظة: إن شغّلتِ `npm run dev` الآن بلا `.env.local` فتظهر صفحة الدخول برسالة حمراء **«الاتصال بقاعدة البيانات غير مُعدّ»**. هذا هو السلوك الصحيح (لا بيانات وهمية في المنصة). تعمل الواجهة بعد القسم 7.

---

## 2) الحسابات (مرة واحدة، فعّلي التحقق بخطوتين في كلٍّ منها)
1. **مدير كلمات المرور:** Bitwarden (bitwarden.com) ← مجلد `athar` تحفظين فيه كل شيء أدناه.
2. **Supabase** (supabase.com): سجّلي ← أنشئي Organization اسمها `Athar` على الخطة **Free**. لا تنشئي مشروعًا الآن.
3. **Cloudflare** (dash.cloudflare.com): لتخزين الملفات R2. ⚠️ قد يطلب بطاقة دفع لتفعيل R2 حتى للطبقة المجانية؛ اقرئي صفحة الأسعار قبل التفعيل، **ولا تفعّلي بطاقة دون قرارك**. إن لم تريدي بطاقة أخبريني لنبحث عن بديل.
4. **Netlify** (netlify.com) لاستضافة الواجهة بالسحب والإفلات.
5. **Supabase CLI** (لنشر دالة الخادم)، في PowerShell:
```
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
irm get.scoop.sh | iex
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
scoop install supabase
supabase --version
```
**النجاح:** يطبع رقم إصدار. (إن فشل Scoop: نزّلي CLI لـWindows من github.com/supabase/cli/releases وضعيه في مجلد ضمن PATH. وأعيدي فتح PowerShell بعد التثبيت.)

---

## 3) مشروع Supabase التجريبي
1. supabase.com ← **New project**: الاسم `athar-test`، **Database password**: ولّديها بمدير الكلمات (طويلة عشوائية) واحفظيها (لن نكتبها في أي ملف)، المنطقة الأقرب لكِ، Free ← **Create new project**. انتظري دقيقتين.
2. **Project Settings ← API**: دوّني **Project URL** (`https://REF.supabase.co`؛ `REF` معرّف المشروع) و**المفتاح العام** (`anon` أو `publishable`). **لا تنسخي `service_role` ولا `secret`.**
3. **Authentication**: عطّلي «Allow new users to sign up» ولا تفعّلي الدخول المجهول. ⚠️ قد يختلف اسم الخيار ومكانه.

## 4) تنفيذ ملفات SQL (أول تنفيذ لها؛ على مشروع فارغ فقط)
1. Supabase ← **SQL Editor** ← **New query**.
2. افتحي الملف من `C:\athar-work\athar\supabase\` بـNotepad، `Ctrl+A` ثم `Ctrl+C`، الصقي في المحرر (`Ctrl+V`)، اضغطي **Run**. **ملف واحد في كل استعلام جديد وبهذا الترتيب بالضبط:**

| # | الملف | معيار النجاح |
|---|---|---|
| 1 | `01_apply_all.sql` | «Success» |
| 2 | `01b_staff_accounts.sql` | «Success» |
| 3 | `02_security_check.sql` | **مربع أحمر مقصود** يبدأ بـ`RESULT: PASS=… FAIL=0` (تراجع تلقائي) |
| 4 | `03_post_check.sql` | 8 صفوف كلها PASS |
| 5 | `01c_server_additions.sql` | «Success» |
| 6 | `03b_post_check_additions.sql` | 12 صفًّا كلها PASS |
| 7 | `01d_teacher_removal.sql` (**جديد: حذف المعلمة بعد الأرشفة**) | «Success» |
| 8 | `03c_post_check_removal.sql` | 3 صفوف كلها PASS |
| 9 | `01e_archive_parts.sql` (**جديد r35.1: أجزاء الأرشيف**) | «Success» |
| 10 | `03d_post_check_parts.sql` | 6 صفوف كلها PASS |
| 11 | `01f_year_reset.sql` (**جديد r36: التصفير السنوي**) | «Success» |
| 12 | `03e_post_check_reset.sql` | 6 صفوف كلها PASS |
| 13 | `01g_years_teachers_import.sql` (**جديد r36: السنوات واستيراد المعلمين**) | «Success» |
| 14 | `03f_post_check_years.sql` | 4 صفوف كلها PASS |

> r36: بعد تنفيذ SQL أعيدي نشر الدالة `api` (الأمر في دليل النشر).

> **مشروع Supabase مطبَّق عليه حتى `03c` أو `03d` سابقًا:** شغّلي من الملف التالي لآخر ما نجح فقط (لا تعيدي ما نجح). كل ملف جديد إضافي ولا يحذف بيانات.

3. **إن ظهر خطأ:** انسخي نصه كما هو مع اسم الملف وأرسليه. **لا تعيدي الملف 1 على مشروع نصف مطبَّق**: احذفي المشروع التجريبي (Settings ← General ← Delete project) وأنشئي غيره فارغًا وأعيدي من الملف 1 بعد الإصلاح.

## 5) حسابا المسؤولة والمديرة
1. **Authentication ← Users ← Add user ← Create new user**: بريد المالكة وكلمة مرور قوية (فعّلي **Auto Confirm User** إن ظهر). كرّري للمديرة.
2. **SQL Editor** ← استعلام جديد (بدّلي البريدين ببريديهما الفعليين تمامًا كما أُنشئا في Users):
```
select public.bootstrap_staff('owner@example.com', 'owner');
select public.bootstrap_staff('director@example.com', 'director');
select user_id, role, is_active from public.staff_profiles;
```
**النجاح:** صفّان نشطان بالدورين. **الفشل «المستخدم غير موجود»:** تطابق البريد مع المنشأ في Users.
3. المالكة وحدها تصدر أكواد المعلمات وتنشئ الأرشيفات وتفرج عن الجلسات؛ المديرة تراجع وتنزّل التسليمات.

## 6) تخزين R2 (خاص)
⚠️ لم يُجرَّب. تفاصيل: `docs/phase5/R2_INTEGRATION_AR.md`.
1. Cloudflare ← **R2 Object Storage** ← **Create bucket** باسم `athar-test-files` (أحرف صغيرة وأرقام وشرطة). **اتركيه خاصًا: لا تفعّلي `r2.dev` ولا نطاقًا عامًا.**
2. دوّني **Account ID** (32 حرفًا).
3. **Manage R2 API Tokens ← Create API token**: الصلاحية **Object Read & Write**، وحدّدي الحاوية `athar-test-files` فقط. **انسخي فورًا Access Key ID وSecret Access Key** إلى مدير الكلمات (السر يظهر مرة واحدة).
4. CORS نضبطه في القسم 9 بعد معرفة رابط موقعكِ.

## 7) أسرار الدالة ونشرها
> ⚠️ أول تشغيل في Deno؛ توقعي أخطاء توافق وأرسليها لي. تفاصيل: `docs/phase5/EDGE_HOST_AR.md`.

**7.1 سرّان عشوائيان مختلفان (منذ r37 لم يعد هناك سر PIN):** نفّذي الأمر **مرتين** واحفظي كل ناتج باسمه في مدير الكلمات (`CODE` و`IP`):
```
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```
**7.2 ملف الأسرار المؤقت (خارج المشروع):**
```
mkdir C:\athar-secrets
notepad C:\athar-secrets\athar-test.env
```
اكتبي (بلا مسافات حول `=` وبلا اقتباس، والقيم من مدير الكلمات):
```
R2_ACCOUNT_ID=قيمة
R2_BUCKET=athar-test-files
R2_ACCESS_KEY_ID=قيمة
R2_SECRET_ACCESS_KEY=قيمة
TEACHER_CODE_PEPPER=قيمة-CODE
TEACHER_IP_PEPPER=قيمة-IP
STAFF_LOGIN_EMAILS=بريد-المالكة,بريد-المديرة
```
لا تضيفي `ALLOWED_ORIGIN` الآن ولا أي `SUPABASE_*` (تُوفَّر تلقائيًا).

**7.3 الربط والنشر** (من `C:\athar-work\athar`):
```
supabase login
supabase init
supabase link --project-ref REF
supabase secrets set --env-file C:\athar-secrets\athar-test.env
supabase secrets list
supabase functions deploy api --no-verify-jwt
Remove-Item C:\athar-secrets\athar-test.env
```
- `supabase login` يفتح المتصفح للموافقة. `supabase init` إن سأل عن VS Code اختاري `n`. `supabase link` إن سأل كلمة مرور القاعدة اضغطي **Enter** لتخطيها. إن اشتكى النشر من Docker أضيفي `--use-api` لأمر النشر. `secrets list` يعرض الأسماء فقط.
**7.4 فحص النشر:**
```
curl.exe https://REF.supabase.co/functions/v1/api/health
curl.exe -i https://REF.supabase.co/functions/v1/api/teacher/me
```
**النجاح:** الأول `{"ok":true,...}` والثاني `401` و`{"error":"unauthenticated"}`. **الفشل:** `503 not_configured` ⇒ Supabase ← Edge Functions ← api ← **Logs** يذكر اسم المتغير الناقص؛ صحّحيه ثم أعيدي `secrets set` والنشر. أي خطأ آخر: أرسلي نص السجل. **تراجع:** `supabase functions delete api`.

## 8) إعداد الواجهة وتجربتها محليًا (حاسوب وهاتف)
1. `Copy-Item env-local-template.txt .env.local` ثم `notepad .env.local` واجعليه **هكذا فقط**:
```
VITE_SUPABASE_URL=https://REF.supabase.co
VITE_SUPABASE_ANON_KEY=المفتاح-العام
VITE_TEACHER_API_URL=https://REF.supabase.co/functions/v1/api
```
2. **على الحاسوب:** `npm run dev` ← افتحي الرابط الذي يطبعه (مثل `http://localhost:5173`) ← سجّلي دخول المالكة. **النجاح:** تظهر لوحتها وأقسامها (بطاقات) ولا رسالة حمراء. **الإيقاف:** اضغطي `Ctrl+C` في نافذة PowerShell. **إن ظهر خطأ:** اقرئي الرسالة في الصفحة؛ «غير مُعدّ» تعني خطأ في `.env.local` (اسم الملف بالضبط `.env.local` لا `.env.local.txt`، ثم أوقفي الخادم وأعيدي تشغيله).
3. **على الهاتف (نفس شبكة الواي فاي):** أوقفي الخادم ثم `npm run dev -- --host` ← يطبع سطر `Network: http://192.168.x.x:5173` ← اكتبيه في متصفح الهاتف. إن لم يفتح: اسمحي لـNode في جدار حماية Windows (نافذة تظهر أول مرة، اختاري «Private networks») أو تأكدي أن الشبكة نفسها. أوقفيه بـ`Ctrl+C`. **النجاح:** تظهر الواجهة بالعربية RTL مناسبة للجوال.
4. بناء إنتاجي محلي: 
```
npm run build
node scripts/check-no-secrets-in-frontend.mjs
node scripts/check-dist-no-mock.mjs
npm run preview
```
**النجاح:** فحص الأسرار 10/10 وفحص البيانات الوهمية ينجح ويفتح `preview` رابطًا محليًا. أوقفيه بـ`Ctrl+C`.

## 9) نشر الواجهة وضبط الأصل المسموح وCORS
1. **Netlify** ← Add new site ← **Deploy manually** ← اسحبي مجلد `dist` (من `C:\athar-work\athar\dist`) إلى المربع. تحصلين على رابط مثل `https://xxxx.netlify.app`؛ افتحيه وتأكدي أن صفحة الدخول تظهر.
2. الأصل المسموح (الرابط **بلا مسار ولا شرطة أخيرة**):
```
notepad C:\athar-secrets\athar-test.env
```
اكتبي فيه سطرًا واحدًا: `ALLOWED_ORIGIN=https://xxxx.netlify.app` ثم:
```
supabase secrets set --env-file C:\athar-secrets\athar-test.env
supabase functions deploy api --no-verify-jwt
Remove-Item C:\athar-secrets\athar-test.env
```
3. **CORS في R2:** Cloudflare ← R2 ← الحاوية ← Settings ← **CORS Policy**:
```
[{"AllowedOrigins":["https://xxxx.netlify.app"],"AllowedMethods":["PUT","GET"],"AllowedHeaders":["content-type","content-length"],"MaxAgeSeconds":600}]
```
4. أي تغيير في قيم `VITE_*` يتطلب `npm run build` من جديد وإعادة رفع `dist` إلى Netlify.

## 10) تجارب نهاية-إلى-نهاية (في الموقع المنشور؛ جرّبي بعضها من هاتفكِ أيضًا)
أنشئي من «المعلمات والأكواد» معلمة تجريبية باسم وهمي. أرسلي لي أي إخفاق مع لقطة ونص الخطأ.

| # | التجربة | المتوقع |
|---|---|---|
| 1 | دخول المالكة وتصفّح الأقسام | تعمل بلا رسائل خطأ |
| 2 | إصدار رمز للمعلمة (مثل SA-12، رمز واحد بلا رقم سري) | يظهر في نافذة «تم إصدار الرمز» ويبقى ظاهرًا حتى تضغطي «تم، سلّمتُه»؛ انسخيه فورًا (لا يُعرضان ثانيةً). إن أُغلقت النافذة قبل نسخهما فاضغطي «إعادة إصدار» لرمز جديد |
| 3 | دخول المعلمة بالكود (نافذة خاصة أو الهاتف) | تظهر بوابتها بفصولها ومواعيد كل فصل |
| 4 | كود خاطئ عدة مرات | رسالة موحّدة ثم قفل مؤقت |
| 5 | رفع PDF صغير | «تم حفظ الإصدار 1» (أول اختبار حقيقي لـR2) |
| 6 | رفع نوع/حجم غير مسموح أو امتداد مزيَّف | يُرفض بسبب واضح |
| 7 | استبدال الملف ضمن المهلة | إصدار 2 والإصدار 1 باقٍ |
| 8 | حفظ رابط https ثم http | https يُقبل وhttp يُرفض |
| 9 | تنزيل المعلمة ملفها | يُنزَّل باسمه الصحيح |
| 10 | تنزيل المديرة ملف المعلمة من «تفاصيل المعلمة» | يُنزَّل (لا معاينة مرسومة؛ التنزيل فقط) |
| 11 | معلمة تطلب ملف معلمة أخرى | رفض |
| 12 | المديرة تحاول إنشاء أرشيف | غير مسموح |
| 13 | المالكة تنشئ أرشيف فصل ثم «تنزيل والتحقق من البصمة» | «تطابقت بصمته» |
| 14 | تعديل الأرشيف المنزَّل ثم المقارنة | يُرفض (لا تطابق) |
| 15 | فصل موعده مغلق وآخر مفتوح | الرفع يُرفض في المغلق ويُقبل في المفتوح |
| 16 | «عمليات الرفع» ← إفراج عن جلسة عالقة | يُسجَّل باسم المالكة |
| 17 | إلغاء كود المعلمة | تُنهى جلساتها فورًا |
| 18 | معلمة لها تسليم لم يُؤرشف، المالكة تضغط «حذف المعلمة» | يُرفض برسالة: أرشفي كل تسليماتها ونزّلي الأرشيف وتحققي من بصمته أولًا |
| 19 | بعد أرشفة وتنزيل وتحقق بصمة كل تسليماتها، «حذف المعلمة» | يُمحى اسمها ويصير «معلمة محذوفة» وتختفي من القائمة ويبطل دخولها؛ الأرشيف والملفات تبقى |
| 20 | المديرة تحاول حذف معلمة | غير مسموح |
| 21 | «الأرشفة والتحقق» ← «بناء الأرشيف السنوي وتسجيله» لسنة فيها تسليمات | عدّاد ثم «بُني الأرشيف وسُجِّل» |
| 22 | بعد البناء: «التحقق من نسخة اللابتوب (اختيار المجلد)» واختيار **كل** الأجزاء (`Ctrl+A`) | كل جزء «سليم»، وتظهر مرحلة «كل الأجزاء حُفظت وتحققت» وفي «بوابة التصفير» يبقى المتبقي فقط |
| 23 | احذفي جزءًا واحدًا من المجلد (أو عدّلي بايتًا في جزء) ثم أعيدي التحقق | الجزء يُذكر باسمه «ناقص/تالف» ولا تُختم المرحلة ولا يُسمح بحذف معلمة |
| 24 | استخرجي **كل** الأجزاء في مجلد واحد وافتحي `index.html` بوضع الطيران؛ ثم جرّبي بإزالة جزء | الرئيسية والمعلمات والفصلان والمعاينة والإصدارات والبحث تعمل؛ مع جزء ناقص يظهر شريط أحمر بأرقامه |
| 25 | «فتحتُ الأرشيف وجرّبته دون إنترنت» ثم انسخي الأجزاء لقرص خارجي واضغطي «اختيار مجلد الهاردسك الخارجي والتحقق من النسخة الثانية» | تتحقق بصمات كل جزء ويُسجَّل نوع الوسيط؛ وملف تالف في القرص يُرفض |
| 26 | رفع تسليم جديد بعد البناء ثم إعادة تسجيل ما بُني سابقًا | يُرفض (`تغيّرت بيانات السنة`) |
| 27 | بعد اكتمال التحقق (22): «حذف المعلمة» لمعلمة كل تسليماتها في الأرشيف | تُحذف (محو الاسم)؛ ومعلمة لها تسليم خارجه تُرفض |

**أخطاء مرجّحة عند أول تشغيل:** `node:*` في Deno، اتصال `postgres.js` وSSL، `set local role service_role`، دعم R2 لـ`If-None-Match`، CORS، زمن PBKDF2 قرب حد المعالج.

## 11) بوابة الإطلاق (☐ = لم يتحقق؛ لا إطلاق قبل تحقق كل ما يلي بنتائج حقيقية)
☐ SQL كله ناجح وفحوصه PASS · ☐ تجارب 1–27 ناجحة · ☐ اختبار أمني أساسي (تجاوز الصلاحيات، ملفات خبيثة/ضخمة، أسماء ملفات ملغومة) · ☐ اختبار حمل بحجم المدرسة (الأرشفة بالذاكرة ≤ 40MB) · ☐ موافقة إدارة المدرسة على التعامل مع بيانات المعلمات والاحتفاظ والخصوصية · ☐ نسخ احتياطي واستعادة **مجرَّبان** · ☐ القرارات المعلّقة في `HANDOFF.md` محسومة.

**الانتقال للإنتاج:** مشروع Supabase جديد (`athar-prod`) وحاوية R2 جديدة وأسرار جديدة (لا تعيدي أسرار التجربة)، وكرّري الأقسام 3–9 بالترتيب، ثم أصدري الأكواد الحقيقية وسلّميها بقناتين (الكود برسالة والرقم السري بأخرى)، وعطّلي حسابات التجربة.

## 12) بعد الإطلاق
نسخ احتياطي دوري للقاعدة + أرشيفات متحقَّق من بصمتها بنسخة ثانية خارج R2 · مراقبة سجلات الدالة وسجل العمليات وعمليات الرفع (التنظيف يدوي) · تدوير الأسرار عند الاشتباه (يُبطل أكواد المعلمات فتُعاد) · أي تحديث اعتماديات يمر بالفحوص أعلاه و`npm audit` قبل النشر.

## 13) أخطاء شائعة على Windows
| الخطأ | الفعل |
|---|---|
| `Access to the compressed folder is denied` | `tar -xf` في `C:\athar-work` |
| `running scripts is disabled` | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| `EBADENGINE` / `ERESOLVE` | Node أقدم من 22.12 أو خلل؛ أرسلي المخرجات؛ لا `--force` |
| `'supabase' is not recognized` | أعيدي فتح PowerShell أو أضيفي المسار إلى PATH |
| `curl` يطبع شيئًا غريبًا | استعملي `curl.exe` |
| «الاتصال بقاعدة البيانات غير مُعدّ» | `.env.local` ناقص/خاطئ؛ أعيدي تشغيل `npm run dev` أو أعيدي البناء |
| دخول المعلمة «غير متاح» | `VITE_TEACHER_API_URL` غير مضبوط عند البناء |
| رفض CORS | الأصل في R2 أو `ALLOWED_ORIGIN` لا يطابق رابط الموقع حرفيًا |

## 14) قائمة التحقق (املئيها أثناء العمل)
☐ فك الحزمة وظهور `package.json` · ☐ `npm ci` · ☐ typecheck · ☐ 556 اختبارًا · ☐ build · ☐ audit = 0 · ☐ الفحوص الخمسة · ☐ الحسابات والتحقق بخطوتين · ☐ مشروع Supabase · ☐ SQL الملفات الستة · ☐ حسابا المالكة والمديرة · ☐ R2 ومفاتيحه · ☐ الأسرار والدالة (health = ok) · ☐ `.env.local` وتجربة الحاسوب · ☐ تجربة الهاتف · ☐ نشر Netlify · ☐ ALLOWED_ORIGIN وCORS · ☐ التجارب 1–27 · ☐ بوابة الإطلاق.

## 15) مراجع
`docs/SUPABASE_SETUP_AR.md` (تفصيل SQL وجدول الأخطاء) · `docs/phase5/R2_INTEGRATION_AR.md` · `docs/phase5/EDGE_HOST_AR.md` · `docs/ENV_LOCAL_AR.md` · `HANDOFF.md` · `PROJECT_STATUS.md` · `docs/history/` (تقارير الدفعات السابقة، للأرشيف فقط).
