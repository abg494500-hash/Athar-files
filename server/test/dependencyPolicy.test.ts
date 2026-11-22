// @vitest-environment node
// اختبار حارس سياسة الاعتماديات على مشاريع تركيبية في مجلد مؤقت (لا يمسّ package.json ولا القفل الحقيقيين).
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { projectRoot } from './helpers/projectRoot'

const script = join(projectRoot(), 'scripts', 'check-dependency-policy.mjs')
const mkLock = (over: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
  lockfileVersion: 3,
  packages: {
    '': { name: 'x', version: '1.0.0', dependencies: { 'react-router-dom': '^6.30.0' }, devDependencies: { vite: '^5.4.0' } },
    'node_modules/react-router-dom': { version: '6.30.6', resolved: 'https://registry.npmjs.org/react-router-dom/-/react-router-dom-6.30.6.tgz', integrity: 'sha512-AAAA' },
    'node_modules/vite': { version: '5.4.21', dev: true, resolved: 'https://registry.npmjs.org/vite/-/vite-5.4.21.tgz', integrity: 'sha512-BBBB', ...over },
    ...extra,
  },
})
function project(lock: unknown, pkg: Record<string, unknown> = { name: 'x', version: '1.0.0', dependencies: { 'react-router-dom': '^6.30.0' }, devDependencies: { vite: '^5.4.0' } }, withBaseline = true) {
  const d = mkdtempSync(join(tmpdir(), 'athar-dep-'))
  mkdirSync(join(d, 'docs'))
  writeFileSync(join(d, 'package.json'), JSON.stringify(pkg)); writeFileSync(join(d, 'package-lock.json'), JSON.stringify(mkLock()))
  if (withBaseline) execFileSync(process.execPath, [script, '--root', d, '--write-baseline'])
  writeFileSync(join(d, 'package-lock.json'), JSON.stringify(lock)) // القفل المختبَر بعد كتابة الخط من القفل السليم
  return d
}
const run = (d: string, ...a: string[]) => { try { return { code: 0, out: execFileSync(process.execPath, [script, '--root', d, ...a], { encoding: 'utf8' }) } } catch (e) { const x = e as { status: number; stdout: string }; return { code: x.status, out: x.stdout } } }
const cleanup = (d: string) => rmSync(d, { recursive: true, force: true })

