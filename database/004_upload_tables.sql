-- ============================================================================
-- أثَر — 5.B — مسودة v4 لجداول الرفع (اقتراح للمراجعة فقط؛ v3 وv2 باقيتان كما هما)
-- تغييرات v4 عن v3 (قرارات 5.B): (1) إعداد app_settings.validating_stuck_minutes بافتراضي 10 (قابل للتعديل)؛
--   (2) وراثة وقت البدء بإجراء صريح من المالكة فقط: upload_sessions.platform_fault / inherited_from / effective_start_at،
--   مع مشغّل إدراج يتحقق من جلسة الأصل (ملغاة بعلامة عطل منصة وبملاحظة، لنفس المعلمة/الفصل/الخانة، ولمرة واحدة بقيد فريد)،
--   وversions_match_session يطابق submitted_at مع effective_start_at؛ (3) مفردة outcome الجديدة start_inherited.
-- **ما زالت غير منفَّذة**: لا PostgreSQL في بيئة العمل؛ الاختبارات الجاهزة في tests/sql/ تُشغَّل على جهازك.
-- (نص v3 أدناه كما هو مع التعديلات المذكورة.)
-- أثَر — 5.A — مسودة v3 لجداول الرفع (اقتراح للمراجعة فقط؛ تحلّ محل v2 التي بقيت كما هي)
-- الحالة: **غير منفَّذة، غير مجرَّبة، ولم تُفحص حتى بمحلّل صياغة PostgreSQL** (لا PostgreSQL ولا pglast في بيئة العمل). كتبتُها قراءةً فقط.
-- تغييرات v3 عن v2 (قرارات 5.A): (1) حُذف سبب الرفض stalled؛ (2) انتقال validating → uploaded لاستئناف التحقق؛
--   (3) إفراج المالكة uploaded/validating → cancelled بملاحظة إلزامية release_note؛ (4) أعمدة validating_at للعالقة؛
--   (5) أعمدة دليل أول بايتات first_byte_evidence_* معلوماتية فقط (لا تدخل في حساب التأخير)؛
--   (6) إصلاح خلل في v2: فحص النافذة وكتابة uploaded_at كانا سيُطبَّقان على كل انتقال إلى uploaded فيمنعان الاستئناف بعد الانقضاء؛ صارا لـstarted → uploaded فقط؛
--   (7) مفردات outcome في upload_attempts أُضيفت لها أحداث الاستئناف والإفراج والدليل.
-- لا تُنقل إلى database/ ولا تُنفَّذ قبل: (1) موافقتك على القرارات المبدئية A-56، (2) موافقة مستقلة على التنفيذ (A-40).
-- المسودة الأصلية drafts/004_upload_tables.DRAFT.sql باقية كما هي ولم تُعدَّل جملها (فقط تعليقات مراجعة).
-- مرجع الشرح: docs/phase5/PHASE5_1B_REMEDIATION.md (C-1…C-9).
-- تفترض التنفيذ بعد 001 و002 و003 على قاعدة جديدة فارغة (انظر الحارس أدناه، C-8).
-- افتراض غير متحقَّق منه: في Supabase قد تُمنح الجداول الجديدة في public صلاحيات افتراضية لأدوار anon/authenticated/service_role،
--   لذا تُسحب هنا صراحةً لكل جدول جديد (003 يسحب الموجود وقتها فقط).
-- ============================================================================

-- (0) حارس C-8: يفشل بوضوح إن لم تكن الجداول فارغة بدل فشل ADD COLUMN NOT NULL برسالة غامضة.
do $$
begin
  if exists (select 1 from public.upload_sessions) or exists (select 1 from public.versions) then
    raise exception 'مسودة 004 تفترض upload_sessions وversions فارغين؛ ادمجي الأعمدة في 001 بدل ALTER';
  end if;
end
$$;

-- (أ-0) [v4] مهلة اعتبار validating عالقة: إعداد لا ثابت (الافتراضي 10 دقائق، وليس مدة نهائية).
alter table public.app_settings
  add column validating_stuck_minutes integer not null default 10 check (validating_stuck_minutes > 0);

