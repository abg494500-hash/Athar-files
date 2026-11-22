-- أثَر — اختبار الصلاحيات الفعلي على Supabase (مولَّد من tests/sql/10_security_003.sql و25_staff_accounts_005.sql؛ لا تعدّليه يدويًا).
-- يُشغَّل بعد 01_apply_all.sql ثم 01b_staff_accounts.sql. لا يحوي begin ولا commit عمدًا: النص كله معاملة ضمنية واحدة
-- (استعلام متعدد الأوامر)، وينتهي بخطأ مقصود فيتراجع كل شيء تلقائيًا ولا تبقى معاملة معلّقة على الاتصال.
-- الحارس الأول يمنع التنفيذ إن قسّم المحرر الأوامر؛ والتعطيلان الوحيدان لحماية حقيقية (مشغّل versions_match_session_bi وقيد
-- versions_file_verified) داخل كتلة DO تعيد فحص الحارس. بعد التشغيل شغّلي 03_post_check.sql للتأكد أن لا أثر باقٍ.
-- النتيجة تظهر كرسالة خطأ بعنوان RESULT: انسخيها كما هي وأرسليها (لا تحوي أسرارًا).
select set_config('athar.single_tx', 'on', true);
do $g$ begin
  if current_setting('athar.single_tx', true) is distinct from 'on' then raise exception 'ABORT: النص لم يُنفَّذ كمعاملة واحدة (المحرر قسّم الأوامر). لم يُجرَ شيء ضار؛ لا تكمل. أرسلي هذه الرسالة لي.'; end if;
  if to_regprocedure('public.bootstrap_staff(text,text)') is null or to_regclass('public.upload_sessions') is null then
    raise exception 'ABORT: شغّلي 01_apply_all.sql ثم 01b_staff_accounts.sql أولًا (لم يُغيَّر شيء).';
  end if;
end $g$;
create schema test;
create table test.results (msg text);
grant usage on schema test to anon, authenticated, service_role;
grant all on test.results to anon, authenticated, service_role;
create function test.note(fmt text, a text default null, b text default null, c text default null) returns void language plpgsql as $f$
begin insert into test.results values (format(replace(fmt, '%', '%s'), a, b, c)); end $f$;

grant usage on schema test to anon, authenticated, service_role;
-- يجب أن يُمنع الوصول بخطأ صلاحية فقط (42501: منح/RLS/مشغّل). أي خطأ آخر (مثل خطأ كتابة في العمود) يُعدّ FAIL حتى لا يُحسب نجاحًا زائفًا.
create function test.blocked(label text, stmt text) returns void language plpgsql as $$
begin
  execute stmt;
  perform test.note('FAIL  % — لم يُمنع', label::text);
exception
  when insufficient_privilege then perform test.note('PASS  %', label::text);
  when others then perform test.note('FAIL  % — خطأ مختلف: % %', label::text, sqlstate::text, sqlerrm::text);
end $$;
-- العمود غير موجود أصلًا (للمنظور الذي أُزيلت منه أعمدة التخزين): 42703 فقط.
create function test.no_column(label text, stmt text) returns void language plpgsql as $$
begin
  execute stmt;
  perform test.note('FAIL  % — العمود متاح', label::text);
exception
  when undefined_column then perform test.note('PASS  %', label::text);
  when others then perform test.note('FAIL  % — خطأ مختلف: % %', label::text, sqlstate::text, sqlerrm::text);
end $$;
-- يجب أن يُرفض بخطأ محدد (sqlstate).
create function test.fails_with(label text, stmt text, expected text) returns void language plpgsql as $$
begin
  execute stmt;
  perform test.note('FAIL  % — لم يُرفض', label::text);
exception when others then
  if sqlstate = expected then perform test.note('PASS  %', label::text);
  else perform test.note('FAIL  % — المتوقع % والحاصل % %', label::text, expected::text, sqlstate::text, sqlerrm::text); end if;
end $$;
-- يجب أن ينجح.
create function test.allowed(label text, stmt text) returns void language plpgsql as $$
begin
  execute stmt;
  perform test.note('PASS  %', label::text);
exception when others then perform test.note('FAIL  % — %: %', label::text, sqlstate::text, sqlerrm::text);
end $$;
-- استعلام يُرجع عددًا واحدًا (bigint) ويجب أن يساوي المتوقع.
create function test.count_is(label text, q text, expected bigint) returns void language plpgsql as $$
declare n bigint;
begin
  execute q into n;
  if n = expected then perform test.note('PASS  %', label::text);
  else perform test.note('FAIL  % — المتوقع % والحاصل %', label::text, expected::text, n::text); end if;
exception when others then perform test.note('FAIL  % — %: %', label::text, sqlstate::text, sqlerrm::text);
end $$;