describe('حارس سياسة الاعتماديات', () => {
  it('مشروع سليم ⇒ ينجح (ويعرض حزم سكربت التثبيت للمراجعة فقط)', () => {
    const d = project(mkLock({}, { 'node_modules/esbuild': { version: '0.21.5', dev: true, hasInstallScript: true, resolved: 'https://registry.npmjs.org/esbuild/-/esbuild-0.21.5.tgz', integrity: 'sha512-CCCC' } })); const r = run(d)
    expect(r.code).toBe(0); expect(r.out).toContain('esbuild'); expect(r.out).toContain('INFO'); cleanup(d)
  })
  it('رفع major (vite 5 ← 6) يفشل، ويمرّ فقط مع --allow-major لتلك الحزمة وحدها', () => {
    const d = project(mkLock({ version: '6.0.1' }), { name: 'x', version: '1.0.0', dependencies: { 'react-router-dom': '^6.30.0' }, devDependencies: { vite: '^5.4.0' } })
    const a = run(d); expect(a.code).toBe(1); expect(a.out).toContain('vite: 5.4.21 ← 6.0.1')
    expect(run(d, '--allow-major=react-router-dom').code).toBe(1) // اسم آخر لا يكفي
    expect(run(d, '--allow-major=vite').code).toBe(0); cleanup(d)
  })
  it('حزمة اختفت من القفل (مثل vite-node مع vitest 4) تفشل إلا مع --allow-major لها', () => {
    const withNode = mkLock({}, { 'node_modules/vite-node': { version: '2.1.9', dev: true, resolved: 'https://registry.npmjs.org/vite-node/-/vite-node-2.1.9.tgz', integrity: 'sha512-EEEE' } })
    const d = project(withNode)
    execFileSync(process.execPath, [script, '--root', d, '--write-baseline']) // خط الأساس يضم vite-node
    writeFileSync(join(d, 'package-lock.json'), JSON.stringify(mkLock())) // الآن بلا vite-node
    const a = run(d); expect(a.code).toBe(1); expect(a.out).toContain('vite-node'); expect(a.out).toContain('لم تعد مثبَّتة')
    expect(run(d, '--allow-major=vite-node').code).toBe(0); cleanup(d)
  })
  it('تغيّر النطاق في package.json بقفزة major يفشل', () => {
    const d = project(mkLock(), { name: 'x', version: '1.0.0', dependencies: { 'react-router-dom': '^6.30.0' }, devDependencies: { vite: '^5.4.0' } })
    writeFileSync(join(d, 'package.json'), JSON.stringify({ name: 'x', version: '1.0.0', dependencies: { 'react-router-dom': '^7.0.0' }, devDependencies: { vite: '^5.4.0' } }))
    const r = run(d); expect(r.code).toBe(1); expect(r.out).toMatch(/react-router-dom/); cleanup(d)
  })
  it('القفل غير متّسق مع package.json (اعتمادية مضافة بلا قفل) يفشل', () => {
    const d = project(mkLock(), { name: 'x', version: '1.0.0', dependencies: { 'react-router-dom': '^6.30.0' }, devDependencies: { vite: '^5.4.0', '@types/node': '^22.10.0' } })
    const r = run(d); expect(r.code).toBe(1); expect(r.out).toContain('متّسق'); expect(r.out).toContain('@types/node'); cleanup(d)
  })
  it('اعتمادية مباشرة جديدة (مثبَّتة) خارج خط الأساس تفشل', () => {
    const lock = mkLock({}, { 'node_modules/newpkg': { version: '1.0.0', resolved: 'https://registry.npmjs.org/newpkg/-/newpkg-1.0.0.tgz', integrity: 'sha512-DDDD' } }) as { packages: Record<string, { dependencies?: Record<string, string> }> }
    lock.packages['']!.dependencies = { 'react-router-dom': '^6.30.0', newpkg: '^1.0.0' }
    const d = project(lock, { name: 'x', version: '1.0.0', dependencies: { 'react-router-dom': '^6.30.0', newpkg: '^1.0.0' }, devDependencies: { vite: '^5.4.0' } })
    const r = run(d); expect(r.code).toBe(1); expect(r.out).toContain('newpkg'); cleanup(d)
  })
  it('مصدر غير رسمي أو بلا بصمة سلامة يفشل', () => {
    const d1 = project(mkLock({ resolved: 'https://evil.example/vite.tgz' })); const r1 = run(d1); expect(r1.code).toBe(1); expect(r1.out).toContain('evil.example'); cleanup(d1)
    const d2 = project(mkLock({ integrity: undefined })); const r2 = run(d2); expect(r2.code).toBe(1); expect(r2.out).toContain('integrity'); cleanup(d2)
    const d3 = project(mkLock({ resolved: 'git+ssh://git@github.com/x/vite.git' })); expect(run(d3).code).toBe(1); cleanup(d3)
  })
  it('overrides في package.json تُمنع حتى تُوثَّق؛ وغياب خط الأساس خطأ صريح (رمز 2)', () => {
    const d = project(mkLock(), { name: 'x', version: '1.0.0', dependencies: { 'react-router-dom': '^6.30.0' }, devDependencies: { vite: '^5.4.0' }, overrides: { esbuild: '0.25.0' } })
    expect(run(d).code).toBe(1); cleanup(d)
    const e = project(mkLock(), undefined, false); expect(run(e).code).toBe(2); cleanup(e)
  })
  it('نسخة من القفل الحقيقي: الحارس يعمل عليه دون تعطّل (النتيجة تُقرأ، لا تُفترض)', () => {
    const real = projectRoot(); const d = mkdtempSync(join(tmpdir(), 'athar-real-')); mkdirSync(join(d, 'docs'))
    for (const f of ['package.json', 'package-lock.json']) copyFileSync(join(real, f), join(d, f))
    execFileSync(process.execPath, [script, '--root', d, '--write-baseline'])
    const r = run(d); expect(r.out).toMatch(/\d+\/\d+ ناجح/); expect(readFileSync(join(d, 'docs', 'dependency-baseline.json'), 'utf8')).toContain('"react-router-dom"'); cleanup(d)
  })
})
