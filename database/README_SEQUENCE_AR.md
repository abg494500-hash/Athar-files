# ملفات SQL: التسلسل والاعتماد والجرد مقابل الكود (r21)

> **تحديث r36:** الملفات الفعلية 001–011 (009 أجزاء الأرشيف، 010 التصفير السنوي، 011 السنوات واستيراد المعلمين). الجرد أدناه تاريخي حتى 008؛ الترتيب المعتمد للتشغيل على Supabase هو ترتيب ملفات `supabase/` في START_HERE_AR.md: 01 ← 01b ← 02 ← 03 ← 01c ← 03b ← 01d ← 03c ← 01e ← 03d ← 01f ← 03e ← 01g ← 03f. اختُبرت كلها على PostgreSQL محلي فقط.

> (النص التالي قديم) كلها **غير مُشغَّلة على Supabase الحقيقي**. الفحوص الساكنة: `node scripts/check-sql-static.mjs` (39) و`check-stage3-static.mjs` (30) و`check-sql-additions-static.mjs` (28) و`check-code-sql-compat.mjs` (توافق عبارات الخادم مع المخطط).

| الملف | يعتمد على | المحتوى | ملاحظة |
|---|---|---|---|
| 001_schema | — | 15 جدولًا: staff_profiles, app_settings, years, terms, teachers, teacher_credentials, slots, submissions, archives, versions, archive_entries, upload_sessions, login_attempts, deletion_requests, audit_log | مشروع فارغ |
| 002_integrity | 001 | مشغّلات منع الحذف والتعديل، سلسلة التدقيق `log_audit`/`verify_audit_chain`، حارس الإصدارات والمواعيد | |
| 003_rls | 001, 002 | RLS وصلاحيات الأدوار | |
| 004_upload_tables | 001–003 | جدول upload_attempts، وتوسيع upload_sessions وversions (أعمدة وقيود الإفراج والإلغاء)، وحراس الجلسات | يرفض التنفيذ فوق بيانات |
| 005_staff_accounts | 001–003 | `bootstrap_staff`، حارس staff_profiles، `current_staff_role` بلا TOTP | |
| **006_teacher_sessions** | 001 | `teacher_sessions` + فهرس فريد لبصمة الكود | جديد؛ RLS بلا policies |
| **008_teacher_removal** | 001, 006 | عمود `teachers.removed_at` + `remove_teacher` (محجوزة لـservice_role) | جديد؛ حذف = محو الاسم بعد أرشفة موثَّقة |
| **007_server_additions** | 001, 002 | `log_audit_as`، حارس `archives`، فهرس `versions(teacher_id, term_id)` | جديد؛ بلا جداول |

## ما تحتاجه كل خدمة من القاعدة (وهل هو موجود؟)
| الخدمة / الوظيفة | الجداول والأعمدة | موجود في |
|---|---|---|
| دخول المعلمة (`PgAuthStore`) | teachers, teacher_credentials(code_hash…), login_attempts, **teacher_sessions** | 001 + **006** |
| الرفع/الإتمام/الإلغاء/الرابط (`UploadService`) | upload_sessions, upload_attempts, versions, submissions, app_settings, terms | 001–004 |
| إفراج المالكة + **أثر المنفِّذة** | upload_sessions(release_note, platform_fault), upload_attempts, **audit_log عبر log_audit_as** | 004 + **007** |
| النظرة العامة (`overview`) | upload_sessions, versions, terms | 001, 004 |
| قراءة المعلمة (`TeacherReadService`) | teachers, years, terms(deadline_*), slots, versions | 001 + **فهرس 007** |
| الروابط الموقّعة (`TransferService`) | upload_sessions(pending_key, declared_size, state, expires_at), versions(storage_key, storage_state, original_name, ext) | 001, 004 |
| الأرشفة (`ArchiveService`, `PgArchiveSource`) | archives(كل الأعمدة)، terms, versions(original_name…) | 001 + **حارس 007** |
| تأكيد بصمة التنزيل | archives(download_completed_at, download_hash_verified_at), audit_log | 001 + **007** |
| تدقيق المسؤولات (`PgAuditSink`) | audit_log عبر `log_audit_as` | **007** |
| `StaffVerifier` | staff_profiles | 001, 005 |

## قرارات اتُّخذت (للمراجعة)
1. أثر المنفِّذة: دالة `log_audit_as` على `audit_log` الموجود (لا جدول ثانٍ)، وفي **نفس معاملة** إفراج الجلسة.
2. الاسم الأصلي للملف: في بيان الأرشيف `manifest.csv` (عمود `original_name` الأخير)؛ المسارات داخل الأرشيف معرّفات: `<teacher_id>/<slot_id>/v<no>.<ext>`.
3. `archive_entries` و`versions.archive_id`: غير مملوءة (تخص الحذف النهائي غير المبني).
4. حارس الأرشيف في القاعدة (لا يكفي حارس الخدمة وحده).
