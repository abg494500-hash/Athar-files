// يولّد ملفات SQL للصق في Supabase → SQL Editor (لا اتصال بأي خدمة ولا مفاتيح). الاستعمال: node scripts/build-supabase-sql.mjs
//  supabase/01_apply_all.sql      = database/001..004 بالترتيب (يُنفَّذ مرة واحدة على مشروع فارغ) — لم يتغيّر في المرحلة 2.
//  supabase/01b_staff_accounts.sql = database/005_staff_accounts.sql (حسابات المسؤولين بلا تحقق بخطوتين، A-98) — يُنفَّذ بعد 01، ويُعاد تشغيله إن لزم (يزيل شرط aal2 من نسخة قديمة إن نُفِّذت).
//  supabase/02_security_check.sql = اختبار الصلاحيات الفعلي (10_security_003 + 25_staff_accounts_005) يُلغى دائمًا ولا يترك أثرًا.
//  supabase/03_post_check.sql     = فحص قراءة فقط بعد 02 يثبت أن لا أثر باقٍ.
//  supabase/01c_server_additions.sql = database/006 + 007 (جلسات المعلمات، log_audit_as، حارس الأرشيف) — يُنفَّذ بعد 01 و01b و02 و03 (r21، يحتاج موافقة صريحة).
//  supabase/03b_post_check_additions.sql = فحص قراءة فقط (SELECT واحد) يثبت أن 01c طُبِّق بصلاحياته الصحيحة.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
const rd = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8')
const wr = (p, s) => writeFileSync(new URL('../' + p, import.meta.url), s)
mkdirSync(new URL('../supabase', import.meta.url), { recursive: true })
// استبدال صارم: يفشل التوليد إن لم يوجد النص المطلوب (لا استبدال صامت فاشل).
const rep = (s, from, to, label) => {
  const i = s.indexOf(from)
  if (i < 0) throw new Error(`التوليد فشل: لم يُعثر على «${label ?? from.slice(0, 60)}»`)
  return s.slice(0, i) + to + s.slice(i + from.length)
}

// ---------------- 01_apply_all.sql (بلا تغيير) ----------------
const parts = ['database/001_schema.sql', 'database/002_integrity.sql', 'database/003_rls.sql', 'database/004_upload_tables.sql']
let apply = `-- أثَر — ملف التطبيق الكامل (مولَّد من database/001..004؛ لا تعدّليه يدويًا: عدّلي المصدر وأعيدي التوليد).\n-- يُلصق في Supabase → SQL Editor ويُنفَّذ **مرة واحدة** على مشروع جديد فارغ ببيانات وهمية.\n`
for (const p of parts) apply += `\n-- ======================= ${p} =======================\n` + rd(p) + '\n'
wr('supabase/01_apply_all.sql', apply)

// ---------------- 01b_staff_accounts.sql ----------------
wr('supabase/01b_staff_accounts.sql',
  `-- أثَر — ملف 01b (مولَّد من database/005_staff_accounts.sql؛ لا تعدّليه يدويًا).\n-- يُنفَّذ **بعد 01_apply_all.sql** وقبل 02. معاملة واحدة تُلغى كلها عند أي خطأ، ويمكن إعادة تشغيله.\n-- مسودة غير مُشغَّلة قبل أول تنفيذ على Supabase.\n\n-- ======================= database/005_staff_accounts.sql =======================\n` + rd('database/005_staff_accounts.sql'))

// ---------------- 02_security_check.sql ----------------
const GUARD_MSG = 'ABORT: النص لم يُنفَّذ كمعاملة واحدة (المحرر قسّم الأوامر). لم يُجرَ شيء ضار؛ لا تكمل. أرسلي هذه الرسالة لي.'
const guardIf = `if current_setting('athar.single_tx', true) is distinct from 'on' then raise exception '${GUARD_MSG}'; end if;`
const boot = rd('tests/sql/00_bootstrap.sql')
let helpers = boot.slice(boot.indexOf('create schema test;') + 'create schema test;'.length)
helpers = helpers.replace(/raise notice '([^']*)'(?:,\s*([^;]*))?;/g, (_, fmt, args) => {
  const a = (args ?? '').split(',').map((s) => s.trim()).filter(Boolean).map((s) => `${s}::text`)
  return `perform test.note('${fmt}'${a.length ? ', ' + a.join(', ') : ''});`
})
helpers = helpers.replace(/^grant execute on all functions in schema test.*$/m, '')

