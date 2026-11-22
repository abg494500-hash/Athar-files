-- أثَر — ملف 01g (مولَّد من database/011_years_teachers_import.sql؛ لا تعدّليه يدويًا).
-- يُنفَّذ **بعد 01f** ونجاح 03e، مرة واحدة (إعادة التشغيل آمنة). عمودان اختياريان في years + دوال إدارة السنوات واستيراد المعلمات. **لا يحذف ولا يعدّل بيانات قائمة.**
-- ============================================================================
-- 011 — إدارة السنوات والفصول + استيراد المعلمات (A-119، 2026-11-15، r36)
-- يُنفَّذ بعد 001..010، مرة واحدة (إعادة التشغيل آمنة). **لا يحذف ولا يعدّل بيانات قائمة**:
--   • عمودان اختياريان جديدان في years (starts_on, ends_on): فارغان للسنوات الحالية.
--   • دوال للمالكة فقط (تُستدعى من خادم الواجهة بمفتاح الخدمة، وتتحقق من أن المنفِّذة مالكة نشطة داخل القاعدة نفسها):
--       create_year_with_terms  (سنة + فصلان + مواعيد في معاملة واحدة؛ إما كلها أو لا شيء)
--       update_year             (تعديل السنة/فصليها **قبل بدء العمل فقط**: لا تسليمات ولا جلسات رفع ولا أرشيفات ولا تصفير)
--       activate_year           (سنة واحدة نشطة؛ لا تفعيل لسنة مغلقة بالتصفير)
--       import_teachers         (استيراد ذرّي: كل الصفوف أو لا شيء؛ كشف تكرار بالاسم+المادة) — للمالكة **والمديرة** (r37)
--   • r37: المديرة تستطيع تسجيل المعلمات (إضافة/تعديل/استيراد/إصدار رمز): سياسات RLS للمعلمات وقراءة حالة الرموز تشمل المديرة،
--     وأُغلق تحديث أعمدة المعلمات الحساسة (removed_at وغيرها) مباشرة على كل الأدوار؛ الحذف بعد الأرشفة يبقى للمالكة وحدها.
--   • r37: إن لم توجد أي سنة نشطة فإن السنة الجديدة تصبح نشطة تلقائيًا (وإلا تظهر بوابة المعلمة بلا فصول).
-- ============================================================================
begin;

alter table public.years add column if not exists starts_on date;
alter table public.years add column if not exists ends_on date;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'years_dates_order') then
    alter table public.years add constraint years_dates_order check (starts_on is null or ends_on is null or starts_on < ends_on);
  end if;
end $$;

create or replace function public.owner_actor_check(p_actor uuid)
returns void language plpgsql stable security definer set search_path = ''
as $$
begin
  if p_actor is null or not exists (select 1 from public.staff_profiles where user_id = p_actor and role = 'owner' and is_active) then
    raise exception 'هذا الإجراء للمالكة فقط' using errcode = 'insufficient_privilege';
  end if;
end
$$;
revoke all on function public.owner_actor_check(uuid) from public, anon, authenticated;

-- المالكة أو المديرة (موظفة نشطة): لتسجيل المعلمات واستيرادهن. السنوات والتصفير والحذف تبقى للمالكة وحدها (owner_actor_check).
create or replace function public.staff_actor_check(p_actor uuid)
returns void language plpgsql stable security definer set search_path = ''
as $$
begin
  if p_actor is null or not exists (select 1 from public.staff_profiles where user_id = p_actor and role in ('owner', 'director') and is_active) then
    raise exception 'هذا الإجراء للمالكة أو المديرة فقط' using errcode = 'insufficient_privilege';
  end if;
end
$$;
revoke all on function public.staff_actor_check(uuid) from public, anon, authenticated;

create or replace function public.norm_text(t text)
returns text language sql immutable set search_path = ''
as $$ select lower(regexp_replace(btrim(coalesce(t, '')), '\s+', ' ', 'g')) $$;
revoke all on function public.norm_text(text) from public, anon, authenticated;

