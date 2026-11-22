-- أثَر — ملف 01f (مولَّد من database/010_year_reset.sql؛ لا تعدّليه يدويًا).
-- يُنفَّذ **بعد 01e** ونجاح 03d، مرة واحدة (إعادة التشغيل آمنة). ينشئ جداول ودوال التصفير السنوي ومشغّل تجميد السنة. **لا يحذف شيئًا عند تنفيذه.**
-- ============================================================================
-- 010 — التصفير السنوي الحقيقي (A-118، 2026-11-15، r36)
-- يُنفَّذ بعد 001..009، مرة واحدة (إعادة التشغيل آمنة). **لا يحذف ولا يعدّل أي بيانات عند تنفيذه**: ينشئ جداول ودوال ومشغّلًا فقط.
-- الحذف الفعلي لا يحدث إلا حين تستدعي المالكة «بدء التصفير» من الواجهة (خادم)، وبعد اجتياز بوابة صارمة، ولسنة واحدة محددة فقط.
--
-- المبادئ:
--  (1) لا حذف شامل: كل حذف مقيّد بـ year_id للسنة المستهدفة، ويُتحقَّق بعده أن بيانات السنوات الأخرى لم تتغيّر عددًا.
--  (2) R2 وقاعدة البيانات ليسا في معاملة واحدة ⇒ العملية قابلة للاستئناف: مفاتيح R2 تُسجَّل أولًا (year_reset_keys)، تُحذف على دفعات،
--      يُتحقق من غيابها، ثم فقط يُحذف صفّ القاعدة. فشل ملف واحد لا يجعل العملية «مكتملة».
--  (3) audit_log لا يُحذف ولا يُعدَّل ولا تُعاد سلسلته: لا يُلمس أي مشغّل عليه. تُضاف سطور جديدة فقط (بدء/اكتمال).
--  (4) الحذف يوقف فقط المشغّلات المسمّاة (ALTER TABLE … DISABLE TRIGGER) داخل معاملة واحدة ثم يعيد تفعيلها؛ أي فشل ⇒ تراجع كامل.
--  (5) تبقى: السنة نفسها وفصولها (بلا محتوى)، المعلمات وحساباتهن، حسابا المالكة والمديرة، الإعدادات، audit_log، وسجل إغلاق موجز (year_closures).
-- ============================================================================
begin;

-- عمليات التصفير ------------------------------------------------------------
create table if not exists public.year_resets (
  id           uuid primary key default gen_random_uuid(),
  year_id      uuid not null unique references public.years (id) on delete restrict,
  archive_id   uuid,                       -- بلا FK عمدًا: صف الأرشيف نفسه يُحذف ضمن التصفير
  started_by   uuid not null references auth.users (id),
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  state        text not null default 'running' check (state in ('running', 'partial', 'failed', 'completed')),
  phase        text not null default 'files' check (phase in ('files', 'database', 'done')),
  report       jsonb not null,             -- لقطة تقرير ما قبل التصفير (أعداد فقط، بلا أي محتوى أرشيف)
  counters     jsonb not null default '{}'::jsonb,
  last_error   text,
  attempts     integer not null default 0
);
alter table public.year_resets enable row level security;
revoke all on public.year_resets from public, anon, authenticated;

-- مفاتيح R2 المراد حذفها (تُسجَّل قبل أي حذف ليكون الاستئناف ممكنًا) ----------
create table if not exists public.year_reset_keys (
  reset_id     uuid not null references public.year_resets (id) on delete restrict,
  storage_key  text not null,
  bucket       text,
  origin       text not null check (origin in ('version', 'pending_upload', 'legacy_archive')),
  state        text not null default 'pending' check (state in ('pending', 'deleted', 'verified_absent', 'failed')),
  attempts     integer not null default 0,
  last_error   text,
  updated_at   timestamptz not null default now(),
  primary key (reset_id, storage_key)
);
create index if not exists year_reset_keys_by_state on public.year_reset_keys (reset_id, state);
alter table public.year_reset_keys enable row level security;
revoke all on public.year_reset_keys from public, anon, authenticated;

-- سجل الإغلاق الموجز: لا محتوى أرشيف. للمالكة/المديرة قراءة فقط عبر الخادم. -----
create table if not exists public.year_closures (
  year_id        uuid primary key references public.years (id) on delete restrict,
  reset_id       uuid not null,
  year_label     text not null,
  closed_at      timestamptz not null default now(),
  archive_title  text,
  parts          jsonb not null default '[]'::jsonb,   -- [{part, sha256, size}] بصمات مرجعية فقط
  verification   jsonb not null default '{}'::jsonb,   -- نتيجة التحقق (أجزاء، نسخة ثانية، إقرار الفتح)
  deleted        jsonb not null default '{}'::jsonb    -- أعداد المحذوف
);
alter table public.year_closures enable row level security;
revoke all on public.year_closures from public, anon, authenticated;

