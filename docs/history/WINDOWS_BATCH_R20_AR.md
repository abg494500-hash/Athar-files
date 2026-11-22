# تشغيل اختبارات الدفعة r20 على Windows (خطوة واحدة في كل مرة)

> لم يُجرَّب هذا الدليل على Windows بعد. أرسلي لي ناتج كل خطوة كما يظهر، نجح أو فشل. **لا تنفّذي SQL على Supabase، ولا تُدخلي مفاتيح R2 أو Supabase في أي خطوة، ولا تضعي `VITE_TEACHER_API_URL` الآن.**

1. فكّي ضغط `athar-handoff-r20-v0_6_11.zip` وافتحي PowerShell داخل المجلد `athar`.
2. `node -v` (المطلوب 22 أو أحدث) وأرسلي الناتج.
3. `npm install` (وليس `npm ci`) وأرسلي آخر 15 سطرًا.
4. **`npm run typecheck` وأرسلي الناتج كاملًا.** هذا أهم خطوة: صفحات React الجديدة (`Login.tsx`، `TeacherPortalContext.tsx`، `Portal.tsx`، `App.tsx`) لم تُجمَّع قط، فتوقعي أخطاء وأرسليها لأصلحها.
5. `npm test` وأرسلي سطر الخلاصة. الملفات الجديدة: `src/test/teacherPortal.test.tsx` (لم يُشغَّل قط)، `src/test/teacherAuthClient.test.ts`، و`server/test/{sigv4r2,teacherRead,archiveService,compose}.test.ts`. اختبارات القاعدة ستمرّ بنائب (لا PostgreSQL محلي).
6. `npm run build` وأرسلي النتيجة، ثم `node scripts/check-dist-no-mock.mjs`.
7. (اختياري، Node 22+ و`sh` مثل Git Bash) المشغّل البديل: `sh scripts/node-test-runner/run.sh` — المتوقع 318/318.
8. (اختياري لاحقًا) PostgreSQL محلي فقط لاختبارات القاعدة: `docs/phase5/WINDOWS_RUN_GUIDE.md`. **قاعدة محلية مؤقتة، لا Supabase.**
9. لا تجربة R2 قبل قراءة `docs/phase5/R2_INTEGRATION_AR.md` وموافقتكِ على ضبط الحاوية وCORS.
