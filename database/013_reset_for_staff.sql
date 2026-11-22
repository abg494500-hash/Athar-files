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
