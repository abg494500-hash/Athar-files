import { useState } from 'react'
import { useStore } from '../../data/store'
import { Select } from '../ui/Field'

export function useTermSelection() {
  const { terms, currentTermId } = useStore()
  const [termId, setTermId] = useState(currentTermId)
  const yearId = terms.find((t) => t.id === termId)?.yearId ?? ''
  const setYearId = (y: string) => {
    const first = terms.find((t) => t.yearId === y)
    if (first) setTermId(first.id)
  }
  return { yearId, termId, setYearId, setTermId }
}

/** اختيار السنة والفصل معًا. */
export function TermPicker({ sel, labels = true }: { sel: ReturnType<typeof useTermSelection>; labels?: boolean }) {
  const { years, terms } = useStore()
  return (
    <>
      <label className="block text-sm text-ink-500">
        {labels && <span className="mb-1 block">السنة الدراسية</span>}
        <Select aria-label="السنة الدراسية" value={sel.yearId} onChange={(e) => sel.setYearId(e.target.value)}>
          {years.map((y) => <option key={y.id} value={y.id}>{y.label}{y.active ? ' (النشطة)' : ''}</option>)}
        </Select>
      </label>
      <label className="block text-sm text-ink-500">
        {labels && <span className="mb-1 block">الفصل</span>}
        <Select aria-label="الفصل الدراسي" value={sel.termId} onChange={(e) => sel.setTermId(e.target.value)}>
          {terms.filter((t) => t.yearId === sel.yearId).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>
      </label>
    </>
  )
}
