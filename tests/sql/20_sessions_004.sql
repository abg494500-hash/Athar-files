-- اختبارات جلسات الرفع على 001–003 ثم مسودة 004 v4 (تُطبَّق على قاعدة فارغة). تحتوي انتظارًا حقيقيًا (~62 ثانية) لاختبار الانقضاء.
-- محاكاة التزامن هنا **تسلسلية** في جلسة واحدة؛ اختبار التزامن الحقيقي (جلستا psql متوازيتان) في 30_concurrency.md يدويًا.
\set ON_ERROR_STOP off
\set owner  '00000000-0000-0000-0000-0000000000a1'
\set dir    '00000000-0000-0000-0000-0000000000b2'

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

insert into auth.users (id) values (:'owner'), (:'dir');
insert into public.staff_profiles (user_id, role) values (:'owner', 'owner'), (:'dir', 'director');
insert into public.years (label, is_active) values ('2026-2027', true);
insert into public.terms (year_id, name, ord, deadline_base, deadline_late, deadline_replace)
  select id, 'الفصل الأول', 1, '2026-11-01', '2026-11-15', '2026-12-01' from public.years;
insert into public.teachers (name, subject) values ('معلمة اختبار', 'رياضيات');
insert into public.submissions (teacher_id, term_id, slot_id)
  select t.id, tm.id, s.id from public.teachers t, public.terms tm, public.slots s;

create function test.ins_session(k text, inh uuid default null, slot text default 's1') returns uuid
language sql security definer set search_path = '' as $$
  insert into public.upload_sessions (teacher_id, term_id, slot_id, declared_name, declared_size, idempotency_key, status_at_start, expires_at, inherited_from)
  select t.id, tm.id, slot, 'plan.pdf', 1000, k, 'on_time', now() + interval '1 day', inh from public.teachers t, public.terms tm
  returning id
$$;
create function test.sid(k text) returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.upload_sessions where idempotency_key = k
$$;
grant execute on all functions in schema test to service_role, authenticated, anon;

\echo === (1) الإعدادات والإدراج ===
select test.count_is('validating_stuck_minutes الافتراضي 10', 'select validating_stuck_minutes from public.app_settings', 10);
set role service_role;
select test.allowed('جلسة جديدة', $$select test.ins_session('k1')$$);
select test.count_is('الأزمنة من القاعدة: expires = started + 120 دقيقة، وeffective_start_at = started_at',
  $$select count(*) from public.upload_sessions where idempotency_key = 'k1' and expires_at = started_at + interval '120 minutes' and effective_start_at = started_at$$, 1);
select test.fails_with('جلسة نشطة ثانية لنفس الخانة', $$select test.ins_session('k-dup')$$, '23505');
select test.fails_with('مفتاح التكرار نفسه لا ينشئ جلسة ثانية', $$select test.ins_session('k1')$$, '23505');

\echo === (2) الانتقالات والاستئناف والإفراج ===
select test.fails_with('started → accepted ممنوع', $$update public.upload_sessions set state = 'accepted' where idempotency_key = 'k1'$$, '42501');
select test.allowed('started → uploaded', $$update public.upload_sessions set state = 'uploaded' where idempotency_key = 'k1'$$);
select test.allowed('uploaded → validating', $$update public.upload_sessions set state = 'validating' where idempotency_key = 'k1'$$);
select test.count_is('validating_at يُضبط عند الدخول', $$select count(*) from public.upload_sessions where idempotency_key = 'k1' and validating_at is not null$$, 1);
select test.allowed('validating → uploaded (استئناف، بلا رفض)', $$update public.upload_sessions set state = 'uploaded' where idempotency_key = 'k1'$$);
select test.count_is('validating_at يُمسح عند العودة وuploaded_at ثابت', $$select count(*) from public.upload_sessions where idempotency_key = 'k1' and validating_at is null and uploaded_at is not null and reject_reason is null$$, 1);
select test.fails_with('لا تغيير لـuploaded_at (يُكتب مرة)', $$update public.upload_sessions set uploaded_at = now() + interval '1 hour' where idempotency_key = 'k1'$$, '42501');
select test.allowed('uploaded → validating ثانية', $$update public.upload_sessions set state = 'validating' where idempotency_key = 'k1'$$);
select test.fails_with('رفض بسبب stalled غير مسموح (القيد)', $$update public.upload_sessions set state = 'rejected', reject_reason = 'stalled' where idempotency_key = 'k1'$$, '23514');
select test.fails_with('الإفراج بلا ملاحظة ممنوع', $$update public.upload_sessions set state = 'cancelled' where idempotency_key = 'k1'$$, '23514');
select test.fails_with('علامة عطل المنصة بلا ملاحظة ممنوعة', $$update public.upload_sessions set state = 'cancelled', platform_fault = true where idempotency_key = 'k1'$$, '23514');
select test.allowed('الإفراج بملاحظة وبعلامة عطل المنصة', $$update public.upload_sessions set state = 'cancelled', release_note = 'عطل التخزين', platform_fault = true where idempotency_key = 'k1'$$);
select test.fails_with('الجلسة الملغاة لا تُحيا (started)', $$update public.upload_sessions set state = 'started' where idempotency_key = 'k1'$$, '42501');
select test.fails_with('الجلسة الملغاة لا تُحيا (uploaded)', $$update public.upload_sessions set state = 'uploaded' where idempotency_key = 'k1'$$, '42501');
select test.fails_with('الجلسة الملغاة لا يُعدَّل أي حقل منها', $$update public.upload_sessions set release_note = 'تغيير' where idempotency_key = 'k1'$$, '42501');
select test.fails_with('لا حذف للجلسات', $$delete from public.upload_sessions where idempotency_key = 'k1'$$, '42501');

