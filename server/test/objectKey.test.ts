// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { assertExt, assertId, assertIsPendingKeyOf, assertKeyInScope, buildFinalObjectKey, buildPendingObjectKey, parseObjectKey, MAX_KEY_LENGTH } from '../objectKey'
import { assertSafeKey } from '../../src/lib/storage/keys'

const S = { teacherId: 'th1', termId: 't1', slotId: 's1' }
function code(fn: () => unknown): string | null {
  try { fn() } catch (e) { return (e as { code?: string }).code ?? 'other' }
  return null
}

describe('objectKey — البناء', () => {
  it('المؤقت يُشتق من رقم الجلسة وليس من رمز عشوائي، والامتداد يُوحَّد صغيرًا', () => {
    expect(buildPendingObjectKey({ ...S, sessionId: 'ses-1', ext: 'PDF' })).toBe('pending/th1/t1/s1/ses-1.pdf')
    expect(buildPendingObjectKey({ ...S, sessionId: 'ses-1', ext: 'pdf' })).toBe(buildPendingObjectKey({ ...S, sessionId: 'ses-1', ext: 'PDF' }))
  })
  it('النهائي بصيغة v<no>.<ext>', () => {
    expect(buildFinalObjectKey({ ...S, no: 3, ext: 'docx' })).toBe('files/th1/t1/s1/v3.docx')
  })
  it('مفاتيح الخادم تجتاز فحص الأمان المشترك مع الواجهة', () => {
    assertSafeKey(buildPendingObjectKey({ ...S, sessionId: 'a-b_c', ext: 'png' }))
    assertSafeKey(buildFinalObjectKey({ ...S, no: 999_999_999, ext: 'xlsx' }))
  })
  it('يرفض المعرّفات الخطرة', () => {
    const bad = ['', '.', '..', '../x', 'a/b', 'a\\b', 'a b', 'a.b', '-a', '_a', 'ا', 'a\u0000', 'a\n', 'a%2e', 'x'.repeat(65), ' a']
    for (const b of bad) expect(code(() => assertId('x', b))).toBe('bad_id')
    for (const nb of [null, undefined, 5, {}, []]) expect(code(() => assertId('x', nb))).toBe('bad_id')
  })
  it('يرفض الامتدادات خارج القائمة أو المشوّهة', () => {
    for (const e of ['exe', 'php', 'html', 'js', 'svg', 'tar.gz', 'pdf.exe', '', '.pdf', 'pdf ', 'p/df', '../pdf', 'pdfpdfpdfpdf']) expect(code(() => assertExt(e))).toBe('bad_ext')
    expect(assertExt('JPEG')).toBe('jpeg')
  })
  it('القائمة المسموحة تُمرَّر من الإعدادات الخادمية', () => {
    expect(code(() => buildFinalObjectKey({ ...S, no: 1, ext: 'zip' }))).toBe('bad_ext')
    expect(buildFinalObjectKey({ ...S, no: 1, ext: 'zip' }, ['pdf', 'zip'])).toBe('files/th1/t1/s1/v1.zip')
  })
  it('يرفض أرقام الإصدار غير الصالحة', () => {
    for (const n of [0, -1, 1.5, NaN, Infinity, 1e21, 1_000_000_000, '1' as unknown as number]) expect(code(() => buildFinalObjectKey({ ...S, no: n, ext: 'pdf' }))).toBe('bad_version_no')
  })
  it('يرفض مفتاحًا أطول من الحد', () => {
    expect(code(() => buildPendingObjectKey({ teacherId: 'a'.repeat(64), termId: 'b'.repeat(64), slotId: 'c'.repeat(64), sessionId: 'd'.repeat(64), ext: 'pdf' }))).toBe('key_too_long')
    expect(MAX_KEY_LENGTH).toBe(255)
  })
})

