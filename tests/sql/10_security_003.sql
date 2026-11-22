-- اختبارات الأمان الفعلية بعد تطبيق 001 ثم 002 ثم 003 (بلا 004). تُشغَّل بعد 00_bootstrap.sql.
-- تبدأ بتحاكي ما تمنحه Supabase افتراضيًا لـservice_role (مسار الخادم الموثوق)، ثم تزرع بيانات وهمية فقط.
\set ON_ERROR_STOP off
\set owner  '00000000-0000-0000-0000-0000000000a1'
\set dir    '00000000-0000-0000-0000-0000000000b2'
\set nobody '00000000-0000-0000-0000-0000000000c3'

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

insert into auth.users (id) values (:'owner'), (:'dir'), (:'nobody');
insert into public.staff_profiles (user_id, role) values (:'owner', 'owner'), (:'dir', 'director');
insert into public.years (label, is_active) values ('2026-2027', true), ('2025-2026', false);
insert into public.terms (year_id, name, ord, deadline_base, deadline_late, deadline_replace)
  select id, 'الفصل الأول', 1, '2026-11-01', '2026-11-15', '2026-12-01' from public.years where label = '2026-2027';
insert into public.terms (year_id, name, ord, deadline_base, deadline_late, deadline_replace)
  select id, 'الفصل الأول', 1, '2025-11-01', '2025-11-15', '2025-12-01' from public.years where label = '2025-2026';
insert into public.teachers (name, subject) values ('معلمة اختبار', 'رياضيات');
insert into public.submissions (teacher_id, term_id, slot_id)
  select t.id, tm.id, 's1' from public.teachers t, public.terms tm where tm.name = 'الفصل الأول' and tm.deadline_base = '2026-11-01';
insert into public.versions (teacher_id, term_id, slot_id, no, kind, original_name, size_bytes, ext,
  storage_provider, storage_bucket, storage_key, sha256, submitted_at, status_snapshot, deadlines_snapshot)
  select teacher_id, term_id, slot_id, 1, 'file', 'plan.pdf', 1000, 'pdf',
         'r2', 'athar-private', 'SECRET/KEY/plan.pdf', repeat('a', 64), now(), 'on_time', '{}'::jsonb
  from public.submissions;
select public.log_audit('test.seed', 'test', 'x', '{}'::jsonb);

\echo === (1) المديرة: لا وصول لمفاتيح التخزين عبر الجداول والمنظور ومسارات بديلة ===
select set_config('app.uid', :'dir', false);
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

\echo === (2) المالكة: أيضًا بلا وصول لمفاتيح التخزين عبر الجداول (المفاتيح للخادم فقط) ===
select set_config('app.uid', :'owner', false);
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

\echo === (3) حساب مسجّل بلا ملف موظفة، وحساب مجهول anon ===
select set_config('app.uid', :'nobody', false);
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

\echo === (4) الدوال: لا تنفيذ لغير المصرّح به (فحص الكتالوج الفعلي) ===
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
select set_config('app.uid', :'dir', false);
select test.blocked('المديرة: log_audit', $$select public.log_audit('x','x','x','{}'::jsonb)$$);
select test.blocked('المديرة: purge_old_login_attempts', 'select public.purge_old_login_attempts()');
reset role;

\echo === (5) الجداول والأعمدة: فحص الصلاحيات الفعلي من الكتالوج ===
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
    where c.table_schema = 'public' and c.table_name = 'versions' and c.column_name not in ('storage_provider','storage_bucket','storage_key')
      and not has_column_privilege('authenticated', 'public.versions'::regclass, c.column_name, 'select')$$, 0);
select test.count_is('code_hash/pin_hash غير مقروءين',
  $$select count(*) from information_schema.columns c where c.table_schema='public' and c.table_name='teacher_credentials'
    and c.column_name in ('code_hash','pin_hash') and has_column_privilege('authenticated','public.teacher_credentials'::regclass,c.column_name,'select')$$, 0);

\echo === (6) مسار الخادم الموثوق (service_role محاكى) يقرأ المفاتيح ===
set role service_role;
select test.count_is('service_role: يقرأ storage_key', $$select count(*) from public.versions where storage_key like 'SECRET%'$$, 1);
reset role;

\echo === (7) المواعيد: set_term_deadlines والتحايل عليها ===
select set_config('app.uid', :'nobody', false);
set role authenticated;
select test.blocked('بلا دور: set_term_deadlines', $$select public.set_term_deadlines((select id from public.terms limit 1), '2026-11-02','2026-11-16','2026-12-02','سبب')$$);
reset role;
select set_config('app.uid', :'dir', false);
set role authenticated;
select test.allowed('المديرة: تعدّل مواعيد فصل السنة النشطة بسبب',
  $$select public.set_term_deadlines((select t.id from public.terms t join public.years y on y.id = t.year_id where y.is_active), '2026-11-02','2026-11-16','2026-12-02','اختبار')$$);
select test.blocked('المديرة: لا تعدّل فصل سنة غير نشطة',
  $$select public.set_term_deadlines((select t.id from public.terms t join public.years y on y.id = t.year_id where not y.is_active), '2025-11-02','2025-11-16','2025-12-02','اختبار')$$);
select test.blocked('المديرة: لا تحديث مباشر لمواعيد الفصول (منح الأعمدة)', $$update public.terms set deadline_base = '2026-11-03'$$);
select test.count_is('المديرة: لا أثر لتحديث الفصول (RLS يصفّيها بلا خطأ؛ الموعد لم يتغيّر)', $$select count(*) from public.terms where deadline_base = '2026-11-03'$$, 0);
reset role;
select set_config('app.uid', :'owner', false);
set role authenticated;
select test.blocked('المالكة: لا تحديث مباشر للمواعيد', $$update public.terms set deadline_base = '2026-11-04'$$);
-- مسبار S-1: أُكِّد بالتنفيذ قبل الإصلاح (2026-10-21)؛ صار اختبار انحدار دائمًا.
select set_config('app.via_set_term_deadlines', 'on', false);
select test.blocked('مسبار S-1: المالكة لا تتجاوز الحارس بضبط الـGUC بنفسها (تاريخ صالح الترتيب)', $$update public.terms set deadline_late = '2026-11-18' where year_id = (select id from public.years where is_active)$$);
select test.count_is('S-1 انحدار: موعد الفصل لم يتغيّر بالتحايل', $$select count(*) from public.terms where deadline_late = '2026-11-18'$$, 0);
select test.allowed('المالكة: ما زالت تعدّل اسم الفصل مباشرة (غير المواعيد)', $$update public.terms set name = 'الفصل الأول' where ord = 1$$);
select set_config('app.via_set_term_deadlines', 'off', false);
reset role;
\echo === انتهى 10_security_003 ===
