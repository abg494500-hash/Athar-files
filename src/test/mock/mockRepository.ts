import type { ActorRole, AuditEntry, Deadlines, Term, Version } from '../../data/types'
import type { DataRepository, NewArchiveInput, RepositoryMeta, Session, Snapshot, SubmitInput, SubmitResult } from '../../data/repository'
import type { Teacher } from '../../data/types'
import { canReplace, canSubmitNew, statusAtSubmission } from '../../lib/status'
import { ARCHIVES, AUDIT, MOCK_NOW, SUBMISSIONS, TEACHERS, TERMS, YEARS, fakeHash } from './seed'

/**
 * المصدر الوهمي: بيانات توضيحية في ذاكرة الصفحة فقط. ليس تخزينًا دائمًا: تضيع كل التعديلات
 * عند تحديث الصفحة أو إغلاقها. المنطق هنا منقول من `store.tsx` (المرحلة 4.2) دون تغيير في السلوك،
 * بما فيه سجل العمليات للإضافة فقط ومنع الحذف الفعلي.
 */

const iso = (d: string) => `⁦${d}⁩`

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
function randomCode(): string {
  const bytes = new Uint8Array(10)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('')
}

export function createInitialSnapshot(initial?: Partial<Snapshot>): Snapshot {
  return {
    years: YEARS, terms: TERMS, teachers: TEACHERS, submissions: SUBMISSIONS, audit: AUDIT, archives: ARCHIVES,
    currentTermId: 't1', now: MOCK_NOW, session: null, load: { phase: 'ready' }, ...initial,
  }
}