create or replace function public.year_closures_immutable()
returns trigger language plpgsql set search_path = ''
as $$ begin raise exception 'سجل الإغلاق لا يُعدَّل ولا يُحذف' using errcode = 'insufficient_privilege'; end $$;
revoke all on function public.year_closures_immutable() from public, anon, authenticated;
drop trigger if exists year_closures_no_mutation on public.year_closures;
create trigger year_closures_no_mutation before update or delete on public.year_closures
  for each row execute function public.year_closures_immutable();

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update on public.year_resets, public.year_reset_keys to service_role;
    grant select, insert on public.year_closures to service_role;
  end if;
end $$;

-- تجميد الكتابة على سنة بدأ تصفيرها (أو أُغلقت): لا تسليمات ولا إصدارات ولا جلسات رفع ولا أرشيفات جديدة ------
create or replace function public.year_reset_freeze()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_year uuid;
begin
  if TG_TABLE_NAME = 'archives' then v_year := new.year_id;
  else select t.year_id into v_year from public.terms t where t.id = new.term_id; end if;
  if v_year is not null and exists (select 1 from public.year_resets r where r.year_id = v_year) then
    raise exception 'السنة الدراسية مغلقة أو قيد التصفير: لا كتابة عليها' using errcode = 'check_violation';
  end if;
  return new;
end
$$;
revoke all on function public.year_reset_freeze() from public, anon, authenticated;
drop trigger if exists submissions_year_freeze_bi on public.submissions;
create trigger submissions_year_freeze_bi before insert on public.submissions for each row execute function public.year_reset_freeze();
drop trigger if exists versions_year_freeze_bi on public.versions;
create trigger versions_year_freeze_bi before insert on public.versions for each row execute function public.year_reset_freeze();
drop trigger if exists upload_sessions_year_freeze_bi on public.upload_sessions;
create trigger upload_sessions_year_freeze_bi before insert on public.upload_sessions for each row execute function public.year_reset_freeze();
drop trigger if exists archives_year_freeze_bi on public.archives;
create trigger archives_year_freeze_bi before insert on public.archives for each row execute function public.year_reset_freeze();

-- أرشيف السنة المحلي المعتمد (الأحدث) --------------------------------------------
create or replace function public.year_reset_archive_of(p_year uuid)
returns uuid language sql stable security definer set search_path = ''
as $$
  select a.id from public.archives a
   where a.year_id = p_year and a.term_id is null and a.teacher_id is null
     and a.storage_provider = 'local-download' and a.deleted_at is null and a.state = 'verified'
   order by a.created_at desc limit 1
$$;
revoke all on function public.year_reset_archive_of(uuid) from public, anon, authenticated;

