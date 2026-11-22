-- أثَر — فحص ما بعد 01d (قراءة فقط: SELECT واحد). المتوقع: كل الصفوف PASS. أي FAIL ⇒ أرسليه لي ولا تكمل.
select check_name, status from (
  select 1 as n, 'عمود teachers.removed_at موجود' as check_name, case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'teachers' and column_name = 'removed_at') then 'PASS' else 'FAIL' end as status
  union all select 2, 'الدالة remove_teacher موجودة', case when to_regprocedure('public.remove_teacher(uuid,uuid)') is not null then 'PASS' else 'FAIL' end
  union all select 3, 'remove_teacher: service_role فقط يملك التنفيذ', case when to_regprocedure('public.remove_teacher(uuid,uuid)') is not null
       and has_function_privilege('service_role', 'public.remove_teacher(uuid,uuid)', 'execute')
       and not has_function_privilege('anon', 'public.remove_teacher(uuid,uuid)', 'execute')
       and not has_function_privilege('authenticated', 'public.remove_teacher(uuid,uuid)', 'execute') then 'PASS' else 'FAIL' end
) c order by n;