create function test.as_user(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, false)
$$;

grant execute on all functions in schema test to anon, authenticated, service_role;
-- اختبارات الأمان الفعلية بعد تطبيق 001 ثم 002 ثم 003 (بلا 004). تُشغَّل بعد 00_bootstrap.sql.
-- تبدأ بتحاكي ما تمنحه Supabase افتراضيًا لـservice_role (مسار الخادم الموثوق)، ثم تزرع بيانات وهمية فقط.

-- تُنفَّذ قبل أي منح محاكاة لـservice_role كي تعكس الصلاحيات الافتراضية الحقيقية بعد سحب 005.
select test.count_is('service_role: لا تنفيذ bootstrap_staff',
  $$select has_function_privilege('service_role', 'public.bootstrap_staff(text,text)', 'execute')::int$$, 0);
select test.count_is('authenticated: لا تنفيذ bootstrap_staff',
  $$select has_function_privilege('authenticated', 'public.bootstrap_staff(text,text)', 'execute')::int$$, 0);
select test.count_is('anon: لا تنفيذ bootstrap_staff',
  $$select has_function_privilege('anon', 'public.bootstrap_staff(text,text)', 'execute')::int$$, 0);
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'owner-test@example.invalid'), ('00000000-0000-0000-0000-0000000000b2', 'director-test@example.invalid'), ('00000000-0000-0000-0000-0000000000c3', 'nobody-test@example.invalid');
select public.bootstrap_staff('owner-test@example.invalid', 'owner');
select public.bootstrap_staff('director-test@example.invalid', 'director');
insert into public.years (label, is_active) values ('2026-2027', true), ('2025-2026', false);
insert into public.terms (year_id, name, ord, deadline_base, deadline_late, deadline_replace)
  select id, 'الفصل الأول', 1, '2026-11-01', '2026-11-15', '2026-12-01' from public.years where label = '2026-2027';
insert into public.terms (year_id, name, ord, deadline_base, deadline_late, deadline_replace)
  select id, 'الفصل الأول', 1, '2025-11-01', '2025-11-15', '2025-12-01' from public.years where label = '2025-2026';
insert into public.teachers (name, subject) values ('معلمة اختبار', 'رياضيات');
insert into public.submissions (teacher_id, term_id, slot_id)
  select t.id, tm.id, 's1' from public.teachers t, public.terms tm where tm.name = 'الفصل الأول' and tm.deadline_base = '2026-11-01';
do $x$ begin
  if current_setting('athar.single_tx', true) is distinct from 'on' then raise exception 'ABORT: النص لم يُنفَّذ كمعاملة واحدة (المحرر قسّم الأوامر). لم يُجرَ شيء ضار؛ لا تكمل. أرسلي هذه الرسالة لي.'; end if;
  alter table public.versions disable trigger versions_match_session_bi;
  alter table public.versions drop constraint if exists versions_file_verified;
end $x$;
insert into public.versions (teacher_id, term_id, slot_id, no, kind, original_name, size_bytes, ext,
  storage_provider, storage_bucket, storage_key, sha256, submitted_at, status_snapshot, deadlines_snapshot)
  select teacher_id, term_id, slot_id, 1, 'file', 'plan.pdf', 1000, 'pdf',
         'r2', 'athar-private', 'SECRET/KEY/plan.pdf', repeat('a', 64), now(), 'on_time', '{}'::jsonb
  from public.submissions;
select public.log_audit('test.seed', 'test', 'x', '{}'::jsonb);

select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000b2', 'role', 'authenticated')::text, false);
set role authenticated;
select test.blocked('المديرة: select storage_key من versions', 'select storage_key from public.versions');
select test.blocked('المديرة: select storage_bucket', 'select storage_bucket from public.versions');
select test.blocked('المديرة: select storage_provider', 'select storage_provider from public.versions');
select test.blocked('المديرة: select * من versions', 'select * from public.versions');
select test.blocked('المديرة: to_jsonb(الصف كاملًا)', 'select to_jsonb(v) from public.versions v');
select test.blocked('المديرة: row_to_json(الصف كاملًا)', 'select row_to_json(v) from public.versions v');
select test.blocked('المديرة: قناة جانبية بشرط WHERE على storage_key', $$select id from public.versions where storage_key like 'SECRET%'$$);
select test.blocked('المديرة: ORDER BY على storage_key', 'select id from public.versions order by storage_key');
select test.blocked('المديرة: storage_key من archives', 'select storage_key from public.archives');
select test.blocked('المديرة: select * من archives', 'select * from public.archives');
select test.no_column('المديرة: storage_key من المنظور', 'select storage_key from public.v_backup_manifest');
select test.no_column('المديرة: storage_bucket من المنظور', 'select storage_bucket from public.v_backup_manifest');
select test.allowed('المديرة: الأعمدة غير السرية من versions', 'select id, original_name, size_bytes, sha256, storage_state from public.versions');
select test.count_is('المديرة: المنظور يعرض صفًا واحدًا', 'select count(*) from public.v_backup_manifest', 1);
select test.blocked('المديرة: code_hash', 'select code_hash from public.teacher_credentials');
select test.blocked('المديرة: pin_hash', 'select pin_hash from public.teacher_credentials');
select test.count_is('المديرة: لا ترى سجل العمليات', 'select count(*) from public.audit_log', 0);
select test.count_is('المديرة: لا ترى login_attempts', 'select count(*) from public.login_attempts', 0);
select test.count_is('المديرة: لا ترى archives', 'select count(id) from public.archives', 0);
reset role;

