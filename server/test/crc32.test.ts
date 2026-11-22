// @vitest-environment node
// CRC32 المحلي مقابل node:zlib.crc32 وقيمة المرجع المعروفة. (zip.ts لم يعد يعتمد على node:zlib.)
import { describe, it, expect } from 'vitest'
import { crc32 as nodeCrc32 } from 'node:zlib'
import { randomBytes } from 'node:crypto'
import { crc32 } from '../archive/crc32'

describe('crc32 المحلي', () => {
  it('قيمة المرجع المعروفة والفارغ', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
    expect(crc32(new Uint8Array(0))).toBe(0)
  })
  it('يطابق node:zlib على مدخلات عشوائية بأحجام متنوعة (حدود 0..70000)', () => {
    for (const n of [1, 2, 3, 255, 256, 257, 1024, 65535, 65536, 70000]) {
      const b = randomBytes(n)
      expect(crc32(b)).toBe(nodeCrc32(b))
    }
    const all = new Uint8Array(256).map((_, i) => i)
    expect(crc32(all)).toBe(nodeCrc32(all))
  })
  it('الاستمرارية: crc32(b, crc32(a)) = crc32(a+b)', () => {
    const a = randomBytes(1000), b = randomBytes(777)
    expect(crc32(b, crc32(a))).toBe(crc32(Buffer.concat([a, b])))
  })
})
