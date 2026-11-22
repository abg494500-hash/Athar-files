# فكّ أرشيف ZIP على Windows عند ظهور «Access to the compressed (zipped) folder is denied»

> ظهر هذا الخطأ عندكِ عند فكّ r25 (من لقطات الشاشة). **فحصتُ الأرشيف نفسه** (441 مدخلًا): لا محارف ممنوعة في الأسماء، لا أسماء محجوزة، لا تصادم أحرف كبيرة/صغيرة، لا أسماء عربية، أطول مسار 76 محرفًا، ولا ZIP64، وبنيته مطابقة لـr24 الذي فككتِه بنجاح. **فالسبب بيئي على الأرجح لا في الأرشيف**، لكن لا أستطيع تأكيده من هنا. جرّبي بالترتيب (الأرجح أولًا):

1. **انقلي الملف أولًا إلى مسار قصير خارج المجلدات المحمية:** `C:\athar-work\` (أنشئيه)، ثم فكّي إلى `C:\athar-work\r26`. الخطأ شائع عند الفك داخل Downloads/Documents/Desktop المحمية بـ«Controlled folder access» (Windows Security) أو داخل OneDrive، أو فوق مجلد فيه ملفات مقفلة (مثل `node_modules` وفتح VS Code أو `npm run dev` عليه). **لا تفكّي فوق مجلد عملكِ الحالي**.
2. **رفع الحجب (Mark of the Web):** بزر الفأرة الأيمن على ملف ZIP ← Properties ← إن ظهر مربع **Unblock** فعلّميه ثم Apply. أو في PowerShell: `Unblock-File "C:\athar-work\athar-handoff-r26-v0_6_17.zip"`.
3. **تحقّقي أن الملف لم يتلف بالنقل** (واتساب قد يقطع الملفات الكبيرة): `Get-FileHash "C:\athar-work\athar-handoff-r26-v0_6_17.zip" -Algorithm SHA256` وقارنيها بالبصمة في ملف `CHECKSUMS_R26.txt` المرفق منفصلًا عن الأرشيف. إن اختلفت أعيدي التنزيل.
4. **فكّ بأداة غير Explorer** (تتجاوز معالج Windows): في PowerShell
   `cd C:\athar-work` ثم `tar -xf .\athar-handoff-r26-v0_6_17.zip -C .\r26` (أنشئي `r26` قبلها)، أو `Expand-Archive -Path .\athar-handoff-r26-v0_6_17.zip -DestinationPath .\r26`، أو 7-Zip (Extract to "r26\").
5. إن بقي الخطأ: **لا تحتاجين فك الأرشيف أصلًا لهذه المهمة** — استعملي الملف المستقل `collect-audit-evidence.standalone.mjs` (ملف واحد صغير) داخل مجلد عملكِ الحالي، كما في `WINDOWS_BATCH_R26_AR.md`.
6. حزمة **المصدر فقط** (`...-source-only.zip`، نحو 5 ميغابايت بلا الأرشيف المتداخل) أخف بكثير وأقل عرضة لمشاكل الفك، وكافية لمتابعة العمل.
