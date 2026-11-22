// فحص ساكن لتوافق **شيفرة الخادم** مع **مخطط SQL النهائي** (database/001..008): الجداول والأعمدة والدوال التي تذكرها عبارات SQL في server/**.
// ليس محلّل SQL كاملًا: يلتقط الأنماط الشائعة (alias.col، insert into T (cols)، update T set col=، دوال public.fn). لا يغني عن تشغيل SQL على PostgreSQL.
// الاستعمال: node scripts/check-code-sql-compat.mjs   (يخرج بـ1 عند وجود عدم توافق)
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const strip = (s) => s.replace(/--[^\n]*/g, '')
const files = ['001_schema', '002_integrity', '003_rls', '004_upload_tables', '005_staff_accounts', '006_teacher_sessions', '007_server_additions', '008_teacher_removal', '009_archive_parts', '010_year_reset', '011_years_teachers_import', '012_teacher_delete', '013_reset_for_staff', '014_reset_light_gate']
const sql = files.map((f) => strip(readFileSync(join(root, 'database', f + '.sql'), 'utf8'))).join('\n')

const tables = new Map() // name -> Set(columns)
for (const m of sql.matchAll(/create table (?:if not exists )?public\.(\w+)\s*\(([\s\S]*?)\n\);/g)) {
  const cols = new Set()
  let depth = 0, cur = ''
  const lines = []
  for (const ch of m[2]) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && depth === 0) { lines.push(cur); cur = '' } else cur += ch }
  lines.push(cur)
  for (const l of lines) { const t = l.trim().match(/^(\w+)\s/); if (t && !/^(primary|unique|check|foreign|constraint)$/i.test(t[1])) cols.add(t[1]) }
  tables.set(m[1], cols)
}
for (const m of sql.matchAll(/alter table (?:only )?public\.(\w+)([\s\S]*?);/g)) {
  const set = tables.get(m[1]); if (!set) continue
  for (const c of m[2].matchAll(/add column (?:if not exists )?(\w+)/g)) set.add(c[1])
}
const funcs = new Set([...sql.matchAll(/create (?:or replace )?function public\.(\w+)/g)].map((m) => m[1]))

const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? (n === 'test' ? [] : walk(p)) : p.endsWith('.ts') ? [p] : [] })
const problems = []
let checked = 0
for (const f of walk(join(root, 'server'))) {
  const src = readFileSync(f, 'utf8')
  // كل نص (قالب/اقتباس) يحوي public.
  for (const lit of src.matchAll(/`([^`]*public\.[^`]*)`|'([^'\n]*public\.[^'\n]*)'|"([^"\n]*public\.[^"\n]*)"/g)) {
    const s = (lit[1] ?? lit[2] ?? lit[3]).replace(/\$\{[^}]*\}/g, 'X')
    checked++
    const rel = f.replace(root, '')
    const alias = new Map()
    for (const m of s.matchAll(/\b(?:from|join|update|into)\s+public\.(\w+)(?:\s+(?:as\s+)?(?!set\b|where\b|join\b|on\b|for\b|left\b|inner\b|order\b|group\b|values\b|select\b|using\b|returning\b)(\w+))?/gi)) {
      if (!tables.has(m[1])) { problems.push(`${rel}: جدول غير موجود public.${m[1]}`); continue }
      alias.set(m[1], m[1]); if (m[2]) alias.set(m[2], m[1])
    }
    for (const m of s.matchAll(/\b(\w+)\.(\w+)\b/g)) {
      const t = alias.get(m[1]); if (!t || m[1] === 'public') continue
      if (!tables.get(t).has(m[2])) problems.push(`${rel}: العمود ${m[1]}.${m[2]} غير موجود في public.${t}`)
    }
    // عبارة بجدول واحد: أعمدة قائمة select البسيطة وأعمدة `col = $n` غير المسبوقة بـalias تُفحص مقابل ذلك الجدول.
    const only = new Set(alias.values())
    if (only.size === 1 && !/\bjoin\b/i.test(s)) {
      const T = [...only][0], cols = tables.get(T)
      const sel = s.match(/\bselect\b([\s\S]*?)\bfrom\s+public\./i)
      if (sel) {
        let depth = 0, cur = ''; const parts = []
        for (const ch of sel[1]) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && depth === 0) { parts.push(cur); cur = '' } else cur += ch }
        parts.push(cur)
        for (const p of parts) { const t = p.trim().replace(/::\w+(\[\])?$/, '').replace(/\s+as\s+\w+$/i, ''); if (/^[a-z_]\w*$/.test(t) && !['now', 'true', 'false', 'null'].includes(t) && !cols.has(t)) problems.push(`${rel}: select يذكر عمودًا غير موجود: public.${T}.${t}`) }
      }
      for (const m of s.matchAll(/(?:\bwhere\b|\band\b|\bset\b|,)\s+(\w+)\s*(?:=|<>|<|>|<=|>=)\s*\$\d/gi)) if (!cols.has(m[1]) && !/^\d/.test(m[1])) problems.push(`${rel}: شرط يذكر عمودًا غير موجود: public.${T}.${m[1]}`)
    }
    for (const m of s.matchAll(/insert into public\.(\w+)\s*\(([^)]*)\)/gi)) {
      const set = tables.get(m[1]); if (!set) continue
      for (const c of m[2].split(',').map((x) => x.trim()).filter(Boolean)) if (!set.has(c)) problems.push(`${rel}: insert في public.${m[1]} عمود غير موجود: ${c}`)
    }
    for (const m of s.matchAll(/update public\.(\w+)(?:\s+\w+)?\s+set\s+([\s\S]*?)(?:\bwhere\b|\breturning\b|$)/gi)) {
      const set = tables.get(m[1]); if (!set) continue
      for (const c of m[2].matchAll(/(?:^|,)\s*(\w+)\s*=/g)) if (!set.has(c[1])) problems.push(`${rel}: update في public.${m[1]} عمود غير موجود: ${c[1]}`)
    }
    for (const m of s.matchAll(/public\.(\w+)\s*\(/g)) if (!funcs.has(m[1]) && !tables.has(m[1]) && m[1] !== 'upload_sessions') problems.push(`${rel}: دالة غير معرَّفة public.${m[1]}()`)
  }
}
console.log(`جداول: ${tables.size}، دوال: ${funcs.size}، عبارات مفحوصة: ${checked}`)
if (problems.length) { console.log([...new Set(problems)].join('\n')); console.log(`\nعدم توافق: ${new Set(problems).size}`); process.exit(1) }
console.log('لا عدم توافق ظاهر (فحص ساكن فقط).')
