-- أثَر — ملف التطبيق الكامل (مولَّد من database/001..004؛ لا تعدّليه يدويًا: عدّلي المصدر وأعيدي التوليد).
-- يُلصق في Supabase → SQL Editor ويُنفَّذ **مرة واحدة** على مشروع جديد فارغ ببيانات وهمية.

-- ======================= database/001_schema.sql =======================
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


-- ======================= database/002_integrity.sql =======================
-- ============================================================================
-- أثَر — المرحلة 4.1 — الملف 2/3: قواعد السلامة والمشغّلات والدوال
-- حالة: ملف محلي **غير منفَّذ وغير مجرَّب**. لا يُنفَّذ قبل موافقة صريحة مستقلة (A-40).
-- حدّ صريح (A-45): من يملك صلاحية إدارة القاعدة (superuser/owner) يستطيع تعطيل
-- المشغّلات أو تغيير أي شيء. هذه الحمايات **تمنع الخطأ والتعديل من التطبيق وتكشف التلاعب،
-- ولا تمنع مديرًا متعمّدًا**. وأعلام set_config أدناه ليست حدًّا أمنيًا بل حاجز ضد الخطأ.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- أدوات عامة
-- ---------------------------------------------------------------------------
create or replace function public.current_staff_role()
returns text language sql stable security definer set search_path = ''
as $$
  select role from public.staff_profiles where user_id = auth.uid() and is_active
$$;

create or replace function public.forbid_mutation()
returns trigger language plpgsql set search_path = ''
as $$
begin
  raise exception 'هذا الجدول لا يقبل التعديل ولا الحذف (إضافة فقط): %', TG_TABLE_NAME
    using errcode = 'insufficient_privilege';
end
$$;

create or replace function public.forbid_delete()
returns trigger language plpgsql set search_path = ''
as $$
begin
  raise exception 'لا حذف فعليًا للسجلات التاريخية: %', TG_TABLE_NAME
    using errcode = 'insufficient_privilege';
end
$$;

-- ---------------------------------------------------------------------------
-- 13) سجل العمليات: إضافة فقط + سلسلة بصمات SHA-256 (A-45). «كاشف للتلاعب لا مانع».
-- ---------------------------------------------------------------------------
create or replace function public.audit_entry_hash(
  p_prev text, p_id bigint, p_at timestamptz, p_role text, p_actor text,
  p_action text, p_target_type text, p_target_id text, p_detail jsonb)
returns text language sql stable set search_path = ''
as $$
  select encode(
    sha256(convert_to(concat_ws('|',
      p_prev,
      p_id::text,
      to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
      p_role,
      coalesce(p_actor, ''),
      p_action,
      coalesce(p_target_type, ''),
      coalesce(p_target_id, ''),
      coalesce(p_detail::text, '')
    ), 'UTF8')),
    'hex')
$$;

create or replace function public.audit_log_chain()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_prev text;
begin
  -- قفل يسلسل الإدراج؛ يُحتجز حتى نهاية المعاملة فيتطابق ترتيب السلسلة مع ترتيب id.
  perform pg_advisory_xact_lock(727001);
  new.id := nextval('public.audit_log_id_seq');
  new.at := clock_timestamp();
  select entry_hash into v_prev from public.audit_log order by id desc limit 1;
  new.prev_hash := coalesce(v_prev, repeat('0', 64));
  new.entry_hash := public.audit_entry_hash(
    new.prev_hash, new.id, new.at, new.actor_role, new.actor_id,
    new.action, new.target_type, new.target_id, new.detail);
  return new;
end
$$;

create trigger audit_log_chain_bi
  before insert on public.audit_log
  for each row execute function public.audit_log_chain();

create trigger audit_log_no_update_delete
  before update or delete on public.audit_log
  for each row execute function public.forbid_mutation();

create trigger audit_log_no_truncate
  before truncate on public.audit_log
  for each statement execute function public.forbid_mutation();

-- كتابة سجل من دوال داخلية فقط (لا تُمنح لأي دور مباشرة).
create or replace function public.log_audit(
  p_action text, p_target_type text, p_target_id text, p_detail jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.audit_log (actor_role, actor_id, action, target_type, target_id, detail)
  values (coalesce(public.current_staff_role(), 'system'), auth.uid()::text,
          p_action, p_target_type, p_target_id, p_detail);
end
$$;

-- التحقق من السلسلة (للمالكة فقط). حدّها: لا تكشف قصّ ذيل السجل أو إعادة كتابته كاملًا؛
-- لذلك يُستكمل بالتصدير اليدوي (A-45).
create or replace function public.verify_audit_chain()
returns table (ok boolean, checked bigint, broken_at bigint)
language plpgsql stable security definer set search_path = ''
as $$
declare
  r record;
  v_prev text := repeat('0', 64);
  n bigint := 0;
begin
  if public.current_staff_role() is distinct from 'owner' then
    raise exception 'غير مصرّح' using errcode = 'insufficient_privilege';
  end if;
  for r in select * from public.audit_log order by id loop
    n := n + 1;
    if r.prev_hash <> v_prev
       or r.entry_hash <> public.audit_entry_hash(
            r.prev_hash, r.id, r.at, r.actor_role, r.actor_id,
            r.action, r.target_type, r.target_id, r.detail) then
      return query select false, n, r.id;
      return;
    end if;
    v_prev := r.entry_hash;
  end loop;
  return query select true, n, null::bigint;
end
$$;

-- ---------------------------------------------------------------------------
-- 6) الإصدارات (A-44): إدراج مُتحقَّق منه، ولا تعديل، ولا حذف.
-- ---------------------------------------------------------------------------
create or replace function public.versions_guard_insert()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  s public.app_settings%rowtype;
  v_expected integer;
