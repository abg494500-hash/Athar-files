// تشغيل أوامر npm للقراءة فقط (audit/view/ls/outdated) من سكربتاتنا. وسائط محدودة بقائمة بيضاء لأن التشغيل عبر shell (ضروري على Windows لـnpm.cmd بعد قيود Node ≥ 20.12).
// لا يُمرَّر أي نص من المستخدم؛ الأسماء تأتي من package.json/تقرير npm نفسه وتُتحقَّق بنفس القائمة. لا أوامر تثبيت أو تعديل هنا.
import { spawnSync } from 'node:child_process'

const SAFE_ARG = /^[@A-Za-z0-9._/=-]+$/
const READ_ONLY = new Set(['audit', 'view', 'ls', 'outdated', '--version'])

export function runNpm(args, { cwd, timeoutMs = 180_000 } = {}) {
  if (!READ_ONLY.has(args[0])) throw new Error(`أمر npm غير مسموح في السكربتات القرائية: ${args[0]}`)
  if (args[0] === 'audit' && args.includes('fix') && !args.includes('--dry-run')) throw new Error('npm audit fix بلا --dry-run ممنوع هنا')
  for (const a of args) if (!SAFE_ARG.test(a)) throw new Error(`وسيط npm غير مسموح: ${a}`)
  const r = spawnSync('npm', args, { cwd, shell: true, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 512 * 1024 * 1024 })
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', error: r.error ? String(r.error.message) : null }
}

/** npm يطبع JSON حتى مع رمز خروج غير صفري (وجود ثغرات/قديم). يعيد { ok, data, code, note }. */
export function runNpmJson(args, opts) {
  const r = runNpm(args, opts)
  if (r.error) return { ok: false, data: null, code: r.code, note: r.error }
  const text = r.stdout.trim()
  if (!text) return { ok: false, data: null, code: r.code, note: (r.stderr || 'مخرجات فارغة').trim().slice(0, 400) }
  try { return { ok: true, data: JSON.parse(text), code: r.code, note: null } } catch { return { ok: false, data: null, code: r.code, note: `ليس JSON: ${text.slice(0, 200)}` } }
}
