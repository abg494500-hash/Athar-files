// مولَّد آليًا من src/lib/upload/verify.ts بواسطة scripts/build-edge-function.mjs — لا تعدّليه يدويًا.
// التحقق من الملف بعد وصوله (مرجع نقي لما سيفعله الخادم في 5.4). لا يثق بما أعلنه العميل: يقارن القيم المُلاحَظة.
import { effectiveMaxBytes, extOf } from '../storage/settings.ts'
import type { ProviderCapabilities, StorageSettings } from '../storage/settings.ts'
import type { RejectReason } from './session.ts'
import { extMatchesSignature, sniffSignature } from './signature.ts'

export interface Declared {
  name: string
  size: number
}

/** ما يقيسه الخادم فعليًا على الكائن المرفوع (لا ما يصرّح به العميل). */
export interface Observed {
  sizeBytes: number
  sha256: string
  /** أول بضع عشرات من البايتات تكفي لفحص التوقيع. */
  head: Uint8Array
}

export interface ValidationResult {
  ext: string
  sizeBytes: number
  sha256: string
  signature: string | null
  checks: readonly string[]
}

export type VerifyOutcome =
  | { ok: true; result: ValidationResult }
  | { ok: false; reason: RejectReason }

export function verifyUpload(declared: Declared, observed: Observed, settings: StorageSettings, caps: ProviderCapabilities): VerifyOutcome {
  const ext = extOf(declared.name)
  if (!settings.allowedExtensions.includes(ext)) return { ok: false, reason: 'type_not_allowed' }
  if (observed.sizeBytes <= 0) return { ok: false, reason: 'empty' }
  if (observed.sizeBytes > effectiveMaxBytes(settings, caps)) return { ok: false, reason: 'too_large' }
  if (observed.sizeBytes !== declared.size) return { ok: false, reason: 'size_mismatch' }
  if (!/^[0-9a-f]{64}$/.test(observed.sha256)) return { ok: false, reason: 'hash_invalid' }
  const kind = sniffSignature(observed.head)
  if (!extMatchesSignature(ext, kind)) return { ok: false, reason: 'signature_mismatch' }
  return {
    ok: true,
    result: {
      ext,
      sizeBytes: observed.sizeBytes,
      sha256: observed.sha256,
      signature: kind,
      checks: ['extension_allowed', 'size_within_limit', 'size_matches_declared', 'sha256_format', 'signature_matches_extension'],
    },
  }
}
