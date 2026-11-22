// تشخيص رفع R2 من Node (بلا متصفح ولا CORS). يوقّع الرابط بنفس كود الخادم (server/storage/sigv4.ts) ثم يرفع ملفًا نصيًا صغيرًا.
// الاستعمال: node scripts/r2-diagnose.mjs C:\athar-secrets\athar-test.env
// يقرأ R2_ACCOUNT_ID وR2_BUCKET وR2_ACCESS_KEY_ID وR2_SECRET_ACCESS_KEY من الملف، ولا يطبع أي سر.
// يكتب كائنين صغيرين (بضع بايتات) تحت المسار diagnostic/ في الحاوية، ولا يحذف شيئًا.
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const file = process.argv[2]
if (!file) { console.error('الاستعمال: node scripts/r2-diagnose.mjs <مسار ملف الأسرار>'); process.exit(2) }
const env = {}
for (const line of readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
for (const k of ['R2_ACCOUNT_ID', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']) if (!env[k]) { console.error('ناقص في الملف: ' + k); process.exit(2) }

const dir = mkdtempSync(join(tmpdir(), 'athar-diag-'))
const out = join(dir, 'sigv4.mjs')
await build({ entryPoints: ['server/storage/sigv4.ts'], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'silent' })
const { presign } = await import(pathToFileURL(out).href)

const creds = { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY }
const host = `${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
const body = Buffer.from('athar r2 diagnostic ' + new Date().toISOString())
const tag = (t, n) => (new RegExp(`<${n}>([^<]*)</${n}>`).exec(t) || [])[1] || '-'

async function attempt(name, signedHeaders) {
  const url = presign({ method: 'PUT', url: `https://${host}/${env.R2_BUCKET}/diagnostic/${name}-${Date.now()}.txt`, region: 'auto', creds, now: new Date(), expiresSec: 300, signedHeaders })
  try {
    const res = await fetch(url, { method: 'PUT', body, headers: { Origin: 'http://localhost:5173', 'Content-Type': 'text/plain' } })
    const t = await res.text()
    console.log(`[${name}] الحالة=${res.status} Code=${tag(t, 'Code')} Message=${tag(t, 'Message')} ACAO=${res.headers.get('access-control-allow-origin') ?? 'غائبة'}`)
  } catch (e) { console.log(`[${name}] فشل الاتصال: ${e.cause?.code ?? e.message}`) }
}
await attempt('A-with-content-length', { 'content-length': String(body.length) })
await attempt('B-host-only', undefined)
