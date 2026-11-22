// يولّد نسخة Deno-جاهزة من كود الخادم داخل supabase/functions/_shared/athar/ (الملف الوحيد الذي يتغير: لا تعدّلي المولَّد يدويًا).
// السبب: Deno (دالة Edge) يشترط امتداد .ts في الاستيراد النسبي، بينما مصدر المشروع (Vite/Node-test) يستعمل استيرادًا بلا امتداد. لا يُعدَّل المصدر.
// الخطوات: (1) يحسب الإغلاق الاستيرادي من نقاط الدخول (compose/edge/postgresDb)، (2) يضيف .ts للاستيرادات النسبية، (3) يرفض أي اعتماد خارجي
// خارج القائمة المسموحة (node:crypto, node:buffer, node:util) أو أي استيراد من React/Vite/المتصفح، (4) يكتب الملفات، (5) --check يقارن دون كتابة.
// الاستعمال: node scripts/build-edge-function.mjs          (يكتب)
//            node scripts/build-edge-function.mjs --check  (يخرج بـ1 إن اختلف المولَّد عن المصدر)
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(root, 'supabase/functions/_shared/athar')
const ENTRIES = ['server/api/compose.ts', 'server/host/edge.ts', 'server/db/postgresDb.ts']
const ALLOWED_EXTERNAL = new Set(['node:crypto', 'node:buffer', 'node:util'])
const check = process.argv.includes('--check')
const SPEC = /((?:^|\n)\s*(?:import|export)\s+(?:type\s+)?(?:[^'"\n;]*?\s+from\s+)?)(['"])([^'"\n]+)\2/g

function resolveRel(from, spec) {
  const base = resolve(dirname(from), spec)
  for (const c of [`${base}.ts`, join(base, 'index.ts')]) if (existsSync(c) && statSync(c).isFile()) return c
  throw new Error(`استيراد غير محلول: ${relative(root, from)} → ${spec}`)
}

const files = new Map() // مسار مطلق → { out, externals }
const stack = ENTRIES.map((e) => join(root, e))
const problems = []
while (stack.length) {
  const f = stack.pop()
  if (files.has(f)) continue
  const src = readFileSync(f, 'utf8')
  const externals = new Set()
  const out = src.replace(SPEC, (m, pre, q, spec) => {
    if (spec.startsWith('.')) {
      const target = resolveRel(f, spec)
      stack.push(target)
      const rel = spec.replace(/\/$/, '')
      const withExt = target.endsWith(`${sep}index.ts`) && !spec.endsWith('index') ? `${rel}/index.ts` : `${rel}.ts`
      return `${pre}${q}${withExt}${q}`
    }
    externals.add(spec)
    return m
  })
  for (const e of externals) if (!ALLOWED_EXTERNAL.has(e)) problems.push(`${relative(root, f)}: اعتماد خارجي غير مسموح: ${e}`)
  if (/import\.meta\.env|\bwindow\.|\btypeof window\b|\bdocument\.|\blocalStorage\b|\bsessionStorage\b|\bnavigator\./.test(src.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ''))) problems.push(`${relative(root, f)}: يستعمل واجهات متصفح/Vite`)
  files.set(f, { out: `// مولَّد آليًا من ${relative(root, f).split(sep).join('/')} بواسطة scripts/build-edge-function.mjs — لا تعدّليه يدويًا.\n${out}`, externals })
}
if (problems.length) { console.error(problems.join('\n')); process.exit(1) }

const expected = new Map([...files].map(([f, v]) => [join(OUT, relative(root, f)), v.out]))
const existing = []
const walk = (d) => { if (!existsSync(d)) return; for (const n of readdirSync(d)) { const p = join(d, n); statSync(p).isDirectory() ? walk(p) : existing.push(p) } }
walk(OUT)
const diffs = []
for (const [p, content] of expected) if (!existsSync(p) || readFileSync(p, 'utf8') !== content) diffs.push(`${check ? 'مختلف/ناقص' : 'مكتوب'}: ${relative(root, p)}`)
for (const p of existing) if (!expected.has(p)) diffs.push(`${check ? 'زائد' : 'محذوف'}: ${relative(root, p)}`)

if (check) {
  if (diffs.length) { console.error('المولَّد لا يطابق المصدر — شغّلي node scripts/build-edge-function.mjs\n' + diffs.join('\n')); process.exit(1) }
  console.log(`المولَّد مطابق للمصدر (${expected.size} ملفًا).`)
} else {
  for (const p of existing) if (!expected.has(p)) rmSync(p)
  for (const [p, content] of expected) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, content) }
  console.log(`تم: ${expected.size} ملفًا في ${relative(root, OUT)} (تغيّر ${diffs.length}).`)
}
