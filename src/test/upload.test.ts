import { describe, expect, it } from 'vitest'
import {
  UploadError, UploadLedger, canTransition, computeExpiresAt, extMatchesSignature, isTerminal,
  PROVISIONAL_UPLOAD_WINDOW_MINUTES, parseWindowMinutes, sniffSignature, verifyUpload, windowStatus,
} from '../lib/upload'
import type { SubmissionGate, UploadErrorCode } from '../lib/upload'
import { defaultSettings } from '../lib/storage/settings'

const settings = defaultSettings()
const caps = { maxObjectBytes: null }
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37])
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00])
const SHA = 'a'.repeat(64)
const WIN = 120

function codeOf(fn: () => unknown): UploadErrorCode | 'no_error' {
  try {
    fn()
    return 'no_error'
  } catch (e) {
    return e instanceof UploadError ? e.code : 'no_error'
  }
}

function make(gate: () => SubmissionGate = () => 'on_time') {
  const clock = { t: 1_000_000 }
  const ledger = new UploadLedger({ settings, caps, windowMinutes: WIN, now: () => clock.t, gate })
  return { clock, ledger }
}
const start = (l: UploadLedger, over: Partial<Parameters<UploadLedger['start']>[0]> = {}) =>
  l.start({ teacherId: 't1', termId: 'term1', slotId: 'slot1', name: 'plan.pdf', size: 8, idempotencyKey: 'k-1', ...over })
const good = { sizeBytes: 8, sha256: SHA, head: PDF }

describe('حالات الجلسة (5.1)', () => {
  it('الانتقالات المسموحة والممنوعة', () => {
    expect(canTransition('started', 'uploaded')).toBe(true)
    expect(canTransition('started', 'expired')).toBe(true)
    expect(canTransition('uploaded', 'expired')).toBe(false)
    expect(canTransition('validating', 'accepted')).toBe(true)
    expect(canTransition('accepted', 'rejected')).toBe(false)
    expect(canTransition('expired', 'started')).toBe(false)
    expect(canTransition('started', 'accepted')).toBe(false)
    expect(canTransition('started', 'cancelled')).toBe(true)
    // 5.A: الإفراج المسجَّل للمالكة (يفرضه الخادم) يجعل uploaded/validating → cancelled ممكنًا؛ والعودة validating → uploaded للاستئناف.
    expect(canTransition('uploaded', 'cancelled')).toBe(true)
    expect(canTransition('validating', 'uploaded')).toBe(true)
    expect(canTransition('uploaded', 'expired')).toBe(false)
    expect(canTransition('uploaded', 'started')).toBe(false)
    expect(canTransition('cancelled', 'started')).toBe(false)
  })
  it('الحالات النهائية', () => {
    expect(isTerminal('accepted') && isTerminal('rejected') && isTerminal('expired') && isTerminal('cancelled')).toBe(true)
    expect(isTerminal('started') || isTerminal('uploaded') || isTerminal('validating')).toBe(false)
  })
})

describe('نافذة الرفع (مؤقتة، إعداد)', () => {
  it('القيمة الافتراضية ساعتان وتحليل القيم', () => {
    expect(PROVISIONAL_UPLOAD_WINDOW_MINUTES).toBe(120)
    expect(parseWindowMinutes('90')).toBe(90)
    expect(parseWindowMinutes(0)).toBeNull()
    expect(parseWindowMinutes('1.5')).toBeNull()
    expect(parseWindowMinutes(-5)).toBeNull()
  })
  it('الانقضاء عند اللحظة نفسها لا بعدها', () => {
    const exp = computeExpiresAt(0, 120)
    expect(exp).toBe(7_200_000)
    expect(windowStatus(exp, exp - 1)).toEqual({ expired: false, remainingMs: 1 })
    expect(windowStatus(exp, exp)).toEqual({ expired: true, remainingMs: 0 })
  })
})

describe('توقيع الملف', () => {
  it('يتعرف على الأنواع ويطابق الامتداد', () => {
    expect(sniffSignature(PDF)).toBe('pdf')
    expect(sniffSignature(PNG)).toBe('png')
    expect(sniffSignature(ZIP)).toBe('zip')
    expect(sniffSignature(new Uint8Array([1, 2, 3]))).toBeNull()
    expect(extMatchesSignature('docx', 'zip')).toBe(true)
    expect(extMatchesSignature('pdf', 'png')).toBe(false)
    expect(extMatchesSignature('exe', 'zip')).toBe(false)
    expect(extMatchesSignature('pdf', null)).toBe(false)
  })
})

