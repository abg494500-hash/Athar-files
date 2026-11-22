// فحص ساكن (نصي) لملفات 006 و007 وتسلسل ملفات SQL والتوافق مع ملفات supabase المولَّدة. **ليس بديلًا عن تشغيلها على PostgreSQL.**
// الاستعمال: node scripts/check-sql-additions-static.mjs
import { existsSync, readFileSync } from 'node:fs'
const strip = (t) => t.replace(/--[^\n]*/g, '')
const R = (p) => readFileSync(p, 'utf8')
const seq = ['001_schema', '002_integrity', '003_rls', '004_upload_tables', '005_staff_accounts', '006_teacher_sessions', '007_server_additions', '008_teacher_removal', '009_archive_parts', '010_year_reset', '011_years_teachers_import', '012_teacher_delete', '013_reset_for_staff', '014_reset_light_gate']
const res = []
const check = (name, ok, detail = '') => res.push({ name, ok, detail })

check('تسلسل ملفات SQL: 001..007 موجودة كلها', seq.every((n) => existsSync(`database/${n}.sql`)), seq.filter((n) => !existsSync(`database/${n}.sql`)).join(', '))
const src = Object.fromEntries(seq.map((n) => [n, strip(R(`database/${n}.sql`))]))
const s006 = src['006_teacher_sessions'], s007 = src['007_server_additions']
const earlier = seq.slice(0, 5).map((n) => src[n]).join('\n')

// عدم تكرار ما هو موجود
const created = (t) => [...t.matchAll(/create table (?:if not exists )?public\.(\w+)/gi)].map((m) => m[1])
const dup = created(s006).concat(created(s007)).filter((t) => created(earlier).includes(t))
check('006/007 لا تعيدان إنشاء جداول موجودة في 001..005', dup.length === 0, dup.join(', '))
check('007 لا تنشئ جداول', created(s007).length === 0, created(s007).join(', '))
check('006 تنشئ teacher_sessions فقط', JSON.stringify(created(s006)) === JSON.stringify(['teacher_sessions']), created(s006).join(', '))
const idx = (t) => [...t.matchAll(/create (?:unique )?index (?:if not exists )?(\w+)/gi)].map((m) => m[1])
check('لا فهارس مكررة بالاسم مع 001..005', idx(s006).concat(idx(s007)).every((i) => !idx(earlier).includes(i)), '')
check('أسماء المشغّلات الجديدة غير مكررة', !/create trigger archives_guard_update_bu/i.test(earlier), '')

