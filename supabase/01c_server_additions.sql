-- أثَر — ملف 01c (مولَّد من database/006_teacher_sessions.sql و007_server_additions.sql؛ لا تعدّليه يدويًا).
-- يُنفَّذ **بعد** 01 و01b و02 و03 (أي بعد نجاح فحوصات الأمان الأصلية)، **مرة واحدة** ويمكن إعادة تشغيله (if not exists / create or replace).
-- معاملة واحدة تُلغى كلها عند أي خطأ. غير مُشغَّل على أي قاعدة قبل تنفيذكِ له؛ لا أسرار فيه.

begin;

-- ======================= database/006_teacher_sessions.sql =======================
-- ============================================================================
-- أثَر — الملف 6/7: جلسات المعلمات وفهرس بصمة الكود (دخول المعلمة بالكود والرقم السري).
-- ----------------------------------------------------------------------------
-- **الحالة: غير منفَّذ على أي PostgreSQL ولا على Supabase** (لا PostgreSQL في بيئة كتابته). مصدره المسودة docs/phase5/drafts/006_teacher_sessions.DRAFT.sql
-- (باقية كما هي) بعد مطابقته مع server/auth/pgAuthStore.ts عمودًا عمودًا. **يحتاج موافقتكِ قبل تنفيذه على Supabase.**
-- الاعتماد: يُنفَّذ بعد 001 (teachers وteacher_credentials). لا يعتمد على 002..005. إعادة تشغيله آمنة (if not exists).
-- الأثر: جدول جديد وفهرس فريد جديد. لا يُعدِّل أي جدول أو قيد قائم. **RLS مفعّلة بلا أي policy ⇒ لا وصول لـanon/authenticated إطلاقًا**؛
--   الكتابة والقراءة من خدمة الخادم وحدها (service_role يتجاوز RLS).
-- لا أسرار ولا بيانات حقيقية. تُخزَّن بصمة الرمز (SHA-256) فقط؛ الرمز نفسه لا يُخزَّن.
-- ============================================================================

-- (1) فهرس فريد على بصمة الكود: البحث عن المعلمة بالكود يعتمد عليه، وتصادم كودين يُكتشف به (يُعاد الإصدار).
create unique index if not exists teacher_credentials_code_hash_uq
  on public.teacher_credentials (code_hash) where code_hash is not null;

-- (2) جلسات المعلمات.
create table if not exists public.teacher_sessions (
  id           uuid primary key default gen_random_uuid(),
  teacher_id   uuid not null references public.teachers (id) on delete restrict,
  token_hash   text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  last_seen_at timestamptz not null default now(),
  revoked_at   timestamptz,
  constraint teacher_sessions_expiry_after_create check (expires_at > created_at)
);
create index if not exists teacher_sessions_live_by_teacher
  on public.teacher_sessions (teacher_id) where revoked_at is null;

-- (3) لا وصول إلا لخدمة الخادم: RLS مفعّلة بلا policies + سحب كل صلاحيات الأدوار العامة (الجداول الجديدة في public تُمنح افتراضيًا في Supabase).
alter table public.teacher_sessions enable row level security;
revoke all on public.teacher_sessions from public, anon, authenticated;

-- لا حذف تلقائي للجلسات المنتهية هنا (قرار الاحتفاظ معلّق، مثل login_attempts).
-- التحقق بعد التنفيذ: انظر supabase/03b_post_check_additions.sql.

-- ======================= database/007_server_additions.sql =======================
-- ============================================================================
-- أثَر — الملف 7/7: إضافات الخادم — أثر دائم لإجراءات المسؤولات، وحراسة سجلات الأرشفة، وفهرس قراءة المعلمة.
-- ----------------------------------------------------------------------------
-- **الحالة: غير منفَّذ على أي PostgreSQL ولا على Supabase.** يُنفَّذ بعد 001..005 (يعتمد على: audit_log وسلسلته في 002، staff_profiles في 001،
-- archives في 001). لا يعتمد على 006. إعادة تشغيله آمنة (create or replace + drop trigger if exists + if not exists). **يحتاج موافقتكِ قبل Supabase.**
-- لا يعدّل جدولًا ولا عمودًا ولا قيدًا قائمًا؛ يضيف دالتين ومشغّلًا وفهرسًا فقط. لا أسرار.
--
-- (أ) public.log_audit_as: log_audit الموجودة (002) تقرأ auth.uid() الذي يكون null عند الاتصال بمفتاح الخدمة، فتنسب الحدث إلى 'system'.
--     الخادم يحتاج أن يُسجّل «من» نفّذ الإفراج/التنزيل/الأرشفة. الدالة الجديدة تتحقق أن المنفِّذة موظفة **نشطة** في staff_profiles وتأخذ دورها منه
--     (لا يُقبل دور من المستدعي)، وتكتب في audit_log المسلسَل بالهاش (المشغّل audit_log_chain يضع id وat وprev_hash وentry_hash).
--     التنفيذ لـservice_role وحده (يُسحب من public وanon وauthenticated).
-- (ب) archives_guard_update: لا يوجد حارس تحديث على archives في 002 (الحذف ممنوع فقط). الخدمة تكتب بمفتاح الخدمة، فتُحمى هنا في القاعدة:
--     تعريف الأرشيف لا يتغير؛ الحالة تتقدم فقط (creating → awaiting_verification → verified، أو → failed) وfailed نهائية؛ بصمة المحتوى وحجمه ومفتاحه
--     تُكتب مرة واحدة؛ طابعا التنزيل/التحقق والإقرار يُكتبان مرة واحدة ولا يُكتب طابع التحقق إلا لأرشيف verified.
-- (ج) فهرس versions(teacher_id, term_id): استعلام بوابة المعلمة يقرأ إصداراتها لفصول السنة النشطة.
-- ============================================================================

