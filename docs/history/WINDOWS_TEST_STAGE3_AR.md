# اختبار حزمة المرحلة 3 على Windows (بلا اتصال بمشروعكِ الحقيقي)

> الهدف: التحقق من أن الواجهة تُثبَّت وتُترجَم وتُبنى وأن اختباراتها تنجح. **لا حسابات، ولا `.env.local`، ولا Supabase في هذه الجولة.** أرسلي لي النتائج **كما هي** قبل أي إصلاح. لا تستعملي `npm ci` (ملف القفل غير متزامن مع التبعية الجديدة).

## 0) المتطلبات
- Node.js 20 أو أحدث (للتحقق: `node -v`). وإن لم يكن مثبتًا: nodejs.org ← LTS ثم أعيدي فتح PowerShell.
- إنترنت (لـ`npm install` فقط).

## 1) ضعي الحزمة في مجلد قصير بلا مسافات ولا حروف عربية
1. أنشئي المجلد `C:\athar-test`.
2. انسخي إليه الملف `athar-handoff-stage3-wip-v0_6_0-r9.zip`، ثم كليك يمين ← **Extract All…** إلى `C:\athar-test`.
3. النتيجة: المشروع في **`C:\athar-test\athar`** (يحوي `package.json`). تجنبي OneDrive وسطح المكتب.

## 2) افتحي PowerShell داخل المشروع
في المستكشف ادخلي `C:\athar-test\athar`، اكتبي `powershell` في شريط العنوان واضغطي Enter. ثم:
```powershell
mkdir results
node -v
npm -v
```
(إن ظهر خطأ «running scripts is disabled» عند `npm` فاستعملي `npm.cmd` بدل `npm` في كل الأوامر التالية.)

## 3) نفّذي بالترتيب (انسخي كل سطر وانتظري حتى ينتهي)
```powershell
npm install *>&1 | Out-File -Encoding utf8 results\01-install.txt
node scripts\check-stage3-static.mjs *>&1 | Out-File -Encoding utf8 results\02-static3.txt
node scripts\check-sql-static.mjs *>&1 | Out-File -Encoding utf8 results\03-sqlstatic.txt
npm run typecheck *>&1 | Out-File -Encoding utf8 results\04-typecheck.txt
npm test *>&1 | Out-File -Encoding utf8 results\05-test.txt
npm run build *>&1 | Out-File -Encoding utf8 results\06-build.txt
node scripts\check-dist-no-mock.mjs *>&1 | Out-File -Encoding utf8 results\07-distcheck.txt
```
- `npm install` قد يطول دقائق ويعرض تحذيرات (deprecated / audit)؛ هذا طبيعي ولا تحاولي إصلاحها. سيُحدّث `package-lock.json` تلقائيًا.
- **لا تتوقفي عند أول خطأ**: شغّلي الأوامر كلها حتى لو فشل بعضها (الأخطاء هي ما أحتاجه).
- وبعد الانتهاء اختياريًا: `npm run build:review *>&1 | Out-File -Encoding utf8 results\08-review.txt`

## 4) فحص بصري آمن (بلا Supabase)
```powershell
npm run dev
```
افتحي `http://localhost:5173/`. **المتوقع** (لأنكِ لم تُنشئي `.env.local`): صفحة «تسجيل الدخول» ورسالة حمراء «الاتصال بقاعدة البيانات غير مُعدّ» — وهذا هو السلوك الصحيح (لا دخول ولا بيانات وهمية). جرّبي فتح `http://localhost:5173/#/owner` ← يجب أن يعيدكِ إلى تسجيل الدخول. أوقفي الخادم بـ`Ctrl+C`. صوّري الشاشة إن أمكن.

## 5) أرسلي لي
- محتوى الملفات الثمانية في المجلد `results` **كاملةً** (انسخيها نصًا، أو أرفقيها).
- نتيجة الخطوة 4 (ما ظهر بالضبط).
- لا ترسلي أي كلمة مرور أو مفتاح، ولا محتوى `.env.local` (غير موجود أصلًا الآن).

## ما بعد النتائج
أُصلح ما تكشفه الاختبارات في الحزمة نفسها وأسلّم ZIP جديدًا (r10 …) دون حذف السابق. وأجرّب الدخول الحقيقي لاحقًا فقط بعد تحديدنا ما هو موجود في مشروعكِ وبموافقتكِ الصريحة (لا إنشاء حسابات ولا `bootstrap_staff` الآن).

## ما لا يمكن إثباته إلا على Supabase الحقيقي (مؤجَّل)
رفض بريد غير مسجَّل فعليًا، ودخول المسؤولة بكلمة المرور وحدها بجلسة حقيقية (بعد إلغاء TOTP، A-98)، وقراءة RLS بجلسة حقيقية، وصلاحية المديرة مقابل المالكة. تُسجَّل نتائجها الفعلية في المرحلة 3 قبل إعلان اكتمالها.
