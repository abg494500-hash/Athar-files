// مولَّد آليًا من server/db/types.ts بواسطة scripts/build-edge-function.mjs — لا تعدّليه يدويًا.
// واجهة وصول القاعدة للطبقة الخادمية. صغيرة عمدًا حتى يمكن تبديل المشغّل (psql المحلي للاختبار، PGlite، أو مشغّل Postgres حقيقي لاحقًا)
// دون لمس الخدمات. الخدمات لا تعرف أي مشغّل بعينه.
export interface SqlClient {
  /** استعلام يعيد صفوفًا (SELECT أو DML مع RETURNING). المعاملات تُمرَّر منفصلة ($1, $2 …) ولا تُدمَج في النص يدويًا. */
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]>
  /** أمر بلا صفوف (SET/BEGIN/UPDATE بلا RETURNING). */
  exec(sql: string, params?: readonly unknown[]): Promise<void>
}

export interface Db {
  /** ينفّذ fn داخل معاملة واحدة على اتصال واحد: commit عند النجاح وrollback عند أي استثناء (ثم يُعاد رميه). */
  transaction<T>(fn: (c: SqlClient) => Promise<T>): Promise<T>
  close(): Promise<void>
}

/** خطأ قاعدة بيانات برمز SQLSTATE (مثل 23505 تكرار، 23514 قيد، 42501 صلاحية). */
export class DbError extends Error {
  sqlstate: string
  constructor(sqlstate: string, message: string) {
    super(message)
    this.name = 'DbError'
    this.sqlstate = sqlstate
  }
}
