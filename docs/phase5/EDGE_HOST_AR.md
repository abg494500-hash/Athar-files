# مضيف الخادم: دالة Edge في Supabase (r22 / 0.6.13)

> **الحالة بصدق:** كل ما هنا **كُتب واختُبر في Node فقط** (محوّل القاعدة ببديل، المضيف بطلبات `Request` حقيقية، والنسخة المولَّدة تُحمَّل وتعمل في Node). **لم يُشغَّل شيء في Deno ولا على Supabase ولا مع PostgreSQL ولا R2.** النشر لم يتم، ويحتاج موافقتكِ الصريحة وخطواتكِ أنتِ.

## 1) القرارات المعمارية (وما لا يُحسم من الكود وحده)
| القرار | ما اخترتُه | لماذا / المخاطر |
|---|---|---|
| المنصة | **دالة Edge في Supabase (Deno)** واسمها `api` | الخيار الأقرب لمشروعكِ (نفس المنصة، أسرار مدارة، لا خادم تُديرينه). **متوافقة فعلًا مع الكود الحالي بعد ثلاثة تعديلات أنجزتُها:** (1) خطوة بناء تضيف `.ts` للاستيراد النسبي (Deno يشترطه)، (2) `crc32` محلي بدل `node:zlib.crc32` (غير مضمون في Deno)، (3) `import { Buffer } from 'node:buffer'` صريح (لا Buffer عام في Deno). ما يبقى من واجهات Node: `node:crypto` و`node:buffer` و`node:util` (مدعومة في Deno؛ **لم تُجرَّب هنا**). بديل لو ظهر عائق: Cloudflare Worker (يلزم تعديل المحوّل). |
| اتصال القاعدة | `postgres.js` (`npm:postgres@3.4.5`) عبر `SUPABASE_DB_URL` (مباشر) | لا اتصال من المتصفح إطلاقًا. المباشر يناسب الحمل القليل؛ للحمل الأعلى اضبطي `ATHAR_DB_URL` على المجمّع (Transaction pooler) — المحوّل `prepare:false` متوافق معه. SSL إلزامي (`require` بلا تحقق شهادة؛ `ATHAR_DB_SSL=disable` للتطوير المحلي فقط). |
| تمثيل الصفوف وربط المعاملات | **مطابق لـPsqlDb الذي اختُبرت عليه الخدمات**: تغليف `jsonb_agg(to_jsonb(row))` وربط literal مُهرَّب | تفادي فروق التواريخ/الأرقام وأخطاء «could not determine data type of parameter $n» (INSERT…SELECT $n). **المقابل:** لا بروتوكول موسَّع؛ الأمان يعتمد على التهريب (مُختبَر) وعلى `standard_conforming_strings` المفعّل افتراضيًا. |
| دور القاعدة | كل معاملة تبدأ بـ`set local role service_role` | تسري عليها صلاحيات الدور كما اختُبرت لا صلاحيات مالك القاعدة. **غير محسوم:** هل يسمح Supabase لدور `postgres` بالتبديل إلى `service_role`؟ (متوقع نعم؛ إن لم يكن، ستفشل كل معاملة بـ42501 برسالة واضحة. التجاوز `ATHAR_DB_ROLE` بعد مراجعة لأنه يرفع الصلاحيات.) |
| فحص JWT في البوابة | **`verify_jwt = false`** | رمز المعلمة ليس JWT من Supabase. **ثمن ذلك:** الدالة مكشوفة للإنترنت؛ الحماية في الكود (رمز جلسة أو JWT مسؤولة + دور في كل مسار، تدقيق قبل الإجراء، قفل محاولات الدخول بالحساب والعنوان). لا حماية DDoS إضافية غير ما توفره Supabase (فكّري بـCloudflare أمامها لاحقًا). |
| عنوان العميل | `cf-connecting-ip` فقط | لا يُؤخذ من `x-forwarded-for` (قابل للتزييف). **غير مؤكد** أن بنية Supabase تضع هذه الترويسة؛ إن غابت يتعطل التقييد بالعنوان ويبقى التقييد بالحساب. |
| الذاكرة | حد كائن 30MB (`MAX_OBJECT_BYTES`)، وسقف 40MB لمجموع ملفات الأرشيف | الكائن يُقرأ كاملًا في الذاكرة عند الإتمام، والأرشيف يُبنى في الذاكرة (×3). حدود الدالة تتغير بخطتكِ؛ راجعيها وعدّلي. أرشفة ما فوق ذلك تحتاج تدفقًا (غير مبني). |
| PBKDF2 | عدد التكرارات الافتراضي في `teacherCrypto` | قد يقترب من حد المعالج للطلب الواحد؛ **قِيسي زمن الدخول فعليًا** بعد النشر. |

