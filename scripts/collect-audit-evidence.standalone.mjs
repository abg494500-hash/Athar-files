// ملف واحد مستقل (بلا استيرادات من المشروع) لجمع أدلة ثغرات npm بأوامر قراءة فقط. ضعيه في **جذر مشروعكِ الحالي** (بجوار package.json) وشغّلي:
//     node collect-audit-evidence.standalone.mjs
// لا يثبّت ولا يحدّث ولا يعدّل package.json أو package-lock.json أو node_modules. يحتاج الإنترنت. الناتج: مجلد audit-evidence\ فيه evidence.json وevidence-summary.md (أرسليهما).
// هو نفسه منطق scripts/collect-audit-evidence.mjs مع lib/npm.mjs في ملف واحد (يُختبَر بالاختبارات نفسها).
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

// ---- تشغيل npm قرائيًا بقائمة بيضاء (shell لازم على Windows لـnpm.cmd) ----
const SAFE_ARG = /^[@A-Za-z0-9._/=-]+$/
const READ_ONLY = new Set(['audit', 'view', 'ls', 'outdated', '--version'])
function runNpm(args, cwd) {
  if (!READ_ONLY.has(args[0])) throw new Error(`أمر npm غير مسموح: ${args[0]}`)
  if (args[0] === 'audit' && args.includes('fix') && !args.includes('--dry-run')) throw new Error('npm audit fix بلا --dry-run ممنوع')
  for (const a of args) if (!SAFE_ARG.test(a)) throw new Error(`وسيط npm غير مسموح: ${a}`)
  const r = spawnSync('npm', args, { cwd, shell: true, encoding: 'utf8', timeout: 180_000, maxBuffer: 512 * 1024 * 1024 })
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', error: r.error ? String(r.error.message) : null }
}
function runNpmJson(args, cwd) {
  const r = runNpm(args, cwd)
  if (r.error) return { ok: false, data: null, code: r.code, note: r.error }
  const t = r.stdout.trim()
  if (!t) return { ok: false, data: null, code: r.code, note: (r.stderr || 'مخرجات فارغة').trim().slice(0, 400) }
  try { return { ok: true, data: JSON.parse(t), code: r.code, note: null } } catch { return { ok: false, data: null, code: r.code, note: `ليس JSON: ${t.slice(0, 200)}` } }
}

// ---- الجمع ----
const root = resolve(process.cwd())
if (!existsSync(join(root, 'package.json'))) { console.error('لا يوجد package.json هنا. شغّلي الملف من جذر مشروع أثر (حيث package.json).'); process.exit(2) }
const out = join(root, 'audit-evidence'); mkdirSync(out, { recursive: true })
const WATCH = ['vite', 'vitest', '@vitejs/plugin-react', 'react-router', 'react-router-dom', 'tailwindcss', 'postcss', 'autoprefixer', 'jsdom', '@testing-library/jest-dom', '@testing-library/react', '@types/react', 'react', 'react-dom', 'typescript']
const NAME = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/
const log = []
const step = (name, r) => { log.push({ step: name, ok: r.ok, code: r.code, note: r.note }); console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${name}${r.note ? ` — ${r.note}` : ''}`); return r }

const npmVer = runNpm(['--version'], root)
const evidence = { meta: { generatedAt: new Date().toISOString(), node: process.version, npm: npmVer.stdout.trim() || null, platform: process.platform, appVersion: JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version ?? null }, commands: {}, packages: {} }
const audit = step('npm audit --json', runNpmJson(['audit', '--json'], root))
evidence.commands.audit = audit.data
evidence.commands.auditProd = step('npm audit --omit=dev --json', runNpmJson(['audit', '--omit=dev', '--json'], root)).data
evidence.commands.fixDryRun = step('npm audit fix --dry-run --json', runNpmJson(['audit', 'fix', '--dry-run', '--json'], root)).data
evidence.commands.outdated = step('npm outdated --json', runNpmJson(['outdated', '--json'], root)).data
evidence.commands.ls = step('npm ls --all --json', runNpmJson(['ls', '--all', '--json'], root)).data

const vulns = evidence.commands.audit?.vulnerabilities ?? {}
for (const n of new Set([...Object.keys(vulns), ...WATCH])) {
  if (!NAME.test(n)) { console.log(`تخطّي اسم غير صالح: ${n}`); continue }
  const rec = (evidence.packages[n] = {})
  rec.distTags = step(`npm view ${n} dist-tags`, runNpmJson(['view', n, 'dist-tags', '--json'], root)).data
  rec.versions = step(`npm view ${n} versions`, runNpmJson(['view', n, 'versions', '--json'], root)).data
  const cands = new Set(); const fa = vulns[n]?.fixAvailable
  if (fa && typeof fa === 'object' && fa.version && fa.name === n) cands.add(fa.version)
  if (typeof rec.distTags?.latest === 'string') cands.add(rec.distTags.latest)
  rec.candidates = {}
  for (const v of cands) { if (!/^[0-9A-Za-z.+-]+$/.test(v)) continue; rec.candidates[v] = step(`npm view ${n}@${v} (engines/peer/deps)`, runNpmJson(['view', `${n}@${v}`, 'version', 'engines', 'peerDependencies', 'dependencies', '--json'], root)).data }
}
evidence.log = log
writeFileSync(join(out, 'evidence.json'), JSON.stringify(evidence, null, 1))
const meta = audit.data?.metadata?.vulnerabilities ?? {}
writeFileSync(join(out, 'evidence-summary.md'), ['# ملخّص جمع الأدلة', '', `- التاريخ: ${evidence.meta.generatedAt} — Node ${evidence.meta.node} — npm ${evidence.meta.npm ?? '؟'} — ${evidence.meta.platform} — أثر ${evidence.meta.appVersion}`,
  `- ثغرات npm audit: ${meta.total ?? '؟'} (حرجة ${meta.critical ?? '؟'}، عالية ${meta.high ?? '؟'}، متوسطة ${meta.moderate ?? '؟'}، منخفضة ${meta.low ?? '؟'})`,
  `- الحزم المتأثرة: ${Object.keys(vulns).join('، ') || 'لا شيء/تعذّر'}`, `- أوامر فشلت: ${log.filter((l) => !l.ok).map((l) => l.step).join('؛ ') || 'لا شيء'}`, '', 'أرسلي لي `evidence.json` وهذا الملف. لا أسرار فيهما (مخرجات npm العامة فقط).'].join('\n') + '\n')
console.log(`\nكُتب: ${join(out, 'evidence.json')} و${join(out, 'evidence-summary.md')}`)
