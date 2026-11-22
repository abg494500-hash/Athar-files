// مولَّد آليًا من server/objectKey.ts بواسطة scripts/build-edge-function.mjs — لا تعدّليه يدويًا.
// مفاتيح كائنات التخزين — الطبقة الخادمية (الدفعة 2، العمل الأول).
// المبدأ: المفتاح **يُشتق في الخادم فقط** من بيانات موثوقة (جلسة/إصدار)، ولا يختاره العميل ولا يُقبل منه.
// صيغتان فقط (قانونيتان):
//   pending/<teacherId>/<termId>/<slotId>/<sessionId>.<ext>   ← مؤقت، يُشتق من رقم الجلسة (إعادة المحاولة تُنتج المفتاح نفسه)
//   files/<teacherId>/<termId>/<slotId>/v<no>.<ext>           ← نهائي لإصدار مسجَّل، لا يُعاد استعماله
// أي نص لا يطابق إحدى الصيغتين حرفيًا (بعد إعادة البناء) يُرفض، فلا تُقبل أشكال «شبه سليمة».
// لا اعتماديات: يعمل في Node وWorker وDeno. لا يلمس أي خدمة حقيقية.
import { assertSafeKey } from '../src/lib/storage/keys.ts'
import { DEFAULT_ALLOWED_EXTENSIONS } from '../src/lib/storage/settings.ts'

export type ObjectKeyErrorCode =
  | 'bad_id'
  | 'bad_ext'
  | 'bad_version_no'
  | 'bad_key_shape'
  | 'key_too_long'
  | 'scope_mismatch'

export class ObjectKeyError extends Error {
  code: ObjectKeyErrorCode
  constructor(code: ObjectKeyErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code)
    this.name = 'ObjectKeyError'
    this.code = code
  }
}

export const PENDING_PREFIX = 'pending'
export const FINAL_PREFIX = 'files'
/** أقصى طول للمفتاح كاملًا (أقل من حد 512 في assertSafeKey). */
export const MAX_KEY_LENGTH = 255
/** المعرّفات: حروف/أرقام/شرطة/شرطة سفلية فقط، بلا نقاط ولا مسافات، من 1 إلى 64 محرفًا، تبدأ بحرف أو رقم. */
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
/** الامتداد: حروف صغيرة وأرقام فقط (بلا نقطة)، من 1 إلى 8. */
const EXT_RE = /^[a-z0-9]{1,8}$/
/** رقم الإصدار في المفتاح: عدد صحيح موجب بلا أصفار بادئة. */
const NO_RE = /^[1-9][0-9]{0,8}$/

export interface KeyScope {
  teacherId: string
  termId: string
  slotId: string
}

export type ParsedObjectKey =
  | (KeyScope & { kind: 'pending'; sessionId: string; ext: string })
  | (KeyScope & { kind: 'final'; no: number; ext: string })

export function assertId(label: string, v: unknown): string {
  if (typeof v !== 'string' || !ID_RE.test(v)) throw new ObjectKeyError('bad_id', label)
  return v
}

/**
 * يعيد الامتداد بصيغته القانونية (أحرف صغيرة). يرفض ما ليس في القائمة المسموحة.
 * القائمة تُمرَّر من الإعدادات الخادمية؛ الافتراضي هو DEFAULT_ALLOWED_EXTENSIONS (وليس نهائيًا).
 */
export function assertExt(v: unknown, allowed: readonly string[] = DEFAULT_ALLOWED_EXTENSIONS): string {
  if (typeof v !== 'string') throw new ObjectKeyError('bad_ext')
  const e = v.toLowerCase()
  if (!EXT_RE.test(e) || !allowed.includes(e)) throw new ObjectKeyError('bad_ext', e.slice(0, 12))
  return e
}

function finish(key: string): string {
  if (key.length > MAX_KEY_LENGTH) throw new ObjectKeyError('key_too_long')
  assertSafeKey(key) // طبقة أمان عامة مشتركة مع الواجهة (دفاع بطبقتين)
  return key
}

