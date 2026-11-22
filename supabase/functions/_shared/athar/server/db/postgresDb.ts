// مولَّد آليًا من server/db/postgresDb.ts بواسطة scripts/build-edge-function.mjs — لا تعدّليه يدويًا.
// مشغّل قاعدة **الإنتاج** للخادم: يطبّق `Db` فوق عميل بصيغة postgres.js (الحزمة `npm:postgres` في Deno/دالة Edge).
// لا يستورد الحزمة نفسها (تُحقن من نقطة الدخول)، فيُختبر هنا ببديل. **لم يُجرَّب على PostgreSQL ولا على Supabase.**
// قرارات التصميم (بدائلها في docs/phase5/EDGE_HOST_AR.md):
//  1) تمثيل الصفوف مطابق تمامًا لـPsqlDb الذي اختُبرت عليه الخدمات: كل استعلام يُغلَّف بـ`jsonb_agg(to_jsonb(row))` فتعود التواريخ نصوص ISO
//     والأرقام الكبيرة أرقامًا وjsonb كائنات، مهما كانت إعدادات المشغّل. لا نعتمد على محلّلات أنواع postgres.js.
//  2) ربط المعاملات بقيم literal مُهرَّبة (bind.ts) كما في PsqlDb: لا بروتوكول موسَّع، فلا أخطاء «could not determine data type of parameter».
//  3) كل معاملة تبدأ بـ`set local role <الدور>` (service_role افتراضيًا) كما اختُبرت الخدمات؛ فتسري عليها صلاحيات الدور لا صلاحيات مالك القاعدة.
//     يلزم أن يكون الدور المتصل عضوًا فيه (postgres عضو في service_role على Supabase).
//  4) أخطاء PostgreSQL (رمز SQLSTATE من 5 خانات) تُحوَّل إلى DbError؛ غيرها (انقطاع الاتصال…) يُعاد رميه كما هو فتصير 500 عامة في المعالج.
import { bindParams } from './bind.ts'
import { DbError, type Db, type SqlClient } from './types.ts'

/** ما نحتاجه من معاملة postgres.js: تنفيذ نص كامل بلا معاملات. */
export interface PgTx { unsafe(query: string): PromiseLike<readonly Record<string, unknown>[]> }
/** ما نحتاجه من الاتصال/المجمّع في postgres.js. */
export interface PgPool {
  begin<T>(fn: (tx: PgTx) => Promise<T>): Promise<T>
  end(options?: { timeout?: number }): Promise<void>
}

export interface PostgresDbOptions {
  /** الدور الذي تُنفَّذ به الخدمات داخل المعاملة. */
  role?: string
}

const ROLE_RE = /^[a-z_][a-z0-9_]{0,62}$/

function toDbError(e: unknown): unknown {
  const code = (e as { code?: unknown } | null)?.code
  if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return new DbError(code, String((e as { message?: unknown }).message ?? 'db error'))
  return e
}

class TxClient implements SqlClient {
  private readonly tx: PgTx
  constructor(tx: PgTx) { this.tx = tx }
  async query<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
    const bound = bindParams(sql.replace(/;\s*$/, ''), params)
    let res: readonly Record<string, unknown>[]
    try {
      res = await this.tx.unsafe(`with __q as (${bound}) select coalesce(jsonb_agg(to_jsonb(__q)), '[]'::jsonb) as rows from __q`)
    } catch (e) { throw toDbError(e) }
    const cell = res[0]?.rows
    const rows = typeof cell === 'string' ? (JSON.parse(cell) as unknown) : cell
    if (!Array.isArray(rows)) throw new DbError('XX000', 'مخرجات غير متوقعة من القاعدة')
    return rows as T[]
  }
  async exec(sql: string, params: readonly unknown[] = []): Promise<void> {
    try { await this.tx.unsafe(bindParams(sql.replace(/;\s*$/, ''), params)) } catch (e) { throw toDbError(e) }
  }
}

export function createPostgresDb(pool: PgPool, o: PostgresDbOptions = {}): Db {
  const role = o.role ?? 'service_role'
  if (!ROLE_RE.test(role)) throw new Error('اسم دور غير صالح')
  return {
    async transaction<T>(fn: (c: SqlClient) => Promise<T>): Promise<T> {
      try {
        return await pool.begin(async (tx) => {
          await tx.unsafe(`set local role ${role}`)
          return fn(new TxClient(tx))
        })
      } catch (e) { throw toDbError(e) }
    },
    async close(): Promise<void> { await pool.end({ timeout: 5 }) },
  }
}
