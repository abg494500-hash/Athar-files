-- أثَر — فحص ما بعد 02 (قراءة فقط: SELECT واحد لا يغيّر شيئًا). يُشغَّل بعد 02 مباشرة.
-- المتوقع: كل الصفوف PASS. أي FAIL يعني أن الاختبار لم يتراجع كاملًا — أرسليها لي ولا تكمل.
select check_name, status from (
  select 1 as n, 'لا مخطط test باقٍ' as check_name,
         case when not exists (select 1 from pg_namespace where nspname = 'test') then 'PASS' else 'FAIL' end as status
  union all select 2, 'مشغّل versions_match_session_bi مفعّل',
         case when exists (select 1 from pg_trigger where tgrelid = 'public.versions'::regclass and tgname = 'versions_match_session_bi' and tgenabled = 'O') then 'PASS' else 'FAIL' end
  union all select 3, 'قيد versions_file_verified موجود',
         case when exists (select 1 from pg_constraint where conrelid = 'public.versions'::regclass and conname = 'versions_file_verified') then 'PASS' else 'FAIL' end
  union all select 4, 'لا مستخدمون وهميون في auth.users',
         case when not exists (select 1 from auth.users where id::text like '00000000-0000-0000-0000-0000000000%') then 'PASS' else 'FAIL' end
  union all select 5, 'لا مسؤولون وهميون في staff_profiles',
         case when not exists (select 1 from public.staff_profiles where user_id::text like '00000000-0000-0000-0000-0000000000%') then 'PASS' else 'FAIL' end
  union all select 6, 'لا سجلات تدقيق من الاختبار',
         case when not exists (select 1 from public.audit_log where action = 'test.seed' or target_id like '00000000-0000-0000-0000-0000000000%') then 'PASS' else 'FAIL' end
  union all select 7, 'لا معلمة اختبار باقية',
         case when not exists (select 1 from public.teachers where name = 'معلمة اختبار') then 'PASS' else 'FAIL' end
  union all select 8, 'authenticated و anon و service_role لا ينفّذون bootstrap_staff',
         case when not has_function_privilege('authenticated', 'public.bootstrap_staff(text,text)', 'execute')
               and not has_function_privilege('anon', 'public.bootstrap_staff(text,text)', 'execute')
               and not has_function_privilege('service_role', 'public.bootstrap_staff(text,text)', 'execute') then 'PASS' else 'FAIL' end
) c order by n;
