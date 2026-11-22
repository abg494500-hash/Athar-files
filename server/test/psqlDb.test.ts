// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { PsqlDb, assertLocalTestTarget, bindParams, sqlLiteral } from '../db/psqlDb'
import { DbError } from '../db/types'
import { HAS_PG, createTestEnv } from './helpers/testDb'

function thrown(fn: () => unknown): string {
  try { fn() } catch (e) { return (e as Error).message }
  return ''
}

describe('مشغّل الاختبار المحلي — الحراسة والتنصيص (بلا قاعدة)', () => {
  it('يرفض أي مضيف غير محلي وأي قاعدة لا تبدأ بـ athar_test', () => {
    for (const h of ['db.example.com', 'abcdefgh.supabase.co', '10.0.0.5', '', 'localhost.evil.com']) expect(thrown(() => assertLocalTestTarget(h, 'athar_test_a'))).toMatch('مرفوض')
    for (const d of ['postgres', 'athar', 'prod', 'athar_test; drop', 'ATHAR_TEST', 'xathar_test']) expect(thrown(() => assertLocalTestTarget('/tmp/s', d))).toMatch('مرفوض')
    expect(thrown(() => assertLocalTestTarget('/tmp/s', 'athar_test_svc_1'))).toBe('')
    expect(thrown(() => assertLocalTestTarget('localhost', 'athar_test'))).toBe('')
  })
  it('المنشئ نفسه يطبّق الحراسة', () => {
    expect(thrown(() => new PsqlDb({ host: 'db.supabase.co', database: 'athar_test_x' }))).toMatch('مرفوض')
  })
  it('التنصيص: علامة الاقتباس تُضاعف، NUL يُرفض، الأنواع تُحوَّل', () => {
    expect(sqlLiteral("it's")).toBe("'it''s'")
    expect(sqlLiteral("'; drop table x; --")).toBe("'''; drop table x; --'")
    expect(sqlLiteral(null)).toBe('null')
    expect(sqlLiteral(undefined)).toBe('null')
    expect(sqlLiteral(5)).toBe('5')
    expect(sqlLiteral(true)).toBe('true')
    expect(sqlLiteral({ a: "x'y" })).toBe(`'{"a":"x''y"}'`)
    expect(thrown(() => sqlLiteral('a\0b'))).toMatch('NUL')
    expect(thrown(() => sqlLiteral(Number.NaN))).toMatch('غير صالحة')
    expect(thrown(() => sqlLiteral(Infinity))).toMatch('غير صالحة')
  })
  it('الربط: معامل ناقص أو زائد يُرفض، والنص المستبدَل لا يُعاد تفسيره', () => {
    expect(bindParams('select $1, $2', ['a', 2])).toBe("select 'a', 2")
    expect(thrown(() => bindParams('select $2', ['a']))).toMatch('غير معرَّف')
    expect(thrown(() => bindParams('select 1', ['a']))).toMatch('غير مستعملة')
    // قيمة تحوي "$2" لا تُستبدل ثانية (الاستبدال في تمريرة واحدة)
    expect(bindParams('select $1, $2', ['$2', 'z'])).toBe("select '$2', 'z'")
  })
})

describe(HAS_PG ? 'مشغّل الاختبار المحلي — على Postgres محلي' : 'مشغّل الاختبار المحلي — تخطّي: لا ATHAR_TEST_PG', () => {
  it('commit وrollback وأخطاء SQLSTATE وحقن النص', async () => {
    if (!HAS_PG) return
    const e = await createTestEnv()
    try {
      const n = async () => (await e.db.transaction((c) => c.query<{ n: number }>('select count(*)::int as n from public.slots')))[0].n
      const before = await n()
      await e.db.transaction((c) => c.exec(`insert into public.slots (id, title, optional, ord) values ($1, $2, true, 9)`, ['s9', 'x']))
      expect(await n()).toBe(before + 1)
      // rollback عند الاستثناء
      let msg = ''
      try {
        await e.db.transaction(async (c) => {
          await c.exec(`insert into public.slots (id, title, optional, ord) values ('s8', 'y', true, 8)`)
          throw new Error('boom')
        })
      } catch (x) { msg = (x as Error).message }
      expect(msg).toBe('boom')
      expect(await n()).toBe(before + 1)
      // SQLSTATE: تكرار مفتاح، ثم الاتصال يبقى صالحًا بعد الخطأ
      let code = ''
      try { await e.db.transaction((c) => c.exec(`insert into public.slots (id, title, optional, ord) values ('s9', 'dup', true, 10)`)) } catch (x) { code = (x as DbError).sqlstate }
      expect(code).toBe('23505')
      expect(await n()).toBe(before + 1)
      // حقن: القيمة الخبيثة تُخزَّن نصًا حرفيًا ولا تنفَّذ
      const evil = `x'); drop table public.slots; --`
      await e.db.transaction((c) => c.exec(`insert into public.slots (id, title, optional, ord) values ('s7', $1, true, 7)`, [evil]))
      const back = await e.db.transaction((c) => c.query<{ title: string }>(`select title from public.slots where id = 's7'`))
      expect(back[0].title).toBe(evil)
      // نص متعدد الأسطر وعربي ومحارف خاصة يعود سليمًا
      const odd = 'سطر1\nسطر2 "اقتباس" \\ \t 😀'
      const r = await e.db.transaction((c) => c.query<{ t: string }>('select $1::text as t', [odd]))
      expect(r[0].t).toBe(odd)
    } finally { await e.dispose() }
  })
  it('الدور service_role: بلا صلاحية سوبر (لا يستطيع إنشاء دور)', async () => {
    if (!HAS_PG) return
    const e = await createTestEnv()
    try {
      let code = ''
      try { await e.db.transaction((c) => c.exec('create role hacker')) } catch (x) { code = (x as DbError).sqlstate }
      expect(code).toBe('42501')
    } finally { await e.dispose() }
  })
})
