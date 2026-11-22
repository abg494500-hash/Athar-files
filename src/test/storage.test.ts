import { describe, it, expect } from 'vitest'
import { MemoryStorageAdapter } from '../lib/storage/memory'
import { StorageError, describeStorageError } from '../lib/storage/errors'
import { assertSafeKey, pendingKey, versionKey } from '../lib/storage/keys'
import {
  PROVISIONAL_MAX_FILE_BYTES, checkFile, defaultSettings, effectiveMaxBytes, fmtLimit, parseMaxFileBytes, settingsFromEnv, typesLabel,
} from '../lib/storage/settings'
import { hashBlob, sha256Hex } from '../lib/storage/sha256'
import type { DeletionAuthorization } from '../lib/storage/adapter'

const enc = (s: string) => new TextEncoder().encode(s)
async function codeOf(p: Promise<unknown>): Promise<string> {
  try { await p } catch (e) { return e instanceof StorageError ? e.code : `other:${String(e)}` }
  return 'no-error'
}
const caps = { maxObjectBytes: null as number | null }

describe('إعدادات الملفات (R-02)', () => {
  it('الافتراضي مؤقت 50,000,000 وليس 104,857,600', () => {
    expect(PROVISIONAL_MAX_FILE_BYTES).toBe(50_000_000)
    expect(defaultSettings().maxFileBytes).toBe(50_000_000)
  })
  it('تحليل القيمة: أعداد صحيحة موجبة فقط', () => {
    expect(parseMaxFileBytes(1024)).toBe(1024)
    expect(parseMaxFileBytes(' 2048 ')).toBe(2048)
    for (const bad of [0, -5, 1.5, NaN, Infinity, 1e20, '', 'abc', '12abc', '-3', null, undefined, {}]) expect(parseMaxFileBytes(bad)).toBeNull()
  })
  it('التجاوز من البيئة صالح فقط وإلا يُتجاهل', () => {
    expect(settingsFromEnv({ VITE_ATHAR_MAX_FILE_BYTES: '1000' }).maxFileBytes).toBe(1000)
    expect(settingsFromEnv({ VITE_ATHAR_MAX_FILE_BYTES: 'xx' }).maxFileBytes).toBe(50_000_000)
    expect(settingsFromEnv(undefined).maxFileBytes).toBe(50_000_000)
  })
  it('الحد الفعلي هو الأصغر بين الإعداد وحد المزوّد', () => {
    const s = { ...defaultSettings(), maxFileBytes: 1000 }
    expect(effectiveMaxBytes(s, { maxObjectBytes: null })).toBe(1000)
    expect(effectiveMaxBytes(s, { maxObjectBytes: 400 })).toBe(400)
    expect(effectiveMaxBytes(s, { maxObjectBytes: 5000 })).toBe(1000)
  })
  it('تغيير الإعداد يغيّر نتيجة الفحص دون تعديل الكود', () => {
    const f = { name: 'a.pdf', size: 600 }
    expect(checkFile(f, { ...defaultSettings(), maxFileBytes: 1000 }, caps).ok).toBe(true)
    const r = checkFile(f, { ...defaultSettings(), maxFileBytes: 500 }, caps)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.code).toBe('too_large')
  })
  it('حد المزوّد الأقل يرفض ملفًا يقبله الإعداد', () => {
    const r = checkFile({ name: 'a.pdf', size: 600 }, { ...defaultSettings(), maxFileBytes: 1000 }, { maxObjectBytes: 500 })
    expect(r.ok === false && r.code).toBe('too_large')
  })
  it('الحدّ نفسه مقبول وما فوقه بواحد مرفوض', () => {
    const s = { ...defaultSettings(), maxFileBytes: 1000 }
    expect(checkFile({ name: 'a.pdf', size: 1000 }, s, caps).ok).toBe(true)
    expect(checkFile({ name: 'a.pdf', size: 1001 }, s, caps).ok).toBe(false)
  })
  it('الأنواع من الإعدادات، والامتداد غير حساس لحالة الأحرف', () => {
    const only = { maxFileBytes: 1000, allowedExtensions: ['pdf'] }
    expect(checkFile({ name: 'A.PDF', size: 5 }, only, caps).ok).toBe(true)
    const r = checkFile({ name: 'a.docx', size: 5 }, only, caps)
    expect(r.ok === false && r.code).toBe('type_not_allowed')
    expect(checkFile({ name: 'a.jpeg', size: 5 }, defaultSettings(), caps).ok).toBe(true)
    expect(checkFile({ name: 'a.pdf', size: 0 }, defaultSettings(), caps).ok === false).toBe(true)
  })
  it('نص الحد للعرض', () => {
    expect(fmtLimit(50_000_000)).toBe('50 ميغابايت')
    expect(fmtLimit(52_428_800)).toBe('50 ميغابايت')
    expect(fmtLimit(104_857_600)).toBe('100 ميغابايت')
    expect(fmtLimit(1_500_000)).toBe('1.5 ميغابايت')
    expect(fmtLimit(2000)).toBe('2 كيلوبايت')
    expect(typesLabel(['jpg', 'jpeg', 'pdf'])).toBe('JPG · PDF')
  })
})

