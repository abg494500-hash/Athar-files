-- ============================================================================
-- أثَر — 99: مسح كل البيانات التجريبية قبل إدخال البيانات الحقيقية (r41).
-- ⚠ لا رجعة فيه. شغّليه مرة واحدة فقط في SQL Editor (دور postgres) ثم ألقي هذا الملف جانبًا.
--
-- يُمسح:  المعلمات ورموزهن وجلسات دخولهن، كل التسليمات والإصدارات وجلسات الرفع، الأرشيفات وأجزاؤها، طلبات الحذف،
--         محاولات الدخول، سجل التدقيق (audit_log) وسجلات التصفير، وكذلك السنوات والفصول (v_wipe_calendar أدناه).
-- يبقى:   حساب المالكة وحساب المديرة (staff_profiles + Authentication → Users)، إعدادات النظام (app_settings)،
--         وأنواع الملفات المطلوبة (slots، ثابتة من النظام). والدوال والسياسات والمشغّلات كما هي.
-- لا يلمس: ملفات R2 (لا يستطيع SQL ذلك). بعد نجاحه افرغي حاوية R2 من لوحة Cloudflare (Bucket → Objects → حدّدي الكل → Delete)
--         وإلا بقيت ملفات يتيمة تستهلك مساحة (لا ضرر أمنيًا: لا يشير إليها شيء).
--
-- للتنفيذ: غيّري v_confirm من 'NO' إلى 'YES' في السطر المشار إليه أدناه، ثم Run. أي قيمة أخرى ⇒ لا يُمسح شيء.
-- ============================================================================
begin;

do $$
declare
  v_confirm       text    := 'NO';   -- ← غيّريها إلى 'YES' لتنفيذ المسح فعلًا
  v_wipe_calendar boolean := true;   -- true: تُمسح السنوات والفصول أيضًا (تُنشئين سنتكِ الحقيقية من «سنة جديدة»)؛ false: تبقى
  t               text;
  tables_ordered  text[];
  n_before        bigint;
begin
  if v_confirm is distinct from 'YES' then
    raise exception 'لم يُمسح شيء: غيّري v_confirm إلى ''YES'' في أول الملف ثم أعيدي التشغيل.';
  end if;

  -- يجب أن يبقى حساب مسؤول واحد على الأقل (وإلا لا تستطيعين الدخول بعد المسح).
  if (select count(*) from public.staff_profiles where is_active) = 0 then
    raise exception 'لا يوجد حساب مسؤول نشط في staff_profiles؛ أوقفنا المسح حتى لا تُقفلي الباب على نفسكِ.';
  end if;

  tables_ordered := array[
    'login_attempts', 'teacher_sessions', 'upload_attempts', 'deletion_requests',
    'archive_entries', 'archive_parts', 'archives',
    'versions', 'upload_sessions', 'submissions',
    'teacher_credentials', 'teachers',
    'year_reset_keys', 'year_resets', 'year_closures',
    'audit_log'
  ];
  if v_wipe_calendar then tables_ordered := tables_ordered || array['terms', 'years']; end if;

  -- تعطيل مشغّلات المنع (no_delete / no_truncate / سلسلة audit) داخل هذه المعاملة فقط؛ تعود فورًا بعد المسح.
  foreach t in array tables_ordered loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I disable trigger user', t);
    end if;
  end loop;

  -- ملاحظة: staff_profiles وapp_settings وslots لا تُلمس إطلاقًا.
  foreach t in array tables_ordered loop
    if to_regclass('public.' || t) is not null then
      execute format('select count(*) from public.%I', t) into n_before;
      execute format('truncate table public.%I restart identity cascade', t);
      raise notice 'مُسح: % (% صفًّا)', t, n_before;
    end if;
  end loop;

  foreach t in array tables_ordered loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I enable trigger user', t);
    end if;
  end loop;

  -- فحوص ما بعد المسح: كل شيء فارغ، وحسابات المسؤولين والإعدادات والأنواع سليمة، ولا مشغّل بقي معطّلًا.
  if exists (select 1 from public.teachers) or exists (select 1 from public.versions) or exists (select 1 from public.submissions) or exists (select 1 from public.audit_log) then
    raise exception 'فشل المسح: بقيت بيانات. التراجع.';
  end if;
  if not exists (select 1 from public.staff_profiles where is_active) then raise exception 'اختفت حسابات المسؤولين! التراجع.'; end if;
  if not exists (select 1 from public.app_settings) then raise exception 'اختفت إعدادات النظام! التراجع.'; end if;
  if (select count(*) from public.slots) = 0 then raise exception 'اختفت أنواع الملفات المطلوبة (slots)! التراجع.'; end if;
  if exists (select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid join pg_namespace ns on ns.oid = c.relnamespace
              where ns.nspname = 'public' and not tg.tgisinternal and tg.tgenabled <> 'O') then
    raise exception 'بقي مشغّل معطّلًا! التراجع.';
  end if;
  raise notice 'تم: كل البيانات التجريبية مُسحت. حسابا المسؤولين والإعدادات وأنواع الملفات باقية.';
end
$$;

commit;

-- بعد النجاح: افرغي حاوية R2، ثم ادخلي كمالكة وأنشئي السنة الدراسية الحقيقية وفصليها ومواعيدها، ثم استوردي المعلمات من Excel.
