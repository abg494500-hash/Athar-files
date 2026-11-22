// فحص ساكن (نصي) لملفات SQL — **ليس بديلًا عن تشغيلها على PostgreSQL**؛ يلتقط فقط انتكاسات أمنية معروفة (C-10 وغيره).
// الاستعمال من جذر المشروع: node scripts/check-sql-static.mjs
import { existsSync, readFileSync } from 'node:fs'

const strip = (t) => t.replace(/--[^\n]*/g, '')
const read = (p) => strip(readFileSync(p, 'utf8'))
const files = {
  s001: read('database/001_schema.sql'),
  s003: read('database/003_rls.sql'),
  d4: read('docs/phase5/drafts/004_upload_tables.DRAFT-v4.sql'),
}
const stmts = (t) => t.split(';').map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean)
const KEYCOLS = /storage_(provider|bucket|key)/
const results = []
const check = (name, ok, detail = '') => results.push({ name, ok, detail })

// 1) C-10: لا منح SELECT على جدول versions/archives كاملًا لـauthenticated، ولا أعمدة تخزين في أي منح أعمدة لهما.
const s3 = stmts(files.s003)
const grants = s3.filter((s) => /^grant select/i.test(s))
const tableLevel = grants.filter((s) => !/^grant select\s*\(/i.test(s) && /public\.(versions|archives)\b/.test(s))
check('003: لا SELECT على الجدول كاملًا لـversions/archives', tableLevel.length === 0, tableLevel.join(' | '))
const colGrants = grants.filter((s) => /^grant select\s*\(/i.test(s) && /on public\.(versions|archives)\b/.test(s))
check('003: يوجد منح أعمدة لـversions وarchives', colGrants.length === 2, `وُجد ${colGrants.length}`)
check('003: منح الأعمدة بلا أعمدة تخزين', colGrants.every((s) => !KEYCOLS.test(s)), colGrants.filter((s) => KEYCOLS.test(s)).join(' | '))
const view = s3.find((s) => /create view public\.v_backup_manifest/i.test(s)) ?? ''
check('003: المنظور موجود وبلا أعمدة تخزين', view !== '' && !KEYCOLS.test(view.replace(/storage_state/g, '')), '')
check('003: security_invoker مفعّل للمنظور', /security_invoker\s*=\s*true/i.test(view), '')

// 2) RLS مفعّل لكل جدول معرَّف في 001 ومسودة 004 (v3).
const tables001 = [...files.s001.matchAll(/create table public\.(\w+)/gi)].map((m) => m[1])
const rls003 = new Set([...files.s003.matchAll(/alter table public\.(\w+)\s+enable row level security/gi)].map((m) => m[1]))
const missing = tables001.filter((t) => !rls003.has(t))
check('003: RLS مفعّل لكل جداول 001', missing.length === 0, missing.join(', '))
const tablesD4 = [...files.d4.matchAll(/create table public\.(\w+)/gi)].map((m) => m[1])
const rlsD4 = new Set([...files.d4.matchAll(/alter table public\.(\w+)\s+enable row level security/gi)].map((m) => m[1]))
check('004v4: RLS مفعّل للجداول الجديدة', tablesD4.every((t) => rlsD4.has(t)), tablesD4.filter((t) => !rlsD4.has(t)).join(', '))
check('004v4: upload_sessions بلا منح لـauthenticated (خدمة الخادم فقط)', !/grant\s+\w+[^;]*on public\.upload_sessions[^;]*to authenticated/i.test(files.d4), '')
check('004v4: لا منح كتابة (insert/update/delete) لأي دور تطبيقي', !/grant\s+(insert|update|delete|all)[^;]*to\s+(authenticated|anon)/i.test(files.d4), '')

check('004v4: مهلة validating إعداد بافتراضي 10', /validating_stuck_minutes integer not null default 10/.test(files.d4), '')
check('004v4: الوراثة مرة واحدة (inherited_from فريد) ومشروطة بعلامة عطل', /inherited_from\s+uuid unique/.test(files.d4) && /not p\.platform_fault/.test(files.d4), '')
check('اختبارات PostgreSQL الجاهزة موجودة', ['00_bootstrap','10_security_003','20_sessions_004'].every((n) => existsSync(`tests/sql/${n}.sql`)), '')

// 3) stalled محذوف من الشيفرة التنفيذية للمسودة ومن المنطق المرجعي.
check('004v4: لا سبب stalled في الشيفرة', !/stalled/i.test(files.d4), '')
const lib = ['session.ts', 'ledger.ts', 'verify.ts'].map((f) => strip(readFileSync(`src/lib/upload/${f}`, 'utf8').replace(/\/\/[^\n]*/g, '')).toLowerCase())
check('src/lib/upload: لا stalled في الشيفرة', lib.every((t) => !t.includes('stalled')), '')

// 4) مفاتيح الخدمة لا تظهر في المصدر المرسَل للمتصفح (فحص نصي بسيط).
let leak = []
for (const f of ['src']) {
  const out = []
  const walk = (d) => { for (const e of (await_readdir(d))) { const p = `${d}/${e.name}`; e.isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(e.name) && out.push(p) } }
  walk(f)
  // المرحلة 3: الإشارة الوحيدة المسموحة هي حارس الرفض في src/lib/supabase/env.ts واختباراته (ليرفض مفتاحًا سريًا وُضع بالخطأ).
  const allowed = (p) => p === 'src/lib/supabase/env.ts' || p === 'src/test/supabaseData.test.ts'
  leak = out.filter((p) => !allowed(p) && /service_role|SUPABASE_SERVICE|R2_SECRET|secret_access_key/i.test(readFileSync(p, 'utf8')))
}
check('src: لا إشارة إلى service_role أو مفاتيح R2 السرية', leak.length === 0, leak.join(', '))

function await_readdir(d) { return readdirSync(d, { withFileTypes: true }) }
import { readdirSync } from 'node:fs'

// 5) [المرحلة 2] فحوص ساكنة لـ005 والملفات المولَّدة (نصية فقط؛ لا تُغني عن تنفيذ SQL).
{
  const raw = (p) => readFileSync(p, 'utf8')
  const s005 = read('database/005_staff_accounts.sql')
  const apply = raw('supabase/01_apply_all.sql')
  const b = raw('supabase/01b_staff_accounts.sql')
  const sec = raw('supabase/02_security_check.sql')
  const post = raw('supabase/03_post_check.sql')
  const secCode = strip(sec)
  let pos = 0, inOrder = true
  for (const p of ['database/001_schema.sql', 'database/002_integrity.sql', 'database/003_rls.sql', 'database/004_upload_tables.sql']) {
    const i = apply.indexOf(raw(p), pos); if (i < 0) { inOrder = false; break } pos = i + raw(p).length
  }
  check('005: 01_apply_all يحوي 001..004 كاملة وبالترتيب', inOrder, '')
  check('005: 01_apply_all لا يحوي 005 (يبقى كما اختُبر محليًا)', !/staff_profiles_guard|bootstrap_staff/.test(apply), '')
  check('005: 01b يحوي database/005 كاملًا', b.includes(raw('database/005_staff_accounts.sql')), '')
  check('005: begin واحد وcommit واحد', (s005.match(/\bbegin\s*;/gi) ?? []).length === 1 && (s005.match(/\bcommit\s*;/gi) ?? []).length === 1, '')
  {
    // A-98: لا تحقق بخطوتين. تعريف current_staff_role في 005 لا يذكر aal ولا jwt، ويطابق تعريف 002 جوهريًا (صف نشط للمستخدمة الحالية).
    const fn = (t) => (/create or replace function public\.current_staff_role\(\)[\s\S]*?\$\$;/i.exec(t) ?? [''])[0]
    const f5 = fn(s005), f2 = fn(read('database/002_integrity.sql'))
    check('005: current_staff_role موجودة ولا تشترط aal2 ولا تقرأ JWT (A-98)', f5.length > 0 && !/aal|jwt/i.test(f5), '')
    check('005: current_staff_role تشترط auth.uid() وis_active', /auth\.uid\(\)/.test(f5) && /is_active/.test(f5), '')
    check('005: تعريف current_staff_role مطابق لتعريف 002 (نفس المنطق)', f5.replace(/\s+/g, ' ') === f2.replace(/\s+/g, ' ') || (f2.length > 0 && f5.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ') === f2.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ')), '')
    const stray = ['database', 'supabase', 'tests/sql', 'scripts'].flatMap((d) => readdirSync(d, { withFileTypes: true }).filter((e) => e.isFile() && /mfa/i.test(e.name)).map((e) => `${d}/${e.name}`))
    check('A-98: لا ملف نشط باسم mfa (القديمة في archive فقط)', stray.length === 0, stray.join(', '))
    const activeMfa = ['database/001_schema.sql', 'database/002_integrity.sql', 'database/003_rls.sql', 'database/004_upload_tables.sql', 'database/005_staff_accounts.sql', 'supabase/01_apply_all.sql', 'supabase/01b_staff_accounts.sql', 'supabase/02_security_check.sql'].filter((p) => /auth\.jwt\(\)|'aal'|aal2|\.mfa\b/i.test(strip(readFileSync(p, 'utf8'))))
    check('A-98: لا شرط aal/jwt/mfa في أي SQL نشط (خارج التعليقات)', activeMfa.length === 0, activeMfa.join(', '))
  }
  check('005: لا تنفيذ لـbootstrap_staff لأي دور (سحب صريح يشمل service_role)', /revoke all on function public\.bootstrap_staff\(text, text\) from public, anon, authenticated, service_role/i.test(s005), '')
  check('005: لا أي GRANT (لا منح جديدة لأي دور)', !/\bgrant\b/i.test(s005), '')
  check('005: كل الدوال الجديدة بـsearch_path فارغ', ((s005.match(/create or replace function/gi) ?? []).length) === ((s005.match(/set search_path = ''/gi) ?? []).length), '')
  check('005: لا استعمال لمفتاح الخدمة أو أسرار', !/service_role_key|secret|password|apikey/i.test(s005.replace(/from public, anon, authenticated, service_role/gi, '')), '')
  check('02: بلا begin/commit صريحين (معاملة ضمنية واحدة)', !/^\s*(begin|commit)\s*;/im.test(secCode), '')
  check('02: الحارس athar.single_tx موجود قبل أي create/alter/insert', secCode.indexOf('athar.single_tx') >= 0 && secCode.indexOf('athar.single_tx') < Math.min(...['create schema', 'alter table', 'insert into'].map((k) => secCode.indexOf(k)).filter((i) => i >= 0)), '')
  const damaging = [...secCode.matchAll(/disable trigger|drop constraint/gi)].map((m) => m.index)
  check('02: كل تعطيل مشغّل/إسقاط قيد داخل DO بعد الحارس مباشرة', damaging.length > 0 && damaging.every((i) => secCode.lastIndexOf('athar.single_tx', i) > secCode.lastIndexOf('do $x$', i) && secCode.lastIndexOf('do $x$', i) > secCode.lastIndexOf('end $x$', i)), `${damaging.length} موضع`)
  check('02: ينتهي بخطأ مقصود RESULT', /raise exception E'RESULT: PASS=%/.test(secCode) && /end \$r\$;\s*$/.test(secCode), '')
  check('02: لا بقايا app.uid (استُبدلت بـclaims)', !/app\.uid/.test(secCode), '')
  check('02: هوية الجلسات بـclaims (sub وrole) بلا مستوى aal', /json_build_object\('sub', uid, 'role', 'authenticated'\)/.test(secCode) && !/'aal'/.test(secCode), '')
  check('02: PRESEED قبل منح service_role المحاكاة', secCode.indexOf('لا تنفيذ bootstrap_staff') > 0 && secCode.indexOf('لا تنفيذ bootstrap_staff') < secCode.indexOf('grant all on all tables in schema public to service_role'), '')
  check('02: لا commit ولا dml حقيقي خارج الاختبار (لا drop table/schema)', !/drop (table|schema)/i.test(secCode), '')
  check('03: ملف الفحص قراءة فقط (select وحيد، بلا DML/DDL)', !/\b(insert|update|delete|alter|create|drop|grant|revoke|truncate)\b/i.test(strip(post).replace(/'[^']*'/g, "''")), '')
  // المرحلة 3: المكتبة تُستورد من ملف واحد فقط (client.ts) ولا يوجد مفتاح خام في المصدر.
  {
    const files = []
    const w = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = `${d}/${e.name}`; e.isDirectory() ? w(p) : /\.(ts|tsx)$/.test(e.name) && files.push(p) } }
    w('src')
    const importers = files.filter((p) => /from\s+['"]@supabase\/supabase-js['"]/.test(readFileSync(p, 'utf8')))
    check('src: supabase-js يُستورد من src/lib/supabase/client.ts وحده', importers.length === 1 && importers[0] === 'src/lib/supabase/client.ts', importers.join(', '))
    const keyLeak = files.filter((p) => /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}|sb_(secret|publishable)_[A-Za-z0-9]{8,}/.test(readFileSync(p, 'utf8')))
    check('src: لا مفتاح JWT أو sb_* خام في المصدر', keyLeak.length === 0, keyLeak.join(', '))
  }
}

let failed = 0
for (const r of results) {
  if (!r.ok) failed += 1
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok || !r.detail ? '' : `  ← ${r.detail}`}`)
}
console.log(`\n${results.length - failed}/${results.length} ناجح`)
process.exit(failed === 0 ? 0 : 1)
