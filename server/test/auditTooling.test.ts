// @vitest-environment node
// اختبار أدوات جمع الأدلة وتسجيل الدفعات بـ«npm» مزيَّف في PATH (سكربت Node + غلاف sh/cmd) يعيد JSON جاهزًا. لا شبكة ولا npm حقيقي.
// يثبت: الأوامر المستدعاة قراءة فقط، التعامل مع رمز خروج غير صفري، فشل جزئي لا يوقف الجمع، رفض الوسائط غير الآمنة، وكتابة السجل.
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { projectRoot } from './helpers/projectRoot'

const root = projectRoot()
const AUDIT = { vulnerabilities: { vitest: { name: 'vitest', severity: 'critical', isDirect: true, via: ['vite-node'], range: '<=2.1.9', nodes: ['node_modules/vitest'], fixAvailable: { name: 'vitest', version: '3.2.4', isSemVerMajor: true } }, esbuild: { name: 'esbuild', severity: 'moderate', via: [{ title: 'SYNTHETIC', url: 'https://example.invalid/1' }], range: '<=0.24', nodes: ['node_modules/esbuild'], fixAvailable: true } }, metadata: { vulnerabilities: { critical: 1, high: 0, moderate: 1, low: 0, total: 2 } } }
const PROD = { vulnerabilities: {}, metadata: { vulnerabilities: { critical: 0, high: 0, moderate: 0, low: 0, total: 0 } } }

function fakeNpmDir(opts: { failView?: string } = {}) {
  const d = mkdtempSync(join(tmpdir(), 'athar-fakenpm-'))
  const calls = join(d, 'calls.log')
  writeFileSync(join(d, 'fake-npm.js'), `
const fs = require('fs'); const a = process.argv.slice(2); fs.appendFileSync(${JSON.stringify(calls)}, a.join(' ') + '\\n')
const j = (o, code = 0) => { process.stdout.write(JSON.stringify(o)); process.exit(code) }
const s = a.join(' ')
if (s === '--version') { process.stdout.write('10.9.0\\n'); process.exit(0) }
if (s === 'audit --json') j(${JSON.stringify(AUDIT)}, 1)
if (s === 'audit --omit=dev --json') j(${JSON.stringify(PROD)}, 0)
if (s === 'audit fix --dry-run --json') j({ added: 0, removed: 0, changed: 3, audit: ${JSON.stringify(AUDIT)} }, 1)
if (s === 'outdated --json') j({ vite: { current: '5.4.21', wanted: '5.4.99', latest: '7.0.0' } }, 1)
if (s === 'ls --all --json') j({ name: 'athar-frontend', dependencies: {} }, 0)
let m = /^view (\\S+) dist-tags --json$/.exec(s); if (m) { if (${JSON.stringify(opts.failView ?? '')} === m[1]) { process.stderr.write('E404 not found'); process.exit(1) } j({ latest: '9.9.9' }) }
m = /^view (\\S+) versions --json$/.exec(s); if (m) j(['1.0.0', '9.9.9'])
m = /^view (\\S+)@(\\S+) version engines peerDependencies dependencies --json$/.exec(s); if (m) j({ version: m[2], engines: { node: '>=20' }, peerDependencies: { vite: '^5 || ^6' }, dependencies: {} })
process.stderr.write('unexpected: ' + s); process.exit(9)
`)
  writeFileSync(join(d, 'npm'), `#!/bin/sh\nexec node "${join(d, 'fake-npm.js')}" "$@"\n`); chmodSync(join(d, 'npm'), 0o755)
  writeFileSync(join(d, 'npm.cmd'), `@node "%~dp0fake-npm.js" %*\r\n`)
  return { d, calls, env: { ...process.env, PATH: d + delimiter + (process.env.PATH ?? '') } }
}
const run = (script: string, args: string[], env: NodeJS.ProcessEnv) => { try { return { code: 0, out: execFileSync(process.execPath, [join(root, 'scripts', script), ...args], { env, encoding: 'utf8' }) } } catch (e) { const x = e as { status: number; stdout: string; stderr: string }; return { code: x.status, out: x.stdout + x.stderr } } }

