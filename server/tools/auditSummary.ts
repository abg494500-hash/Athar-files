// ملخّص عربي لتقرير `npm audit --json` (npm ≥ 7: auditReportVersion 2) مع تصنيف: إنتاج/تطوير (من package-lock)، مباشر/متعدّي، الإصلاح كاسر أم لا.
// **لا يطبّق أي إصلاح ولا يتصل بشبكة**: يقرأ ملفين محليين فقط. الغرض اتخاذ قرار مدروس بدل `npm audit fix --force`.
import { explain } from './depPaths'
import type { LockPkg } from './depPaths'
// ما يعتمد عليه: الشكل الموثَّق لتقرير npm؛ إن اختلف الشكل في إصدار npm لديكِ يعرض الأداة «غير معروف» لا أن تخمّن.
export type Severity = 'critical' | 'high' | 'moderate' | 'low' | 'info'
const ORDER: Severity[] = ['critical', 'high', 'moderate', 'low', 'info']
const AR: Record<Severity, string> = { critical: 'حرجة', high: 'عالية', moderate: 'متوسطة', low: 'منخفضة', info: 'معلوماتية' }

export interface AuditVia { source?: number; name?: string; title?: string; url?: string; severity?: string; range?: string }
export interface AuditVuln {
  name: string; severity: string; isDirect?: boolean; via?: (string | AuditVia)[]; effects?: string[]; range?: string; nodes?: string[]
  fixAvailable?: boolean | { name?: string; version?: string; isSemVerMajor?: boolean }
}
export interface AuditReport { vulnerabilities?: Record<string, AuditVuln>; metadata?: { vulnerabilities?: Record<string, number> } }
export interface LockFile { packages?: Record<string, LockPkg> }

export interface Row {
  name: string; severity: Severity | 'unknown'; direct: boolean; scope: 'prod' | 'dev' | 'unknown'; installed: string | null; range: string
  advisories: { title: string; url: string | null }[]; viaPackages: string[]
  fix: 'none' | 'non-breaking' | 'breaking' | 'unknown'; fixTo: string | null
  /** أقصر مسار اعتماد لكل نسخة مثبَّتة (من package-lock). */
  paths: string[]
  /** أمر مقترح (لا يُنفَّذ تلقائيًا) لغير الكاسر فقط؛ null عند الكاسر/بلا إصلاح/غير معروف. */
  suggestedCommand: string | null
}
export interface Summary {
  rows: Row[]
  totals: Record<Severity | 'unknown', number>
  prod: number; dev: number
  prodHighOrCritical: number
  breakingFixes: number
}

function scopeOf(v: AuditVuln, lock: LockFile): { scope: Row['scope']; installed: string | null } {
  const pk = lock.packages ?? {}
  const nodes = v.nodes && v.nodes.length ? v.nodes : [`node_modules/${v.name}`]
  const entries = nodes.map((n) => pk[n]).filter((e): e is { version?: string; dev?: boolean } => e !== undefined)
  if (entries.length === 0) return { scope: 'unknown', installed: null }
  return { scope: entries.some((e) => e.dev !== true) ? 'prod' : 'dev', installed: entries[0]?.version ?? null }
}

export function summarize(report: AuditReport, lock: LockFile): Summary {
  const rows: Row[] = Object.values(report.vulnerabilities ?? {}).map((v) => {
    const sev = (ORDER as string[]).includes(v.severity) ? (v.severity as Severity) : 'unknown'
    const via = v.via ?? []
    const advisories = via.filter((x): x is AuditVia => typeof x === 'object' && x !== null).map((x) => ({ title: x.title ?? 'بلا عنوان', url: x.url ?? null }))
    const viaPackages = via.filter((x): x is string => typeof x === 'string')
    const fa = v.fixAvailable
    const fix: Row['fix'] = fa === undefined ? 'unknown' : fa === false ? 'none' : fa === true ? 'non-breaking' : fa.isSemVerMajor === true ? 'breaking' : 'non-breaking'
    const { scope, installed } = scopeOf(v, lock)
    const paths = explain(lock, v.name).map((i) => `${i.name}@${i.version}: ${i.path.join(' ← ')}`)
    // مباشرة ⇒ تثبيت الإصدار المحدد؛ متعدّية ⇒ لا نضيفها لـpackage.json (npm install pkg@ver سيجعلها مباشرة): نقترح معاينة `npm audit fix --dry-run` (بلا --force)
    const suggestedCommand = fix !== 'non-breaking' ? null : v.isDirect === true && typeof fa === 'object' && fa && fa.version ? `npm install ${fa.name ?? v.name}@${fa.version}` : 'npm audit fix --dry-run'
    return { name: v.name, severity: sev, direct: v.isDirect === true, scope, installed, range: v.range ?? '?', advisories, viaPackages, fix, fixTo: typeof fa === 'object' && fa ? `${fa.name ?? v.name}@${fa.version ?? '?'}` : null, paths, suggestedCommand }
  })
  const rank = (x: Row['severity']) => (x === 'unknown' ? ORDER.length : ORDER.indexOf(x)) // غير المعروفة آخرًا
  rows.sort((a, b) => rank(a.severity) - rank(b.severity) || (a.scope === b.scope ? a.name.localeCompare(b.name) : a.scope === 'prod' ? -1 : 1))
  const totals: Summary['totals'] = { critical: 0, high: 0, moderate: 0, low: 0, info: 0, unknown: 0 }
  for (const r of rows) totals[r.severity]++
  return {
    rows, totals,
    prod: rows.filter((r) => r.scope === 'prod').length, dev: rows.filter((r) => r.scope === 'dev').length,
    prodHighOrCritical: rows.filter((r) => r.scope === 'prod' && (r.severity === 'high' || r.severity === 'critical')).length,
    breakingFixes: rows.filter((r) => r.fix === 'breaking').length,
  }
}

