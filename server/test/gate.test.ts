// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { submissionGate } from '../services/gate'
import { ServiceError } from '../services/errors'
import { validateLinkUrl } from '../services/uploadService'

const D = { base: '2026-11-01', late: '2026-11-08', replace: '2026-11-20' }
const at = (s: string) => Date.parse(s)

describe('submissionGate — مواعيد التسليم (نهاية اليوم بتوقيت عُمان)', () => {
  it('تسليم جديد: قبل الأساسي on_time، حتى المتأخر late، بعده closed، والحدود شاملة', () => {
    expect(submissionGate(at('2026-10-01T00:00:00+04:00'), D, null)).toBe('on_time')
    expect(submissionGate(at('2026-11-01T23:59:59+04:00'), D, null)).toBe('on_time')
    expect(submissionGate(at('2026-11-02T00:00:00+04:00'), D, null)).toBe('late')
    expect(submissionGate(at('2026-11-08T23:59:59+04:00'), D, null)).toBe('late')
    expect(submissionGate(at('2026-11-09T00:00:00+04:00'), D, null)).toBe('closed')
  })
  it('استبدال: يرث حالة أول إصدار حتى نهاية يوم الاستبدال، ثم closed', () => {
    expect(submissionGate(at('2026-11-15T10:00:00+04:00'), D, 'on_time')).toBe('on_time')
    expect(submissionGate(at('2026-11-15T10:00:00+04:00'), D, 'late')).toBe('late')
    expect(submissionGate(at('2026-11-20T23:59:59+04:00'), D, 'late')).toBe('late')
    expect(submissionGate(at('2026-11-21T00:00:00+04:00'), D, 'on_time')).toBe('closed')
  })
  it('اللحظة نفسها بتوقيت UTC تُفسَّر بتوقيت عُمان (آخر يوم ينتهي 19:59:59 UTC)', () => {
    expect(submissionGate(at('2026-11-01T19:59:59Z'), D, null)).toBe('on_time')
    expect(submissionGate(at('2026-11-01T20:00:00Z'), D, null)).toBe('late')
  })
})

describe('validateLinkUrl', () => {
  const code = (v: unknown) => { try { validateLinkUrl(v) } catch (e) { return (e as ServiceError).code } return 'ok' }
  it('يقبل https بنطاق فيه نقطة ويقصّ المسافات الطرفية ويوحّد البادئة', () => {
    expect(validateLinkUrl('  https://drive.example.com/a?b=1#c ')).toBe('https://drive.example.com/a?b=1#c')
    expect(validateLinkUrl('HTTPS://Drive.Example.com/A')).toBe('https://Drive.Example.com/A')
  })
  it('يرفض كل ما سواه', () => {
    for (const bad of ['http://a.com', 'javascript:alert(1)', 'data:text/html,x', 'ftp://a.com', '//a.com', 'a.com', 'https://', 'https://localhost', 'https://u:p@a.com', 'https://u@a.com',
      'https://a b.com', 'https://a.com/a\nb', 'https://a.com/\u0000', 'https://a.com/a\tb', '', '   ', null, undefined, 5, {}, 'https://' + 'a'.repeat(2050) + '.com']) expect(code(bad)).toBe('bad_url')
  })
})
