/**
 * حالة الصفحة. التحميل والخطأ الفعليان تعرضهما DataGate؛ فالصفحات تُعرض جاهزةً هنا دائمًا.
 * (كان هذا الملف يحمل شريط معاينة التصميم وتأخيرًا اصطناعيًا؛ حُذفا في النسخة النهائية.)
 */
export type PagePhase = 'loading' | 'error' | 'ready'
export function usePageState(_key: string): { phase: PagePhase; empty: boolean; retry: () => void } {
  return { phase: 'ready', empty: false, retry: () => {} }
}
