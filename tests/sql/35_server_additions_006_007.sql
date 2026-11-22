-- اختبارات 006 (جلسات المعلمات) و007 (log_audit_as + حارس الأرشيف + الفهرس). **غير مُشغَّلة بعد** (لا PostgreSQL في بيئة كتابتها).
-- محليًا فقط، على قاعدة اختبار جديدة: 00_bootstrap ثم 001 ثم 002 ثم 003 ثم 004 ثم 005 ثم 006 ثم 007 ثم هذا الملف (يفعل ذلك run-sql-tests.sh كتشغيل d).
-- لا يُدمج في supabase/02_security_check.sql؛ على Supabase يُكتفى بفحص القراءة supabase/03b_post_check_additions.sql.
\set ON_ERROR_STOP off
create function test.as_user(uid text) returns void language sql as $$ select set_config('app.uid', uid, false) $$;
grant execute on function test.as_user(text) to anon, authenticated, service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
-- التعريضة الافتراضية الحقيقية لـ007 تُفحص قبل منح المحاكاة؟ لا: المنح أعلاه يحاكي ما تمنحه Supabase افتراضيًا للجداول لا لدوال 007 (تُسحب صراحةً)؛
-- لذلك نعيد سحب/منح دالة log_audit_as كما تفعل 007 لنختبر النتيجة الفعلية:
revoke all on function public.log_audit_as(uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.log_audit_as(uuid, text, text, text, jsonb) to service_role;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'owner-test@example.invalid'),
  ('00000000-0000-0000-0000-0000000000b2', 'director-test@example.invalid'),
  ('00000000-0000-0000-0000-0000000000c3', 'nobody-test@example.invalid');
select public.bootstrap_staff('owner-test@example.invalid', 'owner');
select public.bootstrap_staff('director-test@example.invalid', 'director');
insert into public.years (label, is_active) values ('2026-2027', true);
insert into public.terms (year_id, name, ord, deadline_base, deadline_late, deadline_replace)
  select id, 'الأول', 1, date '2026-10-20', date '2026-10-30', date '2026-11-15' from public.years;
insert into public.teachers (id, name, subject) values
  ('00000000-0000-0000-0000-000000000001', 'معلمة أ', 'علوم'), ('00000000-0000-0000-0000-000000000002', 'معلمة ب', 'رياضيات');

\echo === (1) 006: جلسات المعلمات ===
select test.count_is('006: RLS مفعّلة على teacher_sessions', $$select relrowsecurity::int from pg_class where oid = 'public.teacher_sessions'::regclass$$, 1);
select test.count_is('006: لا policies على teacher_sessions', $$select count(*) from pg_policies where tablename = 'teacher_sessions'$$, 0);
select test.count_is('006: anon بلا SELECT', $$select has_table_privilege('anon', 'public.teacher_sessions', 'select')::int$$, 0);
select test.count_is('006: authenticated بلا SELECT', $$select has_table_privilege('authenticated', 'public.teacher_sessions', 'select')::int$$, 0);
select test.count_is('006: authenticated بلا INSERT', $$select has_table_privilege('authenticated', 'public.teacher_sessions', 'insert')::int$$, 0);
set role authenticated;
select test.blocked('006: authenticated لا يقرأ الجلسات', 'select * from public.teacher_sessions');
reset role;
set role service_role;
select test.allowed('006: service_role يُدرج جلسة', $$insert into public.teacher_sessions (teacher_id, token_hash, expires_at) values ('00000000-0000-0000-0000-000000000001', repeat('a', 64), now() + interval '1 hour')$$);
select test.fails_with('006: بصمة رمز مكرّرة', $$insert into public.teacher_sessions (teacher_id, token_hash, expires_at) values ('00000000-0000-0000-0000-000000000002', repeat('a', 64), now() + interval '1 hour')$$, '23505');
select test.fails_with('006: بصمة بشكل خاطئ', $$insert into public.teacher_sessions (teacher_id, token_hash, expires_at) values ('00000000-0000-0000-0000-000000000002', 'not-hex', now() + interval '1 hour')$$, '23514');
select test.fails_with('006: انتهاء قبل الإنشاء', $$insert into public.teacher_sessions (teacher_id, token_hash, created_at, expires_at) values ('00000000-0000-0000-0000-000000000002', repeat('b', 64), now(), now() - interval '1 hour')$$, '23514');
select test.fails_with('006: معلمة غير موجودة', $$insert into public.teacher_sessions (teacher_id, token_hash, expires_at) values ('00000000-0000-0000-0000-0000000000ff', repeat('c', 64), now() + interval '1 hour')$$, '23503');
select test.allowed('006: إبطال الجلسة (revoked_at)', $$update public.teacher_sessions set revoked_at = now() where token_hash = repeat('a', 64)$$);
select test.fails_with('006: لا حذف للمعلمة صاحبة جلسة (restrict/forbid)', $$delete from public.teachers where id = '00000000-0000-0000-0000-000000000001'$$, '42501');
-- فهرس بصمة الكود
select test.allowed('006: إدراج بيانات اعتماد بكود A', $$insert into public.teacher_credentials (teacher_id, code_hash) values ('00000000-0000-0000-0000-000000000001', repeat('1', 64))$$);
select test.fails_with('006: كود مكرّر لمعلمة أخرى', $$insert into public.teacher_credentials (teacher_id, code_hash) values ('00000000-0000-0000-0000-000000000002', repeat('1', 64))$$, '23505');
select test.allowed('006: كودان بلا بصمة (null) مسموحان', $$insert into public.teacher_credentials (teacher_id, code_hash) values ('00000000-0000-0000-0000-000000000002', null)$$);
reset role;

