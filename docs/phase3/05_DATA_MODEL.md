# نموذج البيانات النصي (بلا SQL)

> **تحديث 2026-10-19:** كُتب هذا الملف قبل قرارات «المجاني أولًا» (A-37…A-39). ما يخالفها فيه (الاشتراك في Pro، حجم 100 MiB كحد ثابت، افتراض R2) **ملغى أو معلّق**؛ المرجع الأحدث: `09_FREE_FIRST_AND_STORAGE_ADDENDUM.md` و`DECISIONS_LOG.md`.

> وصف **نصي** للكيانات وعلاقاتها. ليس مخططًا نهائيًا ولا أمر إنشاء. الأسماء أسماء مفهومية، تُترجم لاحقًا بعد الموافقة. الجداول التي يتوقف شكلها على قرار مفتوح موسومة بـ«يتبع DP-xx».
> ما يوافق نموذج الواجهة الحالي (`src/data/types.ts`) موسوم ✔، وما يزيد عليه موسوم ＋.

## الكيانات

### 1) السنوات `years` ✔
`id`، `label` (مثل 2026–2027)، `is_active` (واحدة فقط نشطة)، `created_at`.

### 2) الفصول `terms` ✔
`id`، `year_id`، `name`، `ord` (1 أو 2)،
`deadline_base`، `deadline_late`، `deadline_replace` — **تواريخ (يوم)**، تُفسَّر كنهاية اليوم بتوقيت عُمان (UTC+4) (C-10). قيد: base ≤ late ≤ replace (C-11).

### 3) المعلمات `teachers` ✔
`id`، `name`، `subject`، `is_active`، `color_idx`، `created_at`، `created_by`.
＋ `code_hash` (بصمة الكود لا الكود)، `code_issued_at`، `code_state` (نشط/ملغى)، `code_expires_at`، `pin_hash` (إن اعتُمد)، `failed_attempts`، `locked_until`.
**لا تُخزَّن أكواد نصية أبدًا**؛ الكود يُعرض للمالكة مرة واحدة عند الإصدار فقط (يتبع DP-01).

### 4) تعريف الخانات `slots` ✔
ثابتة في الإصدار الأول: خانتان (الأساسي مطلوب، الداعم اختياري) (C-12). إن احتيج تغييرها لاحقًا يتحول إلى جدول.

### 5) التسليمات `submissions` ✔
مفتاح مركّب: (`teacher_id`، `term_id`، `slot_id`). يحتفظ بمرجع الإصدار الحالي إن لزم. **الحالة لا تُخزَّن هنا**؛ تُشتق من الإصدارات (C-08/09).

### 6) الإصدارات `versions` ✔
`id`، `teacher_id`، `term_id`، `slot_id`، `no` (تسلسل)، `kind` (ملف/رابط)،
للملف: `original_name`، `size_bytes`، `mime_verified`، `ext`، `storage_provider`، `storage_bucket`، `storage_key`، `sha256`.
للرابط: `url` (https فقط).
＋ `submitted_at` (UTC)، `status_snapshot` (لم يُسلَّم/في الوقت/متأخر) **تُثبَّت لحظة الاعتماد ولا تُحدَّث**،
＋ `deadlines_snapshot` (المواعيد وقت التسليم، لتفسير الحالة لاحقًا)،
＋ `storage_state` (موجود / محذوف-مؤرشف + `archive_id`)،
＋ `replaced_note`، ＋ `validated_at`، ＋ `validation_result`.
**لا تُحذف السجلات**؛ الحذف النهائي يغيّر `storage_state` فقط (C-17).

### 7) جلسات الرفع `upload_sessions` ＋
`id`، `teacher_id`، `term_id`، `slot_id`، `declared_name`، `declared_size`، `declared_type`، `pending_key`، `r2_upload_id`، `state` (بدأ/مرفوع/قيد الفحص/مقبول/مرفوض/منتهي)، `reject_reason`، `started_at`، `expires_at`. (يتبع DP-03.)

### 8) جلسات الدخول `sessions` ＋
`id`، `subject_type` (معلمة)، `subject_id`، `token_hash`، `created_at`، `expires_at`، `revoked_at`، `last_seen_at`، `ip_hash`. (يتبع DP-02؛ المالكة والمديرة جلساتهما في Supabase Auth.)

### 9) محاولات الدخول `login_attempts` ＋
`id`، `at`، `teacher_id` (إن عُرف)، `ip_hash`، `result` (نجاح/كود خاطئ/مقفل/…)، دون تسجيل الكود المُدخَل. يُحتفظ بها مدة محددة (سياسة احتفاظ، OQ-07).

