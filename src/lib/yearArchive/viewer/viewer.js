// عارض أرشيف أثَر (قراءة فقط، بلا اتصال، بلا اعتماديات). يقرأ window.ATHAR_ARCHIVE من data.js، ويعرض كل النصوص عبر textContent فقط (لا innerHTML).
(function () {
  'use strict'
  var D = window.ATHAR_ARCHIVE
  var app = document.getElementById('app')
  var IMG = { png: 1, jpg: 1, jpeg: 1, gif: 1, webp: 1 }

  function el(tag, attrs, kids) {
    var n = document.createElement(tag)
    if (attrs) for (var k in attrs) { if (k === 'class') n.className = attrs[k]; else if (k === 'text') n.textContent = attrs[k]; else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]); else n.setAttribute(k, attrs[k]) }
    if (kids) kids.forEach(function (c) { if (c != null) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c) })
    return n
  }
  function num(n) { return Number(n).toLocaleString('ar-OM-u-nu-latn') }
  function size(b) { if (b == null) return '—'; if (b < 1024) return num(b) + ' ب'; if (b < 1048576) return num(Math.round(b / 102.4) / 10) + ' ك.ب'; return num(Math.round(b / 104857.6) / 10) + ' م.ب' }
  function date(iso) { try { return new Date(iso).toLocaleString('ar-OM-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Muscat' }) } catch (e) { return iso } }
  function norm(s) { return String(s || '').toLowerCase().replace(/[ً-ٰٟـ]/g, '').replace(/[إأآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه') }
  function chip(t, k) { return el('span', { class: 'chip' + (k ? ' ' + k : ''), text: t }) }
  function stLabel(s) { return s === 'late' ? chip('متأخر', 'late') : chip('في الموعد', 'ok') }

  var teachersById = {}, slotsById = {}, termsById = {}, vers = {}
  D.teachers.forEach(function (t) { teachersById[t.id] = t })
  D.slots.forEach(function (s) { slotsById[s.id] = s })
  D.terms.forEach(function (t) { termsById[t.id] = t })
  D.versions.forEach(function (v) { var k = v.teacherId + '|' + v.termId + '|' + v.slotId; (vers[k] = vers[k] || []).push(v) })
  Object.keys(vers).forEach(function (k) { vers[k].sort(function (a, b) { return a.no - b.no }) })
  // أجزاء الأرشيف: كل جزء يحمل ملف علامة parts/part-NN.js؛ نحمّلها بوسم script (يعمل من file://) لنعرف أيّ الأجزاء استُخرجت في المجلد.
  var PARTS = D.parts || [], settled = false, pending = PARTS.length
  window.ATHAR_PARTS = window.ATHAR_PARTS || {}
  function pad(n) { return n < 10 ? '0' + n : String(n) }
  function hasPart(n) { return !PARTS.length || !!window.ATHAR_PARTS[n] }
  function missingParts() { return PARTS.filter(function (p) { return !hasPart(p.no) }) }
  function banner() {
    var b = document.getElementById('partsBanner'), m = settled ? missingParts() : []
    if (!b) return
    b.hidden = !m.length
    b.textContent = m.length ? 'أرشيف ناقص: لم تُستخرج الأجزاء ' + m.map(function (p) { return p.no }).join('، ') + ' من أصل ' + PARTS.length + ' في هذا المجلد. استخرجي كل الأجزاء في المجلد نفسه؛ ملفات الأجزاء الناقصة لن تُعرض.' : ''
  }
  function settle() { settled = true; banner(); route() }
  window.addEventListener('athar-parts-check', settle)
  PARTS.forEach(function (p) {
    var s = document.createElement('script'); s.src = 'parts/part-' + pad(p.no) + '.js'
    function fin() { if (--pending <= 0) settle() }
    s.onload = fin; s.onerror = fin; document.head.appendChild(s)
  })
  function teacherLabel(t) { return t.removedAt ? t.name + ' (محذوفة من المنصة)' : t.name }
  function countFor(tid) { return D.versions.filter(function (v) { return v.teacherId === tid }).length }

  function stat(v, label) { return el('div', { class: 'card stat' }, [el('b', { class: 'num', text: v }), el('span', { text: label })]) }

  function home() {
    var t = D.totals
    app.appendChild(el('h1', { text: 'أرشيف السنة الدراسية ' + D.year.label }))
    app.appendChild(el('p', { class: 'muted', text: 'أُنشئ في ' + date(D.createdAt) + ' · هذه نسخة مستقلة عن المنصة الحية.' }))
    app.appendChild(el('div', { class: 'grid' }, [stat(num(t.teachers), 'معلمة'), stat(num(t.terms), 'فصل دراسي'), stat(num(t.submissions), 'تسليم'), stat(num(t.versions), 'إصدار'), stat(num(t.files), 'ملف'), stat(size(t.fileBytes), 'حجم الملفات')]))
    app.appendChild(el('h2', { text: 'الفصول الدراسية' }))
    app.appendChild(el('div', { class: 'grid' }, D.terms.map(function (tm) {
      var c = D.versions.filter(function (v) { return v.termId === tm.id }).length
      return el('a', { class: 'card link', href: '#/teachers' }, [el('b', { text: tm.name }), el('div', { class: 'muted', text: num(c) + ' إصدارًا' })])
    })))
  }

  function teachers() {
    app.appendChild(el('h1', { text: 'المعلمات' }))
    if (!D.teachers.length) return app.appendChild(el('div', { class: 'empty', text: 'لا توجد معلمات في هذا الأرشيف.' }))
    app.appendChild(el('div', { class: 'grid' }, D.teachers.map(function (t) {
      return el('a', { class: 'card link', href: '#/teacher/' + t.id }, [
        el('b', { text: teacherLabel(t) }), el('div', { class: 'muted', text: t.subject }),
        el('div', null, [chip(num(countFor(t.id)) + ' إصدارًا'), t.active ? null : chip('غير نشطة', 'miss')])])
    })))
  }

  // معاينة Word/Excel/PowerPoint: نقرأ الملف من المجلد (يعمل عند الفتح عبر خادم)، وإن منع المتصفح القراءة من file:// نطلب من المستخدمة اختيار الملف.
  function officePreview(body, v, ext) {
    var host = el('div', { class: 'office-host' }, [el('p', { class: 'muted', text: 'جارٍ تجهيز المعاينة…' })])
    body.appendChild(host)
    function show(buf) {
      window.AtharOffice.render(buf, ext).then(function (n) { host.textContent = ''; host.appendChild(n) }, function (e) {
        host.textContent = ''; host.appendChild(el('p', { class: 'muted', text: e && e.code === 'encrypted' ? 'الملف محمي بكلمة مرور؛ نزّليه لفتحه.' : 'تعذّر قراءة محتوى الملف؛ نزّليه لفتحه في برنامجه.' }))
      })
    }
    function pick() {
      host.textContent = ''
      host.appendChild(el('p', { text: 'المتصفح لا يسمح بقراءة ملفات المجلد تلقائيًا عند الفتح من الجهاز. اختاري الملف «' + (v.name || '') + '» من مجلد الأرشيف لمعاينته هنا:' }))
      var inp = el('input', { type: 'file', accept: '.' + ext })
      inp.addEventListener('change', function () { var f = inp.files && inp.files[0]; if (f) { host.textContent = ''; host.appendChild(el('p', { class: 'muted', text: 'جارٍ تجهيز المعاينة…' })); f.arrayBuffer().then(show, pick) } })
      host.appendChild(inp)
    }
    try { fetch(v.path).then(function (r) { if (!r.ok) throw new Error('http'); return r.arrayBuffer() }).then(show, pick) } catch (e) { pick() }
  }

  function openPreview(v) {
    var body = el('div', { class: 'dlg-b' })
    var ext = (v.ext || '').toLowerCase()
    if (v.kind === 'file' && settled && !hasPart(v.part)) body.appendChild(el('p', { class: 'warn', text: 'هذا الملف في الجزء ' + v.part + ' من الأرشيف وهو غير موجود في المجلد. استخرجي كل الأجزاء في المجلد نفسه.' }))
    else if (v.kind === 'link') { body.appendChild(el('p', { text: 'رابط خارجي (لا يُحفظ محتواه في الأرشيف):' })); body.appendChild(el('p', { class: 'hash', text: v.url })) }
    else if (IMG[ext]) body.appendChild(el('img', { src: v.path, alt: v.name || '' }))
    else if (ext === 'pdf') body.appendChild(el('iframe', { src: v.path, title: v.name || 'PDF' }))
    else if (v.kind === 'file' && window.AtharOffice && window.AtharOffice.SUPPORTED[ext]) officePreview(body, v, ext)
    else body.appendChild(el('p', { text: 'لا تتوفر معاينة لهذا النوع. يمكن فتحه بالبرنامج المناسب بعد تنزيله.' }))
    if (v.kind === 'file' && hasPart(v.part)) body.appendChild(el('p', null, [el('a', { class: 'btn', href: v.path, download: v.name || '' }, ['تنزيل الملف'])]))
    var ov = el('div', { class: 'overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'معاينة' }, [
      el('div', { class: 'dlg' }, [el('div', { class: 'dlg-h' }, [el('b', { text: v.name || v.url || '' }), el('button', { class: 'btn', onclick: close }, ['إغلاق'])]), body])])
    function close() { document.removeEventListener('keydown', key); ov.remove() }
    function key(e) { if (e.key === 'Escape') close() }
    ov.addEventListener('click', function (e) { if (e.target === ov) close() })
    document.addEventListener('keydown', key)
    document.body.appendChild(ov)
  }

  function versionTable(list, showSlot) {
    var rows = list.map(function (v) {
      return el('tr', null, [
        showSlot ? el('td', { text: (slotsById[v.slotId] || {}).title || v.slotId }) : null,
        el('td', { class: 'num', text: 'إصدار ' + num(v.no) }), el('td', { text: date(v.submittedAt) }), el('td', null, [stLabel(v.status)]),
        el('td', { text: v.kind === 'link' ? 'رابط' : (v.name || '—') }), el('td', { class: 'num', text: v.kind === 'link' ? '—' : size(v.size) }),
        el('td', null, [el('button', { class: 'btn', onclick: function () { openPreview(v) } }, [v.kind === 'link' ? 'عرض' : 'معاينة'])])])
    })
    var head = el('tr', null, [showSlot ? el('th', { text: 'الخانة' }) : null, el('th', { text: 'الإصدار' }), el('th', { text: 'تاريخ التسليم' }), el('th', { text: 'الحالة' }), el('th', { text: 'الاسم' }), el('th', { text: 'الحجم' }), el('th', { text: '' })])
    return el('table', null, [el('thead', null, [head]), el('tbody', null, rows)])
  }

  function teacher(id) {
    var t = teachersById[id]
    if (!t) return notFound()
    app.appendChild(el('p', null, [el('a', { href: '#/teachers' }, ['← كل المعلمات'])]))
    app.appendChild(el('h1', { text: teacherLabel(t) }))
    app.appendChild(el('p', { class: 'muted' }, [t.subject, ' · ', t.active ? 'نشطة' : 'غير نشطة', t.credential ? ' · حالة الرمز عند الأرشفة: ' + (t.credential.state === 'active' ? 'فعّال' : 'ملغى') : '']))
    var cur = D.terms[0] ? D.terms[0].id : null
    var tabs = el('div', { class: 'tabs', role: 'tablist' }), pane = el('div')
    function show(termId) {
      cur = termId
      Array.prototype.forEach.call(tabs.children, function (b) { b.className = b.getAttribute('data-t') === termId ? 'on' : ''; b.setAttribute('aria-selected', b.getAttribute('data-t') === termId ? 'true' : 'false') })
      pane.textContent = ''
      var any = false
      D.slots.forEach(function (s) {
        var list = vers[t.id + '|' + termId + '|' + s.id] || []
        var last = list[list.length - 1]
        any = any || !!last
        var box = el('div', { class: 'slot' }, [el('div', { class: 'slot-h' }, [el('b', { text: s.title + (s.optional ? ' (اختيارية)' : '') }),
          el('span', null, [last ? stLabel(last.status) : chip('لم يُسلَّم', 'miss'), last ? chip(num(list.length) + (list.length > 1 ? ' إصدارات' : ' إصدار')) : null])])])
        if (list.length) box.appendChild(versionTable(list.slice().reverse(), false))
        pane.appendChild(box)
      })
      if (!any) pane.insertBefore(el('div', { class: 'empty', text: 'لا تسليمات لهذه المعلمة في هذا الفصل.' }), pane.firstChild)
    }
    D.terms.forEach(function (tm) { tabs.appendChild(el('button', { 'data-t': tm.id, role: 'tab', onclick: function () { show(tm.id) } }, [tm.name])) })
    app.appendChild(tabs); app.appendChild(pane)
    if (cur) show(cur)
  }

  function search(q) {
    var n = norm(q)
    app.appendChild(el('h1', { text: 'نتائج البحث: ' + q }))
    if (!n) return app.appendChild(el('div', { class: 'empty', text: 'اكتبي كلمة للبحث.' }))
    var ts = D.teachers.filter(function (t) { return norm(t.name).indexOf(n) >= 0 || norm(t.subject).indexOf(n) >= 0 })
    var vs = D.versions.filter(function (v) { return norm(v.name).indexOf(n) >= 0 || norm(v.url).indexOf(n) >= 0 || norm((slotsById[v.slotId] || {}).title).indexOf(n) >= 0 })
    if (!ts.length && !vs.length) return app.appendChild(el('div', { class: 'empty', text: 'لا نتائج مطابقة.' }))
    if (ts.length) { app.appendChild(el('h2', { text: 'المعلمات (' + num(ts.length) + ')' })); app.appendChild(el('div', { class: 'grid' }, ts.map(function (t) { return el('a', { class: 'card link', href: '#/teacher/' + t.id }, [el('b', { text: teacherLabel(t) }), el('div', { class: 'muted', text: t.subject })]) }))) }
    if (vs.length) {
      app.appendChild(el('h2', { text: 'الملفات والإصدارات (' + num(vs.length) + ')' }))
      var shown = vs.slice(0, 200)
      app.appendChild(el('div', { class: 'card' }, shown.map(function (v) {
        var t = teachersById[v.teacherId]
        return el('div', { class: 'slot-h', style: 'padding:6px 0;border-bottom:1px solid #eaf0f7' }, [
          el('span', null, [el('a', { href: '#/teacher/' + v.teacherId }, [t ? teacherLabel(t) : '—']), ' · ' + ((slotsById[v.slotId] || {}).title || v.slotId) + ' · ' + (termsById[v.termId] || {}).name + ' · إصدار ' + num(v.no) + ' · ' + (v.kind === 'link' ? v.url : v.name)]),
          el('button', { class: 'btn', onclick: function () { openPreview(v) } }, ['معاينة'])])
      })))
      if (vs.length > shown.length) app.appendChild(el('p', { class: 'muted', text: 'عُرض أول 200 نتيجة؛ ضيّقي البحث.' }))
    }
  }

  function about() {
    app.appendChild(el('h1', { text: 'عن هذا الأرشيف' }))
    app.appendChild(el('div', { class: 'card' }, [
      el('p', { text: 'السنة الدراسية: ' + D.year.label }), el('p', { text: 'تاريخ إنشاء الأرشيف: ' + date(D.createdAt) }),
      el('p', { text: 'الصيغة: ' + D.format + ' · عدد الأجزاء: ' + num(PARTS.length || 1) }),
      el('p', { text: 'بصمة ملخّص المحتوى (SHA-256 لقائمة كل إصدار وبصمة محتواه):' }), el('span', { class: 'hash', text: D.entriesDigest }),
      PARTS.length ? el('div', null, [el('h2', { text: 'أجزاء الأرشيف' }), el('table', null, [el('tbody', null, PARTS.map(function (p) {
        return el('tr', null, [el('td', { class: 'num', text: 'جزء ' + p.no }), el('td', { text: p.filename }), el('td', { class: 'num', text: p.sizeBytes == null ? '—' : size(p.sizeBytes) }), el('td', { class: 'num', text: num(p.entries) + ' إصدارًا' }),
          el('td', null, [settled ? (hasPart(p.no) ? chip('موجود', 'ok') : chip('ناقص', 'miss')) : chip('يُفحص…')])])
      }))])]) : null,
      el('p', { class: 'muted', text: 'للتحقق من سلامة الملفات: شغّلي التحقق من ملفات SHA256SUMS-part-NN.txt (انظري README_AR.txt)، أو افتحي صفحة الأرشفة في منصة أثَر واختاري ملف ZIP.' }),
      el('p', { class: 'muted', text: 'ملاحظة: رموز دخول المعلمات لا تُحفظ في الأرشيف أصلًا (تُحفظ في المنصة بصمات مشفّرة فقط)، ويُحفظ هنا تاريخ إصدار الرمز وحالته.' })]))
  }
  function notFound() { app.appendChild(el('div', { class: 'empty', text: 'الصفحة غير موجودة.' })) }

  function route() {
    var h = location.hash || '#/'
    var m = h.match(/^#\/([^/]*)(?:\/(.*))?$/) || [null, '', '']
    var page = m[1] || 'home', arg = m[2] ? decodeURIComponent(m[2]) : ''
    app.textContent = ''
    Array.prototype.forEach.call(document.querySelectorAll('[data-nav]'), function (a) { a.className = a.getAttribute('data-nav') === (page === 'teacher' ? 'teachers' : page) ? 'on' : '' })
    if (page === 'home') home(); else if (page === 'teachers') teachers(); else if (page === 'teacher') teacher(arg); else if (page === 'search') search(arg); else if (page === 'about') about(); else notFound()
    window.scrollTo(0, 0)
  }
  document.getElementById('searchForm').addEventListener('submit', function (e) { e.preventDefault(); var q = document.getElementById('q').value.trim(); location.hash = q ? '#/search/' + encodeURIComponent(q) : '#/' })
  window.addEventListener('hashchange', route)
  banner(); route()
})()