export function buildPendingObjectKey(p: KeyScope & { sessionId: string; ext: string }, allowedExts?: readonly string[]): string {
  return finish([
    PENDING_PREFIX,
    assertId('teacherId', p.teacherId),
    assertId('termId', p.termId),
    assertId('slotId', p.slotId),
    `${assertId('sessionId', p.sessionId)}.${assertExt(p.ext, allowedExts)}`,
  ].join('/'))
}

export function buildFinalObjectKey(p: KeyScope & { no: number; ext: string }, allowedExts?: readonly string[]): string {
  if (!Number.isInteger(p.no) || p.no < 1 || p.no > 999_999_999) throw new ObjectKeyError('bad_version_no')
  return finish([
    FINAL_PREFIX,
    assertId('teacherId', p.teacherId),
    assertId('termId', p.termId),
    assertId('slotId', p.slotId),
    `v${p.no}.${assertExt(p.ext, allowedExts)}`,
  ].join('/'))
}

/**
 * يحلّل مفتاحًا قادمًا من أي مصدر غير موثوق (عميل، سجل، تخزين). يرفض كل ما ليس صيغة قانونية حرفيًا.
 * الامتداد لا يُفحص هنا بالقائمة المسموحة (قد تتغير القائمة لاحقًا والملفات القديمة باقية)، بل بالصيغة فقط.
 */
export function parseObjectKey(key: unknown): ParsedObjectKey {
  if (typeof key !== 'string' || key.length === 0) throw new ObjectKeyError('bad_key_shape')
  if (key.length > MAX_KEY_LENGTH) throw new ObjectKeyError('key_too_long')
  const parts = key.split('/')
  if (parts.length !== 5) throw new ObjectKeyError('bad_key_shape')
  const [prefix, teacherId, termId, slotId, leaf] = parts
  if (prefix !== PENDING_PREFIX && prefix !== FINAL_PREFIX) throw new ObjectKeyError('bad_key_shape')
  for (const [label, id] of [['teacherId', teacherId], ['termId', termId], ['slotId', slotId]] as const) assertId(label, id)
  const dot = leaf.indexOf('.')
  if (dot <= 0 || leaf.indexOf('.', dot + 1) !== -1) throw new ObjectKeyError('bad_key_shape')
  const stem = leaf.slice(0, dot)
  const ext = leaf.slice(dot + 1)
  if (!EXT_RE.test(ext)) throw new ObjectKeyError('bad_ext')
  let parsed: ParsedObjectKey
  if (prefix === PENDING_PREFIX) {
    parsed = { kind: 'pending', teacherId, termId, slotId, sessionId: assertId('sessionId', stem), ext }
  } else {
    if (!stem.startsWith('v') || !NO_RE.test(stem.slice(1))) throw new ObjectKeyError('bad_version_no')
    parsed = { kind: 'final', teacherId, termId, slotId, no: Number(stem.slice(1)), ext }
  }
  // إعادة البناء يجب أن تعيد النص نفسه حرفيًا (يقطع أي شكل غير قانوني غفلنا عنه).
  const rebuilt = parsed.kind === 'pending'
    ? [PENDING_PREFIX, teacherId, termId, slotId, `${parsed.sessionId}.${ext}`].join('/')
    : [FINAL_PREFIX, teacherId, termId, slotId, `v${parsed.no}.${ext}`].join('/')
  if (rebuilt !== key) throw new ObjectKeyError('bad_key_shape')
  return parsed
}

/** يتأكد أن المفتاح يخص المعلمة والفصل والخانة المطلوبة تمامًا (عزل المعلمات). */
export function assertKeyInScope(key: unknown, scope: KeyScope): ParsedObjectKey {
  const k = parseObjectKey(key)
  if (k.teacherId !== scope.teacherId || k.termId !== scope.termId || k.slotId !== scope.slotId) throw new ObjectKeyError('scope_mismatch')
  return k
}

/** يتأكد أن المفتاح هو بالضبط المفتاح المؤقت المشتق لهذه الجلسة؛ أي مفتاح آخر (حتى لو سليم) يُرفض. */
export function assertIsPendingKeyOf(key: unknown, expected: KeyScope & { sessionId: string; ext: string }, allowedExts?: readonly string[]): void {
  if (key !== buildPendingObjectKey(expected, allowedExts)) throw new ObjectKeyError('scope_mismatch', 'pending key is not the one derived for this session')
}
