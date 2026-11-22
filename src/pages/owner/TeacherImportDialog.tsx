// استيراد المعلمات من Excel/CSV (A-119): قالبان، رفع، قراءة، معاينة بالتحقق وكشف التكرار، تصحيح الصف قبل الاعتماد، ثم استيراد ذرّي (كل الصفوف أو لا شيء)
// وتقرير نهائي. لا تُستورد كلمات مرور ولا أكواد (يُرفض الملف إن وُجد عمودها). الأكواد تُصدَر بعد الاستيراد وتُعرض مرة واحدة.
import { useRef, useState } from 'react'
import { Download, FileSpreadsheet, Upload } from 'lucide-react'
import { Alert } from '../../components/ui/misc'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Overlay'
import { Input } from '../../components/ui/Field'
import { useToast } from '../../components/ui/Toast'
import { staffMessage } from '../../lib/staffApi/client'
import type { ImportResult, StaffApiClient } from '../../lib/staffApi/client'
import { FILE_ERROR_TEXT, PROBLEM_TEXT, checkRows, credentialsCsv, templateCsv } from '../../lib/teacherImport/parse'
import type { ImportRow } from '../../lib/teacherImport/parse'
import { readImportFile, templateXlsxBlob } from '../../lib/teacherImport/files'

const save = (name: string, blob: Blob) => {
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.rel = 'noopener'
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export function TeacherImportDialog({ staffApi, onClose, onDone }: { staffApi: StaffApiClient; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const input = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<ImportRow[] | null>(null)
  const [existing, setExisting] = useState<{ name: string; subject: string }[]>([])
  const [fileErr, setFileErr] = useState<string | null>(null)
  const [skipBad, setSkipBad] = useState(false)
  const [issue, setIssue] = useState(true)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [fail, setFail] = useState<string | null>(null)

  const checked = rows ? checkRows(rows, existing) : []
  const bad = checked.filter((c) => c.problems.length > 0)
  const good = checked.filter((c) => c.problems.length === 0)
  const canImport = !!rows && good.length > 0 && (bad.length === 0 || skipBad) && !busy

  const pick = async (f: File | undefined) => {
    setFileErr(null); setRows(null); setFail(null)
    if (!f) return
    const r = await readImportFile(f)
    if (!r.ok) { setFileErr(FILE_ERROR_TEXT[r.error]); return }
    const ex = await staffApi.teachersForImportCheck()
    if (!ex.ok) { setFileErr(staffMessage(ex)); return }
    setExisting(ex.value); setRows(r.rows)
  }
  const edit = (line: number, k: 'name' | 'subject', v: string) => setRows((rs) => rs!.map((r) => (r.line === line ? { ...r, [k]: v } : r)))
  const run = async () => {
    setBusy(true); setFail(null)
    const r = await staffApi.importTeachers(good.map((g) => ({ name: g.name, subject: g.subject })), issue)
    setBusy(false)
    if (!r.ok) { setFail(staffMessage(r)); return }
    setResult(r.value); onDone(); toast(`استُورد ${r.value.imported.length} معلمة.`)
  }

  return (
    <Dialog open onClose={onClose} title="استيراد المعلمات من Excel أو CSV" description="ارفعي ملفًا بعمودين: اسم المعلمة والمادة. لا تضعي أكواد أو كلمات مرور في الملف."
      footer={result ? <Button onClick={onClose}>إغلاق</Button> : <><Button variant="secondary" onClick={onClose}>إلغاء</Button><Button icon={Upload} loading={busy} disabled={!canImport} onClick={() => void run()}>استيراد {good.length || ''} معلمة</Button></>}>
      <div className="space-y-4">
        {!result && (
          <>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" icon={FileSpreadsheet} onClick={() => void templateXlsxBlob().then((b) => save('قالب-المعلمات.xlsx', b))}>تنزيل قالب Excel</Button>
              <Button size="sm" variant="secondary" icon={Download} onClick={() => save('قالب-المعلمات.csv', new Blob([templateCsv()], { type: 'text/csv;charset=utf-8' }))}>تنزيل قالب CSV</Button>
            </div>
            <div>
              <input ref={input} type="file" accept=".xlsx,.csv,.txt" className="sr-only" aria-label="اختيار ملف المعلمات" onChange={(e) => void pick(e.target.files?.[0])} />
              <Button variant="secondary" icon={Upload} onClick={() => input.current?.click()}>اختيار ملف (.xlsx أو .csv)</Button>
            </div>
            {fileErr && <Alert tone="danger" title="تعذّرت قراءة الملف">{fileErr}</Alert>}
            {fail && <Alert tone="danger" title="لم يُستورد شيء">{fail}</Alert>}
            {rows && (
              <>
                <p className="text-[15px]" aria-live="polite">المعاينة: <b className="num">{good.length}</b> صف سليم · <b className="num text-late-fg">{bad.length}</b> صف به مشكلة (من {rows.length}).</p>
                <div className="max-h-72 overflow-auto rounded-2xl border border-snow-300">
                  <table className="w-full text-sm"><caption className="sr-only">معاينة صفوف الاستيراد</caption>
                    <thead className="bg-snow-100 text-ink-600"><tr><th className="p-2 text-start">سطر</th><th className="p-2 text-start">الاسم</th><th className="p-2 text-start">المادة</th><th className="p-2 text-start">الحالة</th></tr></thead>
                    <tbody>{checked.map((c) => (
                      <tr key={c.line} className={c.problems.length ? 'bg-late-bg' : ''}>
                        <td className="num p-2">{c.line}</td>
                        <td className="p-1"><Input aria-label={`اسم السطر ${c.line}`} value={rows.find((r) => r.line === c.line)!.name} onChange={(e) => edit(c.line, 'name', e.target.value)} /></td>
                        <td className="p-1"><Input aria-label={`مادة السطر ${c.line}`} value={rows.find((r) => r.line === c.line)!.subject} onChange={(e) => edit(c.line, 'subject', e.target.value)} /></td>
                        <td className="p-2 text-[13px]">{c.problems.length ? <span className="text-late-fg">{c.problems.map((p) => PROBLEM_TEXT[p]).join('، ')}</span> : <span className="text-ok-fg">سليم{c.warnings.length ? ' — تنبيه: الاسم موجود بمادة أخرى' : ''}</span>}</td>
                      </tr>))}</tbody>
                  </table>
                </div>
                {bad.length > 0 && <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={skipBad} onChange={(e) => setSkipBad(e.target.checked)} /><span>أصحّح الصفوف أعلاه، أو أتجاوزها وأستورد الصفوف السليمة فقط ({bad.length} صف لن يُستورد).</span></label>}
                <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={issue} onChange={(e) => setIssue(e.target.checked)} /><span>أصدر رمز الدخول لكل معلمة بعد الاستيراد (يُعرض مرة واحدة فقط).</span></label>
                <p className="text-[13px] text-ink-500">الاستيراد ذرّي: إما أن تُدرج كل الصفوف السليمة أو لا يُدرج شيء.</p>
              </>
            )}
          </>
        )}
        {result && (
          <div className="space-y-3" aria-live="polite">
            <Alert tone="info" title="تقرير الاستيراد">استُورد <b className="num">{result.imported.length}</b> معلمة · رُفض/تُجوّز <b className="num">{bad.length}</b> صف · رموز صادرة <b className="num">{result.issued.length}</b>{result.issueFailed.length ? <> · <b className="text-late-fg">تعذّر إصدار {result.issueFailed.length}</b> (أصدريها من القائمة)</> : null}.</Alert>
            {result.issued.length > 0 && (
              <>
                <Alert tone="warn" title="يظهر هذا الآن فقط">الرموز لا تُخزَّن بنصها ولا يمكن استرجاعها. نزّلي الملف الآن وسلّميها للمعلمات بطريقة تراها مناسبة، ثم احذفي الملف.</Alert>
                <Button icon={Download} onClick={() => save('أكواد-المعلمات.csv', new Blob([credentialsCsv(result.issued)], { type: 'text/csv;charset=utf-8' }))}>تنزيل ملف الرموز (CSV)</Button>
              </>
            )}
          </div>
        )}
      </div>
    </Dialog>
  )
}
