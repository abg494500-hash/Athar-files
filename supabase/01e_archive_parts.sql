-- أثَر — ملف 01e (مولَّد من database/009_archive_parts.sql؛ لا تعدّليه يدويًا).
-- يُنفَّذ **بعد 01d** ونجاح 03c، مرة واحدة (إعادة التشغيل آمنة). أجزاء الأرشيف السنوي + التحقق من النسخة الثانية + بوابة التصفير (قراءة فقط).
-- ============================================================================
-- 009 — أجزاء الأرشيف السنوي والتحقق من النسخة الثانية وبوابة التصفير (A-116، 2026-11-15، r35.1)
-- يُنفَّذ بعد 001..008، مرة واحدة (إعادة التشغيل آمنة). لا يحذف ولا يعدّل بيانات قائمة.
-- (أ) archive_entries.part_no: أي جزء يضم كل إصدار.
-- (ب) archive_parts: صف لكل جزء ZIP (اسمه وبصمته وحجمه) + طابع «نُزّل وتحقق من بصمته» + طابع «النسخة الثانية تحقق منها» ووسيطها.
--     إضافة فقط؛ الأطوابع تُكتب مرة واحدة؛ لا حذف. للخادم (service_role) وحده.
-- (ج) حارس على archives: لا يُختم download_hash_verified_at لأرشيف له أجزاء ما لم يتحقق **كل** جزء (جزء ناقص/تالف ⇒ رفض في القاعدة).
-- (د) year_archive_gate(archive): تقرير جاهزية للتصفير (قراءة فقط؛ لا ينفّذ تصفيرًا): كل الأجزاء متتابعة ومتحقَّق منها ومن نسختها الثانية،
--     كل إصدارات السنة مغطّاة، والإقرار بفتحه دون إنترنت. المرحلة 2 ستشترطها قبل أي حذف.
-- ============================================================================
begin;

alter table public.archive_entries add column if not exists part_no integer not null default 1;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'archive_entries_part_no_pos') then
    alter table public.archive_entries add constraint archive_entries_part_no_pos check (part_no >= 1);
  end if;
end $$;

create table if not exists public.archive_parts (
  archive_id         uuid not null references public.archives (id) on delete restrict,
  part_no            integer not null check (part_no >= 1),
  filename           text not null check (filename ~ '^[A-Za-z0-9._-]{1,140}$'),
  sha256             text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes         bigint not null check (size_bytes > 0),
  entries_count      integer not null check (entries_count >= 0),
  verified_at        timestamptz,
  copy_verified_at   timestamptz,
  copy_medium        text check (copy_medium in ('external_drive', 'usb_flash', 'cloud', 'other_computer')),
  created_at         timestamptz not null default now(),
  primary key (archive_id, part_no),
  constraint archive_parts_copy_pair check ((copy_verified_at is null) = (copy_medium is null))
);
alter table public.archive_parts enable row level security;
revoke all on public.archive_parts from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update on public.archive_parts to service_role;
  end if;
end $$;

drop trigger if exists archive_parts_no_delete on public.archive_parts;
create trigger archive_parts_no_delete before delete on public.archive_parts
  for each row execute function public.forbid_delete();

create or replace function public.archive_parts_guard_update()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if (new.archive_id, new.part_no, new.filename, new.sha256, new.size_bytes, new.entries_count, new.created_at)
     is distinct from (old.archive_id, old.part_no, old.filename, old.sha256, old.size_bytes, old.entries_count, old.created_at) then
    raise exception 'تعريف الجزء لا يتغير' using errcode = 'insufficient_privilege';
  end if;
  if (old.verified_at is not null and new.verified_at is distinct from old.verified_at)
     or (old.copy_verified_at is not null and (new.copy_verified_at is distinct from old.copy_verified_at or new.copy_medium is distinct from old.copy_medium)) then
    raise exception 'طوابع التحقق تُكتب مرة واحدة' using errcode = 'insufficient_privilege';
  end if;
  if new.copy_verified_at is not null and new.verified_at is null then
    raise exception 'لا تحقق من نسخة ثانية قبل تحقق الأصل' using errcode = 'check_violation';
  end if;
  return new;
