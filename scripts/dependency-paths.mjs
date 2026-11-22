// مسارات الاعتماد لحزم محددة من package-lock.json (بلا npm ولا شبكة).
// الاستعمال: node --experimental-strip-types --no-warnings scripts/dependency-paths.mjs esbuild vite react-router
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const names = process.argv.slice(2)
if (names.length === 0) { console.error('الاستعمال: node --experimental-strip-types --no-warnings scripts/dependency-paths.mjs <حزمة> [<حزمة> ...]'); process.exit(2) }
const { explain, renderPaths } = await import(pathToFileURL(resolve(root, 'server/tools/depPaths.ts')).href)
const lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'))
for (const n of names) process.stdout.write(renderPaths(n, explain(lock, n)))