begin
  select * into s from public.app_settings where id;
  if not found then
    raise exception 'إعدادات النظام غير مهيأة' using errcode = 'check_violation';
  end if;

  if new.storage_state <> 'present' or new.archive_id is not null then
    raise exception 'الإصدار الجديد يبدأ بحالة تخزين «موجود»' using errcode = 'check_violation';
  end if;

  if new.kind = 'file' then
    if new.size_bytes > s.max_file_bytes then
      raise exception 'حجم الملف يتجاوز الحد المضبوط في الإعدادات' using errcode = 'check_violation';
    end if;
    if not (lower(new.ext) = any (s.allowed_types)) then
      raise exception 'نوع الملف غير مسموح في الإعدادات' using errcode = 'check_violation';
    end if;
  end if;

  -- قفل صف التسليم لتسلسل الأرقام دون ثغرات أو تكرار.
  perform 1 from public.submissions
   where teacher_id = new.teacher_id and term_id = new.term_id and slot_id = new.slot_id
   for update;

  select coalesce(max(no), 0) + 1 into v_expected from public.versions
   where teacher_id = new.teacher_id and term_id = new.term_id and slot_id = new.slot_id;
  if new.no <> v_expected then
    raise exception 'رقم الإصدار يجب أن يكون %', v_expected using errcode = 'check_violation';
  end if;

  if s.max_versions_per_slot is not null and v_expected > s.max_versions_per_slot then
    raise exception 'تجاوز أقصى عدد للإصدارات في الخانة' using errcode = 'check_violation';
  end if;
  return new;
end
$$;

create trigger versions_guard_insert_bi
  before insert on public.versions
  for each row execute function public.versions_guard_insert();

-- التحديث الوحيد المسموح: انتقال storage_state من «موجود» إلى «محذوف-مؤرشف» مع archive_id،
-- ومن مسار الحذف المعتمد فقط (يُبنى في مرحلة لاحقة). لا شيء غير ذلك يتغير.
create or replace function public.versions_guard_update()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if current_setting('app.deletion_path', true) is distinct from 'on' then
    raise exception 'الإصدارات لا تُعدَّل' using errcode = 'insufficient_privilege';
  end if;
  if (to_jsonb(new) - 'storage_state' - 'archive_id')
     is distinct from (to_jsonb(old) - 'storage_state' - 'archive_id') then
    raise exception 'مسموح تغيير حالة التخزين والأرشيف فقط' using errcode = 'insufficient_privilege';
  end if;
  if old.storage_state <> 'present' or new.storage_state <> 'deleted_archived' or new.archive_id is null then
    raise exception 'انتقال حالة تخزين غير مسموح' using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;

create trigger versions_guard_update_bu
  before update on public.versions
  for each row execute function public.versions_guard_update();

create trigger versions_no_delete
  before delete on public.versions
  for each row execute function public.forbid_mutation();

create trigger versions_no_truncate
  before truncate on public.versions
  for each statement execute function public.forbid_mutation();

-- ---------------------------------------------------------------------------
-- منع الحذف الفعلي من الجداول التاريخية (الإيقاف يتم بـ is_active لا بالحذف)
-- ---------------------------------------------------------------------------
create trigger years_no_delete          before delete on public.years
  for each row execute function public.forbid_delete();
create trigger terms_no_delete          before delete on public.terms
  for each row execute function public.forbid_delete();
create trigger teachers_no_delete       before delete on public.teachers
  for each row execute function public.forbid_delete();
create trigger submissions_no_delete    before delete on public.submissions
  for each row execute function public.forbid_delete();
create trigger archives_no_delete       before delete on public.archives
  for each row execute function public.forbid_delete();
create trigger archive_entries_no_delete before delete on public.archive_entries
  for each row execute function public.forbid_delete();
create trigger deletion_requests_no_delete before delete on public.deletion_requests
  for each row execute function public.forbid_delete();

-- ---------------------------------------------------------------------------
-- 2) المواعيد (A-34): تُعدَّل عبر الدالة فقط، فتُسجَّل دائمًا. لا أثر رجعي على الإصدارات
-- لأن حالتها ولقطة مواعيدها مثبَّتتان في versions.
-- ---------------------------------------------------------------------------
create or replace function public.terms_guard_deadlines()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if (new.deadline_base, new.deadline_late, new.deadline_replace)
     is distinct from (old.deadline_base, old.deadline_late, old.deadline_replace)
     and current_setting('app.via_set_term_deadlines', true) is distinct from 'on' then
    raise exception 'المواعيد تُعدَّل عبر set_term_deadlines فقط' using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;

create trigger terms_guard_deadlines_bu
  before update on public.terms
  for each row execute function public.terms_guard_deadlines();

