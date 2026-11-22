# دليل التشغيل والنشر من الألف إلى الياء — منصة «أثر» (r28 / 0.6.19)

> **اقرئي هذا أولًا:** الحزمة r28 هي **الأحدث** لكنها **ليست نهائية ولا جاهزة للنشر ولا للمدرسة**. هذا الدليل هو الطريق لتصبح كذلك. **لم يُنفَّذ أيٌّ من هذه الخطوات بعد** (لا الحسابات ولا SQL ولا النشر)، وكل ما يمس Supabase وCloudflare والاستضافة **أول تجربة له ستكون عندكِ الآن**. لذلك: اعملي على **مشروع تجريبي ببيانات تجريبية**، ولا تنتقلي لبيانات حقيقية قبل المرحلة 13.

## 0) قواعد تحميكِ طوال الطريق
1. **لا تلصقي في المحادثة أي كلمة مرور أو مفتاح أو «Secret».** أرسلي لي **رسالة الخطأ فقط** (ولقطة شاشة تُخفين فيها الأسرار).
2. كل سر يُحفظ في **مدير كلمات المرور** (المرحلة 2) لا في ملف داخل المشروع ولا في واتساب.
3. **لا تستعملي أبدًا** مفتاح `service_role` ولا أي مفتاح يبدأ بـ`sb_secret_` في الواجهة أو في أي ملف.
4. خطوة واحدة في كل مرة؛ **لا تنتقلي للتالية قبل أن ينجح معيار النجاح** المكتوب تحت كل خطوة. إن فشلت: أوقفي، ولا تحاولي «حلولًا» عشوائية، وأرسلي لي الخطأ.
5. ما لم أجرّبه بنفسي مُعلَّم **⚠️ لم يُجرَّب**؛ أسماء الأزرار في المواقع تتغير، فإن اختلفت الشاشة عن وصفي فأرسلي لقطة.
6. **أنا لا أتصل بأي حساب لكِ ولا أملك أي مفتاح.** كل تنفيذ على جهازكِ وفي حساباتكِ أنتِ.

## 1) تجهيز جهازكِ (Windows)
### 1.1 فتح PowerShell داخل مجلد
افتحي المجلد في مستكشف الملفات ← اضغطي على **شريط العنوان** (أعلى) واكتبي `powershell` ثم Enter. تفتح نافذة زرقاء مسارها هو المجلد. (هذه «الطرفية» التي أقصدها.) انسخي الأوامر والصقيها فيها (زر الفأرة الأيمن للصق).

### 1.2 Node وnpm
```
node -v
npm -v
```
**المطلوب:** Node **22.12.0 أو أحدث** (عندكِ 22.20.0 ✓). إن كان أقدم أو غير موجود: نزّلي «LTS» من nodejs.org ثم أعيدي فتح PowerShell.

### 1.3 مجلد عمل قصير وآمن
اختاري مسارًا **قصيرًا خارج Downloads/Documents/OneDrive** كي لا يمنع Windows الكتابة:
```
mkdir C:\athar-work
```

### 1.4 فك الحزمة (وتفادي خطأ «Access denied»)
انسخي `athar-r28-v0_6_19-source-only.zip` (الأخف، يكفي للعمل) إلى `C:\athar-work` ثم:
```
cd C:\athar-work
Get-FileHash .\athar-r28-v0_6_19-source-only.zip -Algorithm SHA256
```
قارني البصمة بملف `CHECKSUMS_R28.txt`. إن اختلفت فأعيدي التنزيل. ثم:
```
Unblock-File .\athar-r28-v0_6_19-source-only.zip
mkdir r28
tar -xf .\athar-r28-v0_6_19-source-only.zip -C .\r28
cd .\r28\athar
dir
```
**النجاح:** ترين `package.json` و`src` و`server` و`supabase` و`docs`. **الفشل (Access denied):** `docs\WINDOWS_ZIP_EXTRACT_AR.md`.

## 2) الحسابات (مرة واحدة)
> افتحي كل حساب ببريدكِ، **وفعّلي التحقق بخطوتين (2FA)** فور إنشائه.

### 2.1 مدير كلمات المرور
أنشئي حسابًا مجانيًا في **Bitwarden** (bitwarden.com). أنشئي فيه مجلدًا اسمه `athar` تحفظين فيه: كلمات مرور الحسابات، كلمة مرور قاعدة البيانات، مفاتيح R2، الأسرار الثلاثة (peppers)، وكلمات مرور المسؤولات.

