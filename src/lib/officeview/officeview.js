// معاينة ملفات Word/Excel/PowerPoint (docx/xlsx/pptx) داخل المتصفح بلا اتصال ولا اعتماديات (r41).
// عرض نصّي أمين للمحتوى (نصوص، عناوين، جداول، أوراق، شرائح) وليس نسخة مطابقة للتنسيق؛ الصور والمخططات لا تُعرض.
// كل النصوص تُدخَل بـ textContent فقط (لا innerHTML). نص برمجي كلاسيكي يضع window.AtharOffice (يعمل من file:// أيضًا).
(function () {
  'use strict'
  var MAX_ENTRY = 40 * 1024 * 1024, MAX_ROWS = 300, MAX_COLS = 40, MAX_BLOCKS = 4000
  function fail(code) { var e = new Error(code); e.code = code; return e }

  // ---------- قارئ ZIP (stored + deflate عبر DecompressionStream) ----------
  function u16(d, o) { return d[o] | (d[o + 1] << 8) }
  function u32(d, o) { return (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0 }
  function readCentral(d) {
    var i = d.length - 22, min = Math.max(0, d.length - 22 - 65535)
    while (i >= min && u32(d, i) !== 0x06054b50) i--
    if (i < min) throw fail('corrupt')
    var n = u16(d, i + 10), off = u32(d, i + 16), out = {}, dec = new TextDecoder('utf-8')
    for (var k = 0; k < n; k++) {
      if (u32(d, off) !== 0x02014b50) throw fail('corrupt')
      var flags = u16(d, off + 8), method = u16(d, off + 10), csize = u32(d, off + 20), usize = u32(d, off + 24)
      var nl = u16(d, off + 28), el = u16(d, off + 30), cl = u16(d, off + 32), lo = u32(d, off + 42)
      out[dec.decode(d.subarray(off + 46, off + 46 + nl))] = { method: method, csize: csize, usize: usize, lo: lo, enc: flags & 1 }
      off += 46 + nl + el + cl
    }
    return out
  }
  async function inflate(raw) {
    if (typeof DecompressionStream === 'undefined') throw fail('unsupported_browser')
    var ds = new DecompressionStream('deflate-raw')
    var w = ds.writable.getWriter(); w.write(raw).catch(function () {}); w.close().catch(function () {})
    var r = ds.readable.getReader(), chunks = [], total = 0
    for (;;) {
      var x = await r.read(); if (x.done) break
      total += x.value.length; if (total > MAX_ENTRY) { r.cancel(); throw fail('too_large') }
      chunks.push(x.value)
    }
    var out = new Uint8Array(total), p = 0
    chunks.forEach(function (c) { out.set(c, p); p += c.length })
    return out
  }
  function openZip(buf) {
    var d = new Uint8Array(buf), cen = readCentral(d)
    return {
      has: function (n) { return !!cen[n] },
      names: function () { return Object.keys(cen) },
      text: async function (n) {
        var e = cen[n]; if (!e) return null
        if (e.enc) throw fail('encrypted')
        if (e.usize > MAX_ENTRY) throw fail('too_large')
        var o = e.lo, nl = u16(d, o + 26), el = u16(d, o + 28), s = o + 30 + nl + el
        var raw = d.subarray(s, s + e.csize)
        var data = e.method === 0 ? raw : e.method === 8 ? await inflate(raw) : null
        if (!data) throw fail('corrupt')
        return new TextDecoder('utf-8').decode(data)
      },
    }
  }
  function xml(text) {
    var doc = new DOMParser().parseFromString(text, 'application/xml')
    if (doc.getElementsByTagName('parsererror').length) throw fail('corrupt')
    return doc
  }
  function kids(n, name) { var r = []; for (var c = n.firstChild; c; c = c.nextSibling) if (c.nodeType === 1 && c.localName === name) r.push(c); return r }
  function first(n, name) { return n ? kids(n, name)[0] || null : null }
  function descs(n, name) { return Array.prototype.slice.call(n.getElementsByTagNameNS('*', name)) }
  function attr(n, name) { if (!n) return null; for (var i = 0; i < n.attributes.length; i++) if (n.attributes[i].localName === name) return n.attributes[i].value; return null }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n }

  // ---------- Word ----------
  function wOn(rpr, name) { var n = first(rpr, name); if (!n) return false; var v = attr(n, 'val'); return v !== '0' && v !== 'false' && v !== 'none' }
  function wPara(p) {
    var ppr = first(p, 'pPr'), style = attr(first(ppr, 'pStyle'), 'val') || '', rtl = !!first(ppr, 'bidi')
    var level = /^(Heading|heading|عنوان|Title)\s*([1-6])?/.exec(style), tag = level ? 'h' + Math.min(6, Math.max(2, Number(level[2] || 1) + 1)) : 'p'
    var node = el(tag, 'ao-p'); node.setAttribute('dir', rtl ? 'rtl' : 'auto')
    var num = first(ppr, 'numPr'), jc = attr(first(ppr, 'jc'), 'val')
    if (jc === 'center') node.style.textAlign = 'center'
    if (num) node.appendChild(document.createTextNode('• '))
    var any = false
    function run(r) {
      var rpr = first(r, 'rPr'), txt = ''
      for (var c = r.firstChild; c; c = c.nextSibling) {
        if (c.nodeType !== 1) continue
        if (c.localName === 't') txt += c.textContent; else if (c.localName === 'tab') txt += '\t'
        else if (c.localName === 'br' || c.localName === 'cr') { flush(); node.appendChild(document.createElement('br')) }
      }
      function flush() { if (!txt) return; any = true; var s = el('span', null, txt); if (wOn(rpr, 'b')) s.style.fontWeight = '700'; if (wOn(rpr, 'i')) s.style.fontStyle = 'italic'; if (wOn(rpr, 'u')) s.style.textDecoration = 'underline'; node.appendChild(s); txt = '' }
      flush()
    }
    for (var c = p.firstChild; c; c = c.nextSibling) {
      if (c.nodeType !== 1) continue
      if (c.localName === 'r') run(c)
      else if (c.localName === 'hyperlink' || c.localName === 'smartTag' || c.localName === 'sdt' || c.localName === 'ins') kids(c, 'r').forEach(run)
    }
    if (!any && !node.childNodes.length) node.appendChild(document.createElement('br'))
    return node
  }
  function wTable(t) {
    var tb = el('table', 'ao-t'), body = el('tbody')
    kids(t, 'tr').forEach(function (tr) {
      var row = el('tr')
      kids(tr, 'tc').forEach(function (tc) {
        var cell = el('td'); kids(tc, 'p').forEach(function (p) { cell.appendChild(wPara(p)) })
        var span = attr(first(first(tc, 'tcPr'), 'gridSpan'), 'val'); if (span && Number(span) > 1) cell.colSpan = Math.min(50, Number(span))
        row.appendChild(cell)
      })
      body.appendChild(row)
    })
    tb.appendChild(body); return tb
  }
  async function renderDocx(zip) {
    var t = await zip.text('word/document.xml'); if (t == null) throw fail('corrupt')
    var body = first(xml(t).documentElement, 'body'), root = el('div', 'ao-doc'), n = 0
    if (!body) throw fail('corrupt')
    for (var c = body.firstChild; c; c = c.nextSibling) {
      if (c.nodeType !== 1) continue
      if (++n > MAX_BLOCKS) { root.appendChild(el('p', 'ao-note', 'اقتُطع العرض لطول المستند. نزّلي الملف لرؤية الباقي.')); break }
      if (c.localName === 'p') root.appendChild(wPara(c)); else if (c.localName === 'tbl') root.appendChild(wTable(c))
    }
    return root
  }

  // ---------- Excel ----------
  function colIdx(ref) { var m = /^([A-Z]+)/.exec(ref || ''), n = 0; if (!m) return 0; for (var i = 0; i < m[1].length; i++) n = n * 26 + (m[1].charCodeAt(i) - 64); return n - 1 }
  function colName(i) { var s = ''; i++; while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26) } return s }
  function relMap(text) { var m = {}; if (text) descs(xml(text).documentElement, 'Relationship').forEach(function (r) { m[attr(r, 'Id')] = attr(r, 'Target') }); return m }
  function joinPath(base, target) { if (target.charAt(0) === '/') return target.slice(1); var parts = base.split('/'); parts.pop(); target.split('/').forEach(function (p) { if (p === '..') parts.pop(); else if (p !== '.') parts.push(p) }); return parts.join('/') }
  async function renderXlsx(zip) {
    var wbT = await zip.text('xl/workbook.xml'); if (wbT == null) throw fail('corrupt')
    var rels = relMap(await zip.text('xl/_rels/workbook.xml.rels'))
    var sst = [], sT = await zip.text('xl/sharedStrings.xml')
    if (sT) kids(xml(sT).documentElement, 'si').forEach(function (si) { sst.push(descs(si, 't').map(function (t) { return t.textContent }).join('')) })
    var sheets = descs(xml(wbT).documentElement, 'sheet').map(function (s, i) { return { name: attr(s, 'name') || 'ورقة ' + (i + 1), rid: attr(s, 'id') } })
    var root = el('div', 'ao-xl'), tabs = el('div', 'ao-tabs'), pane = el('div', 'ao-pane')
    root.appendChild(tabs); root.appendChild(pane)
    var cache = {}
    async function show(i, btn) {
      Array.prototype.forEach.call(tabs.children, function (b) { b.setAttribute('aria-selected', b === btn ? 'true' : 'false') })
      pane.textContent = ''
      if (!cache[i]) {
        var target = rels[sheets[i].rid], path = target ? joinPath('xl/workbook.xml', target) : 'xl/worksheets/sheet' + (i + 1) + '.xml'
        var t = await zip.text(path), wrap = el('div', 'ao-scroll')
        if (t == null) wrap.appendChild(el('p', 'ao-note', 'تعذّر قراءة هذه الورقة.'))
        else {
          var sd = first(xml(t).documentElement, 'sheetData'), rows = sd ? kids(sd, 'row') : [], grid = [], maxC = 0, cut = false
          rows.forEach(function (r) {
            var ri = Number(attr(r, 'r') || grid.length + 1) - 1
            if (ri >= MAX_ROWS) { cut = true; return }
            var line = grid[ri] = grid[ri] || []
            kids(r, 'c').forEach(function (c) {
              var ci = colIdx(attr(c, 'r')); if (ci >= MAX_COLS) { cut = true; return }
              var ty = attr(c, 't'), v = first(c, 'v'), val = ''
              if (ty === 'inlineStr') val = descs(c, 't').map(function (x) { return x.textContent }).join('')
              else if (v) { val = v.textContent; if (ty === 's') val = sst[Number(val)] || ''; else if (ty === 'b') val = val === '1' ? 'صحيح' : 'خطأ' }
              line[ci] = val; if (ci + 1 > maxC) maxC = ci + 1
            })
          })
          if (!maxC) wrap.appendChild(el('p', 'ao-note', 'ورقة فارغة.'))
          else {
            var tb = el('table', 'ao-t'), head = el('tr'), hb = el('thead')
            head.appendChild(el('th', 'ao-rn', ''))
            for (var c = 0; c < maxC; c++) head.appendChild(el('th', null, colName(c)))
            hb.appendChild(head); tb.appendChild(hb)
            var bd = el('tbody')
            for (var r = 0; r < grid.length; r++) {
              var tr = el('tr'); tr.appendChild(el('th', 'ao-rn', String(r + 1)))
              for (var cc = 0; cc < maxC; cc++) { var td = el('td', null, (grid[r] && grid[r][cc]) || ''); td.setAttribute('dir', 'auto'); tr.appendChild(td) }
              bd.appendChild(tr)
            }
            tb.appendChild(bd); wrap.appendChild(tb)
            if (cut) wrap.appendChild(el('p', 'ao-note', 'اقتُطع العرض (حتى ' + MAX_ROWS + ' صف و' + MAX_COLS + ' عمودًا). نزّلي الملف لرؤية الباقي.'))
          }
        }
        cache[i] = wrap
      }
      pane.appendChild(cache[i])
    }
    sheets.forEach(function (s, i) { var b = el('button', null, s.name); b.type = 'button'; b.setAttribute('role', 'tab'); b.addEventListener('click', function () { void show(i, b) }); tabs.appendChild(b) })
    if (!sheets.length) throw fail('corrupt')
    await show(0, tabs.children[0])
    return root
  }

  // ---------- PowerPoint ----------
  async function renderPptx(zip) {
    var pt = await zip.text('ppt/presentation.xml'); if (pt == null) throw fail('corrupt')
    var rels = relMap(await zip.text('ppt/_rels/presentation.xml.rels'))
    var rids = descs(xml(pt).documentElement, 'sldId').map(function (s) { return s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') })
    var root = el('div', 'ao-ppt')
    for (var i = 0; i < rids.length; i++) {
      var target = rels[rids[i]]; if (!target) continue
      var t = await zip.text(joinPath('ppt/presentation.xml', target)); if (t == null) continue
      var card = el('section', 'ao-slide'); card.appendChild(el('div', 'ao-sn', 'شريحة ' + (i + 1)))
      var any = false
      descs(xml(t).documentElement, 'sp').forEach(function (sp) {
        var ph = descs(sp, 'ph')[0], isTitle = !!ph && /title|ctrTitle/i.test(attr(ph, 'type') || '')
        descs(sp, 'p').forEach(function (p) {
          var txt = descs(p, 't').map(function (x) { return x.textContent }).join('')
          if (!txt.trim()) return
          any = true; var n = el(isTitle ? 'h3' : 'p', isTitle ? 'ao-st' : 'ao-p', txt); n.setAttribute('dir', 'auto'); card.appendChild(n)
        })
      })
      descs(xml(t).documentElement, 'tbl').forEach(function (tbl) {
        var tb = el('table', 'ao-t'), bd = el('tbody')
        kids(tbl, 'tr').forEach(function (tr) { var row = el('tr'); kids(tr, 'tc').forEach(function (tc) { var td = el('td', null, descs(tc, 't').map(function (x) { return x.textContent }).join('')); td.setAttribute('dir', 'auto'); row.appendChild(td) }); bd.appendChild(row) })
        tb.appendChild(bd); card.appendChild(tb); any = true
      })
      if (!any) card.appendChild(el('p', 'ao-note', 'لا نص في هذه الشريحة (صور أو أشكال فقط).'))
      root.appendChild(card)
    }
    if (!root.querySelector('.ao-slide')) throw fail('corrupt')
    return root
  }

  var CSS = '.ao{font-family:inherit;color:#1f2a3a;line-height:1.7}.ao-note{font-size:13px;color:#667085;margin:8px 0}.ao-doc{max-width:820px;margin:0 auto;background:#fff;padding:24px 28px;border-radius:12px}.ao-p{margin:0 0 .6em;white-space:pre-wrap}h2.ao-p,h3.ao-p,h4.ao-p{font-weight:700;margin:1em 0 .5em}.ao-t{border-collapse:collapse;margin:10px 0;font-size:14px;background:#fff}.ao-t td,.ao-t th{border:1px solid #dbe4ef;padding:4px 8px;vertical-align:top}.ao-t th{background:#f4f7fb;font-weight:600;color:#475467}.ao-rn{width:1%;white-space:nowrap;text-align:center}.ao-scroll{overflow:auto;max-height:60vh;border:1px solid #dbe4ef;border-radius:12px;background:#fff}.ao-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}.ao-tabs button{border:1px solid #dbe4ef;background:#fff;border-radius:10px;padding:6px 12px;cursor:pointer;font:inherit}.ao-tabs button[aria-selected=true]{background:#e8eefb;border-color:#9db4e0;font-weight:600}.ao-slide{background:#fff;border:1px solid #dbe4ef;border-radius:14px;padding:16px 20px;margin:0 auto 14px;max-width:820px;box-shadow:0 1px 2px rgba(42,59,82,.04)}.ao-sn{font-size:12px;color:#667085;margin-bottom:8px}.ao-st{font-size:20px;font-weight:700;margin:0 0 .6em}'
  function injectCss() { if (document.getElementById('ao-css')) return; var s = document.createElement('style'); s.id = 'ao-css'; s.textContent = CSS; document.head.appendChild(s) }

  window.AtharOffice = {
    SUPPORTED: { docx: 1, xlsx: 1, pptx: 1 },
    /** يبني عنصر DOM لمعاينة الملف، أو يرمي خطأ بـ code: unsupported | unsupported_browser | encrypted | too_large | corrupt. */
    render: async function (buf, ext) {
      ext = String(ext || '').toLowerCase()
      if (!this.SUPPORTED[ext]) throw fail('unsupported')
      injectCss()
      var zip
      try { zip = openZip(buf) } catch (e) { throw e.code ? e : fail('corrupt') }
      var node
      try { node = ext === 'docx' ? await renderDocx(zip) : ext === 'xlsx' ? await renderXlsx(zip) : await renderPptx(zip) } catch (e) { throw e.code ? e : fail('corrupt') }
      var wrap = el('div', 'ao'); wrap.appendChild(node)
      wrap.appendChild(el('p', 'ao-note', 'معاينة نصّية للمحتوى؛ قد يختلف التنسيق والصور عن الملف الأصلي. نزّلي الملف لرؤيته كاملًا.'))
      return wrap
    },
  }
})()
