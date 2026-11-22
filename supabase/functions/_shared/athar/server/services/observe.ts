// مولَّد آليًا من server/services/observe.ts بواسطة scripts/build-edge-function.mjs — لا تعدّليه يدويًا.
// قياس الكائن المرفوع فعليًا من التخزين (لا الثقة بما أعلنه العميل): الحجم وSHA-256 وأول البايتات، محسوبة هنا من البايتات نفسها.
import type { StorageAdapter } from '../../src/lib/storage/adapter.ts'
import { hashBlob } from '../../src/lib/storage/sha256.ts'
import type { Observed } from '../../src/lib/upload/verify.ts'

const HEAD_BYTES = 32

export interface ReadObject {
  observed: Observed
  /** البايتات نفسها التي قيست: تُستعمل للنسخ إلى المفتاح النهائي فلا يقع تبديل بين القياس والنسخ. */
  data: Blob
}

/** null = القياس غير متاح الآن (الكائن غير موجود أو تعطّل التخزين): ليس رفضًا بل تأجيلًا (قرار 5.A). */
export async function readObject(storage: StorageAdapter, key: string): Promise<ReadObject | null> {
  try {
    const obj = await storage.get(key)
    if (obj === null) return null
    const head = new Uint8Array(await obj.data.slice(0, HEAD_BYTES).arrayBuffer())
    return { observed: { sizeBytes: obj.data.size, sha256: await hashBlob(obj.data), head }, data: obj.data }
  } catch {
    return null
  }
}

const MIME: Record<string, string> = {
  pdf: 'application/pdf', png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', zip: 'application/zip',
}
/** نوع MIME المتحقَّق منه من التوقيع (لا من الامتداد ولا من ما أعلنه العميل). */
export function mimeFromSignature(sig: string | null): string | null {
  return sig === null ? null : MIME[sig] ?? null
}
