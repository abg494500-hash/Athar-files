// @vitest-environment node
// استيراد المعلمات (A-119): CSV وExcel **حقيقيان** (يُكتب ملف xlsx بالمكتبة نفسها ويُقرأ، ويُقرأ ملف xlsx صُنع يدويًا بنص مشترك)، تحقق، تكرار، أسرار، حقن معادلات.
import { describe, expect, it } from 'vitest'
import writeXlsxFile from 'write-excel-file/universal'
import { zipSync, strToU8 } from 'fflate'
import { MAX_IMPORT_ROWS, checkRows, credentialsCsv, keyOf, matrixToRows, normalize, parseCsv, templateCsv } from '../lib/teacherImport/parse'
import { readImportFile, templateXlsxBlob } from '../lib/teacherImport/files'

const cell = (v: string | number) => ({ value: v, type: typeof v === 'number' ? Number : String })
const xlsx = async (rows: (string | number)[][]) => { const b = await (await writeXlsxFile(rows.map((r) => r.map(cell)) as never, {})).toBlob(); return Object.assign(b, { name: 'f.xlsx' }) }
const csv = (s: string, name = 'f.csv') => Object.assign(new Blob([s]), { name })

describe('parseCsv', () => {
  it('اقتباس وفواصل داخل الخلايا وسطور جديدة وBOM وفاصل منقوطة', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","he said ""hi"""\n')).toEqual([['a', 'b'], ['x, y', 'he said "hi"']])
    expect(parseCsv('اسم المعلمة;المادة\nسارة;علوم')).toEqual([['اسم المعلمة', 'المادة'], ['سارة', 'علوم']])
    expect(parseCsv('a\tb\nc\td')).toEqual([['a', 'b'], ['c', 'd']])
    expect(parseCsv('a,b\n"line1\nline2",z')[1]).toEqual(['line1\nline2', 'z'])
  })
})

describe('matrixToRows', () => {
  it('عناوين عربية/إنجليزية بأي ترتيب، وصفوف فارغة تُهمَل مع بقاء أرقام الأسطر', () => {
    const r = matrixToRows([['المادة', 'الاسم'], ['علوم', 'سارة أحمد'], ['', ''], ['رياضيات', 'منى سالم']])
    expect(r.rows).toEqual([{ line: 2, name: 'سارة أحمد', subject: 'علوم' }, { line: 4, name: 'منى سالم', subject: 'رياضيات' }])
    expect(matrixToRows([['Name', 'Subject'], ['Sara A', 'Math']]).rows).toHaveLength(1)
  })
  it('أعمدة ناقصة، فارغ، عمود أسرار ⇒ رفض الملف كله', () => {
    expect(matrixToRows([['اسم المعلمة'], ['س']]).error).toBe('missing_columns')
    expect(matrixToRows([]).error).toBe('empty'); expect(matrixToRows([['اسم المعلمة', 'المادة']]).error).toBe('empty')
    for (const h of ['كلمة المرور', 'الرقم السري', 'PIN', 'Password', 'كود الدخول']) expect(matrixToRows([['اسم المعلمة', 'المادة', h], ['سارة أحمد', 'علوم', '1234']]).error).toBe('secret_column')
  })
  it('أكثر من الحد ⇒ too_many_rows', () => {
    const m = [['اسم المعلمة', 'المادة'], ...Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => [`معلمة ${i}`, 'م'])]
    expect(matrixToRows(m).error).toBe('too_many_rows')
  })
})

describe('checkRows', () => {
  const ex = [{ name: 'منى سالم', subject: 'رياضيات' }]
  it('طول الاسم والمادة، المعادلات، الرموز، التكرار داخل الملف ومع الموجود، وتنبيه الاسم المتشابه', () => {
    const rows = [
      { line: 2, name: 'سارة أحمد', subject: 'علوم' }, { line: 3, name: 'سا', subject: 'علوم' }, { line: 4, name: 'نورة خالد', subject: '' },
      { line: 5, name: '=cmd|calc', subject: 'علوم' }, { line: 6, name: 'سارة   أحمد', subject: 'علوم' }, { line: 7, name: 'منى سالم', subject: 'رياضيات' },
      { line: 8, name: 'منى سالم', subject: 'فيزياء' }, { line: 9, name: 'a<b>c', subject: 'علوم' }, { line: 10, name: 'ه'.repeat(81), subject: 'علوم' },
    ]
    const c = checkRows(rows, ex)
    expect(c.map((x) => x.problems)).toEqual([[], ['name_short'], ['subject_short'], ['formula'], ['duplicate_in_file'], ['duplicate_existing'], [], ['bad_chars'], ['name_long']])
    expect(c[6]!.warnings).toEqual(['same_name_other_subject'])
    expect(c[4]!.name).toBe('سارة أحمد') // طُبِّع
  })
  it('التطبيع يزيل محارف الاتجاه والصفرية ويوحّد المسافات، والمفتاح غير حساس لحالة الأحرف', () => {
    expect(normalize('‏سارة​   أحمد‬ ')).toBe('سارة أحمد')
    expect(keyOf('Sara  A', 'Math')).toBe(keyOf('sara a', 'MATH'))
  })
})

describe('ملفات حقيقية', () => {
  it('xlsx مكتوب بالمكتبة: يُقرأ بالعربية والأرقام كنص', async () => {
    const f = await xlsx([['اسم المعلمة', 'المادة'], ['سارة بنت أحمد', 'رياضيات'], ['منى', 1234]])
    const r = await readImportFile(f)
    expect(r).toEqual({ ok: true, rows: [{ line: 2, name: 'سارة بنت أحمد', subject: 'رياضيات' }, { line: 3, name: 'منى', subject: '1234' }] })
  })
  it('قالب Excel الذي يولّده النظام يُقرأ بنجاح (عنوانان + مثالان)', async () => {
    const f = Object.assign(await templateXlsxBlob(), { name: 'قالب.xlsx' })
    const r = await readImportFile(f)
    expect(r.ok && r.rows.length).toBe(2)
  })
  it('xlsx صنعه Excel/LibreOffice بنص مشترك (sharedStrings) يُقرأ كذلك', async () => {
    const z = zipSync({
      '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>'),
      '_rels/.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
      'xl/workbook.xml': strToU8('<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>'),
      'xl/_rels/workbook.xml.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>'),
      'xl/sharedStrings.xml': strToU8('<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="4" uniqueCount="4"><si><t>اسم المعلمة</t></si><si><t>المادة</t></si><si><t>نورة الحارثية</t></si><si><t>لغة عربية</t></si></sst>'),
      'xl/worksheets/sheet1.xml': strToU8('<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c></row></sheetData></worksheet>'),
    })
    const f = Object.assign(new Blob([z as unknown as BlobPart]), { name: 'office.xlsx' })
    expect(await readImportFile(f)).toEqual({ ok: true, rows: [{ line: 2, name: 'نورة الحارثية', subject: 'لغة عربية' }] })
  })
  it('xlsx فيه عمود كلمة مرور ⇒ مرفوض كله؛ ملف تالف أو بنوع غير مدعوم أو كبير ⇒ أخطاء صريحة', async () => {
    expect(await readImportFile(await xlsx([['اسم المعلمة', 'المادة', 'كلمة المرور'], ['سارة أحمد', 'علوم', 'abc']]))).toEqual({ ok: false, error: 'secret_column' })
    expect(await readImportFile(Object.assign(new Blob(['not a zip']), { name: 'x.xlsx' }))).toEqual({ ok: false, error: 'unreadable' })
    expect(await readImportFile(Object.assign(new Blob(['x']), { name: 'x.xls' }))).toEqual({ ok: false, error: 'unsupported_type' })
    expect(await readImportFile(Object.assign(new Blob([new Uint8Array(2_000_001)]), { name: 'x.csv' }))).toEqual({ ok: false, error: 'too_large' })
  })
  it('CSV: قالب النظام نفسه، وملف بترميز BOM وفاصل منقوطة', async () => {
    const r = await readImportFile(csv(templateCsv())); expect(r.ok && r.rows.length).toBe(2)
    const r2 = await readImportFile(csv('﻿اسم المعلمة;المادة\r\nهدى الكلباني;أحياء\r\n')); expect(r2).toEqual({ ok: true, rows: [{ line: 2, name: 'هدى الكلباني', subject: 'أحياء' }] })
  })
  it('csv الأكواد: تُحمى الخلايا التي تبدأ برمز معادلة', () => {
    const out = credentialsCsv([{ name: '=HYPERLINK("x")', subject: 'علوم', code: 'AB-12' }])
    expect(out).toContain(`"'=HYPERLINK(""x"")"`); expect(out.startsWith('﻿')).toBe(true)
  })
})
