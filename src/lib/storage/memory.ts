// تخزين **وهمي** للتطوير المحلي: يبقى في ذاكرة المتصفح ويضيع عند تحديث الصفحة.
// لا يرسل شيئًا إلى أي خدمة. لا يثبت أن رفع الملفات لمزوّد حقيقي يعمل (لم يُربط ولم يُختبر).
import type { DeletionAuthorization, PutInput, PutResult, StorageAdapter, StoredObject } from './adapter'
import { StorageError } from './errors'
import { assertSafeKey } from './keys'
import { hashBlob } from './sha256'
import type { ProviderCapabilities } from './settings'

export interface MemoryAdapterOptions {
  /** حد كائن يحاكي مزوّدًا (للاختبار). null = بلا حد. */
  maxObjectBytes?: number | null
  /** زمن كل خطوة تقدّم محاكاة (م.ث). 0 = بلا انتظار. */
  progressStepMs?: number
  progressSteps?: number
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export class MemoryStorageAdapter implements StorageAdapter {
  readonly id = 'memory'
  readonly capabilities: ProviderCapabilities
  private store = new Map<string, StoredObject>()
  private stepMs: number
  private steps: number

  constructor(opts: MemoryAdapterOptions = {}) {
    this.capabilities = { maxObjectBytes: opts.maxObjectBytes ?? null }
    this.stepMs = opts.progressStepMs ?? 0
    this.steps = Math.max(1, opts.progressSteps ?? 5)
  }

  async put(input: PutInput): Promise<PutResult> {
    assertSafeKey(input.key)
    const size = input.data.size
    if (size <= 0) throw new StorageError('empty')
    const cap = this.capabilities.maxObjectBytes
    if (cap !== null && size > cap) throw new StorageError('provider_limit')
    if (this.store.has(input.key)) throw new StorageError('already_exists')
    if (input.signal?.aborted) throw new StorageError('aborted')

    input.onProgress?.(0)
    for (let i = 1; i <= this.steps; i++) {
      if (this.stepMs > 0) await sleep(this.stepMs)
      if (input.signal?.aborted) throw new StorageError('aborted')
      if (i < this.steps) input.onProgress?.(Math.round((i / this.steps) * 100))
    }
    const sha256 = await hashBlob(input.data)
    if (input.signal?.aborted) throw new StorageError('aborted')
    if (this.store.has(input.key)) throw new StorageError('already_exists')
    this.store.set(input.key, { key: input.key, sizeBytes: size, sha256, data: input.data })
    input.onProgress?.(100)
    return { provider: this.id, key: input.key, sizeBytes: size, sha256 }
  }

  async get(key: string): Promise<StoredObject | null> {
    return this.store.get(key) ?? null
  }

  async delete(_key: string, _authorization: DeletionAuthorization): Promise<void> {
    throw new StorageError('delete_not_implemented', 'الحذف غير منفَّذ في المرحلة 4 (A-44)')
  }
}