describe('التحقق الخادمي المرجعي', () => {
  const d = { name: 'plan.pdf', size: 8 }
  it('يقبل ملفًا سليمًا', () => {
    const r = verifyUpload(d, good, settings, caps)
    expect(r.ok).toBe(true)
  })
  it('يرفض بالأسباب الصحيحة', () => {
    const reason = (o: typeof good, dd = d) => {
      const r = verifyUpload(dd, o, settings, caps)
      return r.ok ? 'ok' : r.reason
    }
    expect(reason({ ...good, sizeBytes: 0 })).toBe('empty')
    expect(reason({ ...good, sizeBytes: 50_000_001 })).toBe('too_large')
    expect(reason({ ...good, sizeBytes: 9 })).toBe('size_mismatch')
    expect(reason({ ...good, sha256: 'xyz' })).toBe('hash_invalid')
    expect(reason({ ...good, head: PNG })).toBe('signature_mismatch')
    expect(reason(good, { name: 'run.exe', size: 8 })).toBe('type_not_allowed')
  })
  it('حد المزوّد الأصغر يغلب', () => {
    const r = verifyUpload(d, good, settings, { maxObjectBytes: 5 })
    expect(r.ok ? 'ok' : r.reason).toBe('too_large')
  })
})

describe('سجل الرفع المرجعي', () => {
  it('نفس مفتاح التكرار لا ينشئ جلسة ثانية ويُسجَّل', () => {
    const { ledger } = make()
    const a = start(ledger)
    const b = start(ledger)
    expect(b.id).toBe(a.id)
    expect(ledger.listAttempts().map((x) => x.outcome)).toEqual(['started', 'duplicate_start'])
  })
  it('نفس المفتاح ببيانات مختلفة يُرفض', () => {
    const { ledger } = make()
    start(ledger)
    expect(codeOf(() => start(ledger, { size: 9 }))).toBe('idempotency_conflict')
    expect(codeOf(() => start(ledger, { idempotencyKey: '  ' }))).toBe('bad_idempotency_key')
  })
  it('الرفض عند البدء يُسجَّل محاولة ولا ينشئ جلسة', () => {
    const { ledger } = make()
    expect(codeOf(() => start(ledger, { size: 50_000_001, idempotencyKey: 'k-2' }))).toBe('too_large')
    expect(codeOf(() => start(ledger, { name: 'a.exe', idempotencyKey: 'k-3' }))).toBe('type_not_allowed')
    expect(ledger.listAttempts().map((x) => `${x.outcome}:${x.reason}`)).toEqual(['start_rejected:too_large', 'start_rejected:type_not_allowed'])
    expect(ledger.getSession('ses-1')).toBeNull()
  })
  it('موعد مغلق يمنع البدء', () => {
    const { ledger } = make(() => 'closed')
    expect(codeOf(() => start(ledger))).toBe('deadline_closed')
  })
  it('إتمام ناجح ينشئ إصدارًا واحدًا، وإعادة الإتمام لا تكرره', () => {
    const { ledger } = make()
    const s = start(ledger)
    const r1 = ledger.complete(s.id, 't1', good)
    const r2 = ledger.complete(s.id, 't1', good)
    expect(r1.version.id).toBe(r2.version.id)
    expect(r1.version.no).toBe(1)
    expect(ledger.listVersions('t1', 'term1', 'slot1').length).toBe(1)
    expect(r1.session.state).toBe('accepted')
    expect(ledger.listAttempts().map((x) => x.outcome)).toEqual(['started', 'uploaded', 'accepted', 'duplicate_complete'])
  })
  it('معلمة أخرى لا تصل إلى الجلسة ولا يُكشف وجودها', () => {
    const { ledger } = make()
    const s = start(ledger)
    expect(codeOf(() => ledger.complete(s.id, 't2', good))).toBe('not_found')
    expect(codeOf(() => ledger.complete('ses-999', 't2', good))).toBe('not_found')
    expect(ledger.getSession(s.id)?.state).toBe('started')
    expect(ledger.listAttempts().filter((x) => x.outcome === 'denied').length).toBe(2)
  })
  it('الانقضاء: قبل الحد يُقبل، عند الحد ينتهي ولا ينشأ إصدار', () => {
    const a = make()
    const s1 = start(a.ledger)
    a.clock.t = s1.expiresAt - 1
    expect(a.ledger.complete(s1.id, 't1', good).session.state).toBe('accepted')
    const b = make()
    const s2 = start(b.ledger)
    b.clock.t = s2.expiresAt
    expect(codeOf(() => b.ledger.complete(s2.id, 't1', good))).toBe('expired')
    expect(b.ledger.getSession(s2.id)?.state).toBe('expired')
    expect(b.ledger.listVersions('t1', 'term1', 'slot1').length).toBe(0)
    expect(codeOf(() => b.ledger.complete(s2.id, 't1', good))).toBe('expired')
  })
  it('sweepExpired ينهي الجلسات المنقضية فقط', () => {
    const { clock, ledger } = make()
    const a = start(ledger)
    clock.t += 60 * 60_000
    const b = start(ledger, { idempotencyKey: 'k-2', slotId: 'slot2' })
    clock.t = a.expiresAt
    expect(ledger.sweepExpired()).toBe(1)
    expect(ledger.getSession(a.id)?.state).toBe('expired')
    expect(ledger.getSession(b.id)?.state).toBe('started')
  })
  it('حالة التسليم تُثبَّت عند البدء ولو تغيّر الموعد قبل الإتمام (A-33)', () => {
    let g: SubmissionGate = 'on_time'
    const { ledger } = make(() => g)
    const s = start(ledger)
    g = 'late'
    expect(ledger.complete(s.id, 't1', good).version.statusSnapshot).toBe('on_time')
    expect(start(ledger, { idempotencyKey: 'k-2' }).statusAtStart).toBe('late')
  })
  it('الرفض بعد الوصول ينهي الجلسة بلا إصدار ولا يعاد استعمالها', () => {
    const { ledger } = make()
    const s = start(ledger)
    expect(codeOf(() => ledger.complete(s.id, 't1', { ...good, head: PNG }))).toBe('signature_mismatch')
    expect(ledger.getSession(s.id)?.state).toBe('rejected')
    expect(ledger.getSession(s.id)?.rejectReason).toBe('signature_mismatch')
    expect(codeOf(() => ledger.complete(s.id, 't1', good))).toBe('session_closed')
    expect(ledger.listVersions('t1', 'term1', 'slot1').length).toBe(0)
  })
  it('ترقيم الإصدارات يتصاعد لكل خانة ومعلمة', () => {
    const { ledger } = make()
    const s1 = start(ledger)
    expect(ledger.complete(s1.id, 't1', good).version.no).toBe(1)
    const s2 = start(ledger, { idempotencyKey: 'k-2' }) // بعد قبول الأولى (C-5): جلسة جديدة = إصدار جديد
    const s3 = start(ledger, { idempotencyKey: 'k-3', slotId: 'slot2' })
    expect(ledger.complete(s2.id, 't1', good).version.no).toBe(2)
    expect(ledger.complete(s3.id, 't1', good).version.no).toBe(1)
  })
})

