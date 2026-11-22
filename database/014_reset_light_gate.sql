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
