// يبني نسخة الأرشيف (قراءة فقط) إلى public/archive-app ثم يكتب index.html وmanifest.json (بصمات) لها. يُشغَّل قبل بناء المنصة.
import { build } from 'vite'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const out = 'public/archive-app'
await build({ configFile: 'vite.archive.config.ts', logLevel: 'warn' })
const files = readdirSync(out).filter((f) => statSync(join(out, f)).isFile())
if (!files.includes('app.js') || !files.includes('app.css')) throw new Error(`مخرجات ناقصة: ${files.join(',')}`)
const html = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="robots" content="noindex" />
<title>أرشيف أثَر — للقراءة فقط</title>
<link rel="stylesheet" href="app.css" />
</head>
<body>
<div id="root"></div>
<noscript>يلزم تفعيل JavaScript في المتصفح لعرض الأرشيف.</noscript>
<script src="data.js"></script>
<script src="app.js"></script>
</body>
</html>
`
writeFileSync(join(out, 'index.html'), html)
const names = ['index.html', 'app.js', 'app.css']
const manifest = { files: names.map((n) => { const b = readFileSync(join(out, n)); return { name: n, size: b.length, sha256: createHash('sha256').update(b).digest('hex') } }) }
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 1))
for (const f of readdirSync(out)) if (!['index.html', 'app.js', 'app.css', 'manifest.json'].includes(f)) throw new Error(`ملف غير متوقع في المخرجات: ${f}`)
console.log('archive-app:', manifest.files.map((f) => `${f.name} ${f.size}`).join(' · '))
