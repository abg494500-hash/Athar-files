-- أثَر — ملف 01i (مولَّد من database/015_reset_teachers.sql؛ لا تعدّليه يدويًا).
-- يُنفَّذ **بعد 01h** ونجاح 03g، **وقبل نشر دالة api الجديدة**. التصفير السنوي يحذف حسابات المعلمات اللاتي لا أثر لهن في سنة أخرى. معاملة واحدة؛ دوال فقط ولا يعدّل بيانات عند تنفيذه.
-- ============================================================================
-- 015 — التصفير السنوي يحذف المعلمات أيضًا (r41، بطلب صاحبة المشروع: «عند التصفير تنحذف المعلمات كذلك»). يُنفَّذ بعد 010 و013 و014.
-- إعادة تعريف دالتين بـ create or replace (year_reset_report وyear_reset_purge)؛ لا يحذف ولا يعدّل بيانات عند تنفيذه.
-- القاعدة: بعد حذف بيانات السنة تُحذف حسابات المعلمات (الصف والرمز وجلسات الدخول) اللاتي لا أثر لهن في أي سنة أخرى. من بقيت لها بيانات
-- في سنة أخرى تبقى (قيد المفاتيح الأجنبية)، ويُعرض عددهن في التقرير. حسابا المالكة والمديرة وaudit_log لا يُمسّان (يُتحقَّق منهما في المعاملة).
-- التعطيل المؤقت لمشغّل teachers_no_delete داخل المعاملة نفسها ثم إعادته (نمط التصفير نفسه).
-- ============================================================================
begin;