\echo === (3) الوراثة الصريحة ===
select test.allowed('جلسة وارثة من الإفراج المعلَّم', $$select test.ins_session('k2', test.sid('k1'))$$);
select test.count_is('ورثت effective_start_at من الأصل وبدأت نافذتها من جديد',
  $$select count(*) from public.upload_sessions a, public.upload_sessions b where a.idempotency_key = 'k2' and b.idempotency_key = 'k1'
    and a.effective_start_at = b.started_at and a.started_at > b.started_at and a.status_at_start = b.status_at_start$$, 1);
select test.allowed('إلغاء الوارثة (started → cancelled)', $$update public.upload_sessions set state = 'cancelled' where idempotency_key = 'k2'$$);
select test.fails_with('وراثة ثانية من نفس الأصل ممنوعة (مرة واحدة)', $$select test.ins_session('k3', test.sid('k1'))$$, '23505');
select test.allowed('جلسة عادية k4', $$select test.ins_session('k4')$$);
select test.allowed('إلغاؤها بلا علامة عطل', $$update public.upload_sessions set state = 'cancelled' where idempotency_key = 'k4'$$);
select test.fails_with('لا وراثة من جلسة بلا علامة عطل منصة', $$select test.ins_session('k5', test.sid('k4'))$$, '23514');

\echo === (4) الانقضاء الفعلي (نافذة دقيقة واحدة + انتظار 62 ثانية) ===
reset role;
update public.app_settings set upload_window_minutes = 1;
set role service_role;
select test.allowed('kt1 (خانة s1) وkt2 (خانة s2)', $$select test.ins_session('kt1'), test.ins_session('kt2', null, 's2')$$);
select test.allowed('kt2: uploaded قبل الانقضاء', $$update public.upload_sessions set state = 'uploaded' where idempotency_key = 'kt2'$$);
select test.allowed('kt2: validating قبل الانقضاء', $$update public.upload_sessions set state = 'validating' where idempotency_key = 'kt2'$$);
select test.fails_with('expired قبل انتهاء النافذة ممنوع', $$update public.upload_sessions set state = 'expired', reject_reason = 'expired' where idempotency_key = 'kt1'$$, '23514');
reset role;
select pg_sleep(62);
set role service_role;
select test.fails_with('kt1: لا uploaded بعد الانقضاء', $$update public.upload_sessions set state = 'uploaded' where idempotency_key = 'kt1'$$, '23514');
select test.allowed('kt1: expired بعد الانقضاء', $$update public.upload_sessions set state = 'expired', reject_reason = 'expired' where idempotency_key = 'kt1'$$);
select test.allowed('kt2: validating → uploaded بعد انقضاء النافذة (إصلاح خلل v2)', $$update public.upload_sessions set state = 'uploaded' where idempotency_key = 'kt2'$$);
select test.count_is('kt2: uploaded_at لم يُعَد كتابته', $$select count(*) from public.upload_sessions where idempotency_key = 'kt2' and uploaded_at < expires_at$$, 1);
select test.allowed('kt2: استئناف validating', $$update public.upload_sessions set state = 'validating' where idempotency_key = 'kt2'$$);

\echo === (5) الإصدار مرتبط بجلسته ===
select test.allowed('تسجيل قياس التحقق في الجلسة', $$update public.upload_sessions set verified_size = 1000, verified_sha256 = repeat('b', 64), validation_result = '{"ok":true}'::jsonb where idempotency_key = 'kt2'$$);
select test.fails_with('إصدار بلا جلسة ممنوع', $$insert into public.versions (teacher_id, term_id, slot_id, no, kind, original_name, size_bytes, ext, storage_provider, storage_bucket, storage_key, sha256, submitted_at, status_snapshot, deadlines_snapshot, validated_at, validation_result)
  select teacher_id, term_id, slot_id, 1, 'file', 'plan.pdf', 1000, 'pdf', 'r2', 'b', 'k', repeat('b', 64), now(), 'on_time', '{}'::jsonb, now(), '{}'::jsonb from public.submissions where slot_id = 's2'$$, '23514');
