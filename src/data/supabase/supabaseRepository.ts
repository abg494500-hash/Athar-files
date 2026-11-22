import type { BackendClient, BackendError } from '../../lib/supabase/types'
import type { AuthController } from '../../lib/auth/controller'
import type { CommandName, DataRepository, LoadState, RepositoryMeta, Snapshot } from '../repository'
import type { Teacher } from '../types'
import { UnavailableError, describeLoadError } from '../errors'
import { deriveCurrentTermId, mapArchive, mapAudit, mapSubmissions, mapTeacher, mapTerm, mapYear, stripBidi } from './mappers'

/**
 * مصدر البيانات الحقيقي (Supabase) — المرحلة 3: المالكة والمديرة فقط.
 * - يقرأ ما تسمح به RLS وحدها (لا مفتاح سري، ولا تجاوز للسياسات).
 * - الكتابة المفتوحة فقط ما منحته 003_rls.sql: السنوات والمعلمات والفصول، والمواعيد عبر set_term_deadlines.
 *   أي أمر آخر يُرفض بـUnavailableError (الأرشفة/الحذف/التسليم/الأكواد في مراحلها: A-83) — لا يُنفَّذ بديل ولا وهمي.
 * - فشل التحميل ⇒ load.phase='error' وبيانات فارغة؛ لا رجوع إلى المصدر الوهمي مطلقًا.
 * - لا تبقى بيانات في الذاكرة بعد الخروج.
 * - الكتابات المباشرة (سنة/معلمة/تفعيل سنة) **لا تُسجَّل في سجل العمليات** بعد: log_audit للخادم فقط (يُعالَج في المرحلة 6 حسب القرار).
 */

const PAGE = 1000
const MAX_PAGES = 30

export function emptySnapshot(now: number, load: LoadState = { phase: 'idle' }): Snapshot {
  return { years: [], terms: [], teachers: [], submissions: [], audit: [], archives: [], currentTermId: '', now, session: null, load }
}

const U = {
  submit: 'تسليم المعلمات يتاح في المرحلتين 4 و5 (دخول المعلمة والتخزين).',
  setCurrentTerm: 'الفصل الحالي يُشتق تلقائيًا من المواعيد في هذه المرحلة؛ التحديد اليدوي يتاح لاحقًا.',
  code: 'إصدار أكواد المعلمات وإلغاؤها يتاح في المرحلة 4 (دخول المعلمة).',
  archive: 'الأرشفة والحذف الآمن تتاح في المرحلة 6.',
} as const
export const UNAVAILABLE_IN_STAGE3: Partial<Record<CommandName, string>> = {
  submit: U.submit, setCurrentTerm: U.setCurrentTerm, reissueCode: U.code, revokeCode: U.code,
  createArchive: U.archive, verifyArchive: U.archive, markSent: U.archive, ackBackup: U.archive, deleteArchive: U.archive,
}

class DbFailure extends Error {
  code?: string; status?: number
  constructor(e: BackendError) { super(e.message); this.name = 'DbFailure'; this.code = e.code; this.status = e.status }
}
const fail = (e: BackendError): never => { throw new DbFailure(e) }

export interface RepoOptions { now?: () => number; tickMs?: number | null }