### 2.2 Supabase
1. supabase.com ← **Start your project / Sign in** ← سجّلي ببريد أو GitHub.
2. أنشئي **Organization** (اسمها مثل `Athar`) على الخطة **Free** للتجربة.
3. **لا تنشئي مشروعًا الآن**؛ تُنشئينه في المرحلة 5.

### 2.3 Cloudflare (لتخزين الملفات R2)
1. dash.cloudflare.com ← **Sign up** ببريدكِ وفعّلي 2FA.
2. من القائمة اليسرى: **R2 Object Storage**. ⚠️ لم يُجرَّب: قد يطلب Cloudflare **بطاقة دفع لتفعيل R2 حتى للطبقة المجانية**؛ اقرئي صفحة الأسعار الحالية قبل التفعيل، وإن لم تريدي بطاقة فأخبريني لنبحث عن بديل (تخزين Supabase Storage مثلًا يحتاج تعديل كود).

### 2.4 استضافة الواجهة (ملفات ثابتة)
أنشئي حسابًا في **Netlify** (netlify.com) — الأسهل (رفع المجلد بالسحب). بدائل: Cloudflare Pages أو GitHub Pages.

### 2.5 Supabase CLI (لنشر دالة الخادم)
⚠️ لم يُجرَّب. في PowerShell:
```
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
irm get.scoop.sh | iex
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
scoop install supabase
supabase --version
```
**النجاح:** يطبع رقم إصدار. (لا تثبّتيه عبر npm داخل المشروع كي لا يتغير `package.json` ولا `npm audit`.) إن تعذّر Scoop: نزّلي ملف CLI لـWindows من صفحة الإصدارات في github.com/supabase/cli وضعيه في مجلد ضمن PATH.

## 3) المرحلة A — إصلاح ثغرات npm والتأكد أن الكود يعمل محليًا
> تُنفَّذ في مجلد المشروع `C:\athar-work\r28\athar`، ولا تحتاج حسابات.
أولًا النسخ الاحتياطي (للتراجع):
```
cd C:\athar-work\r28\athar
Copy-Item package.json package.backup.json
Copy-Item package-lock.json package-lock.backup.json
node -v
npm install --dry-run
```
**المعنى:** `--dry-run` يفحص التوافق **دون تغيير شيء**. **النجاح:** يطبع ملخصًا بلا `ERESOLVE` ولا `EBADENGINE`. **الفشل:** أرسلي المخرجات كاملة ولا تستعملي `--force` ولا `--legacy-peer-deps`.
```
npm install
npm ls vite vitest react-router-dom react-router esbuild @vitest/mocker
```
**المتوقع:** vite 6.4.5، vitest 5.0.5، react-router-dom وreact-router 7.18.5، ولا `tinypool` ولا `vite-node`.
البوابات بالترتيب (أرسلي لي نتيجة كلٍّ منها):
```
npm run typecheck
npm test
npm run build
node scripts/check-no-secrets-in-frontend.mjs
node scripts/check-dependency-policy.mjs --allow-major=react-router-dom,react-router,vite,vitest,vite-node,esbuild,tinypool,@vitest/mocker
node scripts/record-audit-batch.mjs "الدفعة 1: vitest 5.0.5 + vite 6.4.5 + react-router-dom 7.18.5"
npm audit
npm audit --omit=dev
```
**النجاح:** كل أمر ينجح و`npm audit` يعرض «found 0 vulnerabilities». **التراجع إن فشل شيء:** `Copy-Item package.backup.json package.json -Force; Copy-Item package-lock.backup.json package-lock.json -Force; npm install`.
**بعد النجاح:** أرسلي لي `package.json` و`package-lock.json` الناتجين لأبني r29 بقفلكِ الحقيقي. **لا تكملي قبل ذلك.**

## 4) تجربة الواجهة محليًا بلا خدمات (اختياري سريع)
```
npm run dev
```
افتحي الرابط الذي يطبعه (مثل `http://localhost:5173`). بلا ملف `.env.local` تعمل الواجهة بوضع **تجريبي** ببيانات وهمية: تأكدي أنها تفتح وتتنقلين بين الأقسام. أوقفيها بـ`Ctrl+C`.

