-- اختبارات 005 (حسابات المسؤولين بلا تحقق بخطوتين — A-98). **غير مُشغَّلة بعد** (لا PostgreSQL في بيئة كتابتها).
-- محليًا: بعد 00_bootstrap.sql ثم 001 ثم 002 ثم 003 ثم 005 (بلا 004 ضروري). على Supabase يُدمج في supabase/02_security_check.sql
-- بواسطة scripts/build-supabase-sql.mjs: يُحذف كل ما بين علامتَي LOCAL-ONLY ويُنقل قسم PRESEED قبل منح المحاكاة،
-- وتُنقل بقية الاختبارات بعد اختبارات 10_security_003 (التي تزرع المستخدمين عبر bootstrap_staff).
-- BEGIN-LOCAL-ONLY
\set ON_ERROR_STOP off
-- as_user: يضبط هوية الجلسة فقط (محليًا بـGUC؛ في 02 يُستبدل بـrequest.jwt.claims). لا مستوى ضمان aal ولا TOTP.
create function test.as_user(uid text) returns void language sql as $$
  select set_config('app.uid', uid, false)
$$;
grant execute on function test.as_user(text) to anon, authenticated, service_role;
-- END-LOCAL-ONLY

-- BEGIN-PRESEED
-- تُنفَّذ قبل أي منح محاكاة لـservice_role كي تعكس الصلاحيات الافتراضية الحقيقية بعد سحب 005.
select test.count_is('service_role: لا تنفيذ bootstrap_staff',
  $$select has_function_privilege('service_role', 'public.bootstrap_staff(text,text)', 'execute')::int$$, 0);
select test.count_is('authenticated: لا تنفيذ bootstrap_staff',
  $$select has_function_privilege('authenticated', 'public.bootstrap_staff(text,text)', 'execute')::int$$, 0);
select test.count_is('anon: لا تنفيذ bootstrap_staff',
  $$select has_function_privilege('anon', 'public.bootstrap_staff(text,text)', 'execute')::int$$, 0);
-- END-PRESEED

-- BEGIN-LOCAL-ONLY
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'owner-test@example.invalid'),
  ('00000000-0000-0000-0000-0000000000b2', 'director-test@example.invalid'),
  ('00000000-0000-0000-0000-0000000000c3', 'nobody-test@example.invalid');
select public.bootstrap_staff('owner-test@example.invalid', 'owner');
select public.bootstrap_staff('director-test@example.invalid', 'director');
insert into public.years (label, is_active) values ('2026-2027', true), ('2025-2026', false);
-- END-LOCAL-ONLY

-- BEGIN-TESTS
reset role;
-- (0) تعريف current_staff_role لا يشترط أي مستوى تحقق إضافي (A-98): لا aal ولا auth.jwt داخل الدالة.
select test.count_is('005 current_staff_role بلا شرط aal', $$select (pg_get_functiondef('public.current_staff_role()'::regprocedure) !~* 'aal|jwt')::int$$, 1);
select test.count_is('005 current_staff_role يشترط صفًّا نشطًا', $$select (pg_get_functiondef('public.current_staff_role()'::regprocedure) ~* 'is_active')::int$$, 1);

-- (أ) المالكة: جلسة بكلمة المرور وحدها تعمل بصلاحيات دورها.
select test.as_user('00000000-0000-0000-0000-0000000000a1');
set role authenticated;
select test.count_is('005 المالكة: دورها owner', $$select (public.current_staff_role() = 'owner')::int$$, 1);
select test.count_is('005 المالكة: ترى years', 'select (count(*) > 0)::int from public.years', 1);
select test.allowed('005 المالكة: verify_audit_chain', 'select * from public.verify_audit_chain()');
select test.count_is('005 المالكة: ترى صفوف staff_profiles كلها (دورها owner)', 'select count(*) from public.staff_profiles', 2);
-- لا امتيازات فوق دورها: لا كتابة مباشرة في staff_profiles ولا تنفيذ bootstrap_staff.
select test.blocked('005 المالكة: لا إدراج مباشر في staff_profiles', $$insert into public.staff_profiles (user_id, role) values ('00000000-0000-0000-0000-0000000000c3', 'director')$$);
select test.blocked('005 المالكة: لا تنفيذ bootstrap_staff', $$select public.bootstrap_staff('nobody-test@example.invalid', 'director')$$);
reset role;

-- (ب) المديرة: صلاحيات الدور كما كانت (لا سجل عمليات، لا مفتاح تخزين).
select test.as_user('00000000-0000-0000-0000-0000000000b2');
set role authenticated;
select test.count_is('005 المديرة: دورها director', $$select (public.current_staff_role() = 'director')::int$$, 1);
select test.count_is('005 المديرة: لا ترى سجل العمليات', 'select count(*) from public.audit_log', 0);
select test.count_is('005 المديرة: ترى صفّها هي فقط في staff_profiles', 'select count(*) from public.staff_profiles', 1);
select test.blocked('005 المديرة: verify_audit_chain', 'select * from public.verify_audit_chain()');
reset role;