select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, false);
set role authenticated;
select test.blocked('المالكة: storage_key من versions', 'select storage_key from public.versions');
select test.blocked('المالكة: select * من versions', 'select * from public.versions');
select test.blocked('المالكة: storage_key من archives', 'select storage_key from public.archives');
select test.no_column('المالكة: storage_key من المنظور', 'select storage_key from public.v_backup_manifest');
select test.allowed('المالكة: أعمدة versions العلنية', 'select id, sha256, size_bytes from public.versions');
select test.count_is('المالكة ترى سجل العمليات (صف واحد على الأقل)', 'select (count(*) > 0)::int from public.audit_log', 1);
select test.blocked('المالكة: لا تعديل على versions', $$update public.versions set replaced_note = 'x'$$);
select test.blocked('المالكة: لا حذف من versions', 'delete from public.versions');
select test.blocked('المالكة: لا إدراج في versions', $$insert into public.versions (teacher_id, term_id, slot_id, no, kind, url, submitted_at, status_snapshot, deadlines_snapshot) select teacher_id, term_id, slot_id, 2, 'link', 'https://x.example', now(), 'on_time', '{}'::jsonb from public.submissions$$);
select test.blocked('المالكة: لا كتابة في audit_log', $$insert into public.audit_log (actor_role, action) values ('owner','x')$$);
select test.allowed('المالكة: تُنشئ سنة', $$insert into public.years (label, is_active) values ('2027-2028', false)$$);
reset role;

select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000c3', 'role', 'authenticated')::text, false);
set role authenticated;
select test.count_is('بلا دور: لا يرى versions (RLS)', 'select count(id) from public.versions', 0);
select test.count_is('بلا دور: لا يرى المنظور', 'select count(*) from public.v_backup_manifest', 0);
select test.count_is('بلا دور: لا يرى years', 'select count(*) from public.years', 0);
select test.blocked('بلا دور: storage_key', 'select storage_key from public.versions');
reset role;
set role anon;
select test.blocked('anon: versions', 'select id from public.versions');
select test.blocked('anon: years', 'select id from public.years');
select test.blocked('anon: المنظور', 'select * from public.v_backup_manifest');
select test.blocked('anon: current_staff_role()', 'select public.current_staff_role()');
select test.blocked('anon: audit_log', 'select * from public.audit_log');
reset role;

