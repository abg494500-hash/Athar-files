import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DataRepository } from '../data/repository'

/**
 * اختبارات العقد: يمرّ بها أي مصدر بيانات (الوهمي اليوم، وأي مصدر حقيقي لاحقًا بعد موافقة مستقلة).
 * `make` تنشئ مصدرًا جديدًا نظيفًا في كل اختبار، بساعة ثابتة عند الموعد الأساسي لفصل t1.
 */
export function runRepositoryContract(name: string, make: (initial?: { session?: { role: 'owner' } | null; now?: number }) => DataRepository) {
  describe(`عقد طبقة البيانات — ${name}`, () => {
    let repo: DataRepository
    beforeEach(() => { vi.useFakeTimers(); repo = make({ session: { role: 'owner' } }) })
    afterEach(() => { vi.useRealTimers() })

    it('الوصف يعلن بصدق هل المصدر دائم', () => {
      expect(typeof repo.meta.persistent).toBe('boolean')
      expect(repo.meta.kind.length).toBeGreaterThan(0)
    })

    it('اللقطة مرجعها ثابت دون تغيير، وتتغير بعد أمر، واللقطة القديمة لا تُعدَّل', async () => {
      const a = repo.getSnapshot()
      expect(repo.getSnapshot()).toBe(a)
      const n = a.teachers.length
      await repo.addTeacher('معلمة اختبار', 'مادة')
      const b = repo.getSnapshot()
      expect(b).not.toBe(a)
      expect(a.teachers).toHaveLength(n)
      expect(b.teachers).toHaveLength(n + 1)
    })

    it('المشتركون يُبلَّغون بالتغيير ويتوقف التبليغ بعد إلغاء الاشتراك', async () => {
      const fn = vi.fn()
      const off = repo.subscribe(fn)
      await repo.addTeacher('أ', 'ب')
      expect(fn).toHaveBeenCalled()
      const calls = fn.mock.calls.length
      off()
      await repo.addTeacher('ج', 'د')
      expect(fn.mock.calls.length).toBe(calls)
    })

    it('سجل العمليات للإضافة فقط: كل أمر يضيف قيدًا في المقدمة ولا يُعدَّل ما قبله', async () => {
      const before = repo.getSnapshot().audit
      await repo.addTeacher('معلمة جديدة', 'مادة')
      await repo.revokeCode(repo.getSnapshot().teachers[0].id)
      const after = repo.getSnapshot().audit
      expect(after.length).toBe(before.length + 2)
      expect(after.slice(2)).toEqual(before)
      expect(after[1].action).toBe('إضافة معلمة')
      expect(after[0].action).toBe('إلغاء رمز دخول')
    })

    it('التسليم الجديد يُسجَّل بنسخة 1 وبصمة طبقة التخزين إن وُجدت', async () => {
      const r = await repo.submit({ teacherId: 'th2', termId: 't1', slotId: 's1', kind: 'file', fileName: 'a.pdf', size: 10, sha256: 'ab'.repeat(32), storageKey: 'files/x/v1.pdf' })
      expect(r.ok).toBe(true)
      if (r.ok) { expect(r.version.no).toBe(1); expect(r.version.sha256).toBe('ab'.repeat(32)) }
      expect(repo.getSnapshot().audit[0].action).toBe('تسليم ملف')
    })

    it('الاستبدال يضيف نسخة ولا يحذف السابقة', async () => {
      const th1 = repo.getSnapshot().submissions.find((s) => s.teacherId === 'th1' && s.termId === 't1' && s.slotId === 's1')!
      const n = th1.versions.length
      const r = await repo.submit({ teacherId: 'th1', termId: 't1', slotId: 's1', kind: 'link', url: 'https://x.example/a' })
      expect(r.ok).toBe(true)
      const after = repo.getSnapshot().submissions.find((s) => s.teacherId === 'th1' && s.termId === 't1' && s.slotId === 's1')!
      expect(after.versions).toHaveLength(n + 1)
      expect(after.versions.slice(0, n)).toEqual(th1.versions)
      expect(repo.getSnapshot().audit[0].action).toBe('استبدال ملف')
    })

    it('يُرفض التسليم الجديد بعد آخر موعد متأخر ولا يُسجَّل شيء', async () => {
      repo.setNow(Date.parse('2026-10-22T10:00:00+04:00'))
      const subs = repo.getSnapshot().submissions
      const audit = repo.getSnapshot().audit.length
      const r = await repo.submit({ teacherId: 'th2', termId: 't1', slotId: 's1', kind: 'link', url: 'https://x.example/a' })
      expect(r).toEqual({ ok: false, reason: 'closed' })
      expect(repo.getSnapshot().submissions).toBe(subs)
      expect(repo.getSnapshot().audit).toHaveLength(audit)
    })

    it('يُرفض الاستبدال بعد مهلة الاستبدال', async () => {
      repo.setNow(Date.parse('2026-11-06T10:00:00+04:00'))
      const r = await repo.submit({ teacherId: 'th1', termId: 't1', slotId: 's1', kind: 'link', url: 'https://x.example/a' })
      expect(r).toEqual({ ok: false, reason: 'replace_closed' })
    })

    it('الرمز الجديد يُعاد مرة واحدة ولا يُخزَّن في اللقطة', async () => {
      const code = await repo.reissueCode('th1')
      expect(code).toMatch(/^[A-Z2-9]{10}$/)
      expect(JSON.stringify(repo.getSnapshot())).not.toContain(code)
      expect(repo.getSnapshot().teachers.find((t) => t.id === 'th1')!.codeState).toBe('active')
    })

    it('طلب الحذف النهائي يسجَّل فقط: الأرشيف باقٍ ولا يُحذف شيء (A-44)', async () => {
      const n = repo.getSnapshot().archives.length
      await repo.deleteArchive('ar1', 'المالكة')
      const s = repo.getSnapshot()
      expect(s.archives).toHaveLength(n)
      expect(s.archives.find((a) => a.id === 'ar1')!.deleted).toBe(true)
      expect(s.audit[0].action).toBe('طلب حذف نهائي')
    })

    it('الأرشفة: ينتقل الأرشيف الجديد إلى «بانتظار التحقق» بعد المعالجة', async () => {
      await repo.createArchive({ yearId: 'y2627', termId: 't1', teacherId: null, title: 'أرشيف اختبار' })
      const id = repo.getSnapshot().archives[0].id
      expect(repo.getSnapshot().archives[0].status).toBe('creating')
      await vi.advanceTimersByTimeAsync(2000)
      expect(repo.getSnapshot().archives.find((a) => a.id === id)!.status).toBe('awaiting_verification')
    })

    it('تسجيل الدخول والخروج يغيّران الجلسة، والدخول يُسجَّل في السجل', () => {
      repo.logout()
      expect(repo.getSnapshot().session).toBeNull()
      repo.login({ role: 'director' })
      expect(repo.getSnapshot().session).toEqual({ role: 'director' })
      expect(repo.getSnapshot().audit[0].action).toBe('تسجيل دخول')
    })

    it('تعديل المواعيد يسجّل الفرق والسبب', async () => {
      const d = repo.getSnapshot().terms.find((t) => t.id === 't1')!.deadlines
      await repo.updateDeadlines('t1', { ...d, late: '2026-10-25' }, 'تمديد')
      const e = repo.getSnapshot().audit[0]
      expect(e.action).toBe('تعديل مواعيد')
      expect(e.detail).toContain('السبب: تمديد')
    })
  })
}
