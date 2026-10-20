/* MFX Web-Brücke: stellt der App dieselben Funktionen bereit wie Claude (window.claude.use),
   aber über eigene Server-Funktionen und Supabase (Login + Datenbank).
   Muss als erstes Script im <head> geladen werden. */
(function () {
  'use strict';
  var LS_SES = 'mfx-sb-session';
  var MANIFEST = {
    'Twelve Data': ['get_quote', 'get_time_series', 'search_symbol'],
    'FMP': ['analyst', 'calendar', 'chart', 'company', 'quote', 'commodity'],
    'Parallel Search': ['web_search']
  };

  /* ---------- Sitzung ---------- */
  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
  var SES = lsGet(LS_SES);
  if (!SES || !SES.refresh_token) SES = null;

  // Einladungs- oder Passwort-Link: Token stehen im Adress-Fragment
  var LINK = null;
  (function () {
    var h = String(location.hash || '');
    if (h.indexOf('access_token=') < 0 && h.indexOf('error_description=') < 0) return;
    var p = {}; h.replace(/^#/, '').split('&').forEach(function (kv) { var i = kv.indexOf('='); if (i > 0) p[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' ')); });
    if (p.access_token && p.refresh_token) {
      SES = { access_token: p.access_token, refresh_token: p.refresh_token, expires_at: Date.now() + (parseInt(p.expires_in || '3600', 10) * 1000), user: null };
      lsSet(LS_SES, SES);
      LINK = { type: p.type || 'magiclink' };
    } else if (p.error_description) {
      LINK = { error: p.error_description };
    }
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { }
  })();
  // Alternative Link-Form (eigene E-Mail-Vorlage): ?token_hash=...&type=invite|recovery
  (function () {
    try {
      var q = new URLSearchParams(location.search), th = q.get('token_hash'), ty = q.get('type');
      if (th && ty) { LINK = { type: ty, tokenHash: th }; history.replaceState(null, '', location.pathname); }
    } catch (e) { }
  })();
  if (SES && !(LINK && (LINK.type === 'invite' || LINK.type === 'recovery'))) { try { sessionStorage.setItem('mfx-gate', '1'); } catch (e) { } }
  else { try { sessionStorage.removeItem('mfx-gate'); } catch (e) { } }

  /* ---------- Einstellungen vom Server ---------- */
  var CFG = null;
  var CFGP = fetch('/api/config', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (c) { CFG = c; return c; }).catch(function () { CFG = { features: {} }; return CFG; });

  function authHeaders(extra) { var h = { apikey: CFG.supabaseAnonKey, 'Content-Type': 'application/json' }; for (var k in (extra || {})) h[k] = extra[k]; return h; }
  function auth(path, body, tok, method) {
    return CFGP.then(function () {
      var h = authHeaders(tok ? { Authorization: 'Bearer ' + tok } : null);
      return fetch(CFG.supabaseUrl + '/auth/v1/' + path, { method: method || 'POST', headers: h, body: body ? JSON.stringify(body) : undefined });
    }).then(function (r) { return r.text().then(function (t) { var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) { } if (!r.ok) throw { status: r.status, code: (j && (j.error_code || j.code || j.error)) || 'auth_error', message: (j && (j.error_description || j.msg || j.message)) || ('Fehler ' + r.status) }; return j; }); });
  }
  function keep(j) {
    SES = { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + (j.expires_in || 3600) * 1000, user: j.user ? { id: j.user.id, email: j.user.email } : (SES && SES.user) };
    lsSet(LS_SES, SES); return SES;
  }
  var REFP = null;
  function refresh() {
    if (!SES) return Promise.reject({ code: 'not_signed_in' });
    if (!REFP) REFP = auth('token?grant_type=refresh_token', { refresh_token: SES.refresh_token }).then(keep).then(function (s) { REFP = null; return s; }, function (e) { REFP = null; if (e && e.status && e.status < 500) dropSession(true); throw e; });
    return REFP;
  }
  function token() {
    if (!SES) return Promise.reject({ code: 'not_signed_in' });
    if (SES.expires_at - Date.now() > 60000) return Promise.resolve(SES.access_token);
    return refresh().then(function (s) { return s.access_token; });
  }
  function whoAmI() {
    if (SES && SES.user && SES.user.id) return Promise.resolve(SES.user);
    return token().then(function (t) { return auth('user', null, t, 'GET'); }).then(function (u) { SES.user = { id: u.id, email: u.email }; lsSet(LS_SES, SES); return SES.user; });
  }
  function dropSession(showGate) {
    var t = SES && SES.access_token; SES = null; lsSet(LS_SES, null);
    try { sessionStorage.removeItem('mfx-gate'); } catch (e) { }
    if (t) auth('logout', null, t).catch(function () { });
    if (showGate && window.mfxGateShow) { try { window.mfxGateShow(); } catch (e) { } }
  }

  /* ---------- Server-Aufrufe ---------- */
  function api(path, body, signal) {
    return token().then(function (t) {
      return fetch('/api/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify(body), signal: signal });
    }).then(function (r) {
      if (r.status === 401) { dropSession(true); throw { code: 'not_signed_in', message: 'Bitte neu anmelden.' }; }
      return r.json().catch(function () { throw { code: 'server_error', message: 'Server ' + r.status }; });
    }).then(function (j) { if (!j || j.ok === false) throw { code: (j && j.code) || 'server_error', message: (j && j.message) || 'Fehler' }; return j; },
      function (e) { if (e && e.name === 'AbortError') throw { code: 'cancelled' }; throw e && e.code ? e : { code: 'network', message: String(e && e.message || e) }; });
  }

  /* ---------- mcp ---------- */
  var MC = {}, MINF = {};
  var mcp = {
    callTool: function (server, tool, input, opts) {
      opts = opts || {};
      if (!MANIFEST[server] || MANIFEST[server].indexOf(tool) < 0) return Promise.reject({ code: 'not_in_manifest', message: server + '/' + tool });
      var inp = input || {}, key = server + '|' + tool + '|' + JSON.stringify(inp), c = opts.cache, st = c && c.staleTime || 0, refresh = !!(c && c.refresh);
      var hit = MC[key];
      if (hit && c !== false && !refresh && Date.now() - hit.at < Math.min(st, 300000)) return Promise.resolve(wrap(hit.payload, hit.storedAt, true));
      if (MINF[key] && !refresh) return MINF[key];
      var p = api('mcp', { server: server, tool: tool, input: inp, refresh: refresh }, opts.signal).then(function (j) {
        delete MINF[key];
        var payload = j.payload;
        if (typeof payload === 'string' && server === 'Twelve Data') payload = { result: payload };
        if (c !== false) MC[key] = { at: Date.now(), payload: payload, storedAt: j.storedAt || Date.now() };
        return wrap(payload, j.storedAt, !!j.cached);
      }, function (e) { delete MINF[key]; throw e; });
      MINF[key] = p; return p;
    },
    listTools: function () { return Promise.resolve({ servers: Object.keys(MANIFEST).map(function (s) { return { server: s, tools: MANIFEST[s].map(function (t) { return { name: t }; }) }; }) }); },
    describeTool: function () { return Promise.reject({ code: 'unavailable' }); },
    watchTool: function (server, tool, input, handler, opts) {
      var stop = false;
      mcp.callTool(server, tool, input, opts).then(function (r) { if (!stop) handler({ type: 'data', result: r }); }, function (e) { if (!stop) handler({ type: 'error', error: e }); });
      return function () { stop = true; };
    }
  };
  function wrap(payload, storedAt, cached) {
    var text = typeof payload === 'string' ? payload : JSON.stringify(payload);
    var r = { content: [{ type: 'text', text: text }], payload: payload };
    if (payload && typeof payload === 'object') r.structuredContent = payload;
    if (cached) r.cache = { storedAt: storedAt || Date.now() };
    return r;
  }

  /* ---------- sample (KI) ---------- */
  var SC = {};
  function sample(input, opts) {
    opts = opts || {};
    var tools = Array.isArray(opts.tools) ? opts.tools.slice(0, 8) : [];
    var tier = opts.modelTier === 'quick' || opts.modelTier === 'complex' ? opts.modelTier : 'default';
    var msgs = typeof input === 'string' ? [{ role: 'user', content: input }] : (Array.isArray(input) ? input.map(function (m) { return { role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content == null ? '' : m.content) }; }) : []);
    if (!msgs.length) return Promise.reject({ code: 'bad_request', message: 'Leere Anfrage' });
    var ckey = !tools.length && opts.cache !== false ? tier + '|' + JSON.stringify(msgs) : null;
    if (ckey && SC[ckey] && Date.now() - SC[ckey].at < 300000) { var v = SC[ckey].v; if (opts.onText) { try { opts.onText({ text: v.text, delta: v.text }); } catch (e) { } } return Promise.resolve(v); }
    var signal = opts.signal, all = '', round = 0;
    var tdefs = tools.map(function (t) { return { name: t.name, description: t.description || '', input_schema: t.inputSchema || t.input_schema || { type: 'object', properties: {} } }; });
    function step() {
      if (signal && signal.aborted) return Promise.reject({ code: 'cancelled', text: all });
      return api('sample', { input: msgs, tools: tdefs, modelTier: tier, round: round }, signal).then(function (j) {
        var blocks = j.content || [], txt = blocks.filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('');
        if (txt) { var d = (all ? '\n\n' : '') + txt; all += d; if (opts.onText) { try { opts.onText({ text: all, delta: d }); } catch (e) { } } }
        var uses = blocks.filter(function (b) { return b.type === 'tool_use'; });
        if (j.stop_reason === 'tool_use' && uses.length && round < 6) {
          round++;
          msgs = msgs.concat([{ role: 'assistant', content: blocks }]);
          return Promise.all(uses.map(function (u) {
            var t = tools.filter(function (x) { return x.name === u.name; })[0];
            return Promise.resolve().then(function () { if (!t) throw new Error('Unbekanntes Werkzeug'); return t.execute(u.input || {}); }).then(function (out) {
              return { type: 'tool_result', tool_use_id: u.id, content: typeof out === 'string' ? out : JSON.stringify(out == null ? null : out) };
            }, function (e) { return { type: 'tool_result', tool_use_id: u.id, content: String(e && e.message || e || 'Fehler'), is_error: true }; });
          })).then(function (res) { msgs = msgs.concat([{ role: 'user', content: res }]); return step(); });
        }
        var out = { text: all, truncated: j.stop_reason === 'max_tokens', modelTierApplied: j.tier || tier, modelApplied: j.model };
        if (ckey) SC[ckey] = { at: Date.now(), v: out };
        return out;
      }, function (e) { if (all && e && !e.text) e.text = all; throw e; });
    }
    return step();
  }
  sample.limits = function () { return Promise.resolve({ tools: { maxCount: 8 }, images: false, maxPromptBytes: 400000 }); };
  sample.json = function (input, opts) {
    var add = '\n\nAntworte ausschließlich mit gültigem JSON, ohne Code-Block und ohne weiteren Text.';
    var inp = typeof input === 'string' ? input + add : (Array.isArray(input) ? input.map(function (m, i) { return i === input.length - 1 ? { role: m.role, content: String(m.content) + add } : m; }) : input);
    return sample(inp, opts).then(function (r) {
      var t = String(r.text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
      try { return JSON.parse(t); } catch (e) { }
      var a = t.indexOf('{'), b = t.lastIndexOf('}');
      if (a > -1 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (e) { } }
      a = t.indexOf('['); b = t.lastIndexOf(']');
      if (a > -1 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (e) { } }
      throw { code: 'invalid_json', message: 'Die Antwort war kein JSON', text: r.text };
    });
  };

  /* ---------- db (Supabase) ---------- */
  var DOCS = {}, LIS = [];
  function tableOf(path) { return /^data\/users\//.test(path) ? 'docs' : 'shared_docs'; }
  function parentOf(path) { var i = path.lastIndexOf('/'); return i > 0 ? path.slice(0, i) : ''; }
  function rest(method, q, body, prefer) {
    return token().then(function (t) {
      var h = authHeaders({ Authorization: 'Bearer ' + t }); if (prefer) h.Prefer = prefer;
      return fetch(CFG.supabaseUrl + '/rest/v1/' + q, { method: method, headers: h, body: body ? JSON.stringify(body) : undefined });
    }).then(function (r) { return r.text().then(function (t) { if (r.status === 401) { dropSession(true); throw { code: 'not_signed_in' }; } if (!r.ok) throw { code: r.status === 429 ? 'resource_exhausted' : 'db_error', message: t.slice(0, 200) }; return t ? JSON.parse(t) : null; }); });
  }
  function enc(s) { return encodeURIComponent(s); }
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function docSnap(path) { var d = DOCS[path]; return { id: path.split('/').pop(), exists: d !== undefined, ref: docRef(path), data: function () { return d === undefined ? undefined : clone(d); } }; }
  function colSnap(path, q) {
    var arr = Object.keys(DOCS).filter(function (p) { return parentOf(p) === path && DOCS[p] !== undefined; }).map(function (p) { return { p: p, d: DOCS[p] }; });
    (q.where || []).forEach(function (w) { arr = arr.filter(function (x) { var v = x.d && x.d[w[0]]; return w[1] === '==' ? v === w[2] : w[1] === '!=' ? v !== w[2] : w[1] === '>' ? v > w[2] : w[1] === '<' ? v < w[2] : w[1] === '>=' ? v >= w[2] : w[1] === '<=' ? v <= w[2] : true; }); });
    if (q.order) { var f = q.order[0], dir = q.order[1] === 'desc' ? -1 : 1; arr.sort(function (a, b) { var x = a.d && a.d[f], y = b.d && b.d[f]; return x === y ? 0 : (x === undefined ? 1 : y === undefined ? -1 : (x > y ? dir : -dir)); }); }
    if (q.limit) arr = arr.slice(0, q.limit);
    var docs = arr.map(function (x) { return docSnap(x.p); });
    return { docs: docs, size: docs.length, empty: !docs.length, forEach: function (fn) { docs.forEach(fn); } };
  }
  var LOADED = {};
  function loadDoc(path) { return rest('GET', tableOf(path) + '?select=path,data&path=eq.' + enc(path)).then(function (rows) { if (rows && rows[0]) DOCS[path] = rows[0].data; else delete DOCS[path]; }); }
  function loadCol(path) { return rest('GET', tableOf(path) + '?select=path,data&parent=eq.' + enc(path) + '&limit=5000').then(function (rows) { Object.keys(DOCS).forEach(function (p) { if (parentOf(p) === path) delete DOCS[p]; }); (rows || []).forEach(function (r) { DOCS[r.path] = r.data; }); LOADED[path] = 1; }); }
  function notify(path) {
    LIS.forEach(function (l) {
      if (l.kind === 'doc' && l.path === path) l.cb(docSnap(path));
      if (l.kind === 'col' && l.path === parentOf(path)) l.cb(colSnap(l.path, l.q));
    });
  }
  function write(path, data) {
    if (tableOf(path) !== 'docs') return Promise.reject({ code: 'permission_denied' });
    DOCS[path] = clone(data); notify(path);
    return rest('POST', 'docs?on_conflict=path', { path: path, parent: parentOf(path), data: data, updated_at: new Date().toISOString() }, 'resolution=merge-duplicates,return=minimal').then(function () { });
  }
  function docRef(path) {
    return {
      id: path.split('/').pop(), path: path,
      collection: function (n) { return colRef(path + '/' + n); },
      get: function () { return loadDoc(path).then(function () { return docSnap(path); }); },
      set: function (d, o) { if (o && o.merge && DOCS[path]) { var m = clone(DOCS[path]); for (var k in d) m[k] = d[k]; d = m; } return write(path, d); },
      update: function (d) { var m = clone(DOCS[path] || {}); for (var k in d) m[k] = d[k]; return write(path, m); },
      delete: function () { if (tableOf(path) !== 'docs') return Promise.reject({ code: 'permission_denied' }); delete DOCS[path]; notify(path); return rest('DELETE', 'docs?path=eq.' + enc(path)).then(function () { }); },
      onSnapshot: function (cb, err) {
        var l = { kind: 'doc', path: path, cb: function (s) { try { cb(s); } catch (e) { console.error(e); } } };
        LIS.push(l);
        loadDoc(path).then(function () { l.cb(docSnap(path)); }, function (e) { if (err) err(e); });
        return function () { LIS = LIS.filter(function (x) { return x !== l; }); };
      }
    };
  }
  function query(path, q) {
    return {
      path: path,
      orderBy: function (f, dir) { return query(path, { order: [f, dir || 'asc'], limit: q.limit, where: q.where }); },
      limit: function (n) { return query(path, { order: q.order, limit: n, where: q.where }); },
      where: function (f, op, v) { return query(path, { order: q.order, limit: q.limit, where: (q.where || []).concat([[f, op, v]]) }); },
      get: function () { return loadCol(path).then(function () { return colSnap(path, q); }); },
      onSnapshot: function (cb, err) {
        var l = { kind: 'col', path: path, q: q, cb: function (s) { try { cb(s); } catch (e) { console.error(e); } } };
        LIS.push(l);
        loadCol(path).then(function () { l.cb(colSnap(path, q)); }, function (e) { if (err) err(e); });
        return function () { LIS = LIS.filter(function (x) { return x !== l; }); };
      }
    };
  }
  function colRef(path) {
    var b = query(path, {});
    b.id = path.split('/').pop();
    b.doc = function (id) { return docRef(path + '/' + (id || ('d' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)))); };
    b.add = function (d) { var r = b.doc(); return r.set(d).then(function () { return r; }); };
    return b;
  }
  var db = { doc: docRef, collection: colRef };
  // Beim Zurückkehren zur Seite neu laden (falls auf einem anderen Gerät etwas geändert wurde)
  document.addEventListener('visibilitychange', function () {
    if (document.hidden || !SES) return;
    var seen = {};
    LIS.forEach(function (l) {
      var k = l.kind + '|' + l.path; if (seen[k]) return; seen[k] = 1;
      (l.kind === 'doc' ? loadDoc(l.path) : loadCol(l.path)).then(function () { LIS.forEach(function (x) { if (x.kind === l.kind && x.path === l.path) x.cb(x.kind === 'doc' ? docSnap(x.path) : colSnap(x.path, x.q)); }); }, function () { });
    });
  });

  /* ---------- user, downloads ---------- */
  var user = {
    id: function () { return whoAmI().then(function (u) { return u.id; }); },
    me: function () { return whoAmI().then(function (u) { return { id: u.id, name: String(u.email || '').split('@')[0], email: u.email }; }); },
    isOwner: function () { return false; }, canEdit: function () { return false; }, can: function () { return null; },
    profiles: function () { return Promise.resolve({}); }, search: function () { return Promise.resolve([]); }
  };
  var downloads = {
    save: function (o) {
      return new Promise(function (ok) {
        var blob = o.data instanceof Blob ? o.data : new Blob([o.data == null ? '' : o.data], { type: o.mimeType || 'application/octet-stream' });
        var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = o.filename || 'download';
        document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500); ok({ status: 'saved' });
      });
    }
  };

  /* ---------- window.claude ---------- */
  window.claude = {
    use: function (name) {
      return CFGP.then(function (c) {
        var f = c.features || {};
        if (name === 'permissions') return { state: function () { return Promise.resolve('granted'); }, request: function () { return Promise.resolve({}); }, manage: function () { return Promise.reject({ code: 'unavailable' }); } };
        if (!SES) return null;
        if (name === 'db') return c.supabaseUrl ? db : null;
        if (name === 'user') return user;
        if (name === 'mcp') return mcp;
        if (name === 'sample') return f.ai ? sample : null;
        if (name === 'downloads') return downloads;
        return null;
      });
    }
  };
  window.mfxWeb = { signOut: function () { dropSession(false); }, session: function () { return SES ? { email: SES.user && SES.user.email } : null; } };

  /* ---------- Anmeldemaske der App mit echtem Login verbinden ---------- */
  function $(id) { return document.getElementById(id); }
  function msg(t, ok) { var m = $('g-msg'); if (m) { m.textContent = t; m.className = 'g-msg' + (ok ? ' ok' : ''); } }
  function errText(e) {
    var s = String((e && (e.message || e.code)) || '');
    if (/invalid login|invalid_grant|invalid_credentials/i.test(s)) return 'E-Mail oder Passwort stimmt nicht.';
    if (/not confirmed/i.test(s)) return 'Bitte bestätige zuerst die E-Mail aus deiner Einladung.';
    if (/rate|too many/i.test(s)) return 'Zu viele Versuche. Warte kurz und probiere es dann noch einmal.';
    if (e && e.status >= 500) return 'Der Anmeldedienst antwortet gerade nicht. Versuch es gleich noch einmal.';
    return 'Anmeldung hat nicht geklappt: ' + s.slice(0, 120);
  }
  function wireGate() {
    var form = $('g-form'); if (!form) return;
    var em = $('g-em'), pw = $('g-pw');
    try { em.setAttribute('autocomplete', 'email'); em.setAttribute('name', 'email'); pw.setAttribute('autocomplete', 'current-password'); pw.setAttribute('name', 'password'); form.setAttribute('autocomplete', 'on'); } catch (e) { }
    var chip = form.querySelector('.g-chip'); if (chip) chip.innerHTML = '<i></i>Freunde-Version';
    var note = form.querySelector('.g-note'); if (note) note.innerHTML = '<b>Nur mit Einladung:</b> Du bekommst eine E-Mail mit einem Link, über den du dein Passwort festlegst. Danach meldest du dich hier an.';
    var gg = $('g-guest'); if (gg) gg.hidden = true;
    var gor = form.querySelector('.g-or'); if (gor) gor.hidden = true;
    var lnk = form.querySelectorAll('.g-lnk [data-n]');
    if (lnk[0]) { lnk[0].removeAttribute('data-n'); lnk[0].addEventListener('click', function () {
      var v = em.value.trim(); if (!/^\S+@\S+\.\S+$/.test(v)) { msg('Trag oben deine E-Mail ein, dann tippe noch einmal auf „Passwort vergessen?“.'); em.focus(); return; }
      msg('Sende Link …', true);
      auth('recover', { email: v }).then(function () { msg('Wenn es ein Konto mit dieser E-Mail gibt, kommt gleich ein Link zum Zurücksetzen.', true); }, function (e) { msg(errText(e)); });
    }); }
    if (lnk[1]) { lnk[1].setAttribute('data-n', 'Zugang gibt es nur mit Einladung. Frag den Betreiber der Seite nach einer Einladung an deine E-Mail-Adresse.'); }
    document.addEventListener('submit', function (e) {
      if (!e.target || e.target.id !== 'g-form') return;
      e.preventDefault(); e.stopImmediatePropagation();
      var v = em.value.trim();
      if (!/^\S+@\S+\.\S+$/.test(v) || !pw.value) { msg('Bitte E-Mail und Passwort eintragen.'); (v ? pw : em).focus(); return; }
      var go = $('g-go'); if (go) go.disabled = true; msg('Melde an …', true);
      auth('token?grant_type=password', { email: v, password: pw.value }).then(function (j) {
        keep(j);
        try { sessionStorage.setItem('mfx-gate', '1'); } catch (x) { }
        msg('Angemeldet. Lädt …', true);
        location.reload();
      }, function (er) { if (go) go.disabled = false; msg(errText(er)); });
    }, true);
    if (LINK && LINK.error) msg('Der Link ist ungültig oder abgelaufen: ' + LINK.error);
  }
  function wireSignOut() {
    if (typeof window.mfxGateShow === 'function' && !window.mfxGateShow._web) {
      var o = window.mfxGateShow; var w = function () { dropSession(false); return o.apply(this, arguments); }; w._web = 1; window.mfxGateShow = w;
    }
    document.addEventListener('click', function (e) {
      var t = e.target && e.target.closest && e.target.closest('#g-out,#hub-out');
      if (t) dropSession(false);
    }, true);
  }

  /* ---------- Passwort festlegen (Einladung oder Zurücksetzen) ---------- */
  function pwDialog() {
    var d = document.createElement('div');
    d.className = 'mw-ov';
    d.innerHTML = '<form class="mw-card" novalidate><h2>' + (LINK.type === 'recovery' ? 'Neues Passwort festlegen' : 'Willkommen bei MFX') + '</h2>' +
      '<p>' + (LINK.type === 'recovery' ? 'Wähle ein neues Passwort.' : 'Du wurdest eingeladen. Leg jetzt dein Passwort fest, damit du dich später anmelden kannst.') + '</p>' +
      '<label>Passwort<input type="password" id="mw-p1" autocomplete="new-password" minlength="8" placeholder="mindestens 8 Zeichen"></label>' +
      '<label>Passwort wiederholen<input type="password" id="mw-p2" autocomplete="new-password"></label>' +
      '<p class="mw-msg" id="mw-msg" role="alert"></p><button type="submit">Speichern und loslegen</button></form>';
    var st = document.createElement('style');
    st.textContent = '.mw-ov{position:fixed;inset:0;z-index:3000;display:grid;place-items:center;background:rgba(2,4,10,.92);padding:16px;font-family:Inter,system-ui,sans-serif}.mw-card{width:min(420px,100%);background:#090e1d;border:1px solid #243062;border-radius:18px;padding:22px;color:#eaf0ff;display:grid;gap:12px;box-shadow:0 30px 70px -30px rgba(40,90,255,.6)}.mw-card h2{margin:0;font:800 1.3rem Montserrat,Inter,sans-serif}.mw-card p{margin:0;color:#8d98c0;font-size:.92rem;line-height:1.5}.mw-card label{display:grid;gap:6px;font-weight:600;font-size:.88rem}.mw-card input{font:500 1rem Inter,system-ui,sans-serif;padding:11px 12px;border-radius:10px;border:1px solid #1b2649;background:rgba(5,8,18,.7);color:#eaf0ff}.mw-card button{font:700 .95rem Inter,system-ui,sans-serif;padding:12px;border-radius:12px;border:0;background:linear-gradient(135deg,#2556e6,#4a86ff);color:#fff;cursor:pointer}.mw-msg{min-height:1.2em;color:#ff6b7a!important}';
    document.head.appendChild(st); document.body.appendChild(d);
    var f = d.querySelector('form');
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var a = $('mw-p1').value, b = $('mw-p2').value, m = $('mw-msg');
      if (a.length < 8) { m.textContent = 'Das Passwort braucht mindestens 8 Zeichen.'; return; }
      if (a !== b) { m.textContent = 'Die beiden Passwörter sind nicht gleich.'; return; }
      m.textContent = '';
      token().then(function (t) { return auth('user', { password: a }, t, 'PUT'); }).then(function (u) {
        if (u && u.id) { SES.user = { id: u.id, email: u.email }; lsSet(LS_SES, SES); }
        try { sessionStorage.setItem('mfx-gate', '1'); } catch (x) { }
        location.reload();
      }, function (er) { m.textContent = 'Speichern hat nicht geklappt: ' + String(er && er.message || er && er.code || '').slice(0, 140); });
    });
    setTimeout(function () { try { $('mw-p1').focus(); } catch (e) { } }, 50);
  }

  function ready() {
    wireGate();
    wireSignOut();
    if (LINK && LINK.tokenHash) {
      auth('verify', { type: LINK.type, token_hash: LINK.tokenHash }).then(function (j) { if (j && j.access_token) { keep(j); pwDialog(); } else msg('Der Link ist ungültig oder abgelaufen.'); }, function () { msg('Der Link ist ungültig oder abgelaufen. Lass dir eine neue Einladung schicken.'); });
    } else if (LINK && (LINK.type === 'invite' || LINK.type === 'recovery') && SES) pwDialog();
    // Sitzung beim Start prüfen: abgelaufen -> zurück zur Anmeldung
    if (SES) token().catch(function () { });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready); else ready();
  window.addEventListener('load', wireSignOut);
})();