describe('جمع الأدلة (npm مزيَّف)', () => {
  it('يجمع audit وaudit --omit=dev وfix --dry-run وoutdated وls ولكل حزمة dist-tags/versions/مرشَّحات، ويكتب الملخص', () => {
    const f = fakeNpmDir(); const out = join(f.d, 'ev')
    const r = run('collect-audit-evidence.mjs', ['--out', out], f.env)
    expect(r.code).toBe(0)
    const ev = JSON.parse(readFileSync(join(out, 'evidence.json'), 'utf8'))
    expect(ev.meta.npm).toBe('10.9.0'); expect(ev.commands.audit.metadata.vulnerabilities.total).toBe(2)
    expect(ev.commands.auditProd.metadata.vulnerabilities.total).toBe(0); expect(ev.commands.fixDryRun.changed).toBe(3); expect(ev.commands.outdated.vite.latest).toBe('7.0.0')
    // المرشَّحات: إصدار fixAvailable (3.2.4) للحزمة المتأثرة + latest
    expect(Object.keys(ev.packages.vitest.candidates).sort()).toEqual(['3.2.4', '9.9.9']); expect(ev.packages.vitest.candidates['3.2.4'].peerDependencies.vite).toBe('^5 || ^6')
    expect(ev.packages.esbuild.versions).toEqual(['1.0.0', '9.9.9']); expect(ev.packages['react-router-dom'].distTags.latest).toBe('9.9.9')
    expect(readFileSync(join(out, 'evidence-summary.md'), 'utf8')).toContain('حرجة 1'); rmSync(f.d, { recursive: true, force: true })
  })
  it('كل الأوامر المستدعاة قراءة فقط: لا install ولا update ولا fix بلا --dry-run', () => {
    const f = fakeNpmDir(); run('collect-audit-evidence.mjs', ['--out', join(f.d, 'ev')], f.env)
    const lines = readFileSync(f.calls, 'utf8').trim().split('\n')
    expect(lines.length).toBeGreaterThan(20)
    for (const l of lines) { expect(l).toMatch(/^(--version|audit|view|outdated|ls)\b/); expect(l).not.toMatch(/\b(install|update|uninstall|dedupe|prune|ci)\b/); if (/\bfix\b/.test(l)) expect(l).toContain('--dry-run') }
    rmSync(f.d, { recursive: true, force: true })
  })
  it('فشل أمر واحد (404 لحزمة) لا يوقف الجمع، ويُسجَّل في log', () => {
    const f = fakeNpmDir({ failView: 'tailwindcss' }); const out = join(f.d, 'ev')
    expect(run('collect-audit-evidence.mjs', ['--out', out], f.env).code).toBe(0)
    const ev = JSON.parse(readFileSync(join(out, 'evidence.json'), 'utf8'))
    expect(ev.packages.tailwindcss.distTags).toBeNull(); expect(ev.log.some((l: { ok: boolean; step: string }) => !l.ok && l.step.includes('tailwindcss'))).toBe(true)
    expect(ev.packages.vite.distTags.latest).toBe('9.9.9'); rmSync(f.d, { recursive: true, force: true })
  })
  it('npm غير موجود/يفشل كليًا ⇒ لا انهيار، والملخص يذكر الفشل', () => {
    const d = mkdtempSync(join(tmpdir(), 'athar-nonpm-')); writeFileSync(join(d, 'npm'), '#!/bin/sh\necho oops >&2\nexit 127\n'); chmodSync(join(d, 'npm'), 0o755); writeFileSync(join(d, 'npm.cmd'), '@echo oops 1>&2\r\n@exit /b 127\r\n')
    const out = join(d, 'ev'); const r = run('collect-audit-evidence.mjs', ['--out', out], { ...process.env, PATH: d + delimiter + (process.env.PATH ?? '') })
    expect(r.code).toBe(0); expect(readFileSync(join(out, 'evidence-summary.md'), 'utf8')).toContain('أوامر فشلت'); rmSync(d, { recursive: true, force: true })
  })
})