describe('جلسة نشطة واحدة لكل خانة (C-5، مقترح مبدئي — A-56)', () => {
  it('إعادة المحاولة بمفتاح جديد وملف مطابق تُعيد الجلسة نفسها دون تمديد النافذة', () => {
    const { clock, ledger } = make()
    const a = start(ledger)
    clock.t += 30 * 60_000
    const b = start(ledger, { idempotencyKey: 'k-2' })
    expect(b.id).toBe(a.id)
    expect(b.startedAt).toBe(a.startedAt)
    expect(b.expiresAt).toBe(a.expiresAt)
    expect(ledger.listAttempts().map((x) => `${x.outcome}:${x.reason}`)).toEqual(['started:null', 'duplicate_start:active_reused'])
  })
  it('ملف مختلف أثناء جلسة نشطة يُرفض (active_session_exists) ويمكن إلغاء الجلسة أولًا', () => {
    const { ledger } = make()
    const a = start(ledger)
    expect(codeOf(() => start(ledger, { idempotencyKey: 'k-2', name: 'other.pdf' }))).toBe('active_session_exists')
    expect(ledger.cancel(a.id, 't1').state).toBe('cancelled')
    const b = start(ledger, { idempotencyKey: 'k-3', name: 'other.pdf' })
    expect(b.id).not.toBe(a.id)
  })
  it('الخانات والمعلمات الأخرى مستقلة', () => {
    const { ledger } = make()
    start(ledger)
    expect(start(ledger, { idempotencyKey: 'k-2', slotId: 'slot2' }).slotId).toBe('slot2')
    expect(start(ledger, { idempotencyKey: 'k-3', teacherId: 't2' }).teacherId).toBe('t2')
  })
  it('جلسة منقضية لا تحجز الخانة: تُنهى كسولًا وتبدأ الجديدة بوقت بدء جديد', () => {
    const { clock, ledger } = make()
    const a = start(ledger)
    clock.t = a.expiresAt
    const b = start(ledger, { idempotencyKey: 'k-2' })
    expect(b.id).not.toBe(a.id)
    expect(b.startedAt).toBe(a.expiresAt)
    expect(ledger.getSession(a.id)?.state).toBe('expired')
    expect(ledger.listAttempts().map((x) => x.outcome)).toEqual(['started', 'expired', 'started'])
  })
  it('بعد الرفض أو القبول تُفتح الخانة لجلسة جديدة', () => {
    const { ledger } = make()
    const a = start(ledger)
    expect(codeOf(() => ledger.complete(a.id, 't1', { ...good, head: PNG }))).toBe('signature_mismatch')
    const b = start(ledger, { idempotencyKey: 'k-2' })
    expect(ledger.complete(b.id, 't1', good).version.no).toBe(1)
    const c = start(ledger, { idempotencyKey: 'k-3' })
    expect(ledger.complete(c.id, 't1', good).version.no).toBe(2)
  })
  it('الإلغاء: لا يُتمّ بعده ولا يُلغى المقبول ولا تلغي معلمة أخرى جلسة غيرها', () => {
    const { ledger } = make()
    const a = start(ledger)
    expect(codeOf(() => ledger.cancel(a.id, 't2'))).toBe('not_found')
    ledger.cancel(a.id, 't1')
    expect(codeOf(() => ledger.complete(a.id, 't1', good))).toBe('session_closed')
    expect(codeOf(() => ledger.cancel(a.id, 't1'))).toBe('session_closed')
    const b = start(ledger, { idempotencyKey: 'k-2' })
    ledger.complete(b.id, 't1', good)
    expect(codeOf(() => ledger.cancel(b.id, 't1'))).toBe('session_closed')
  })
  it('إتمام جلسة بدأت قبل الإغلاق النهائي يُقبل بحالة البدء (سلوك مرجعي مقترح لـD-8، غير معتمد)', () => {
    let g: SubmissionGate = 'on_time'
    const { ledger } = make(() => g)
    const a = start(ledger)
    g = 'closed'
    expect(ledger.complete(a.id, 't1', good).version.statusSnapshot).toBe('on_time')
    expect(codeOf(() => start(ledger, { idempotencyKey: 'k-2' }))).toBe('deadline_closed')
  })
})

