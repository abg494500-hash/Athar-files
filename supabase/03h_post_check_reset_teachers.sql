-- أثَر — فحص ما بعد 01i (قراءة فقط: SELECT واحد). المتوقع: كل الصفوف PASS. أي FAIL ⇒ أرسليه لي ولا تكمل.
select check_name, status from (
  select 1 as n, 'التصفير يحذف المعلمات بلا أثر في سنة أخرى (purge يعطّل teachers_no_delete مؤقتًا)' as check_name, case when (select prosrc from pg_proc where oid = 'public.year_reset_purge(uuid)'::regprocedure) like '%teachers_no_delete%' then 'PASS' else 'FAIL' end as status
  union all select 2, 'التقرير يعدّ المعلمات المحذوفة', case when (select prosrc from pg_proc where oid = 'public.year_reset_report(uuid)'::regprocedure) like '%c_gone%' then 'PASS' else 'FAIL' end
  union all select 3, 'مشغّل منع حذف المعلمات مفعّل (لم يُترك معطّلًا)', case when (select count(*) from pg_trigger where tgname = 'teachers_no_delete' and tgenabled = 'O') = 1 then 'PASS' else 'FAIL' end
) c order by n;
