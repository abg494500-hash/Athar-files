-- ============================================================================
-- أثَر — المرحلة 4.1 — الملف 1/3: المخطط (PostgreSQL / Supabase)
-- ----------------------------------------------------------------------------
-- حالة هذا الملف: ملف محلي **غير منفَّذ وغير مجرَّب على أي قاعدة بيانات**.
-- لا يُنفَّذ على أي خدمة قبل موافقة صريحة مستقلة (A-40، القاعدة 4).
-- لا يحوي بيانات حقيقية ولا أسرارًا. القيم المؤقتة موسومة «مؤقت» وهي إعدادات.
-- يفترض وجود مخطط auth الخاص بـ Supabase (auth.users وauth.uid()).
-- الأساس: docs/phase3/05_DATA_MODEL.md، القرارات A-29…A-46.
-- ============================================================================

begin;

-- 14) المسؤولون: ربط مستخدمي Supabase Auth بدورهم (A-30). حساب نشط واحد لكل دور.
create table public.staff_profiles (
  user_id    uuid primary key references auth.users (id) on delete restrict,
  role       text not null check (role in ('owner', 'director')),
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index staff_profiles_one_active_per_role
  on public.staff_profiles (role) where is_active;

-- إعدادات النظام (A-39): صف واحد. لا حدود ثابتة في الكود؛ القيم تُقرأ من هنا.
create table public.app_settings (
  id                               boolean primary key default true check (id),
  max_file_bytes                   bigint  not null check (max_file_bytes > 0),
  allowed_types                    text[]  not null,
  max_versions_per_slot            integer check (max_versions_per_slot is null or max_versions_per_slot >= 1),
  upload_window_minutes            integer not null check (upload_window_minutes > 0),
  login_max_failed_attempts        integer not null check (login_max_failed_attempts > 0),
  login_lock_minutes               integer not null check (login_lock_minutes > 0),
  login_attempts_retention_days    integer not null check (login_attempts_retention_days > 0),
  deadline_change_reason_required  boolean not null default true,
  updated_at                       timestamptz not null default now(),
  updated_by                       uuid references auth.users (id)
);

-- 1) السنوات
create table public.years (
  id         uuid primary key default gen_random_uuid(),
  label      text not null unique,
  is_active  boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index years_one_active on public.years (is_active) where is_active;

-- 2) الفصول: ثلاثة مواعيد تواريخ (نهاية اليوم بتوقيت عُمان تُفسَّر في طبقة التطبيق، C-10)
create table public.terms (
  id                uuid primary key default gen_random_uuid(),
  year_id           uuid not null references public.years (id) on delete restrict,
  name              text not null,
  ord               smallint not null check (ord in (1, 2)),
  deadline_base     date not null,
  deadline_late     date not null,
  deadline_replace  date not null,
  created_at        timestamptz not null default now(),
  unique (year_id, ord),
  -- قيد ترتيب المواعيد (افتراض C-11 المعمول به في الواجهة؛ يُعدَّل هنا إن تغيّر القرار)
  constraint terms_deadlines_order check (deadline_base <= deadline_late and deadline_late <= deadline_replace)
);

-- 3) المعلمات (بيانات غير سرّية فقط؛ الأسرار في teacher_credentials)
create table public.teachers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  subject     text not null,
  is_active   boolean not null default true,
  color_idx   smallint not null default 0 check (color_idx between 0 and 7),
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users (id)
);

-- أسرار دخول المعلمة (A-29): بصمات فقط، لا كود ولا PIN نصيًا. تقرأها/تكتبها خدمة الخادم وحدها.
-- خوارزمية البصمة وتوزيع الأكواد ليسا ضمن المرحلة 4 (OQ-09).
create table public.teacher_credentials (
  teacher_id       uuid primary key references public.teachers (id) on delete restrict,
  code_hash        text,
  code_state       text not null default 'active' check (code_state in ('active', 'revoked')),
  code_issued_at   timestamptz,
  code_expires_at  timestamptz,
  pin_hash         text,
  failed_attempts  integer not null default 0 check (failed_attempts >= 0),
  locked_until     timestamptz
);

-- 4) تعريف الخانات (الأسماء إعداد مؤقت P2-05، C-12)
create table public.slots (
  id        text primary key,
  title     text not null,
  optional  boolean not null,
  ord       smallint not null unique
);

