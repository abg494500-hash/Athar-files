// بناء مفاتيح التخزين. المفتاح نص آمن: لا «..» ولا شرطات مائلة داخل الأجزاء ولا محارف تحكم.
import { StorageError } from './errors'

const PART = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export function assertSafeKey(key: string): void {
  if (!key || key.length > 512 || key.startsWith('/') || key.includes('//') || key.split('/').some((p) => p === '' || p === '.' || p === '..' || !PART.test(p)))
    throw new StorageError('invalid_key', 'مفتاح التخزين غير آمن')
}

function part(label: string, v: string): string {
  if (!PART.test(v) || v.includes('..')) throw new StorageError('invalid_key', `جزء غير آمن في المفتاح: ${label}`)
  return v
}

/** رمز فريد للمفاتيح المؤقتة قبل تثبيت رقم الإصدار. */
export function newToken(): string {
  const c = typeof crypto !== 'undefined' ? crypto : undefined
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** مفتاح مؤقت لملف لم يُسند له رقم إصدار بعد (يتبع تصميم جلسات الرفع، A-33). */
export function pendingKey(p: { teacherId: string; termId: string; slotId: string; ext: string; token?: string }): string {
  const key = ['pending', part('teacherId', p.teacherId), part('termId', p.termId), part('slotId', p.slotId), `${part('token', p.token ?? newToken())}.${part('ext', p.ext.toLowerCase())}`].join('/')
  assertSafeKey(key)
  return key
}

/** مفتاح نهائي لإصدار مُسنَد: لا يُعاد استعماله (الإصدارات غير قابلة للتعديل). */
export function versionKey(p: { teacherId: string; termId: string; slotId: string; no: number; ext: string }): string {
  if (!Number.isInteger(p.no) || p.no < 1) throw new StorageError('invalid_key', 'رقم الإصدار غير صالح')
  const key = ['files', part('teacherId', p.teacherId), part('termId', p.termId), part('slotId', p.slotId), `v${p.no}.${part('ext', p.ext.toLowerCase())}`].join('/')
  assertSafeKey(key)
  return key
}
