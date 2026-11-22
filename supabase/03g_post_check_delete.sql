-- أثَر — فحص ما بعد 01h (قراءة فقط: SELECT واحد). المتوقع: كل الصفوف PASS. أي FAIL ⇒ أرسليه لي ولا تكمل.
select check_name, status from (
  select 1 as n, 'دالتا الحذف موجودتان لـservice_role فقط' as check_name, case when to_regprocedure('public.teacher_delete_check(uuid,uuid)') is not null and to_regprocedure('public.teacher_delete_version(uuid,uuid)') is not null
       and has_function_privilege('service_role', 'public.teacher_delete_version(uuid,uuid)', 'execute')
       and not has_function_privilege('anon', 'public.teacher_delete_version(uuid,uuid)', 'execute') and not has_function_privilege('authenticated', 'public.teacher_delete_version(uuid,uuid)', 'execute')
       and not has_function_privilege('authenticated', 'public.teacher_delete_check(uuid,uuid)', 'execute') then 'PASS' else 'FAIL' end as status
  union all select 2, 'التصفير يقبل المديرة (year_reset_begin يستعمل staff_actor_check)', case when (select prosrc from pg_proc where oid = 'public.year_reset_begin(uuid,uuid)'::regprocedure) like '%staff_actor_check%' then 'PASS' else 'FAIL' end
  union all select 3, 'كل مشغّلات منع الحذف مفعّلة (لم يُترك أي مشغّل معطّلًا)', case when (select count(*) from pg_trigger where tgname in ('versions_no_delete','submissions_no_delete','upload_sessions_no_delete','upload_sessions_guard_update_bu','upload_attempts_no_mutation') and tgenabled = 'O') = 5 then 'PASS' else 'FAIL' end
  union all select 4, 'بوابة التصفير مخفَّفة (لا تشترط نسخة ثانية ولا إقرارًا)', case when (select prosrc from pg_proc where oid = 'public.year_reset_gate(uuid)'::regprocedure) not like '%year_archive_gate%' then 'PASS' else 'FAIL' end
) c order by n;
