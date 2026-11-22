// اختبار دخان لنسخة Edge المولَّدة في **عملية Node مستقلة** (لا vitest ولا Vite ولا jsdom): تُحمَّل الملفات المولَّدة بالاستيراد الصريح .ts كما يفعل Deno،
// ثم يمرّ طلبان عبر المضيف والتركيب. يطبع JSON واحدًا. يحتاج Node ≥ 22.6 مع --experimental-strip-types.
// الاستعمال: node --experimental-strip-types --no-warnings scripts/edge-smoke.mjs <جذر المشروع>
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(process.argv[2] ?? process.cwd())
const gen = (p) => pathToFileURL(join(root, 'supabase', 'functions', '_shared', 'athar', 'server', p)).href
const { composeApi } = await import(gen('api/compose.ts'))
const { createEdgeHandler } = await import(gen('host/edge.ts'))
const { createPostgresDb } = await import(gen('db/postgresDb.ts'))

// قيم اختبارية صريحة وبطول كافٍ (≥ 32) ومختلفة؛ ليست أسرارًا حقيقية.
const env = {
  SUPABASE_URL: 'https://proj.example.co', SUPABASE_ANON_KEY: 'anon-test-placeholder', R2_ACCOUNT_ID: 'a'.repeat(32), R2_BUCKET: 'athar-private',
  R2_ACCESS_KEY_ID: 'AKIA-TEST-ONLY', R2_SECRET_ACCESS_KEY: 'secret-test-only-123456',
  TEACHER_CODE_PEPPER: 'c'.repeat(40), TEACHER_IP_PEPPER: 'i'.repeat(40), ALLOWED_ORIGIN: 'https://athar.example',
}
const db = createPostgresDb({ begin: async () => { throw new Error('db must not be touched') }, end: async () => {} })
const h = createEdgeHandler({ getApi: async () => composeApi(env, db) })
const B = 'https://proj.supabase.co/functions/v1/api'
const health = await h(new Request(B + '/health'))
const me = await h(new Request(B + '/teacher/me'))
const owner = await h(new Request(B + '/staff/year-reset/report', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } }))
console.log(JSON.stringify({ health: health.status, me: [me.status, await me.json()], owner: owner.status }))