-- بوابة التصفير: تُبنى على بوابة الأرشيف (009) وتضيف شروط 010 -----------------------
create or replace function public.year_reset_gate(p_year uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_arch uuid; v_gate jsonb; v_problems text[] := '{}'; k bigint; n bigint;
begin
  if not exists (select 1 from public.years where id = p_year) then
    return jsonb_build_object('ready', false, 'problems', jsonb_build_array('year_not_found'), 'archiveId', null);
  end if;
  if exists (select 1 from public.year_resets where year_id = p_year) then
    v_problems := array_append(v_problems, 'reset_already_started');
  end if;
  v_arch := public.year_reset_archive_of(p_year);
  if v_arch is null then
    v_problems := array_append(v_problems, 'no_year_archive');
  else
    v_gate := public.year_archive_gate(v_arch);
    select coalesce(array_agg(x), '{}') into v_problems from (
      select unnest(v_problems) x union all select jsonb_array_elements_text(v_gate->'problems')) s;
    -- عدد إصدارات السنة = عدد عناصر الأرشيف (لا زيادة ولا نقص)
    select count(*) into k from public.versions v join public.terms t on t.id = v.term_id where t.year_id = p_year;
    select count(*) into n from public.archive_entries e where e.archive_id = v_arch;
    if k <> n then v_problems := array_append(v_problems, 'versions_entries_count_mismatch'); end if;
  end if;
  -- رفع معلّق/قيد التحقق لم يُحسم ⇒ لا تصفير
  select count(*) into k from public.upload_sessions s join public.terms t on t.id = s.term_id
   where t.year_id = p_year and (s.state in ('uploaded', 'validating') or (s.state = 'started' and s.expires_at > now()));
  if k > 0 then v_problems := array_append(v_problems, 'pending_uploads:' || k); end if;
  -- أرشيفات سحابية قديمة (R2) لم تُنزَّل ويُتحقَّق منها ⇒ ستُحذف مع التصفير، فلا بد من نقلها أولًا
  select count(*) into k from public.archives a
   where a.year_id = p_year and a.storage_provider is distinct from 'local-download' and a.storage_key is not null
     and a.deleted_at is null and a.download_hash_verified_at is null;
  if k > 0 then v_problems := array_append(v_problems, 'legacy_archives_not_transferred:' || k); end if;
  return jsonb_build_object('ready', cardinality(v_problems) = 0, 'problems', to_jsonb(v_problems), 'archiveId', v_arch);
end
$$;
revoke all on function public.year_reset_gate(uuid) from public, anon, authenticated;

-- تقرير ما قبل التصفير (أعداد فقط) -------------------------------------------------
create or replace function public.year_reset_report(p_year uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_label text; v_arch uuid; v_gate jsonb; v_title text;
  c_teachers bigint; c_sub bigint; c_ver bigint; c_files bigint; c_links bigint; c_bytes bigint; c_parts bigint;
  c_sess bigint; c_att bigint; c_arch bigint; c_ent bigint; c_keys bigint; v_parts jsonb;
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
  select title into v_title from public.archives where id = v_arch;
  return jsonb_build_object(
    'yearId', p_year, 'yearLabel', v_label, 'archiveId', v_arch, 'archiveTitle', v_title,
    'gate', v_gate,
    'teachers', c_teachers, 'submissions', c_sub, 'versions', c_ver, 'files', c_files, 'links', c_links, 'fileBytes', c_bytes,
    'archiveParts', v_parts, 'archivePartsCount', jsonb_array_length(v_parts),
    'toDelete', jsonb_build_object('upload_attempts', c_att, 'upload_sessions', c_sess, 'versions', c_ver, 'submissions', c_sub,
                                   'archive_entries', c_ent, 'archive_parts', c_parts, 'archives', c_arch, 'r2_objects', c_keys),
    'stays', jsonb_build_object(
      'staff_accounts', (select count(*) from public.staff_profiles),
      'teachers', (select count(*) from public.teachers),
      'other_years_versions', (select count(*) from public.versions v join public.terms t on t.id = v.term_id where t.year_id <> p_year),
      'audit_log', (select count(*) from public.audit_log)));
end
$$;
revoke all on function public.year_reset_report(uuid) from public, anon, authenticated;

-- بدء التصفير: يقفل السنة، يعيد فحص البوابة، يسجّل العملية والمفاتيح (لا حذف بعد) --------
create or replace function public.year_reset_begin(p_year uuid, p_actor uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_gate jsonb; v_id uuid; v_report jsonb; v_arch uuid;
begin
  if not exists (select 1 from public.staff_profiles where user_id = p_actor and role = 'owner' and is_active) then
    raise exception 'التصفير للمالكة فقط' using errcode = 'insufficient_privilege';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('year_reset:' || p_year::text, 0));
  perform 1 from public.years where id = p_year for update;
  if not found then raise exception 'السنة غير موجودة' using errcode = 'no_data_found'; end if;
  v_gate := public.year_reset_gate(p_year);
  if not (v_gate->>'ready')::boolean then
    raise exception 'بوابة التصفير لم تُجتز: %', v_gate->>'problems' using errcode = 'check_violation';
  end if;
  v_arch := (v_gate->>'archiveId')::uuid;
  v_report := public.year_reset_report(p_year);
  insert into public.year_resets (year_id, archive_id, started_by, report) values (p_year, v_arch, p_actor, v_report) returning id into v_id;
  -- السنة لا تبقى نشطة أثناء التصفير (يُفعَّل لاحقًا عام جديد)
  update public.years set is_active = false where id = p_year and is_active;
  insert into public.year_reset_keys (reset_id, storage_key, bucket, origin)
  select v_id, q.k, q.b, q.o from (
    select distinct on (v.storage_key) v.storage_key k, v.storage_bucket b, 'version'::text o
      from public.versions v join public.terms t on t.id = v.term_id where t.year_id = p_year and v.storage_key is not null
    union all
    select distinct on (s.pending_key) s.pending_key, null::text, 'pending_upload'::text
      from public.upload_sessions s join public.terms t on t.id = s.term_id where t.year_id = p_year and s.pending_key is not null
    union all
    select x.storage_key, null::text, 'legacy_archive'::text
      from public.archives x where x.year_id = p_year and x.storage_key is not null and x.storage_provider is distinct from 'local-download'
  ) q
  on conflict do nothing;
  perform public.log_audit_as(p_actor, 'year_reset_started', 'year', p_year::text, jsonb_build_object('reset_id', v_id, 'year_label', v_report->>'yearLabel'));
  return v_id;
end
$$;
revoke all on function public.year_reset_begin(uuid, uuid) from public, anon, authenticated;

-- تسجيل حالة مرحلة (يُستدعى من الخادم عند التوقف/الفشل) ---------------------------------
create or replace function public.year_reset_mark(p_reset uuid, p_state text, p_error text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if p_state not in ('running', 'partial', 'failed') then raise exception 'حالة غير صالحة' using errcode = 'check_violation'; end if;
  update public.year_resets set state = p_state, last_error = left(p_error, 500), attempts = attempts + 1
   where id = p_reset and state <> 'completed';
end
$$;
revoke all on function public.year_reset_mark(uuid, text, text) from public, anon, authenticated;

-- التنفيذ على القاعدة: بعد التحقق من غياب كل ملفات R2 -------------------------------------
create or replace function public.year_reset_purge(p_reset uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  r public.year_resets%rowtype; v_year uuid; v_label text; v_arch record;
  b_other jsonb; a_other jsonb; b_audit bigint; a_audit bigint; b_audit_max bigint; a_audit_max bigint; b_staff bigint; a_staff bigint; b_teach bigint; a_teach bigint;
  d jsonb := '{}'::jsonb; n bigint; v_parts jsonb; v_ver jsonb;
  term_ids uuid[];
  trg text[][] := array[
    ['versions','versions_no_delete'], ['submissions','submissions_no_delete'], ['archives','archives_no_delete'],
    ['archive_entries','archive_entries_no_delete'], ['archive_parts','archive_parts_no_delete'],
    ['deletion_requests','deletion_requests_no_delete'], ['upload_sessions','upload_sessions_no_delete'],
    ['upload_sessions','upload_sessions_guard_update_bu'], ['upload_attempts','upload_attempts_no_mutation']];
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
  select a.* into v_arch from public.archives a where a.id = r.archive_id;
  select coalesce(jsonb_agg(jsonb_build_object('part', p.part_no, 'sha256', p.sha256, 'size', p.size_bytes) order by p.part_no), '[]'::jsonb)
    into v_parts from public.archive_parts p where p.archive_id = r.archive_id;
  v_ver := jsonb_build_object('parts_download_verified', (select count(*) from public.archive_parts where archive_id = r.archive_id and verified_at is not null),
                              'parts_second_copy_verified', (select count(*) from public.archive_parts where archive_id = r.archive_id and copy_verified_at is not null),
                              'parts', (select count(*) from public.archive_parts where archive_id = r.archive_id),
                              'opened_locally_ack', exists (select 1 from jsonb_array_elements(v_arch.checks) e where e->>'check' = 'opened_locally_ack'));
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
  if a_staff <> b_staff or a_teach <> b_teach then raise exception 'تغيّرت الحسابات: التراجع' using errcode = 'check_violation'; end if;
  if not exists (select 1 from public.staff_profiles where role = 'owner' and is_active) then raise exception 'حساب المالكة غير موجود: التراجع' using errcode = 'check_violation'; end if;

  insert into public.year_closures (year_id, reset_id, year_label, archive_title, parts, verification, deleted)
  values (v_year, p_reset, v_label, v_arch.title, v_parts, v_ver, d);
  update public.year_resets set state = 'completed', phase = 'done', finished_at = now(), counters = d, last_error = null where id = p_reset;
  perform public.log_audit_as(r.started_by, 'year_reset_completed', 'year', v_year::text, jsonb_build_object('reset_id', p_reset, 'deleted', d));
  return d;
end
$$;
revoke all on function public.year_reset_purge(uuid) from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.year_reset_gate(uuid), public.year_reset_report(uuid), public.year_reset_archive_of(uuid),
      public.year_reset_begin(uuid, uuid), public.year_reset_mark(uuid, text, text), public.year_reset_purge(uuid) to service_role;
  end if;
end $$;

commit;
