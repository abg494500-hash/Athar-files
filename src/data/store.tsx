import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import type { DataRepository, RepositoryMeta, Snapshot } from './repository'

export type { Session, SubmitInput, SubmitResult } from './repository'

/**
 * واجهة الصفحات إلى البيانات: لقطة القراءة + الأوامر + وصف المصدر.
 * لا تعرف الصفحات أي مصدر تقرأ منه؛ المصدر يُحقن عبر StoreProvider (انظر `provider.ts`).
 */
export interface Store extends Snapshot, Omit<DataRepository, 'meta' | 'getSnapshot' | 'subscribe'> {
  source: RepositoryMeta
}

const Ctx = createContext<Store | null>(null)

export function StoreProvider({ children, repository }: { children: ReactNode; repository: DataRepository }) {
  const snap = useSyncExternalStore(repository.subscribe, repository.getSnapshot, repository.getSnapshot)
  const store = useMemo<Store>(() => ({
    ...snap,
    source: repository.meta,
    login: repository.login,
    logout: repository.logout,
    setNow: repository.setNow,
    reload: repository.reload,
    submit: repository.submit,
    updateDeadlines: repository.updateDeadlines,
    setActiveYear: repository.setActiveYear,
    addYear: repository.addYear,
    setCurrentTerm: repository.setCurrentTerm,
    addTeacher: repository.addTeacher,
    updateTeacher: repository.updateTeacher,
    reissueCode: repository.reissueCode,
    revokeCode: repository.revokeCode,
    createArchive: repository.createArchive,
    verifyArchive: repository.verifyArchive,
    markSent: repository.markSent,
    ackBackup: repository.ackBackup,
    deleteArchive: repository.deleteArchive,
  }), [snap, repository])
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>
}

export function useStore(): Store {
  const s = useContext(Ctx)
  if (!s) throw new Error('StoreProvider مفقود')
  return s
}