describe('5.A — تأخر التحقق لا يرفض، والاستئناف مسجَّل', () => {
  it('لا يوجد سبب رفض stalled، والقياس غير المتاح يُبقي الجلسة uploaded دون رفض', () => {
    const { ledger } = make()
    const s = start(ledger)
    expect(codeOf(() => ledger.complete(s.id, 't1', null))).toBe('verification_pending')
    expect(ledger.getSession(s.id)?.state).toBe('uploaded')
    expect(ledger.getSession(s.id)?.rejectReason).toBeNull()
    expect(ledger.listAttempts().filter((a) => a.outcome === 'validation_deferred').length).toBe(1)
    expect(ledger.listVersions('t1', 'term1', 'slot1').length).toBe(0)
  })
  it('الاستئناف بنفس الجلسة ينجح بعد أي وقت دون خضوع للنافذة، وبإصدار واحد', () => {
    const { clock, ledger } = make()
    const s = start(ledger)
    expect(codeOf(() => ledger.complete(s.id, 't1', null))).toBe('verification_pending')
    clock.t += WIN * 60_000 * 10 // أضعاف النافذة: لا انقضاء بعد وصول الملف
    const r = ledger.complete(s.id, 't1', good)
    expect(r.session.state).toBe('accepted')
    expect(r.version.no).toBe(1)
    expect(r.version.submittedAt).toBe(s.startedAt)
    expect(ledger.complete(s.id, 't1', good).version.id).toBe(r.version.id)
  })
  it('فشل متكرر في القياس لا يرفض ولا يكرر الإصدارات', () => {
    const { ledger } = make()
    const s = start(ledger)
    for (let i = 0; i < 3; i += 1) expect(codeOf(() => ledger.complete(s.id, 't1', null))).toBe('verification_pending')
    expect(ledger.getSession(s.id)?.state).toBe('uploaded')
    expect(ledger.listAttempts().filter((a) => a.outcome === 'validation_deferred').length).toBe(3)
  })
  it('رفض حقيقي للمحتوى (توقيع خاطئ) يبقى رفضًا بسبب المحتوى لا التأخير', () => {
    const { ledger } = make()
    const s = start(ledger)
    expect(codeOf(() => ledger.complete(s.id, 't1', { ...good, head: PNG }))).toBe('signature_mismatch')
    expect(ledger.getSession(s.id)?.state).toBe('rejected')
  })
  it('recoverStuck: validating العالقة تعود إلى uploaded ولا ترفض، وغير العالقة تبقى', () => {
    const { clock, ledger } = make()
    const s = start(ledger)
    // نحاكي تعطل المعالج بعد دخول validating: نستدعي الانتقال الخاص عبر مسار الاستئناف الفاشل جزئيًا.
    const rec = ledger.getSession(s.id) as unknown as { state: string; uploadedAt: number | null; validatingAt: number | null }
    rec.state = 'validating'
    rec.uploadedAt = clock.t
    rec.validatingAt = clock.t
    expect(ledger.recoverStuck(60_000)).toBe(0)
    clock.t += 60_000
    expect(ledger.recoverStuck(60_000)).toBe(1)
    expect(ledger.getSession(s.id)?.state).toBe('uploaded')
    expect(ledger.listAttempts().filter((a) => a.outcome === 'validation_recovered').length).toBe(1)
    expect(ledger.complete(s.id, 't1', good).session.state).toBe('accepted')
  })
  it('validating قيد المعالجة: إتمام متزامن يُمنع (session_busy)', () => {
    const { clock, ledger } = make()
    const s = start(ledger)
    const rec = ledger.getSession(s.id) as unknown as { state: string; uploadedAt: number | null; validatingAt: number | null }
    rec.state = 'validating'
    rec.uploadedAt = clock.t
    rec.validatingAt = clock.t
    expect(codeOf(() => ledger.complete(s.id, 't1', good))).toBe('session_busy')
  })
  it('listPendingVerification تعرض الجلسات المنتظرة بعمرها ولا تنهيها', () => {
    const { clock, ledger } = make()
    const s = start(ledger)
    expect(codeOf(() => ledger.complete(s.id, 't1', null))).toBe('verification_pending')
    clock.t += 5_000
    const list = ledger.listPendingVerification()
    expect(list.length).toBe(1)
    expect(list[0].ageMs).toBe(5_000)
    expect(ledger.getSession(s.id)?.state).toBe('uploaded')
  })
  it('جلسة عالقة تحجز الخانة (session_busy) حتى إفراج المالكة بملاحظة إلزامية', () => {
    const { ledger } = make()
    const s = start(ledger)
    expect(codeOf(() => ledger.complete(s.id, 't1', null))).toBe('verification_pending')
    expect(codeOf(() => start(ledger, { idempotencyKey: 'k-2' }))).toBe('session_busy')
    expect(codeOf(() => ledger.ownerRelease(s.id, '   '))).toBe('note_required')
    expect(ledger.getSession(s.id)?.state).toBe('uploaded')
    const rel = ledger.ownerRelease(s.id, 'تعطل التخزين؛ الملف لم يصل سليمًا')
    expect(rel.state).toBe('cancelled')
    expect(rel.releaseNote).toBe('تعطل التخزين؛ الملف لم يصل سليمًا')
    expect(ledger.listAttempts().filter((a) => a.outcome === 'owner_released').length).toBe(1)
    expect(start(ledger, { idempotencyKey: 'k-2' }).state).toBe('started')
  })
  it('الإفراج لا يصح إلا لجلسة بانتظار التحقق، وليس تعديلًا لجلسة نهائية', () => {
    const { ledger } = make()
    const s = start(ledger)
    expect(codeOf(() => ledger.ownerRelease(s.id, 'ملاحظة'))).toBe('not_pending') // started
    ledger.complete(s.id, 't1', good)
    expect(codeOf(() => ledger.ownerRelease(s.id, 'ملاحظة'))).toBe('not_pending') // accepted
    expect(codeOf(() => ledger.ownerRelease('ses-x', 'ملاحظة'))).toBe('not_found')
  })
  it('المعلمة لا تلغي بنفسها جلسة وصل ملفها (الإلغاء started فقط)', () => {
    const { ledger } = make()
    const s = start(ledger)
    expect(codeOf(() => ledger.complete(s.id, 't1', null))).toBe('verification_pending')
    expect(codeOf(() => ledger.cancel(s.id, 't1'))).toBe('session_busy')
  })
})

