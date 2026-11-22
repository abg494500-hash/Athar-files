import { describe, expect, it } from 'vitest'

// نقرأ نصوص المصدر عبر Vite (دون أنواع Node) لفحص حدود الاستيراد.
const files = import.meta.glob('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const rel = (p: string) => p.replace(/^\/src\//, '')

describe('حدود طبقة البيانات (4.3)', () => {
  it('الفحص يرى ملفات المصدر فعلًا', () => {
    expect(Object.keys(files).length).toBeGreaterThan(40)
    expect(Object.keys(files)).toContain('/src/data/store.tsx')
  })
  it('المصدر الوهمي للاختبارات فقط (src/test/mock)', () => {
    expect(Object.keys(files)).not.toContain('/src/data/seed.ts')
    expect(Object.keys(files).filter((p) => p.startsWith('/src/data/mock/'))).toEqual([])
    expect(Object.keys(files)).toContain('/src/test/mock/seed.ts')
  })
  it('لا تستورد الصفحات والمكوّنات والمكتبات المصدر الوهمي ولا البذرة', () => {
    const allowed = (r: string) => r === 'data/provider.ts' || r.startsWith('test/')
    const bad = Object.entries(files)
      .filter(([p]) => !allowed(rel(p)))
      .filter(([, t]) => /from\s+['"][^'"]*(\/seed|\/mock)(\/[^'"]*)?['"]/.test(t) || /\b(MOCK_NOW|fakeHash)\b/.test(t))
      .map(([p]) => rel(p))
    expect(bad).toEqual([])
  })
  it('store.tsx لا يعرف المصدر الوهمي ولا البذرة؛ الواجهة تتعامل مع العقد فقط', () => {
    expect(files['/src/data/store.tsx']).not.toMatch(/mock|seed/i)
  })
})

describe('المرحلة 3: مصدر حقيقي بلا رجوع إلى الوهمي', () => {
  it('provider.ts لا يذكر المصدر الوهمي', () => {
    expect(files['/src/data/provider.ts']).not.toMatch(/mock|seed/i)
  })
  it('لا منطق دخول وهمي بالبادئة في Login', () => {
    expect(files['/src/pages/auth/Login.tsx']).not.toMatch(/startsWith\(\s*['"]director/)
  })
  it('supabase-js يُستورد من ملف واحد فقط', () => {
    const importers = Object.entries(files).filter(([, t]) => /from\s+['"]@supabase\/supabase-js['"]/.test(t)).map(([p]) => rel(p))
    expect(importers).toEqual(['lib/supabase/client.ts'])
  })
  it('المصدر الوهمي لا يُستورد ثابتًا من main.tsx', () => {
    expect(files['/src/main.tsx']).not.toMatch(/^import .*mock/m)
  })
})
