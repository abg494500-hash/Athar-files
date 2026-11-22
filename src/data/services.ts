import type { DataRepository } from './repository'
import type { AuthController } from '../lib/auth/controller'

/** ما تحتاجه الواجهة لتعمل: مصدر البيانات ومتحكّم المصادقة . */
export interface AppServices {
  repository: DataRepository
  auth: AuthController | null
  /** سبب تعذّر الإعداد (غياب .env.local مثلًا) ليُعرض في شاشة الدخول. */
  configError: string | null
}
