// يجمع **كل ما أحتاجه لوضع خطة معالجة ثغرات مبنية على بيانات السجل الحقيقية** في مجلد واحد، بأوامر قراءة فقط (لا install ولا fix):
//   npm audit (كامل وإنتاج فقط)، npm audit fix --dry-run (ما كان سيتغير)، npm outdated، npm ls --all،
//   ولكل حزمة متأثرة/مراقبة: dist-tags وقائمة الإصدارات، ولكل إصدار مرشَّح للإصلاح/الأحدث: engines وpeerDependencies وdependencies.
// الاستعمال (على جهازكِ، يحتاج الإنترنت):  node scripts/collect-audit-evidence.mjs [--out audit-evidence]
// الناتج: audit-evidence/evidence.json + evidence-summary.md (أرسليهما لي). لا يغيّر package.json ولا القفل ولا node_modules.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runNpmJson, runNpm } from './lib/npm.mjs'

const rootArg = process.argv.indexOf('--root')
const root = rootArg !== -1 ? resolve(process.argv[rootArg + 1] ?? '.') : resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outArg = process.argv.indexOf('--out')
const out = resolve(root, outArg !== -1 ? process.argv[outArg + 1] : 'audit-evidence')
mkdirSync(out, { recursive: true })

const WATCH = ['vite', 'vitest', '@vitejs/plugin-react', 'react-router', 'react-router-dom', 'tailwindcss', 'postcss', 'autoprefixer', 'jsdom', '@testing-library/jest-dom', '@testing-library/react', '@types/react', 'react', 'react-dom', 'typescript']
const NAME = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/
const log = []
const step = (name, r) => { log.push({ step: name, ok: r.ok, code: r.code, note: r.note }); console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${name}${r.note ? ` — ${r.note}` : ''}`); return r }

const npmVer = runNpm(['--version'])
const evidence = { meta: { generatedAt: new Date().toISOString(), node: process.version, npm: npmVer.stdout.trim() || null, platform: process.platform, appVersion: JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version }, commands: {}, packages: {} }

const audit = step('npm audit --json', runNpmJson(['audit', '--json'], { cwd: root }))
evidence.commands.audit = audit.data
evidence.commands.auditProd = step('npm audit --omit=dev --json', runNpmJson(['audit', '--omit=dev', '--json'], { cwd: root })).data
evidence.commands.fixDryRun = step('npm audit fix --dry-run --json', runNpmJson(['audit', 'fix', '--dry-run', '--json'], { cwd: root })).data
evidence.commands.outdated = step('npm outdated --json', runNpmJson(['outdated', '--json'], { cwd: root })).data
evidence.commands.ls = step('npm ls --all --json', runNpmJson(['ls', '--all', '--json'], { cwd: root })).data

// الحزم المتأثرة + المراقبة، والإصدارات المرشَّحة (fixAvailable + latest)
const vulns = evidence.commands.audit?.vulnerabilities ?? {}
const names = new Set([...Object.keys(vulns), ...WATCH])
for (const n of names) {
  if (!NAME.test(n)) { console.log(`تخطّي اسم غير صالح: ${n}`); continue }
  const rec = (evidence.packages[n] = {})
  rec.distTags = step(`npm view ${n} dist-tags`, runNpmJson(['view', n, 'dist-tags', '--json'], { cwd: root })).data
  rec.versions = step(`npm view ${n} versions`, runNpmJson(['view', n, 'versions', '--json'], { cwd: root })).data
  const cands = new Set()
  const fa = vulns[n]?.fixAvailable
  if (fa && typeof fa === 'object' && fa.version && fa.name === n) cands.add(fa.version)
  const latest = rec.distTags?.latest
  if (typeof latest === 'string') cands.add(latest)
  rec.candidates = {}
  for (const v of cands) {
    if (!/^[0-9A-Za-z.+-]+$/.test(v)) continue
    rec.candidates[v] = step(`npm view ${n}@${v} (engines/peer/deps)`, runNpmJson(['view', `${n}@${v}`, 'version', 'engines', 'peerDependencies', 'dependencies', '--json'], { cwd: root })).data
  }
}
// الإصدارات المثبَّتة فعليًا (من npm ls) للحزم المتأثرة: تُستخرج في الملخص

evidence.log = log
writeFileSync(join(out, 'evidence.json'), JSON.stringify(evidence, null, 1))
const meta = audit.data?.metadata?.vulnerabilities ?? {}
const md = [
  '# ملخّص جمع الأدلة', '',
  `- التاريخ: ${evidence.meta.generatedAt} — Node ${evidence.meta.node} — npm ${evidence.meta.npm ?? '؟'} — ${evidence.meta.platform} — أثر ${evidence.meta.appVersion}`,
  `- ثغرات npm audit: ${meta.total ?? '؟'} (حرجة ${meta.critical ?? '؟'}، عالية ${meta.high ?? '؟'}، متوسطة ${meta.moderate ?? '؟'}، منخفضة ${meta.low ?? '؟'})`,
  `- الحزم المتأثرة: ${Object.keys(vulns).join('، ') || 'لا شيء/تعذّر'}`,
  `- أوامر فشلت: ${log.filter((l) => !l.ok).map((l) => l.step).join('؛ ') || 'لا شيء'}`,
  '', 'أرسلي لي `evidence.json` وهذا الملف. لا أسرار فيهما (مخرجات npm العامة فقط).',
].join('\n') + '\n'
writeFileSync(join(out, 'evidence-summary.md'), md)
console.log(`\nكُتب: ${join(out, 'evidence.json')} و${join(out, 'evidence-summary.md')}`)
process.exit(0)