create or replace function public.set_term_deadlines(
  p_term_id uuid, p_base date, p_late date, p_replace date, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_role text := public.current_staff_role();
  v_old public.terms%rowtype;
  v_active boolean;
  v_reason_required boolean;
begin
  if v_role is null then
    raise exception 'غير مصرّح' using errcode = 'insufficient_privilege';
  end if;

  select deadline_change_reason_required into v_reason_required from public.app_settings where id;
  if coalesce(v_reason_required, true) and coalesce(btrim(p_reason), '') = '' then
    raise exception 'سبب التعديل مطلوب' using errcode = 'check_violation';
  end if;

  select * into v_old from public.terms where id = p_term_id for update;
  if not found then
    raise exception 'الفصل غير موجود' using errcode = 'no_data_found';
  end if;

  -- المديرة: فصول السنة النشطة فقط (A-34، افتراض P2-04).
  if v_role = 'director' then
    select is_active into v_active from public.years where id = v_old.year_id;
    if not coalesce(v_active, false) then
      raise exception 'المديرة تعدّل مواعيد السنة النشطة فقط' using errcode = 'insufficient_privilege';
    end if;
  end if;

  perform set_config('app.via_set_term_deadlines', 'on', true);
  update public.terms
     set deadline_base = p_base, deadline_late = p_late, deadline_replace = p_replace
   where id = p_term_id;
  perform set_config('app.via_set_term_deadlines', 'off', true);

  perform public.log_audit('term.deadlines.update', 'term', p_term_id::text, jsonb_build_object(
    'old', jsonb_build_object('base', v_old.deadline_base, 'late', v_old.deadline_late, 'replace', v_old.deadline_replace),
    'new', jsonb_build_object('base', p_base, 'late', p_late, 'replace', p_replace),
    'reason', p_reason));
end
$$;

-- ---------------------------------------------------------------------------
-- إعدادات النظام (A-39): كل تغيير يُسجَّل في سجل العمليات.
-- ملاحظة: لا تعرف القاعدة حدّ مزوّد التخزين؛ طبقة التخزين (4.2) تحدّ القيمة الفعلية بحدّ المزوّد.
-- ---------------------------------------------------------------------------
create or replace function public.app_settings_touch()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end
$$;

create or replace function public.app_settings_audit()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  perform public.log_audit('settings.update', 'app_settings', '1', jsonb_build_object(
    'old', to_jsonb(old) - 'updated_at' - 'updated_by',
    'new', to_jsonb(new) - 'updated_at' - 'updated_by'));
  return new;
end
$$;

create trigger app_settings_touch_bu before update on public.app_settings
  for each row execute function public.app_settings_touch();
create trigger app_settings_audit_au after update on public.app_settings
  for each row execute function public.app_settings_audit();

-- ---------------------------------------------------------------------------
-- 12) الحذف النهائي: شروط docs/01 القسم 4.5 فقط (بنية؛ لا تنفيذ حذف في المرحلة 4).
-- مؤقت: بسبب فقدان نص A-12 (A-42) لا يُضاف شرط خارج 4.5 والقاعدتين 11 و13.
-- ---------------------------------------------------------------------------
create or replace function public.deletion_requests_guard()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  a public.archives%rowtype;
begin
  if tg_op = 'UPDATE' then
    if old.state = 'executed' then
      raise exception 'طلب منفَّذ لا يُعدَّل' using errcode = 'insufficient_privilege';
    end if;
  end if;
  if new.state in ('confirmed', 'executed') then
    select * into a from public.archives where id = new.archive_id;
    if not found or a.state <> 'verified' then
      raise exception 'الشرط 1: لا أرشيف صالح ومعتمد' using errcode = 'check_violation';
    end if;
    if a.download_completed_at is null or a.download_hash_verified_at is null then
      raise exception 'الشرط 2: لم يكتمل إرسال الأرشيف (تنزيل + تحقق من البصمة)' using errcode = 'check_violation';
    end if;
    if a.backup_ack_at is null then
      raise exception 'الشرط 3: لا إقرار بنسخة احتياطية ثانية' using errcode = 'check_violation';
    end if;
    if not new.typed_confirmation_ok then
      raise exception 'لم يُكتب نص التأكيد' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end
$$;

create trigger deletion_requests_guard_biu
  before insert or update on public.deletion_requests
  for each row execute function public.deletion_requests_guard();

-- ---------------------------------------------------------------------------
-- 9) تنظيف محاولات الدخول القديمة (مدة الاحتفاظ إعداد؛ لا جدولة آلية في المرحلة 4)
-- ---------------------------------------------------------------------------
create or replace function public.purge_old_login_attempts()
returns bigint language plpgsql security definer set search_path = ''
as $$
declare
  v_days integer;
  v_deleted bigint;
begin
  select login_attempts_retention_days into v_days from public.app_settings where id;
  delete from public.login_attempts where at < now() - make_interval(days => v_days);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end
$$;

commit;


-- ======================= database/003_rls.sql =======================
-- ============================================================================
-- [5.A] تعديل C-10 (غير منفَّذ وغير مجرَّب على PostgreSQL): لا يقرأ أي دور تطبيقي (المالكة أو المديرة) أعمدة التخزين
--   (storage_provider وstorage_bucket وstorage_key في versions، وstorage_provider وstorage_key في archives).
--   مُنحت أعمدة versions/archives صراحةً بدل منح الجدول كله، وأُزيلت أعمدة التخزين من المنظور. أي عملية تحتاج المفاتيح
--   (روابط موقّعة، تنزيل، أرشفة، بيان نسخ احتياطي كامل) تمر بخدمة الخادم بمفتاح الخدمة بعد التحقق من دور المالكة.
--   مع منح الأعمدة لا يصلح SELECT * من العميل على هذين الجدولين؛ تُسمّى الأعمدة صراحة.
-- ============================================================================
-- أثَر — المرحلة 4.1 — الملف 3/3: الصلاحيات وسياسات RLS ومنظور بيان النسخ الاحتياطي
-- حالة: ملف محلي **غير منفَّذ وغير مجرَّب**. لا يُنفَّذ قبل موافقة صريحة مستقلة (A-40).
-- المبدأ: المنع افتراضيًا. المعلمات لا يصلن للقاعدة مباشرة (كل وصولهن عبر خدمة الخادم
-- بمفتاح الخدمة الذي يتجاوز RLS). لا يُعتمد على RLS وحده (docs/01 القسم 5).
-- A-46: سجل العمليات للمالكة فقط.
-- ============================================================================

begin;

-- 1) إزالة كل الصلاحيات الافتراضية ثم منح الضروري فقط
revoke all on all tables    in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

grant usage on schema public to authenticated;

-- 2) تفعيل RLS على كل جدول
alter table public.staff_profiles       enable row level security;
alter table public.app_settings         enable row level security;
alter table public.years                enable row level security;
alter table public.terms                enable row level security;
alter table public.teachers             enable row level security;
alter table public.teacher_credentials  enable row level security;
alter table public.slots                enable row level security;
alter table public.submissions          enable row level security;
alter table public.archives             enable row level security;
alter table public.versions             enable row level security;
alter table public.archive_entries      enable row level security;
alter table public.upload_sessions      enable row level security;
alter table public.login_attempts       enable row level security;
alter table public.deletion_requests    enable row level security;
alter table public.audit_log            enable row level security;

