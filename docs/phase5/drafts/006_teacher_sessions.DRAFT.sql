-- مسودة 006 — جلسات المعلمات وفهرس الكود (الدفعة 5). **غير مُنفَّذة على أي قاعدة ولم تُنقل إلى database/**.
-- تحتاج موافقتكِ الصريحة لأنها تضيف جدولًا وفهرسًا فريدًا (تغيير في قيود القاعدة). المصدر: docs/phase5/TEACHER_LOGIN_DESIGN.md §3 و§5.
-- الأثر: الجدول يُقرأ ويُكتب من خدمة الخادم وحدها (service_role). لا RLS policies ⇒ لا وصول لـanon/authenticated إطلاقًا.

-- 1) فهرس فريد على بصمة الكود (البحث عن المعلمة بالكود يعتمد عليه، وتصادم الكود يُكتشف به).
create unique index if not exists teacher_credentials_code_hash_uq
  on public.teacher_credentials (code_hash) where code_hash is not null;

-- 2) جلسات المعلمات: تُخزَّن بصمة الرمز فقط (SHA-256 hex)، لا الرمز.
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

alter table public.teacher_sessions enable row level security;
revoke all on public.teacher_sessions from anon, authenticated;
-- لا حذف تلقائي للجلسات المنتهية هنا (قرار الاحتفاظ معلّق، مثل login_attempts في OQ-07).