describe('5.A — مفتاح التكرار لا يُحيي جلسة منتهية أو ملغاة', () => {
  it('نفس المفتاح بعد الانقضاء يُعيد جلسة expired (لا started) ولا يمدد النافذة', () => {
    const { clock, ledger } = make()
    const s = start(ledger)
    clock.t = s.expiresAt
    const again = start(ledger)
    expect(again.id).toBe(s.id)
    expect(again.state).toBe('expired')
    expect(again.expiresAt).toBe(s.expiresAt)
    expect(codeOf(() => ledger.complete(s.id, 't1', good))).toBe('expired')
    expect(ledger.listVersions('t1', 'term1', 'slot1').length).toBe(0)
  })
  it('نفس المفتاح بعد الإلغاء يُعيد جلسة cancelled ولا يُنشئ جديدة؛ والمحاولة الجديدة بمفتاح جديد وبوقت بدء جديد', () => {
    const { clock, ledger } = make()
    const s = start(ledger)
    ledger.cancel(s.id, 't1')
    clock.t += 1_000
    const again = start(ledger)
    expect(again.id).toBe(s.id)
    expect(again.state).toBe('cancelled')
    const fresh = start(ledger, { idempotencyKey: 'k-new' })
    expect(fresh.id).not.toBe(s.id)
    expect(fresh.state).toBe('started')
    expect(fresh.startedAt).toBe(clock.t)
  })
  it('نفس المفتاح بعد الرفض يُعيد جلسة rejected ولا يعيد المحاولة', () => {
    const { ledger } = make()
    const s = start(ledger)
    expect(codeOf(() => ledger.complete(s.id, 't1', { ...good, sizeBytes: 9 }))).toBe('size_mismatch')
    const again = start(ledger)
    expect(again.id).toBe(s.id)
    expect(again.state).toBe('rejected')
    expect(ledger.listVersions('t1', 'term1', 'slot1').length).toBe(0)
  })
  it('نفس المفتاح بعد القبول يُعيد جلسة accepted دون إصدار ثانٍ', () => {
    const { ledger } = make()
    const s = start(ledger)
    ledger.complete(s.id, 't1', good)
    expect(start(ledger).state).toBe('accepted')
    expect(ledger.listVersions('t1', 'term1', 'slot1').length).toBe(1)
  })
})