### 10) الأرشيفات `archives` ✔
`id`، `title`، `year_id`، `term_id?`، `teacher_id?`، `created_by`، `created_at`، `state` (جارٍ/بانتظار التحقق/موثَّق/فشل)، `size_bytes`، `entries_count`، `sha256`،
＋ `storage_key`، ＋ `manifest_sha256`، ＋ `checks` (نتائج فحوص: عدّ، بصمات، فتح)،
＋ `download_completed_at`، ＋ `download_hash_ack` (يتبع DP-05)،
＋ `backup_ack_by`، `backup_ack_at`، `backup_ack_note` (إقرار بشري، غير مُتحقَّق) ،
＋ `deleted_at` (حذف الأرشيف نفسه إن سُمح).

### 11) عناصر الأرشيف `archive_entries` ＋
`archive_id`، `version_id`، `path_in_zip`، `sha256`، `size`. تسمح بمقارنة محتوى الأرشيف بالإصدارات.

### 12) طلبات الحذف النهائي `deletion_requests` ＋
`id`، `requested_by`، `scope` (سنة/فصل/معلمة)، `archive_id`، `conditions_snapshot` (تحقق الشروط لحظة الطلب)، `typed_confirmation_ok`، `state`، `executed_at`، `result`.

### 13) سجل العمليات `audit_log` ✔
`id` (تسلسلي)، `at`، `actor_role`، `actor_id`، `action`، `target_type`، `target_id`، `detail` (دون أسرار)،
＋ `prev_hash`، `entry_hash` (سلسلة بصمات، يتبع DP-10).
**صلاحيات:** الإضافة فقط من Worker؛ لا تعديل ولا حذف من التطبيق.

### 14) المسؤولون `staff_profiles` ＋
ربط مستخدمي Supabase Auth (المالكة، المديرة) بدورهم: `user_id`، `role`، `is_active`. حساب واحد لكل دور (حسب المتطلبات).

### 15) سجل الموافقات والمعالجة `privacy_records` ＋ (يتبع OQ-القانونية)
إن اتُّفق على الحاجة: موافقات (من، ماذا، متى، ولي أمر؟)، سجل أنشطة المعالجة، سجل الحوادث والإبلاغ (72 ساعة). **لا أبني شيئًا هنا قبل جواب قانوني**.

## العلاقات (مختصرة)
```
years 1─* terms 1─* submissions *─1 teachers
submissions 1─* versions
versions *─* archives  (عبر archive_entries)
teachers 1─* sessions / login_attempts / upload_sessions
archives 1─* deletion_requests
audit_log ← يُكتب من كل العمليات
```

## قواعد سلامة البيانات (تُنفَّذ خادميًا ثم تدعمها القاعدة)
1. حالة الإصدار تُثبَّت مرة واحدة وتتجاوز تغيّر المواعيد.
2. سنة نشطة واحدة.
3. قيد ترتيب المواعيد.
4. أقصى حجم للملف **إعداد قابل للضبط** (A-39؛ المقترح المؤقت 50 MB)، وأنواع مسموحة فقط.
5. لا تعديل ولا حذف في `versions` و`audit_log` من واجهات المعلمات.
6. لا حذف نهائي بلا طلب مستوفٍ الشروط.
7. الطوابع الزمنية كلها UTC، والعرض بتوقيت عُمان.

## مصفوفة الوصول (نظرية، تُترجم إلى RLS + فحوص Worker لاحقًا)
| الكيان | المعلمة (عبر Worker فقط) | المديرة | المالكة |
|---|---|---|---|
| teachers | صفها فقط (بلا الكود) | قراءة | كامل |
| versions | صفوفها | قراءة | قراءة |
| terms (مواعيد) | قراءة | تعديل ضمن صلاحيات (C-07 ❓) | كامل |
| archives | ✗ | ✗ تنزيل كامل | كامل |
| audit_log | ✗ | ✗ (محسوم A-46: المالكة فقط) | قراءة |
| deletion_requests | ✗ | ✗ | كامل |

### إعدادات النظام `app_settings` ＋ (A-39)
`max_file_bytes`، `allowed_types`، `max_versions_per_slot` (يتبع قرارك)، `upload_window_minutes` (مقترح ساعتان، غير نهائي). تُقرأ من الخادم وتظهر للمعلمات في الواجهة.
