import type { Archive, AuditEntry, Deadlines, Role, SlotId, Submission, Teacher, Term, Version, Year } from './types'

/**
 * عقد طبقة البيانات (المرحلة 4.3).
 * الواجهة لا تعرف مصدر البيانات: تقرأ لقطة (Snapshot) وتستدعي أوامر. أي مصدر جديد (مثل Supabase لاحقًا)
 * يُنفِّذ هذا العقد ويُستبدل في نقطة واحدة هي `src/data/provider.ts`، دون تعديل الصفحات.
 *
 * ملاحظات صريحة:
 * - المصدر الحقيقي في `src/data/supabase/`، والمصدر الوهمي للاختبارات وحدها في `src/test/mock/`.
 * - لا يغيّر هذا العقد قواعد الصلاحيات ولا الحذف ولا سجل العمليات (A-44…A-46): تبقى كما كانت في 4.2.
 * - `session` و`login`/`logout` مكان مؤقت لا يمثل مصادقة حقيقية؛ مصادقة المعلمات (DP-02) قرار لاحق
 *   وتنتقل عندئذ إلى طبقة مصادقة مستقلة.
 */

export interface Session { role: Role; teacherId?: string }

/** حالة تحميل البيانات من المصدر. المصدر الوهمي دائمًا ready. الخطأ لا يتحوّل أبدًا إلى بيانات وهمية. */
export type LoadState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'ready' }
  | { phase: 'error'; message: string }

export type CommandName =
  | 'submit' | 'updateDeadlines' | 'setActiveYear' | 'addYear' | 'setCurrentTerm' | 'addTeacher' | 'updateTeacher'
  | 'reissueCode' | 'revokeCode' | 'createArchive' | 'verifyArchive' | 'markSent' | 'ackBackup' | 'deleteArchive'

export interface Snapshot {
  years: Year[]
  terms: Term[]
  teachers: Teacher[]
  submissions: Submission[]
  audit: AuditEntry[]
  archives: Archive[]
  currentTermId: string
  now: number
  session: Session | null
  load: LoadState
}

/** وصف المصدر: تعتمد عليه الواجهة لتصدق مع المستخدم بشأن دوام بياناته. */
export interface RepositoryMeta {
  /** معرّف نوع المصدر، مثل 'mock'. */
  kind: string
  /** هل تبقى التعديلات بعد تحديث الصفحة؟ false للمصدر الوهمي. */
  persistent: boolean
  /** "الآن" الابتدائي للمصدر (ثابت في المصدر الوهمي لاتساق الحالات أثناء المراجعة). */
  baselineNow: number
  /** أوامر غير متاحة في هذا المصدر ← سبب يُعرض للمستخدمة (مثل: «يتاح في المرحلة 4»). غياب المفتاح = متاح. */
  unavailable?: Partial<Record<CommandName, string>>
}

export interface SubmitInput {
  teacherId: string
  termId: string
  slotId: SlotId
  kind: 'file' | 'link'
  fileName?: string
  size?: number
  url?: string
  sha256?: string // من طبقة التخزين؛ إن غاب يُولَّد قيمة وهمية للعرض
  storageKey?: string
}
export type SubmitResult = { ok: true; version: Version } | { ok: false; reason: 'closed' | 'replace_closed' }

export interface NewArchiveInput { yearId: string; termId: string | null; teacherId: string | null; title: string }

export interface DataRepository {
  readonly meta: RepositoryMeta

  // قراءة: لقطة غير قابلة للتعديل، مرجعها ثابت ما لم تتغير البيانات (متوافقة مع useSyncExternalStore).
  getSnapshot(): Snapshot
  subscribe(listener: () => void): () => void

  // جلسة محلية مؤقتة (ليست مصادقة حقيقية)
  login(session: Session): void
  logout(): void
  /** تجاوز الساعة لعرض الحالات المختلفة أثناء المراجعة. يهمّ المصدر الوهمي فقط. */
  setNow(ms: number): void
  /** يعيد تحميل البيانات من المصدر (المصدر الوهمي: لا شيء). */
  reload(): Promise<void>

  // أوامر: غير متزامنة ليتسع العقد لمصدر بعيد؛ المصدر الوهمي ينفّذ التعديل فورًا ثم يُنجز الوعد.
  submit(input: SubmitInput): Promise<SubmitResult>
  updateDeadlines(termId: string, deadlines: Deadlines, reason: string): Promise<void>
  setActiveYear(yearId: string): Promise<void>
  addYear(label: string): Promise<void>
  setCurrentTerm(termId: string): Promise<void>
  addTeacher(name: string, subject: string): Promise<void>
  updateTeacher(id: string, patch: Partial<Pick<Teacher, 'name' | 'subject' | 'colorIdx' | 'active'>>): Promise<void>
  /** يعيد الرمز الجديد مرة واحدة فقط؛ لا يُحفظ نصه في اللقطة. */
  reissueCode(id: string): Promise<string>
  revokeCode(id: string): Promise<void>
  createArchive(input: NewArchiveInput): Promise<void>
  verifyArchive(id: string): Promise<void>
  markSent(id: string): Promise<void>
  ackBackup(id: string, note: string): Promise<void>
  /** لا يحذف ملفات في المرحلة 4: يسجّل الطلب فقط كما في 4.2 (A-44). */
  deleteArchive(id: string, confirmedBy: string): Promise<void>
}
