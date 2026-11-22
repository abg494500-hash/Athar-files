-- أثَر — فحص ما بعد 01f (قراءة فقط: SELECT واحد). المتوقع: كل الصفوف PASS. أي FAIL ⇒ أرسليه لي ولا تكمل.
select check_name, status from (
  select 1 as n, 'جداول year_resets وyear_reset_keys وyear_closures موجودة وRLS مفعّل' as check_name, case when (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in ('year_resets', 'year_reset_keys', 'year_closures') and c.relrowsecurity) = 3 then 'PASS' else 'FAIL' end as status
  union all select 2, 'لا وصول لـanon وauthenticated إلى جداول التصفير', case when to_regclass('public.year_resets') is not null
       and not has_table_privilege('anon', 'public.year_resets', 'select') and not has_table_privilege('authenticated', 'public.year_resets', 'select')
       and not has_table_privilege('authenticated', 'public.year_closures', 'select') and not has_table_privilege('authenticated', 'public.year_reset_keys', 'select') then 'PASS' else 'FAIL' end
  union all select 3, 'دوال التصفير: service_role فقط يملك التنفيذ', case when to_regprocedure('public.year_reset_purge(uuid)') is not null
       and has_function_privilege('service_role', 'public.year_reset_purge(uuid)', 'execute') and has_function_privilege('service_role', 'public.year_reset_begin(uuid,uuid)', 'execute')
       and not has_function_privilege('anon', 'public.year_reset_purge(uuid)', 'execute') and not has_function_privilege('authenticated', 'public.year_reset_purge(uuid)', 'execute')
       and not has_function_privilege('authenticated', 'public.year_reset_begin(uuid,uuid)', 'execute') then 'PASS' else 'FAIL' end
  union all select 4, 'مشغّلات تجميد السنة موجودة على التسليمات والإصدارات والجلسات والأرشيفات', case when (select count(*) from pg_trigger where tgname in ('submissions_year_freeze_bi', 'versions_year_freeze_bi', 'upload_sessions_year_freeze_bi', 'archives_year_freeze_bi')) = 4 then 'PASS' else 'FAIL' end
  union all select 5, 'مشغّلات منع الحذف ما زالت مفعّلة (لم يبقَ شيء موقوفًا)', case when (select count(*) from pg_trigger where tgname in ('versions_no_delete', 'submissions_no_delete', 'archives_no_delete', 'archive_entries_no_delete', 'archive_parts_no_delete', 'upload_sessions_no_delete', 'upload_sessions_guard_update_bu', 'upload_attempts_no_mutation') and tgenabled = 'O') = 8 then 'PASS' else 'FAIL' end
  union all select 6, 'مشغّلات audit_log مفعّلة', case when (select count(*) from pg_trigger where tgrelid = 'public.audit_log'::regclass and tgname in ('audit_log_chain_bi', 'audit_log_no_update_delete', 'audit_log_no_truncate') and tgenabled = 'O') = 3 then 'PASS' else 'FAIL' end
) c order by n;