describe('objectKey — التحليل (مدخلات غير موثوقة)', () => {
  it('رحلة ذهاب وعودة للصيغتين', () => {
    const p = buildPendingObjectKey({ ...S, sessionId: 'ses9', ext: 'pdf' })
    expect(parseObjectKey(p)).toEqual({ kind: 'pending', ...S, sessionId: 'ses9', ext: 'pdf' })
    const f = buildFinalObjectKey({ ...S, no: 12, ext: 'pptx' })
    expect(parseObjectKey(f)).toEqual({ kind: 'final', ...S, no: 12, ext: 'pptx' })
  })
  it('يرفض كل شكل غير قانوني حرفيًا', () => {
    const bad = [
      '', 'x', '/files/th1/t1/s1/v1.pdf', 'files/th1/t1/s1/v1.pdf/', 'files//t1/s1/v1.pdf', 'files/th1/t1/s1/v1.pdf.',
      'files/th1/t1/s1/v01.pdf', 'files/th1/t1/s1/v0.pdf', 'files/th1/t1/s1/v1..pdf', 'files/th1/t1/s1/v1.pdf.exe',
      'files/th1/t1/s1/v1.PDF', 'files/TH1/t1/s1/v1.PDF', 'files/th1/t1/s1/V1.pdf', 'files/th1/t1/s1/1.pdf', 'files/th1/t1/s1/v1',
      'files/th1/t1/s1/v-1.pdf', 'files/th1/t1/s1/v1e3.pdf', 'files/th1/t1/s1/v1000000000.pdf',
      'files/../t1/s1/s1/v1.pdf', 'files/th1/../s1/s1/v1.pdf', 'files/th1/t1/s1/../v1.pdf', 'files/th1/t1/./v1.pdf',
      'files/th1/t1/s1/v1.pdf%2e', 'files/th1/t1%2fx/s1/v1.pdf', 'files\\th1\\t1\\s1\\v1.pdf', 'files/th1/t1/s1/v1.pdf\n', 'files/th1/t1/s1/v1.pdf\u0000',
      'files/th1/t1/s1/v1.pdf ', ' files/th1/t1/s1/v1.pdf', 'FILES/th1/t1/s1/v1.pdf', 'other/th1/t1/s1/v1.pdf', 'files/th1/t1/v1.pdf', 'files/th1/t1/s1/extra/v1.pdf',
      'pending/th1/t1/s1/.pdf', 'pending/th1/t1/s1/ses.pdf.bak', 'pending/th1/t1/s1/se.s.pdf', 'pending/th1/t1/s1/ses', 'pending/th1/t1/s1/ses.',
      'files/th1/t1/s1/v1.pdf?x=1', 'files/th1/t1/s1/v1.pdf#a', 'files/th١/t1/s1/v1.pdf', 'files/th1/t1/s1/v١.pdf', 'files/th1/t1/s1/v1.p\u200bdf',
    ]
    for (const b of bad) expect(code(() => parseObjectKey(b))).not.toBe(null)
    for (const nb of [null, undefined, 5, {}, []]) expect(code(() => parseObjectKey(nb))).toBe('bad_key_shape')
  })
  it('يرفض مفتاحًا طويلًا قبل أي تحليل', () => {
    expect(code(() => parseObjectKey('files/' + 'a'.repeat(300)))).toBe('key_too_long')
  })
  it('الامتداد في التحليل يُفحص بالصيغة لا بالقائمة (ملفات قديمة قد تبقى بعد تغيير القائمة)', () => {
    expect(parseObjectKey('files/th1/t1/s1/v1.zip').kind).toBe('final')
  })
})

describe('objectKey — العزل والاشتقاق', () => {
  it('مفتاح معلمة أخرى أو فصل آخر أو خانة أخرى يُرفض', () => {
    const k = buildFinalObjectKey({ ...S, no: 1, ext: 'pdf' })
    expect(assertKeyInScope(k, S).kind).toBe('final')
    for (const other of [{ ...S, teacherId: 'th2' }, { ...S, termId: 't2' }, { ...S, slotId: 's2' }]) expect(code(() => assertKeyInScope(k, other))).toBe('scope_mismatch')
  })
  it('المفتاح المؤقت يجب أن يكون المشتق لهذه الجلسة تحديدًا', () => {
    const exp = { ...S, sessionId: 'ses1', ext: 'pdf' }
    assertIsPendingKeyOf('pending/th1/t1/s1/ses1.pdf', exp)
    for (const k of ['pending/th1/t1/s1/ses2.pdf', 'pending/th1/t1/s1/ses1.png', 'pending/th2/t1/s1/ses1.pdf', 'files/th1/t1/s1/v1.pdf', 'pending/th1/t1/s1/ses1.pdf/', 'pending/th1/t1/s1/SES1.pdf', null, 5])
      expect(code(() => assertIsPendingKeyOf(k, exp))).toBe('scope_mismatch')
  })
})
