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
