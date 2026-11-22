// يسجّل نتيجة `npm audit` بعد كل دفعة إصلاح: ملفا JSON (كامل وإنتاج) ويضيف سطرًا إلى docs/phase5/AUDIT_LOG_AR.md بالأعداد وأسماء الحزم المتبقية.
// الاستعمال:  node scripts/record-audit-batch.mjs "الدفعة 1: وصف قصير"     (قراءة فقط؛ لا يغيّر الاعتماديات)
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runNpmJson } from './lib/npm.mjs'
const rootArg = process.argv.indexOf('--root')
const root = rootArg !== -1 ? resolve(process.argv[rootArg + 1] ?? '.') : resolve(dirname(fileURLToPath(import.meta.url)), '..')
const label = (process.argv[2] ?? '').trim()
if (!label) { console.error('الاستعمال: node scripts/record-audit-batch.mjs "وصف الدفعة"'); process.exit(2) }
const dir = join(root, 'audit-log'); mkdirSync(dir, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const full = runNpmJson(['audit', '--json'], { cwd: root }), prod = runNpmJson(['audit', '--omit=dev', '--json'], { cwd: root })
if (!full.ok || !prod.ok) { console.error('تعذّر تشغيل npm audit (الإنترنت؟):', full.note ?? prod.note); process.exit(1) }
writeFileSync(join(dir, `${stamp}-full.json`), JSON.stringify(full.data, null, 1)); writeFileSync(join(dir, `${stamp}-prod.json`), JSON.stringify(prod.data, null, 1))
const m = (d) => d.metadata?.vulnerabilities ?? {}
const names = (d) => Object.entries(d.vulnerabilities ?? {}).map(([n, v]) => `${n}(${v.severity})`).join('، ') || 'لا شيء'
const f = m(full.data), p = m(prod.data)
const logFile = join(root, 'docs', 'phase5', 'AUDIT_LOG_AR.md')
mkdirSync(dirname(logFile), { recursive: true })
if (!existsSync(logFile)) writeFileSync(logFile, '# سجل npm audit بعد كل دفعة\n\n| الوقت | الدفعة | الكل: حرجة/عالية/متوسطة/منخفضة (المجموع) | الإنتاج فقط | المتبقي (الكل) | المتبقي (إنتاج) |\n|---|---|---|---|---|---|\n')
appendFileSync(logFile, `| ${new Date().toISOString()} | ${label} | ${f.critical ?? 0}/${f.high ?? 0}/${f.moderate ?? 0}/${f.low ?? 0} (${f.total ?? 0}) | ${p.total ?? 0} | ${names(full.data)} | ${names(prod.data)} |\n`)
console.log(`سُجّل: ${label} — الكل ${f.total ?? 0}، الإنتاج ${p.total ?? 0}`)
process.exit(0)