// 006
check('006: RLS مفعّلة على teacher_sessions', /alter table public\.teacher_sessions enable row level security/i.test(s006), '')
check('006: لا policies (الخادم وحده)', !/create policy/i.test(s006), '')
check('006: سحب كل الصلاحيات من public وanon وauthenticated', /revoke all on public\.teacher_sessions from public, anon, authenticated/i.test(s006), '')
check('006: بصمة الرمز مقيّدة بـ64 خانة سداسية وفريدة', /token_hash\s+text not null unique check \(token_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/.test(s006), '')
check('006: فهرس بصمة الكود فريد وجزئي', /create unique index if not exists teacher_credentials_code_hash_uq[\s\S]*where code_hash is not null/i.test(s006), '')
check('006: مفتاح أجنبي restrict لا cascade (لا حذف تبعي)', /references public\.teachers \(id\) on delete restrict/i.test(s006) && !/on delete cascade/i.test(s006), '')

// 007
const fnBlock = (name) => (s007.match(new RegExp(`create or replace function public\\.${name}[\\s\\S]*?\\$\\$;?\\s*\\n`, 'i')) ?? [''])[0]
check('007: log_audit_as security definer بمسار بحث ثابت', /function public\.log_audit_as[\s\S]*?security definer set search_path = ''/i.test(s007), '')
check('007: log_audit_as تسحب التنفيذ من public وanon وauthenticated', /revoke all on function public\.log_audit_as\([^)]*\) from public, anon, authenticated/i.test(s007), '')
check('007: log_audit_as تمنح service_role وحده', (s007.match(/grant execute on function public\.log_audit_as/gi) ?? []).length === 1 && /to service_role/i.test(s007) && !/grant[^;]*to[^;]*\b(anon|authenticated)\b/i.test(s007), '')
check('007: الدور من staff_profiles النشط لا من المستدعي', /from public\.staff_profiles sp where sp\.user_id = p_actor and sp\.is_active/i.test(s007) && !/p_role/i.test(s007), '')
check('007: log_audit_as تكتب في audit_log فقط (insert وحيد)', (s007.match(/insert into public\.(\w+)/gi) ?? []).every((m) => /audit_log/i.test(m)) && (s007.match(/insert into/gi) ?? []).length === 1, '')
check('007: حارس الأرشيف: مشغّل before update لكل صف', /create trigger archives_guard_update_bu\s+before update on public\.archives\s+for each row/i.test(s007), '')
check('007: حارس الأرشيف يمنع الرجوع من failed ويقيّد الانتقالات', /old\.state = 'failed'/.test(s007) && /old\.state = 'creating' and new\.state in \('awaiting_verification', 'failed'\)/.test(s007) && /old\.state = 'awaiting_verification' and new\.state in \('verified', 'failed'\)/.test(s007), '')
check('007: بصمة/مفتاح/حجم الأرشيف تُكتب مرة واحدة', /old\.sha256 is not null and new\.sha256 is distinct from old\.sha256/.test(s007) && /old\.storage_key is not null and new\.storage_key is distinct from old\.storage_key/.test(s007), '')
check('007: لا حذف ولا تعديل لبيانات (لا delete/truncate/drop/update على جداول)', !/\b(delete from|truncate|drop table|drop column|alter table)\b/i.test(s007) && !/\bupdate public\./i.test(s007), '')
check('006/007: لا drop لجدول/عمود/قيد قائم', !/\bdrop (table|column|constraint|schema)\b/i.test(s006 + s007), '')
check('006/007: لا أسرار (JWT/sb_/مفاتيح خام)', !/eyJ[A-Za-z0-9_-]{20,}\.|sb_(secret|publishable)_|-----BEGIN/.test(R('database/006_teacher_sessions.sql') + R('database/007_server_additions.sql')), '')

// الملفات المولَّدة والاختبارات
const c01 = existsSync('supabase/01c_server_additions.sql') ? R('supabase/01c_server_additions.sql') : ''
check('01c مولَّد ويضم 006 و007 كاملين في معاملة واحدة', /^[\s\S]*\nbegin;/.test(c01) && /commit;\s*$/.test(c01) && c01.includes(R('database/006_teacher_sessions.sql').trim()) && c01.includes(R('database/007_server_additions.sql').trim()), '')
const p3b = existsSync('supabase/03b_post_check_additions.sql') ? strip(R('supabase/03b_post_check_additions.sql')) : ''
check('03b قراءة فقط (select وحيد بلا DML/DDL)', p3b !== '' && !/\b(insert|update|delete|alter|create|drop|grant|revoke|truncate)\b/i.test(p3b.replace(/'[^']*'/g, "''")), '')
check('03b يفحص 12 شرطًا', (p3b.match(/select \d+,|select 1 as n/g) ?? []).length === 12, String((p3b.match(/select \d+,|select 1 as n/g) ?? []).length))
check('اختبارات القاعدة المحلية: 35 موجود ومشغّلا .sh/.ps1 يشغّلانه', existsSync('tests/sql/35_server_additions_006_007.sql') && /35_server_additions_006_007/.test(R('tests/sql/run-sql-tests.sh')) && /35_server_additions_006_007/.test(R('tests/sql/run-sql-tests.ps1')), '')
check('مسودة 006 الأصلية محفوظة في docs/phase5/drafts', existsSync('docs/phase5/drafts/006_teacher_sessions.DRAFT.sql'), '')

let failed = 0
for (const r of res) { if (!r.ok) failed++; console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok || !r.detail ? '' : `  ← ${r.detail}`}`) }
console.log(`\n${res.length - failed}/${res.length} ناجح`)
process.exit(failed ? 1 : 0)
