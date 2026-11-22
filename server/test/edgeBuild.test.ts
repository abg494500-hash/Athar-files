// @vitest-environment node
// يتحقق أن النسخة المولَّدة (Deno-جاهزة) تطابق المصدر **وتحوي ما نتوقعه فعلًا**، وأنها **تُحمَّل وتعمل** بالاستيراد الصريح .ts في عملية Node مستقلة
// (scripts/edge-smoke.mjs)، وأن نقطة الدخول Deno لا تحوي أسرارًا ولا تستعمل مفتاح الخدمة. لا يختبر Deno نفسه (غير متوفر).
// لا يستعمل import.meta.url ولا URL ولا fileURLToPath (سلوكها يختلف على Windows وفي بيئات اختبار تستبدل URL العام)؛ الجذر من projectRoot().
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { projectRoot } from './helpers/projectRoot'

const root = projectRoot()
const gen = join(root, 'supabase', 'functions', '_shared', 'athar')
const nodeSupportsStripTypes = (() => { const [maj, min] = process.versions.node.split('.').map(Number) as [number, number]; return maj > 22 || (maj === 22 && min >= 6) })()
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p] })

describe('نسخة Edge المولَّدة', () => {
  it('مطابقة للمصدر (--check)', () => {
    const out = execFileSync(process.execPath, [join(root, 'scripts', 'build-edge-function.mjs'), '--check'], { cwd: root, encoding: 'utf8' })
    expect(out).toContain('مطابق')
  })
  it('تحوي الملفات المتوقعة، كلها بامتداد .ts في الاستيراد النسبي، وبلا اعتماد خارج node:crypto/buffer/util', () => {
    for (const f of ['api/compose.ts', 'host/edge.ts', 'db/postgresDb.ts', 'db/bind.ts', 'auth/teacherAuth.ts']) expect(existsSync(join(gen, 'server', f))).toBe(true)
    const files = walk(gen).filter((f) => f.endsWith('.ts'))
    expect(files.length).toBeGreaterThan(30)
    const bareRelative: string[] = []; const externals = new Set<string>()
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      expect(src.startsWith('// مولَّد آليًا من ')).toBe(true)
      for (const m of src.matchAll(/(?:import|export)[^'"\n]*from\s+'([^']+)'/g)) {
        const spec = m[1] as string
        if (spec.startsWith('.')) { if (!spec.endsWith('.ts')) bareRelative.push(`${f}: ${spec}`) } else externals.add(spec)
      }
    }
    expect(bareRelative).toEqual([])
    expect([...externals].sort()).toEqual(['node:buffer', 'node:crypto'])
  })
  it('تُحمَّل وتعمل في عملية Node مستقلة: /health و401 لغير المصادَق عليه عبر المضيف والتركيب', () => {
    if (!nodeSupportsStripTypes) throw new Error(`يتطلب هذا الاختبار Node ≥ 22.6 (الحالي ${process.versions.node}) لتحميل ملفات .ts بلا مترجم؛ حدّثي Node.`)
    const out = execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', join(root, 'scripts', 'edge-smoke.mjs'), root], { cwd: root, encoding: 'utf8' })
    expect(JSON.parse(out.trim().split('\n').pop() as string)).toEqual({ health: 200, me: [401, { error: 'unauthenticated' }], owner: 401 })
  })
  it('نقطة دخول Deno: بلا أسرار، بلا مفتاح الخدمة، وتستعمل SUPABASE_DB_URL/ATHAR_DB_URL فقط', () => {
    const src = readFileSync(join(root, 'supabase', 'functions', 'api', 'index.ts'), 'utf8')
    const code = src.replace(/\/\/[^\n]*/g, '')
    expect(code).not.toMatch(/SERVICE_ROLE/)
    expect(code).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}|sb_secret_|postgres:\/\/|AKIA[A-Z0-9]{8,}/)
    expect(src).toMatch(/verify_jwt/) // موثَّق في الرأس
    expect(code).toMatch(/Deno\.env\.get\('SUPABASE_DB_URL'\)/)
    const deno = JSON.parse(readFileSync(join(root, 'supabase', 'functions', 'api', 'deno.json'), 'utf8')) as { imports: { postgres: string } }
    expect(deno.imports.postgres).toMatch(/^npm:postgres@3\.\d+\.\d+$/)
  })
})
