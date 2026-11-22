import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import type { StorageAdapter } from './adapter'
import { MemoryStorageAdapter } from './memory'
import { settingsFromEnv, type StorageSettings } from './settings'

export interface StorageCtx {
  adapter: StorageAdapter
  settings: StorageSettings
  /** تعديل الإعدادات في الذاكرة (للتطوير والاختبار). التعديل الفعلي لاحقًا يمر بجدول app_settings. */
  setSettings: (s: StorageSettings) => void
}

// الافتراضي: تخزين وهمي + إعدادات مؤقتة. يعمل دون غلاف، فتعمل المكوّنات المعزولة في الاختبارات.
const fallback: StorageCtx = {
  adapter: new MemoryStorageAdapter({ progressStepMs: import.meta.env.MODE === 'test' ? 1 : 140 }),
  settings: settingsFromEnv(import.meta.env as Record<string, unknown>),
  setSettings: () => {},
}

const Ctx = createContext<StorageCtx>(fallback)

export function StorageProvider({ children, adapter, settings }: { children: ReactNode; adapter?: StorageAdapter; settings?: StorageSettings }) {
  const [cur, setCur] = useState<StorageSettings>(settings ?? fallback.settings)
  const value = useMemo<StorageCtx>(() => ({ adapter: adapter ?? fallback.adapter, settings: cur, setSettings: setCur }), [adapter, cur])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const useStorage = () => useContext(Ctx)