## 5) مشروع Supabase التجريبي
1. supabase.com ← **New project**: Organization الذي أنشأتِه، **Name**: `athar-test`، **Database password**: ولّديها بمدير الكلمات (طويلة عشوائية) **واحفظيها** (لن نكتبها في أي ملف)، **Region**: الأقرب لكِ، الخطة Free ← **Create new project**. انتظري دقيقتين حتى تكتمل.
2. **Project Settings (الترس) ← API**: دوّني **Project URL** (`https://REF.supabase.co` — `REF` هو معرّف المشروع) و**المفتاح العام**: `anon` أو `publishable`. **لا تنسخي `service_role` ولا `secret`.** احفظيها في مدير الكلمات في بند «athar-test».
3. **Authentication**: عطّلي «Allow new users to sign up» (التسجيل الذاتي) ولا تفعّلي الدخول المجهول. ⚠️ اسم الخيار/مكانه قد يختلف.

## 6) تنفيذ ملفات SQL (الأخطر: أول تنفيذ لها)
> **على المشروع التجريبي الفارغ فقط.** الشرح الموسّع وجدول الأخطاء: `docs/SUPABASE_SETUP_AR.md`.
1. Supabase ← **SQL Editor** ← **New query**.
2. من مجلد `C:\athar-work\r28\athar\supabase\` افتحي الملف الأول بـ**Notepad** (زر أيمن ← Open with)، `Ctrl+A` ثم `Ctrl+C`، ارجعي إلى المتصفح، الصقي (`Ctrl+V`) في المحرر، اضغطي **Run**. **ملف واحد في كل استعلام جديد، بهذا الترتيب بالضبط:**

| # | الملف | معيار النجاح |
|---|---|---|
| 1 | `01_apply_all.sql` | «Success» |
| 2 | `01b_staff_accounts.sql` | «Success» |
| 3 | `02_security_check.sql` | **مربع أحمر مقصود** يبدأ بـ`RESULT: PASS=… FAIL=0` (تراجع تلقائي) |
| 4 | `03_post_check.sql` | 8 صفوف كلها PASS |
| 5 | `01c_server_additions.sql` | «Success» |
| 6 | `03b_post_check_additions.sql` | 12 صفًّا كلها PASS |

3. **إن ظهر خطأ** (متوقع أن يحدث أول مرة): انسخي **نص الخطأ كما هو** وأرسليه مع اسم الملف. **لا تعيدي الملف 1** على مشروع نصف مطبَّق: احذفي المشروع التجريبي (Settings ← General ← Delete project) وأنشئي غيره فارغًا ثم أعيدي من الملف 1 بعد أن أصلح الخطأ.

## 7) حسابات المسؤولات
1. **Authentication ← Users ← Add user ← Create new user**: بريد المالكة وكلمة مرور قوية (فعّلي **Auto Confirm User** إن وُجد). كرّري للمديرة.
2. **SQL Editor** ← استعلام جديد:
```
select public.bootstrap_staff('owner@example.com', 'owner');
select public.bootstrap_staff('director@example.com', 'director');
select user_id, role, is_active from public.staff_profiles;
```
(بدّلي البريدين ببريديهما الفعليين تمامًا.) **النجاح:** صفّان نشطان بالدورين. **الفشل «المستخدم غير موجود»:** تأكدي من تطابق البريد مع المنشأ في Users.
3. المالكة وحدها تصدر أكواد المعلمات وتنشئ الأرشيفات وتفرج عن الجلسات؛ المديرة تنزّل التسليمات وتراجع.

## 8) تخزين R2 (خاص)
⚠️ كل ما في هذه المرحلة لم يُجرَّب. تفاصيل وقائمة تجارب: `docs/phase5/R2_INTEGRATION_AR.md`.
1. Cloudflare ← **R2 Object Storage** ← **Create bucket**. الاسم: `athar-test-files` (أحرف صغيرة وأرقام وشرطة فقط). **اتركيه خاصًا: لا تفعّلي `r2.dev` ولا نطاقًا عامًا.**
2. دوّني **Account ID** (32 حرفًا سداسيًا، يظهر في صفحة R2).
3. **Manage R2 API Tokens ← Create API token**: الصلاحية **Object Read & Write**، **Specify bucket**: اختاري `athar-test-files` فقط، ثم Create. **انسخي فورًا Access Key ID وSecret Access Key** إلى مدير الكلمات (السر يظهر مرة واحدة).
4. CORS: **سنضبطه بعد معرفة رابط موقعكِ** (المرحلة 11).

## 9) أسرار دالة الخادم ونشرها
> ⚠️ أول تشغيل في Deno؛ توقعي أخطاء توافق وأرسليها لي. تفاصيل: `docs/phase5/EDGE_HOST_AR.md`.
### 9.1 توليد ثلاثة أسرار عشوائية مختلفة
نفّذي الأمر **ثلاث مرات**، واحفظي كل ناتج باسمه في مدير الكلمات (`CODE`, `PIN`, `IP`):
```
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```
### 9.2 ملف الأسرار المؤقت (خارج المشروع)
```
mkdir C:\athar-secrets
notepad C:\athar-secrets\athar-test.env
```
في Notepad اكتبي هذه الأسطر (بدّلي القيم من مدير الكلمات؛ **بلا مسافات حول `=` وبلا علامات اقتباس**):
```
R2_ACCOUNT_ID=قيمة
R2_BUCKET=athar-test-files
R2_ACCESS_KEY_ID=قيمة
R2_SECRET_ACCESS_KEY=قيمة
TEACHER_CODE_PEPPER=قيمة-CODE
TEACHER_PIN_PEPPER=قيمة-PIN
TEACHER_IP_PEPPER=قيمة-IP
```
**لا تضيفي** `ALLOWED_ORIGIN` الآن (بعد المرحلة 11) ولا أي `SUPABASE_*` (تُوفَّر تلقائيًا).
### 9.3 ربط المشروع ونشر الدالة
```
cd C:\athar-work\r28\athar
supabase login
supabase init
supabase link --project-ref REF
supabase secrets set --env-file C:\athar-secrets\athar-test.env
supabase secrets list
supabase functions deploy api --no-verify-jwt
```
**ملاحظات:** `supabase login` يفتح المتصفح للموافقة. `supabase init` إن سأل عن VS Code اختاري `n` (ينشئ `supabase\config.toml` دون مسّ ملفاتنا). `supabase link` قد يسأل كلمة مرور قاعدة البيانات: **اضغطي Enter لتخطيها** (لا نستعمل migrations). ⚠️ إن اشتكى النشر من Docker أضيفي `--use-api` للأمر. `secrets list` يعرض **أسماء** الأسرار فقط.
**فور نجاح الأسرار احذفي الملف المؤقت:** `Remove-Item C:\athar-secrets\athar-test.env` (القيم محفوظة في مدير الكلمات).
### 9.4 فحص النشر
```
curl.exe https://REF.supabase.co/functions/v1/api/health
curl.exe -i https://REF.supabase.co/functions/v1/api/teacher/me
```
**النجاح:** الأول يعيد `{"ok":true,...}`، والثاني `401` و`{"error":"unauthenticated"}`. **الفشل:** `503 not_configured` ⇒ Supabase ← **Edge Functions ← api ← Logs** يذكر **اسم** المتغير الناقص (صحّحيه بـ`supabase secrets set` ثم أعيدي النشر). أي خطأ آخر: أرسلي نص السجل.
**التراجع:** `supabase functions delete api` (لا يمسّ القاعدة ولا R2).

## 10) إعداد الواجهة وبناؤها
1. انسخي القالب: `Copy-Item env-local-template.txt .env.local` ثم `notepad .env.local` واجعليه **هكذا فقط** (ثلاثة أسطر عامة):
```
VITE_SUPABASE_URL=https://REF.supabase.co
VITE_SUPABASE_ANON_KEY=المفتاح-العام
VITE_TEACHER_API_URL=https://REF.supabase.co/functions/v1/api
```
2. البناء والفحوص:
```
npm run build
node scripts/check-no-secrets-in-frontend.mjs
node scripts/check-dist-no-mock.mjs
npm run preview
```
**النجاح:** البناء بلا أخطاء، فحص الأسرار 10/10، وفحص «لا بيانات تجريبية» ينجح، ويفتح `preview` رابطًا محليًا: سجّلي دخول المالكة (بريدها وكلمة مرورها من المرحلة 7) فتظهر لوحاتها **بلا وضع تجريبي**. أوقفيه بـ`Ctrl+C`.

## 11) استضافة الواجهة ثم ضبط الأصل المسموح وCORS
1. **Netlify** ← Add new site ← **Deploy manually** ← اسحبي **مجلد `dist`** (من `C:\athar-work\r28\athar\dist`) إلى المربع. يعطيكِ رابطًا مثل `https://xxxx.netlify.app`. افتحيه وتأكدي أن صفحة الدخول تظهر.
2. اضبطي الأصل المسموح (الرابط **بلا مسار ولا شرطة أخيرة**):
```
notepad C:\athar-secrets\athar-test.env
```
اكتبي فيه سطرًا واحدًا فقط: `ALLOWED_ORIGIN=https://xxxx.netlify.app` ثم:
```
supabase secrets set --env-file C:\athar-secrets\athar-test.env
supabase functions deploy api --no-verify-jwt
Remove-Item C:\athar-secrets\athar-test.env
```
3. **CORS في R2:** Cloudflare ← R2 ← الحاوية ← **Settings ← CORS Policy** ← Add: الأصل `https://xxxx.netlify.app`، الطرق `PUT` و`GET`، الترويسات `content-type` و`content-length`. ⚠️ صيغة JSON المقبولة قد تكون:
```
[{"AllowedOrigins":["https://xxxx.netlify.app"],"AllowedMethods":["PUT","GET"],"AllowedHeaders":["content-type","content-length"],"MaxAgeSeconds":600}]
```
4. أي تغيير لقيم `VITE_*` يتطلب **إعادة `npm run build` وإعادة رفع `dist`**.

