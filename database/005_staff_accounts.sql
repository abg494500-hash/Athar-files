-- ============================================================================
-- أثَر — الملف 5/5: حسابات المسؤولين (المالكة والمديرة) وحمايتها — **بلا تحقق بخطوتين** (A-98، 2026-10-23)
-- ----------------------------------------------------------------------------
-- حالة هذا الملف: **غير منفَّذ على أي PostgreSQL ولا على Supabase** (لا PostgreSQL في بيئة كتابته). يُنفَّذ بعد 001..004
-- في مشروع فارغ ببيانات وهمية، ويمكن إعادة تشغيله (create or replace + drop trigger if exists) داخل معاملة واحدة.
-- يحلّ محل النسخة القديمة `005_staff_mfa.sql` (محفوظة في database/archive/005_staff_mfa.v0.6.6.sql) التي كانت تشترط aal2.
-- لا يُعدِّل 001..004، ولا أسرار ولا بيانات حقيقية فيه.
--
-- ما يفعله:
--  (1) current_staff_role() ترجع الدور لمن تحمل جلسة مصادَق عليها وصفًّا نشطًا في staff_profiles فقط. لا يُشترط TOTP.
--      الحماية: بريد مسجَّل في Supabase Auth + كلمة مرور صحيحة + صف نشط في staff_profiles (لا يُنشأ إلا عبر bootstrap_staff)
--      + سياسات RLS لكل دور. مستخدمة بلا صف نشط ⇒ لا دور ⇒ لا ترى شيئًا (RLS تفشل مغلقةً).
--      لا أثر على مسار الخادم (service_role): auth.uid() فيه null فلا دور له أصلًا.
--  (2) bootstrap_staff(email, role): الطريقة الوحيدة لإنشاء مسؤولة/مدير أولي، ومحصورة بمالك قاعدة البيانات (postgres عبر
--      SQL Editor)؛ سُحب EXECUTE من public وanon وauthenticated وservice_role صراحةً.
--  (3) مشغّل على staff_profiles: لا إدراج إلا من bootstrap_staff، ولا حذف، ولا تغيير للمعرّف/الدور/تاريخ الإنشاء
--      (التعطيل بـis_active فقط). الحاجز الحقيقي هو غياب أي منح كتابة للأدوار التطبيقية (مُختبَر)، والمشغّل طبقة ثانية.
-- ملاحظة: إلغاء TOTP يُضعف حماية حسابات تملك صلاحيات واسعة (المالكة تنزّل الأرشيف وتدير الحذف)، فكلمة المرور القوية الفريدة
--   وحماية Supabase Auth من المحاولات المتكررة وكلمات المرور المسرَّبة هي خط الدفاع الوحيد للحساب نفسه (انظر docs/phase5/STAFF_ACCOUNTS_AND_MFA.md).
-- ============================================================================

begin;

-- 1) current_staff_role: دور المسؤولة النشطة المصادَق عليها (بكلمة مرور صحيحة) دون أي شرط تحقق إضافي (A-98).
--    هذا هو التعريف نفسه في 002_integrity.sql: إعادة تشغيل هذا الملف على قاعدة نُفِّذت عليها النسخة القديمة (aal2) تعيد
--    الدالة إلى هذا التعريف (create or replace) دون المساس بصلاحياتها (grant execute من 003 يبقى).
create or replace function public.current_staff_role()
returns text language sql stable security definer set search_path = ''
as $$
  select role from public.staff_profiles where user_id = auth.uid() and is_active
$$;

-- 2) حارس staff_profiles
create or replace function public.staff_profiles_guard()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'لا حذف لحسابات المسؤولين: تُعطَّل بـis_active فقط' using errcode = 'insufficient_privilege';
  elsif tg_op = 'INSERT' then
    if current_setting('app.via_bootstrap_staff', true) is distinct from 'on' then
      raise exception 'حسابات المسؤولين تُنشأ عبر bootstrap_staff فقط' using errcode = 'insufficient_privilege';
    end if;
    return new;
  else
    if (new.user_id, new.role, new.created_at) is distinct from (old.user_id, old.role, old.created_at) then
      raise exception 'لا يُغيَّر معرّف المسؤولة ولا دورها ولا تاريخ إنشائها' using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;
end
$$;

drop trigger if exists staff_profiles_guard_biud on public.staff_profiles;
create trigger staff_profiles_guard_biud
  before insert or update or delete on public.staff_profiles
  for each row execute function public.staff_profiles_guard();

-- 3) إنشاء الحساب الأولي (مالك قاعدة البيانات فقط). المستخدم يُنشأ أولًا من لوحة Supabase (Authentication → Users).
create or replace function public.bootstrap_staff(p_email text, p_role text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid;
begin
  if p_role is null or p_role not in ('owner', 'director') then
    raise exception 'دور غير صالح' using errcode = 'check_violation';
  end if;
  if coalesce(btrim(p_email), '') = '' then
    raise exception 'البريد مطلوب' using errcode = 'check_violation';
  end if;

  select u.id into v_uid from auth.users u where lower(u.email) = lower(btrim(p_email));
  if v_uid is null then
    raise exception 'المستخدم غير موجود: أنشئيه أولًا من Authentication → Users' using errcode = 'no_data_found';
  end if;

  if exists (select 1 from public.staff_profiles where user_id = v_uid) then
    raise exception 'هذا المستخدم مسجَّل مسؤولًا من قبل' using errcode = 'unique_violation';
  end if;
  if exists (select 1 from public.staff_profiles where role = p_role and is_active) then
    raise exception 'يوجد حساب نشط لهذا الدور' using errcode = 'unique_violation';
  end if;

  perform set_config('app.via_bootstrap_staff', 'on', true);
  insert into public.staff_profiles (user_id, role) values (v_uid, p_role);
  perform set_config('app.via_bootstrap_staff', 'off', true);

  perform public.log_audit('staff.bootstrap', 'staff', v_uid::text, jsonb_build_object('role', p_role));
  return v_uid;
end
$$;

-- 4) الصلاحيات: bootstrap_staff لا يُنفَّذ إلا من مالك الدالة (postgres). service_role يُسحب صراحةً لأن
--    صلاحيات Supabase الافتراضية قد تمنحه تنفيذ كل دالة جديدة (افتراض غير متحقَّق منه).
revoke all on function public.bootstrap_staff(text, text) from public, anon, authenticated, service_role;
revoke execute on function public.staff_profiles_guard() from public, anon, authenticated;

commit;