function advice(r: Row): string {
  const parts: string[] = []
  if (r.scope === 'prod') parts.push(r.severity === 'high' || r.severity === 'critical' ? 'عاجل: في الحزمة المنشورة؛ لا نشر قبل المعالجة' : 'في الحزمة المنشورة؛ قيّمي قابلية الاستغلال في تطبيقنا (SPA ثابت) ثم قرّري')
  else if (r.scope === 'dev') parts.push('أداة تطوير/بناء/اختبار لا تُشحن للمتصفح؛ الخطر على جهاز التطوير (مثل خادم التطوير) فلا تشغّلي `npm run dev` على شبكة غير موثوقة')
  else parts.push('تعذّر تحديد النطاق من package-lock')
  if (r.fix === 'breaking') parts.push(`الإصلاح تحديث رئيسي كاسر${r.fixTo ? ` (${r.fixTo})` : ''}: لا يُطبَّق تلقائيًا؛ يُحلَّل بشكل منفصل مع اختبارات`)
  else if (r.fix === 'non-breaking') parts.push(`إصلاح غير كاسر متاح${r.fixTo ? ` (${r.fixTo})` : ''}: يُجرَّب على فرع ثم تُشغَّل الاختبارات`)
  else if (r.fix === 'none') parts.push('لا إصلاح متاح حاليًا: مراقبة أو تجاوز مؤقت موثّق')
  return parts.join(' — ')
}

export function renderArabic(s: Summary): string {
  const L: string[] = []
  L.push(`# ملخّص npm audit`, '', `إجمالي الحزم المتأثرة: ${s.rows.length} (إنتاج ${s.prod}، تطوير ${s.dev}). حرجة ${s.totals.critical}، عالية ${s.totals.high}، متوسطة ${s.totals.moderate}، منخفضة ${s.totals.low}.`)
  L.push(`عالية/حرجة في الإنتاج: ${s.prodHighOrCritical}. إصلاحات كاسرة: ${s.breakingFixes}. **لا يُستعمل \`npm audit fix --force\`.**`, '')
  L.push('| الحزمة | الخطورة | النطاق | مباشرة؟ | المثبَّت | الإصلاح | المشكلة |', '|---|---|---|---|---|---|---|')
  for (const r of s.rows) {
    const sev = r.severity === 'unknown' ? 'غير معروفة' : AR[r.severity]
    const issue = r.advisories.length ? r.advisories.map((a) => a.title).join('؛ ') : r.viaPackages.length ? `عبر ${r.viaPackages.join('، ')}` : '—'
    L.push(`| ${r.name} | ${sev} | ${r.scope === 'prod' ? 'إنتاج' : r.scope === 'dev' ? 'تطوير' : '؟'} | ${r.direct ? 'نعم' : 'لا'} | ${r.installed ?? '؟'} | ${r.fix === 'breaking' ? 'كاسر' : r.fix === 'non-breaking' ? 'غير كاسر' : r.fix === 'none' ? 'لا يوجد' : '؟'} | ${issue} |`)
  }
  L.push('', '## التوصيات لكل حزمة')
  for (const r of s.rows) { L.push(`- **${r.name}**: ${advice(r)}`); for (const a of r.advisories) if (a.url) L.push(`  - ${a.title}: ${a.url}`) }
  L.push('', '## مسارات الاعتماد (من package-lock.json)')
  for (const r of s.rows) { L.push(`- **${r.name}**${r.installed ? ` ${r.installed}` : ''}:`); for (const pth of r.paths.length ? r.paths : ['(غير مثبَّتة في القفل)']) L.push(`  - ${pth}`) }
  L.push('', '## أوامر مقترحة (لا تُنفَّذ تلقائيًا؛ غير الكاسر فقط، على فرع، ثم typecheck وnpm test وnpm run build وأعيدي npm audit)')
  const cmds = s.rows.filter((r) => r.suggestedCommand)
  if (cmds.length === 0) L.push('- لا أوامر غير كاسرة مقترحة. الكاسر يُحلَّل منفصلًا.')
  for (const r of cmds) L.push(`- \`${r.suggestedCommand}\`  ← ${r.name} (${r.severity === 'unknown' ? '؟' : AR[r.severity]}، ${r.scope === 'prod' ? 'إنتاج' : r.scope === 'dev' ? 'تطوير' : '؟'})${r.suggestedCommand === 'npm audit fix --dry-run' ? ' — متعدّية: راجعي ما سيتغير في القفل ثم `npm audit fix` بلا --force' : ''}`)
  return L.join('\n') + '\n'
}
