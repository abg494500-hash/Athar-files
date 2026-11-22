// @vitest-environment node
// اختبار ملخّص npm audit على تقرير **تركيبي** (مصنوع يدويًا بشكل npm v2، ليس ثغرات حقيقية ولا من تقريركِ).
import { describe, it, expect } from 'vitest'
import { renderArabic, summarize } from '../tools/auditSummary'
import type { AuditReport, LockFile } from '../tools/auditSummary'

const lock: LockFile = { packages: {
  'node_modules/react-router': { version: '6.30.6' }, 'node_modules/react-router-dom': { version: '6.30.6' },
  'node_modules/vite': { version: '5.4.21', dev: true }, 'node_modules/esbuild': { version: '0.21.5', dev: true },
  'node_modules/shared-x': { version: '1.0.0' }, 'node_modules/mixed-y': { version: '2.0.0', dev: true }, 'node_modules/mixed-y/node_modules/inner': { version: '3.0.0' },
} }
const report: AuditReport = { vulnerabilities: {
  'react-router': { name: 'react-router', severity: 'moderate', isDirect: false, via: [{ source: 1, name: 'react-router', title: 'SYNTHETIC open redirect', url: 'https://example.invalid/adv/1', severity: 'moderate', range: '<6.99' }], effects: ['react-router-dom'], range: '<6.99', nodes: ['node_modules/react-router'], fixAvailable: { name: 'react-router-dom', version: '7.0.0', isSemVerMajor: true } },
  'react-router-dom': { name: 'react-router-dom', severity: 'moderate', isDirect: true, via: ['react-router'], range: '*', nodes: ['node_modules/react-router-dom'], fixAvailable: { name: 'react-router-dom', version: '7.0.0', isSemVerMajor: true } },
  vite: { name: 'vite', severity: 'high', isDirect: true, via: ['esbuild'], range: '<5.5', nodes: ['node_modules/vite'], fixAvailable: { name: 'vite', version: '5.4.99', isSemVerMajor: false } },
  esbuild: { name: 'esbuild', severity: 'critical', isDirect: false, via: [{ title: 'SYNTHETIC dev server request', url: 'https://example.invalid/adv/2' }], range: '<=0.99', nodes: ['node_modules/esbuild'], fixAvailable: true },
  'shared-x': { name: 'shared-x', severity: 'high', isDirect: true, via: [{ title: 'SYNTHETIC prod high', url: 'https://example.invalid/adv/3' }], range: '*', nodes: ['node_modules/shared-x'], fixAvailable: false },
  'mixed-y': { name: 'mixed-y', severity: 'low', isDirect: false, via: ['inner'], range: '*', nodes: ['node_modules/mixed-y', 'node_modules/mixed-y/node_modules/inner'] },
  ghost: { name: 'ghost', severity: 'weird', via: [] },
} }

describe('ملخّص npm audit (تقرير تركيبي)', () => {
  const s = summarize(report, lock)
  it('يصنّف الإنتاج/التطوير من package-lock (ومنها العقد المتعددة) ويعدّ الخطورة', () => {
    const by = Object.fromEntries(s.rows.map((r) => [r.name, r]))
    expect([by['react-router']!.scope, by['vite']!.scope, by['esbuild']!.scope, by['shared-x']!.scope, by['ghost']!.scope]).toEqual(['prod', 'dev', 'dev', 'prod', 'unknown'])
    expect(by['mixed-y']!.scope).toBe('prod') // عقدة متداخلة غير مصنّفة dev ⇒ إنتاج (حذر)
    expect(s.totals).toEqual({ critical: 1, high: 2, moderate: 2, low: 1, info: 0, unknown: 1 })
    expect([s.prod, s.dev, s.prodHighOrCritical, s.breakingFixes]).toEqual([4, 2, 1, 2])
  })
  it('الترتيب: الأخطر أولًا ثم الإنتاج قبل التطوير', () => {
    expect(s.rows.map((r) => r.name).slice(0, 3)).toEqual(['esbuild', 'shared-x', 'vite'])
  })
  it('كاسر/غير كاسر/لا إصلاح/غير معروف', () => {
    const by = Object.fromEntries(s.rows.map((r) => [r.name, r]))
    expect([by['react-router']!.fix, by['vite']!.fix, by['esbuild']!.fix, by['shared-x']!.fix, by['mixed-y']!.fix]).toEqual(['breaking', 'non-breaking', 'non-breaking', 'none', 'unknown'])
    expect(by['react-router']!.fixTo).toBe('react-router-dom@7.0.0')
  })
  it('النص العربي يحذّر من --force ويفصل الإنتاج عن التطوير ولا يطبّق شيئًا', () => {
    const t = renderArabic(s)
    expect(t).toContain('npm audit fix --force'); expect(t).toContain('لا يُستعمل')
    expect(t).toContain('عاجل: في الحزمة المنشورة؛ لا نشر قبل المعالجة')
    expect(t).toContain('أداة تطوير/بناء/اختبار لا تُشحن للمتصفح')
    expect(t).toContain('تحديث رئيسي كاسر'); expect(t).toContain('https://example.invalid/adv/3')
  })
  it('مسارات الاعتماد تظهر في الملخص؛ والأمر المقترح: مباشرة ⇒ npm install محدد، متعدّية ⇒ audit fix --dry-run، كاسر ⇒ لا أمر', () => {
    const by = Object.fromEntries(s.rows.map((r) => [r.name, r]))
    expect(by['vite']!.suggestedCommand).toBe('npm install vite@5.4.99')
    expect(by['esbuild']!.suggestedCommand).toBe('npm audit fix --dry-run')
    expect(by['react-router']!.suggestedCommand).toBeNull(); expect(by['shared-x']!.suggestedCommand).toBeNull()
    const t = renderArabic(s)
    expect(t).toContain('مسارات الاعتماد'); expect(t).toContain('npm install vite@5.4.99'); expect(t).toContain('بلا --force')
    expect(t).not.toMatch(/npm install esbuild@/) // المتعدّية لا تُضاف إلى package.json
  })
  it('تقرير فارغ أو بلا حقول ⇒ ملخص صفري دون أخطاء', () => {
    expect(summarize({}, {}).rows).toEqual([]); expect(summarize({ vulnerabilities: {} }, { packages: {} }).prodHighOrCritical).toBe(0)
  })
})