-- (أ) توسيع upload_sessions
alter table public.upload_sessions
  add column idempotency_key   text   not null check (length(btrim(idempotency_key)) > 0),
  add column status_at_start   text   not null check (status_at_start in ('on_time', 'late')),
  add column uploaded_at       timestamptz,
  add column validated_at      timestamptz,
  add column verified_size     bigint check (verified_size is null or verified_size > 0),
  add column verified_sha256   text   check (verified_sha256 is null or verified_sha256 ~ '^[0-9a-f]{64}$'),
  add column validation_result jsonb,
  add column finished_at       timestamptz,
  add column validating_at     timestamptz,
  add column release_note      text,
  add column first_byte_evidence_at     timestamptz,
  add column first_byte_evidence_source text,
  -- [v4] وراثة صريحة بقرار المالكة بعد عطل المنصة: لا تلقائية.
  add column platform_fault     boolean not null default false,
  add column inherited_from     uuid unique references public.upload_sessions (id) on delete restrict,
  add column effective_start_at timestamptz not null;

-- حالة 'cancelled' مقترحة (C-5). اسم قيد 001 المتوقَّع تلقائيًا: upload_sessions_state_check (يُتحقَّق منه عند التجربة).
alter table public.upload_sessions drop constraint upload_sessions_state_check;
alter table public.upload_sessions
  add constraint upload_sessions_state_check
  check (state in ('started', 'uploaded', 'validating', 'accepted', 'rejected', 'expired', 'cancelled'));

alter table public.upload_sessions
  add constraint upload_sessions_idempotency unique (teacher_id, idempotency_key),
  add constraint upload_sessions_window_valid check (expires_at > started_at),
  add constraint upload_sessions_reject_reason check (
    reject_reason is null or reject_reason in
      ('expired','empty','too_large','type_not_allowed','size_mismatch','signature_mismatch','hash_invalid','deadline_closed')),
  -- C-7: اتساق الحالة مع الحقول؛ rejected لا يحمل سبب expired (له حالته)، وcancelled بلا سبب.
  add constraint upload_sessions_state_fields check (
    (state = 'started' and finished_at is null and uploaded_at is null)
    or (state = 'uploaded'   and finished_at is null and uploaded_at is not null and validating_at is null)
    or (state = 'validating' and finished_at is null and uploaded_at is not null and validating_at is not null)
    or (state = 'accepted' and finished_at is not null and uploaded_at is not null and validated_at is not null
        and verified_size is not null and verified_sha256 is not null and validation_result is not null and reject_reason is null)
    or (state = 'rejected' and finished_at is not null and reject_reason is not null and reject_reason <> 'expired')
    or (state = 'expired'  and finished_at is not null and reject_reason = 'expired')
    -- cancelled: إلغاء المعلمة قبل وصول الملف (بلا ملاحظة)، أو إفراج المالكة بعد وصوله (ملاحظة إلزامية).
    or (state = 'cancelled' and finished_at is not null and reject_reason is null
        and (uploaded_at is null or (release_note is not null and length(btrim(release_note)) > 0)))
  ),
  add constraint upload_sessions_release_note_only_cancelled check (release_note is null or state = 'cancelled'),
  -- [v4] علامة عطل المنصة لا تُوضع إلا مع إفراج مُلاحَظ (cancelled بعد وصول الملف).
  add constraint upload_sessions_platform_fault_needs_release check (not platform_fault or (state = 'cancelled' and release_note is not null)),
  -- دليل أول البايتات معلوماتي: زوج مكتمل ولا يسبق البدء؛ لا يدخل في حساب التأخير قبل اعتماد Q-4.
  add constraint upload_sessions_evidence_pair check ((first_byte_evidence_at is null) = (first_byte_evidence_source is null)),
  add constraint upload_sessions_evidence_after_start check (first_byte_evidence_at is null or first_byte_evidence_at >= started_at);

-- (C-5) جلسة نشطة واحدة لكل (معلمة، فصل، خانة). النشطة: started / uploaded / validating.
create unique index upload_sessions_one_active
  on public.upload_sessions (teacher_id, term_id, slot_id)
  where state in ('started', 'uploaded', 'validating');

