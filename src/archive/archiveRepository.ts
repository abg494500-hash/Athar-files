import type { DataRepository, Snapshot } from '../data/repository'
import type { Submission, Teacher, Term, Version, Year } from '../data/types'
import { TEACHER_COLORS } from '../data/types'

/** شكل data.js كما يكتبه منسّق البناء (src/lib/yearArchive/build.ts). */
export interface ArchiveData {
  format: string; createdAt: string; entriesDigest: string
  year: { id: string; label: string }
  terms: { id: string; name: string; ord: number; deadlineBase: string; deadlineLate: string; deadlineReplace: string }[]
  teachers: { id: string; name: string; subject: string; active: boolean; colorIdx: number; removedAt: string | null; credential: { state: string; issuedAt: string | null } | null }[]
  slots: { id: string; title: string; optional: boolean; ord: number }[]
  totals: { teachers: number; terms: number; submissions: number; versions: number; files: number; links: number }
  parts?: { no: number; filename: string; sizeBytes: number | null; sha256: string | null; entries: number }[]
  versions: { id: string; teacherId: string; termId: string; slotId: string; no: number; kind: 'file' | 'link'; name: string | null; size: number | null; sha: string; url: string | null; submittedAt: string; status: string; replacedNote: string | null; path: string; part: number }[]
}

export const READ_ONLY_MESSAGE = 'هذه نسخة أرشيف للقراءة فقط؛ لا يمكن تعديل أي شيء فيها.'
const refuse = () => Promise.reject(new Error(READ_ONLY_MESSAGE))

/** مصدر بيانات للقراءة فقط فوق data.js: يُنفّذ عقد DataRepository نفسه فتعمل صفحات أثَر دون تعديل، وكل أمر كتابة يُرفض. */
export function createArchiveRepository(D: ArchiveData): DataRepository {
  const years: Year[] = [{ id: D.year.id, label: D.year.label, active: false }]
  const terms: Term[] = [...D.terms].sort((a, b) => a.ord - b.ord).map((t) => ({
    id: t.id, yearId: D.year.id, name: t.name, order: (t.ord === 2 ? 2 : 1), deadlines: { base: t.deadlineBase, late: t.deadlineLate, replace: t.deadlineReplace },
  }))
  const teachers: Teacher[] = D.teachers.map((t) => ({
    id: t.id, name: t.removedAt ? `${t.name} (محذوفة من المنصة)` : t.name, subject: t.subject,
    colorIdx: Math.abs(t.colorIdx) % TEACHER_COLORS.length, active: true,
    codeState: t.credential?.state === 'active' ? 'active' : 'revoked', codeIssuedAt: t.credential?.issuedAt ?? D.createdAt,
  }))
  const groups = new Map<string, Submission>()
  for (const v of [...D.versions].sort((a, b) => a.no - b.no)) {
    const k = `${v.teacherId}|${v.termId}|${v.slotId}`
    const ver: Version = {
      id: v.id, no: v.no, kind: v.kind, sha256: v.sha, storageKey: v.path, submittedAt: v.submittedAt, status: v.status === 'late' ? 'late' : 'on_time',
      ...(v.name ? { fileName: v.name } : {}), ...(v.size != null ? { size: v.size } : {}), ...(v.url ? { url: v.url } : {}), ...(v.replacedNote ? { replacedNote: v.replacedNote } : {}),
    }
    const g = groups.get(k)
    if (g) g.versions.push(ver)
    else groups.set(k, { teacherId: v.teacherId, termId: v.termId, slotId: v.slotId as Submission['slotId'], versions: [ver] })
  }
  const snap: Snapshot = {
    years, terms, teachers, submissions: [...groups.values()], audit: [], archives: [],
    currentTermId: terms[terms.length - 1]?.id ?? '', now: Date.parse(D.createdAt) || 0, session: { role: 'owner' }, load: { phase: 'ready' },
  }
  const noop = () => {}
  return {
    meta: { kind: 'archive', persistent: true, baselineNow: snap.now },
    getSnapshot: () => snap, subscribe: () => noop,
    login: noop, logout: noop, setNow: noop, reload: () => Promise.resolve(),
    submit: refuse, updateDeadlines: refuse, setActiveYear: refuse, addYear: refuse, setCurrentTerm: refuse, addTeacher: refuse, updateTeacher: refuse,
    reissueCode: refuse, revokeCode: refuse, createArchive: refuse, verifyArchive: refuse, markSent: refuse, ackBackup: refuse, deleteArchive: refuse,
  }
}
