import type { Archive, AuditEntry, Deadlines, Submission, Teacher, Term, Version, Year } from '../../data/types'
import { statusAtSubmission } from '../../lib/status'

// ⚠ بيانات توضيحية داخلية لبناء الواجهات فقط: أسماء وملفات وبصمات غير حقيقية.
// "الآن" ثابت حتى تبقى الحالات والتنبيهات متسقة أثناء المراجعة.
export const MOCK_NOW = Date.parse('2026-10-18T16:47:00+04:00')

export const YEARS: Year[] = [
  { id: 'y2627', label: '⁦2026⁠–⁠2027⁩', active: true },
  { id: 'y2526', label: '⁦2025⁠–⁠2026⁩', active: false },
]

export const TERMS: Term[] = [
  { id: 't1', yearId: 'y2627', name: 'الفصل الدراسي الأول', order: 1, deadlines: { base: '2026-10-15', late: '2026-10-20', replace: '2026-11-05' } },
  { id: 't2', yearId: 'y2627', name: 'الفصل الدراسي الثاني', order: 2, deadlines: { base: '2027-03-04', late: '2027-03-11', replace: '2027-03-25' } },
  { id: 't3', yearId: 'y2526', name: 'الفصل الدراسي الأول', order: 1, deadlines: { base: '2025-10-16', late: '2025-10-23', replace: '2025-11-06' } },
  { id: 't4', yearId: 'y2526', name: 'الفصل الدراسي الثاني', order: 2, deadlines: { base: '2026-03-05', late: '2026-03-12', replace: '2026-03-26' } },
]

const NAMES: [string, string][] = [
  ['مريم الحارثية', 'اللغة العربية'], ['سلمى البلوشية', 'الرياضيات'], ['هدى الشكيلية', 'العلوم'],
  ['أمل الراشدية', 'اللغة الإنجليزية'], ['زينب المعمرية', 'التربية الإسلامية'], ['ليلى الكلبانية', 'الدراسات الاجتماعية'],
  ['عائشة السيابية', 'تقنية المعلومات'], ['رقية الغافرية', 'التربية الفنية'], ['خولة العبرية', 'التربية البدنية'],
  ['منى الهنائية', 'المهارات الحياتية'], ['وفاء المقبالية', 'الرياضيات'], ['شيخة الفارسية', 'اللغة العربية'],
  ['بدرية الجابرية', 'العلوم'], ['حليمة الرحبية', 'اللغة الإنجليزية'], ['سعاد الوهيبية', 'التربية الإسلامية'],
  ['نجلاء الحبسية', 'الدراسات الاجتماعية'], ['فاطمة الزدجالية', 'الرياضيات'], ['آمنة اليحيائية', 'العلوم'],
]

export const TEACHERS: Teacher[] = NAMES.map(([name, subject], i) => ({
  id: `th${i + 1}`,
  name,
  subject,
  colorIdx: i % 8,
  active: i !== 16,
  codeState: i === 16 ? 'revoked' : 'active',
  codeIssuedAt: '2026-08-30T09:00:00+04:00',
}))

