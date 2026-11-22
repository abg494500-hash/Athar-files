# تشغيل اختبارات الدفعة r19 على Windows (خطوة واحدة في كل مرة)

> لم يُجرَّب هذا الدليل على Windows بعد. أرسلي لي ناتج كل خطوة كما يظهر، نجح أو فشل. **لا تنفّذي SQL على Supabase ولا تُدخلي مفاتيح حقيقية في أي خطوة.**

1. فكّي ضغط `athar-handoff-r19-v0_6_10.zip` وافتحي PowerShell داخل المجلد `athar`.
2. `node -v` (المطلوب 22 أو أحدث) وأرسلي الناتج.
3. `npm install` (وليس `npm ci`) وأرسلي آخر 15 سطرًا.
4. `npm run typecheck` وأرسلي الناتج كاملًا (أول تشغيل حقيقي له منذ r13).
5. `npm test` وأرسلي سطر الخلاصة. الملفات الجديدة: `server/test/api.test.ts` و`server/test/archiveBuilder.test.ts` و`src/test/teacherAuthClient.test.ts`.
6. `npm run build` وأرسلي النتيجة.
7. (اختياري، Node 22+) المشغّل البديل: `sh scripts/node-test-runner/run.sh` (يحتاج `sh`، مثل Git Bash). المتوقع 266/266.
8. (اختياري، يحتاج PostgreSQL محليًا) ثبّتي PostgreSQL 15+ محليًا ثم اتبعي `docs/phase5/WINDOWS_RUN_GUIDE.md` وعيّني `ATHAR_TEST_PG` ليعمل `pgAuthStore` و`releaseOverview` و`uploadService` على قاعدة حقيقية محلية (أول تشغيل لها). **قاعدة محلية مؤقتة فقط، لا Supabase.**