end
$$;
revoke all on function public.archive_parts_guard_update() from public, anon, authenticated;
drop trigger if exists archive_parts_guard_update_bu on public.archive_parts;
create trigger archive_parts_guard_update_bu before update on public.archive_parts
  for each row execute function public.archive_parts_guard_update();

create or replace function public.archives_parts_verified_guard()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.download_hash_verified_at is not null and old.download_hash_verified_at is null
     and exists (select 1 from public.archive_parts p where p.archive_id = new.id and p.verified_at is null) then
    raise exception 'لا يُختم تحقق التنزيل قبل تحقق كل أجزاء الأرشيف' using errcode = 'check_violation';
  end if;
  return new;
end
$$;
revoke all on function public.archives_parts_verified_guard() from public, anon, authenticated;
drop trigger if exists archives_parts_verified_guard_bu on public.archives;
create trigger archives_parts_verified_guard_bu before update on public.archives
  for each row execute function public.archives_parts_verified_guard();

create or replace function public.year_archive_gate(p_archive uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  a record;
  v_problems text[] := '{}';
  n int; mx int; k int;
begin
  select * into a from public.archives
   where id = p_archive and term_id is null and teacher_id is null and storage_provider = 'local-download' and deleted_at is null;
  if not found then return jsonb_build_object('ready', false, 'problems', jsonb_build_array('archive_not_found')); end if;
  if a.state <> 'verified' then v_problems := array_append(v_problems, 'archive_not_verified'); end if;
  select count(*), coalesce(max(part_no), 0) into n, mx from public.archive_parts where archive_id = p_archive;
  if n = 0 then v_problems := array_append(v_problems, 'no_parts');
  elsif mx <> n then v_problems := array_append(v_problems, 'parts_not_contiguous'); end if;
  select count(*) into k from public.archive_parts where archive_id = p_archive and verified_at is null;
  if k > 0 then v_problems := array_append(v_problems, ('parts_not_download_verified:' || k)); end if;
  select count(*) into k from public.archive_parts where archive_id = p_archive and copy_verified_at is null;
  if k > 0 then v_problems := array_append(v_problems, ('parts_second_copy_not_verified:' || k)); end if;
  select count(*) into k from public.archive_entries where archive_id = p_archive;
  if k <> coalesce(a.entries_count, -1) then v_problems := array_append(v_problems, 'entries_count_mismatch'); end if;
  select count(*) into k from public.archive_parts p
   where p.archive_id = p_archive and p.entries_count <> (select count(*) from public.archive_entries e where e.archive_id = p.archive_id and e.part_no = p.part_no);
  if k > 0 then v_problems := array_append(v_problems, ('part_entries_mismatch:' || k)); end if;
  select count(*) into k from public.versions v join public.terms t on t.id = v.term_id
   where t.year_id = a.year_id and not exists (select 1 from public.archive_entries e where e.archive_id = p_archive and e.version_id = v.id);
  if k > 0 then v_problems := array_append(v_problems, ('versions_not_in_archive:' || k)); end if;
  if a.download_hash_verified_at is null then v_problems := array_append(v_problems, 'download_not_verified'); end if;
  if not exists (select 1 from jsonb_array_elements(a.checks) e where e->>'check' = 'opened_locally_ack') then v_problems := array_append(v_problems, 'not_opened_locally'); end if;
  return jsonb_build_object('ready', cardinality(v_problems) = 0, 'problems', to_jsonb(v_problems));
end
$$;
revoke all on function public.year_archive_gate(uuid) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.year_archive_gate(uuid) to service_role;
  end if;
end $$;

commit;
