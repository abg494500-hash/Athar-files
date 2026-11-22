// حالة التسليم من المواعيد (نفس قواعد src/lib/status.ts والمحاكي الوهمي): نقي بلا قاعدة.
// خانة بلا أي إصدار سابق = تسليم جديد: قبل نهاية يوم الموعد الأساسي on_time، حتى نهاية المتأخر late، بعدها مغلق.
// خانة لها إصدار = استبدال: مسموح حتى نهاية يوم موعد الاستبدال، وحالته حالة أول إصدار (الخيار A في C-09).
import { endOfDay } from '../../src/lib/status'

export interface TermDates {
  base: string
  late: string
  replace: string
}

export type Gate = 'on_time' | 'late' | 'closed'

/** firstStatus = حالة أول إصدار في الخانة، أو null إن لم يوجد إصدار. */
export function submissionGate(nowMs: number, d: TermDates, firstStatus: 'on_time' | 'late' | null): Gate {
  if (firstStatus !== null) return nowMs <= endOfDay(d.replace) ? firstStatus : 'closed'
  if (nowMs <= endOfDay(d.base)) return 'on_time'
  if (nowMs <= endOfDay(d.late)) return 'late'
  return 'closed'
}
