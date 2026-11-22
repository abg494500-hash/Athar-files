// مولَّد آليًا من src/lib/status.ts بواسطة scripts/build-edge-function.mjs — لا تعدّليه يدويًا.
import type { Deadlines, ItemStatus, Version } from '../data/types.ts'

/**
 * منطق الحالات والمواعيد معزول في هذا الملف عمدًا.
 * القواعد المذكورة هنا افتراضات للعرض فقط وليست قرارات معتمدة:
 *   C-08 (الحالة الإجمالية) · C-09 (أثر الاستبدال) · C-10 (تعريف نهاية اليوم) · C-11 (ترتيب المواعيد)
 * أي تغيير في القرار يُعدَّل هنا وحده دون المساس بالواجهات.
 */

/** نهاية يوم الموعد بتوقيت سلطنة عُمان (UTC+4). التعريف الدقيق ينتظر القرار C-10. */
export function endOfDay(day: string): number {
  return Date.parse(`${day}T23:59:59.999+04:00`)
}

export type Phase = 'before_base' | 'late_window' | 'closed'

export function phaseAt(now: number, d: Deadlines): Phase {
  if (now <= endOfDay(d.base)) return 'before_base'
  if (now <= endOfDay(d.late)) return 'late_window'
  return 'closed'
}

/** حالة التسليم لحظة وقوعه: تُخزَّن مع النسخة ولا تُعاد حسابها عند تعديل المواعيد. */
export function statusAtSubmission(submittedAt: number, d: Deadlines): ItemStatus | 'rejected' {
  if (submittedAt <= endOfDay(d.base)) return 'on_time'
  if (submittedAt <= endOfDay(d.late)) return 'late'
  return 'rejected'
}

/** حالة العنصر = حالة أول تسليم (الخيار A في C-09). */
export function itemStatus(versions: Version[]): ItemStatus {
  if (versions.length === 0) return 'missing'
  return [...versions].sort((a, b) => Date.parse(a.submittedAt) - Date.parse(b.submittedAt))[0].status
}

/** الحالة الإجمالية للمعلمة في الفصل (اقتراح C-08). العنصر الاختياري غير المسلَّم لا يؤثر. */
export function overallStatus(items: ItemStatus[]): ItemStatus {
  const submitted = items.filter((s) => s !== 'missing')
  if (submitted.length === 0) return 'missing'
  return submitted.includes('late') ? 'late' : 'on_time'
}

export function canSubmitNew(now: number, d: Deadlines): boolean {
  return phaseAt(now, d) !== 'closed'
}

export function canReplace(now: number, d: Deadlines): boolean {
  return now <= endOfDay(d.replace)
}

/** قيد ترتيب المواعيد (اقتراح C-11): الأساسي ≤ المتأخر ≤ الاستبدال. */
export function validateDeadlines(d: Deadlines): string[] {
  const errs: string[] = []
  if (!d.base || !d.late || !d.replace) errs.push('يرجى إدخال المواعيد الثلاثة كاملة.')
  else {
    if (d.late < d.base) errs.push('آخر موعد للتسليم المتأخر لا يسبق الموعد الأساسي.')
    if (d.replace < d.late) errs.push('آخر موعد للاستبدال لا يسبق آخر موعد للتسليم المتأخر.')
  }
  return errs
}

export interface AlertInfo { tone: 'info' | 'warn' | 'danger' | 'ok'; title: string; text: string }

/** تنبيه المعلمة للعنصر بحسب الوقت وحالة التسليم. */
export function deadlineAlert(
  now: number,
  d: Deadlines,
  status: ItemStatus,
  opts: { optional: boolean },
  fmt: { day: (s: string) => string; days: (n: number) => string },
): AlertInfo | null {
  const phase = phaseAt(now, d)
  const daysToBase = Math.ceil((endOfDay(d.base) - now) / 86_400_000)
  const daysToLate = Math.ceil((endOfDay(d.late) - now) / 86_400_000)
  const daysToReplace = Math.ceil((endOfDay(d.replace) - now) / 86_400_000)

  if (status === 'missing') {
    if (opts.optional) return null
    if (phase === 'before_base') {
      return daysToBase <= 3
        ? { tone: 'warn', title: 'اقترب الموعد الأساسي', text: `ينتهي الموعد الأساسي ${fmt.days(daysToBase)}، في ${fmt.day(d.base)}.` }
        : null
    }
    if (phase === 'late_window') {
      return {
        tone: 'danger',
        title: 'انتهى الموعد الأساسي',
        text: `أي تسليم الآن يُسجَّل «تم التسليم متأخرًا». آخر موعد للتسليم المتأخر ${fmt.days(daysToLate)}، في ${fmt.day(d.late)}.`,
      }
    }
    return { tone: 'danger', title: 'أُغلق باب التسليم', text: 'انتهى آخر موعد للتسليم المتأخر. للاستفسار تواصلي مع إدارة المدرسة.' }
  }

  if (!canReplace(now, d)) {
    return { tone: 'info', title: 'انتهت مهلة الاستبدال', text: 'لا يمكن استبدال الملف بعد الآن، وتبقى جميع النسخ محفوظة.' }
  }
  if (daysToReplace <= 3) {
    return { tone: 'warn', title: 'اقتربت نهاية مهلة الاستبدال', text: `يمكنك استبدال الملف حتى ${fmt.day(d.replace)} (${fmt.days(daysToReplace)}).` }
  }
  return null
}
