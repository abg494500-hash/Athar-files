-- أثَر — ملف 01h (مولَّد من database/012_teacher_delete.sql + 013_reset_for_staff.sql + 014_reset_light_gate.sql؛ لا تعدّليه يدويًا).
-- يُنفَّذ **بعد 01g** ونجاح 03f، **وقبل نشر دالة api الجديدة**. دالتا حذف المعلمة لملفها + بدء التصفير للمالكة والمديرة. إعادة التشغيل آمنة. **لا يحذف ولا يعدّل بيانات قائمة عند تنفيذه.**
-- ============================================================================
-- 012 — حذف المعلمة لملفها حذفًا نهائيًا (A-126، r40، بقرار صاحبة المشروع: «يُحذف نهائيًا، لا أثر في Cloud ولا عند المديرة ولا المالكة»)
-- يُنفَّذ بعد 001..011. **لا يحذف شيئًا ولا يعدّل بيانات قائمة عند تنفيذه** (دوال فقط).
-- الدالة teacher_delete_version تحذف: صف الإصدار، وجلسة رفعه ومحاولاتها (فيها اسم الملف المعلن)، وإن خلت الخانة من كل إصدار فصفّ التسليم وكل جلسات الخانة.
-- الحذف بتعطيل **مشغّلات مسمّاة فقط** داخل المعاملة نفسها ثم إعادة تفعيلها (نمط التصفير السنوي A-118)؛ لا يُمسّ أي مشغّل على audit_log.
-- شروط الحذف: آخر إصدار في الخانة (كي لا تنقلب حالة «في الموعد/متأخر» ولا يختل الترقيم)، السنة نشطة وغير مصفَّرة، ولا أرشيف سنوي قائم،
-- ولا جلسة رفع جارية للخانة. مواعيد الفصل يفحصها الخادم. حذف ملف R2 (النهائي والمؤقت) يتم في الخادم قبل هذه الدالة.
-- **audit_log لا يُحذف ولا يُعدَّل** (قاعدة ثابتة): يبقى فيه سطر «teacher.delete_version» بمعرّف الإصدار فقط، بلا اسم ملف ولا محتوى.
-- ============================================================================
begin;

create or replace function public.teacher_delete_check(p_teacher uuid, p_version uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v public.versions%rowtype; v_year uuid; v_active boolean; v_latest integer; v_pending text;
begin
  select * into v from public.versions where id = p_version;
  if not found or v.teacher_id <> p_teacher then raise exception 'not_found' using errcode = 'no_data_found'; end if;
  select max(no) into v_latest from public.versions where teacher_id = v.teacher_id and term_id = v.term_id and slot_id = v.slot_id;
  if v.no <> v_latest then raise exception 'not_latest' using errcode = 'check_violation'; end if;
  select t.year_id, y.is_active into v_year, v_active from public.terms t join public.years y on y.id = t.year_id where t.id = v.term_id;
  if not coalesce(v_active, false) then raise exception 'year_not_active' using errcode = 'check_violation'; end if;
  if exists (select 1 from public.year_resets where year_id = v_year) then raise exception 'year_closed' using errcode = 'check_violation'; end if;
  if exists (select 1 from public.archives a where a.year_id = v_year and a.term_id is null and a.teacher_id is null and a.deleted_at is null) then
    raise exception 'archive_exists' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.upload_sessions s where s.teacher_id = v.teacher_id and s.term_id = v.term_id and s.slot_id = v.slot_id
              and (s.state in ('uploaded', 'validating') or (s.state = 'started' and s.expires_at > now()))) then
    raise exception 'session_busy' using errcode = 'check_violation';
  end if;
  if v.upload_session_id is not null then select pending_key into v_pending from public.upload_sessions where id = v.upload_session_id; end if;
  return jsonb_build_object('kind', v.kind, 'storageKey', v.storage_key, 'pendingKey', v_pending, 'termId', v.term_id, 'slotId', v.slot_id, 'no', v.no);
end
$$;
revoke all on function public.teacher_delete_check(uuid, uuid) from public, anon, authenticated;

