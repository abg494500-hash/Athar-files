-- أثَر — فحص ما بعد 01g (قراءة فقط: SELECT واحد). المتوقع: كل الصفوف PASS. أي FAIL ⇒ أرسليه لي ولا تكمل.
select check_name, status from (
  select 1 as n, 'عمودا years.starts_on وends_on موجودان' as check_name, case when (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'years' and column_name in ('starts_on', 'ends_on')) = 2 then 'PASS' else 'FAIL' end as status
  union all select 2, 'دوال السنوات والاستيراد موجودة', case when to_regprocedure('public.create_year_with_terms(uuid,text,date,date,jsonb)') is not null and to_regprocedure('public.update_year(uuid,uuid,text,date,date,jsonb)') is not null
       and to_regprocedure('public.activate_year(uuid,uuid)') is not null and to_regprocedure('public.import_teachers(uuid,jsonb)') is not null then 'PASS' else 'FAIL' end
  union all select 3, 'الدوال: service_role فقط يملك التنفيذ', case when to_regprocedure('public.import_teachers(uuid,jsonb)') is not null
       and has_function_privilege('service_role', 'public.import_teachers(uuid,jsonb)', 'execute') and has_function_privilege('service_role', 'public.create_year_with_terms(uuid,text,date,date,jsonb)', 'execute')
       and not has_function_privilege('anon', 'public.import_teachers(uuid,jsonb)', 'execute') and not has_function_privilege('authenticated', 'public.import_teachers(uuid,jsonb)', 'execute')
       and not has_function_privilege('authenticated', 'public.activate_year(uuid,uuid)', 'execute') and not has_function_privilege('authenticated', 'public.update_year(uuid,uuid,text,date,date,jsonb)', 'execute') then 'PASS' else 'FAIL' end
  union all select 4, 'تسجيل المعلمات يشمل المديرة (سياسات RLS ودالة staff_actor_check)', case when to_regprocedure('public.staff_actor_check(uuid)') is not null
       and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'teachers' and policyname = 'teachers_insert' and with_check like '%director%')
       and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'teachers' and policyname = 'teachers_update' and qual like '%director%')
       and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'teacher_credentials' and policyname = 'teacher_credentials_select' and qual like '%director%')
       and not has_column_privilege('authenticated', 'public.teachers', 'removed_at', 'update') then 'PASS' else 'FAIL' end
) c order by n;
