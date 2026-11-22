// يضمن ألا تعود إخفاقات «عالم مختلف» (realm): كل اختبار في server/test يعمل في بيئة Node (لا jsdom)، وملف الإعداد لا يفترض وجود window.
// السبب (r23): في بيئة jsdom يختلف `Uint8Array`/`URL` العامان عن عالم Buffer وTextEncoder وfileURLToPath، فتفشل فحوص `instanceof` ورسالتها مضلِّلة.
// الاستعمال: node scripts/check-test-environments.mjs
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const res = []
const check = (name, ok, detail = '') => res.push({ name, ok, detail })

const dir = join(root, 'server', 'test')
const tests = readdirSync(dir).filter((n) => n.endsWith('.test.ts'))
const missing = tests.filter((n) => !/^\/\/ @vitest-environment node\r?\n/.test(readFileSync(join(dir, n), 'utf8')))
check(`كل اختبارات server/test (${tests.length}) تبدأ بـ«// @vitest-environment node»`, tests.length > 0 && missing.length === 0, missing.join(', '))

const setup = readFileSync(join(root, 'src', 'test', 'setup.ts'), 'utf8')
check('setup.ts لا يلمس window/DOM إلا داخل شرط typeof window', /if \(typeof window !== 'undefined'\)/.test(setup) && !/^window\./m.test(setup) && !/^import .*testing-library/m.test(setup), '')

const cfg = readFileSync(join(root, 'vite.config.ts'), 'utf8')
check("vite.config: البيئة الافتراضية jsdom لاختبارات الواجهة (ولا تُغيَّر لـserver إلا بالوسم)", /environment:\s*'jsdom'/.test(cfg), '')

const helpers = existsSync(join(dir, 'helpers')) ? readdirSync(join(dir, 'helpers')).filter((n) => n.endsWith('.ts')) : []
const urlUse = [...tests.map((n) => join(dir, n)), ...helpers.map((n) => join(dir, 'helpers', n))].filter((f) => /import\.meta\.url|fileURLToPath|new URL\(['"`]\.\.?\//.test(readFileSync(f, 'utf8').replace(/^\s*\/\/[^\n]*$/gm, '')))
check('اختبارات server لا تستعمل import.meta.url/fileURLToPath (تختلف على Windows)؛ الجذر من helpers/projectRoot', urlUse.length === 0, urlUse.map((f) => f.replace(root, '')).join(', '))

let failed = 0
for (const r of res) { if (!r.ok) failed++; console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok || !r.detail ? '' : `  ← ${r.detail}`}`) }
console.log(`\n${res.length - failed}/${res.length} ناجح`)
process.exit(failed ? 1 : 0)
