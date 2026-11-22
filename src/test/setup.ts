import { afterEach } from 'vitest'

// ملف الإعداد يُحمَّل لكل اختبار، ومنها اختبارات server التي تعمل في بيئة Node (// @vitest-environment node) بلا window.
// أدوات DOM تُحمَّل فقط حين توجد بيئة متصفح (jsdom)، فلا يفشل أي اختبار خادم عند الإعداد.
if (typeof window !== 'undefined') {
  await import('@testing-library/jest-dom/vitest')
  const { cleanup } = await import('@testing-library/react')
  afterEach(() => cleanup())
  // jsdom لا يوفر هذه الدوال
  window.scrollTo = () => {}
  if (!window.matchMedia) {
    window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as never
  }
}