-- (C-6) فهارس المسح: المنتهية (started)، والمنتظرة للتحقق (uploaded/validating) لا تنقضي ولا تُرفض بالتأخير، والعالقة في validating.
-- ملاحظة تشغيلية: قبل إدراج جلسة جديدة لخانة يجب على الخادم إنهاء جلسة started المنقضية لتلك الخانة (UPDATE إلى expired)،
--   وإلا منعها الفهرس الفريد أدناه؛ والمشغّل يسمح بـexpired فقط حين now() >= expires_at.
create index upload_sessions_open_expiry on public.upload_sessions (expires_at) where state = 'started';
create index upload_sessions_pending_verification_scan on public.upload_sessions (uploaded_at) where state in ('uploaded', 'validating');
create index upload_sessions_validating_since on public.upload_sessions (validating_at) where state = 'validating';

-- (C-3) حماية upload_sessions: لا حذف، ولا تعديل إلا انتقالات الحالة المحددة، والأزمنة من ساعة القاعدة.
create or replace function public.upload_sessions_guard_insert()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_minutes integer;
  p public.upload_sessions%rowtype;
begin
  select upload_window_minutes into v_minutes from public.app_settings where id;
  if v_minutes is null then
    raise exception 'إعدادات النظام غير مهيأة' using errcode = 'check_violation';
  end if;
  if new.state <> 'started' or new.uploaded_at is not null or new.finished_at is not null
     or new.validated_at is not null or new.reject_reason is not null then
    raise exception 'الجلسة الجديدة تبدأ بحالة started وبلا أزمنة نهاية' using errcode = 'check_violation';
  end if;
  -- وقت البدء والانقضاء من ساعة القاعدة لا من المستدعي (A-33)؛ والنافذة تُثبَّت لحظة البدء فلا يغيّرها تعديل إعداد لاحق.
  new.started_at := now();
  new.expires_at := new.started_at + make_interval(mins => v_minutes);
  -- [v4] وقت البدء المعتمد: وقت البدء نفسه، أو الموروث من جلسة أُفرج عنها بعلامة عطل منصة (مرة واحدة بقيد inherited_from الفريد).
  if new.platform_fault then
    raise exception 'علامة عطل المنصة لا توضع عند الإدراج' using errcode = 'check_violation';
  end if;
  if new.inherited_from is null then
    new.effective_start_at := new.started_at;
  else
    select * into p from public.upload_sessions where id = new.inherited_from;
    if not found or p.state <> 'cancelled' or not p.platform_fault
       or (p.teacher_id, p.term_id, p.slot_id) is distinct from (new.teacher_id, new.term_id, new.slot_id) then
      raise exception 'لا إذن وراثة صالح لهذه الجلسة' using errcode = 'check_violation';
    end if;
    new.status_at_start := p.status_at_start;
    new.effective_start_at := p.effective_start_at;
  end if;
  return new;
end
$$;
create trigger upload_sessions_guard_insert_bi
  before insert on public.upload_sessions
  for each row execute function public.upload_sessions_guard_insert();

create or replace function public.upload_sessions_guard_update()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_mutable text[] := array['state','reject_reason','uploaded_at','validated_at','verified_size',
                            'verified_sha256','validation_result','finished_at','provider_upload_ref',
                            'validating_at','release_note','first_byte_evidence_at','first_byte_evidence_source','platform_fault'];