## 12) تجارب نهاية-إلى-نهاية (في الموقع المنشور التجريبي)
أنشئي معلمة تجريبية من قسم «المعلمات والأكواد» (اسم وهمي). لكل تجربة: المتوقع؛ **أرسلي لي أي إخفاق مع لقطة ونص الخطأ.**
| # | التجربة | المتوقع |
|---|---|---|
| 1 | دخول المالكة وتصفّح اللوحات | تعمل بلا «وضع تجريبي» |
| 2 | إصدار كود ورقم سري للمعلمة التجريبية | يظهران مرة واحدة؛ يُسجَّل في «سجل العمليات» |
| 3 | دخول المعلمة بالكود (من نافذة خاصة) | تظهر بوابتها بفصولها ومواعيد **كل فصل** |
| 4 | كود خاطئ عدة مرات | رسالة موحّدة ثم قفل مؤقت |
| 5 | رفع PDF صغير لخانة | «تم حفظ الإصدار 1» (أول اختبار حقيقي لـR2) |
| 6 | رفع ملف بنوع/حجم غير مسموح أو امتداد مزيَّف | يُرفض بسبب واضح |
| 7 | استبدال الملف ضمن المهلة | إصدار 2 والإصدار 1 باقٍ |
| 8 | حفظ رابط https ثم http | https يُقبل وhttp يُرفض |
| 9 | تنزيل المعلمة ملفها | يُنزَّل باسمه الصحيح |
| 10 | تنزيل المديرة ملف المعلمة من «تفاصيل المعلمة» | يُنزَّل |
| 11 | معلمة تطلب ملف معلمة أخرى | رفض |
| 12 | المديرة تحاول إنشاء أرشيف | غير مسموح |
| 13 | المالكة تنشئ أرشيف فصل ثم «تنزيل والتحقق من البصمة» | «تطابقت بصمته» |
| 14 | تلف متعمّد (تعديل الأرشيف المنزَّل ثم مقارنة) | يُرفض (لا تطابق) |
| 15 | فصل موعده مغلق وآخر مفتوح | الرفع يُرفض في المغلق ويُقبل في المفتوح |
| 16 | «عمليات الرفع» ← إفراج عن جلسة عالقة | يُسجَّل باسم المالكة |
| 17 | إلغاء كود المعلمة | تُنهى جلساتها فورًا |
**الأخطاء المرجّحة عند أول تشغيل:** `node:*` في Deno، اتصال `postgres.js` وSSL، `set local role service_role`، دعم R2 لـ`If-None-Match`، CORS، زمن تجزئة PBKDF2 (قد يقترب من حد المعالج).

