// فحوص ساكنة للمرحلة 3 (بلا شبكة وبلا مكتبات): تشغيل: node scripts/check-stage3-static.mjs
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const results = []
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail })
const files = []
const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = `${d}/${e.name}`; e.isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(e.name) && files.push(p) } }
walk('src')
const text = (p) => readFileSync(p, 'utf8')
const prod = files.filter((p) => !p.startsWith('src/test/'))

check('Login: لا منطق دخول وهمي بالبادئة (director…)', !/startsWith\(\s*['"]director/.test(text('src/pages/auth/Login.tsx')))
check('Login: لا قبول رمز معلمة محلي (hashIndex/pool)', !/hashIndex|codeState === 'active'\)/.test(text('src/pages/auth/Login.tsx')))
check('لا استدعاء login({role}) خارج طبقة البيانات', !prod.filter((p) => !p.startsWith('src/data/')).some((p) => /\blogin\(\s*\{/.test(text(p))))
check('provider.ts لا يستورد المصدر الوهمي ولا البذرة', !/mock|seed/i.test(text('src/data/provider.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')))
const mockImporters = prod.filter((p) => /from\s+['"][^'"]*\/mock(\/[^'"]*)?['"]|import\(\s*['"][^'"]*\/mock\//.test(text(p)))
check('المصدر الوهمي لا يُستورد من أي ملف إنتاجي (للاختبارات فقط)', mockImporters.length === 0, mockImporters.join(', '))
const main = text('src/main.tsx')
check('main.tsx: لا أثر لوضع المعاينة ولا للمصدر الوهمي', !/__REVIEW_MODE__|mock\/review/.test(main))
check('main.tsx: لا استيراد ثابت للمصدر الوهمي', !/^import .*mock/m.test(main))
check('supabase-js يُستورد من client.ts وحده', prod.filter((p) => /from\s+['"]@supabase\/supabase-js['"]/.test(text(p))).join() === 'src/lib/supabase/client.ts')
check('package.json يعلن @supabase/supabase-js', /"@supabase\/supabase-js"\s*:/.test(readFileSync('package.json', 'utf8')))
check('.gitignore يستثني ملفات .env', /^\.env$/m.test(readFileSync('.gitignore', 'utf8')) && /^\.env\.\*$/m.test(readFileSync('.gitignore', 'utf8')))
const envFiles = readdirSync('.').filter((n) => /^\.env/.test(n))
check('لا ملف .env في المجلد (لا أسرار في الحزمة)', envFiles.length === 0, envFiles.join(', '))
check('لا مفتاح JWT/sb_* خام في المصدر والوثائق', ![...files, ...readdirSync('docs').map((n) => `docs/${n}`).filter((p) => p.endsWith('.md'))].some((p) => /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}|sb_(secret|publishable)_[A-Za-z0-9]{8,}/.test(text(p))))
const env = text('src/vite-env.d.ts')
check('vite-env: متغيرا الاتصال العامان فقط (لا SERVICE/SECRET)', /VITE_SUPABASE_URL/.test(env) && /VITE_SUPABASE_ANON_KEY/.test(env) && !/SERVICE|SECRET/i.test(env))
check('الحارس Guard لا يعتمد على بريد أو بادئة', !/email|startsWith/.test(text('src/App.tsx')))
check('DataGate موجود ومستعمل في Guard', existsSync('src/components/layout/DataGate.tsx') && /<DataGate>/.test(text('src/App.tsx')))
const repo = text('src/data/supabase/supabaseRepository.ts')
check('المستودع الحقيقي لا يحوي رجوعًا إلى المصدر الوهمي', !/mock|seed|MOCK_NOW/i.test(repo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')))
check('المستودع لا يقرأ storage_key/storage_bucket ولا code_hash/pin_hash', !/select\([^)]*(storage_key|storage_bucket|code_hash|pin_hash)/.test(repo))
check('المستودع لا يكتب على versions/submissions/archives/audit_log/teacher_credentials', !/from\('(versions|submissions|archives|audit_log|teacher_credentials|deletion_requests|upload_sessions)'\)\s*\.\s*(insert|update)/.test(repo))

// الشعار الأصلي محمي (A-91/A-92): بصمات SHA-256 المعتمدة لملفات الشعار في المصدر وpublic. أي تعديل مقصود يستلزم تحديث هذه البصمات بقرار صريح.
const BRAND = { 'icon.png': 'a915d008533ddc674ba679dbfeb8234ca33526b3417ce0844e33f0df279b72d4', 'logo-dark.png': 'b0811a908e1db9b6a4e736a205dd8aafed1406bb879b9fa64dfa439fc7ace73f', 'logo-light.png': 'cdff8170bc02f2d7943c4b5bdcf85d6b75b183a9448882fa0441b98fdb5ca011' }
for (const dir of ['src/assets/brand', 'public/brand']) for (const [n, h] of Object.entries(BRAND)) {
  const got = existsSync(`${dir}/${n}`) ? createHash('sha256').update(readFileSync(`${dir}/${n}`)).digest('hex') : 'missing'
  check(`الشعار لم يتغير: ${dir}/${n}`, got === h, got)
}
check('لا شريط جانبي: AppShell بلا <aside>', !/<aside/.test(text('src/components/layout/AppShell.tsx')))
check('الرئيسية والتنقل من سجل أقسام واحد', /sectionsFor/.test(text('src/components/layout/AppShell.tsx')) && /groupedSections/.test(text('src/pages/shared/Home.tsx')))
check('الخروج الاعتيادي والرفض بنطاق local (لا يبطلان جلسات الأجهزة الأخرى)', /signOut\(\{ scope \}\)/.test(text('src/lib/auth/controller.ts')) && /scope: 'local' \| 'global' = 'local'/.test(text('src/lib/auth/controller.ts')))
{
  // A-98: لا TOTP، لكن لا دخول مصرَّح إلا بعد: صف نشط في staff_profiles ثم تأكيد الدور من الخادم ومطابقته للصف.
  const c = text('src/lib/auth/controller.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  check('A-98: لا أثر لـTOTP/MFA في متحكّم الدخول ولا الصفحة', !/mfa|totp|aal/i.test(c) && !/mfa|totp|TotpForm/i.test(text('src/pages/auth/Login.tsx')))
  check('A-98: authorized يسبقه تأكيد الدور من الخادم ومطابقته للصف', /rpc\('current_staff_role'\)/.test(c) && /r\.data !== profileRole/.test(c) && c.indexOf("rpc('current_staff_role')") < c.indexOf("set({ phase: 'authorized'"))
  check('A-98: الصف النشط بدور owner|director شرط قبل التأكيد', /profile\.is_active !== true \|\| !isStaffRole\(profile\.role\)/.test(c))
}

let failed = 0
for (const r of results) { if (!r.ok) failed++; console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok || !r.detail ? '' : `  ← ${r.detail}`}`) }
console.log(`\n${results.length - failed}/${results.length} ناجح`)
process.exit(failed ? 1 : 0)
