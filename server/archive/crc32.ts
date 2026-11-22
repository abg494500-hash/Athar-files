// CRC-32 (IEEE 802.3، متعدد الحدود المعكوس 0xEDB88320) بجافاسكربت صرف. سبب وجوده: `crc32` في node:zlib أُضيف في Node 22.2،
// ولا ضمان أنه مدعوم في بيئة تشغيل Deno لدالة Edge؛ فلا نعتمد عليه. يُختبر مقابل node:zlib.crc32 وقيمة المرجع المعروفة ("123456789" ⇒ 0xCBF43926).
const TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(data: Uint8Array, seed = 0): number {
  let c = ~seed >>> 0
  for (let i = 0; i < data.length; i++) c = (TABLE[(c ^ (data[i] as number)) & 0xff] as number) ^ (c >>> 8)
  return ~c >>> 0
}