begin
  if old.state in ('accepted', 'rejected', 'expired', 'cancelled') then
    raise exception 'الجلسة في حالة نهائية ولا تُعدَّل' using errcode = 'insufficient_privilege';
  end if;
  if (to_jsonb(new) - v_mutable) is distinct from (to_jsonb(old) - v_mutable) then
    raise exception 'مسموح تغيير حقول الحالة والتحقق فقط' using errcode = 'insufficient_privilege';
  end if;
  -- حقول تُكتب مرة واحدة: لا تغيير بعد ضبطها.
  if (old.provider_upload_ref is not null and new.provider_upload_ref is distinct from old.provider_upload_ref)
     or (old.uploaded_at is not null and new.uploaded_at is distinct from old.uploaded_at)
     or (old.first_byte_evidence_at is not null
         and (new.first_byte_evidence_at is distinct from old.first_byte_evidence_at
              or new.first_byte_evidence_source is distinct from old.first_byte_evidence_source)) then
    raise exception 'حقل يُكتب مرة واحدة' using errcode = 'insufficient_privilege';
  end if;
  if new.state is distinct from old.state then
    if not (
         (old.state = 'started'    and new.state in ('uploaded', 'rejected', 'expired', 'cancelled'))
      -- uploaded/validating → cancelled: إفراج المالكة (يفرضه الخادم)، ويلزمه release_note بقيد الجدول.
      or (old.state = 'uploaded'   and new.state in ('validating', 'rejected', 'cancelled'))
      -- validating → uploaded: استئناف التحقق بعد تعطل/تأخر، لا رفض بسبب التأخير.
      or (old.state = 'validating' and new.state in ('accepted', 'rejected', 'uploaded', 'cancelled'))
    ) then
      raise exception 'انتقال حالة غير مسموح: % → %', old.state, new.state using errcode = 'insufficient_privilege';
    end if;
    -- النافذة تُلزَم في القاعدة: لا uploaded عند/بعد الانقضاء، ولا expired قبله.
    if old.state = 'started' and new.state = 'uploaded' and now() >= old.expires_at then
      raise exception 'انقضت نافذة الرفع' using errcode = 'check_violation';
    end if;
    if new.state = 'expired' and now() < old.expires_at then
      raise exception 'لم تنقضِ نافذة الرفع بعد' using errcode = 'check_violation';
    end if;
    -- الأزمنة من ساعة القاعدة.
    if old.state = 'started' and new.state = 'uploaded' then new.uploaded_at := now(); end if;
    if new.state = 'validating' then new.validating_at := now(); end if;
    if old.state = 'validating' and new.state <> 'validating' then new.validating_at := null; end if;
    if new.state = 'accepted' then new.validated_at := now(); end if;
    if new.state in ('accepted', 'rejected', 'expired', 'cancelled') then new.finished_at := now(); end if;
  end if;
  return new;
end
$$;
create trigger upload_sessions_guard_update_bu
  before update on public.upload_sessions
  for each row execute function public.upload_sessions_guard_update();

create trigger upload_sessions_no_delete
  before delete on public.upload_sessions
  for each row execute function public.forbid_delete();
create trigger upload_sessions_no_truncate
  before truncate on public.upload_sessions
  for each statement execute function public.forbid_mutation();

-- (ب) ربط الإصدار بجلسته (يعالج G-4)
alter table public.versions
  add column upload_session_id uuid unique references public.upload_sessions (id) on delete restrict;

alter table public.versions
  add constraint versions_file_verified check (
    kind <> 'file'
    or (validated_at is not null and validation_result is not null and upload_session_id is not null));

-- (C-4) اتساق الإصدار مع جلسته: لا يُدرَج إصدار ملف إلا وجلسته validating وبياناتها تطابق ما قيس.
create or replace function public.versions_match_session()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  s public.upload_sessions%rowtype;
begin
  if new.kind <> 'file' then
    return new;
  end if;
  select * into s from public.upload_sessions where id = new.upload_session_id;
  if not found then
    raise exception 'جلسة الرفع غير موجودة' using errcode = 'check_violation';
  end if;
  if s.state <> 'validating' then
    raise exception 'لا يُسجَّل إصدار إلا من جلسة في حالة validating' using errcode = 'check_violation';
  end if;
  if (s.teacher_id, s.term_id, s.slot_id) is distinct from (new.teacher_id, new.term_id, new.slot_id) then
    raise exception 'الإصدار لا يطابق معلمة/فصل/خانة الجلسة' using errcode = 'check_violation';
  end if;
  if new.submitted_at is distinct from s.effective_start_at then
    raise exception 'وقت التسليم يجب أن يطابق وقت البدء المعتمد للجلسة' using errcode = 'check_violation';
  end if;
  if new.status_snapshot is distinct from s.status_at_start then
    raise exception 'حالة التسليم يجب أن تطابق حالة بدء الجلسة' using errcode = 'check_violation';
  end if;
  if new.size_bytes is distinct from s.verified_size or new.sha256 is distinct from s.verified_sha256 then
    raise exception 'حجم الملف وبصمته يجب أن يطابقا ما قيس عند التحقق' using errcode = 'check_violation';
  end if;
  return new;
end
$$;
create trigger versions_match_session_bi
  before insert on public.versions
  for each row execute function public.versions_match_session();

