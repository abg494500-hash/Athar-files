// يُشغَّل بعد `npm run build`: يتأكد أن ملفات dist لا تحوي البيانات الوهمية ولا مفاتيح سرية. تشغيل: node scripts/check-dist-no-mock.mjs
import { existsSync, readdirSync, readFileSync } from 'node:fs'

if (!existsSync('dist')) { console.error('لا يوجد مجلد dist. شغّلي npm run build أولًا.'); process.exit(2) }
const out = []
const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = `${d}/${e.name}`; e.isDirectory() ? walk(p) : out.push(p) } }
walk('dist')
const js = out.filter((p) => /\.(js|html|css|map)$/.test(p))
// علامات من seed.ts (أسماء معلمات توضيحية) وعبارة المصدر الوهمي.
const seedSrc = readFileSync('src/test/mock/seed.ts', 'utf8')
const names = [...seedSrc.matchAll(/\['([^']{6,40})',\s*'[^']+'\]/g)].map((m) => m[1]).slice(0, 5)
const markers = [...names, 'createMockRepository']
const bad = []
for (const p of js) {
  const t = readFileSync(p, 'utf8')
  for (const m of markers) if (t.includes(m)) bad.push(`${p}: ${m}`)
  if (/service_role/.test(t) && !/مفتاح service_role/.test(t)) bad.push(`${p}: service_role`)
  if (/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/.test(t)) bad.push(`${p}: مفتاح JWT خام`)
}
if (bad.length) { console.error('فشل:\n' + bad.join('\n')); process.exit(1) }
console.log(`نجح: ${js.length} ملفًا في dist بلا بيانات وهمية ولا مفاتيح.`)
