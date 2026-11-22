// مولَّد آليًا من src/lib/storage/adapter.ts بواسطة scripts/build-edge-function.mjs — لا تعدّليه يدويًا.
// واجهة التخزين القابلة للتبديل (A-39، DP-06 = A-44). لا تفترض مزوّدًا ولا طريقة رفع (DP-03 معلّق).
import type { ProviderCapabilities } from './settings.ts'

export interface PutInput {
  key: string
  data: Blob
  contentType?: string
  /** نسبة مئوية 0–100 غير تنازلية. */
  onProgress?: (percent: number) => void
  signal?: AbortSignal
}

export interface PutResult {
  provider: string
  key: string
  sizeBytes: number
  sha256: string
}

export interface StoredObject {
  key: string
  sizeBytes: number
  sha256: string
  data: Blob
}

/**
 * تفويض مسار الحذف المعتمد. لا يوجد في المرحلة 4 أي مُنشئ لهذا النوع عمدًا (A-44)،
 * فلا يمكن لأي كود الحصول على قيمة منه. يُبنى مسار الحذف المعتمد في مرحلة لاحقة بموافقتك.
 */
export type DeletionAuthorization = { readonly __approvedDeletionPath: never }

export interface StorageAdapter {
  readonly id: string
  readonly capabilities: ProviderCapabilities
  /** لا يكتب فوق مفتاح موجود (الإصدارات لا تُعدَّل): يرمي already_exists. */
  put(input: PutInput): Promise<PutResult>
  get(key: string): Promise<StoredObject | null>
  /** معرّفة في العقد لكن المحوّل الوهمي (والمرحلة 4 كلها) يرفضها دائمًا: delete_not_implemented. */
  delete(key: string, authorization: DeletionAuthorization): Promise<void>
}
