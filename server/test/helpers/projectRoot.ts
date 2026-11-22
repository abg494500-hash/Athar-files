// جذر المشروع بلا import.meta.url ولا URL ولا fileURLToPath (تتصرف بشكل مختلف على Windows وفي بيئات اختبار تستبدل URL العام).
// يبدأ من مجلد التشغيل ويصعد حتى يجد package.json باسم «athar-frontend» وبجواره supabase/functions.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

export function projectRoot(): string {
  let dir = resolve(process.cwd())
  for (let i = 0; i < 8; i++) {
    const pkg = join(dir, 'package.json')
    if (existsSync(pkg) && existsSync(join(dir, 'supabase', 'functions'))) {
      try { if ((JSON.parse(readFileSync(pkg, 'utf8')) as { name?: string }).name === 'athar-frontend') return dir } catch { /* تجاهل ملف معيب */ }
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error('تعذّر تحديد جذر مشروع athar (package.json باسم athar-frontend). شغّلي الاختبارات من داخل مجلد المشروع (حيث package.json).')
}