describe('5.A — دليل أول البايتات (T1) معلوماتي ولا يغيّر قواعد التأخير', () => {
  const DEADLINE = 1_000_000 + 30 * 60_000 // بعد 30 دقيقة من بدء الجلسة
  const gate = (at: number): SubmissionGate => (at < DEADLINE ? 'on_time' : 'late')
  it('تسجيل T1 لا يغيّر statusAtStart ولا submittedAt، ويُكتب مرة واحدة', () => {
    const { ledger } = make(() => 'on_time')
    const s = start(ledger)
    ledger.recordFirstByteEvidence(s.id, s.startedAt + 1_000, 'worker_first_chunk')
    ledger.recordFirstByteEvidence(s.id, s.startedAt + 9_000, 'other')
    const got = ledger.getSession(s.id)
    expect(got?.firstByteEvidenceAt).toBe(s.startedAt + 1_000)
    expect(got?.firstByteEvidenceSource).toBe('worker_first_chunk')
    expect(got?.statusAtStart).toBe('on_time')
    expect(ledger.complete(s.id, 't1', good).version.submittedAt).toBe(s.startedAt)
  })
  it('دليل يسبق البدء أو بلا مصدر لا يُسجَّل', () => {
    const { ledger } = make()
    const s = start(ledger)
    ledger.recordFirstByteEvidence(s.id, s.startedAt - 1, 'src')
    expect(ledger.getSession(s.id)?.firstByteEvidenceAt).toBeNull()
    expect(codeOf(() => ledger.recordFirstByteEvidence(s.id, s.startedAt + 1, ' '))).toBe('note_required')
  })
  it('timingComparison: يُظهر متى يختلف الحكم بين T0 وT1 (حجز موعد بفتح الجلسة)', () => {
    const clock = { t: 1_000_000 }
    const ledger = new UploadLedger({ settings, caps, windowMinutes: WIN, now: () => clock.t, gate })
    const s = start(ledger)
    expect(s.statusAtStart).toBe('on_time') // T0 قبل الموعد
    expect(ledger.timingComparison(s.id).differs).toBe(false) // لا دليل بعد
    ledger.recordFirstByteEvidence(s.id, DEADLINE + 60_000, 'worker_first_chunk') // أول بايتات بعد الموعد
    const cmp = ledger.timingComparison(s.id)
    expect(cmp.t0).toBe('on_time')
    expect(cmp.t1).toBe('late')
    expect(cmp.differs).toBe(true)
    expect(ledger.getSession(s.id)?.statusAtStart).toBe('on_time') // ما زالت قاعدة T0 هي المعمول بها
  })
})

