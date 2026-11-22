// بدائل التشفير لدخول المعلمة. منذ r37 (A-122) الدخول **برمز واحد فقط** (حرفان من الاسم + رقمان، مثل SA-12) بلا رقم سري:
// لذلك حُذفت دوال الـPIN وPBKDF2. الأمان يعتمد على: بصمة HMAC للرمز، حد المحاولات لكل عنوان، وحد عام لكل المحاولات الفاشلة.
// لا اعتماديات خارجية؛ node:crypto فقط. الأسرار (peppers) تُمرَّر من الخارج ولا تُقرأ ولا تُخزَّن هنا ولا تُسجَّل.
import { Buffer } from 'node:buffer'
import { createHash, createHmac, randomBytes, randomInt } from 'node:crypto'

export const MIN_PEPPER_BYTES = 32

export class CryptoConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CryptoConfigError'
  }
}

/** يتحقق أن السر بطول كافٍ (32 بايتًا على الأقل). يرمي دون أن يضمّن السر في الرسالة. */
export function assertPepper(name: string, p: unknown): Buffer {
  // الشرطان كما هما (نوع بايتات صارم + 32 بايتًا على الأقل)؛ الرسالتان منفصلتان فقط لأن رسالة واحدة كانت تُظهر «أقصر من 32» لسرّ طوله كافٍ
  // لكنه من «عالم» (realm) مختلف عن Uint8Array العام (كما في بيئات اختبار تستبدل globals). التشخيص أوضح، والأمان لم يتغيّر.
  if (!(p instanceof Uint8Array)) throw new CryptoConfigError(`${name}: السر ليس Uint8Array/Buffer من بيئة التشغيل نفسها`)
  if (p.byteLength < MIN_PEPPER_BYTES) throw new CryptoConfigError(`${name}: السر أقصر من ${MIN_PEPPER_BYTES} بايتًا`)
  return Buffer.from(p)
}

// ===== صيغة الرمز (A-122، r37): حرفان لاتينيان من أول اسم المعلمة + رقمان عشوائيان، مثل SA-12 =====
export const NAME_CODE_DIGITS = 2
const AR_TO_LATIN: Record<string, string> = {
  'ا': 'A', 'أ': 'A', 'إ': 'A', 'آ': 'A', 'ء': 'A', 'ع': 'A', 'ب': 'B', 'ت': 'T', 'ث': 'T', 'ط': 'T', 'ج': 'J', 'ح': 'H', 'ه': 'H', 'ة': 'H',
  'خ': 'K', 'ك': 'K', 'د': 'D', 'ذ': 'D', 'ض': 'D', 'ر': 'R', 'ز': 'Z', 'ظ': 'Z', 'س': 'S', 'ش': 'S', 'ص': 'S', 'غ': 'G', 'ف': 'F',
  'ق': 'Q', 'ل': 'L', 'م': 'M', 'ن': 'N', 'و': 'W', 'ؤ': 'W', 'ي': 'Y', 'ى': 'Y', 'ئ': 'Y',
}
/** أول حرفين لاتينيين من الاسم (الحروف العربية تُحوَّل بجدول ثابت؛ ما عداها يُهمَل). أقل من حرفين ⇒ يُكمَّل بـX. */
export function namePrefix(name: unknown): string {
  let out = ''
  if (typeof name === 'string') {
    for (const ch of name.normalize('NFKC')) {
      const m = AR_TO_LATIN[ch] ?? (/^[A-Za-z]$/.test(ch) ? ch.toUpperCase() : '')
      if (m) out += m
      if (out.length === 2) break
    }
  }
  return (out + 'XX').slice(0, 2)
}
/** رمز بصيغة SA-12: بادئة الاسم + رقمان عشوائيان آمنان تشفيريًا (randomInt بلا انحياز). */
export function generateNameCode(name: unknown): string {
  let d = ''
  for (let i = 0; i < NAME_CODE_DIGITS; i++) d += String(randomInt(10))
  return `${namePrefix(name)}-${d}`
}
const NAME_CODE_RE = /^[A-Z]{2}[0-9]{2}$/
const toLatinDigits = (s: string) => s.replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0))

/** يطبّع المُدخَل: أحرف كبيرة، يزيل المسافات والشرطات، ويقبل الصيغة XX99 فقط. يعيد null عند الرفض (لا يرمي: المُدخَل غير موثوق). */
export function normalizeCode(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 64) return null
  const s = toLatinDigits(input).toUpperCase().replace(/[\s-]/g, '')
  return NAME_CODE_RE.test(s) ? s : null
}

/** HMAC-SHA256(pepper, الكود المطبَّع) بصيغة hex: قيمة ثابتة للبحث. الرمز قصير (6760 × 10 احتمالًا لكل بادئة ≈ 67,600 رمزًا كليًا) فالبصمة تخفي القيمة عن من يقرأ القاعدة فقط (السرّ pepper خارجها)؛ الحماية من التخمين في حدود المحاولات في TeacherAuthService. */
export function hashCode(pepper: Uint8Array, normalizedCode: string): string {
  return createHmac('sha256', assertPepper('CODE_PEPPER', pepper)).update(normalizedCode, 'utf8').digest('hex')
}

/** رمز جلسة معتم: 32 بايتًا عشوائيًا base64url (≈43 محرفًا). */
export function generateToken(): string {
  return randomBytes(32).toString('base64url')
}

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/
export function isTokenShape(t: unknown): t is string {
  return typeof t === 'string' && TOKEN_RE.test(t)
}

/** SHA-256(token) hex — وحدها تُخزَّن؛ الرمز نفسه لا يُخزَّن ولا يُسجَّل. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/** HMAC للعنوان فقط (لا IP خام في أي سجل). عنوان فارغ/مجهول ⇒ null (لا تقييد بالعنوان). */
export function hashIp(pepper: Uint8Array, ip: unknown): string | null {
  if (typeof ip !== 'string' || ip.length === 0 || ip.length > 64) return null
  return createHmac('sha256', assertPepper('IP_PEPPER', pepper)).update(ip, 'utf8').digest('hex')
}