describe('الملف المستقل لجمع الأدلة', () => {
  it('يعمل من جذر أي مشروع بلا استيرادات، ويعطي نفس بنية الناتج، ويخرج 2 بلا package.json', () => {
    const f = fakeNpmDir(); const proj = join(f.d, 'proj'); mkdirSync(proj); writeFileSync(join(proj, 'package.json'), JSON.stringify({ name: 'athar-frontend', version: '9.9.9' }))
    const standalone = readFileSync(join(root, 'scripts', 'collect-audit-evidence.standalone.mjs'), 'utf8')
    expect(standalone).not.toMatch(/from '\.\.?\//) // لا استيراد نسبي: ملف مستقل فعلًا
    const exec = (cwd: string) => { try { return { code: 0, out: execFileSync(process.execPath, [join(root, 'scripts', 'collect-audit-evidence.standalone.mjs')], { cwd, env: f.env, encoding: 'utf8' }) } } catch (e) { const x = e as { status: number; stdout: string; stderr: string }; return { code: x.status, out: x.stdout + x.stderr } } }
    expect(exec(proj).code).toBe(0)
    const ev = JSON.parse(readFileSync(join(proj, 'audit-evidence', 'evidence.json'), 'utf8'))
    expect(ev.meta.appVersion).toBe('9.9.9'); expect(ev.commands.audit.metadata.vulnerabilities.total).toBe(2); expect(Object.keys(ev.packages.vitest.candidates).sort()).toEqual(['3.2.4', '9.9.9'])
    const lines = readFileSync(f.calls, 'utf8').trim().split('\n')
    for (const l of lines) { expect(l).toMatch(/^(--version|audit|view|outdated|ls)\b/); expect(l).not.toMatch(/\b(install|update|uninstall|dedupe|prune|ci)\b/) }
    // حرّاس الأمان في الملف المستقل مطابقة نصيًا لـlib/npm.mjs (منع الانحراف)
    const lib = readFileSync(join(root, 'scripts', 'lib', 'npm.mjs'), 'utf8')
    for (const needle of ["const SAFE_ARG = /^[@A-Za-z0-9._/=-]+$/", "const READ_ONLY = new Set(['audit', 'view', 'ls', 'outdated', '--version'])", "args[0] === 'audit' && args.includes('fix') && !args.includes('--dry-run')"]) { expect(lib).toContain(needle); expect(standalone).toContain(needle) }
    const empty = join(f.d, 'empty'); mkdirSync(empty); const r = exec(empty); expect(r.code).toBe(2); expect(r.out).toContain('package.json')
    rmSync(f.d, { recursive: true, force: true })
  })
})

describe('تسجيل الدفعة', () => {
  it('يكتب ملفي JSON ويضيف سطرًا بالأعداد والمتبقي (الكل والإنتاج) في مجلد جذر مؤقت', () => {
    const f = fakeNpmDir(); const tmpRoot = join(f.d, 'proj'); mkdirSync(tmpRoot)
    const r = run('record-audit-batch.mjs', ['الدفعة 1: اختبار', '--root', tmpRoot], f.env)
    expect(r.code).toBe(0); expect(r.out).toContain('الكل 2')
    const log = readFileSync(join(tmpRoot, 'docs', 'phase5', 'AUDIT_LOG_AR.md'), 'utf8')
    expect(log).toContain('الدفعة 1: اختبار'); expect(log).toContain('1/0/1/0 (2)'); expect(log).toContain('vitest(critical)'); expect(log).toContain('لا شيء')
    expect(existsSync(join(tmpRoot, 'audit-log'))).toBe(true)
    expect(run('record-audit-batch.mjs', ['الدفعة 2', '--root', tmpRoot], f.env).code).toBe(0)
    expect(readFileSync(join(tmpRoot, 'docs', 'phase5', 'AUDIT_LOG_AR.md'), 'utf8').split('\n').filter((l) => l.startsWith('| 20')).length).toBe(2)
    rmSync(f.d, { recursive: true, force: true })
  })
  it('بلا وصف ⇒ رمز 2؛ وفشل npm ⇒ رمز 1 دون كتابة سطر', () => {
    const f = fakeNpmDir(); expect(run('record-audit-batch.mjs', [], f.env).code).toBe(2)
    const d = mkdtempSync(join(tmpdir(), 'athar-nonpm2-')); writeFileSync(join(d, 'npm'), '#!/bin/sh\nexit 1\n'); chmodSync(join(d, 'npm'), 0o755); writeFileSync(join(d, 'npm.cmd'), '@exit /b 1\r\n')
    const tr = join(d, 'p'); mkdirSync(tr); const r = run('record-audit-batch.mjs', ['x', '--root', tr], { ...process.env, PATH: d + delimiter + (process.env.PATH ?? '') })
    expect(r.code).toBe(1); expect(existsSync(join(tr, 'docs', 'phase5', 'AUDIT_LOG_AR.md'))).toBe(false)
    rmSync(f.d, { recursive: true, force: true }); rmSync(d, { recursive: true, force: true })
  })
})

describe('وسائط npm الآمنة (lib/npm.mjs)', () => {
  it('يرفض الأوامر غير القرائية والوسائط المحقونة وaudit fix بلا --dry-run', async () => {
    const { runNpm } = await import(join(root, 'scripts', 'lib', 'npm.mjs').replace(/\\/g, '/').replace(/^([A-Za-z]):/, 'file:///$1:').replace(/^\//, 'file:///'))
    for (const bad of [['install', 'x'], ['update'], ['ci'], ['audit', 'fix'], ['audit', 'fix', '--force'], ['view', 'x;rm -rf /'], ['view', 'a b'], ['view', '$(id)'], ['view', 'x|y'], ['view', 'x@^5']]) expect(() => runNpm(bad)).toThrow()
  })
})
