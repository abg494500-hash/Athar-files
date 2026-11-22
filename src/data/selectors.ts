import type { Deadlines, ItemStatus, SlotDef, Submission, Teacher, Term, Version } from './types'
import { SLOTS } from './types'
import { itemStatus, overallStatus } from '../lib/status'

export interface ItemView { slot: SlotDef; versions: Version[]; status: ItemStatus }

export function itemsFor(subs: Submission[], teacherId: string, termId: string): ItemView[] {
  return SLOTS.map((slot) => {
    const versions = subs.find((x) => x.teacherId === teacherId && x.termId === termId && x.slotId === slot.id)?.versions ?? []
    return { slot, versions, status: itemStatus(versions) }
  })
}

export function teacherStatus(subs: Submission[], teacherId: string, termId: string): ItemStatus {
  return overallStatus(itemsFor(subs, teacherId, termId).map((i) => i.status))
}

export function lastActivity(subs: Submission[], teacherId: string, termId: string): string | null {
  const all = itemsFor(subs, teacherId, termId).flatMap((i) => i.versions)
  if (!all.length) return null
  return all.map((v) => v.submittedAt).sort().at(-1) ?? null
}

export interface Summary { total: number; on_time: number; late: number; missing: number; rate: number }
export function summarize(subs: Submission[], teachers: Teacher[], termId: string): Summary {
  const active = teachers.filter((t) => t.active)
  const c = { on_time: 0, late: 0, missing: 0 }
  active.forEach((t) => { c[teacherStatus(subs, t.id, termId)]++ })
  const total = active.length
  return { total, ...c, rate: total ? ((c.on_time + c.late) / total) * 100 : 0 }
}

export function termLabel(terms: Term[], years: { id: string; label: string }[], termId: string): string {
  const t = terms.find((x) => x.id === termId)
  const y = t && years.find((x) => x.id === t.yearId)
  return t ? `${t.name} · ${y?.label ?? ''}` : ''
}

export function deadlinesOf(terms: Term[], termId: string): Deadlines {
  return terms.find((t) => t.id === termId)!.deadlines
}