-- (أ) -------------------------------------------------------------------------
create or replace function public.log_audit_as(
  p_actor uuid, p_action text, p_target_type text, p_target_id text, p_detail jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_role text;
begin
  if p_action is null or length(btrim(p_action)) = 0 or length(p_action) > 100 then
    raise exception 'إجراء التدقيق غير صالح' using errcode = 'check_violation';
  end if;
  select sp.role into v_role from public.staff_profiles sp where sp.user_id = p_actor and sp.is_active;
  if v_role is null then
    raise exception 'المنفِّذة ليست موظفة نشطة' using errcode = 'insufficient_privilege';
  end if;
  insert into public.audit_log (actor_role, actor_id, action, target_type, target_id, detail)
  values (v_role, p_actor::text, p_action, p_target_type, p_target_id, p_detail);
end
$$;
revoke all on function public.log_audit_as(uuid, text, text, text, jsonb) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.log_audit_as(uuid, text, text, text, jsonb) to service_role;
  end if;
end $$;

-- (ب) -------------------------------------------------------------------------
create or replace function public.archives_guard_update()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if (new.id, new.title, new.year_id, new.term_id, new.teacher_id, new.created_by, new.created_at)
     is distinct from (old.id, old.title, old.year_id, old.term_id, old.teacher_id, old.created_by, old.created_at) then
    raise exception 'تعريف الأرشيف لا يتغير' using errcode = 'insufficient_privilege';
  end if;
  if old.state = 'failed' then
    raise exception 'أرشيف فاشل نهائي ولا يُعدَّل' using errcode = 'insufficient_privilege';
  end if;
  if new.state is distinct from old.state and not (
       (old.state = 'creating' and new.state in ('awaiting_verification', 'failed'))
    or (old.state = 'awaiting_verification' and new.state in ('verified', 'failed'))) then
    raise exception 'انتقال حالة أرشيف غير مسموح: % → %', old.state, new.state using errcode = 'insufficient_privilege';
  end if;
  -- بصمة المحتوى ومفتاحه وحجمه تُكتب مرة واحدة.
  if (old.sha256 is not null and new.sha256 is distinct from old.sha256)
     or (old.size_bytes is not null and new.size_bytes is distinct from old.size_bytes)
     or (old.entries_count is not null and new.entries_count is distinct from old.entries_count)
     or (old.storage_provider is not null and new.storage_provider is distinct from old.storage_provider)
     or (old.storage_key is not null and new.storage_key is distinct from old.storage_key)
     or (old.manifest_sha256 is not null and new.manifest_sha256 is distinct from old.manifest_sha256) then
    raise exception 'بصمة الأرشيف وحجمه ومفتاحه تُكتب مرة واحدة' using errcode = 'insufficient_privilege';
  end if;
  if new.state in ('awaiting_verification', 'verified') and (
       new.sha256 is null or new.size_bytes is null or new.entries_count is null
    or new.storage_provider is null or new.storage_key is null or new.manifest_sha256 is null) then
    raise exception 'لا يُعتمد أرشيف بلا بصمة وحجم ومفتاح وبيان' using errcode = 'check_violation';
  end if;
  -- الطوابع والإقرار تُكتب مرة واحدة.
  if (old.download_completed_at is not null and new.download_completed_at is distinct from old.download_completed_at)
     or (old.download_hash_verified_at is not null and new.download_hash_verified_at is distinct from old.download_hash_verified_at)
     or (old.backup_ack_at is not null and (new.backup_ack_at is distinct from old.backup_ack_at
                                            or new.backup_ack_by is distinct from old.backup_ack_by
                                            or new.backup_ack_note is distinct from old.backup_ack_note)) then
    raise exception 'طوابع التنزيل والإقرار تُكتب مرة واحدة' using errcode = 'insufficient_privilege';
  end if;
  if new.state <> 'verified' and (new.download_hash_verified_at is not null or new.download_completed_at is not null) then
    raise exception 'لا يُسجَّل تنزيل/تحقق إلا لأرشيف verified' using errcode = 'check_violation';
  end if;
  return new;
end
$$;
revoke all on function public.archives_guard_update() from public, anon, authenticated;
drop trigger if exists archives_guard_update_bu on public.archives;
create trigger archives_guard_update_bu
  before update on public.archives
  for each row execute function public.archives_guard_update();

-- (ج) -------------------------------------------------------------------------
create index if not exists versions_teacher_term on public.versions (teacher_id, term_id);

commit;
