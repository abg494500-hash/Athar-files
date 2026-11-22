-- تهيئة قاعدة اختبار محلية معزولة تحاكي ما تعتمد عليه ملفات SQL من Supabase (auth.users وauth.uid() والأدوار).
-- تُشغَّل بمستخدم superuser على قاعدة اختبار جديدة فقط (يتحقق المشغّل من اسم القاعدة). لا اتصال بأي خدمة.
\set ON_ERROR_STOP on
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema auth;
create table auth.users (id uuid primary key, email text);
-- محاكاة auth.uid(): تقرأ app.uid (في Supabase تقرأ من JWT).
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
grant usage on schema auth, public to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- مساعدات اختبار: تطبع PASS/FAIL كإشعارات (يجمعها المشغّل). تعمل بصلاحيات الدور الحالي (security invoker).
create schema test;
grant usage on schema test to anon, authenticated, service_role;
-- يجب أن يُمنع الوصول بخطأ صلاحية فقط (42501: منح/RLS/مشغّل). أي خطأ آخر (مثل خطأ كتابة في العمود) يُعدّ FAIL حتى لا يُحسب نجاحًا زائفًا.
create function test.blocked(label text, stmt text) returns void language plpgsql as $$
begin
  execute stmt;
  raise notice 'FAIL  % — لم يُمنع', label;
exception
  when insufficient_privilege then raise notice 'PASS  %', label;
  when others then raise notice 'FAIL  % — خطأ مختلف: % %', label, sqlstate, sqlerrm;
end $$;
-- العمود غير موجود أصلًا (للمنظور الذي أُزيلت منه أعمدة التخزين): 42703 فقط.
create function test.no_column(label text, stmt text) returns void language plpgsql as $$
begin
  execute stmt;
  raise notice 'FAIL  % — العمود متاح', label;
exception
  when undefined_column then raise notice 'PASS  %', label;
  when others then raise notice 'FAIL  % — خطأ مختلف: % %', label, sqlstate, sqlerrm;
end $$;
-- يجب أن يُرفض بخطأ محدد (sqlstate).
create function test.fails_with(label text, stmt text, expected text) returns void language plpgsql as $$
begin
  execute stmt;
  raise notice 'FAIL  % — لم يُرفض', label;
exception when others then
  if sqlstate = expected then raise notice 'PASS  %', label;
  else raise notice 'FAIL  % — المتوقع % والحاصل % %', label, expected, sqlstate, sqlerrm; end if;
end $$;
-- يجب أن ينجح.
create function test.allowed(label text, stmt text) returns void language plpgsql as $$
begin
  execute stmt;
  raise notice 'PASS  %', label;
exception when others then raise notice 'FAIL  % — %: %', label, sqlstate, sqlerrm;
end $$;
-- استعلام يُرجع عددًا واحدًا (bigint) ويجب أن يساوي المتوقع.
create function test.count_is(label text, q text, expected bigint) returns void language plpgsql as $$
declare n bigint;
begin
  execute q into n;
  if n = expected then raise notice 'PASS  %', label;
  else raise notice 'FAIL  % — المتوقع % والحاصل %', label, expected, n; end if;
exception when others then raise notice 'FAIL  % — %: %', label, sqlstate, sqlerrm;
end $$;
grant execute on all functions in schema test to anon, authenticated, service_role;
