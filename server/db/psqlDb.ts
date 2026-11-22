// مشغّل **اختبار محلي فقط**: يدير عمليات `psql` دائمة نحو PostgreSQL محلي مؤقت ويحوّل الاستعلامات إلى JSON.
// لماذا؟ بيئة بناء هذه الطبقة لا تصل إلى سجل npm (لا pg ولا PGlite)، لكن فيها PostgreSQL 16 حقيقي؛ هذا المشغّل يتيح تشغيل
// الخدمات على محرك Postgres فعلي بمشغّلاته وقيوده. **لا يُستعمل في الإنتاج** ولا يتصل إلا بخادم محلي وقاعدة اسمها athar_test*.
// حدوده: دمج المعاملات في النص يتم هنا بتحويل آمن لقيم literal (تنصيص + رفض NUL)، لا بالبروتوكول الموسَّع كما يفعل مشغّل إنتاج.
// لذلك لا يثبت هذا المشغّل سلامة المعاملات في مشغّل الإنتاج. تبديله بـPGlite أو pg يتم بكتابة محوّل `Db` صغير (انظر docs/phase5/SERVER_DB_EMULATOR.md).
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { DbError, type Db, type SqlClient } from './types'

export interface PsqlDbOptions {
  /** مسار مجلد socket محلي أو localhost/127.0.0.1. أي مضيف آخر يُرفض. */
  host: string
  port?: number
  user?: string
  /** يجب أن يبدأ الاسم بـ athar_test. */
  database: string
  /** الدور الذي تعمل به الخدمات (يحاكي service_role). */
  role?: string
  /** مهلة كل أمر بالميلي ثانية. */
  timeoutMs?: number
  /** أقصى عدد اتصالات متزامنة. */
  maxConnections?: number
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

export function assertLocalTestTarget(host: string, database: string): void {
  if (!(host.startsWith('/') || LOCAL_HOSTS.has(host))) throw new Error(`مرفوض: مشغّل الاختبار يتصل بخادم محلي فقط (المضيف: ${host})`)
  if (!/^athar_test[A-Za-z0-9_]*$/.test(database)) throw new Error(`مرفوض: اسم القاعدة يجب أن يبدأ بـ athar_test (${database})`)
}

export { bindParams, sqlLiteral } from './bind'
import { bindParams } from './bind'

class Conn {
  private proc: ChildProcessWithoutNullStreams
  private out = ''
  private err = ''
  private waiter: ((s: string) => void) | null = null
  private seq = 0
  private dead = false
  private readonly o: Required<Pick<PsqlDbOptions, 'host' | 'database' | 'user' | 'timeoutMs'>> & { port: number }
  constructor(o: Required<Pick<PsqlDbOptions, 'host' | 'database' | 'user' | 'timeoutMs'>> & { port: number }) {
    this.o = o
    // بلا shell (يعمل على Windows أيضًا): الخطأ على stderr والنتيجة على stdout، وتُنهى كل جملة بعلامة على القناتين.
    this.proc = spawn('psql', ['-X', '-q', '-At', '-v', 'VERBOSITY=verbose', '-v', 'ON_ERROR_STOP=0'], {
      env: { ...process.env, PGHOST: o.host, PGPORT: String(o.port), PGUSER: o.user, PGDATABASE: o.database, PGOPTIONS: '-c client_min_messages=warning' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.proc.stdout.setEncoding('utf8')
    this.proc.stderr.setEncoding('utf8')
    this.proc.stdout.on('data', (d: string) => { this.out += d; this.pump() })
    this.proc.stderr.on('data', (d: string) => { this.err += d; this.pump() })
    this.proc.on('error', () => { this.dead = true; this.pump() })
    this.proc.on('exit', () => { this.dead = true; this.pump() })
    this.proc.stdin.on('error', () => { this.dead = true })
  }
  private pump(): void {
    if (!this.waiter) return
    const mo = /__END__(\d+)\r?\n/.exec(this.out)
    const me = /__END__(\d+)\r?\n/.exec(this.err)
    if (mo && me) {
      const text = this.err.slice(0, me.index) + this.out.slice(0, mo.index)
      this.out = this.out.slice(mo.index + mo[0].length)
      this.err = this.err.slice(me.index + me[0].length)
      const w = this.waiter
      this.waiter = null
      w(text)
    } else if (this.dead) {
      const w = this.waiter
      this.waiter = null
      w(`ERROR:  08006: connection lost\n${this.err}${this.out}`)
    }
  }
  /** يرسل جملة SQL واحدة ويعيد المخرجات الخام (الأخطاء ثم النتيجة) حتى العلامة. */
  raw(sql: string): Promise<string> {
    if (this.dead) return Promise.resolve('ERROR:  08006: connection lost')
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.proc.kill('SIGKILL'); this.dead = true; this.pump() }, this.o.timeoutMs)
      this.waiter = (s) => { clearTimeout(timer); resolve(s) }
      this.seq += 1
      this.proc.stdin.write(`${sql.replace(/;\s*$/, '')};\n\\echo __END__${this.seq}\n\\warn __END__${this.seq}\n`)
    })
  }
  get alive(): boolean { return !this.dead }
  close(): void {
    try { this.proc.stdin.end('\\q\n') } catch { /* ignore */ }
    setTimeout(() => this.proc.kill('SIGKILL'), 500).unref()
  }
}