describe('SHA-256', () => {
  it('متجهات معروفة', () => {
    expect(sha256Hex(enc(''))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256Hex(enc('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(sha256Hex(enc('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1')
    expect(sha256Hex(new Uint8Array(1_000_000).fill(0x61))).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0')
  })
  it('hashBlob يطابق الحساب المباشر', async () => {
    expect(await hashBlob(new Blob(['abc']))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})

describe('مفاتيح التخزين', () => {
  it('مفتاح مؤقت ونهائي بصيغة ثابتة', () => {
    expect(pendingKey({ teacherId: 'th1', termId: 't1', slotId: 's1', ext: 'PDF', token: 'abc' })).toBe('pending/th1/t1/s1/abc.pdf')
    expect(versionKey({ teacherId: 'th1', termId: 't1', slotId: 's1', no: 3, ext: 'docx' })).toBe('files/th1/t1/s1/v3.docx')
  })
  it('يرفض المسارات الخطرة', () => {
    for (const bad of ['', '/a', 'a//b', 'a/../b', '../x', 'a/./b', 'a/b c', 'a\\b']) {
      let threw = false
      try { assertSafeKey(bad) } catch { threw = true }
      expect(threw).toBe(true)
    }
    let t1 = false, t2 = false
    try { versionKey({ teacherId: '../x', termId: 't', slotId: 's', no: 1, ext: 'pdf' }) } catch { t1 = true }
    try { versionKey({ teacherId: 'a', termId: 't', slotId: 's', no: 0, ext: 'pdf' }) } catch { t2 = true }
    expect(t1).toBe(true)
    expect(t2).toBe(true)
  })
  it('الرموز المؤقتة فريدة', () => {
    const a = pendingKey({ teacherId: 'a', termId: 't', slotId: 's', ext: 'pdf' })
    const b = pendingKey({ teacherId: 'a', termId: 't', slotId: 's', ext: 'pdf' })
    expect(a === b).toBe(false)
  })
})

describe('التخزين الوهمي', () => {
  it('حفظ ثم قراءة بنفس البصمة والحجم، وتقدّم غير تنازلي ينتهي عند 100', async () => {
    const ad = new MemoryStorageAdapter()
    const seen: number[] = []
    const res = await ad.put({ key: 'files/a/t/s/v1.pdf', data: new Blob(['abc']), onProgress: (p) => seen.push(p) })
    expect(res.sha256).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(res.sizeBytes).toBe(3)
    expect(res.provider).toBe('memory')
    expect(seen[0]).toBe(0)
    expect(seen[seen.length - 1]).toBe(100)
    for (let i = 1; i < seen.length; i++) expect(seen[i] >= seen[i - 1]).toBe(true)
    const got = await ad.get('files/a/t/s/v1.pdf')
    expect(got?.sha256).toBe(res.sha256)
    expect(await ad.get('files/none/x/y/v1.pdf')).toBeNull()
  })
  it('لا يكتب فوق مفتاح موجود', async () => {
    const ad = new MemoryStorageAdapter()
    await ad.put({ key: 'files/a/t/s/v1.pdf', data: new Blob(['x']) })
    expect(await codeOf(ad.put({ key: 'files/a/t/s/v1.pdf', data: new Blob(['y']) }))).toBe('already_exists')
    const got = await ad.get('files/a/t/s/v1.pdf')
    expect(got?.sizeBytes).toBe(1)
  })
  it('يرفض الفارغ وما يتجاوز حد المزوّد ولا يخزّن شيئًا', async () => {
    const ad = new MemoryStorageAdapter({ maxObjectBytes: 4 })
    expect(ad.capabilities.maxObjectBytes).toBe(4)
    expect(await codeOf(ad.put({ key: 'files/a/t/s/v1.pdf', data: new Blob([]) }))).toBe('empty')
    expect(await codeOf(ad.put({ key: 'files/a/t/s/v1.pdf', data: new Blob(['12345']) }))).toBe('provider_limit')
    expect(await ad.get('files/a/t/s/v1.pdf')).toBeNull()
  })
  it('يرفض مفتاحًا غير آمن', async () => {
    const ad = new MemoryStorageAdapter()
    expect(await codeOf(ad.put({ key: '../evil', data: new Blob(['x']) }))).toBe('invalid_key')
  })
  it('الإلغاء لا يترك شيئًا مخزَّنًا', async () => {
    const ad = new MemoryStorageAdapter({ progressStepMs: 5 })
    const ctl = new AbortController()
    const p = ad.put({ key: 'pending/a/t/s/x.pdf', data: new Blob(['x']), signal: ctl.signal })
    ctl.abort()
    expect(await codeOf(p)).toBe('aborted')
    expect(await ad.get('pending/a/t/s/x.pdf')).toBeNull()
  })
  it('الحذف مرفوض دائمًا في المرحلة 4 (A-44)', async () => {
    const ad = new MemoryStorageAdapter()
    await ad.put({ key: 'files/a/t/s/v1.pdf', data: new Blob(['x']) })
    const fake = {} as DeletionAuthorization
    expect(await codeOf(ad.delete('files/a/t/s/v1.pdf', fake))).toBe('delete_not_implemented')
    expect((await ad.get('files/a/t/s/v1.pdf'))?.sizeBytes).toBe(1)
  })
})

describe('رسائل أخطاء التخزين', () => {
  it('عربية، ومن غير حد ثابت، وبلا رسالة عند الإلغاء', () => {
    expect(describeStorageError(new StorageError('too_large'), '50 ميغابايت')).toMatch(/50 ميغابايت/)
    expect(describeStorageError(new StorageError('provider_limit'))).toMatch(/أكبر/)
    expect(describeStorageError(new StorageError('aborted'))).toBeNull()
    expect(describeStorageError(new Error('x'))).toMatch(/تعذّر/)
  })
})
