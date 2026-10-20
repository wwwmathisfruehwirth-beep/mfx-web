// Lokaler Testserver: liefert public/ aus und ruft die api/-Funktionen auf.
// Mit FAKE=1 werden Supabase, Twelve Data, FMP, Parallel und Anthropic simuliert (kein Internet nötig).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = +(process.env.PORT || 8787);
const FAKE = process.env.FAKE === '1';
const BASE = 'http://localhost:' + PORT;

if (FAKE) {
  Object.assign(process.env, {
    SUPABASE_URL: BASE + '/__sb', SUPABASE_ANON_KEY: 'anon-test', SUPABASE_SERVICE_ROLE_KEY: 'service-test',
    TWELVEDATA_API_KEY: 'td-test', FMP_API_KEY: 'fmp-test', PARALLEL_API_KEY: process.env.FAKE_NO_PARALLEL ? '' : 'par-test', ANTHROPIC_API_KEY: process.env.FAKE_NO_AI ? '' : 'ant-test',
    OWNER_EMAIL: 'test@mfx.de', AI_DAILY_LIMIT: process.env.AI_DAILY_LIMIT || '40',
  });
}

/* ---------------- Fake-Supabase ---------------- */
const SB = { users: [{ id: '11111111-1111-4111-8111-111111111111', email: 'test@mfx.de', password: 'passwort123' }], tok: {}, ref: {}, docs: {}, shared: {}, cache: {}, ai: {}, calls: [] };
function issue(u) { const at = 'at_' + u.id + '_' + Math.random().toString(36).slice(2), rt = 'rt_' + Math.random().toString(36).slice(2); SB.tok[at] = u.id; SB.ref[rt] = u.id; return { access_token: at, refresh_token: rt, expires_in: 3600, token_type: 'bearer', user: { id: u.id, email: u.email } }; }
function bearer(req) { const h = String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''); return h; }
function uidOf(req) { const t = bearer(req); if (t === 'service-test') return 'service'; return SB.tok[t] || null; }
function j(res, st, o) { res.writeHead(st, { 'Content-Type': 'application/json' }); res.end(o === undefined ? '' : JSON.stringify(o)); }
async function body(req) { const c = []; for await (const x of req) c.push(x); const s = Buffer.concat(c).toString(); try { return s ? JSON.parse(s) : {}; } catch { return {}; } }
function eqv(q, k) { const v = q.get(k); return v && v.startsWith('eq.') ? decodeURIComponent(v.slice(3)) : null; }
async function fakeSupabase(req, res, u) {
  SB.calls.push(req.method + ' ' + u.pathname + u.search);
  if (!req.headers.apikey) return j(res, 401, { message: 'no apikey' });
  const p = u.pathname.replace(/^\/__sb/, '');
  if (p === '/auth/v1/token') {
    const b = await body(req), gt = u.searchParams.get('grant_type');
    if (gt === 'password') { const usr = SB.users.find(x => x.email === String(b.email || '').toLowerCase() && x.password === b.password); return usr ? j(res, 200, issue(usr)) : j(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials' }); }
    if (gt === 'refresh_token') { const id = SB.ref[b.refresh_token]; if (!id) return j(res, 400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token' }); delete SB.ref[b.refresh_token]; return j(res, 200, issue(SB.users.find(x => x.id === id))); }
  }
  if (p === '/auth/v1/user') {
    const id = uidOf(req), usr = SB.users.find(x => x.id === id); if (!usr) return j(res, 401, { message: 'invalid JWT' });
    if (req.method === 'PUT') { const b = await body(req); if (b.password) usr.password = b.password; }
    return j(res, 200, { id: usr.id, email: usr.email });
  }
  if (p === '/auth/v1/logout') { delete SB.tok[bearer(req)]; return j(res, 204); }
  if (p === '/auth/v1/recover') return j(res, 200, {});
  if (p === '/auth/v1/verify') { const b = await body(req); return b.token_hash === 'th_ok' ? j(res, 200, issue(SB.users[0])) : j(res, 403, { msg: 'Token has expired or is invalid' }); }
  const m = p.match(/^\/rest\/v1\/(\w+)(?:\/(\w+))?/); if (!m) return j(res, 404, {});
  const uid = uidOf(req); if (!uid) return j(res, 401, { message: 'JWT expired' });
  const tbl = m[1], q = u.searchParams;
  if (tbl === 'rpc') { const b = await body(req); const day = new Date().toISOString().slice(0, 10), k = b.p_user + '|' + day; if (m[2] === 'ai_take') { SB.ai[k] = (SB.ai[k] || 0) + 1; return j(res, 200, SB.ai[k]); } return j(res, 200, null); }
  const store = tbl === 'docs' ? SB.docs : tbl === 'shared_docs' ? SB.shared : tbl === 'api_cache' ? SB.cache : null; if (!store) return j(res, 404, {});
  if (req.method === 'GET') {
    let rows = Object.values(store);
    if (tbl === 'docs' && uid !== 'service') rows = rows.filter(r => r.owner === uid);
    const pe = eqv(q, 'path'), pa = eqv(q, 'parent'), ke = eqv(q, 'key');
    if (pe) rows = rows.filter(r => r.path === pe); if (pa) rows = rows.filter(r => r.parent === pa); if (ke) rows = rows.filter(r => r.key === ke);
    return j(res, 200, rows);
  }
  if (req.method === 'POST') {
    const b = await body(req);
    if (tbl === 'api_cache') { store[b.key] = b; return j(res, 201); }
    if (tbl !== 'docs' || uid === 'service' || !String(b.path).startsWith('data/users/' + uid + '/')) return j(res, 403, { message: 'new row violates row-level security policy' });
    const old = store[b.path]; if (old && old.owner !== uid) return j(res, 403, {});
    store[b.path] = { path: b.path, parent: b.parent, owner: uid, data: b.data, updated_at: b.updated_at }; return j(res, 201);
  }
  if (req.method === 'DELETE') { const pe = eqv(q, 'path'); const r = store[pe]; if (r && r.owner === uid) delete store[pe]; return j(res, 204); }
  return j(res, 405, {});
}

/* ---------------- Fake-Datenquellen (für api/*) ---------------- */
const realFetch = globalThis.fetch;
const FCALLS = [];
function jr(o, st = 200) { return new Response(JSON.stringify(o), { status: st, headers: { 'Content-Type': 'application/json' } }); }
if (FAKE) globalThis.fetch = async function (input, init = {}) {
  const url = new URL(typeof input === 'string' ? input : input.url || String(input));
  if (url.origin === BASE) return realFetch(input, init);
  FCALLS.push(url.hostname + url.pathname);
  if (url.hostname === 'api.twelvedata.com') {
    const s = url.searchParams.get('symbol') || 'AAPL';
    if (url.pathname === '/quote') return jr({ symbol: s, name: s + ' Inc.', exchange: 'NASDAQ', mic_code: 'XNGS', currency: 'USD', datetime: '2026-10-20', timestamp: Math.floor(Date.now() / 1000), last_quote_at: Math.floor(Date.now() / 1000), open: '100', high: '102', low: '99', close: '101.5', volume: '1000', previous_close: '100', change: '1.5', percent_change: '1.5', average_volume: '900', is_market_open: true, fifty_two_week: { low: '80', high: '120', low_change: '21.5', high_change: '-18.5', low_change_percent: '26.9', high_change_percent: '-15.4', range: '80 - 120' }, extended_change: '0', extended_percent_change: '0', extended_price: '0', extended_timestamp: '0' });
    if (url.pathname === '/time_series') { const n = Math.min(60, +url.searchParams.get('outputsize') || 30), v = []; for (let i = 0; i < n; i++) { const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10); const c = 100 + Math.sin(i / 4) * 5; v.push({ datetime: d, open: (c - 1).toFixed(2), high: (c + 1).toFixed(2), low: (c - 2).toFixed(2), close: c.toFixed(2), volume: '1000' }); } return jr({ meta: { symbol: s }, values: v, status: 'ok' }); }
    if (url.pathname === '/symbol_search') return jr({ data: [{ symbol: 'NVDA', instrument_name: 'NVIDIA Corp', exchange: 'NASDAQ', mic_code: 'XNGS', exchange_timezone: 'America/New_York', instrument_type: 'Common Stock', country: 'United States', currency: 'USD' }], status: 'ok' });
  }
  if (url.hostname === 'financialmodelingprep.com') {
    const ep = url.pathname.replace('/stable/', ''), s = url.searchParams.get('symbol') || 'AAPL';
    if (ep === 'grades-consensus') return new Response('Limit Reach . Please upgrade your plan', { status: 429 });
    if (ep === 'quote') return jr([{ symbol: s, name: 'E-Mini S&P 500', price: 7740.25, changePercentage: 0.47, change: 36, dayLow: 7677, dayHigh: 7768.5, open: 7679.5, previousClose: 7704.25, timestamp: Math.floor(Date.now() / 1000) - 360 }]);
    if (ep === 'profile') return jr([{ symbol: s, companyName: s + ' Corp', sector: 'Technology', industry: 'Semiconductors', ceo: 'Jane Doe', fullTimeEmployees: '1000', exchange: 'NASDAQ', description: 'Beschreibung', website: 'https://example.com' }]);
    if (ep === 'price-target-consensus') return jr([{ symbol: s, targetHigh: 300, targetLow: 150, targetConsensus: 250, targetMedian: 245 }]);
    return jr([]);
  }
  if (url.hostname === 'www.bing.com' && url.pathname === '/news/search') {
    const q = url.searchParams.get('q') || '', de = url.searchParams.get('cc') === 'DE', d = new Date(Date.now() - 3 * 36e5).toUTCString(), d2 = new Date(Date.now() - 30 * 36e5).toUTCString();
    const it = (t, u, src, ds, dt) => '<item><title>' + t + '</title><link>http://www.bing.com/news/apiclick.aspx?ref=FexRss&amp;aid=&amp;tid=x&amp;url=' + encodeURIComponent(u) + '&amp;c=1&amp;mkt=en-us</link><description>' + ds + '</description><pubDate>' + dt + '</pubDate><News:Source>' + src + '</News:Source></item>';
    return new Response('<?xml version="1.0" encoding="utf-8" ?><rss version="2.0" xmlns:News="https://www.bing.com/news/search?q=' + encodeURIComponent(q) + '&amp;format=rss"><channel><title>' + q + '</title>'
      + (de ? it('Tech-Sorgen bleiben &#8211; Dow im Plus (' + q + ')', 'https://www.boersennews.de/nachrichten/artikel/tech-sorgen', 'BörsenNEWS.de', 'Die Sorgen um die KI-Bewertungen &amp; Rechenzentren belasten.', d)
        : it('Hedge Funds Dumped Tech Stocks at the Fastest Pace in a Decade (' + q + ')', 'https://finance.yahoo.com/news/hedge-funds-tech-1.html', 'Yahoo Finance', 'Goldman Sachs prime book data show the biggest tech selling since 2016.', d)
          + it('Barclays warns of data center slowdown', 'https://www.msn.com/en-us/money/barclays-dc', 'Barron&apos;s on MSN', 'Growth in new capacity could slow sharply in 2027.', d2))
      + '</channel></rss>', { status: 200, headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } });
  }
  if (url.hostname === 'api.parallel.ai') {
    const b = JSON.parse(init.body || '{}'); const d = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    if (b.session_id) return jr({ type: 'error', error: { message: 'unexpected field session_id' } }, 422);
    return jr({ search_id: 's1', results: [
      { url: 'https://www.streetinsider.com/hedge-funds-tech', title: 'Hedge funds cut tech stocks at record pace, Goldman says', publish_date: d, excerpts: ['Hedge funds reduced their technology stock positions at the fastest rate in at least a decade.'] },
      { url: 'https://www.btcc.com/barclays-data-center', title: 'Barclays: Data Center Growth to Slow Sharply in 2027', publish_date: d, excerpts: ['Growth of new data center capacity will fall from over 100% in 2026 to about 35% in 2027.'] }] });
  }
  if (url.hostname === 'api.anthropic.com') {
    const b = JSON.parse(init.body || '{}'), last = b.messages[b.messages.length - 1], txt = typeof last.content === 'string' ? last.content : JSON.stringify(last.content);
    const first = b.messages.map(m => typeof m.content === 'string' ? m.content : '').join('\n');
    let content;
    if (/Markt-Redakteur/.test(first)) {
      const d = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
      content = [{ type: 'text', text: [JSON.stringify({ lage: 'Tech unter Druck: Hedgefonds verkaufen.' }), JSON.stringify({ t: 'Hedgefonds verkaufen Tech-Aktien so schnell wie seit zehn Jahren nicht', x: 'Goldman-Daten.', w: 'Große Verkäufe drücken Kurse.', k: 'geld', s: 'hoch', d, q: 'StreetInsider', u: 'https://www.streetinsider.com/hedge-funds-tech', g: 'Chipwerte', m: 'neg', a: [['NVDA', 'neg'], ['MSFT', 'neg']] }), JSON.stringify({ t: 'Barclays: Rechenzentrum-Wachstum bricht 2027 ein', x: 'Von über 100 % auf 35 %.', w: 'Weniger Aufträge für Zulieferer.', k: 'bank', s: 'hoch', d, q: 'BTCC', u: 'https://www.btcc.com/barclays-data-center', g: 'Zulieferer', m: 'neg', a: [['NVDA', 'neg']] })].join('\n') }];
    } else if (Array.isArray(b.tools) && b.tools.length && typeof last.content === 'string') {
      content = [{ type: 'text', text: 'Ich schaue nach.' }, { type: 'tool_use', id: 'tu1', name: b.tools[0].name, input: { query: 'Bias' } }];
      return jr({ id: 'm1', model: b.model, content, stop_reason: 'tool_use', usage: { input_tokens: 100, output_tokens: 10 } });
    } else if (/JSON/.test(txt)) {
      content = [{ type: 'text', text: '{"fazit":"Gut","staerken":["a"],"schwaechen":["b"],"muster":["c"],"aufgaben":["x","y","z"],"regel":"r","ermutigung":"weiter"}' }];
    } else content = [{ type: 'text', text: 'Antwort vom Test-Modell (' + b.model + ').' + (/tool_result/.test(txt) ? ' Werkzeug-Ergebnis erhalten.' : '') }];
    return jr({ id: 'm2', model: b.model, content, stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 20 } });
  }
  return new Response('blocked in test: ' + url.hostname, { status: 599 });
};

/* ---------------- Server ---------------- */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const srv = http.createServer(async (req, res) => {
  const u = new URL(req.url, BASE);
  try {
    if (FAKE && u.pathname.startsWith('/__sb/')) return await fakeSupabase(req, res, u);
    if (FAKE && u.pathname === '/__test/state') return j(res, 200, { docs: SB.docs, ai: SB.ai, calls: SB.calls.slice(-50), fcalls: FCALLS.slice(-80) });
    if (u.pathname.startsWith('/api/')) {
      const name = u.pathname.slice(5).replace(/[^a-z_-]/gi, '');
      const f = path.join(ROOT, 'api', name + '.js');
      if (!fs.existsSync(f)) return j(res, 404, { ok: false, code: 'not_found' });
      const mod = await import(pathToFileURL(f).href);
      return await mod.default(req, res);
    }
    let p = path.join(ROOT, 'public', decodeURIComponent(u.pathname));
    if (u.pathname.endsWith('/')) p = path.join(p, 'index.html');
    if (!p.startsWith(path.join(ROOT, 'public')) || !fs.existsSync(p)) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  } catch (e) { console.error(e); if (!res.headersSent) j(res, 500, { ok: false, message: String(e) }); }
});
srv.listen(PORT, () => console.log('MFX dev server on ' + BASE + (FAKE ? ' (FAKE)' : '')));