function parseError(text: string): DbError | null {
  const m = /^ERROR:\s+([0-9A-Z]{5}):\s*(.*)$/m.exec(text)
  if (m) return new DbError(m[1], m[2])
  if (/^(ERROR|FATAL|psql: error):/m.test(text)) return new DbError('XX000', text.trim().slice(0, 300))
  return null
}

class PsqlClient implements SqlClient {
  private readonly c: Conn
  constructor(c: Conn) { this.c = c }
  async query<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
    const text = await this.c.raw(`with __q as (${bindParams(sql.replace(/;\s*$/, ''), params)}) select coalesce(jsonb_agg(to_jsonb(__q)), '[]'::jsonb) from __q`)
    const err = parseError(text)
    if (err) throw err
    const line = text.split('\n').find((l) => l.startsWith('['))
    if (line === undefined) throw new DbError('XX000', `مخرجات غير متوقعة: ${text.slice(0, 200)}`)
    return JSON.parse(line) as T[]
  }
  async exec(sql: string, params: readonly unknown[] = []): Promise<void> {
    const err = parseError(await this.c.raw(bindParams(sql, params)))
    if (err) throw err
  }
}

export class PsqlDb implements Db {
  private readonly o: Required<PsqlDbOptions>
  private idle: Conn[] = []
  private open = 0
  private queue: Array<(c: Conn) => void> = []
  private closed = false

  constructor(opts: PsqlDbOptions) {
    assertLocalTestTarget(opts.host, opts.database)
    this.o = { port: 5432, user: 'postgres', role: 'service_role', timeoutMs: 20_000, maxConnections: 8, ...opts }
  }

  private async acquire(): Promise<Conn> {
    if (this.closed) throw new Error('الاتصال مغلق')
    for (;;) {
      const c = this.idle.pop()
      if (!c) break
      if (c.alive) return c
      this.open -= 1
    }
    if (this.open < this.o.maxConnections) {
      this.open += 1
      const c = new Conn(this.o)
      const err = parseError(await c.raw(`set role ${this.o.role.replace(/[^a-z_]/g, '')}`))
      if (err) { this.open -= 1; c.close(); throw err }
      return c
    }
    return new Promise<Conn>((resolve) => this.queue.push(resolve))
  }

  private release(c: Conn): void {
    if (!c.alive) { this.open -= 1; const w = this.queue.shift(); if (w) void this.acquire().then(w); return }
    const w = this.queue.shift()
    if (w) w(c)
    else this.idle.push(c)
  }

  async transaction<T>(fn: (c: SqlClient) => Promise<T>): Promise<T> {
    const c = await this.acquire()
    const client = new PsqlClient(c)
    try {
      await client.exec('begin')
      let result: T
      try {
        result = await fn(client)
      } catch (e) {
        await client.exec('rollback').catch(() => undefined)
        throw e
      }
      await client.exec('commit')
      return result
    } finally {
      this.release(c)
    }
  }

  async close(): Promise<void> {
    this.closed = true
    for (const c of this.idle) c.close()
    this.idle = []
  }
}