function rng(seed: string) {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619) }
  return () => {
    h += 0x6d2b79f5
    let t = Math.imul(h ^ (h >>> 15), 1 | h)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
export function fakeHash(seed: string): string {
  const r = rng(seed)
  let s = ''
  for (let i = 0; i < 64; i++) s += Math.floor(r() * 16).toString(16)
  return s
}

const FILES = ['ملف الإنجاز.pdf', 'خطة الدروس.docx', 'عرض المبادرة.pptx', 'سجل المتابعة.xlsx', 'شهادة المشاركة.png', 'نماذج الأعمال.pdf', 'تقرير النشاط.pdf', 'صور الفعالية.jpg']
const SIZES = [2_400_000, 880_000, 14_600_000, 340_000, 1_250_000, 7_900_000, 3_100_000, 5_600_000]

function mkVersion(key: string, no: number, d: Deadlines, iso: string, link = false): Version {
  const r = rng(key)
  const fi = Math.floor(r() * FILES.length)
  const st = statusAtSubmission(Date.parse(iso), d)
  return {
    id: key,
    no,
    kind: link ? 'link' : 'file',
    fileName: link ? undefined : FILES[fi],
    size: link ? undefined : SIZES[fi] + Math.floor(r() * 90_000),
    url: link ? 'https://drive.example.org/folders/portfolio-' + (fi + 1) : undefined,
    sha256: fakeHash(key),
    submittedAt: iso,
    status: st === 'rejected' ? 'late' : st,
  }
}

const PLAN = ['ontime2', 'missing', 'late', 'ontime', 'ontime', 'late', 'missing', 'ontime', 'ontime', 'missing', 'ontime', 'late', 'ontime', 'ontime', 'missing', 'ontime', 'late', 'ontime']

function buildSubmissions(): Submission[] {
  const out: Submission[] = []
  const t1 = TERMS[0].deadlines
  TEACHERS.forEach((t, i) => {
    const plan = PLAN[i]
    const day = 6 + (i % 8) // 6..13 أكتوبر
    const hh = String(8 + (i % 9)).padStart(2, '0')
    const onTime = `2026-10-${String(day).padStart(2, '0')}T${hh}:20:00+04:00`
    const lateIso = `2026-10-${String(16 + (i % 3)).padStart(2, '0')}T${hh}:05:00+04:00`
    if (plan === 'ontime2') {
      out.push({ teacherId: t.id, termId: 't1', slotId: 's1', versions: [
        mkVersion(`${t.id}-t1-s1-1`, 1, t1, '2026-10-08T09:10:00+04:00'),
        mkVersion(`${t.id}-t1-s1-2`, 2, t1, '2026-10-14T13:40:00+04:00'),
      ] })
      out.push({ teacherId: t.id, termId: 't1', slotId: 's2', versions: [mkVersion(`${t.id}-t1-s2-1`, 1, t1, '2026-10-12T10:00:00+04:00', true)] })
    } else if (plan === 'ontime') {
      out.push({ teacherId: t.id, termId: 't1', slotId: 's1', versions: [mkVersion(`${t.id}-t1-s1-1`, 1, t1, onTime)] })
      if (i % 3 === 0) out.push({ teacherId: t.id, termId: 't1', slotId: 's2', versions: [mkVersion(`${t.id}-t1-s2-1`, 1, t1, onTime)] })
    } else if (plan === 'late') {
      out.push({ teacherId: t.id, termId: 't1', slotId: 's1', versions: [mkVersion(`${t.id}-t1-s1-1`, 1, t1, lateIso)] })
      if (i % 2 === 0) out.push({ teacherId: t.id, termId: 't1', slotId: 's2', versions: [mkVersion(`${t.id}-t1-s2-1`, 1, t1, onTime)] })
    }
  })
  // الفصول السابقة
  ;(['t3', 't4'] as const).forEach((tid) => {
    const d = TERMS.find((x) => x.id === tid)!.deadlines
    TEACHERS.forEach((t, i) => {
      if ((i + (tid === 't3' ? 0 : 2)) % 9 === 8) return // بعضهن لم يسلّمن
      const late = (i + (tid === 't3' ? 1 : 3)) % 7 === 0
      const base = new Date(d.base + 'T00:00:00+04:00').getTime()
      const iso = new Date(base + (late ? 3 : -4 + (i % 3)) * 86_400_000 + 6 * 3_600_000).toISOString()
      out.push({ teacherId: t.id, termId: tid, slotId: 's1', versions: [mkVersion(`${t.id}-${tid}-s1-1`, 1, d, iso)] })
    })
  })
  return out
}
export const SUBMISSIONS: Submission[] = buildSubmissions()

export const AUDIT: AuditEntry[] = [
  ['2026-10-18T15:12:00+04:00', 'سلمى البلوشية', 'teacher', 'تسليم ملف', 'ملف الإنجاز الأساسي — الفصل الأول'],
  ['2026-10-18T11:03:00+04:00', 'مديرة المدرسة', 'director', 'عرض ملف معلمة', 'مريم الحارثية'],
  ['2026-10-17T10:30:00+04:00', 'المالكة', 'owner', 'تعديل موعد', 'الفصل الأول — آخر موعد للتسليم المتأخر', 'من ⁦2026-10-18⁩ إلى ⁦2026-10-20⁩'],
  ['2026-10-16T09:15:00+04:00', 'خولة العبرية', 'teacher', 'تسليم ملف', 'ملف الإنجاز الأساسي — الفصل الأول'],
  ['2026-10-15T08:00:00+04:00', 'النظام', 'system', 'انتهاء الموعد الأساسي', 'الفصل الأول'],
  ['2026-10-14T13:40:00+04:00', 'مريم الحارثية', 'teacher', 'استبدال ملف', 'ملف الإنجاز الأساسي — النسخة 2'],
  ['2026-10-12T10:00:00+04:00', 'مريم الحارثية', 'teacher', 'تسليم رابط', 'ملف داعم — الفصل الأول'],
  ['2026-10-10T12:45:00+04:00', 'المالكة', 'owner', 'إعادة إصدار رمز دخول', 'وفاء المقبالية'],
  ['2026-10-08T09:10:00+04:00', 'مريم الحارثية', 'teacher', 'تسليم ملف', 'ملف الإنجاز الأساسي — الفصل الأول'],
  ['2026-09-30T14:20:00+04:00', 'المالكة', 'owner', 'إضافة معلمة', 'آمنة اليحيائية'],
  ['2026-09-28T10:05:00+04:00', 'المالكة', 'owner', 'إلغاء رمز دخول', 'فاطمة الزدجالية'],
  ['2026-09-02T09:00:00+04:00', 'المالكة', 'owner', 'تفعيل سنة دراسية', '⁦2026⁠–⁠2027⁩'],
  ['2026-08-30T09:00:00+04:00', 'المالكة', 'owner', 'إنشاء مواعيد الفصل', 'الفصل الأول — ⁦2026⁠–⁠2027⁩'],
  ['2026-07-02T11:30:00+04:00', 'المالكة', 'owner', 'التحقق من أرشيف', 'أرشيف الفصل الأول ⁦2025⁠–⁠2026⁩', 'نجح التحقق'],
  ['2026-07-01T10:10:00+04:00', 'المالكة', 'owner', 'إنشاء أرشيف', 'أرشيف الفصل الأول ⁦2025⁠–⁠2026⁩'],
].map(([at, actor, actorRole, action, target, detail], i) => ({
  id: `a${i + 1}`, at, actor, actorRole, action, target, detail,
})) as AuditEntry[]

const okChecks = [
  { label: 'اكتمال الملفات المدرجة', state: 'ok' as const },
  { label: 'مطابقة حجم الأرشيف', state: 'ok' as const },
  { label: 'مطابقة بصمات الملفات (SHA-256)', state: 'ok' as const },
  { label: 'سلامة بيان manifest.csv', state: 'ok' as const },
]

export const ARCHIVES: Archive[] = [
  {
    id: 'ar1', title: 'أرشيف الفصل الأول ⁦2025⁠–⁠2026⁩', yearId: 'y2526', termId: 't3', teacherId: null,
    createdAt: '2026-07-01T10:10:00+04:00', status: 'verified', sizeBytes: 1_975_684_956, entries: 372, sha256: fakeHash('ar1'),
    checks: okChecks, sent: true, backupAck: { at: '2026-07-03T09:00:00+04:00', note: 'قرص خارجي محفوظ لدى إدارة المدرسة' },
  },
  {
    id: 'ar2', title: 'أرشيف الفصل الثاني ⁦2025⁠–⁠2026⁩', yearId: 'y2526', termId: 't4', teacherId: null,
    createdAt: '2026-07-04T10:00:00+04:00', status: 'verified', sizeBytes: 1_604_223_870, entries: 341, sha256: fakeHash('ar2'),
    checks: okChecks, sent: false,
  },
  {
    id: 'ar3', title: 'أرشيف معلمة: مريم الحارثية — ⁦2025⁠–⁠2026⁩', yearId: 'y2526', termId: null, teacherId: 'th1',
    createdAt: '2026-10-17T09:30:00+04:00', status: 'awaiting_verification', sizeBytes: 148_300_210, entries: 14, sha256: fakeHash('ar3'),
    checks: okChecks.map((c, i) => (i < 1 ? c : { ...c, state: 'pending' as const })), sent: false,
  },
  {
    id: 'ar4', title: 'أرشيف سنة ⁦2025⁠–⁠2026⁩ كاملة', yearId: 'y2526', termId: null, teacherId: null,
    createdAt: '2026-10-15T12:00:00+04:00', status: 'failed', sizeBytes: 3_580_000_000, entries: 713, sha256: fakeHash('ar4'),
    checks: [okChecks[0], okChecks[1], { label: 'مطابقة بصمات الملفات (SHA-256)', state: 'fail' }, { label: 'سلامة بيان manifest.csv', state: 'pending' }], sent: false,
  },
]
