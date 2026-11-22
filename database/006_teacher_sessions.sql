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