select test.count_is('authenticated: الدوال القابلة للتنفيذ = 3 فقط',
  $$select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute')$$, 3);
select test.count_is('الدوال الثلاث هي المتوقعة',
  $$select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute')
      and p.proname in ('current_staff_role','set_term_deadlines','verify_audit_chain')$$, 3);
select test.count_is('anon: لا تنفيذ لأي دالة في public',
  $$select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')$$, 0);
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000b2', 'role', 'authenticated')::text, false);
select test.blocked('المديرة: log_audit', $$select public.log_audit('x','x','x','{}'::jsonb)$$);
select test.blocked('المديرة: purge_old_login_attempts', 'select public.purge_old_login_attempts()');
reset role;

select test.count_is('anon: لا أي صلاحية على أي جدول في public',
  $$select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r','v') and has_any_column_privilege('anon', c.oid, 'select,insert,update,references')$$, 0);
select test.count_is('authenticated: لا حذف ولا TRUNCATE على أي جدول',
  $$select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and (has_table_privilege('authenticated', c.oid, 'delete') or has_table_privilege('authenticated', c.oid, 'truncate'))$$, 0);
select test.count_is('authenticated: لا SELECT على versions كجدول كامل', $$select has_table_privilege('authenticated','public.versions','select')::int$$, 0);
select test.count_is('authenticated: لا SELECT على archives كجدول كامل', $$select has_table_privilege('authenticated','public.archives','select')::int$$, 0);
select test.count_is('لا عمود تخزين مقروء في versions/archives لأي دور تطبيقي',
  $$select count(*) from information_schema.columns c
    where c.table_schema = 'public' and c.table_name in ('versions','archives') and c.column_name in ('storage_provider','storage_bucket','storage_key')
      and (has_column_privilege('authenticated', format('public.%I', c.table_name)::regclass, c.column_name, 'select')
        or has_column_privilege('anon', format('public.%I', c.table_name)::regclass, c.column_name, 'select'))$$, 0);
select test.count_is('لا عمود تخزين في أي منظور في public (عدا storage_state)',
  $$select count(*) from information_schema.columns c join information_schema.tables t using (table_schema, table_name)
    where c.table_schema = 'public' and t.table_type = 'VIEW' and c.column_name like 'storage\_%' and c.column_name <> 'storage_state'$$, 0);
select test.count_is('أعمدة versions غير السرية كلها مقروءة (لم يُمنع أكثر من اللازم)',
  $$select count(*) from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'versions' and c.column_name not in ('storage_provider','storage_bucket','storage_key','upload_session_id')
      and not has_column_privilege('authenticated', 'public.versions'::regclass, c.column_name, 'select')$$, 0);
select test.count_is('code_hash/pin_hash غير مقروءين',
  $$select count(*) from information_schema.columns c where c.table_schema='public' and c.table_name='teacher_credentials'
    and c.column_name in ('code_hash','pin_hash') and has_column_privilege('authenticated','public.teacher_credentials'::regclass,c.column_name,'select')$$, 0);

set role service_role;
select test.count_is('service_role: يقرأ storage_key', $$select count(*) from public.versions where storage_key like 'SECRET%'$$, 1);
reset role;

select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000c3', 'role', 'authenticated')::text, false);
set role authenticated;
select test.blocked('بلا دور: set_term_deadlines', $$select public.set_term_deadlines((select id from public.terms limit 1), '2026-11-02','2026-11-16','2026-12-02','سبب')$$);
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000b2', 'role', 'authenticated')::text, false);
set role authenticated;
select test.allowed('المديرة: تعدّل مواعيد فصل السنة النشطة بسبب',
  $$select public.set_term_deadlines((select t.id from public.terms t join public.years y on y.id = t.year_id where y.is_active), '2026-11-02','2026-11-16','2026-12-02','اختبار')$$);
select test.blocked('المديرة: لا تعدّل فصل سنة غير نشطة',
  $$select public.set_term_deadlines((select t.id from public.terms t join public.years y on y.id = t.year_id where not y.is_active), '2025-11-02','2025-11-16','2025-12-02','اختبار')$$);
select test.blocked('المديرة: لا تحديث مباشر لمواعيد الفصول (منح الأعمدة)', $$update public.terms set deadline_base = '2026-11-03'$$);
select test.count_is('المديرة: لا أثر لتحديث الفصول (RLS يصفّيها بلا خطأ؛ الموعد لم يتغيّر)', $$select count(*) from public.terms where deadline_base = '2026-11-03'$$, 0);
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, false);
set role authenticated;
select test.blocked('المالكة: لا تحديث مباشر للمواعيد', $$update public.terms set deadline_base = '2026-11-04'$$);
-- مسبار S-1: أُكِّد بالتنفيذ قبل الإصلاح (2026-10-21)؛ صار اختبار انحدار دائمًا.
select set_config('app.via_set_term_deadlines', 'on', false);
select test.blocked('مسبار S-1: المالكة لا تتجاوز الحارس بضبط الـGUC بنفسها (تاريخ صالح الترتيب)', $$update public.terms set deadline_late = '2026-11-18' where year_id = (select id from public.years where is_active)$$);
select test.count_is('S-1 انحدار: موعد الفصل لم يتغيّر بالتحايل', $$select count(*) from public.terms where deadline_late = '2026-11-18'$$, 0);
select test.allowed('المالكة: ما زالت تعدّل اسم الفصل مباشرة (غير المواعيد)', $$update public.terms set name = 'الفصل الأول' where ord = 1$$);
select set_config('app.via_set_term_deadlines', 'off', false);
reset role;

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

reset role;
do $r$
declare v_pass int; v_fail int; v_msg text;
begin
  select count(*) filter (where msg like 'PASS%'), count(*) filter (where msg like 'FAIL%') into v_pass, v_fail from test.results;
  select string_agg(msg, E'\n') into v_msg from test.results where msg like 'FAIL%';
  raise exception E'RESULT: PASS=% FAIL=%\n%\n(إلغاء مقصود لكل ما سبق: لا أثر باقٍ — شغّلي 03_post_check.sql للتحقق)', v_pass, v_fail, coalesce(v_msg, 'لا إخفاقات');
end $r$;