export function createMockRepository(initial?: Partial<Snapshot>): DataRepository {
  let state: Snapshot = createInitialSnapshot(initial)
  const meta: RepositoryMeta = { kind: 'mock', persistent: false, baselineNow: MOCK_NOW }
  const listeners = new Set<() => void>()
  let uid = 1000
  const nextId = (p: string) => `${p}${++uid}`

  const set = (fn: (s: Snapshot) => Snapshot) => {
    state = fn(state)
    listeners.forEach((l) => l())
  }

  const actorOf = (s: Snapshot): { actor: string; actorRole: ActorRole } => {
    const ses = s.session
    if (!ses) return { actor: 'النظام', actorRole: 'system' }
    if (ses.role === 'owner') return { actor: 'المالكة', actorRole: 'owner' }
    if (ses.role === 'director') return { actor: 'مديرة المدرسة', actorRole: 'director' }
    return { actor: s.teachers.find((t) => t.id === ses.teacherId)?.name ?? 'معلمة', actorRole: 'teacher' }
  }

  // سجل العمليات للإضافة فقط: لا توجد أي دالة لتعديل أو حذف قيود السجل.
  const log = (s: Snapshot, action: string, target: string, detail?: string): Snapshot => {
    const { actor, actorRole } = actorOf(s)
    const entry: AuditEntry = { id: nextId('a'), at: new Date(s.now).toISOString(), actor, actorRole, action, target, detail }
    return { ...s, audit: [entry, ...s.audit] }
  }

  const termName = (s: Snapshot, id: string) => {
    const t = s.terms.find((x) => x.id === id)
    const y = t && s.years.find((x) => x.id === t.yearId)
    return t ? `${t.name} — ${y?.label ?? ''}` : id
  }

  const repo: DataRepository = {
    meta,
    getSnapshot: () => state,
    subscribe: (l) => { listeners.add(l); return () => { listeners.delete(l) } },

    login: (session: Session) => set((s) => log({ ...s, session }, 'تسجيل دخول', session.role === 'teacher' ? (s.teachers.find((t) => t.id === session.teacherId)?.name ?? '') : (session.role === 'owner' ? 'المالكة' : 'مديرة المدرسة'))),
    logout: () => set((s) => ({ ...s, session: null })),
    setNow: (ms) => set((s) => ({ ...s, now: ms })),
    reload: async () => {},

    submit: async (i: SubmitInput): Promise<SubmitResult> => {
      const s = state
      const term = s.terms.find((t) => t.id === i.termId)!
      const existing = s.submissions.find((x) => x.teacherId === i.teacherId && x.termId === i.termId && x.slotId === i.slotId)
      if (!existing && !canSubmitNew(s.now, term.deadlines)) return { ok: false, reason: 'closed' }
      if (existing && !canReplace(s.now, term.deadlines)) return { ok: false, reason: 'replace_closed' }
      const st = existing ? existing.versions[0]?.status ?? 'on_time' : statusAtSubmission(s.now, term.deadlines)
      const version: Version = {
        id: nextId('v'),
        no: (existing?.versions.length ?? 0) + 1,
        kind: i.kind,
        fileName: i.fileName,
        size: i.size,
        url: i.url,
        sha256: i.sha256 ?? fakeHash(`${i.teacherId}${i.slotId}${s.now}${uid}`),
        storageKey: i.storageKey,
        submittedAt: new Date(s.now).toISOString(),
        status: st === 'rejected' ? 'late' : st,
      }
      set((cur) => {
        const subs = existing
          ? cur.submissions.map((x) => (x === existing || (x.teacherId === existing.teacherId && x.termId === existing.termId && x.slotId === existing.slotId) ? { ...x, versions: [...x.versions, version] } : x))
          : [...cur.submissions, { teacherId: i.teacherId, termId: i.termId, slotId: i.slotId, versions: [version] }]
        return log({ ...cur, submissions: subs }, existing ? 'استبدال ملف' : (i.kind === 'link' ? 'تسليم رابط' : 'تسليم ملف'), `${i.slotId === 's1' ? 'ملف الإنجاز الأساسي' : 'ملف داعم'} — ${termName(cur, i.termId)}`)
      })
      return { ok: true, version }
    },

    updateDeadlines: async (termId: string, d: Deadlines, reason: string) => set((s) => {
      const old = s.terms.find((t) => t.id === termId)!.deadlines
      const parts: string[] = []
      if (old.base !== d.base) parts.push(`الأساسي: ${iso(old.base)} ← ${iso(d.base)}`)
      if (old.late !== d.late) parts.push(`المتأخر: ${iso(old.late)} ← ${iso(d.late)}`)
      if (old.replace !== d.replace) parts.push(`الاستبدال: ${iso(old.replace)} ← ${iso(d.replace)}`)
      const next = { ...s, terms: s.terms.map((t) => (t.id === termId ? { ...t, deadlines: d } : t)) }
      return log(next, 'تعديل مواعيد', termName(s, termId), `${parts.join(' · ')}${reason ? ` — السبب: ${reason}` : ''}`)
    }),

    setActiveYear: async (yearId) => set((s) => log({ ...s, years: s.years.map((y) => ({ ...y, active: y.id === yearId })) }, 'تفعيل سنة دراسية', s.years.find((y) => y.id === yearId)?.label ?? '')),
    addYear: async (label) => set((s) => {
      const yid = nextId('y')
      const [a] = label.split(/[–-]/)
      const start = parseInt(a, 10) || 2027
      const mk = (n: 1 | 2): Term => ({
        id: nextId('t'), yearId: yid, name: n === 1 ? 'الفصل الدراسي الأول' : 'الفصل الدراسي الثاني', order: n,
        deadlines: n === 1 ? { base: `${start}-10-15`, late: `${start}-10-22`, replace: `${start}-11-06` } : { base: `${start + 1}-03-05`, late: `${start + 1}-03-12`, replace: `${start + 1}-03-26` },
      })
      return log({ ...s, years: [...s.years, { id: yid, label: `⁦${label.replace('–', '⁠–⁠')}⁩`, active: false }], terms: [...s.terms, mk(1), mk(2)] }, 'إضافة سنة دراسية', label)
    }),
    setCurrentTerm: async (termId) => set((s) => log({ ...s, currentTermId: termId }, 'تحديد الفصل الحالي', termName(s, termId))),

    addTeacher: async (name, subject) => set((s) => log({
      ...s,
      teachers: [...s.teachers, { id: nextId('th'), name, subject, colorIdx: s.teachers.length % 8, active: true, codeState: 'revoked', codeIssuedAt: new Date(s.now).toISOString() }],
    }, 'إضافة معلمة', name)),
    updateTeacher: async (id, patch: Partial<Pick<Teacher, 'name' | 'subject' | 'colorIdx' | 'active'>>) => set((s) => {
      const t = s.teachers.find((x) => x.id === id)!
      const act = patch.active !== undefined && patch.active !== t.active ? (patch.active ? 'تفعيل معلمة' : 'إيقاف معلمة') : 'تعديل بيانات معلمة'
      return log({ ...s, teachers: s.teachers.map((x) => (x.id === id ? { ...x, ...patch } : x)) }, act, patch.name ?? t.name)
    }),
    reissueCode: async (id) => {
      const code = randomCode()
      set((s) => log({ ...s, teachers: s.teachers.map((x) => (x.id === id ? { ...x, codeState: 'active', codeIssuedAt: new Date(s.now).toISOString() } : x)) }, 'إعادة إصدار رمز دخول', s.teachers.find((x) => x.id === id)?.name ?? ''))
      return code
    },
    revokeCode: async (id) => set((s) => log({ ...s, teachers: s.teachers.map((x) => (x.id === id ? { ...x, codeState: 'revoked' } : x)) }, 'إلغاء رمز دخول', s.teachers.find((x) => x.id === id)?.name ?? '')),

    createArchive: async ({ yearId, termId, teacherId, title }: NewArchiveInput) => {
      const id = nextId('ar')
      set((s) => log({
        ...s,
        archives: [{
          id, title, yearId, termId, teacherId, createdAt: new Date(s.now).toISOString(), status: 'creating', sizeBytes: 0, entries: 0, sha256: '',
          checks: [
            { label: 'اكتمال الملفات المدرجة', state: 'pending' }, { label: 'مطابقة حجم الأرشيف', state: 'pending' },
            { label: 'مطابقة بصمات الملفات (SHA-256)', state: 'pending' }, { label: 'سلامة بيان manifest.csv', state: 'pending' },
          ], sent: false,
        }, ...s.archives],
      }, 'إنشاء أرشيف', title))
      setTimeout(() => set((s) => ({
        ...s,
        archives: s.archives.map((a) => (a.id === id ? { ...a, status: 'awaiting_verification', sizeBytes: 412_000_000 + Math.floor(Math.random() * 90_000_000), entries: 96, sha256: fakeHash(id) } : a)),
      })), 1800)
    },
    verifyArchive: async (id) => {
      set((s) => ({ ...s, archives: s.archives.map((a) => (a.id === id ? { ...a, status: 'creating', checks: a.checks.map((c) => ({ ...c, state: 'pending' as const })) } : a)) }))
      setTimeout(() => set((s) => {
        const a = s.archives.find((x) => x.id === id)
        if (!a) return s
        const next = { ...s, archives: s.archives.map((x) => (x.id === id ? { ...x, status: 'verified' as const, checks: x.checks.map((c) => ({ ...c, state: 'ok' as const })) } : x)) }
        return log(next, 'التحقق من أرشيف', a.title, 'نجح التحقق')
      }), 2200)
    },
    markSent: async (id) => set((s) => log({ ...s, archives: s.archives.map((a) => (a.id === id ? { ...a, sent: true } : a)) }, 'تأكيد اكتمال إرسال أرشيف', s.archives.find((a) => a.id === id)?.title ?? '')),
    ackBackup: async (id, note) => set((s) => log({ ...s, archives: s.archives.map((a) => (a.id === id ? { ...a, backupAck: { at: new Date(s.now).toISOString(), note } } : a)) }, 'إقرار نسخة احتياطية ثانية', s.archives.find((a) => a.id === id)?.title ?? '', note)),
    deleteArchive: async (id, by) => set((s) => log({ ...s, archives: s.archives.map((a) => (a.id === id ? { ...a, deleted: true } : a)) }, 'طلب حذف نهائي', s.archives.find((a) => a.id === id)?.title ?? '', `أكّدته: ${by}`)),
  }
  return repo
}
