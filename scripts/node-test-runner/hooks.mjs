// محمِّل مساعد (اختياري) لتشغيل اختبارات المنطق النقي بـNode فقط عند تعذّر تثبيت vitest.
// لا يستبدل vitest ولا يُثبَّت منه شيء: يحوّل استيراد 'vitest' إلى shim صغير ويحلّ الاستيرادات النسبية بلا امتداد إلى .ts.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve as pathResolve } from 'node:path'

const shim = pathToFileURL(pathResolve(dirname(fileURLToPath(import.meta.url)), 'vitest-shim.mjs')).href

export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith('?raw') && context.parentURL) { // استيراد Vite ‏?raw ⇒ نص الملف (r41: يلزم لسلسلة staffApi→yearArchive/build)
    const f = pathResolve(dirname(fileURLToPath(context.parentURL)), specifier.slice(0, -4))
    return { url: pathToFileURL(f).href + '?raw', shortCircuit: true }
  }
  if (specifier === 'vitest') return { url: shim, shortCircuit: true }
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL) {
    const base = pathResolve(dirname(fileURLToPath(context.parentURL)), specifier)
    for (const cand of [base + '.ts', pathResolve(base, 'index.ts')]) {
      if (existsSync(cand) && statSync(cand).isFile()) return { url: pathToFileURL(cand).href, shortCircuit: true }
    }
  }
  return nextResolve(specifier, context)
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('?raw')) return { format: 'module', shortCircuit: true, source: `export default ${JSON.stringify(readFileSync(fileURLToPath(url.slice(0, -4)), 'utf8'))}` }
  return nextLoad(url, context)
}