describe('5.B — وراثة وقت البدء بإجراء صريح من المالكة فقط', () => {
  const DEADLINE = 1_000_000 + 10 * 60_000
  const gate = (at: number): SubmissionGate => (at < DEADLINE ? 'on_time' : at < DEADLINE + 3_600_000 ? 'late' : 'closed')
  const mk = () => {
    const clock = { t: 1_000_000 }
    return { clock, ledger: new UploadLedger({ settings, caps, windowMinutes: WIN, now: () => clock.t, gate }) }
  }
  const stuck = (l: UploadLedger, id: string) => {
    expect(codeOf(() => l.complete(id, 't1', null))).toBe('verification_pending')
  }
  it('إفراج عادي (بلا علامة عطل منصة) لا يورِّث شيئًا: الجلسة الجديدة تُحسب بوقتها وقد تكون متأخرة أو مغلقة', () => {
    const { clock, ledger } = mk()
    const s = start(ledger)
    stuck(ledger, s.id)
    ledger.ownerRelease(s.id, 'ملاحظة')
    clock.t = DEADLINE + 60_000
    const n = start(ledger, { idempotencyKey: 'k-2' })
    expect(n.statusAtStart).toBe('late')
    expect(n.inheritedFromSessionId).toBeNull()
    expect(n.effectiveStartAt).toBe(n.startedAt)
  })
  it('إفراج بعلامة platformFault: الجلسة التالية ترث الحالة ووقت البدء الأصليين مع علامة وسجل، ولو أُغلق الموعد', () => {
    const { clock, ledger } = mk()
    const s = start(ledger)
    stuck(ledger, s.id)
    ledger.ownerRelease(s.id, 'عطل التخزين', { platformFault: true })
    clock.t = DEADLINE + 3_600_000 + 5_000 // بعد الإغلاق النهائي
    const n = start(ledger, { idempotencyKey: 'k-2' })
    expect(n.state).toBe('started')
    expect(n.statusAtStart).toBe('on_time')
    expect(n.inheritedFromSessionId).toBe(s.id)
    expect(n.effectiveStartAt).toBe(s.startedAt)
    expect(n.startedAt).toBe(clock.t) // نافذة الرفع جديدة
    expect(ledger.listAttempts().filter((a) => a.outcome === 'start_inherited').length).toBe(1)
    expect(ledger.listAttempts().filter((a) => a.outcome === 'owner_released' && (a.reason ?? '').includes('platform_fault')).length).toBe(1)
    const r = ledger.complete(n.id, 't1', good)
    expect(r.version.statusSnapshot).toBe('on_time')
    expect(r.version.submittedAt).toBe(s.startedAt) // وقت البدء الأصلي لا الجديد
  })
  it('الإذن يُستهلك مرة واحدة؛ والخانات والمعلمات الأخرى لا ترثه', () => {
    const { clock, ledger } = mk()
    const s = start(ledger)
    stuck(ledger, s.id)
    ledger.ownerRelease(s.id, 'عطل', { platformFault: true })
    clock.t = DEADLINE + 60_000
    expect(start(ledger, { slotId: 'slot2', idempotencyKey: 'k-a' }).inheritedFromSessionId).toBeNull()
    expect(start(ledger, { teacherId: 't2', idempotencyKey: 'k-b' }).inheritedFromSessionId).toBeNull()
    const n = start(ledger, { idempotencyKey: 'k-2' })
    expect(n.inheritedFromSessionId).toBe(s.id)
    ledger.cancel(n.id, 't1')
    const again = start(ledger, { idempotencyKey: 'k-3' })
    expect(again.inheritedFromSessionId).toBeNull() // استُهلك الإذن
    expect(again.statusAtStart).toBe('late')
  })
  it('سلسلة: إفراج ثانٍ بعلامة عطل يحمل وقت البدء الأصلي الأول', () => {
    const { clock, ledger } = mk()
    const s = start(ledger)
    stuck(ledger, s.id)
    ledger.ownerRelease(s.id, 'عطل 1', { platformFault: true })
    clock.t = DEADLINE + 60_000
    const n = start(ledger, { idempotencyKey: 'k-2' })
    stuck(ledger, n.id)
    ledger.ownerRelease(n.id, 'عطل 2', { platformFault: true })
    clock.t += 60_000
    const m = start(ledger, { idempotencyKey: 'k-3' })
    expect(m.effectiveStartAt).toBe(s.startedAt)
    expect(m.statusAtStart).toBe('on_time')
  })
  it('إعادة إرسال مفتاح الجلسة الوارثة لا تستهلك إذنًا ثانيًا', () => {
    const { clock, ledger } = mk()
    const s = start(ledger)
    stuck(ledger, s.id)
    ledger.ownerRelease(s.id, 'عطل', { platformFault: true })
    clock.t = DEADLINE + 60_000
    const n = start(ledger, { idempotencyKey: 'k-2' })
    expect(start(ledger, { idempotencyKey: 'k-2' }).id).toBe(n.id)
    expect(ledger.listAttempts().filter((a) => a.outcome === 'start_inherited').length).toBe(1)
  })
})