-- 3) صلاحيات الجداول للمسجّلين (المالكة والمديرة فقط؛ لا policy تعني لا وصول)
grant select on public.staff_profiles, public.app_settings, public.years, public.terms,
                public.teachers, public.slots, public.submissions,
                public.archive_entries, public.deletion_requests,
                public.login_attempts, public.audit_log
  to authenticated;
-- C-10: الإصدارات والأرشيفات بمنح أعمدة صريح يستثني مفاتيح التخزين (storage_provider/bucket/key) استثناءً تامًا.
grant select (id, teacher_id, term_id, slot_id, no, kind, original_name, size_bytes, mime_verified, ext,
              sha256, url, submitted_at, status_snapshot, deadlines_snapshot, storage_state, archive_id,
              replaced_note, validated_at, validation_result, created_at)
  on public.versions to authenticated;
grant select (id, title, year_id, term_id, teacher_id, created_by, created_at, state, size_bytes, entries_count,
              sha256, manifest_sha256, checks, download_completed_at, download_hash_verified_at,
              backup_ack_by, backup_ack_at, backup_ack_note, deleted_at)
  on public.archives to authenticated;
-- أسرار المعلمات: أعمدة غير سرّية فقط؛ code_hash وpin_hash لا يقرؤهما أي دور تطبيقي.
grant select (teacher_id, code_state, code_issued_at, code_expires_at, failed_attempts, locked_until)
  on public.teacher_credentials to authenticated;
grant insert, update on public.years, public.teachers to authenticated;
-- S-1 (أُكِّد بالتنفيذ 2026-10-21): لا UPDATE على أعمدة المواعيد في terms لأي دور تطبيقي؛ تعديلها عبر set_term_deadlines (security definer) وحدها،
-- فلا يكفي ضبط app.via_set_term_deadlines من الجلسة لتجاوز السبب والتدقيق. الإدراج يبقى للمالكة (RLS) لإنشاء الفصل بمواعيده الأولى.
grant insert on public.terms to authenticated;
grant update (year_id, name, ord) on public.terms to authenticated;
grant update on public.app_settings to authenticated;

-- 4) الدوال المتاحة للمسجّلين (الباقي داخلي لا يُمنح)
grant execute on function public.current_staff_role() to authenticated;
grant execute on function public.set_term_deadlines(uuid, date, date, date, text) to authenticated;
grant execute on function public.verify_audit_chain() to authenticated;
-- purge_old_login_attempts وlog_audit وبقية الدوال: خدمة الخادم/المشغّلات فقط.

-- 4-ب) [5.A] ما يُنشأ لاحقًا (جداول/دوال/تسلسلات في ملفات تالية مثل 004) لا يرث صلاحيات افتراضية للأدوار التطبيقية.
--   تُطبَّق هذه التعليمات على الكائنات التي ينشئها الدور المنفِّذ لهذا الملف فقط؛ وصلاحيات Supabase الافتراضية قد
--   تُضاف بأدوار أخرى (افتراض غير متحقَّق منه)، لذا يبقى سحب الصلاحيات الصريح في كل ملف جداول جديد إلزاميًا.
alter default privileges in schema public revoke all on tables    from public, anon, authenticated;
alter default privileges in schema public revoke all on sequences from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- 5) السياسات
create policy staff_profiles_select on public.staff_profiles for select to authenticated
  using (user_id = (select auth.uid()) or public.current_staff_role() = 'owner');

create policy app_settings_select on public.app_settings for select to authenticated
  using (public.current_staff_role() is not null);
create policy app_settings_update on public.app_settings for update to authenticated
  using (public.current_staff_role() = 'owner') with check (public.current_staff_role() = 'owner');

create policy years_select on public.years for select to authenticated
  using (public.current_staff_role() is not null);
create policy years_insert on public.years for insert to authenticated
  with check (public.current_staff_role() = 'owner');
create policy years_update on public.years for update to authenticated
  using (public.current_staff_role() = 'owner') with check (public.current_staff_role() = 'owner');

-- الفصول: المالكة تُنشئ وتعدّل غير المواعيد مباشرة؛ تعديل المواعيد (لأي دور) عبر الدالة وحدها.
create policy terms_select on public.terms for select to authenticated
  using (public.current_staff_role() is not null);
create policy terms_insert on public.terms for insert to authenticated
  with check (public.current_staff_role() = 'owner');
create policy terms_update on public.terms for update to authenticated
  using (public.current_staff_role() = 'owner') with check (public.current_staff_role() = 'owner');

-- المعلمات: إدارة القائمة للمالكة فقط (مؤقت: C-07 وصف «المديرة ؟» غير محسوم).
create policy teachers_select on public.teachers for select to authenticated
  using (public.current_staff_role() is not null);
create policy teachers_insert on public.teachers for insert to authenticated
  with check (public.current_staff_role() = 'owner');
create policy teachers_update on public.teachers for update to authenticated
  using (public.current_staff_role() = 'owner') with check (public.current_staff_role() = 'owner');

create policy teacher_credentials_select on public.teacher_credentials for select to authenticated
  using (public.current_staff_role() = 'owner');

create policy slots_select on public.slots for select to authenticated
  using (public.current_staff_role() is not null);

-- التسليمات والإصدارات: قراءة للمسجّلين؛ الكتابة من خدمة الخادم فقط.
-- مؤقت: رؤية المديرة للإصدارات السابقة غير محسومة (C-15)، والمعتمد الآن قراءة الكل.
create policy submissions_select on public.submissions for select to authenticated
  using (public.current_staff_role() is not null);
