# تجربة التصميم الجديد على جهازكِ (Windows) — بلا أي خدمة حقيقية

> لا تحتاجين Supabase ولا حسابات ولا `.env.local` ولا مفاتيح. ستشاهدين الشاشات ببيانات توضيحية في ملف واحد.

## قبل البدء (مرة واحدة)
1. ثبّتي **Node.js 20 أو أحدث** (LTS) من nodejs.org ثم أعيدي فتح PowerShell. للتحقق اكتبي `node -v`.
2. فكّي الملف `athar-handoff-stage3-wip-redesign-v0_6_4-r13.zip` (كليك يمين ← Extract All) في مجلد قصير مثل `C:\athar-test` بلا مسافات ولا حروف عربية، وتجنبي OneDrive وسطح المكتب. ستجدين المشروع في `C:\athar-test\athar`.

## الطريقة 1: ملف المعاينة الواحد (الأسهل)
1. في المستكشف ادخلي `C:\athar-test\athar`، واكتبي `powershell` في شريط العنوان ثم Enter.
2. شغّلي (يحتاج إنترنت، وقد يستغرق دقائق، والتحذيرات طبيعية):
   ```powershell
   npm install
   npm run build:review
   ```
   (إن ظهر «running scripts is disabled» فاستعملي `npm.cmd` بدل `npm`.)
3. افتحي بالنقر المزدوج الملف `review\athar-ui-review.html`. سيظهر شريط «عرض الواجهات» للتنقل بين شاشات المالكة والمديرة والمعلمة. بعد اختيار المالكة أو المديرة ستظهر الصفحة الرئيسية بالبطاقات (0.6.3)؛ لوحة المتابعة في `#/owner/overview`.
4. جرّبي: عرض الهاتف (اضغطي F12 ثم رمز الجوال)، وحالات التحميل والخطأ والفراغ من شريط المعاينة.
> إن فشل `build:review` عند فحص الأنواع فأرسلي لي النص كاملًا ولا تحاولي الإصلاح؛ هذا بالضبط ما لم أستطع فحصه.

## الطريقة 2: خادم التطوير (شاشة الدخول الحقيقية بلا اتصال)
```powershell
npm run dev
```
افتحي `http://localhost:5173/`. **المتوقع:** شاشة الدخول بالتصميم الجديد مع رسالة «الاتصال بقاعدة البيانات غير مُعدّ». هذا السلوك الصحيح (لا دخول ولا بيانات وهمية). أوقفي الخادم بـ`Ctrl+C`.

## فحوص اختيارية لإرسال نتائجها
```powershell
mkdir results
npm run typecheck *>&1 | Out-File -Encoding utf8 results\04-typecheck.txt
npm test *>&1 | Out-File -Encoding utf8 results\05-test.txt
npm run build *>&1 | Out-File -Encoding utf8 results\06-build.txt
node scripts\check-dist-no-mock.mjs *>&1 | Out-File -Encoding utf8 results\07-distcheck.txt
```
أرسلي المحتوى كما هو. **لا ترسلي كلمة مرور ولا مفتاحًا.**
