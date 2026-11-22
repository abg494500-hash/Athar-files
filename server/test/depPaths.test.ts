// @vitest-environment node
// اختبار مسارات الاعتماد: قفل تركيبي صغير بكل الحالات (مباشرة/متعدّية/نسخ متعددة/تطوير فقط/مجموعة نطاق @)، ثم حقائق ثابتة من package-lock.json الحقيقي.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { explain, renderPaths, resolveDep } from '../tools/depPaths'
import type { Lock } from '../tools/depPaths'
import { projectRoot } from './helpers/projectRoot'

const lock: Lock = { packages: {
  '': { version: '1.0.0', dependencies: { app: '^1.0.0', '@sc/pkg': '^2.0.0', leaf2: '*' }, devDependencies: { tool: '^3.0.0' } },
  'node_modules/app': { version: '1.2.0', dependencies: { shared: '^1.0.0', deep: '^1.0.0' } },
  'node_modules/shared': { version: '1.5.0' },
  'node_modules/deep': { version: '1.0.0', dependencies: { shared: '^2.0.0' } },
  'node_modules/deep/node_modules/shared': { version: '2.1.0' },
  'node_modules/@sc/pkg': { version: '2.0.3', dependencies: { leaf: '*' } },
  'node_modules/leaf': { version: '0.1.0' },
  'node_modules/tool': { version: '3.1.0', dev: true, dependencies: { devleaf: '*' } },
  'node_modules/devleaf': { version: '9.9.9', dev: true },
  'node_modules/orphan': { version: '0.0.1' },
  // devDependencies لاعتمادية (غير الجذر) لا تُثبَّت في npm: لا يجوز أن تُعدّ مسارًا
  'node_modules/leaf2': { version: '1.0.0', devDependencies: { notinstalled: '*' } },
  'node_modules/notinstalled': { version: '5.0.0' },
} }

describe('مسارات الاعتماد', () => {
  it('حلّ الاعتمادية: النسخة المتداخلة أولًا ثم الأعلى', () => {
    expect(resolveDep(lock.packages!, 'node_modules/deep', 'shared')).toBe('node_modules/deep/node_modules/shared')
    expect(resolveDep(lock.packages!, 'node_modules/app', 'shared')).toBe('node_modules/shared')
    expect(resolveDep(lock.packages!, 'node_modules/app', 'nope')).toBeNull()
  })
  it('حزمة بنسختين: كل نسخة بمسارها وإصدارها', () => {
    const r = explain(lock, 'shared')
    // الترتيب حتمي بحسب موضع الحزمة (المتداخلة أولًا أبجديًا)
    expect(r.map((i) => [i.version, i.path.join(' ← ')])).toEqual([['2.1.0', 'المشروع ← app@1.2.0 ← deep@1.0.0 ← shared@2.1.0'], ['1.5.0', 'المشروع ← app@1.2.0 ← shared@1.5.0']])
    expect(r.every((i) => !i.direct && i.scope === 'prod')).toBe(true)
    expect(r[0]!.dependents[0]).toEqual({ name: 'deep', version: '1.0.0', range: '^2.0.0', kind: 'dependencies' })
  })
  it('مباشرة بنطاقها، وتطوير فقط، ومتعدّية من تطوير، ونطاق @', () => {
    const app = explain(lock, 'app')[0]!; expect([app.direct, app.rootRange, app.scope]).toEqual([true, '^1.0.0', 'prod'])
    const tool = explain(lock, 'tool')[0]!; expect([tool.direct, tool.scope, tool.rootRange]).toEqual([true, 'dev', '^3.0.0'])
    const dl = explain(lock, 'devleaf')[0]!; expect([dl.direct, dl.scope, dl.path.join(' ← ')]).toEqual([false, 'dev', 'المشروع ← tool@3.1.0 ← devleaf@9.9.9'])
    const sc = explain(lock, '@sc/pkg')[0]!; expect([sc.direct, sc.version]).toEqual([true, '2.0.3'])
    expect(explain(lock, 'leaf')[0]!.path.join(' ← ')).toBe('المشروع ← @sc/pkg@2.0.3 ← leaf@0.1.0')
  })
  it('devDependencies لغير الجذر لا تُنشئ مسارًا', () => {
    expect(explain(lock, 'notinstalled')[0]!.path[0]).toContain('غير موصول')
  })
  it('حزمة يتيمة (لا أحد يطلبها) تُعلَّم غير موصولة؛ وغير الموجودة تُعيد قائمة فارغة', () => {
    expect(explain(lock, 'orphan')[0]!.path[0]).toContain('غير موصول')
    expect(explain(lock, 'ghost')).toEqual([]); expect(renderPaths('ghost', [])).toContain('غير مثبَّتة')
  })
  it('عرض عربي يذكر النطاق والمسار ومن يطلب', () => {
    const t = renderPaths('app', explain(lock, 'app'))
    expect(t).toContain('app@1.2.0'); expect(t).toContain('مباشرة في package.json'); expect(t).toContain('المسار: المشروع ← app@1.2.0')
  })
  it('حقائق من package-lock.json الحقيقي: react-router-dom مباشرة وإنتاج؛ vite مباشرة وتطوير؛ react-router متعدّية وإنتاج عبر react-router-dom', () => {
    const real = JSON.parse(readFileSync(join(projectRoot(), 'package-lock.json'), 'utf8')) as Lock
    const rd = explain(real, 'react-router-dom')[0]!; expect([rd.direct, rd.scope]).toEqual([true, 'prod'])
    const vt = explain(real, 'vite')[0]!; expect([vt.direct, vt.scope]).toEqual([true, 'dev'])
    const rr = explain(real, 'react-router')[0]!; expect([rr.direct, rr.scope]).toEqual([false, 'prod']); expect(rr.path.join(' ← ')).toContain('react-router-dom@')
  })
})