export function createSupabaseRepository(client: BackendClient, auth: AuthController, opts: RepoOptions = {}): DataRepository {
  const clock = opts.now ?? Date.now
  const tickMs = opts.tickMs === undefined ? 60_000 : opts.tickMs
  let state: Snapshot = emptySnapshot(clock())
  const listeners = new Set<() => void>()
  const meta: RepositoryMeta = { kind: 'supabase', persistent: true, baselineNow: clock(), unavailable: UNAVAILABLE_IN_STAGE3 }
  let loadSeq = 0
  let authKey = ''
  let timer: ReturnType<typeof setInterval> | null = null

  const set = (next: Snapshot) => { state = next; listeners.forEach((l) => l()) }
  const authed = () => { const a = auth.getState(); return a.phase === 'authorized' ? a : null }

  /** limit: صفحة واحدة بعدد محدد (لسجل العمليات: آخر 500 قيد). وإلا يُقرأ كل شيء بصفحات. */
  async function fetchAll(table: string, cols: string, order: string, ascending = true, limit?: number): Promise<Record<string, unknown>[]> {
    if (limit) {
      const r = await client.from(table).select(cols).order(order, { ascending }).range(0, limit - 1)
      if (r.error) return fail(r.error)
      return r.data ?? []
    }
    const rows: Record<string, unknown>[] = []
    for (let page = 0; page < MAX_PAGES; page++) {
      const r = await client.from(table).select(cols).order(order, { ascending }).range(page * PAGE, page * PAGE + PAGE - 1)
      if (r.error) return fail(r.error)
      const chunk = r.data ?? []
      rows.push(...chunk)
      if (chunk.length < PAGE) return rows
    }
    throw new DbFailure({ message: `عدد صفوف ${table} يتجاوز الحد المدعوم`, code: 'TOO_MANY_ROWS' })
  }

  async function load(silent: boolean): Promise<void> {
    const me = ++loadSeq
    const a = authed()
    if (!a) return
    if (!silent) set({ ...state, load: { phase: 'loading' } })
    try {
      const [yRows, tRows, thRows, crRows, sRows, vRows, arRows, auRows] = await Promise.all([
        fetchAll('years', 'id,label,is_active', 'label'),
        fetchAll('terms', 'id,year_id,name,ord,deadline_base,deadline_late,deadline_replace', 'id'),
        fetchAll('teachers', 'id,name,subject,is_active,color_idx,created_at,removed_at', 'created_at'),
        fetchAll('teacher_credentials', 'teacher_id,code_state,code_issued_at', 'teacher_id'),
        fetchAll('submissions', 'teacher_id,term_id,slot_id', 'teacher_id'),
        fetchAll('versions', 'id,teacher_id,term_id,slot_id,no,kind,original_name,size_bytes,sha256,url,submitted_at,status_snapshot,replaced_note', 'id'),
        fetchAll('archives', 'id,title,year_id,term_id,teacher_id,created_at,state,size_bytes,entries_count,sha256,checks,download_completed_at,download_hash_verified_at,backup_ack_at,backup_ack_note,deleted_at', 'created_at', false),
        fetchAll('audit_log', 'id,at,actor_role,action,target_type,target_id,detail', 'id', false, 500),
      ])
      if (me !== loadSeq || !authed()) return // تغيّرت الجلسة أو بدأ تحميل أحدث
      const now = clock()
      const years = yRows.map(mapYear)
      const terms = tRows.map(mapTerm)
      const creds = new Map(crRows.map((c) => [String(c.teacher_id), c]))
      // المعلمات المحذوفات (بعد الأرشفة) لا تظهر في الواجهة: لا هي ولا تسليماتها (A-114).
      const removedIds = new Set(thRows.filter((t) => t.removed_at != null).map((t) => String(t.id)))
      const teachers = thRows.filter((t) => t.removed_at == null).map((t) => mapTeacher(t, creds.get(String(t.id))))
      const termName = (id: string) => { const t = terms.find((x) => x.id === id); const y = t && years.find((x) => x.id === t.yearId); return t ? `${t.name} — ${y?.label ?? ''}` : null }
      set({
        years, terms, teachers,
        submissions: mapSubmissions(sRows.filter((r) => !removedIds.has(String(r.teacher_id))), vRows.filter((r) => !removedIds.has(String(r.teacher_id)))),
        audit: auRows.map((r) => mapAudit(r, { termName })),
        archives: arRows.map(mapArchive),
        currentTermId: deriveCurrentTermId(years, terms, now),
        now, session: { role: a.role }, load: { phase: 'ready' },
      })
    } catch (e) {
      if (me !== loadSeq) return
      // لا بيانات وهمية ولا بقايا: خطأ صريح وبيانات فارغة.
      set({ ...emptySnapshot(clock(), { phase: 'error', message: describeLoadError(e) }), session: { role: a.role } })
    }
  }

  function stopTick() { if (timer) { clearInterval(timer); timer = null } }
  function startTick() {
    if (timer || !tickMs) return
    timer = setInterval(() => { if (authed() && state.load.phase === 'ready') set({ ...state, now: clock() }) }, tickMs)
  }

  function onAuth() {
    const a = authed()
    if (!a) {
      authKey = ''; loadSeq++; stopTick()
      if (state.session || state.load.phase !== 'idle' || state.years.length || state.teachers.length) set(emptySnapshot(clock()))
      return
    }
    const key = `${a.userId}|${a.role}`
    if (key === authKey) return
    authKey = key
    set({ ...emptySnapshot(clock(), { phase: 'loading' }), session: { role: a.role } })
    startTick()
    void load(true)
  }
  auth.subscribe(onAuth)
  onAuth()

  /** تنفيذ تعديل ثم إعادة تحميل هادئة؛ فشل التعديل يُرمى للصفحة لتعرضه (لا نجاح وهمي). */
  async function write(fn: () => Promise<void>): Promise<void> {
    if (!authed()) throw new UnavailableError('انتهت الجلسة. سجّلي الدخول من جديد.')
    await fn()
    await load(true)
  }
  const needRows = async (q: PromiseLike<{ data: Record<string, unknown>[] | null; error: BackendError | null }>) => {
    const r = await q
    if (r.error) return fail(r.error)
    if (!r.data || r.data.length === 0) throw new DbFailure({ message: 'no rows', code: 'NO_ROWS' })
  }
  const unavailable = (reason: string) => async (): Promise<never> => { throw new UnavailableError(reason) }

  const repo: DataRepository = {
    meta,
    getSnapshot: () => state,
    subscribe: (l) => { listeners.add(l); return () => { listeners.delete(l) } },

    // الدخول والخروج عبر AuthController فقط؛ لا تُقبل جلسة من الواجهة.
    login: () => { /* لا شيء: الجلسة تُشتق من AuthController بعد التحقق الكامل */ },
    logout: () => { void auth.signOut() },
    setNow: () => { /* الساعة حقيقية */ },
    // إعادة تحميل صامتة إن كانت البيانات جاهزة: لا تُظهر هيكل التحميل فلا تُفكَّك الصفحة المفتوحة (وإلا ضاع الرمز المعروض مرة واحدة بعد الإصدار).
    reload: async () => { if (authed()) await load(state.load.phase === 'ready') },

    submit: unavailable(U.submit),
    setCurrentTerm: unavailable(U.setCurrentTerm),
    reissueCode: unavailable(U.code),
    revokeCode: unavailable(U.code),
    createArchive: unavailable(U.archive),
    verifyArchive: unavailable(U.archive),
    markSent: unavailable(U.archive),
    ackBackup: unavailable(U.archive),
    deleteArchive: unavailable(U.archive),

    updateDeadlines: (termId, d, reason) => write(async () => {
      const r = await client.rpc('set_term_deadlines', { p_term_id: termId, p_base: d.base, p_late: d.late, p_replace: d.replace, p_reason: reason })
      if (r.error) fail(r.error)
    }),

    addYear: (label) => write(async () => {
      const plain = stripBidi(label)
      const start = parseInt(plain.split(/[–-]/)[0], 10)
      if (!Number.isFinite(start)) throw new DbFailure({ message: 'سنة غير صالحة', code: '22P02' })
      const y = await client.from('years').insert({ label: plain }).select('id').single()
      if (y.error || !y.data) return fail(y.error ?? { message: 'no data' })
      const yearId = String(y.data.id)
      const mk = (ord: 1 | 2) => ({
        year_id: yearId, name: ord === 1 ? 'الفصل الدراسي الأول' : 'الفصل الدراسي الثاني', ord,
        ...(ord === 1
          ? { deadline_base: `${start}-10-15`, deadline_late: `${start}-10-22`, deadline_replace: `${start}-11-06` }
          : { deadline_base: `${start + 1}-03-05`, deadline_late: `${start + 1}-03-12`, deadline_replace: `${start + 1}-03-26` }),
      })
      const t = await client.from('terms').insert([mk(1), mk(2)]).select('id')
      if (t.error) {
        // لا حذف للسنوات في القاعدة (حماية A-44): نُبلغ بوضوح بدل التظاهر بالنجاح.
        await load(true)
        throw new DbFailure({ message: 'أُنشئت السنة لكن تعذّر إنشاء فصليها. أعيدي المحاولة أو تواصلي مع المطوّر؛ لا تُحذف السنوات من الواجهة.', code: 'PARTIAL' })
      }
    }),

    setActiveYear: (yearId) => write(async () => {
      // الفهرس years_one_active فوري: نُلغي تفعيل الحالية أولًا ثم نفعّل المطلوبة، ونستعيد القديمة إن فشل الثاني.
      const prev = state.years.find((y) => y.active)?.id
      const off = await client.from('years').update({ is_active: false }).eq('is_active', true).select('id')
      if (off.error) return fail(off.error)
      try {
        await needRows(client.from('years').update({ is_active: true }).eq('id', yearId).select('id'))
      } catch (e) {
        if (prev) await client.from('years').update({ is_active: true }).eq('id', prev).select('id')
        throw e
      }
    }),

    addTeacher: (name, subject) => write(async () => {
      const a = authed()
      const row: Record<string, unknown> = { name, subject, color_idx: state.teachers.length % 8 }
      if (a) row.created_by = a.userId
      const r = await client.from('teachers').insert(row).select('id')
      if (r.error) fail(r.error)
    }),

    updateTeacher: (id, patch: Partial<Pick<Teacher, 'name' | 'subject' | 'colorIdx' | 'active'>>) => write(async () => {
      const v: Record<string, unknown> = {}
      if (patch.name !== undefined) v.name = patch.name
      if (patch.subject !== undefined) v.subject = patch.subject
      if (patch.colorIdx !== undefined) v.color_idx = patch.colorIdx
      if (patch.active !== undefined) v.is_active = patch.active
      if (Object.keys(v).length === 0) return
      await needRows(client.from('teachers').update(v).eq('id', id).select('id'))
    }),
  }
  return repo
}

/** مصدر عند فشل الإعداد (مثل غياب .env.local): خطأ صريح دائم، بلا بيانات، وكل الأوامر مرفوضة. لا رجوع إلى الوهمي. */
export function createUnavailableRepository(message: string): DataRepository {
  const state = emptySnapshot(Date.now(), { phase: 'error', message })
  const rej = async (): Promise<never> => { throw new UnavailableError(message) }
  return {
    meta: { kind: 'unconfigured', persistent: true, baselineNow: state.now },
    getSnapshot: () => state, subscribe: () => () => {},
    login: () => {}, logout: () => {}, setNow: () => {}, reload: async () => {},
    submit: rej, updateDeadlines: rej, setActiveYear: rej, addYear: rej, setCurrentTerm: rej, addTeacher: rej, updateTeacher: rej,
    reissueCode: rej, revokeCode: rej, createArchive: rej, verifyArchive: rej, markSent: rej, ackBackup: rej, deleteArchive: rej,
  }
}
