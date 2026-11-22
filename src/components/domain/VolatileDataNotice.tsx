import { Alert } from '../ui/misc'
import { useStore } from '../../data/store'
import { cn } from '../../lib/cn'

/**
 * تنبيه صريح للمستخدم حين يكون مصدر البيانات غير دائم (المصدر الوهمي):
 * ما يُدخَل أو يُعدَّل يبقى في ذاكرة الصفحة فقط وقد يضيع عند التحديث. يختفي تلقائيًا لمصدر دائم.
 */
export function VolatileDataNotice({ className }: { className?: string }) {
  const { source } = useStore()
  if (source.persistent) return null
  return (
    <Alert tone="info" className={cn('!p-3 text-sm', className)}>
      <span data-testid="volatile-notice">
        البيانات المعروضة مؤقتة: تُحفظ في ذاكرة هذه الصفحة فقط ولا تُرسل إلى أي خادم، وقد تضيع عند تحديث الصفحة أو إغلاقها.
      </span>
    </Alert>
  )
}
