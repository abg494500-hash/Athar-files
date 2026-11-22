// يلخّص تقرير npm audit بالعربية دون تطبيق أي إصلاح. الخطوات:
//   npm audit --json > audit.json
//   npm audit --omit=dev --json > audit-prod.json        (اختياري: الإنتاج فقط)
//   node --experimental-strip-types --no-warnings scripts/summarize-npm-audit.mjs audit.json
// يقرأ package-lock.json من مجلد المشروع. يخرج بالرمز 1 إن وُجدت ثغرة عالية/حرجة في الإنتاج.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const file = process.argv[2]
if (!file) { console.error('الاستعمال: node --experimental-strip-types scripts/summarize-npm-audit.mjs audit.json'); process.exit(2) }
const { summarize, renderArabic } = await import(pathToFileURL(resolve(root, 'server/tools/auditSummary.ts')).href)
const report = JSON.parse(readFileSync(resolve(file), 'utf8'))
const lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'))
const s = summarize(report, lock)
process.stdout.write(renderArabic(s))
process.exit(s.prodHighOrCritical > 0 ? 1 : 0)
