// shim أدنى لـ describe/it/expect فوق node:test. يغطي المطابقات المستعملة في اختبارات upload فقط.
import { describe as nd, it as ni } from 'node:test'
import assert from 'node:assert/strict'

export const describe = (name, fn) => nd(name, fn)
export const it = (name, fn) => ni(name, fn)

function matchers(actual, negate) {
  const check = (ok, msg) => { if (negate ? ok : !ok) assert.fail((negate ? 'لا يجب: ' : '') + msg) }
  return {
    toBe: (e) => check(Object.is(actual, e), `${String(actual)} ≠ ${String(e)}`),
    toEqual: (e) => { if (e && e[ARRAY_CONTAINING]) { check(subset(actual, e), `${JSON.stringify(actual)} لا يحوي ${JSON.stringify(e.items)}`); return } let ok = true; try { assert.deepStrictEqual(actual, e) } catch { ok = false } check(ok, `${JSON.stringify(actual)} ≠ ${JSON.stringify(e)}`) },
    toBeNull: () => check(actual === null, `${String(actual)} ليس null`),
    toBeUndefined: () => check(actual === undefined, `${String(actual)} ليس undefined`),
    toBeTruthy: () => check(Boolean(actual), `${String(actual)} ليس truthy`),
    toBeFalsy: () => check(!actual, `${String(actual)} ليس falsy`),
    toBeGreaterThan: (e) => check(actual > e, `${actual} ≤ ${e}`),
    toBeLessThan: (e) => check(actual < e, `${actual} ≥ ${e}`),
    toBeGreaterThanOrEqual: (e) => check(actual >= e, `${actual} < ${e}`),
    toBeLessThanOrEqual: (e) => check(actual <= e, `${actual} > ${e}`),
    toContain: (e) => check(actual.includes(e), `لا يحتوي ${String(e)}`),
    toHaveLength: (e) => check(actual.length === e, `الطول ${actual.length} ≠ ${e}`),
    toMatch: (e) => check(typeof actual === 'string' && (e instanceof RegExp ? e.test(actual) : actual.includes(e)), `${String(actual)} لا يطابق ${String(e)}`),
    toThrow: () => { let threw = false; try { actual() } catch { threw = true } check(threw, 'لم يُرمَ خطأ') },
  }
}
const ARRAY_CONTAINING = Symbol('arrayContaining')
function subset(a, e) {
  if (e && e[ARRAY_CONTAINING]) return Array.isArray(a) && e.items.every((x) => a.some((y) => subset(y, x)))
  if (e !== null && typeof e === 'object') return a !== null && typeof a === 'object' && Object.keys(e).every((k) => subset(a[k], e[k]))
  return Object.is(a, e)
}
export function expect(actual) {
  const m = matchers(actual, false)
  m.not = matchers(actual, true)
  const mo = (neg) => (e) => { const ok = subset(actual, e); if (neg ? ok : !ok) assert.fail(`toMatchObject: ${JSON.stringify(actual)} vs ${JSON.stringify(e)}`) }
  m.toMatchObject = mo(false); m.not.toMatchObject = mo(true)
  const rej = async (fn) => { let err; let threw = false; try { await actual } catch (e) { threw = true; err = e } if (!threw) assert.fail('لم يُرفض الوعد'); return fn(err) }
  m.rejects = {
    toThrow: () => rej(() => undefined),
    toMatchObject: (e) => rej((err) => { if (!subset(err, e)) assert.fail(`rejects.toMatchObject: ${String(err && err.message)} / ${JSON.stringify(err)} vs ${JSON.stringify(e)}`) }),
  }
  return m
}
expect.arrayContaining = (items) => ({ [ARRAY_CONTAINING]: true, items })