create policy versions_select on public.versions for select to authenticated
  using (public.current_staff_role() is not null);

-- الأرشفة والحذف وسجل الدخول: المالكة فقط (قراءة). الكتابة عبر خدمة الخادم.
create policy archives_select on public.archives for select to authenticated
  using (public.current_staff_role() = 'owner');
create policy archive_entries_select on public.archive_entries for select to authenticated
  using (public.current_staff_role() = 'owner');
create policy deletion_requests_select on public.deletion_requests for select to authenticated
  using (public.current_staff_role() = 'owner');
create policy login_attempts_select on public.login_attempts for select to authenticated
  using (public.current_staff_role() = 'owner');

-- A-46: سجل العمليات للمالكة فقط. لا policy إدراج/تعديل/حذف للمسجّلين (الكتابة بالمشغّلات والخادم).
create policy audit_log_select on public.audit_log for select to authenticated
  using (public.current_staff_role() = 'owner');

-- upload_sessions: لا policies عمدًا — خدمة الخادم فقط.

-- 6) بيان الإصدارات للمسجّلين (A-44 ب): منظور للقراءة فقط يخضع لـRLS المستدعي.
-- [5.A/C-10] **بلا أي عمود تخزين**: لم يعد «بيانًا احتياطيًا كاملًا»؛ البيان الكامل بمفاتيح التخزين تولّده خدمة الخادم للمالكة فقط.
-- (اسم المنظور باقٍ لتجنب كسر المراجع؛ تغيير الاسم قرار لاحق.)
-- security_invoker يتطلب PostgreSQL 15 فأعلى (غير مؤكد على المشروع الفعلي).
create view public.v_backup_manifest with (security_invoker = true) as
select
  y.label            as year_label,
  t.name             as term_name,
  t.ord              as term_ord,
  te.name            as teacher_name,
  v.teacher_id, v.term_id, v.slot_id,
  v.no               as version_no,
  v.kind, v.original_name, v.url, v.size_bytes, v.sha256,
  v.submitted_at, v.status_snapshot,
  v.storage_state, v.archive_id
from public.versions v
join public.terms    t  on t.id  = v.term_id
join public.years    y  on y.id  = t.year_id
join public.teachers te on te.id = v.teacher_id;

grant select on public.v_backup_manifest to authenticated;

commit;


-- ======================= database/004_upload_tables.sql =======================
-- ============================================================================
-- أثَر — 5.B — مسودة v4 لجداول الرفع (اقتراح للمراجعة فقط؛ v3 وv2 باقيتان كما هما)
-- تغييرات v4 عن v3 (قرارات 5.B): (1) إعداد app_settings.validating_stuck_minutes بافتراضي 10 (قابل للتعديل)؛
--   (2) وراثة وقت البدء بإجراء صريح من المالكة فقط: upload_sessions.platform_fault / inherited_from / effective_start_at،
--   مع مشغّل إدراج يتحقق من جلسة الأصل (ملغاة بعلامة عطل منصة وبملاحظة، لنفس المعلمة/الفصل/الخانة، ولمرة واحدة بقيد فريد)،
--   وversions_match_session يطابق submitted_at مع effective_start_at؛ (3) مفردة outcome الجديدة start_inherited.
-- **ما زالت غير منفَّذة**: لا PostgreSQL في بيئة العمل؛ الاختبارات الجاهزة في tests/sql/ تُشغَّل على جهازك.
-- (نص v3 أدناه كما هو مع التعديلات المذكورة.)
-- أثَر — 5.A — مسودة v3 لجداول الرفع (اقتراح للمراجعة فقط؛ تحلّ محل v2 التي بقيت كما هي)
-- الحالة: **غير منفَّذة، غير مجرَّبة، ولم تُفحص حتى بمحلّل صياغة PostgreSQL** (لا PostgreSQL ولا pglast في بيئة العمل). كتبتُها قراءةً فقط.
-- تغييرات v3 عن v2 (قرارات 5.A): (1) حُذف سبب الرفض stalled؛ (2) انتقال validating → uploaded لاستئناف التحقق؛
--   (3) إفراج المالكة uploaded/validating → cancelled بملاحظة إلزامية release_note؛ (4) أعمدة validating_at للعالقة؛
--   (5) أعمدة دليل أول بايتات first_byte_evidence_* معلوماتية فقط (لا تدخل في حساب التأخير)؛
--   (6) إصلاح خلل في v2: فحص النافذة وكتابة uploaded_at كانا سيُطبَّقان على كل انتقال إلى uploaded فيمنعان الاستئناف بعد الانقضاء؛ صارا لـstarted → uploaded فقط؛
--   (7) مفردات outcome في upload_attempts أُضيفت لها أحداث الاستئناف والإفراج والدليل.
-- لا تُنقل إلى database/ ولا تُنفَّذ قبل: (1) موافقتك على القرارات المبدئية A-56، (2) موافقة مستقلة على التنفيذ (A-40).
-- المسودة الأصلية drafts/004_upload_tables.DRAFT.sql باقية كما هي ولم تُعدَّل جملها (فقط تعليقات مراجعة).
-- مرجع الشرح: docs/phase5/PHASE5_1B_REMEDIATION.md (C-1…C-9).
-- تفترض التنفيذ بعد 001 و002 و003 على قاعدة جديدة فارغة (انظر الحارس أدناه، C-8).
-- افتراض غير متحقَّق منه: في Supabase قد تُمنح الجداول الجديدة في public صلاحيات افتراضية لأدوار anon/authenticated/service_role،
--   لذا تُسحب هنا صراحةً لكل جدول جديد (003 يسحب الموجود وقتها فقط).
-- ============================================================================

