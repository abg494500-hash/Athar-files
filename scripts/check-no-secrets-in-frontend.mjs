// فحص ساكن: لا أسرار خادم (مفتاح الخدمة، أسرار R2، أسرار الخلط، اتصال القاعدة) في الواجهة ولا في الحزمة، ولا استيراد من server/ داخل src/،
// وكل متغيرات VITE_ ضمن قائمة بيضاء (تُضمَّن في الحزمة العامة للمتصفح). إن وُجد dist فُحص أيضًا. **نصي فقط**؛ لا يغني عن مراجعة بشرية قبل النشر.
// الاستعمال: node scripts/check-no-secrets-in-frontend.mjs
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const res = []
const check = (name, ok, detail = '') => res.push({ name, ok, detail })
const walk = (d, filt = () => true) => !existsSync(d) ? [] : readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? (['node_modules', '.git'].includes(n) ? [] : walk(p, filt)) : filt(p) ? [p] : [] })
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')

const SECRET_PATTERNS = [
  [/SERVICE_ROLE_KEY|SUPABASE_SERVICE_ROLE|SERVICE_ROLE_SECRET/i, 'اسم متغير مفتاح الخدمة (اسم الدور service_role وحده مسموح: حارس الواجهة يرفضه)'], [/R2_SECRET|R2_ACCESS_KEY/, 'مفاتيح R2'], [/_PEPPER\b/, 'أسرار الخلط'],
  [/SUPABASE_DB_URL|ATHAR_DB_URL/, 'اتصال القاعدة'], [/postgres(?:ql)?:\/\/[^\s'"`]*@/, 'سلسلة اتصال بكلمة مرور'],
  [/sb_secret_[A-Za-z0-9]{8,}/, 'مفتاح Supabase سري'], [/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, 'JWT'], [/AKIA[A-Z0-9]{12,}/, 'مفتاح AWS/R2'], [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'مفتاح خاص'],
]
const srcFiles = walk(join(root, 'src'), (p) => /\.(ts|tsx|css|html)$/.test(p) && !p.includes(`${join('src', 'test')}`))
const hits = []
for (const f of srcFiles) { const s = strip(readFileSync(f, 'utf8')); for (const [re, label] of SECRET_PATTERNS) if (re.test(s)) hits.push(`${relative(root, f)}: ${label}`) }
check('src/: لا أسرار خادم ولا مفاتيح ولا JWT ولا سلاسل اتصال', hits.length === 0, hits.join('; '))

const importsServer = srcFiles.filter((f) => /from\s+['"][^'"]*\/server\//.test(readFileSync(f, 'utf8')) || /from\s+['"](\.\.\/)+server['"/]/.test(readFileSync(f, 'utf8')))
check('src/ لا يستورد أي شيء من server/', importsServer.length === 0, importsServer.map((f) => relative(root, f)).join(', '))

const ALLOWED_VITE = new Set(['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'VITE_TEACHER_API_URL', 'VITE_ATHAR_MAX_FILE_BYTES' /* رقم عام لتجاوز الحد محليًا */])
const viteNames = new Set()
for (const f of [...srcFiles, join(root, 'env-local-template.txt'), join(root, 'index.html')].filter(existsSync)) for (const m of readFileSync(f, 'utf8').matchAll(/\bVITE_[A-Z0-9_]+/g)) viteNames.add(m[0])
const bad = [...viteNames].filter((n) => !ALLOWED_VITE.has(n))
check('كل متغيرات VITE_ ضمن القائمة البيضاء (عامة بطبيعتها)', bad.length === 0, bad.join(', '))
check('لا متغير VITE_ باسم سري (SECRET/SERVICE/PEPPER/PRIVATE/PASSWORD/DB_URL)', ![...viteNames].some((n) => /SECRET|SERVICE|PEPPER|PRIVATE|PASSWORD|DB_URL|ACCESS_KEY/.test(n)), '')

const vite = existsSync(join(root, 'vite.config.ts')) ? strip(readFileSync(join(root, 'vite.config.ts'), 'utf8')) : ''
check('vite.config: لا define لـprocess.env ولا envPrefix مفتوح ولا loadEnv بلا بادئة', !/process\.env/.test(vite) && !/envPrefix/.test(vite) && !/loadEnv\([^)]*['"]{2}/.test(vite), '')

const tmpl = existsSync(join(root, 'env-local-template.txt')) ? readFileSync(join(root, 'env-local-template.txt'), 'utf8') : ''
const keys = [...tmpl.matchAll(/^\s*#?\s*([A-Z][A-Z0-9_]+)\s*=/gm)].map((m) => m[1])
check('env-local-template: مفاتيح VITE_ فقط وبقيم نائبة', keys.length > 0 && keys.every((k) => k.startsWith('VITE_')) && !/eyJ|sb_secret_|AKIA/.test(tmpl), keys.filter((k) => !k.startsWith('VITE_')).join(', '))

const gi = existsSync(join(root, '.gitignore')) ? readFileSync(join(root, '.gitignore'), 'utf8').split('\n').map((l) => l.trim()) : []
check('.gitignore يستثني .env و.env.* و**/.env للدوال', gi.includes('.env') && gi.includes('.env.*') && gi.includes('supabase/functions/**/.env'), '')
const envFiles = walk(root, (p) => /(^|[\\/])\.env(\..*)?$/.test(p))
check('لا ملف .env في الحزمة', envFiles.length === 0, envFiles.map((f) => relative(root, f)).join(', '))

const fnFiles = walk(join(root, 'supabase', 'functions'), (p) => p.endsWith('.ts') || p.endsWith('.json'))
const fnHits = []
for (const f of fnFiles) { const s = strip(readFileSync(f, 'utf8')); for (const [re, label] of SECRET_PATTERNS.filter(([r]) => !/SUPABASE_DB_URL|ATHAR_DB_URL|_PEPPER|R2_SECRET|R2_ACCESS_KEY/.test(r.source))) if (re.test(s)) fnHits.push(`${relative(root, f)}: ${label}`) }
check('supabase/functions: بلا أسرار حرفية ولا مفتاح الخدمة', fnHits.length === 0, fnHits.join('; '))

const dist = join(root, 'dist')
if (existsSync(dist)) {
  const dh = []
  for (const f of walk(dist, (p) => /\.(js|css|html|map)$/.test(p))) { const s = readFileSync(f, 'utf8'); for (const [re, label] of SECRET_PATTERNS) if (re.test(s)) dh.push(`${relative(root, f)}: ${label}`) }
  check('dist/: لا أسرار في الحزمة المبنية', dh.length === 0, dh.join('; '))
} else check('dist/: غير موجود (شغّلي npm run build ثم أعيدي الفحص)', true, '')

let failed = 0
for (const r of res) { if (!r.ok) failed++; console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok || !r.detail ? '' : `  ← ${r.detail}`}`) }
console.log(`\n${res.length - failed}/${res.length} ناجح`)
process.exit(failed ? 1 : 0)