create or replace function public.year_reset_report(p_year uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_label text; v_arch uuid; v_gate jsonb; v_title text;
  c_teachers bigint; c_sub bigint; c_ver bigint; c_files bigint; c_links bigint; c_bytes bigint; c_parts bigint;
  c_sess bigint; c_att bigint; c_gone bigint; c_arch bigint; c_ent bigint; c_keys bigint; v_parts jsonb;
begin
  select label into v_label from public.years where id = p_year;
  if not found then return null; end if;
  v_gate := public.year_reset_gate(p_year);
  v_arch := nullif(v_gate->>'archiveId', '')::uuid;
  select count(distinct s.teacher_id), count(*) into c_teachers, c_sub
    from public.submissions s join public.terms t on t.id = s.term_id where t.year_id = p_year;
  select count(*), count(*) filter (where v.kind = 'file'), count(*) filter (where v.kind = 'link'), coalesce(sum(v.size_bytes), 0)
    into c_ver, c_files, c_links, c_bytes
    from public.versions v join public.terms t on t.id = v.term_id where t.year_id = p_year;
  select count(*) into c_sess from public.upload_sessions s join public.terms t on t.id = s.term_id where t.year_id = p_year;
  select count(*) into c_att from public.upload_attempts u where u.session_id in
    (select s.id from public.upload_sessions s join public.terms t on t.id = s.term_id where t.year_id = p_year);
  select count(*) into c_arch from public.archives where year_id = p_year;
  select count(*) into c_ent from public.archive_entries e join public.archives x on x.id = e.archive_id where x.year_id = p_year;
  select count(*) into c_parts from public.archive_parts p join public.archives x on x.id = p.archive_id where x.year_id = p_year;
  select count(distinct k) into c_keys from (
    select v.storage_key k from public.versions v join public.terms t on t.id = v.term_id where t.year_id = p_year and v.storage_key is not null
    union all select s.pending_key from public.upload_sessions s join public.terms t on t.id = s.term_id where t.year_id = p_year and s.pending_key is not null
    union all select x.storage_key from public.archives x where x.year_id = p_year and x.storage_key is not null and x.storage_provider is distinct from 'local-download') q;
  select coalesce(jsonb_agg(jsonb_build_object('part', p.part_no, 'filename', p.filename, 'sha256', p.sha256, 'size', p.size_bytes,
           'downloadVerified', p.verified_at is not null, 'copyVerified', p.copy_verified_at is not null, 'copyMedium', p.copy_medium) order by p.part_no), '[]'::jsonb)
    into v_parts from public.archive_parts p where p.archive_id = v_arch;
  -- المعلمات اللاتي يُحذفن مع السنة: من ليس لهن أي بيانات في سنة أخرى (r41)
  select count(*) into c_gone from public.teachers t
   where not exists (select 1 from public.submissions s join public.terms x on x.id = s.term_id where s.teacher_id = t.id and x.year_id <> p_year)
     and not exists (select 1 from public.upload_sessions s join public.terms x on x.id = s.term_id where s.teacher_id = t.id and x.year_id <> p_year)
     and not exists (select 1 from public.archives a where a.teacher_id = t.id and a.year_id <> p_year);
  select title into v_title from public.archives where id = v_arch;
  return jsonb_build_object(
    'yearId', p_year, 'yearLabel', v_label, 'archiveId', v_arch, 'archiveTitle', v_title,
    'gate', v_gate,
    'teachers', c_teachers, 'submissions', c_sub, 'versions', c_ver, 'files', c_files, 'links', c_links, 'fileBytes', c_bytes,
    'archiveParts', v_parts, 'archivePartsCount', jsonb_array_length(v_parts),
    'toDelete', jsonb_build_object('upload_attempts', c_att, 'upload_sessions', c_sess, 'versions', c_ver, 'submissions', c_sub,
                                   'archive_entries', c_ent, 'archive_parts', c_parts, 'archives', c_arch, 'r2_objects', c_keys, 'teachers', c_gone),
    'stays', jsonb_build_object(
      'staff_accounts', (select count(*) from public.staff_profiles),
      'teachers', (select count(*) from public.teachers) - c_gone,
      'other_years_versions', (select count(*) from public.versions v join public.terms t on t.id = v.term_id where t.year_id <> p_year),
      'audit_log', (select count(*) from public.audit_log)));
end
$$;
revoke all on function public.year_reset_report(uuid) from public, anon, authenticated;

create or replace function public.year_reset_purge(p_reset uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  r public.year_resets%rowtype; v_year uuid; v_label text; v_arch_title text; v_arch_ack boolean := false;
  b_other jsonb; a_other jsonb; b_audit bigint; a_audit bigint; b_audit_max bigint; a_audit_max bigint; b_staff bigint; a_staff bigint; b_teach bigint; a_teach bigint;
  d jsonb := '{}'::jsonb; n bigint; gone uuid[]; n_gone bigint; v_parts jsonb; v_ver jsonb;
  term_ids uuid[];
  trg text[][] := array[
    ['versions','versions_no_delete'], ['submissions','submissions_no_delete'], ['archives','archives_no_delete'],
    ['archive_entries','archive_entries_no_delete'], ['archive_parts','archive_parts_no_delete'],
    ['deletion_requests','deletion_requests_no_delete'], ['upload_sessions','upload_sessions_no_delete'],
    ['upload_sessions','upload_sessions_guard_update_bu'], ['upload_attempts','upload_attempts_no_mutation'], ['teachers','teachers_no_delete']];
  i int;
  other_counts text := $q$select jsonb_build_object(
      'versions', (select count(*) from public.versions v join public.terms t on t.id = v.term_id where t.year_id <> %1$L),
      'submissions', (select count(*) from public.submissions s join public.terms t on t.id = s.term_id where t.year_id <> %1$L),
      'sessions', (select count(*) from public.upload_sessions s join public.terms t on t.id = s.term_id where t.year_id <> %1$L),
      'archives', (select count(*) from public.archives where year_id <> %1$L),
      'terms', (select count(*) from public.terms), 'years', (select count(*) from public.years))$q$;
begin
  select * into r from public.year_resets where id = p_reset for update;
  if not found then raise exception 'عملية التصفير غير موجودة' using errcode = 'no_data_found'; end if;
  if r.state = 'completed' then return r.counters; end if;
  v_year := r.year_id;
  perform pg_advisory_xact_lock(hashtextextended('year_reset:' || v_year::text, 0));
  if exists (select 1 from public.year_reset_keys where reset_id = p_reset and state <> 'verified_absent') then
    raise exception 'ملفات R2 لم تُحذف وتُتحقَّق بعد' using errcode = 'check_violation';
  end if;
  -- كل مفتاح في القاعدة مغطّى بسجل المفاتيح (لا ملف يتيم يبقى في R2 بعد حذف صفّه)
  if exists (select 1 from public.versions v join public.terms t on t.id = v.term_id
              where t.year_id = v_year and v.storage_key is not null
                and not exists (select 1 from public.year_reset_keys k where k.reset_id = p_reset and k.storage_key = v.storage_key)) then
    raise exception 'مفتاح ملف غير مسجَّل في قائمة الحذف' using errcode = 'check_violation';
  end if;
  select label into v_label from public.years where id = v_year;
  select a.title, exists (select 1 from jsonb_array_elements(coalesce(a.checks, '[]'::jsonb)) e where e->>'check' = 'opened_locally_ack')
    into v_arch_title, v_arch_ack from public.archives a where a.id = r.archive_id;  -- قد لا يوجد أرشيف (التصفير بلا أرشفة مسموح)
  select coalesce(jsonb_agg(jsonb_build_object('part', p.part_no, 'sha256', p.sha256, 'size', p.size_bytes) order by p.part_no), '[]'::jsonb)
    into v_parts from public.archive_parts p where p.archive_id = r.archive_id;
  v_ver := jsonb_build_object('parts_download_verified', (select count(*) from public.archive_parts where archive_id = r.archive_id and verified_at is not null),
                              'parts_second_copy_verified', (select count(*) from public.archive_parts where archive_id = r.archive_id and copy_verified_at is not null),
                              'parts', (select count(*) from public.archive_parts where archive_id = r.archive_id),
                              'opened_locally_ack', coalesce(v_arch_ack, false));
  select array_agg(id) into term_ids from public.terms where year_id = v_year;

  execute format(other_counts, v_year::text) into b_other;
  select count(*), coalesce(max(id), 0) into b_audit, b_audit_max from public.audit_log;
  select count(*) into b_staff from public.staff_profiles;
  select count(*) into b_teach from public.teachers;

  for i in 1..array_length(trg, 1) loop
    execute format('alter table public.%I disable trigger %I', trg[i][1], trg[i][2]);
  end loop;

  delete from public.upload_attempts where session_id in (select id from public.upload_sessions where term_id = any (term_ids));
  get diagnostics n = row_count; d := d || jsonb_build_object('upload_attempts', n);
  delete from public.archive_entries where archive_id in (select id from public.archives where year_id = v_year);
  get diagnostics n = row_count; d := d || jsonb_build_object('archive_entries', n);
  delete from public.versions where term_id = any (term_ids);
  get diagnostics n = row_count; d := d || jsonb_build_object('versions', n);
  update public.upload_sessions set inherited_from = null where term_id = any (term_ids) and inherited_from is not null;
  delete from public.upload_sessions where term_id = any (term_ids);
  get diagnostics n = row_count; d := d || jsonb_build_object('upload_sessions', n);
  delete from public.submissions where term_id = any (term_ids);
  get diagnostics n = row_count; d := d || jsonb_build_object('submissions', n);
  delete from public.archive_parts where archive_id in (select id from public.archives where year_id = v_year);
  get diagnostics n = row_count; d := d || jsonb_build_object('archive_parts', n);
  delete from public.deletion_requests where year_id = v_year or archive_id in (select id from public.archives where year_id = v_year);
  get diagnostics n = row_count; d := d || jsonb_build_object('deletion_requests', n);
  delete from public.archives where year_id = v_year;
  get diagnostics n = row_count; d := d || jsonb_build_object('archives', n);

  -- المعلمات (r41): تُحذف حساباتهن بالكامل (الاسم والرمز والجلسات) إن لم يبقَ لهن أي أثر في سنة أخرى؛ الباقيات تبقى لأن لهن بيانات في سنة محفوظة.
  select coalesce(array_agg(t.id), '{}'::uuid[]) into gone from public.teachers t
   where not exists (select 1 from public.submissions s where s.teacher_id = t.id)
     and not exists (select 1 from public.upload_sessions s where s.teacher_id = t.id)
     and not exists (select 1 from public.archives a where a.teacher_id = t.id);
  delete from public.upload_attempts where teacher_id = any (gone);
  delete from public.deletion_requests where teacher_id = any (gone);
  delete from public.teacher_sessions where teacher_id = any (gone);
  delete from public.teacher_credentials where teacher_id = any (gone);
  delete from public.teachers where id = any (gone);
  get diagnostics n_gone = row_count; d := d || jsonb_build_object('teachers', n_gone);

  for i in 1..array_length(trg, 1) loop
    execute format('alter table public.%I enable trigger %I', trg[i][1], trg[i][2]);
  end loop;

  -- تحقق ما بعد الحذف: لا بقايا للسنة، ولم تتغيّر السنوات الأخرى ولا الحسابات ولا audit_log
  if exists (select 1 from public.versions where term_id = any (term_ids))
     or exists (select 1 from public.submissions where term_id = any (term_ids))
     or exists (select 1 from public.upload_sessions where term_id = any (term_ids))
     or exists (select 1 from public.archives where year_id = v_year) then
    raise exception 'بقيت بيانات للسنة بعد الحذف' using errcode = 'check_violation';
  end if;
  execute format(other_counts, v_year::text) into a_other;
  if a_other is distinct from b_other then raise exception 'تغيّرت بيانات سنة أخرى: التراجع' using errcode = 'check_violation'; end if;
  select count(*), coalesce(max(id), 0) into a_audit, a_audit_max from public.audit_log;
  if a_audit < b_audit or a_audit_max < b_audit_max then raise exception 'سجل التدقيق تغيّر: التراجع' using errcode = 'check_violation'; end if;
  select count(*) into a_staff from public.staff_profiles; select count(*) into a_teach from public.teachers;
  if a_staff <> b_staff or a_teach <> b_teach - n_gone or exists (select 1 from public.teachers where id = any (gone)) then raise exception 'تغيّرت الحسابات: التراجع' using errcode = 'check_violation'; end if;
  if not exists (select 1 from public.staff_profiles where role = 'owner' and is_active) then raise exception 'حساب المالكة غير موجود: التراجع' using errcode = 'check_violation'; end if;

  insert into public.year_closures (year_id, reset_id, year_label, archive_title, parts, verification, deleted)
  values (v_year, p_reset, v_label, v_arch_title, v_parts, v_ver, d);
  update public.year_resets set state = 'completed', phase = 'done', finished_at = now(), counters = d, last_error = null where id = p_reset;
  perform public.log_audit_as(r.started_by, 'year_reset_completed', 'year', v_year::text, jsonb_build_object('reset_id', p_reset, 'deleted', d));
  return d;
end
$$;
revoke all on function public.year_reset_purge(uuid) from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.year_reset_report(uuid), public.year_reset_purge(uuid) to service_role;
  end if;
end $$;

-- بوابة التصفير (r41، بطلب صاحبة المشروع): التصفير يجوز **حتى بلا أرشفة**. المسؤولة تتحمّل القرار وتُحذَّر في الواجهة.
-- الباقي لسلامة البيانات فقط: لا تصفير مرتين لسنة، ولا رفع معلّق قيد المعالجة. archiveId يُعاد إن وُجد أرشيف (للتقرير) وإلا null.
create or replace function public.year_reset_gate(p_year uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_arch uuid; v_problems text[] := '{}'; k bigint;
begin
  if not exists (select 1 from public.years where id = p_year) then
    return jsonb_build_object('ready', false, 'problems', jsonb_build_array('year_not_found'), 'archiveId', null);
  end if;
  if exists (select 1 from public.year_resets where year_id = p_year) then
    v_problems := array_append(v_problems, 'reset_already_started');
  end if;
  v_arch := public.year_reset_archive_of(p_year);
  select count(*) into k from public.upload_sessions s join public.terms t on t.id = s.term_id
   where t.year_id = p_year and (s.state in ('uploaded', 'validating') or (s.state = 'started' and s.expires_at > now()));
  if k > 0 then v_problems := array_append(v_problems, 'pending_uploads:' || k); end if;
  return jsonb_build_object('ready', cardinality(v_problems) = 0, 'problems', to_jsonb(v_problems), 'archiveId', v_arch);
end
$$;
revoke all on function public.year_reset_gate(uuid) from public, anon, authenticated;

commit;
