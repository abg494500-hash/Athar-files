-- أثَر — فحص ما بعد 01c (قراءة فقط: SELECT واحد لا يغيّر شيئًا). المتوقع: كل الصفوف PASS. أي FAIL ⇒ أرسليه لي ولا تكمل.
select check_name, status from (
  select 1 as n, 'جدول teacher_sessions موجود' as check_name, case when to_regclass('public.teacher_sessions') is not null then 'PASS' else 'FAIL' end as status
  union all select 2, 'RLS مفعّلة على teacher_sessions', case when coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.teacher_sessions')), false) then 'PASS' else 'FAIL' end
  union all select 3, 'لا policies على teacher_sessions', case when not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'teacher_sessions') then 'PASS' else 'FAIL' end
  union all select 4, 'anon وauthenticated بلا أي صلاحية على teacher_sessions',
         case when not (has_table_privilege('anon', 'public.teacher_sessions', 'select, insert, update, delete') or has_table_privilege('authenticated', 'public.teacher_sessions', 'select, insert, update, delete')) then 'PASS' else 'FAIL' end
  union all select 5, 'فهرس بصمة الكود الفريد موجود', case when exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'teacher_credentials_code_hash_uq') then 'PASS' else 'FAIL' end
  union all select 6, 'log_audit_as موجودة وsecurity definer بمسار بحث ثابت',
         case when exists (select 1 from pg_proc where oid = to_regprocedure('public.log_audit_as(uuid,text,text,text,jsonb)') and prosecdef and proconfig is not null and exists (select 1 from unnest(proconfig) c where c like 'search_path=%')) then 'PASS' else 'FAIL' end
  union all select 7, 'log_audit_as: لا تنفيذ لـPUBLIC ولا anon ولا authenticated',
         case when not exists (select 1 from pg_proc p where p.oid = 'public.log_audit_as(uuid,text,text,text,jsonb)'::regprocedure and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0))) and not has_function_privilege('anon', 'public.log_audit_as(uuid,text,text,text,jsonb)', 'execute') and not has_function_privilege('authenticated', 'public.log_audit_as(uuid,text,text,text,jsonb)', 'execute') then 'PASS' else 'FAIL' end
  union all select 8, 'log_audit_as: service_role ينفّذ', case when has_function_privilege('service_role', 'public.log_audit_as(uuid,text,text,text,jsonb)', 'execute') then 'PASS' else 'FAIL' end
  union all select 9, 'مشغّل حارس الأرشيف مفعّل', case when exists (select 1 from pg_trigger where tgrelid = 'public.archives'::regclass and tgname = 'archives_guard_update_bu' and tgenabled = 'O') then 'PASS' else 'FAIL' end
  union all select 10, 'دالة حارس الأرشيف بلا تنفيذ لـPUBLIC/anon/authenticated',
         case when not exists (select 1 from pg_proc p where p.oid = 'public.archives_guard_update()'::regprocedure and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0))) and not has_function_privilege('anon', 'public.archives_guard_update()', 'execute') and not has_function_privilege('authenticated', 'public.archives_guard_update()', 'execute') then 'PASS' else 'FAIL' end
  union all select 11, 'فهرس versions_teacher_term موجود', case when exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'versions_teacher_term') then 'PASS' else 'FAIL' end
  union all select 12, 'لا جلسات معلمات باقية من أي اختبار', case when not exists (select 1 from public.teacher_sessions) then 'PASS' else 'FAIL' end
) c order by n;