## 13) بوابة الإطلاق (☐ = لم يتحقق بعد؛ لا إطلاق قبل تحقق كل ما يلي بنتائج حقيقية)
☐ `npm audit` = 0 · ☐ `typecheck` و`npm test` و`npm run build` ناجحة · ☐ SQL كله ناجح وفحوصه PASS · ☐ تجارب 1–17 ناجحة · ☐ اختبار أمني أساسي (تجاوز الصلاحيات، رفع ملفات خبيثة/ضخمة، أسماء ملفات ملغومة) · ☐ اختبار حمل بحجم المدرسة (الأرشفة بالذاكرة ≤ 40MB) · ☐ موافقة إدارة المدرسة على التعامل مع بيانات المعلمات والاحتفاظ والخصوصية · ☐ خطة نسخ احتياطي واستعادة **مجرَّبة** · ☐ القرارات المعلّقة في `HANDOFF.md` محسومة.
**الانتقال للإنتاج:** أنشئي **مشروع Supabase جديدًا** (`athar-prod`) وحاوية R2 جديدة وأسرارًا جديدة (لا تعيدي أسرار التجربة)، وكرّري المراحل 5–11 بالترتيب، ثم أصدري الأكواد الحقيقية وسلّميها بقناة آمنة (الكود برسالة والرقم السري بأخرى)، وعطّلي حسابات التجربة.

