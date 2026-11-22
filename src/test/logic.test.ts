import { describe, expect, it } from 'vitest'
import { canReplace, canSubmitNew, endOfDay, itemStatus, overallStatus, phaseAt, statusAtSubmission, validateDeadlines } from '../lib/status'
import { validateLink, previewKind } from '../lib/files'
import { checkFile, defaultSettings } from '../lib/storage/settings'
import { fmtSize } from '../lib/format'
import type { Version } from '../data/types'

const D = { base: '2026-10-15', late: '2026-10-20', replace: '2026-11-05' }
const at = (s: string) => Date.parse(s)
const v = (no: number, iso: string, status: Version['status']): Version => ({ id: String(no), no, kind: 'file', sha256: 'x', submittedAt: iso, status })

describe('المواعيد (توقيت عُمان UTC+4)', () => {
  it('نهاية اليوم هي آخر لحظة في يوم الموعد بتوقيت عُمان', () => {
    expect(endOfDay('2026-10-15')).toBe(at('2026-10-15T23:59:59.999+04:00'))
    expect(endOfDay('2026-10-15')).toBe(at('2026-10-15T19:59:59.999Z'))
  })
  it('تسليم عند 23:59 في يوم الموعد يُحسب في الوقت، وبعد منتصف الليل متأخر', () => {
    expect(statusAtSubmission(at('2026-10-15T23:59:00+04:00'), D)).toBe('on_time')
    expect(statusAtSubmission(at('2026-10-16T00:00:01+04:00'), D)).toBe('late')
    expect(statusAtSubmission(at('2026-10-20T23:00:00+04:00'), D)).toBe('late')
    expect(statusAtSubmission(at('2026-10-21T00:00:01+04:00'), D)).toBe('rejected')
  })
  it('مراحل الوقت والسماح بالتسليم والاستبدال', () => {
    expect(phaseAt(at('2026-10-10T10:00:00+04:00'), D)).toBe('before_base')
    expect(phaseAt(at('2026-10-18T10:00:00+04:00'), D)).toBe('late_window')
    expect(phaseAt(at('2026-10-22T10:00:00+04:00'), D)).toBe('closed')
    expect(canSubmitNew(at('2026-10-22T10:00:00+04:00'), D)).toBe(false)
    expect(canReplace(at('2026-10-22T10:00:00+04:00'), D)).toBe(true)
    expect(canReplace(at('2026-11-06T00:30:00+04:00'), D)).toBe(false)
  })
  it('تعديل الموعد لا يغيّر حالة نسخة سابقة (الحالة مخزّنة لحظة التسليم)', () => {
    const ver = v(1, '2026-10-17T09:00:00+04:00', 'late')
    const extended = { ...D, base: '2026-10-25', late: '2026-10-28' }
    expect(itemStatus([ver])).toBe('late')
    // حالة النسخة تُقرأ من اللقطة، لا من المواعيد الجديدة
    expect(itemStatus([ver])).toBe(ver.status)
    expect(statusAtSubmission(at('2026-10-17T09:00:00+04:00'), extended)).toBe('on_time') // يخص تسليمات جديدة فقط
  })
  it('حالة العنصر تثبت على أول تسليم (اقتراح C-09)', () => {
    expect(itemStatus([v(1, '2026-10-17T09:00:00+04:00', 'late'), v(2, '2026-10-18T09:00:00+04:00', 'on_time')])).toBe('late')
    expect(itemStatus([])).toBe('missing')
  })
  it('الحالة الإجمالية والعنصر الاختياري غير المسلَّم لا يسبب نقصًا (اقتراح C-08)', () => {
    expect(overallStatus(['on_time', 'missing'])).toBe('on_time')
    expect(overallStatus(['missing', 'missing'])).toBe('missing')
    expect(overallStatus(['on_time', 'late'])).toBe('late')
    expect(overallStatus(['missing', 'late'])).toBe('late')
  })
  it('قيد ترتيب المواعيد (اقتراح C-11)', () => {
    expect(validateDeadlines(D)).toEqual([])
    expect(validateDeadlines({ ...D, late: '2026-10-10' }).length).toBeGreaterThan(0)
    expect(validateDeadlines({ ...D, replace: '2026-10-19' }).length).toBeGreaterThan(0)
    expect(validateDeadlines({ base: '', late: '', replace: '' }).length).toBe(1)
  })
})

describe('قواعد الملفات والروابط', () => {
  it('حد الحجم من الإعدادات لا من ثابت في الكود (R-02)', () => {
    const s = defaultSettings()
    const caps = { maxObjectBytes: null }
    expect(s.maxFileBytes).not.toBe(104_857_600)
    expect(checkFile({ name: 'a.pdf', size: s.maxFileBytes }, s, caps).ok).toBe(true)
    const over = checkFile({ name: 'a.pdf', size: s.maxFileBytes + 1 }, s, caps)
    expect(over.ok === false && over.message).toMatch(/أكبر/)
  })
  it('الأنواع المقبولة فقط', () => {
    const s = defaultSettings(), caps = { maxObjectBytes: null }
    const msg = (n: string, size = 10) => { const r = checkFile({ name: n, size }, s, caps); return r.ok ? null : r.message }
    for (const n of ['a.pdf', 'a.DOCX', 'a.pptx', 'a.xlsx', 'a.jpg', 'a.png', 'a.webp', 'a.gif']) expect(msg(n)).toBeNull()
    for (const n of ['a.exe', 'a.svg', 'a.zip', 'a', 'a.mp4']) expect(msg(n)).toMatch(/غير مدعوم/)
    expect(msg('a.pdf', 0)).toMatch(/فارغ/)
  })
  it('الروابط: https فقط', () => {
    expect(validateLink('https://drive.google.com/x')).toBeNull()
    expect(validateLink('http://a.com')).toMatch(/https/)
    expect(validateLink('javascript:alert(1)')).not.toBeNull()
    expect(validateLink('data:text/html,hi')).not.toBeNull()
    expect(validateLink('')).not.toBeNull()
    expect(validateLink('not a url')).not.toBeNull()
  })
  it('المعاينة لـ PDF والصور فقط والمكتبية تُنزَّل', () => {
    expect(previewKind('a.pdf')).toBe('pdf'); expect(previewKind('a.PNG')).toBe('image')
    expect(previewKind('a.docx')).toBe('office'); expect(previewKind('a.xlsx')).toBe('office'); expect(previewKind('a.zip')).toBe('download')
  })
  it('تنسيق الأحجام', () => { expect(fmtSize(104_857_600)).toContain('100') })
})
