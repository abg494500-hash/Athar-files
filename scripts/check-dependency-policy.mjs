// حارس سياسة الاعتماديات (بلا npm ولا شبكة): يمنع تحديثًا رئيسيًا (major) غير مصرَّح به، واعتمادية مباشرة جديدة لم تُراجَع، وأي حزمة في القفل
// من خارج سجل npm الرسمي أو بلا بصمة سلامة. **لا يعرف شيئًا عن الثغرات** (هذا عمل `npm audit` وأداة التلخيص)؛ وظيفته ضمان أن علاج الثغرات لا يمرّ
// بتحديث رئيسي مخفيّ أو بمصدر غير موثوق.
// الاستعمال:
//   node scripts/check-dependency-policy.mjs                          يفحص مقابل docs/dependency-baseline.json
//   node scripts/check-dependency-policy.mjs --allow-major=vite,vitest  يسمح بتغيّر major لهذه الحزم فقط (بعد تحليل وخطة انتقال)
//   node scripts/check-dependency-policy.mjs --write-baseline          يكتب خط أساس جديد من القفل الحالي (قرار مقصود يُسجَّل في DECISIONS_LOG)
//   --root <مجلد>                                                      لاختبار مجلد آخر
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const rootArg = args.indexOf('--root')
const root = rootArg !== -1 ? resolve(args[rootArg + 1] ?? '.') : resolve(dirname(fileURLToPath(import.meta.url)), '..')
const allow = new Set((args.find((a) => a.startsWith('--allow-major='))?.split('=')[1] ?? '').split(',').filter(Boolean))
const write = args.includes('--write-baseline')
const WATCH = ['react', 'react-dom', 'react-router', 'react-router-dom', 'vite', 'vitest', 'vite-node', '@vitejs/plugin-react', 'typescript', 'tailwindcss', 'postcss', 'jsdom', 'esbuild', 'rollup', '@supabase/supabase-js']
const major = (v) => { const m = /^(\d+)\./.exec(v ?? ''); return m ? Number(m[1]) : null }

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'))
const packages = lock.packages ?? {}
const installed = (name) => packages[`node_modules/${name}`]?.version ?? null
const direct = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}), ...(pkg.optionalDependencies ?? {}) }

const baselinePath = join(root, 'docs', 'dependency-baseline.json')
if (write) {
  const majors = {}
  for (const n of new Set([...Object.keys(direct), ...WATCH])) { const v = installed(n); if (v) majors[n] = { major: major(v), version: v, direct: n in direct } }
  writeFileSync(baselinePath, JSON.stringify({ note: 'خط أساس لسياسة الاعتماديات: يُكتب بـ`--write-baseline` بقرار مقصود ويُسجَّل في DECISIONS_LOG. لا يُحدَّث لإخفاء تحديث رئيسي.', appVersion: pkg.version, lockfileVersion: lock.lockfileVersion, packages: majors }, null, 2) + '\n')
  console.log(`كُتب خط الأساس: ${Object.keys(majors).length} حزمة في ${baselinePath}`)
  process.exit(0)
}
if (!existsSync(baselinePath)) { console.error('لا يوجد docs/dependency-baseline.json؛ شغّلي --write-baseline مرة بقرار مقصود.'); process.exit(2) }
const base = JSON.parse(readFileSync(baselinePath, 'utf8')).packages

const res = []
const check = (name, ok, detail = '') => res.push({ name, ok, detail })

const jumped = []
for (const [n, b] of Object.entries(base)) {
  const v = installed(n)
  if (v === null) { if (!allow.has(n)) jumped.push(`${n}: لم تعد مثبَّتة (كانت ${b.version})؛ إن كان ذلك بسبب ترقية مصرَّح بها فأضيفيها إلى --allow-major`); continue }
  if (major(v) !== b.major && !allow.has(n)) jumped.push(`${n}: ${b.version} ← ${v} (major ${b.major} ← ${major(v)})`)
}
check('لا تحديث رئيسي (major) غير مصرَّح به لأي حزمة في خط الأساس', jumped.length === 0, jumped.join('; '))

// القفل متّسق مع package.json (npm ci يفشل عند عدم الاتساق، وتحليل الثغرات من قفل قديم يضلّل)
const rootLock = packages[''] ?? {}
const lockDirect = { ...(rootLock.dependencies ?? {}), ...(rootLock.devDependencies ?? {}), ...(rootLock.optionalDependencies ?? {}) }
const desync = [...new Set([...Object.keys(direct), ...Object.keys(lockDirect)])].filter((n) => direct[n] !== lockDirect[n]).map((n) => `${n}: package.json=${direct[n] ?? '—'} / القفل=${lockDirect[n] ?? '—'}`)
check('package-lock.json متّسق مع package.json (الاعتماديات المباشرة ونطاقاتها)', desync.length === 0, desync.join('; '))

const newDirect = Object.keys(direct).filter((n) => !(n in base) && installed(n) !== null)
check('لا اعتمادية مباشرة جديدة خارج خط الأساس (كل جديدة تُراجَع ثم يُحدَّث الخط عمدًا)', newDirect.length === 0, newDirect.join(', '))

const rangeJump = []
for (const [n, range] of Object.entries(direct)) { const b = base[n]; const m = /(\d+)\./.exec(range); if (b && m && Number(m[1]) !== b.major && !allow.has(n)) rangeJump.push(`${n}: النطاق ${range} لا يطابق major ${b.major}`) }
check('نطاقات package.json المباشرة لا تقفز بـmajor', rangeJump.length === 0, rangeJump.join('; '))

const bad = [], noInteg = []
for (const [k, p] of Object.entries(packages)) {
  if (k === '' || p.link) continue
  if (typeof p.resolved !== 'string' || !p.resolved.startsWith('https://registry.npmjs.org/')) bad.push(`${k} → ${p.resolved ?? '(بلا resolved)'}`)
  if (typeof p.integrity !== 'string' || !/^sha(512|384|256|1)-/.test(p.integrity)) noInteg.push(k)
}
check(`كل حزم القفل (${Object.keys(packages).length - 1}) من https://registry.npmjs.org/ فقط`, bad.length === 0, bad.slice(0, 5).join('; '))
check('كل حزمة في القفل لها بصمة سلامة (integrity)', noInteg.length === 0, noInteg.slice(0, 5).join(', '))
check('لا overrides/resolutions في package.json (تجاوز يحتاج قرارًا موثّقًا)', !pkg.overrides && !pkg.resolutions, JSON.stringify(pkg.overrides ?? pkg.resolutions ?? {}))

const withScripts = Object.entries(packages).filter(([k, p]) => k !== '' && p.hasInstallScript).map(([k]) => k.replace(/^.*node_modules\//, ''))
let failed = 0
for (const r of res) { if (!r.ok) failed++; console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok || !r.detail ? '' : `  ← ${r.detail}`}`) }
console.log(`INFO  حزم لها سكربت تثبيت (للمراجعة، لا فشل): ${withScripts.length ? withScripts.join(', ') : 'لا شيء'}`)
if (allow.size) console.log(`INFO  تحديث major مسموح لـ: ${[...allow].join(', ')} (يلزم تحليل وخطة انتقال)`)
console.log(`\n${res.length - failed}/${res.length} ناجح`)
process.exit(failed ? 1 : 0)
