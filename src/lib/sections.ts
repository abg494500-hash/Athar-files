import { BarChart3, CalendarClock, UserPlus, FolderArchive, FolderOpen, GraduationCap, LayoutDashboard, ShieldAlert, Users, type LucideIcon } from 'lucide-react'

/**
 * سجل الأقسام الموحّد للمالكة والمديرة (إعادة التصميم 0.6.3، قرار A-92).
 * مصدر واحد تُبنى منه البطاقات في الصفحة الرئيسية وشريط التنقل في كل الصفحات الداخلية،
 * فيتطابق الاثنان في الترتيب والتسمية ويختلفان فقط بحسب الدور.
 *
 * مهم: هذا السجل يحدّد **ما يُعرض** فقط. الحماية الفعلية هي Guard في App.tsx (حسب الدور) وRLS في قاعدة البيانات؛
 * لم تتغير أي صلاحية، ولا يمنح وجود قسم هنا أي وصول.
 */
export type StaffRole = 'owner' | 'director'
export type SectionTone = 'frost' | 'lav' | 'steel' | 'mint' | 'blush' | 'sand' | 'aqua'

export interface Section {
  id: string
  /** مسار القسم الكامل (يبدأ بمسار الدور). */
  to: string
  label: string
  description: string
  icon: LucideIcon
  group: string
  tone: SectionTone
  /** قسم لإجراءات حساسة: يُميَّز بصريًا بتنبيه هادئ لا بلون صارخ. */
  sensitive?: boolean
}

export const HOME_PATH: Record<StaffRole, string> = { owner: '/owner', director: '/director' }

const OWNER: Section[] = [
  { id: 'overview', to: '/owner/overview', label: 'لوحة المتابعة', description: 'نسب التسليم ومواعيد الفصل الحالي.', icon: LayoutDashboard, group: 'المتابعة', tone: 'frost' },
  { id: 'submissions', to: '/owner/submissions', label: 'متابعة الملفات', description: 'حالة تسليم كل معلمة وملفاتها ونسخها.', icon: FolderOpen, group: 'المتابعة', tone: 'lav' },
  { id: 'deadlines', to: '/owner/deadlines', label: 'المواعيد', description: 'مواعيد التسليم الأساسي والمتأخر والاستبدال لكل فصل.', icon: CalendarClock, group: 'المتابعة', tone: 'sand' },
  { id: 'years', to: '/owner/years', label: 'السنوات والفصول', description: 'إضافة السنة الدراسية وتحديد السنة النشطة.', icon: GraduationCap, group: 'الإدارة', tone: 'aqua' },
  { id: 'teachers', to: '/owner/teachers', label: 'المعلمات والأكواد', description: 'قائمة المعلمات ورموز دخولهن وألوانهن.', icon: Users, group: 'الإدارة', tone: 'mint' },
  { id: 'archive', to: '/owner/archive', label: 'الأرشفة', description: 'أرشيف منظَّم حسب السنة والفصل والمعلمة مع التحقق منه.', icon: FolderArchive, group: 'الحفظ والحماية', tone: 'steel' },
  { id: 'yearreset', to: '/owner/year-reset', label: 'التصفير السنوي', description: 'حذف بيانات سنة من Cloud بعد حفظ أرشيفها محليًا ونسخته الثانية.', icon: ShieldAlert, group: 'الحفظ والحماية', tone: 'blush', sensitive: true },
]

const DIRECTOR: Section[] = [
  { id: 'overview', to: '/director/overview', label: 'نظرة عامة', description: 'نسب التسليم والمعلمات اللاتي يحتجن إلى متابعة.', icon: LayoutDashboard, group: 'المتابعة', tone: 'frost' },
  { id: 'teachers', to: '/director/teachers', label: 'التسليمات', description: 'بطاقات المعلمات المسلِّمات مع معاينة ملفاتهن وتنزيلها.', icon: Users, group: 'المتابعة', tone: 'mint' },
  { id: 'years', to: '/director/years', label: 'السنوات والفصول', description: 'إضافة السنة الدراسية وتحديد السنة النشطة.', icon: GraduationCap, group: 'الإدارة', tone: 'aqua' },
  { id: 'register', to: '/director/register', label: 'المعلمات والأكواد', description: 'تسجيل المعلمات واستيرادهن من Excel وإصدار رموز دخولهن وإيقافهن.', icon: UserPlus, group: 'الإدارة', tone: 'mint' },
  { id: 'reports', to: '/director/reports', label: 'التقارير والإحصاءات', description: 'تقارير التسليم والإحصاءات حسب الفصل، قابلة للطباعة.', icon: BarChart3, group: 'المتابعة', tone: 'lav' },
  { id: 'deadlines', to: '/director/deadlines', label: 'المواعيد', description: 'الموعد الأساسي وآخر موعد للتسليم المتأخر وللاستبدال لكل فصل.', icon: CalendarClock, group: 'المتابعة', tone: 'sand' },
]

export function sectionsFor(role: StaffRole): Section[] { return role === 'owner' ? OWNER : DIRECTOR }

export function groupedSections(role: StaffRole): { group: string; items: Section[] }[] {
  const out: { group: string; items: Section[] }[] = []
  for (const s of sectionsFor(role)) {
    const g = out.find((x) => x.group === s.group)
    if (g) g.items.push(s); else out.push({ group: s.group, items: [s] })
  }
  return out
}