-- (ج) مستخدمة مصادَق عليها لكنها ليست مسؤولة: لا دور ولا بيانات ولا تسجيل ذاتي.
select test.as_user('00000000-0000-0000-0000-0000000000c3');
set role authenticated;
select test.count_is('005 غير مسؤولة: لا دور', 'select (public.current_staff_role() is null)::int', 1);
select test.count_is('005 غير مسؤولة: لا ترى years', 'select count(*) from public.years', 0);
select test.count_is('005 غير مسؤولة: لا ترى staff_profiles', 'select count(*) from public.staff_profiles', 0);
select test.blocked('005 لا إدراج ذاتي في staff_profiles (authenticated)', $$insert into public.staff_profiles (user_id, role) values ('00000000-0000-0000-0000-0000000000c3', 'director')$$);
select test.blocked('005 authenticated: لا تنفيذ bootstrap_staff', $$select public.bootstrap_staff('nobody-test@example.invalid', 'director')$$);
reset role;

-- (د) هوية مصادَق عليها لا وجود لها في staff_profiles (معرّف صفري): لا دور ولا بيانات. (لا نستعمل نصًا فارغًا: تحويله إلى uuid يخطئ في Supabase.)
select test.as_user('00000000-0000-0000-0000-000000000000');
set role authenticated;
select test.count_is('005 هوية مجهولة: لا دور', 'select (public.current_staff_role() is null)::int', 1);
select test.count_is('005 هوية مجهولة: لا ترى years', 'select count(*) from public.years', 0);
reset role;
set role anon;
select test.blocked('005 anon: لا تنفيذ bootstrap_staff', $$select public.bootstrap_staff('nobody-test@example.invalid', 'director')$$);
reset role;

-- (هـ) مالك قاعدة البيانات: حارس staff_profiles وقواعد bootstrap_staff.
select test.blocked('005 إدراج مباشر بلا bootstrap يُرفض بالمشغّل', $$insert into public.staff_profiles (user_id, role) values ('00000000-0000-0000-0000-0000000000c3', 'director')$$);
select test.blocked('005 حذف مسؤولة مرفوض', $$delete from public.staff_profiles where user_id = '00000000-0000-0000-0000-0000000000a1'$$);
select test.blocked('005 تغيير دور مسؤولة مرفوض', $$update public.staff_profiles set role = 'director' where user_id = '00000000-0000-0000-0000-0000000000a1'$$);
select test.fails_with('005 bootstrap: دور غير صالح', $$select public.bootstrap_staff('nobody-test@example.invalid', 'teacher')$$, '23514');
select test.fails_with('005 bootstrap: بريد غير موجود', $$select public.bootstrap_staff('ghost@example.invalid', 'owner')$$, 'P0002');
select test.fails_with('005 bootstrap: دور نشط موجود', $$select public.bootstrap_staff('nobody-test@example.invalid', 'owner')$$, '23505');
select test.fails_with('005 bootstrap: مستخدمة مسجَّلة من قبل', $$select public.bootstrap_staff('owner-test@example.invalid', 'director')$$, '23505');
select test.count_is('005 التدقيق سجّل إنشاء المسؤولَين', $$select count(*) from public.audit_log where action = 'staff.bootstrap'$$, 2);

-- (و) تعطيل المسؤولة بـis_active يسحب دورها فورًا (منع الدخول غير المصرَّح)، وإعادة التفعيل تعيده.
select test.allowed('005 التعطيل بـis_active مسموح', $$update public.staff_profiles set is_active = false where user_id = '00000000-0000-0000-0000-0000000000b2'$$);
select test.as_user('00000000-0000-0000-0000-0000000000b2');
set role authenticated;
select test.count_is('005 مسؤولة معطَّلة: لا دور', 'select (public.current_staff_role() is null)::int', 1);
select test.count_is('005 مسؤولة معطَّلة: لا ترى years', 'select count(*) from public.years', 0);
reset role;
select test.allowed('005 إعادة التفعيل مسموحة', $$update public.staff_profiles set is_active = true where user_id = '00000000-0000-0000-0000-0000000000b2'$$);
select test.as_user('00000000-0000-0000-0000-0000000000b2');
set role authenticated;
select test.count_is('005 المديرة بعد إعادة التفعيل: دورها director', $$select (public.current_staff_role() = 'director')::int$$, 1);
reset role;
-- END-TESTS
-- BEGIN-LOCAL-ONLY
\echo === انتهى 25_staff_accounts_005 ===
-- END-LOCAL-ONLY
