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