select test.fails_with('إصدار ببصمة لا تطابق المقيسة', $$insert into public.versions (teacher_id, term_id, slot_id, no, kind, original_name, size_bytes, ext, storage_provider, storage_bucket, storage_key, sha256, submitted_at, status_snapshot, deadlines_snapshot, validated_at, validation_result, upload_session_id)
  select s.teacher_id, s.term_id, s.slot_id, 1, 'file', 'plan.pdf', 1000, 'pdf', 'r2', 'b', 'k', repeat('c', 64), s.effective_start_at, 'on_time', '{}'::jsonb, now(), '{}'::jsonb, s.id from public.upload_sessions s where s.idempotency_key = 'kt2'$$, '23514');
select test.fails_with('إصدار بوقت تسليم لا يطابق وقت البدء المعتمد', $$insert into public.versions (teacher_id, term_id, slot_id, no, kind, original_name, size_bytes, ext, storage_provider, storage_bucket, storage_key, sha256, submitted_at, status_snapshot, deadlines_snapshot, validated_at, validation_result, upload_session_id)
  select s.teacher_id, s.term_id, s.slot_id, 1, 'file', 'plan.pdf', 1000, 'pdf', 'r2', 'b', 'k', repeat('b', 64), now() + interval '1 day', 'on_time', '{}'::jsonb, now(), '{}'::jsonb, s.id from public.upload_sessions s where s.idempotency_key = 'kt2'$$, '23514');
select test.allowed('إصدار مطابق لجلسته', $$insert into public.versions (teacher_id, term_id, slot_id, no, kind, original_name, size_bytes, ext, storage_provider, storage_bucket, storage_key, sha256, submitted_at, status_snapshot, deadlines_snapshot, validated_at, validation_result, upload_session_id)
  select s.teacher_id, s.term_id, s.slot_id, 1, 'file', 'plan.pdf', 1000, 'pdf', 'r2', 'athar-private', 'SECRET/KEY/plan.pdf', repeat('b', 64), s.effective_start_at, 'on_time', '{}'::jsonb, now(), '{}'::jsonb, s.id from public.upload_sessions s where s.idempotency_key = 'kt2'$$);
select test.allowed('kt2: validating → accepted', $$update public.upload_sessions set state = 'accepted' where idempotency_key = 'kt2'$$);
select test.fails_with('جلسة مقبولة لا تعود', $$update public.upload_sessions set state = 'rejected', reject_reason = 'empty' where idempotency_key = 'kt2'$$, '42501');
select test.fails_with('إصدار ثانٍ بعد قبول الجلسة ممنوع (الجلسة لم تعد validating)', $$insert into public.versions (teacher_id, term_id, slot_id, no, kind, original_name, size_bytes, ext, storage_provider, storage_bucket, storage_key, sha256, submitted_at, status_snapshot, deadlines_snapshot, validated_at, validation_result, upload_session_id)
  select s.teacher_id, s.term_id, s.slot_id, 2, 'file', 'plan.pdf', 1000, 'pdf', 'r2', 'b', 'k2', repeat('b', 64), s.effective_start_at, 'on_time', '{}'::jsonb, now(), '{}'::jsonb, s.id from public.upload_sessions s where s.idempotency_key = 'kt2'$$, '23514');

\echo === (6) سجل المحاولات: إضافة فقط ===
select test.allowed('إضافة محاولة', $$insert into public.upload_attempts (teacher_id, session_id, outcome) select teacher_id, id, 'validation_deferred' from public.upload_sessions where idempotency_key = 'kt2'$$);
select test.fails_with('لا تعديل حتى لـservice_role', $$update public.upload_attempts set reason = 'x'$$, '42501');
select test.fails_with('لا حذف حتى لـservice_role', $$delete from public.upload_attempts$$, '42501');
reset role;

\echo === (7) أدوار التطبيق على جداول الرفع ===
select set_config('app.uid', :'dir', false);
set role authenticated;
select test.blocked('المديرة: لا قراءة upload_sessions', 'select id from public.upload_sessions');
select test.count_is('المديرة: لا ترى upload_attempts (RLS)', 'select count(id) from public.upload_attempts', 0);
select test.blocked('المديرة: لا كتابة في upload_attempts', $$insert into public.upload_attempts (teacher_id, outcome) select id, 'started' from public.teachers$$);
select test.blocked('المديرة: storage_key من versions', 'select storage_key from public.versions');
select test.blocked('المديرة: upload_session_id غير مقروء (لم يُمنح)', 'select upload_session_id from public.versions');
reset role;
select set_config('app.uid', :'owner', false);
set role authenticated;
select test.count_is('المالكة ترى محاولات الرفع', 'select (count(id) > 0)::int from public.upload_attempts', 1);
select test.blocked('المالكة: لا قراءة upload_sessions (لم تُمنح بعد)', 'select id from public.upload_sessions');
select test.blocked('المالكة: لا كتابة في upload_attempts', $$insert into public.upload_attempts (teacher_id, outcome) select id, 'started' from public.teachers$$);
select test.blocked('المالكة: storage_key من versions', 'select storage_key from public.versions');
reset role;
\echo === انتهى 20_sessions_004 ===