-- 5) التسليمات: مفتاح مركّب. الحالة لا تُخزَّن هنا (تُشتق من الإصدارات).
create table public.submissions (
  teacher_id  uuid not null references public.teachers (id) on delete restrict,
  term_id     uuid not null references public.terms (id) on delete restrict,
  slot_id     text not null references public.slots (id) on delete restrict,
  created_at  timestamptz not null default now(),
  primary key (teacher_id, term_id, slot_id)
);

-- 10) الأرشيفات (تصميم فقط؛ الأرشفة لكل معلمة قيد الدراسة وغير معتمدة، ملحق 09 بند 9)
create table public.archives (
  id                          uuid primary key default gen_random_uuid(),
  title                       text not null,
  year_id                     uuid not null references public.years (id) on delete restrict,
  term_id                     uuid references public.terms (id) on delete restrict,
  teacher_id                  uuid references public.teachers (id) on delete restrict,
  created_by                  uuid references auth.users (id),
  created_at                  timestamptz not null default now(),
  state                       text not null default 'creating'
                              check (state in ('creating', 'awaiting_verification', 'verified', 'failed')),
  size_bytes                  bigint check (size_bytes is null or size_bytes >= 0),
  entries_count               integer check (entries_count is null or entries_count >= 0),
  sha256                      text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  storage_provider            text,
  storage_key                 text,
  manifest_sha256             text check (manifest_sha256 is null or manifest_sha256 ~ '^[0-9a-f]{64}$'),
  checks                      jsonb not null default '[]'::jsonb,
  -- معنى «اكتمال الإرسال» (A-32): تنزيل + تحقق من البصمة + إقرار بشري بنسخة ثانية (لا تحقق آلي من النسخة الخارجية)
  download_completed_at       timestamptz,
  download_hash_verified_at   timestamptz,
  backup_ack_by               uuid references auth.users (id),
  backup_ack_at               timestamptz,
  backup_ack_note             text,
  deleted_at                  timestamptz,
  constraint archives_ack_pair check ((backup_ack_by is null) = (backup_ack_at is null))
);

-- 6) الإصدارات: لا تُعدَّل ولا تُحذف (A-44)، والحالة لقطة ثابتة لحظة التسليم.
create table public.versions (
  id                   uuid primary key default gen_random_uuid(),
  teacher_id           uuid not null,
  term_id              uuid not null,
  slot_id              text not null,
  no                   integer not null check (no >= 1),
  kind                 text not null check (kind in ('file', 'link')),
  original_name        text,
  size_bytes           bigint,
  mime_verified        text,
  ext                  text,
  storage_provider     text,
  storage_bucket       text,
  storage_key          text,
  sha256               text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  url                  text,
  submitted_at         timestamptz not null,
  status_snapshot      text not null check (status_snapshot in ('on_time', 'late')),
  deadlines_snapshot   jsonb not null,
  storage_state        text not null default 'present' check (storage_state in ('present', 'deleted_archived')),
  archive_id           uuid references public.archives (id) on delete restrict,
  replaced_note        text,
  validated_at         timestamptz,
  validation_result    jsonb,
  created_at           timestamptz not null default now(),
  unique (teacher_id, term_id, slot_id, no),
  foreign key (teacher_id, term_id, slot_id)
    references public.submissions (teacher_id, term_id, slot_id) on delete restrict,
  constraint versions_kind_fields check (
    (kind = 'file'
       and original_name is not null and size_bytes is not null and size_bytes > 0
       and ext is not null and storage_provider is not null and storage_key is not null
       and sha256 is not null and url is null)
    or
    (kind = 'link'
       and url is not null and url ~* '^https://[^[:space:]]+$'
       and original_name is null and size_bytes is null and ext is null
       and storage_key is null and sha256 is null)
  ),
  constraint versions_deleted_has_archive check (storage_state = 'present' or archive_id is not null),
  constraint versions_link_always_present check (kind = 'file' or storage_state = 'present')
);
create index versions_by_submission on public.versions (teacher_id, term_id, slot_id, no);

-- 11) عناصر الأرشيف: لمطابقة محتوى الأرشيف بالإصدارات
create table public.archive_entries (
  archive_id   uuid not null references public.archives (id) on delete restrict,
  version_id   uuid not null references public.versions (id) on delete restrict,
  path_in_zip  text not null,
  sha256       text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes   bigint not null check (size_bytes >= 0),
  primary key (archive_id, version_id),
  unique (archive_id, path_in_zip)
);