-- (0) حارس C-8: يفشل بوضوح إن لم تكن الجداول فارغة بدل فشل ADD COLUMN NOT NULL برسالة غامضة.
do $$
begin
  if exists (select 1 from public.upload_sessions) or exists (select 1 from public.versions) then
    raise exception 'مسودة 004 تفترض upload_sessions وversions فارغين؛ ادمجي الأعمدة في 001 بدل ALTER';
  end if;
end
$$;

-- (أ-0) [v4] مهلة اعتبار validating عالقة: إعداد لا ثابت (الافتراضي 10 دقائق، وليس مدة نهائية).
alter table public.app_settings
  add column validating_stuck_minutes integer not null default 10 check (validating_stuck_minutes > 0);

-- (أ) توسيع upload_sessions
alter table public.upload_sessions
  add column idempotency_key   text   not null check (length(btrim(idempotency_key)) > 0),
  add column status_at_start   text   not null check (status_at_start in ('on_time', 'late')),
  add column uploaded_at       timestamptz,
  add column validated_at      timestamptz,
  add column verified_size     bigint check (verified_size is null or verified_size > 0),
  add column verified_sha256   text   check (verified_sha256 is null or verified_sha256 ~ '^[0-9a-f]{64}$'),
  add column validation_result jsonb,
  add column finished_at       timestamptz,
  add column validating_at     timestamptz,
  add column release_note      text,
  add column first_byte_evidence_at     timestamptz,
  add column first_byte_evidence_source text,
  -- [v4] وراثة صريحة بقرار المالكة بعد عطل المنصة: لا تلقائية.
  add column platform_fault     boolean not null default false,
  add column inherited_from     uuid unique references public.upload_sessions (id) on delete restrict,
  add column effective_start_at timestamptz not null;

-- حالة 'cancelled' مقترحة (C-5). اسم قيد 001 المتوقَّع تلقائيًا: upload_sessions_state_check (يُتحقَّق منه عند التجربة).
alter table public.upload_sessions drop constraint upload_sessions_state_check;
alter table public.upload_sessions
  add constraint upload_sessions_state_check
  check (state in ('started', 'uploaded', 'validating', 'accepted', 'rejected', 'expired', 'cancelled'));

alter table public.upload_sessions
  add constraint upload_sessions_idempotency unique (teacher_id, idempotency_key),
  add constraint upload_sessions_window_valid check (expires_at > started_at),
  add constraint upload_sessions_reject_reason check (
    reject_reason is null or reject_reason in
      ('expired','empty','too_large','type_not_allowed','size_mismatch','signature_mismatch','hash_invalid','deadline_closed')),
  -- C-7: اتساق الحالة مع الحقول؛ rejected لا يحمل سبب expired (له حالته)، وcancelled بلا سبب.
  add constraint upload_sessions_state_fields check (
    (state = 'started' and finished_at is null and uploaded_at is null)
    or (state = 'uploaded'   and finished_at is null and uploaded_at is not null and validating_at is null)
    or (state = 'validating' and finished_at is null and uploaded_at is not null and validating_at is not null)
    or (state = 'accepted' and finished_at is not null and uploaded_at is not null and validated_at is not null
        and verified_size is not null and verified_sha256 is not null and validation_result is not null and reject_reason is null)
    or (state = 'rejected' and finished_at is not null and reject_reason is not null and reject_reason <> 'expired')
    or (state = 'expired'  and finished_at is not null and reject_reason = 'expired')
    -- cancelled: إلغاء المعلمة قبل وصول الملف (بلا ملاحظة)، أو إفراج المالكة بعد وصوله (ملاحظة إلزامية).
    or (state = 'cancelled' and finished_at is not null and reject_reason is null
        and (uploaded_at is null or (release_note is not null and length(btrim(release_note)) > 0)))
  ),
  add constraint upload_sessions_release_note_only_cancelled check (release_note is null or state = 'cancelled'),
  -- [v4] علامة عطل المنصة لا تُوضع إلا مع إفراج مُلاحَظ (cancelled بعد وصول الملف).
  add constraint upload_sessions_platform_fault_needs_release check (not platform_fault or (state = 'cancelled' and release_note is not null)),
  -- دليل أول البايتات معلوماتي: زوج مكتمل ولا يسبق البدء؛ لا يدخل في حساب التأخير قبل اعتماد Q-4.
  add constraint upload_sessions_evidence_pair check ((first_byte_evidence_at is null) = (first_byte_evidence_source is null)),
  add constraint upload_sessions_evidence_after_start check (first_byte_evidence_at is null or first_byte_evidence_at >= started_at);

-- (C-5) جلسة نشطة واحدة لكل (معلمة، فصل، خانة). النشطة: started / uploaded / validating.
create unique index upload_sessions_one_active
  on public.upload_sessions (teacher_id, term_id, slot_id)
  where state in ('started', 'uploaded', 'validating');

-- (C-6) فهارس المسح: المنتهية (started)، والمنتظرة للتحقق (uploaded/validating) لا تنقضي ولا تُرفض بالتأخير، والعالقة في validating.
-- ملاحظة تشغيلية: قبل إدراج جلسة جديدة لخانة يجب على الخادم إنهاء جلسة started المنقضية لتلك الخانة (UPDATE إلى expired)،
--   وإلا منعها الفهرس الفريد أدناه؛ والمشغّل يسمح بـexpired فقط حين now() >= expires_at.
create index upload_sessions_open_expiry on public.upload_sessions (expires_at) where state = 'started';
create index upload_sessions_pending_verification_scan on public.upload_sessions (uploaded_at) where state in ('uploaded', 'validating');
create index upload_sessions_validating_since on public.upload_sessions (validating_at) where state = 'validating';

-- (C-3) حماية upload_sessions: لا حذف، ولا تعديل إلا انتقالات الحالة المحددة، والأزمنة من ساعة القاعدة.
create or replace function public.upload_sessions_guard_insert()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_minutes integer;
  p public.upload_sessions%rowtype;
