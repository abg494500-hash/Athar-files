import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ArchiveData } from './archiveRepository'

/**
 * حالة أجزاء الأرشيف في المجلد. كل جزء يحمل ملف علامة parts/part-NN.js نحمّله بوسم script (يعمل من file://)
 * فنعرف أيّ الأجزاء استُخرجت. لا نفترض وجود جزء لم تثبت علامته.
 */
export interface PartsState { total: number; settled: boolean; missing: number[]; has: (n: number) => boolean }
const Ctx = createContext<PartsState>({ total: 0, settled: true, missing: [], has: () => true })
const pad = (n: number) => (n < 10 ? `0${n}` : String(n))

export function PartsProvider({ data, children }: { data: ArchiveData; children: ReactNode }) {
  const list = useMemo(() => data.parts ?? [], [data])
  const [settled, setSettled] = useState(list.length === 0)
  useEffect(() => {
    if (list.length === 0) return
    const w = window as unknown as { ATHAR_PARTS?: Record<number, number> }
    w.ATHAR_PARTS = w.ATHAR_PARTS ?? {}
    let pending = list.length
    const fin = () => { if (--pending <= 0) setSettled(true) }
    const nodes = list.map((p) => {
      const s = document.createElement('script'); s.src = `parts/part-${pad(p.no)}.js`; s.onload = fin; s.onerror = fin; document.head.appendChild(s); return s
    })
    return () => { nodes.forEach((n) => n.remove()) }
  }, [list])
  const value = useMemo<PartsState>(() => {
    const w = window as unknown as { ATHAR_PARTS?: Record<number, number> }
    const has = (n: number) => list.length === 0 || !!w.ATHAR_PARTS?.[n]
    return { total: list.length, settled, has, missing: settled ? list.filter((p) => !has(p.no)).map((p) => p.no) : [] }
  }, [list, settled])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
export const useParts = () => useContext(Ctx)
