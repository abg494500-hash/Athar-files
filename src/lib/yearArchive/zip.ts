// كاتب/قارئ ZIP للمتصفح (A-115): بلا ضغط (stored)، CRC32، أسماء UTF-8، بلا ZIP64. لا اعتماديات.
// الكاتب يجمّع الأجزاء في Blob (يديرها المتصفح) فلا تبقى بايتات كل الملفات في ذاكرة JavaScript. القارئ يتحقق من CRC ومن سلامة البنية ويفشل مغلقًا.
const TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } return t })()
export function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export type ZipErrorCode = 'bad_path' | 'duplicate_path' | 'too_many_entries' | 'too_large' | 'corrupt_zip'
export class ZipError extends Error {
  code: ZipErrorCode
  constructor(code: ZipErrorCode, detail?: string) { super(detail ? `${code}: ${detail}` : code); this.name = 'ZipError'; this.code = code }
}

export const MAX_ENTRIES = 65_000
export const MAX_ZIP_BYTES = 0xffff_ffff - 1_000_000
const SIG_LOCAL = 0x04034b50, SIG_CENTRAL = 0x02014b50, SIG_EOCD = 0x06054b50, FLAG_UTF8 = 0x0800
const DOS_TIME = 0
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1
const enc = new TextEncoder()
const dec = new TextDecoder('utf-8', { fatal: true })

export function assertZipPath(p: string): string {
  if (typeof p !== 'string' || p === '' || enc.encode(p).length > 255) throw new ZipError('bad_path', 'فارغ أو طويل')
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\:*?"<>|]/.test(p) || p.startsWith('/') || p.endsWith('/')) throw new ZipError('bad_path', 'محارف ممنوعة')
  for (const part of p.split('/')) if (part === '' || part === '.' || part === '..' || part !== part.trim() || part.endsWith('.')) throw new ZipError('bad_path', 'مكوّن خطر')
  return p
}

interface Central { name: Uint8Array; crc: number; size: number; offset: number }

export class ZipWriter {
  private parts: BlobPart[] = []
  private central: Central[] = []
  private paths = new Set<string>()
  private offset = 0
  get count(): number { return this.central.length }
  add(path: string, data: Uint8Array): { crc: number } {
    assertZipPath(path)
    if (this.paths.has(path)) throw new ZipError('duplicate_path', path)
    if (this.central.length >= MAX_ENTRIES) throw new ZipError('too_many_entries')
    if (data.length > 0xffff_fffe || this.offset + data.length + 1_000_000 > MAX_ZIP_BYTES) throw new ZipError('too_large')
    this.paths.add(path)
    const name = enc.encode(path), crc = crc32(data)
    const h = new DataView(new ArrayBuffer(30))
    h.setUint32(0, SIG_LOCAL, true); h.setUint16(4, 20, true); h.setUint16(6, FLAG_UTF8, true); h.setUint16(8, 0, true)
    h.setUint16(10, DOS_TIME, true); h.setUint16(12, DOS_DATE, true); h.setUint32(14, crc, true)
    h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true)
    this.central.push({ name, crc, size: data.length, offset: this.offset })
    this.parts.push(new Uint8Array(h.buffer) as unknown as BlobPart, name as unknown as BlobPart, new Blob([data as unknown as BlobPart]))
    this.offset += 30 + name.length + data.length
    return { crc }
  }
  finish(): Blob {
    const cdStart = this.offset
    let cdSize = 0
    for (const e of this.central) {
      const h = new DataView(new ArrayBuffer(46))
      h.setUint32(0, SIG_CENTRAL, true); h.setUint16(4, 20, true); h.setUint16(6, 20, true); h.setUint16(8, FLAG_UTF8, true); h.setUint16(10, 0, true)
      h.setUint16(12, DOS_TIME, true); h.setUint16(14, DOS_DATE, true); h.setUint32(16, e.crc, true); h.setUint32(20, e.size, true); h.setUint32(24, e.size, true)
      h.setUint16(28, e.name.length, true); h.setUint32(42, e.offset, true)
      this.parts.push(new Uint8Array(h.buffer) as unknown as BlobPart, e.name as unknown as BlobPart)
      cdSize += 46 + e.name.length
    }
    const t = new DataView(new ArrayBuffer(22))
    t.setUint32(0, SIG_EOCD, true); t.setUint16(8, this.central.length, true); t.setUint16(10, this.central.length, true); t.setUint32(12, cdSize, true); t.setUint32(16, cdStart, true)
    this.parts.push(new Uint8Array(t.buffer) as unknown as BlobPart)
    if (cdStart + cdSize + 22 > MAX_ZIP_BYTES) throw new ZipError('too_large')
    return new Blob(this.parts, { type: 'application/zip' })
  }
}

export interface ZipEntry { path: string; data: Uint8Array }

/** يقرأ ZIP (stored فقط) ويتحقق من CRC وحدود كل مدخل ومن عدم التكرار. أي خلل ⇒ ZipError('corrupt_zip'). */
export function readZip(bytes: Uint8Array): ZipEntry[] {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length < 22) throw new ZipError('corrupt_zip', 'قصير')
  let e = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65_535); i--) if (v.getUint32(i, true) === SIG_EOCD) { e = i; break }
  if (e < 0) throw new ZipError('corrupt_zip', 'لا نهاية')
  const total = v.getUint16(e + 10, true), cdSize = v.getUint32(e + 12, true), cdOff = v.getUint32(e + 16, true)
  if (cdOff + cdSize > e) throw new ZipError('corrupt_zip', 'دليل مركزي خارج النطاق')
  const out: ZipEntry[] = []
  const seen = new Set<string>()
  let p = cdOff
  for (let n = 0; n < total; n++) {
    if (p + 46 > e || v.getUint32(p, true) !== SIG_CENTRAL) throw new ZipError('corrupt_zip', 'سجل مركزي')
    const method = v.getUint16(p + 10, true), crc = v.getUint32(p + 16, true), csize = v.getUint32(p + 20, true), usize = v.getUint32(p + 24, true)
    const nlen = v.getUint16(p + 28, true), xlen = v.getUint16(p + 30, true), clen = v.getUint16(p + 32, true), lofs = v.getUint32(p + 42, true)
    if (method !== 0 || csize !== usize) throw new ZipError('corrupt_zip', 'طريقة غير مدعومة')
    let path: string
    try { path = dec.decode(bytes.subarray(p + 46, p + 46 + nlen)) } catch { throw new ZipError('corrupt_zip', 'اسم غير صالح') }
    assertZipPath(path)
    if (seen.has(path)) throw new ZipError('corrupt_zip', 'مدخل مكرر')
    seen.add(path)
    if (lofs + 30 > cdOff || v.getUint32(lofs, true) !== SIG_LOCAL) throw new ZipError('corrupt_zip', 'رأس محلي')
    const lnlen = v.getUint16(lofs + 26, true), lxlen = v.getUint16(lofs + 28, true)
    if (lnlen !== nlen || lofs + 30 + lnlen > cdOff || !bytes.subarray(lofs + 30, lofs + 30 + lnlen).every((b, i) => b === bytes[p + 46 + i])) throw new ZipError('corrupt_zip', 'اسم الرأس المحلي لا يطابق المركزي')
    const ds = lofs + 30 + lnlen + lxlen
    if (ds + usize > cdOff) throw new ZipError('corrupt_zip', 'بيانات خارج النطاق')
    const data = bytes.subarray(ds, ds + usize)
    if (crc32(data) !== crc) throw new ZipError('corrupt_zip', `CRC: ${path}`)
    out.push({ path, data })
    p += 46 + nlen + xlen + clen
  }
  return out
}
