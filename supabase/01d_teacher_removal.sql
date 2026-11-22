-- أثَر — ملف 01d (مولَّد من database/008_teacher_removal.sql؛ لا تعدّليه يدويًا).
-- يُنفَّذ **بعد 01c** ونجاح 03b، مرة واحدة (إعادة التشغيل آمنة). يضيف حذف المعلمة بعد الأرشفة (محو الاسم) للمالكة وحدها.
-- ============================================================================
-- 008 — حذف المعلمة بعد الأرشفة (A-114، 2026-11-14، بطلب صاحبة المشروع)
-- يُنفَّذ بعد 001..007. لا حذف فعليًا لصفوف معلمة لها إصدارات: الإصدارات وسجل العمليات وعناصر الأرشيف
-- لا تُحذف (A-44) والمفاتيح الأجنبية restrict. «الحذف» هنا = **محو الاسم** وإخفاء المعلمة من القوائم وإبطال دخولها،
-- ولا يُسمح به إلا إن كانت **كل** إصداراتها داخل أرشيف متحقَّق منه ومنزَّل ومتحقَّق من بصمته. الملفات في التخزين لا تُمسّ هنا.
-- المالكة وحدها (يُتحقق من staff_profiles داخل الدالة). التدقيق يُسجَّل بلا اسم المعلمة.
-- ============================================================================
begin;

alter table public.teachers add column if not exists removed_at timestamptz;

create or replace function public.remove_teacher(p_actor uuid, p_teacher uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_role text;
  v_t public.teachers%rowtype;
  v_total integer;
  v_unarchived integer;
begin
  select sp.role into v_role from public.staff_profiles sp where sp.user_id = p_actor and sp.is_active;
  if v_role is distinct from 'owner' then
    raise exception 'المالكة وحدها تحذف المعلمات' using errcode = 'insufficient_privilege';
  end if;
  select * into v_t from public.teachers where id = p_teacher for update;
  if not found or v_t.removed_at is not null then
    raise exception 'المعلمة غير موجودة' using errcode = 'no_data_found';
  end if;

  select count(*) into v_total from public.versions where teacher_id = p_teacher;
  select count(*) into v_unarchived from public.versions v
   where v.teacher_id = p_teacher
     and not exists (
       select 1 from public.archive_entries e join public.archives a on a.id = e.archive_id
        where e.version_id = v.id and a.state = 'verified'
          and a.download_completed_at is not null and a.download_hash_verified_at is not null);
  if v_unarchived > 0 then
    raise exception 'لا يمكن الحذف: % من إصدارات المعلمة ليست في أرشيف متحقَّق منه ومنزَّل', v_unarchived using errcode = 'check_violation';
  end if;

  update public.teachers set name = 'معلمة محذوفة', is_active = false, removed_at = now() where id = p_teacher;
  update public.teacher_credentials
     set code_state = 'revoked', code_hash = null, pin_hash = null, failed_attempts = 0, locked_until = null
   where teacher_id = p_teacher;
  update public.teacher_sessions set revoked_at = now() where teacher_id = p_teacher and revoked_at is null;
  perform public.log_audit_as(p_actor, 'owner.remove_teacher', 'teacher', p_teacher::text,
                              jsonb_build_object('versions', v_total, 'all_archived', true));
  return jsonb_build_object('versions', v_total);
end
$$;
revoke all on function public.remove_teacher(uuid, uuid) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.remove_teacher(uuid, uuid) to service_role;
  end if;
end $$;

commit;
