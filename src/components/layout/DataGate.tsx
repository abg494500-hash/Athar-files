import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { CalendarPlus } from 'lucide-react'
import { useStore } from '../../data/store'
import { EmptyState, ErrorState, PageSkeleton } from '../ui/States'

/**
 * بوابة البيانات للواجهات المحمية: تحميل ← خطأ صريح مع إعادة محاولة ← فراغ مفهوم ← المحتوى.
 * لا تعرض بيانات وهمية أبدًا؛ فشل المصدر يظهر كما هو.
 */
export function DataGate({ children }: { children: ReactNode }) {
  const { load, reload, terms, session } = useStore()
  const { pathname } = useLocation()
  if (load.phase === 'idle' || load.phase === 'loading') return <PageSkeleton rows={4} />
  if (load.phase === 'error') return <ErrorState text={load.message} onRetry={() => { void reload() }} />
  // قاعدة بلا سنة/فصل بعد: الصفحات الأخرى تفترض وجود فصل، فنوجّه المالكة لإنشاء السنة الدراسية أولًا.
  if (terms.length === 0 && !/^\/(owner|director)\/years/.test(pathname)) {
    return (
      <EmptyState icon={CalendarPlus} title="لا توجد سنة دراسية بعد"
        text={session?.role === 'owner' || session?.role === 'director' ? 'ابدئي بإضافة السنة الدراسية الأولى ليظهر باقي المحتوى.' : 'لم تُهيّأ السنة الدراسية بعد. تواصلي مع مالكة المنصة.'}
        action={session?.role === 'owner' || session?.role === 'director' ? <Link to={`/${session.role}/years`} className="inline-flex h-11 items-center rounded-xl bg-steel-800 px-4 text-sm font-medium text-white">إضافة سنة دراسية</Link> : undefined} />
    )
  }
  return <>{children}</>
}