## 2) ما بُني
- `server/db/postgresDb.ts` — محوّل `Db` (مُختبَر ببديل postgres.js: الدور، الربط، الأخطاء).
- `server/host/edge.ts` — مضيف `Request`↔`Response` (حد جسم 16KB بالبث، `/health`، 503 عند إعداد ناقص، 500 عامة).
- `supabase/functions/api/index.ts` + `deno.json` — نقطة دخول Deno (تحقن الأسرار والقاعدة وتستدعي `Deno.serve`).
- `scripts/build-edge-function.mjs` → `supabase/functions/_shared/athar/**` (مولَّد؛ `--check` يضمن تطابقه مع المصدر ويرفض أي اعتماد خارج `node:crypto/buffer/util` أو واجهات المتصفح).
- `scripts/check-no-secrets-in-frontend.mjs` — لا أسرار خادم/مفاتيح/JWT/سلاسل اتصال في `src/` ولا `dist/` ولا الدالة، ولا استيراد من `server/`، وقائمة بيضاء لمتغيرات `VITE_`.

## 3) الأسرار (أسماء فقط؛ القيم تضعينها أنتِ ولا تدخل الحزمة ولا Git)
| يوفّرها Supabase تلقائيًا للدالة | تضبطينها بـ`supabase secrets set` | اختيارية |
|---|---|---|
| `SUPABASE_URL`، `SUPABASE_ANON_KEY`، `SUPABASE_DB_URL` | `R2_ACCOUNT_ID`، `R2_BUCKET`، `R2_ACCESS_KEY_ID`، `R2_SECRET_ACCESS_KEY`، `TEACHER_CODE_PEPPER`، `TEACHER_PIN_PEPPER`، `TEACHER_IP_PEPPER` (كلٌّ ≥ 32 محرفًا عشوائيًا ومختلف)، `ALLOWED_ORIGIN` (أصل موقعكِ بـhttps بلا مسار) | `MAX_OBJECT_BYTES`، `ATHAR_DB_URL`، `ATHAR_DB_SSL`، `ATHAR_DB_ROLE` |
- **لا تُستعمل `SUPABASE_SERVICE_ROLE_KEY` في الكود إطلاقًا** (الدور في القاعدة لا المفتاح). لا تضعيها في أي ملف.
- مفتاح R2: صلاحية Object Read & Write على الحاوية الخاصة فقط.
- **الواجهة** لا ترى إلا `VITE_SUPABASE_URL` و`VITE_SUPABASE_ANON_KEY` و`VITE_TEACHER_API_URL` (عنوان الدالة). مولّد الأسرار: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` (مرة لكل سر).

## 4) خطوات النشر (بيدكِ، **بعد** نجاح SQL ومجرّب R2 وبموافقتكِ)
> لم تُجرَّب هذه الأوامر. أرسلي لي ناتج كل خطوة.
1. ثبّتي Supabase CLI وسجّلي الدخول واربطي المشروع التجريبي: `supabase link --project-ref <معرّف مشروعكِ>`.
2. انسخي `supabase/config.toml.example` (قسم `[functions.api] verify_jwt = false`) إلى `supabase/config.toml` الذي ينشئه `supabase init`، أو انشري بـ`--no-verify-jwt`.
3. الأسرار: `supabase secrets set R2_ACCOUNT_ID=... R2_BUCKET=... ` (كل الأسماء أعلاه، قيمها من مدير كلمات المرور).
4. النشر: `supabase functions deploy api --no-verify-jwt`.
5. تحقق: `curl https://<ref>.supabase.co/functions/v1/api/health` ⇒ `{"ok":true,...}`. إن كان `503 not_configured` فسجلات الدالة (Dashboard ← Edge Functions ← api ← Logs) تذكر **اسم** المتغير الناقص.
6. اختبار دخان بلا أسرار: `GET .../api/teacher/me` ⇒ 401 `unauthenticated`؛ `POST .../api/owner/archives/create` بلا رمز ⇒ 401.
7. إنشاء حسابات المسؤولين (انظر `docs/SUPABASE_SETUP_AR.md` الخطوة 8) ثم تسجيل دخول المالكة في الواجهة بعد ضبط `VITE_TEACHER_API_URL=https://<ref>.supabase.co/functions/v1/api` وإعادة بناء الواجهة.
8. من «المعلمات والأكواد» أصدري كودًا لمعلمة تجريبية ← سجّلي دخولها ← ارفعي ملفًا صغيرًا ← نزّليه ← أنشئي أرشيفًا ← نزّليه وتحققي من البصمة. **كل خطوة هنا أول تجربة لها.**

## 5) تراجع (Rollback)
حذف الدالة (`supabase functions delete api`) يعيد الواجهة إلى «غير متاح» لكل ما يخص المعلمات والأرشيف دون لمس القاعدة أو R2. ملفات R2 والسجلات لا تُحذف تلقائيًا بأي مسار.

## 6) ما لم يُختبر وقد يفشل عند أول تشغيل (للتوقّع)
تحميل `node:*` في Deno؛ توافق `npm:postgres` مع `SUPABASE_DB_URL` وSSL؛ `set local role service_role`؛ زمن PBKDF2؛ ترويسة `cf-connecting-ip`؛ دعم R2 لـ`If-None-Match: *` وتوقيع `content-length` في الروابط؛ CORS للـPUT/GET؛ حدود الذاكرة. كلها في قائمة التجارب.