create or replace function public.teacher_delete_version(p_teacher uuid, p_version uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v public.versions%rowtype; i int; ids uuid[];
  trg text[][] := array[
    ['versions','versions_no_delete'], ['submissions','submissions_no_delete'], ['upload_sessions','upload_sessions_no_delete'],
    ['upload_sessions','upload_sessions_guard_update_bu'], ['upload_attempts','upload_attempts_no_mutation']];
begin
  perform public.teacher_delete_check(p_teacher, p_version);
  select * into v from public.versions where id = p_version;
  perform 1 from public.submissions where teacher_id = v.teacher_id and term_id = v.term_id and slot_id = v.slot_id for update;

  for i in 1..array_length(trg, 1) loop
    execute format('alter table public.%I disable trigger %I', trg[i][1], trg[i][2]);
  end loop;

  delete from public.versions where id = p_version;
  if exists (select 1 from public.versions where teacher_id = v.teacher_id and term_id = v.term_id and slot_id = v.slot_id) then
    ids := case when v.upload_session_id is null then '{}'::uuid[] else array[v.upload_session_id] end;   -- خانة ما زال فيها إصدارات: جلسة هذا الإصدار وحدها
  else
    select coalesce(array_agg(id), '{}') into ids from public.upload_sessions
     where teacher_id = v.teacher_id and term_id = v.term_id and slot_id = v.slot_id;                    -- خانة خلت: كل جلساتها
  end if;
  update public.upload_sessions set inherited_from = null where inherited_from = any (ids);
  delete from public.upload_attempts where session_id = any (ids);
  delete from public.upload_sessions where id = any (ids);
  delete from public.submissions s where s.teacher_id = v.teacher_id and s.term_id = v.term_id and s.slot_id = v.slot_id
    and not exists (select 1 from public.versions x where x.teacher_id = s.teacher_id and x.term_id = s.term_id and x.slot_id = s.slot_id);

  for i in 1..array_length(trg, 1) loop
    execute format('alter table public.%I enable trigger %I', trg[i][1], trg[i][2]);
  end loop;
end
$$;
revoke all on function public.teacher_delete_version(uuid, uuid) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.teacher_delete_check(uuid, uuid), public.teacher_delete_version(uuid, uuid) to service_role;
  end if;
end $$;

commit;

-- ============================================================================
-- 013 — بدء التصفير السنوي للمالكة والمديرة (A-126، r40، بطلب صاحبة المشروع). يُنفَّذ بعد 010 و011.
-- إعادة تعريف دالة واحدة بـ create or replace: لا يحذف ولا يعدّل بيانات. بوابة التصفير (أرشيف متحقَّق منه ومنزَّل + نسخة ثانية مستقلة) كما هي.
-- ============================================================================
begin;

create or replace function public.year_reset_begin(p_year uuid, p_actor uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_gate jsonb; v_id uuid; v_report jsonb; v_arch uuid;
begin
  perform public.staff_actor_check(p_actor); -- المالكة أو المديرة (A-126)
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

commit;

-- ============================================================================
-- 014 — تخفيف بوابة التصفير السنوي (A-127، r40، بطلب صاحبة المشروع: «الأرشفة تتم وبعدها التصفير بلا شروط»). يُنفَّذ بعد 010 و013.
-- إعادة تعريف دالة واحدة بـ create or replace؛ لا يحذف ولا يعدّل بيانات.
-- الشرط الوحيد للأرشفة: وجود أرشيف سنوي مبنيّ ومسجَّل للسنة (المتصفح تحقق من بصمات كل ملف أثناء البناء)، وعدد عناصره = عدد إصدارات السنة.
-- أُلغيت: شرط تحقق الأجزاء المنزَّلة، والنسخة الثانية المستقلة، وإقرار الفتح دون إنترنت، وشرط الأرشيفات السحابية القديمة.
-- باقٍ لسلامة البيانات: لا تصفير مرتين لسنة، ولا رفع معلّق قيد المعالجة.
-- ============================================================================
begin;

create or replace function public.year_reset_gate(p_year uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_arch uuid; v_problems text[] := '{}'; k bigint; n bigint;
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
    select count(*) into k from public.versions v join public.terms t on t.id = v.term_id where t.year_id = p_year;
    select count(*) into n from public.archive_entries e where e.archive_id = v_arch;
    if k <> n then v_problems := array_append(v_problems, 'versions_entries_count_mismatch'); end if;
  end if;
  select count(*) into k from public.upload_sessions s join public.terms t on t.id = s.term_id
   where t.year_id = p_year and (s.state in ('uploaded', 'validating') or (s.state = 'started' and s.expires_at > now()));
  if k > 0 then v_problems := array_append(v_problems, 'pending_uploads:' || k); end if;
  return jsonb_build_object('ready', cardinality(v_problems) = 0, 'problems', to_jsonb(v_problems), 'archiveId', v_arch);
end
$$;
revoke all on function public.year_reset_gate(uuid) from public, anon, authenticated;

commit;