-- 7) جلسات الرفع (حد أدنى مستقل عن طريقة الرفع؛ DP-03 معلّق). started_at وقت الخادم (A-33).
create table public.upload_sessions (
  id                   uuid primary key default gen_random_uuid(),
  teacher_id           uuid not null references public.teachers (id) on delete restrict,
  term_id              uuid not null references public.terms (id) on delete restrict,
  slot_id              text not null references public.slots (id) on delete restrict,
  declared_name        text not null,
  declared_size        bigint not null check (declared_size > 0),
  declared_type        text,
  pending_key          text,
  provider_upload_ref  text,
  state                text not null default 'started'
                       check (state in ('started', 'uploaded', 'validating', 'accepted', 'rejected', 'expired')),
  reject_reason        text,
  started_at           timestamptz not null default now(),
  expires_at           timestamptz not null
);

-- 9) محاولات الدخول (بلا الكود المُدخَل). مدة الاحتفاظ إعداد (OQ-07).
create table public.login_attempts (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  teacher_id  uuid references public.teachers (id) on delete set null,
  ip_hash     text,
  result      text not null check (result in ('success', 'wrong_code', 'wrong_pin', 'locked', 'unknown_code'))
);
create index login_attempts_at on public.login_attempts (at);

-- 12) طلبات الحذف النهائي: بنية فقط وفق docs/01 القسم 4.5. لا تنفيذ حذف في المرحلة 4.
-- مؤقت: نص القرار A-12 مفقود (A-42)، فلا يُبنى هنا أكثر من شروط 4.5 والقاعدتين 11 و13.
create table public.deletion_requests (
  id                      uuid primary key default gen_random_uuid(),
  requested_by            uuid not null references auth.users (id),
  requested_at            timestamptz not null default now(),
  scope_type              text not null check (scope_type in ('year', 'term', 'teacher')),
  year_id                 uuid references public.years (id) on delete restrict,
  term_id                 uuid references public.terms (id) on delete restrict,
  teacher_id              uuid references public.teachers (id) on delete restrict,
  archive_id              uuid not null references public.archives (id) on delete restrict,
  conditions_snapshot     jsonb not null default '{}'::jsonb,
  typed_confirmation_ok   boolean not null default false,
  state                   text not null default 'requested'
                          check (state in ('requested', 'confirmed', 'executed', 'failed', 'cancelled')),
  executed_at             timestamptz,
  result                  jsonb,
  constraint deletion_scope_coherent check (
    (scope_type = 'year'    and year_id is not null and term_id is null and teacher_id is null) or
    (scope_type = 'term'    and term_id is not null and teacher_id is null) or
    (scope_type = 'teacher' and teacher_id is not null)
  )
);

-- 13) سجل العمليات (A-45): إضافة فقط + سلسلة بصمات. id وat والبصمات تُملأ بمشغّل في 002.
create table public.audit_log (
  id           bigint primary key,
  at           timestamptz not null,
  actor_role   text not null check (actor_role in ('owner', 'director', 'teacher', 'system')),
  actor_id     text,
  action       text not null,
  target_type  text,
  target_id    text,
  detail       jsonb,
  prev_hash    text not null,
  entry_hash   text not null unique
);
create sequence public.audit_log_id_seq owned by public.audit_log.id;

-- ---------------------------------------------------------------------------
-- قيم أولية لإعدادات (لا بيانات حقيقية). كلها **مؤقتة غير معتمدة** وتُضبط من الإعدادات:
--  * 50000000 بايت (50 MB عشري): حد مؤقت غير نهائي (A-39)؛ اختير عشريًا ليكون داخل أي تفسير لحد 50 MB.
--  * 120 دقيقة: نافذة مقترحة غير نهائية (A-33).  * 5 محاولات / 15 دقيقة: افتراض واجهة P2-01.
--  * 90 يومًا: مقترح الاحتفاظ بمحاولات الدخول (OQ-07).  * أسماء الخانتين: P2-05.
-- ---------------------------------------------------------------------------
insert into public.slots (id, title, optional, ord) values
  ('s1', 'ملف الإنجاز الأساسي', false, 1),
  ('s2', 'ملف داعم', true, 2);

insert into public.app_settings
  (id, max_file_bytes, allowed_types, max_versions_per_slot, upload_window_minutes,
   login_max_failed_attempts, login_lock_minutes, login_attempts_retention_days,
   deadline_change_reason_required)
values
  (true, 50000000, array['pdf','docx','pptx','xlsx','jpg','jpeg','png','webp','gif'], null, 120, 5, 15, 90, true);

commit;
