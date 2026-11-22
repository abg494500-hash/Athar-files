// كل تنسيقات التاريخ والأرقام في مكان واحد، لأن تقويم التاريخ وشكل الأرقام (D-02) ما زالا قرارًا مفتوحًا.
export const TIME_ZONE = 'Asia/Muscat'
const LOCALE = 'ar-OM-u-nu-latn-ca-gregory'

const dateFmt = new Intl.DateTimeFormat(LOCALE, { timeZone: TIME_ZONE, day: 'numeric', month: 'long', year: 'numeric' })
const dayFmt = new Intl.DateTimeFormat(LOCALE, { timeZone: TIME_ZONE, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const shortFmt = new Intl.DateTimeFormat(LOCALE, { timeZone: TIME_ZONE, day: 'numeric', month: 'short' })
const timeFmt = new Intl.DateTimeFormat(LOCALE, { timeZone: TIME_ZONE, hour: 'numeric', minute: '2-digit', hour12: true })
const numFmt = new Intl.NumberFormat(LOCALE)

export const fmtDate = (d: string | number | Date) => dateFmt.format(new Date(d))
export const fmtDay = (d: string | number | Date) => dayFmt.format(new Date(d))
export const fmtShort = (d: string | number | Date) => shortFmt.format(new Date(d))
export const fmtDateTime = (d: string | number | Date) => `${dateFmt.format(new Date(d))}، ${timeFmt.format(new Date(d))}`
export const fmtNum = (n: number) => numFmt.format(n)
export const fmtPercent = (n: number) => `${numFmt.format(Math.round(n))}%`

export function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${fmtNum(bytes)} بايت`
  const units = ['ك.ب', 'م.ب', 'ج.ب']
  let v = bytes / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 }).format(v)} ${units[i]}`
}

/** عدد الأيام الكاملة بين لحظتين (موجب إذا كان الهدف في المستقبل). */
export function daysUntil(target: number, now: number): number {
  return Math.ceil((target - now) / 86_400_000)
}

export function fmtDaysText(days: number): string {
  if (days <= 0) return 'اليوم'
  if (days === 1) return 'غدًا'
  if (days === 2) return 'بعد يومين'
  if (days <= 10) return `بعد ${fmtNum(days)} أيام`
  return `بعد ${fmtNum(days)} يومًا`
}