\echo === (2) 007: log_audit_as ===
select test.count_is('007: anon بلا تنفيذ', $$select has_function_privilege('anon', 'public.log_audit_as(uuid,text,text,text,jsonb)', 'execute')::int$$, 0);
select test.count_is('007: authenticated بلا تنفيذ', $$select has_function_privilege('authenticated', 'public.log_audit_as(uuid,text,text,text,jsonb)', 'execute')::int$$, 0);
select test.count_is('007: service_role ينفّذ', $$select has_function_privilege('service_role', 'public.log_audit_as(uuid,text,text,text,jsonb)', 'execute')::int$$, 1);
set role authenticated;
select test.blocked('007: authenticated لا يستدعي log_audit_as', $$select public.log_audit_as('00000000-0000-0000-0000-0000000000a1', 'x', null, null, null)$$);
reset role;
set role service_role;
select test.fails_with('007: منفِّذة غير موظفة', $$select public.log_audit_as('00000000-0000-0000-0000-0000000000c3', 'upload.owner_release', 'upload_session', 's', '{}'::jsonb)$$, '42501');
select test.fails_with('007: إجراء فارغ', $$select public.log_audit_as('00000000-0000-0000-0000-0000000000a1', '  ', null, null, null)$$, '23514');
select test.allowed('007: المالكة تُسجَّل', $$select public.log_audit_as('00000000-0000-0000-0000-0000000000a1', 'upload.owner_release', 'upload_session', 'sess-1', '{"note":"x"}'::jsonb)$$);
select test.allowed('007: المديرة تُسجَّل', $$select public.log_audit_as('00000000-0000-0000-0000-0000000000b2', 'staff.download', 'version', 'v-1', null)$$);
reset role;
select test.count_is('007: الدور يؤخذ من staff_profiles (owner)', $$select count(*) from public.audit_log where action = 'upload.owner_release' and actor_role = 'owner' and actor_id = '00000000-0000-0000-0000-0000000000a1'$$, 1);
select test.count_is('007: الدور يؤخذ من staff_profiles (director)', $$select count(*) from public.audit_log where action = 'staff.download' and actor_role = 'director'$$, 1);
select test.count_is('007: لا سطر لمنفِّذة غير موظفة', $$select count(*) from public.audit_log where actor_id = '00000000-0000-0000-0000-0000000000c3'$$, 0);
update public.staff_profiles set is_active = false where user_id = '00000000-0000-0000-0000-0000000000b2';
set role service_role;
select test.fails_with('007: موظفة موقوفة تُرفض', $$select public.log_audit_as('00000000-0000-0000-0000-0000000000b2', 'staff.download', 'version', 'v-2', null)$$, '42501');
reset role;
update public.staff_profiles set is_active = true where user_id = '00000000-0000-0000-0000-0000000000b2';
select test.as_user('00000000-0000-0000-0000-0000000000a1');
set role authenticated;
select test.count_is('007: سلسلة التدقيق سليمة بعد الكتابات', $$select (ok)::int from public.verify_audit_chain()$$, 1);
reset role;