-- التحقق المشترك من مصفوفة الفصلين: [{ord,name,deadline_base,deadline_late,deadline_replace}, …] بفصلين 1 و2 بالضبط
create or replace function public.year_terms_validate(p_terms jsonb, p_starts date, p_ends date)
returns void language plpgsql immutable set search_path = ''
as $$
declare t jsonb; v_ords int[] := '{}'; b date; l date; r date;
begin
  if p_terms is null or jsonb_typeof(p_terms) <> 'array' or jsonb_array_length(p_terms) <> 2 then
    raise exception 'يجب تحديد فصلين دراسيين' using errcode = 'check_violation';
  end if;
  for t in select * from jsonb_array_elements(p_terms) loop
    v_ords := array_append(v_ords, (t->>'ord')::int);
    if coalesce(btrim(t->>'name'), '') = '' or length(t->>'name') > 60 then raise exception 'اسم الفصل غير صالح' using errcode = 'check_violation'; end if;
    b := (t->>'deadline_base')::date; l := (t->>'deadline_late')::date; r := (t->>'deadline_replace')::date;
    if b is null or l is null or r is null or b > l or l > r then
      raise exception 'مواعيد الفصل % غير مرتبة (الأساسي ≤ المتأخر ≤ الاستبدال)', t->>'ord' using errcode = 'check_violation';
    end if;
    if p_starts is not null and b < p_starts then raise exception 'موعد التسليم قبل بداية السنة' using errcode = 'check_violation'; end if;
    if p_ends is not null and r > p_ends then raise exception 'موعد الاستبدال بعد نهاية السنة' using errcode = 'check_violation'; end if;
  end loop;
  if not (1 = any (v_ords) and 2 = any (v_ords)) then raise exception 'الفصلان يجب أن يكونا 1 و2' using errcode = 'check_violation'; end if;
end
$$;
revoke all on function public.year_terms_validate(jsonb, date, date) from public, anon, authenticated;