describe('5.B — مهلة validating العالقة إعداد (10 دقائق افتراضيًا)', () => {
  const stuckSession = (ledger: UploadLedger, clock: { t: number }) => {
    const s = start(ledger)
    const rec = ledger.getSession(s.id) as unknown as { state: string; uploadedAt: number | null; validatingAt: number | null }
    rec.state = 'validating'
    rec.uploadedAt = clock.t
    rec.validatingAt = clock.t
    return s
  }
  it('الافتراضي 10 دقائق: لا استرداد قبلها، واسترداد عندها دون رفض', () => {
    const { clock, ledger } = make()
    const s = stuckSession(ledger, clock)
    clock.t += 10 * 60_000 - 1
    expect(ledger.recoverStuck()).toBe(0)
    clock.t += 1
    expect(ledger.recoverStuck()).toBe(1)
    expect(ledger.getSession(s.id)?.state).toBe('uploaded')
    expect(ledger.getSession(s.id)?.rejectReason).toBeNull()
  })
  it('قابلة للتعديل عبر الإعداد وعبر معامل الاستدعاء', () => {
    const clock = { t: 1_000_000 }
    const ledger = new UploadLedger({ settings, caps, windowMinutes: WIN, now: () => clock.t, gate: () => 'on_time', stuckValidatingMinutes: 3 })
    stuckSession(ledger, clock)
    clock.t += 3 * 60_000
    expect(ledger.recoverStuck()).toBe(1)
  })
})