const lit = { owner: '00000000-0000-0000-0000-0000000000a1', dir: '00000000-0000-0000-0000-0000000000b2', nobody: '00000000-0000-0000-0000-0000000000c3' }
let t = rd('tests/sql/10_security_003.sql')
t = t.split('\n').filter((l) => !/^\\(set|echo)/.test(l)).join('\n')
t = t.replace(/:'(owner|dir|nobody)'/g, (_, k) => `'${lit[k]}'`)
// الهوية كاملة في claims واحدة (sub وrole فقط؛ لا مستوى ضمان aal: التحقق بخطوتين أُلغي في A-98).
t = t.replace(/set_config\('app\.uid',\s*('[^']+'),\s*false\)/g, `set_config('request.jwt.claims', json_build_object('sub', $1, 'role', 'authenticated')::text, false)`)
// البذرة: المسؤولون عبر bootstrap_staff (يختبرها) لأن الإدراج المباشر صار مرفوضًا بمشغّل 005.
t = rep(t, `insert into auth.users (id) values ('${lit.owner}'), ('${lit.dir}'), ('${lit.nobody}');`,
  `insert into auth.users (id, email) values ('${lit.owner}', 'owner-test@example.invalid'), ('${lit.dir}', 'director-test@example.invalid'), ('${lit.nobody}', 'nobody-test@example.invalid');`, 'بذرة auth.users')
t = rep(t, `insert into public.staff_profiles (user_id, role) values ('${lit.owner}', 'owner'), ('${lit.dir}', 'director');`,
  `select public.bootstrap_staff('owner-test@example.invalid', 'owner');\nselect public.bootstrap_staff('director-test@example.invalid', 'director');`, 'بذرة staff_profiles')
// 004: المشغّل/القيد يُعطَّلان داخل DO واحدة مع حارس المعاملة الواحدة، فلا يقع التعطيل أبدًا خارج معاملة تُلغى.
t = rep(t, /(insert into public\.versions[\s\S]*?from public\.submissions;)/.exec(t)[1],
  `do $x$ begin\n  ${guardIf}\n  alter table public.versions disable trigger versions_match_session_bi;\n  alter table public.versions drop constraint if exists versions_file_verified;\nend $x$;\n` + /(insert into public\.versions[\s\S]*?from public\.submissions;)/.exec(t)[1], 'إدراج versions')
t = rep(t, "c.column_name not in ('storage_provider','storage_bucket','storage_key')", "c.column_name not in ('storage_provider','storage_bucket','storage_key','upload_session_id')", 'استثناء upload_session_id')

// اختبارات 005
const t25 = rd('tests/sql/25_staff_accounts_005.sql')
const block = (name) => { const m = new RegExp(`-- BEGIN-${name}\\n([\\s\\S]*?)-- END-${name}\\n`).exec(t25); if (!m) throw new Error('قسم مفقود: ' + name); return m[1] }
const preseed = block('PRESEED')
const tests25 = block('TESTS')
t = rep(t, 'grant all on all tables in schema public to service_role;', preseed + 'grant all on all tables in schema public to service_role;', 'موضع PRESEED')

const asUser = `create function test.as_user(uid text) returns void language sql as $$\n  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, false)\n$$;\n`
const check = `-- أثَر — اختبار الصلاحيات الفعلي على Supabase (مولَّد من tests/sql/10_security_003.sql و25_staff_accounts_005.sql؛ لا تعدّليه يدويًا).
-- يُشغَّل بعد 01_apply_all.sql ثم 01b_staff_accounts.sql. لا يحوي begin ولا commit عمدًا: النص كله معاملة ضمنية واحدة
-- (استعلام متعدد الأوامر)، وينتهي بخطأ مقصود فيتراجع كل شيء تلقائيًا ولا تبقى معاملة معلّقة على الاتصال.
-- الحارس الأول يمنع التنفيذ إن قسّم المحرر الأوامر؛ والتعطيلان الوحيدان لحماية حقيقية (مشغّل versions_match_session_bi وقيد
-- versions_file_verified) داخل كتلة DO تعيد فحص الحارس. بعد التشغيل شغّلي 03_post_check.sql للتأكد أن لا أثر باقٍ.
-- النتيجة تظهر كرسالة خطأ بعنوان RESULT: انسخيها كما هي وأرسليها (لا تحوي أسرارًا).
select set_config('athar.single_tx', 'on', true);
do $g$ begin
  ${guardIf}
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
${helpers}
${asUser}
grant execute on all functions in schema test to anon, authenticated, service_role;
${t}
${tests25}
reset role;
do $r$
declare v_pass int; v_fail int; v_msg text;
begin
  select count(*) filter (where msg like 'PASS%'), count(*) filter (where msg like 'FAIL%') into v_pass, v_fail from test.results;
  select string_agg(msg, E'\\n') into v_msg from test.results where msg like 'FAIL%';
  raise exception E'RESULT: PASS=% FAIL=%\\n%\\n(إلغاء مقصود لكل ما سبق: لا أثر باقٍ — شغّلي 03_post_check.sql للتحقق)', v_pass, v_fail, coalesce(v_msg, 'لا إخفاقات');
end $r$;
`
wr('supabase/02_security_check.sql', check)

// ---------------- 03_post_check.sql (قراءة فقط) ----------------
const U = `'00000000-0000-0000-0000-0000000000%'`
wr('supabase/03_post_check.sql', `-- أثَر — فحص ما بعد 02 (قراءة فقط: SELECT واحد لا يغيّر شيئًا). يُشغَّل بعد 02 مباشرة.
-- المتوقع: كل الصفوف PASS. أي FAIL يعني أن الاختبار لم يتراجع كاملًا — أرسليها لي ولا تكمل.
select check_name, status from (
  select 1 as n, 'لا مخطط test باقٍ' as check_name,
         case when not exists (select 1 from pg_namespace where nspname = 'test') then 'PASS' else 'FAIL' end as status
  union all select 2, 'مشغّل versions_match_session_bi مفعّل',
         case when exists (select 1 from pg_trigger where tgrelid = 'public.versions'::regclass and tgname = 'versions_match_session_bi' and tgenabled = 'O') then 'PASS' else 'FAIL' end
  union all select 3, 'قيد versions_file_verified موجود',
         case when exists (select 1 from pg_constraint where conrelid = 'public.versions'::regclass and conname = 'versions_file_verified') then 'PASS' else 'FAIL' end
  union all select 4, 'لا مستخدمون وهميون في auth.users',
         case when not exists (select 1 from auth.users where id::text like ${U}) then 'PASS' else 'FAIL' end
  union all select 5, 'لا مسؤولون وهميون في staff_profiles',
         case when not exists (select 1 from public.staff_profiles where user_id::text like ${U}) then 'PASS' else 'FAIL' end
  union all select 6, 'لا سجلات تدقيق من الاختبار',
         case when not exists (select 1 from public.audit_log where action = 'test.seed' or target_id like ${U}) then 'PASS' else 'FAIL' end
  union all select 7, 'لا معلمة اختبار باقية',
         case when not exists (select 1 from public.teachers where name = 'معلمة اختبار') then 'PASS' else 'FAIL' end
  union all select 8, 'authenticated و anon و service_role لا ينفّذون bootstrap_staff',
         case when not has_function_privilege('authenticated', 'public.bootstrap_staff(text,text)', 'execute')
               and not has_function_privilege('anon', 'public.bootstrap_staff(text,text)', 'execute')
               and not has_function_privilege('service_role', 'public.bootstrap_staff(text,text)', 'execute') then 'PASS' else 'FAIL' end
) c order by n;
`)
// ---------------- 01c_server_additions.sql (r21) ----------------
wr('supabase/01c_server_additions.sql',
  `-- أثَر — ملف 01c (مولَّد من database/006_teacher_sessions.sql و007_server_additions.sql؛ لا تعدّليه يدويًا).\n-- يُنفَّذ **بعد** 01 و01b و02 و03 (أي بعد نجاح فحوصات الأمان الأصلية)، **مرة واحدة** ويمكن إعادة تشغيله (if not exists / create or replace).\n-- معاملة واحدة تُلغى كلها عند أي خطأ. غير مُشغَّل على أي قاعدة قبل تنفيذكِ له؛ لا أسرار فيه.\n\nbegin;\n\n-- ======================= database/006_teacher_sessions.sql =======================\n` + rd('database/006_teacher_sessions.sql') + `\n-- ======================= database/007_server_additions.sql =======================\n` + rd('database/007_server_additions.sql') + '\ncommit;\n')

// ---------------- 03b_post_check_additions.sql (قراءة فقط) ----------------
const PUB_NO_EXEC = (fn) => `not exists (select 1 from pg_proc p where p.oid = '${fn}'::regprocedure and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)))`
wr('supabase/03b_post_check_additions.sql', `-- أثَر — فحص ما بعد 01c (قراءة فقط: SELECT واحد لا يغيّر شيئًا). المتوقع: كل الصفوف PASS. أي FAIL ⇒ أرسليه لي ولا تكمل.
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
         case when ${PUB_NO_EXEC('public.log_audit_as(uuid,text,text,text,jsonb)')} and not has_function_privilege('anon', 'public.log_audit_as(uuid,text,text,text,jsonb)', 'execute') and not has_function_privilege('authenticated', 'public.log_audit_as(uuid,text,text,text,jsonb)', 'execute') then 'PASS' else 'FAIL' end
  union all select 8, 'log_audit_as: service_role ينفّذ', case when has_function_privilege('service_role', 'public.log_audit_as(uuid,text,text,text,jsonb)', 'execute') then 'PASS' else 'FAIL' end
  union all select 9, 'مشغّل حارس الأرشيف مفعّل', case when exists (select 1 from pg_trigger where tgrelid = 'public.archives'::regclass and tgname = 'archives_guard_update_bu' and tgenabled = 'O') then 'PASS' else 'FAIL' end
  union all select 10, 'دالة حارس الأرشيف بلا تنفيذ لـPUBLIC/anon/authenticated',
         case when ${PUB_NO_EXEC('public.archives_guard_update()')} and not has_function_privilege('anon', 'public.archives_guard_update()', 'execute') and not has_function_privilege('authenticated', 'public.archives_guard_update()', 'execute') then 'PASS' else 'FAIL' end
  union all select 11, 'فهرس versions_teacher_term موجود', case when exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'versions_teacher_term') then 'PASS' else 'FAIL' end
  union all select 12, 'لا جلسات معلمات باقية من أي اختبار', case when not exists (select 1 from public.teacher_sessions) then 'PASS' else 'FAIL' end
) c order by n;
`)
// ---------------- 01d_teacher_removal.sql + 03c_post_check_removal.sql (r34، A-114) ----------------
wr('supabase/01d_teacher_removal.sql',
  `-- أثَر — ملف 01d (مولَّد من database/008_teacher_removal.sql؛ لا تعدّليه يدويًا).\n-- يُنفَّذ **بعد 01c** ونجاح 03b، مرة واحدة (إعادة التشغيل آمنة). يضيف حذف المعلمة بعد الأرشفة (محو الاسم) للمالكة وحدها.\n` + rd('database/008_teacher_removal.sql'))
wr('supabase/03c_post_check_removal.sql', `-- أثَر — فحص ما بعد 01d (قراءة فقط: SELECT واحد). المتوقع: كل الصفوف PASS. أي FAIL ⇒ أرسليه لي ولا تكمل.
select check_name, status from (
  select 1 as n, 'عمود teachers.removed_at موجود' as check_name, case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'teachers' and column_name = 'removed_at') then 'PASS' else 'FAIL' end as status
  union all select 2, 'الدالة remove_teacher موجودة', case when to_regprocedure('public.remove_teacher(uuid,uuid)') is not null then 'PASS' else 'FAIL' end
  union all select 3, 'remove_teacher: service_role فقط يملك التنفيذ', case when to_regprocedure('public.remove_teacher(uuid,uuid)') is not null
       and has_function_privilege('service_role', 'public.remove_teacher(uuid,uuid)', 'execute')
       and not has_function_privilege('anon', 'public.remove_teacher(uuid,uuid)', 'execute')
       and not has_function_privilege('authenticated', 'public.remove_teacher(uuid,uuid)', 'execute') then 'PASS' else 'FAIL' end
) c order by n;
`)
// ---------------- 01e_archive_parts.sql + 03d_post_check_parts.sql (r35.1، A-116) ----------------
wr('supabase/01e_archive_parts.sql',
  `-- أثَر — ملف 01e (مولَّد من database/009_archive_parts.sql؛ لا تعدّليه يدويًا).\n-- يُنفَّذ **بعد 01d** ونجاح 03c، مرة واحدة (إعادة التشغيل آمنة). أجزاء الأرشيف السنوي + التحقق من النسخة الثانية + بوابة التصفير (قراءة فقط).\n` + rd('database/009_archive_parts.sql'))
wr('supabase/03d_post_check_parts.sql', `-- أثَر — فحص ما بعد 01e (قراءة فقط: SELECT واحد). المتوقع: كل الصفوف PASS. أي FAIL ⇒ أرسليه لي ولا تكمل.
select check_name, status from (
  select 1 as n, 'عمود archive_entries.part_no موجود' as check_name, case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'archive_entries' and column_name = 'part_no') then 'PASS' else 'FAIL' end as status
  union all select 2, 'جدول archive_parts موجود وRLS مفعّل', case when exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'archive_parts' and c.relrowsecurity) then 'PASS' else 'FAIL' end
  union all select 3, 'archive_parts: لا وصول لـanon وauthenticated', case when to_regclass('public.archive_parts') is not null
       and not has_table_privilege('anon', 'public.archive_parts', 'select') and not has_table_privilege('authenticated', 'public.archive_parts', 'select') then 'PASS' else 'FAIL' end
  union all select 4, 'archive_parts: مشغّلات منع الحذف وحارس التحديث موجودة', case when (select count(*) from pg_trigger where tgrelid = to_regclass('public.archive_parts') and tgname in ('archive_parts_no_delete', 'archive_parts_guard_update_bu')) = 2 then 'PASS' else 'FAIL' end
  union all select 5, 'حارس archives: لا ختم تنزيل قبل تحقق كل الأجزاء', case when exists (select 1 from pg_trigger where tgrelid = 'public.archives'::regclass and tgname = 'archives_parts_verified_guard_bu') then 'PASS' else 'FAIL' end
  union all select 6, 'year_archive_gate: service_role فقط يملك التنفيذ', case when to_regprocedure('public.year_archive_gate(uuid)') is not null
       and has_function_privilege('service_role', 'public.year_archive_gate(uuid)', 'execute')
       and not has_function_privilege('anon', 'public.year_archive_gate(uuid)', 'execute')
       and not has_function_privilege('authenticated', 'public.year_archive_gate(uuid)', 'execute') then 'PASS' else 'FAIL' end
) c order by n;
`)

// ---------------- 01f_year_reset.sql + 03e_post_check_reset.sql (r36، A-118) ----------------
wr('supabase/01f_year_reset.sql',
  `-- أثَر — ملف 01f (مولَّد من database/010_year_reset.sql؛ لا تعدّليه يدويًا).\n-- يُنفَّذ **بعد 01e** ونجاح 03d، مرة واحدة (إعادة التشغيل آمنة). ينشئ جداول ودوال التصفير السنوي ومشغّل تجميد السنة. **لا يحذف شيئًا عند تنفيذه.**\n` + rd('database/010_year_reset.sql'))
wr('supabase/03e_post_check_reset.sql', `-- أثَر — فحص ما بعد 01f (قراءة فقط: SELECT واحد). المتوقع: كل الصفوف PASS. أي FAIL ⇒ أرسليه لي ولا تكمل.
select check_name, status from (
  select 1 as n, 'جداول year_resets وyear_reset_keys وyear_closures موجودة وRLS مفعّل' as check_name, case when (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in ('year_resets', 'year_reset_keys', 'year_closures') and c.relrowsecurity) = 3 then 'PASS' else 'FAIL' end as status
  union all select 2, 'لا وصول لـanon وauthenticated إلى جداول التصفير', case when to_regclass('public.year_resets') is not null
       and not has_table_privilege('anon', 'public.year_resets', 'select') and not has_table_privilege('authenticated', 'public.year_resets', 'select')
       and not has_table_privilege('authenticated', 'public.year_closures', 'select') and not has_table_privilege('authenticated', 'public.year_reset_keys', 'select') then 'PASS' else 'FAIL' end
  union all select 3, 'دوال التصفير: service_role فقط يملك التنفيذ', case when to_regprocedure('public.year_reset_purge(uuid)') is not null
       and has_function_privilege('service_role', 'public.year_reset_purge(uuid)', 'execute') and has_function_privilege('service_role', 'public.year_reset_begin(uuid,uuid)', 'execute')
       and not has_function_privilege('anon', 'public.year_reset_purge(uuid)', 'execute') and not has_function_privilege('authenticated', 'public.year_reset_purge(uuid)', 'execute')
       and not has_function_privilege('authenticated', 'public.year_reset_begin(uuid,uuid)', 'execute') then 'PASS' else 'FAIL' end
  union all select 4, 'مشغّلات تجميد السنة موجودة على التسليمات والإصدارات والجلسات والأرشيفات', case when (select count(*) from pg_trigger where tgname in ('submissions_year_freeze_bi', 'versions_year_freeze_bi', 'upload_sessions_year_freeze_bi', 'archives_year_freeze_bi')) = 4 then 'PASS' else 'FAIL' end
  union all select 5, 'مشغّلات منع الحذف ما زالت مفعّلة (لم يبقَ شيء موقوفًا)', case when (select count(*) from pg_trigger where tgname in ('versions_no_delete', 'submissions_no_delete', 'archives_no_delete', 'archive_entries_no_delete', 'archive_parts_no_delete', 'upload_sessions_no_delete', 'upload_sessions_guard_update_bu', 'upload_attempts_no_mutation') and tgenabled = 'O') = 8 then 'PASS' else 'FAIL' end
  union all select 6, 'مشغّلات audit_log مفعّلة', case when (select count(*) from pg_trigger where tgrelid = 'public.audit_log'::regclass and tgname in ('audit_log_chain_bi', 'audit_log_no_update_delete', 'audit_log_no_truncate') and tgenabled = 'O') = 3 then 'PASS' else 'FAIL' end
) c order by n;
`)
// ---------------- 01g_years_teachers_import.sql + 03f_post_check_years.sql (r36، A-119) ----------------
wr('supabase/01g_years_teachers_import.sql',
  `-- أثَر — ملف 01g (مولَّد من database/011_years_teachers_import.sql؛ لا تعدّليه يدويًا).\n-- يُنفَّذ **بعد 01f** ونجاح 03e، مرة واحدة (إعادة التشغيل آمنة). عمودان اختياريان في years + دوال إدارة السنوات واستيراد المعلمات. **لا يحذف ولا يعدّل بيانات قائمة.**\n` + rd('database/011_years_teachers_import.sql'))
wr('supabase/03f_post_check_years.sql', `-- أثَر — فحص ما بعد 01g (قراءة فقط: SELECT واحد). المتوقع: كل الصفوف PASS. أي FAIL ⇒ أرسليه لي ولا تكمل.
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
`)
// ---------------- 01h_teacher_delete.sql + 03g_post_check_delete.sql (r40، A-126) ----------------
wr('supabase/01h_teacher_delete.sql',
  `-- أثَر — ملف 01h (مولَّد من database/012_teacher_delete.sql + 013_reset_for_staff.sql + 014_reset_light_gate.sql؛ لا تعدّليه يدويًا).\n-- يُنفَّذ **بعد 01g** ونجاح 03f، **وقبل نشر دالة api الجديدة**. دالتا حذف المعلمة لملفها + بدء التصفير للمالكة والمديرة. إعادة التشغيل آمنة. **لا يحذف ولا يعدّل بيانات قائمة عند تنفيذه.**\n` + rd('database/012_teacher_delete.sql') + '\n' + rd('database/013_reset_for_staff.sql') + '\n' + rd('database/014_reset_light_gate.sql'))
wr('supabase/03g_post_check_delete.sql', `-- أثَر — فحص ما بعد 01h (قراءة فقط: SELECT واحد). المتوقع: كل الصفوف PASS. أي FAIL ⇒ أرسليه لي ولا تكمل.
select check_name, status from (
  select 1 as n, 'دالتا الحذف موجودتان لـservice_role فقط' as check_name, case when to_regprocedure('public.teacher_delete_check(uuid,uuid)') is not null and to_regprocedure('public.teacher_delete_version(uuid,uuid)') is not null
       and has_function_privilege('service_role', 'public.teacher_delete_version(uuid,uuid)', 'execute')
       and not has_function_privilege('anon', 'public.teacher_delete_version(uuid,uuid)', 'execute') and not has_function_privilege('authenticated', 'public.teacher_delete_version(uuid,uuid)', 'execute')
       and not has_function_privilege('authenticated', 'public.teacher_delete_check(uuid,uuid)', 'execute') then 'PASS' else 'FAIL' end as status
  union all select 2, 'التصفير يقبل المديرة (year_reset_begin يستعمل staff_actor_check)', case when (select prosrc from pg_proc where oid = 'public.year_reset_begin(uuid,uuid)'::regprocedure) like '%staff_actor_check%' then 'PASS' else 'FAIL' end
  union all select 3, 'كل مشغّلات منع الحذف مفعّلة (لم يُترك أي مشغّل معطّلًا)', case when (select count(*) from pg_trigger where tgname in ('versions_no_delete','submissions_no_delete','upload_sessions_no_delete','upload_sessions_guard_update_bu','upload_attempts_no_mutation') and tgenabled = 'O') = 5 then 'PASS' else 'FAIL' end
  union all select 4, 'بوابة التصفير مخفَّفة (لا تشترط نسخة ثانية ولا إقرارًا)', case when (select prosrc from pg_proc where oid = 'public.year_reset_gate(uuid)'::regprocedure) not like '%year_archive_gate%' then 'PASS' else 'FAIL' end
) c order by n;
`)
// ---------------- 01i_reset_teachers.sql + 03h_post_check_reset_teachers.sql (r41) ----------------
wr('supabase/01i_reset_teachers.sql',
  `-- أثَر — ملف 01i (مولَّد من database/015_reset_teachers.sql؛ لا تعدّليه يدويًا).\n-- يُنفَّذ **بعد 01h** ونجاح 03g، **وقبل نشر دالة api الجديدة**. التصفير السنوي يحذف حسابات المعلمات اللاتي لا أثر لهن في سنة أخرى. معاملة واحدة؛ دوال فقط ولا يعدّل بيانات عند تنفيذه.\n` + rd('database/015_reset_teachers.sql'))
wr('supabase/03h_post_check_reset_teachers.sql', `-- أثَر — فحص ما بعد 01i (قراءة فقط: SELECT واحد). المتوقع: كل الصفوف PASS. أي FAIL ⇒ أرسليه لي ولا تكمل.
select check_name, status from (
  select 1 as n, 'التصفير يحذف المعلمات بلا أثر في سنة أخرى (purge يعطّل teachers_no_delete مؤقتًا)' as check_name, case when (select prosrc from pg_proc where oid = 'public.year_reset_purge(uuid)'::regprocedure) like '%teachers_no_delete%' then 'PASS' else 'FAIL' end as status
  union all select 2, 'التقرير يعدّ المعلمات المحذوفة', case when (select prosrc from pg_proc where oid = 'public.year_reset_report(uuid)'::regprocedure) like '%c_gone%' then 'PASS' else 'FAIL' end
  union all select 3, 'مشغّل منع حذف المعلمات مفعّل (لم يُترك معطّلًا)', case when (select count(*) from pg_trigger where tgname = 'teachers_no_delete' and tgenabled = 'O') = 1 then 'PASS' else 'FAIL' end
) c order by n;
`)
console.log('تم: supabase/01_apply_all.sql و01b_staff_accounts.sql و01c_server_additions.sql و02_security_check.sql و03_post_check.sql و03b_post_check_additions.sql و01d_teacher_removal.sql و03c_post_check_removal.sql و01e_archive_parts.sql و03d_post_check_parts.sql و01f_year_reset.sql و03e_post_check_reset.sql و01g_years_teachers_import.sql و03f_post_check_years.sql و01h_teacher_delete.sql و03g_post_check_delete.sql')