## 14) التشغيل بعد الإطلاق
- **نسخ احتياطي:** صدّري القاعدة دوريًا؛ حمّلي الأرشيفات المتحقَّق من بصمتها وخزّني **نسخة ثانية خارج R2**.
- **مراقبة:** سجلات الدالة، «سجل العمليات»، «عمليات الرفع» (+ زر إنهاء المنقضية: التنظيف يدوي).
- **تدوير الأسرار:** عند الاشتباه؛ تغيير أسرار الخلط يُبطل أكواد المعلمات فيُعاد إصدارها.
- **تحديثات الاعتماديات:** تمرّ ببوابات المرحلة 3 و`npm audit` قبل النشر.

## 15) جدول أخطاء شائعة على Windows
| الخطأ | السبب والفعل |
|---|---|
| `Access to the compressed folder is denied` | فكّي بـ`tar -xf` في `C:\athar-work`؛ `WINDOWS_ZIP_EXTRACT_AR.md` |
| `running scripts is disabled` | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| `EBADENGINE` / `ERESOLVE` عند `npm install` | توقفي؛ أرسلي المخرجات؛ لا `--force` |
| `'supabase' is not recognized` | أعيدي فتح PowerShell بعد التثبيت أو أضيفي المسار إلى PATH |
| `curl` يطبع شيئًا غريبًا | استعملي `curl.exe` لا `curl` (اسم مستعار لأمر آخر في PowerShell) |
| الواجهة تعمل بوضع تجريبي بعد النشر | `.env.local` غير مقروء: أعيدي البناء بعد ضبطه |
| دخول المعلمة «غير متاح بعد» | `VITE_TEACHER_API_URL` غير مضبوط عند البناء |
| رفض CORS في المتصفح | الأصل في R2 أو `ALLOWED_ORIGIN` لا يطابق رابط الموقع حرفيًا |

## 16) كراسة تسجيل القيم (املئيها في مدير الكلمات لا هنا)
| البند | أين تجدينه | محفوظ؟ |
|---|---|---|
| Project REF وURL ومفتاح anon (التجريبي) | Supabase ← Settings ← API | ☐ |
| كلمة مرور قاعدة البيانات | عند إنشاء المشروع | ☐ |
| Account ID لـCloudflare | R2 | ☐ |
| Access Key ID وSecret (R2) | إنشاء Token | ☐ |
| الأسرار الثلاثة CODE/PIN/IP | المرحلة 9.1 | ☐ |
| رابط الموقع `https://….netlify.app` | Netlify | ☐ |
| بريدا وكلمتا مرور المالكة والمديرة | المرحلة 7 | ☐ |

## 17) ما لا يزال ناقصًا برمجيًا (لا يمنع التجربة)
أرشفة سنة كاملة عبر الخادم؛ تدقيق دائم لأحداث المعلمة؛ جدولة تلقائية لتنظيف الجلسات؛ تدفق (streaming) للأرشيفات الكبيرة؛ الحذف النهائي و`archive_entries`؛ تقييد معدّل لما عدا الدخول؛ مراقبة وتنبيهات؛ اختبارات نهاية-إلى-نهاية آلية.

## 18) ملفات مرجعية
`HANDOVER_AR.md` · `SUPABASE_SETUP_AR.md` · `phase5/R2_INTEGRATION_AR.md` · `phase5/EDGE_HOST_AR.md` · `phase5/NPM_FIX_EXECUTION_AR.md` · `WINDOWS_ZIP_EXTRACT_AR.md` · `RESUME_NEXT_ACCOUNT_AR.md`.