-- (ج) محاولات الرفع: إضافة فقط، بلا ip_hash (تقليل بيانات — C-9، توصية تحتاج موافقتك)
create table public.upload_attempts (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  teacher_id  uuid not null references public.teachers (id) on delete restrict,
  session_id  uuid references public.upload_sessions (id) on delete restrict,
  outcome     text not null check (outcome in
    ('started','start_rejected','duplicate_start','uploaded','accepted','rejected','expired','duplicate_complete','denied','cancelled',
     'validation_deferred','validation_recovered','owner_released','evidence_recorded','start_inherited')),
  reason      text
);
create index upload_attempts_at on public.upload_attempts (at);
create index upload_attempts_teacher_at on public.upload_attempts (teacher_id, at);

-- (C-2) إضافة فقط: لا تعديل ولا حذف ولا TRUNCATE (حتى من خدمة الخادم؛ المشغّلات لا يتجاوزها service_role).
create trigger upload_attempts_no_mutation
  before update or delete on public.upload_attempts
  for each row execute function public.forbid_mutation();
create trigger upload_attempts_no_truncate
  before truncate on public.upload_attempts
  for each statement execute function public.forbid_mutation();

-- (C-1) أقل صلاحية لقراءة المالكة: سحب كل شيء ثم منح SELECT على أعمدة محددة + RLS للمالكة فقط.
alter table public.upload_attempts enable row level security;
revoke all on public.upload_attempts from public, anon, authenticated;
revoke all on sequence public.upload_attempts_id_seq from public, anon, authenticated;
grant select (id, at, teacher_id, session_id, outcome, reason) on public.upload_attempts to authenticated;
create policy upload_attempts_select on public.upload_attempts for select to authenticated
  using (public.current_staff_role() = 'owner');
-- لا policy إدراج/تعديل/حذف ولا منح كتابة: الكتابة بخدمة الخادم فقط.
-- ملاحظة: مع منح الأعمدة لا يصلح SELECT * من العميل؛ تُسمّى الأعمدة صراحة (كما في teacher_credentials).

-- اقتراح (يحتاج موافقتك، غير مفعّل): قراءة المالكة لأزمنة الجلسات لمراجعة اعتراضات المواعيد، دون pending_key وprovider_upload_ref:
--   grant select (id, teacher_id, term_id, slot_id, declared_name, declared_size, state, reject_reason,
--                 status_at_start, started_at, expires_at, uploaded_at, validated_at, finished_at)
--     on public.upload_sessions to authenticated;
--   create policy upload_sessions_select on public.upload_sessions for select to authenticated
--     using (public.current_staff_role() = 'owner');

-- D-8: أعمدة first_byte_evidence_* أُضيفت معلوماتية فقط؛ لا يُبنى عليها حساب التأخير ولا submitted_at قبل قياس T1 فعليًا واعتماد المالكة (Q-4).
-- مرشَّح لـD-9: سبب platform_fault وعمود inherits_status_from — غير مضاف قبل اعتماد الآلية.
-- لا purge_old_upload_attempts ولا عمود احتفاظ (D-10: لا حذف تلقائي).
-- دالة register_upload_version(session_id) تُكتب في 5.4 وتُختبر على قاعدة فعلية.

-- ============================================================================
-- [الدفعة 1 م3، 2026-10-21] إضافة كشفها تشغيل اختبار الصلاحيات (supabase/02_security_check.sql) بعد تطبيق 004 فوق 003:
-- (1) دوال المشغّلات الجديدة تُمنح EXECUTE لـPUBLIC افتراضيًا (revoke في 003 لا يشمل ما يُنشأ بعده)؛ تُسحب صراحةً.
-- (ملاحظة: versions.upload_session_id يبقى غير مقروء للمسجّلين عمدًا؛ اختبار 20_sessions_004 يفرض ذلك.)
-- هذه الإضافة في database/004_upload_tables.sql فقط؛ drafts/…DRAFT-v4.sql تبقى كما كانت للتاريخ.
-- ============================================================================
revoke execute on function public.upload_sessions_guard_insert() from public, anon, authenticated;
revoke execute on function public.upload_sessions_guard_update() from public, anon, authenticated;
revoke execute on function public.versions_match_session() from public, anon, authenticated;
