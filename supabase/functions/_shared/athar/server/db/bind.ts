// مولَّد آليًا من server/db/bind.ts بواسطة scripts/build-edge-function.mjs — لا تعدّليه يدويًا.
// ربط المعاملات بنص SQL بقيم literal آمنة (تنصيص مضاعف، رفض NUL). مُستخرَج من psqlDb.ts دون تغيير في السلوك حتى يستعمله المشغّل الإنتاجي
// دون استيراد node:child_process. هذا هو الربط نفسه الذي اختُبر سابقًا على PostgreSQL 16 حقيقي (190+ اختبارًا في r17)،
// وهو سبب اختياره للإنتاج بدل البروتوكول الموسَّع: أنواع المعاملات غير المحدَّدة (INSERT … SELECT $n، وسائط الدوال) لا تُحَل خطأً.
// الأمان: الاستعلام يمرّ كنص واحد بعد تحويل كل قيمة إلى literal مُهرَّب؛ `standard_conforming_strings` مفعّل افتراضيًا في Supabase،
// ولا تُستعمل سلاسل E'' في الكود. لا يُدمَج أي نص من المستخدم في الاستعلام بغير هذا المسار.
/** يحوّل قيمة JS إلى literal آمن في SQL. */
export function sqlLiteral(v: unknown): string {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error('قيمة رقمية غير صالحة')
    return String(v)
  }
  if (typeof v === 'bigint') return v.toString()
  const s = v instanceof Date ? v.toISOString() : typeof v === 'string' ? v : JSON.stringify(v)
  if (s.includes('\0')) throw new Error('نص يحوي NUL')
  return `'${s.replace(/'/g, "''")}'`
}

export function bindParams(sql: string, params: readonly unknown[] = []): string {
  const used = new Set<number>()
  const out = sql.replace(/\$(\d+)(?![\w$])/g, (_m, d: string) => {
    const i = Number(d)
    if (i < 1 || i > params.length) throw new Error(`معامل غير معرَّف: $${i}`)
    used.add(i)
    return sqlLiteral(params[i - 1])
  })
  if (used.size !== params.length) throw new Error('معاملات غير مستعملة')
  return out
}
