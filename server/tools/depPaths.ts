// مسارات الاعتماد من package-lock.json (lockfileVersion 2/3) دون npm ولا شبكة: لكل حزمة (كل نسخها المثبتة) يعطي الإصدار، إنتاج/تطوير،
// هل هي مباشرة في package.json، أقصر مسار من الجذر، ومن يطلبها وبأي نطاق. مبنية على خوارزمية حلّ node_modules نفسها (الأقرب أولًا ثم الأعلى).
// حدودها: تعتمد على أن package-lock.json متّسق مع node_modules؛ لا تعرف شيئًا عن الثغرات (هذا في auditSummary).
export interface LockPkg { version?: string; dev?: boolean; optional?: boolean; peer?: boolean; dependencies?: Record<string, string>; devDependencies?: Record<string, string>; optionalDependencies?: Record<string, string>; peerDependencies?: Record<string, string>; peerDependenciesMeta?: Record<string, { optional?: boolean }>; resolved?: string; integrity?: string; hasInstallScript?: boolean; link?: boolean }
export interface Lock { packages?: Record<string, LockPkg> }

export interface Instance {
  key: string
  name: string
  version: string
  scope: 'prod' | 'dev'
  direct: boolean
  rootRange: string | null
  /** أقصر مسار من المشروع إلى الحزمة، كل عنصر name@version. */
  path: string[]
  dependents: { name: string; version: string; range: string; kind: 'dependencies' | 'devDependencies' | 'optionalDependencies' | 'peerDependencies' }[]
}

const KINDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const
const nameOf = (key: string): string => key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length)

/** يحلّ اسم اعتمادية من حزمة معيّنة: node_modules الأقرب ثم الأعلى. */
export function resolveDep(pk: Record<string, LockPkg>, fromKey: string, dep: string): string | null {
  let base = fromKey
  for (;;) {
    const cand = base ? `${base}/node_modules/${dep}` : `node_modules/${dep}`
    if (pk[cand]) return cand
    if (base === '') return null
    const i = base.lastIndexOf('/node_modules/')
    base = i === -1 ? '' : base.slice(0, i)
  }
}

export function explain(lock: Lock, name: string): Instance[] {
  const pk = lock.packages ?? {}
  const rootName = pk['']?.version !== undefined ? 'المشروع' : 'المشروع'
  // BFS من الجذر
  const parent = new Map<string, string | null>([['', null]])
  const queue: string[] = ['']
  const dependents = new Map<string, Instance['dependents']>()
  while (queue.length) {
    const cur = queue.shift() as string
    const p = pk[cur]
    if (!p) continue
    for (const kind of KINDS) {
      // devDependencies تُحتسب للجذر فقط (npm لا يثبّت devDependencies للاعتماديات)
      if (kind === 'devDependencies' && cur !== '') continue
      for (const [dep, range] of Object.entries(p[kind] ?? {})) {
        const t = resolveDep(pk, cur, dep)
        if (!t) continue
        const list = dependents.get(t) ?? []
        list.push({ name: cur === '' ? rootName : nameOf(cur), version: p.version ?? '?', range, kind })
        dependents.set(t, list)
        if (!parent.has(t)) { parent.set(t, cur); queue.push(t) }
      }
    }
  }
  const root = pk[''] ?? {}
  const out: Instance[] = []
  for (const key of Object.keys(pk)) {
    if (key === '' || !key.includes('node_modules/') || nameOf(key) !== name) continue
    const chain: string[] = []
    for (let k: string | null = key; k !== null && k !== undefined; k = parent.get(k) ?? null) { chain.unshift(k === '' ? rootName : `${nameOf(k)}@${pk[k]?.version ?? '?'}`); if (k === '') break }
    const rootRange = (root.dependencies ?? {})[name] ?? (root.devDependencies ?? {})[name] ?? (root.optionalDependencies ?? {})[name] ?? null
    out.push({
      key, name, version: pk[key]?.version ?? '?', scope: pk[key]?.dev === true ? 'dev' : 'prod',
      direct: key === `node_modules/${name}` && rootRange !== null, rootRange,
      path: parent.has(key) ? chain : ['(غير موصول بالجذر في القفل)'], dependents: dependents.get(key) ?? [],
    })
  }
  return out.sort((a, b) => a.key.localeCompare(b.key))
}

export function renderPaths(name: string, inst: Instance[]): string {
  if (inst.length === 0) return `- **${name}**: غير مثبَّتة في package-lock.json\n`
  return inst.map((i) => [
    `- **${i.name}@${i.version}** (${i.scope === 'prod' ? 'إنتاج' : 'تطوير'}${i.direct ? `، مباشرة في package.json بالنطاق ${i.rootRange}` : '، متعدّية'}) — الموضع \`${i.key}\``,
    `  - المسار: ${i.path.join(' ← ')}`,
    ...i.dependents.slice(0, 6).map((d) => `  - يطلبها ${d.name}@${d.version} (${d.kind}: ${d.range})`),
  ].join('\n')).join('\n') + '\n'
}