create or replace function public.create_year_with_terms(p_actor uuid, p_label text, p_starts date, p_ends date, p_terms jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_id uuid; t jsonb; v_label text := regexp_replace(btrim(coalesce(p_label, '')), '\s+', ' ', 'g'); v_first boolean;
begin
  perform public.staff_actor_check(p_actor);
  if length(v_label) < 3 or length(v_label) > 30 then raise exception 'اسم السنة بين 3 و30 حرفًا' using errcode = 'check_violation'; end if;
  if p_starts is not null and p_ends is not null and p_starts >= p_ends then raise exception 'بداية السنة يجب أن تسبق نهايتها' using errcode = 'check_violation'; end if;
  perform public.year_terms_validate(p_terms, p_starts, p_ends);
  perform pg_advisory_xact_lock(hashtextextended('activate_year', 0));
  v_first := not exists (select 1 from public.years where is_active); -- لا سنة نشطة (أول سنة أو بعد تصفير) ⇒ تصبح هذه نشطة فلا تبقى بوابة المعلمات بلا فصول
  insert into public.years (label, is_active, starts_on, ends_on) values (v_label, v_first, p_starts, p_ends) returning id into v_id; -- تكرار الاسم ⇒ 23505
  for t in select * from jsonb_array_elements(p_terms) loop
    insert into public.terms (year_id, name, ord, deadline_base, deadline_late, deadline_replace)
    values (v_id, btrim(t->>'name'), (t->>'ord')::smallint, (t->>'deadline_base')::date, (t->>'deadline_late')::date, (t->>'deadline_replace')::date);
  end loop;
  perform public.log_audit_as(p_actor, 'year.create', 'year', v_id::text, jsonb_build_object('label', v_label, 'starts_on', p_starts, 'ends_on', p_ends, 'activated', v_first));
  return v_id;
end
$$;
revoke all on function public.create_year_with_terms(uuid, text, date, date, jsonb) from public, anon, authenticated;

-- «بدء العمل» على سنة = أي تسليم أو إصدار أو جلسة رفع أو أرشيف أو عملية تصفير
create or replace function public.year_work_started(p_year uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.submissions s join public.terms t on t.id = s.term_id where t.year_id = p_year)
      or exists (select 1 from public.versions v join public.terms t on t.id = v.term_id where t.year_id = p_year)
      or exists (select 1 from public.upload_sessions s join public.terms t on t.id = s.term_id where t.year_id = p_year)
      or exists (select 1 from public.archives a where a.year_id = p_year)
      or exists (select 1 from public.year_resets r where r.year_id = p_year)
$$;
revoke all on function public.year_work_started(uuid) from public, anon, authenticated;

create or replace function public.update_year(p_actor uuid, p_year uuid, p_label text, p_starts date, p_ends date, p_terms jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
declare t jsonb; v_label text := regexp_replace(btrim(coalesce(p_label, '')), '\s+', ' ', 'g'); v_old public.years%rowtype;
  v_starts date; v_ends date; v_n int := 0; v_rows int;
begin
  perform public.staff_actor_check(p_actor);
  select * into v_old from public.years where id = p_year for update;
  if not found then raise exception 'السنة غير موجودة' using errcode = 'no_data_found'; end if;
  if public.year_work_started(p_year) then
    raise exception 'بدأ العمل على هذه السنة (تسليمات أو أرشفة أو تصفير): لا يُعدَّل تعريفها. المواعيد تُعدَّل من صفحة المواعيد بسبب مسجَّل.' using errcode = 'check_violation';
  end if;
  if length(v_label) < 3 or length(v_label) > 30 then raise exception 'اسم السنة بين 3 و30 حرفًا' using errcode = 'check_violation'; end if;
  -- التواريخ الفارغة تُبقي المحفوظة؛ التحقق يجري على القيم بعد الدمج لا على المُرسَل وحده
  v_starts := coalesce(p_starts, v_old.starts_on); v_ends := coalesce(p_ends, v_old.ends_on);
  if v_starts is not null and v_ends is not null and v_starts >= v_ends then raise exception 'بداية السنة يجب أن تسبق نهايتها' using errcode = 'check_violation'; end if;
  perform public.year_terms_validate(p_terms, v_starts, v_ends);
  update public.years set label = v_label, starts_on = v_starts, ends_on = v_ends where id = p_year;
  perform set_config('app.via_set_term_deadlines', 'on', true);
  for t in select * from jsonb_array_elements(p_terms) loop
    update public.terms set name = btrim(t->>'name'), deadline_base = (t->>'deadline_base')::date,
           deadline_late = (t->>'deadline_late')::date, deadline_replace = (t->>'deadline_replace')::date
     where year_id = p_year and ord = (t->>'ord')::smallint;
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then raise exception 'الفصل % غير موجود في هذه السنة: أُلغي التعديل' , t->>'ord' using errcode = 'check_violation'; end if;
    v_n := v_n + v_rows;
  end loop;
  if v_n <> 2 then raise exception 'يجب تعديل فصلين موجودين بالضبط: أُلغي التعديل' using errcode = 'check_violation'; end if;
  perform set_config('app.via_set_term_deadlines', 'off', true);
  perform public.log_audit_as(p_actor, 'year.update', 'year', p_year::text, jsonb_build_object('old_label', v_old.label, 'label', v_label, 'starts_on', v_starts, 'ends_on', v_ends));
end
$$;
revoke all on function public.update_year(uuid, uuid, text, date, date, jsonb) from public, anon, authenticated;

create or replace function public.activate_year(p_actor uuid, p_year uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform public.staff_actor_check(p_actor);
  perform pg_advisory_xact_lock(hashtextextended('activate_year', 0));
  if not exists (select 1 from public.years where id = p_year) then raise exception 'السنة غير موجودة' using errcode = 'no_data_found'; end if;
  if exists (select 1 from public.year_resets where year_id = p_year) then
    raise exception 'السنة أُغلقت بالتصفير ولا يمكن تفعيلها' using errcode = 'check_violation';
  end if;
  update public.years set is_active = false where is_active and id <> p_year;
  update public.years set is_active = true where id = p_year;
  perform public.log_audit_as(p_actor, 'year.activate', 'year', p_year::text, '{}'::jsonb);
end
$$;
revoke all on function public.activate_year(uuid, uuid) from public, anon, authenticated;

-- استيراد المعلمات الذرّي: [{name, subject}] ⇒ يُدرج الكل أو لا شيء. تكرار (الاسم+المادة) داخل الدفعة أو مع معلمة موجودة ⇒ رفض الدفعة كلها.
create or replace function public.import_teachers(p_actor uuid, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare r jsonb; i int := 0; v_base int; v_id uuid; v_out jsonb := '[]'::jsonb; v_dups jsonb := '[]'::jsonb; v_seen text[] := '{}'; k text; v_name text; v_subj text;
begin
  perform public.staff_actor_check(p_actor);
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > 300 then
    raise exception 'عدد الصفوف يجب أن يكون بين 1 و300' using errcode = 'check_violation';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('import_teachers', 0));
  select count(*) into v_base from public.teachers;
  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    v_name := regexp_replace(btrim(coalesce(r->>'name', '')), '\s+', ' ', 'g');
    v_subj := regexp_replace(btrim(coalesce(r->>'subject', '')), '\s+', ' ', 'g');
    if length(v_name) < 3 or length(v_name) > 80 or length(v_subj) < 2 or length(v_subj) > 60 then
      raise exception 'صف % غير صالح', i using errcode = 'check_violation';
    end if;
    k := public.norm_text(v_name) || '|' || public.norm_text(v_subj);
    if k = any (v_seen) or exists (select 1 from public.teachers t where public.norm_text(t.name) = public.norm_text(v_name) and public.norm_text(t.subject) = public.norm_text(v_subj)) then
      v_dups := v_dups || jsonb_build_object('index', i, 'name', v_name);
    end if;
    v_seen := array_append(v_seen, k);
  end loop;
  if jsonb_array_length(v_dups) > 0 then
    raise exception 'تكرار: %', v_dups::text using errcode = 'unique_violation';
  end if;
  i := 0;
  for r in select * from jsonb_array_elements(p_rows) loop
    insert into public.teachers (name, subject, color_idx, created_by)
    values (regexp_replace(btrim(r->>'name'), '\s+', ' ', 'g'), regexp_replace(btrim(r->>'subject'), '\s+', ' ', 'g'), ((v_base + i) % 8)::smallint, p_actor)
    returning id into v_id;
    v_out := v_out || jsonb_build_object('id', v_id, 'index', i + 1);
    i := i + 1;
  end loop;
  perform public.log_audit_as(p_actor, 'teachers.import', 'teachers', null, jsonb_build_object('count', i));
  return jsonb_build_object('imported', v_out);
end
$$;
revoke all on function public.import_teachers(uuid, jsonb) from public, anon, authenticated;

-- يستعمله الخادم لعرض المعلمات الموجودة وكشف التكرار في المعاينة (أسماء ومواد فقط)
create or replace function public.teachers_for_import_check()
returns jsonb language sql stable security definer set search_path = ''
as $$ select coalesce(jsonb_agg(jsonb_build_object('name', name, 'subject', subject)), '[]'::jsonb) from public.teachers where removed_at is null $$;
revoke all on function public.teachers_for_import_check() from public, anon, authenticated;

-- ===== r37: تسجيل المعلمات للمديرة أيضًا (سياسات الصفوف + قراءة حالة الرموز) =====
drop policy if exists teachers_insert on public.teachers;
create policy teachers_insert on public.teachers for insert to authenticated
  with check (public.current_staff_role() in ('owner', 'director'));
drop policy if exists teachers_update on public.teachers;
create policy teachers_update on public.teachers for update to authenticated
  using (public.current_staff_role() in ('owner', 'director')) with check (public.current_staff_role() in ('owner', 'director'));
drop policy if exists teacher_credentials_select on public.teacher_credentials;
create policy teacher_credentials_select on public.teacher_credentials for select to authenticated
  using (public.current_staff_role() in ('owner', 'director'));
-- تضييق: تعديل المعلمة المباشر لأربعة أعمدة عادية فقط (الاسم والمادة والتفعيل واللون)؛ removed_at وغيرها لا تُمسّ إلا بدالة الحذف بعد الأرشفة.
revoke update on public.teachers from authenticated;
grant update (name, subject, is_active, color_idx) on public.teachers to authenticated;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.owner_actor_check(uuid), public.staff_actor_check(uuid), public.norm_text(text), public.year_terms_validate(jsonb, date, date),
      public.create_year_with_terms(uuid, text, date, date, jsonb), public.year_work_started(uuid), public.update_year(uuid, uuid, text, date, date, jsonb),
      public.activate_year(uuid, uuid), public.import_teachers(uuid, jsonb), public.teachers_for_import_check() to service_role;
  end if;
end $$;

commit;