begin
  select upload_window_minutes into v_minutes from public.app_settings where id;
  if v_minutes is null then
    raise exception 'إعدادات النظام غير مهيأة' using errcode = 'check_violation';
  end if;
  if new.state <> 'started' or new.uploaded_at is not null or new.finished_at is not null
     or new.validated_at is not null or new.reject_reason is not null then
    raise exception 'الجلسة الجديدة تبدأ بحالة started وبلا أزمنة نهاية' using errcode = 'check_violation';
  end if;
  -- وقت البدء والانقضاء من ساعة القاعدة لا من المستدعي (A-33)؛ والنافذة تُثبَّت لحظة البدء فلا يغيّرها تعديل إعداد لاحق.
  new.started_at := now();
  new.expires_at := new.started_at + make_interval(mins => v_minutes);
  -- [v4] وقت البدء المعتمد: وقت البدء نفسه، أو الموروث من جلسة أُفرج عنها بعلامة عطل منصة (مرة واحدة بقيد inherited_from الفريد).
  if new.platform_fault then
    raise exception 'علامة عطل المنصة لا توضع عند الإدراج' using errcode = 'check_violation';
  end if;
  if new.inherited_from is null then
    new.effective_start_at := new.started_at;
  else
    select * into p from public.upload_sessions where id = new.inherited_from;
    if not found or p.state <> 'cancelled' or not p.platform_fault
       or (p.teacher_id, p.term_id, p.slot_id) is distinct from (new.teacher_id, new.term_id, new.slot_id) then
      raise exception 'لا إذن وراثة صالح لهذه الجلسة' using errcode = 'check_violation';
    end if;
    new.status_at_start := p.status_at_start;
    new.effective_start_at := p.effective_start_at;
  end if;
  return new;
end
$$;
create trigger upload_sessions_guard_insert_bi
  before insert on public.upload_sessions
  for each row execute function public.upload_sessions_guard_insert();

create or replace function public.upload_sessions_guard_update()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_mutable text[] := array['state','reject_reason','uploaded_at','validated_at','verified_size',
                            'verified_sha256','validation_result','finished_at','provider_upload_ref',
                            'validating_at','release_note','first_byte_evidence_at','first_byte_evidence_source','platform_fault'];
begin
  if old.state in ('accepted', 'rejected', 'expired', 'cancelled') then
    raise exception 'الجلسة في حالة نهائية ولا تُعدَّل' using errcode = 'insufficient_privilege';
  end if;
  if (to_jsonb(new) - v_mutable) is distinct from (to_jsonb(old) - v_mutable) then
    raise exception 'مسموح تغيير حقول الحالة والتحقق فقط' using errcode = 'insufficient_privilege';
  end if;
  -- حقول تُكتب مرة واحدة: لا تغيير بعد ضبطها.
  if (old.provider_upload_ref is not null and new.provider_upload_ref is distinct from old.provider_upload_ref)
     or (old.uploaded_at is not null and new.uploaded_at is distinct from old.uploaded_at)
     or (old.first_byte_evidence_at is not null
         and (new.first_byte_evidence_at is distinct from old.first_byte_evidence_at
              or new.first_byte_evidence_source is distinct from old.first_byte_evidence_source)) then
    raise exception 'حقل يُكتب مرة واحدة' using errcode = 'insufficient_privilege';
  end if;
  if new.state is distinct from old.state then
    if not (
         (old.state = 'started'    and new.state in ('uploaded', 'rejected', 'expired', 'cancelled'))
      -- uploaded/validating → cancelled: إفراج المالكة (يفرضه الخادم)، ويلزمه release_note بقيد الجدول.
      or (old.state = 'uploaded'   and new.state in ('validating', 'rejected', 'cancelled'))
      -- validating → uploaded: استئناف التحقق بعد تعطل/تأخر، لا رفض بسبب التأخير.
      or (old.state = 'validating' and new.state in ('accepted', 'rejected', 'uploaded', 'cancelled'))
    ) then
      raise exception 'انتقال حالة غير مسموح: % → %', old.state, new.state using errcode = 'insufficient_privilege';
    end if;
    -- النافذة تُلزَم في القاعدة: لا uploaded عند/بعد الانقضاء، ولا expired قبله.
    if old.state = 'started' and new.state = 'uploaded' and now() >= old.expires_at then
      raise exception 'انقضت نافذة الرفع' using errcode = 'check_violation';
    end if;
    if new.state = 'expired' and now() < old.expires_at then
      raise exception 'لم تنقضِ نافذة الرفع بعد' using errcode = 'check_violation';
    end if;
    -- الأزمنة من ساعة القاعدة.
    if old.state = 'started' and new.state = 'uploaded' then new.uploaded_at := now(); end if;
    if new.state = 'validating' then new.validating_at := now(); end if;
    if old.state = 'validating' and new.state <> 'validating' then new.validating_at := null; end if;
    if new.state = 'accepted' then new.validated_at := now(); end if;
    if new.state in ('accepted', 'rejected', 'expired', 'cancelled') then new.finished_at := now(); end if;
  end if;
  return new;
end
$$;
create trigger upload_sessions_guard_update_bu
  before update on public.upload_sessions
  for each row execute function public.upload_sessions_guard_update();

create trigger upload_sessions_no_delete
  before delete on public.upload_sessions
  for each row execute function public.forbid_delete();
create trigger upload_sessions_no_truncate
  before truncate on public.upload_sessions
  for each statement execute function public.forbid_mutation();

-- (ب) ربط الإصدار بجلسته (يعالج G-4)
alter table public.versions
  add column upload_session_id uuid unique references public.upload_sessions (id) on delete restrict;

alter table public.versions
  add constraint versions_file_verified check (
    kind <> 'file'
    or (validated_at is not null and validation_result is not null and upload_session_id is not null));