\echo === (3) 007: حارس archives ===
set role service_role;
select test.allowed('007: إنشاء أرشيف creating', $$insert into public.archives (id, title, year_id, term_id) select '00000000-0000-0000-0000-0000000000d1', 'أ', y.id, t.id from public.years y join public.terms t on t.year_id = y.id$$);
select test.fails_with('007: creating → verified مباشرة ممنوع', $$update public.archives set state = 'verified' where id = '00000000-0000-0000-0000-0000000000d1'$$, '42501');
select test.fails_with('007: awaiting_verification بلا بصمة/مفتاح ممنوع', $$update public.archives set state = 'awaiting_verification' where id = '00000000-0000-0000-0000-0000000000d1'$$, '23514');
select test.fails_with('007: تغيير العنوان ممنوع', $$update public.archives set title = 'ب' where id = '00000000-0000-0000-0000-0000000000d1'$$, '42501');
select test.allowed('007: creating → awaiting_verification مع كل الحقول', $$update public.archives set state = 'awaiting_verification', size_bytes = 10, entries_count = 1, sha256 = repeat('a', 64), storage_provider = 'r2', storage_key = 'archives/x.zip', manifest_sha256 = repeat('b', 64) where id = '00000000-0000-0000-0000-0000000000d1'$$);
select test.fails_with('007: لا طابع تنزيل قبل verified', $$update public.archives set download_hash_verified_at = now(), download_completed_at = now() where id = '00000000-0000-0000-0000-0000000000d1'$$, '23514');
select test.fails_with('007: البصمة تُكتب مرة واحدة', $$update public.archives set sha256 = repeat('c', 64) where id = '00000000-0000-0000-0000-0000000000d1'$$, '42501');
select test.fails_with('007: مفتاح التخزين مرة واحدة', $$update public.archives set storage_key = 'archives/y.zip' where id = '00000000-0000-0000-0000-0000000000d1'$$, '42501');
select test.allowed('007: awaiting → verified', $$update public.archives set state = 'verified', checks = '[{"check":"readback_sha256_and_size","ok":true}]'::jsonb where id = '00000000-0000-0000-0000-0000000000d1'$$);
select test.fails_with('007: verified → creating ممنوع', $$update public.archives set state = 'creating' where id = '00000000-0000-0000-0000-0000000000d1'$$, '42501');
select test.allowed('007: طابعا التنزيل والتحقق لأرشيف verified', $$update public.archives set download_hash_verified_at = now(), download_completed_at = now() where id = '00000000-0000-0000-0000-0000000000d1'$$);
select test.allowed('007: إعادة coalesce بنفس القيمة لا تُرفض', $$update public.archives set download_hash_verified_at = coalesce(download_hash_verified_at, now()), download_completed_at = coalesce(download_completed_at, now()) where id = '00000000-0000-0000-0000-0000000000d1'$$);
select test.fails_with('007: الطابع لا يُعاد كتابته بقيمة أخرى', $$update public.archives set download_hash_verified_at = now() + interval '1 day' where id = '00000000-0000-0000-0000-0000000000d1'$$, '42501');
select test.fails_with('007: لا حذف للأرشيف (002)', $$delete from public.archives where id = '00000000-0000-0000-0000-0000000000d1'$$, '42501');
select test.allowed('007: أرشيف ثانٍ creating', $$insert into public.archives (id, title, year_id) select '00000000-0000-0000-0000-0000000000d2', 'ب', id from public.years$$);
select test.allowed('007: creating → failed', $$update public.archives set state = 'failed', checks = '[{"check":"failed","ok":false}]'::jsonb where id = '00000000-0000-0000-0000-0000000000d2'$$);
select test.count_is('007: التحديث لمس صفًّا فعلًا (failed)', $$select count(*) from public.archives where id = '00000000-0000-0000-0000-0000000000d2' and state = 'failed'$$, 1);
select test.fails_with('007: failed لا يُعدَّل', $$update public.archives set checks = '[]'::jsonb where id = '00000000-0000-0000-0000-0000000000d2'$$, '42501');
select test.fails_with('007: failed → verified ممنوع', $$update public.archives set state = 'verified' where id = '00000000-0000-0000-0000-0000000000d2'$$, '42501');
reset role;

\echo === (4) 007: الفهرس ===
select test.count_is('007: فهرس versions_teacher_term موجود', $$select count(*) from pg_indexes where indexname = 'versions_teacher_term'$$, 1);
select test.count_is('007: لا تغيير في عدد جداول public عن 001..006 (15 من 001 + upload_attempts من 004 + teacher_sessions من 006؛ 007 بلا جداول)', $$select count(*) from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'$$, 17);
