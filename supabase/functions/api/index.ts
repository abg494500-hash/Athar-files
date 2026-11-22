// نقطة دخول دالة Edge «api» (Supabase / Deno). **لم تُنشر ولم تُجرَّب في Deno حقيقي** (لا Deno في بيئة كتابتها).
// الكود الفعلي في ../_shared/athar (مولَّد من server/ بـ scripts/build-edge-function.mjs)؛ هذا الملف يحقن الأسرار والقاعدة ويستدعي Deno.serve فقط.
// الأسرار (تُضبط بـ `supabase secrets set` ولا تدخل Git ولا الحزمة): R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
//   TEACHER_CODE_PEPPER, TEACHER_IP_PEPPER (كل منهما ≥ 32 محرفًا ومختلف؛ TEACHER_PIN_PEPPER لم يعد مطلوبًا منذ r37)، ALLOWED_ORIGIN، واختياريًا MAX_OBJECT_BYTES وATHAR_DB_URL وATHAR_DB_SSL وATHAR_DB_ROLE.
// يوفّرها Supabase تلقائيًا للدالة: SUPABASE_URL، SUPABASE_ANON_KEY، SUPABASE_DB_URL. **لا تُستعمل SUPABASE_SERVICE_ROLE_KEY في هذا الكود إطلاقًا.**
// النشر يحتاج: verify_jwt = false (رمز المعلمة ليس JWT من Supabase؛ التحقق في الكود نفسه) — انظر docs/phase5/EDGE_HOST_AR.md.
import postgres from 'postgres'
import { ComposeError, composeApi } from '../_shared/athar/server/api/compose.ts'
import type { ServerEnv } from '../_shared/athar/server/api/compose.ts'
import { createPostgresDb } from '../_shared/athar/server/db/postgresDb.ts'
import type { PgPool } from '../_shared/athar/server/db/postgresDb.ts'
import { createEdgeHandler } from '../_shared/athar/server/host/edge.ts'

declare const Deno: {
  env: { get(key: string): string | undefined }
  serve(handler: (req: Request) => Response | Promise<Response>): unknown
}

const API_VERSION = '0.6.19'
const ENV_KEYS = [
  'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'R2_ACCOUNT_ID', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY',
  'TEACHER_CODE_PEPPER', 'TEACHER_IP_PEPPER', 'STAFF_LOGIN_EMAILS', 'ALLOWED_ORIGIN', 'MAX_OBJECT_BYTES',
] as const

function readEnv(): ServerEnv {
  const env: Record<string, string> = {}
  for (const k of ENV_KEYS) { const v = Deno.env.get(k); if (v !== undefined && v !== '') env[k] = v }
  return env as ServerEnv
}

// الاتصال المباشر (SUPABASE_DB_URL) يلائم دالة قليلة الحمل. للحمل الأعلى اضبطي ATHAR_DB_URL على عنوان المجمّع (Transaction pooler)؛
// بلا بيانات معدّة مسبقًا (prepare:false) فهو متوافق معه. SSL إلزامي افتراضيًا؛ ATHAR_DB_SSL=disable للتطوير المحلي فقط.
function openPool(): PgPool {
  const url = Deno.env.get('ATHAR_DB_URL') ?? Deno.env.get('SUPABASE_DB_URL')
  if (!url) throw new ComposeError('SUPABASE_DB_URL', 'مفقود')
  const sql = postgres(url, {
    max: 1, idle_timeout: 20, connect_timeout: 10, prepare: false,
    ssl: Deno.env.get('ATHAR_DB_SSL') === 'disable' ? false : 'require',
    onnotice: () => undefined,
  })
  return sql as unknown as PgPool
}

const handler = createEdgeHandler({
  functionName: 'api',
  version: API_VERSION,
  // لا يُسجَّل إلا الاسم والرسالة (رسائل ComposeError تسمّي المتغير فقط). لا أجسام ولا ترويسات ولا رموز.
  onError: (e) => console.error('[athar-api]', e instanceof Error ? `${e.name}: ${e.message}` : 'error'),
  getApi: async () => {
    const env = readEnv()
    // الدور الذي تعمل به الخدمات داخل كل معاملة (set local role). الافتراضي service_role كما اختُبرت الخدمات؛ ATHAR_DB_ROLE للتجاوز بعد مراجعة (مثلًا إن لم يُسمح بالتبديل).
    const role = Deno.env.get('ATHAR_DB_ROLE')
    const db = createPostgresDb(openPool(), role ? { role } : {})
    return composeApi(env, db, {
      // سطر JSON واحد لكل حدث تدقيق (بلا أسرار). التدقيق الدائم في audit_log يتم داخل composeApi نفسه.
      audit: (e) => { console.log(JSON.stringify({ kind: 'audit', at: e.at, actor: e.actor, action: e.action, outcome: e.outcome, target: e.target ?? null })) },
    })
  },
})

Deno.serve(handler)