-- (C-4) اتساق الإصدار مع جلسته: لا يُدرَج إصدار ملف إلا وجلسته validating وبياناتها تطابق ما قيس.
create or replace function public.versions_match_session()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  s public.upload_sessions%rowtype;
begin
  if new.kind <> 'file' then
    return new;
  end if;
  select * into s from public.upload_sessions where id = new.upload_session_id;
  if not found then
    raise exception 'جلسة الرفع غير موجودة' using errcode = 'check_violation';
  end if;
  if s.state <> 'validating' then
    raise exception 'لا يُسجَّل إصدار إلا من جلسة في حالة validating' using errcode = 'check_violation';
  end if;
  if (s.teacher_id, s.term_id, s.slot_id) is distinct from (new.teacher_id, new.term_id, new.slot_id) then
    raise exception 'الإصدار لا يطابق معلمة/فصل/خانة الجلسة' using errcode = 'check_violation';
  end if;
  if new.submitted_at is distinct from s.effective_start_at then
    raise exception 'وقت التسليم يجب أن يطابق وقت البدء المعتمد للجلسة' using errcode = 'check_violation';
  end if;
  if new.status_snapshot is distinct from s.status_at_start then
    raise exception 'حالة التسليم يجب أن تطابق حالة بدء الجلسة' using errcode = 'check_violation';
  end if;
  if new.size_bytes is distinct from s.verified_size or new.sha256 is distinct from s.verified_sha256 then
    raise exception 'حجم الملف وبصمته يجب أن يطابقا ما قيس عند التحقق' using errcode = 'check_violation';
  end if;
  return new;
end
$$;
create trigger versions_match_session_bi
  before insert on public.versions
  for each row execute function public.versions_match_session();

-- (ج) محاولات الرفع: إضافة فقط، بلا ip_hash (تقليل بيانات — C-9، توصية تحتاج موافقتك)
create table public.upload_attempts (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  teacher_id  uuid not null references public.teachers (id) on delete restrict,
  session_id  uuid references public.upload_sessions (id) on delete restrict,
  outcome     text not null check (outcome in
    ('started','start_rejected','duplicate_start','uploaded','accepted','rejected','expired','duplicate_complete','denied','cancelled',
     'validation_deferred','validation_recovered','owner_released','evidence_recorded','start_inherited')),
  reason      text
);
create index upload_attempts_at on public.upload_attempts (at);
create index upload_attempts_teacher_at on public.upload_attempts (teacher_id, at);

-- (C-2) إضافة فقط: لا تعديل ولا حذف ولا TRUNCATE (حتى من خدمة الخادم؛ المشغّلات لا يتجاوزها service_role).
create trigger upload_attempts_no_mutation
  before update or delete on public.upload_attempts
  for each row execute function public.forbid_mutation();
create trigger upload_attempts_no_truncate
  before truncate on public.upload_attempts
  for each statement execute function public.forbid_mutation();

-- (C-1) أقل صلاحية لقراءة المالكة: سحب كل شيء ثم منح SELECT على أعمدة محددة + RLS للمالكة فقط.
alter table public.upload_attempts enable row level security;
revoke all on public.upload_attempts from public, anon, authenticated;
revoke all on sequence public.upload_attempts_id_seq from public, anon, authenticated;
grant select (id, at, teacher_id, session_id, outcome, reason) on public.upload_attempts to authenticated;
create policy upload_attempts_select on public.upload_attempts for select to authenticated
  using (public.current_staff_role() = 'owner');
-- لا policy إدراج/تعديل/حذف ولا منح كتابة: الكتابة بخدمة الخادم فقط.
-- ملاحظة: مع منح الأعمدة لا يصلح SELECT * من العميل؛ تُسمّى الأعمدة صراحة (كما في teacher_credentials).

-- اقتراح (يحتاج موافقتك، غير مفعّل): قراءة المالكة لأزمنة الجلسات لمراجعة اعتراضات المواعيد، دون pending_key وprovider_upload_ref:
--   grant select (id, teacher_id, term_id, slot_id, declared_name, declared_size, state, reject_reason,
--                 status_at_start, started_at, expires_at, uploaded_at, validated_at, finished_at)
--     on public.upload_sessions to authenticated;
--   create policy upload_sessions_select on public.upload_sessions for select to authenticated
--     using (public.current_staff_role() = 'owner');

-- D-8: أعمدة first_byte_evidence_* أُضيفت معلوماتية فقط؛ لا يُبنى عليها حساب التأخير ولا submitted_at قبل قياس T1 فعليًا واعتماد المالكة (Q-4).
-- مرشَّح لـD-9: سبب platform_fault وعمود inherits_status_from — غير مضاف قبل اعتماد الآلية.
-- لا purge_old_upload_attempts ولا عمود احتفاظ (D-10: لا حذف تلقائي).
-- دالة register_upload_version(session_id) تُكتب في 5.4 وتُختبر على قاعدة فعلية.

-- ============================================================================
-- [الدفعة 1 م3، 2026-10-21] إضافة كشفها تشغيل اختبار الصلاحيات (supabase/02_security_check.sql) بعد تطبيق 004 فوق 003:
-- (1) دوال المشغّلات الجديدة تُمنح EXECUTE لـPUBLIC افتراضيًا (revoke في 003 لا يشمل ما يُنشأ بعده)؛ تُسحب صراحةً.
-- (ملاحظة: versions.upload_session_id يبقى غير مقروء للمسجّلين عمدًا؛ اختبار 20_sessions_004 يفرض ذلك.)
-- هذه الإضافة في database/004_upload_tables.sql فقط؛ drafts/…DRAFT-v4.sql تبقى كما كانت للتاريخ.
-- ============================================================================
revoke execute on function public.upload_sessions_guard_insert() from public, anon, authenticated;
revoke execute on function public.upload_sessions_guard_update() from public, anon, authenticated;
revoke execute on function public.versions_match_session() from public, anon, authenticated;

