-- أثَر — فحص ما بعد 01e (قراءة فقط: SELECT واحد). المتوقع: كل الصفوف PASS. أي FAIL ⇒ أرسليه لي ولا تكمل.
select check_name, status from (
  select 1 as n, 'عمود archive_entries.part_no موجود' as check_name, case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'archive_entries' and column_name = 'part_no') then 'PASS' else 'FAIL' end as status
  union all select 2, 'جدول archive_parts موجود وRLS مفعّل', case when exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'archive_parts' and c.relrowsecurity) then 'PASS' else 'FAIL' end
  union all select 3, 'archive_parts: لا وصول لـanon وauthenticated', case when to_regclass('public.archive_parts') is not null
       and not has_table_privilege('anon', 'public.archive_parts', 'select') and not has_table_privilege('authenticated', 'public.archive_parts', 'select') then 'PASS' else 'FAIL' end
  union all select 4, 'archive_parts: مشغّلات منع الحذف وحارس التحديث موجودة', case when (select count(*) from pg_trigger where tgrelid = to_regclass('public.archive_parts') and tgname in ('archive_parts_no_delete', 'archive_parts_guard_update_bu')) = 2 then 'PASS' else 'FAIL' end
  union all select 5, 'حارس archives: لا ختم تنزيل قبل تحقق كل الأجزاء', case when exists (select 1 from pg_trigger where tgrelid = 'public.archives'::regclass and tgname = 'archives_parts_verified_guard_bu') then 'PASS' else 'FAIL' end
  union all select 6, 'year_archive_gate: service_role فقط يملك التنفيذ', case when to_regprocedure('public.year_archive_gate(uuid)') is not null
       and has_function_privilege('service_role', 'public.year_archive_gate(uuid)', 'execute')
       and not has_function_privilege('anon', 'public.year_archive_gate(uuid)', 'execute')
       and not has_function_privilege('authenticated', 'public.year_archive_gate(uuid)', 'execute') then 'PASS' else 'FAIL' end
) c order by n;
