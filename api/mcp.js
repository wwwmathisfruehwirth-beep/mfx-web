import { ENV, send, readBody, requireUser, cacheGet, cachePut, fail } from './_lib/util.js';

// Ersetzt die Claude-Connectoren: Twelve Data, FMP und Parallel Search mit eigenen Schlüsseln.
// Antworten haben dieselbe Form wie die Connectoren, damit die Seite unverändert bleibt.

const TD = 'https://api.twelvedata.com/';
const FMP = 'https://financialmodelingprep.com/stable/';
const PAR = 'https://api.parallel.ai/v1/search';

const FMP_MAP = {
  analyst: { 'financial-estimates': 'analyst-estimates', grades: 'grades', 'grades-summary': 'grades-consensus', 'historical-grades': 'grades-historical', 'historical-ratings': 'ratings-historical', 'price-target-consensus': 'price-target-consensus', 'price-target-summary': 'price-target-summary', 'ratings-snapshot': 'ratings-snapshot' },
  calendar: { 'dividends-calendar': 'dividends-calendar', 'dividends-company': 'dividends', 'earnings-calendar': 'earnings-calendar', 'earnings-company': 'earnings', 'ipos-calendar': 'ipos-calendar', 'splits-calendar': 'splits-calendar', 'splits-company': 'splits' },
  chart: { 'historical-price-eod-full': 'historical-price-eod/full', 'historical-price-eod-light': 'historical-price-eod/light', 'historical-price-eod-dividend-adjusted': 'historical-price-eod/dividend-adjusted', 'historical-price-eod-non-split-adjusted': 'historical-price-eod/non-split-adjusted', 'intraday-1-min': 'historical-chart/1min', 'intraday-5-min': 'historical-chart/5min', 'intraday-15-min': 'historical-chart/15min', 'intraday-30-min': 'historical-chart/30min', 'intraday-1-hour': 'historical-chart/1hour', 'intraday-4-hour': 'historical-chart/4hour' },
  company: { 'profile-symbol': 'profile', 'market-cap': 'market-capitalization', peers: 'stock-peers', 'employee-count': 'employee-count' },
  quote: { quote: 'quote', 'quote-short': 'quote-short', 'batch-quote': 'batch-quote', 'batch-quote-short': 'batch-quote-short', 'aftermarket-quote': 'aftermarket-quote', 'quote-change': 'stock-price-change' },
  commodity: { 'commodities-quote': 'quote', 'commodities-quote-short': 'quote-short', 'commodities-intraday-1-min': 'historical-chart/1min', 'commodities-intraday-5-min': 'historical-chart/5min', 'commodities-intraday-1-hour': 'historical-chart/1hour', 'commodities-historical-price-eod-full': 'historical-price-eod/full', 'commodities-historical-price-eod-light': 'historical-price-eod/light', 'commodities-list': 'commodities-list' },
};

const QUOTE_ORDER = ['symbol', 'name', 'exchange', 'mic_code', 'currency', 'datetime', 'timestamp', 'last_quote_at', 'open', 'high', 'low', 'close', 'volume', 'previous_close', 'change', 'percent_change', 'average_volume', 'is_market_open', 'fifty_two_week_low', 'fifty_two_week_high', 'fifty_two_week_low_change', 'fifty_two_week_high_change', 'fifty_two_week_low_change_percent', 'fifty_two_week_high_change_percent', 'fifty_two_week_range', 'extended_change', 'extended_percent_change', 'extended_price', 'extended_timestamp'];

function cell(v) { if (v === null || v === undefined) return ''; if (typeof v === 'boolean') return v ? 'true' : 'false'; return String(v).replace(/[;\n\r]/g, ' '); }
function flat(o, pre, out) { for (const k of Object.keys(o || {})) { const v = o[k], key = pre ? pre + '_' + k : k; if (v && typeof v === 'object' && !Array.isArray(v)) flat(v, key, out); else out[key] = v; } return out; }
function str(v, max = 40) { return v === undefined || v === null ? '' : String(v).slice(0, max); }

async function tdGet(path, params) {
  const u = new URL(TD + path);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
  u.searchParams.set('apikey', ENV.TWELVEDATA_API_KEY);
  const r = await fetch(u);
  const j = await r.json().catch(() => null);
  if (!j) return { err: 'Twelve Data: keine Antwort (' + r.status + ')' };
  if (j.status === 'error' || (j.code && j.message && !j.symbol && !j.values && !j.data)) return { err: String(j.message || 'Twelve Data Fehler') };
  return { j };
}

async function twelveData(tool, inp) {
  if (!ENV.TWELVEDATA_API_KEY) throw Object.assign(new Error('Twelve Data ist nicht eingerichtet'), { code: 'server_not_connected', status: 200 });
  const base = { symbol: str(inp.symbol), mic_code: str(inp.mic_code), exchange: str(inp.exchange), country: str(inp.country) };
  if (tool === 'get_quote') {
    const { j, err } = await tdGet('quote', { ...base, prepost: inp.prepost ? 'true' : undefined });
    if (err) return { result: err };
    const f = flat(j, '', {});
    const keys = QUOTE_ORDER.filter(k => k in f).concat(Object.keys(f).filter(k => !QUOTE_ORDER.includes(k)));
    return { result: keys.join(';') + '\n' + keys.map(k => cell(f[k])).join(';') };
  }
  if (tool === 'get_time_series') {
    const p = { ...base, interval: str(inp.interval || '1day', 10), outputsize: Math.min(5000, Math.max(1, parseInt(inp.outputsize || 30, 10) || 30)), start_date: str(inp.start_date, 20), end_date: str(inp.end_date, 20), prepost: inp.prepost ? 'true' : undefined };
    const { j, err } = await tdGet('time_series', p);
    if (err) return { result: err };
    const vals = Array.isArray(j.values) ? j.values : [];
    if (!vals.length) return { result: 'datetime;open;high;low;close;volume\n' };
    const keys = ['datetime', 'open', 'high', 'low', 'close', 'volume'].filter(k => k in vals[0]);
    return { result: keys.join(';') + '\n' + vals.map(v => keys.map(k => cell(v[k])).join(';')).join('\n') + '\n' };
  }
  if (tool === 'search_symbol') {
    const { j, err } = await tdGet('symbol_search', { symbol: str(inp.symbol, 60), outputsize: Math.min(30, parseInt(inp.outputsize || 10, 10) || 10), instrument_type: str(inp.instrument_type, 30), country: str(inp.country) });
    if (err) return { result: err };
    return { result: JSON.stringify(Array.isArray(j.data) ? j.data : []) };
  }
  throw Object.assign(new Error('Werkzeug nicht freigegeben'), { code: 'not_in_manifest', status: 200 });
}

async function fmp(tool, inp) {
  if (!ENV.FMP_API_KEY) throw Object.assign(new Error('FMP ist nicht eingerichtet'), { code: 'server_not_connected', status: 200 });
  const m = FMP_MAP[tool]; const path = m && m[inp.endpoint];
  if (!path) throw Object.assign(new Error('Endpunkt nicht freigegeben: ' + tool + '/' + inp.endpoint), { code: 'not_in_manifest', status: 200 });
  const u = new URL(FMP + path);
  const P = { symbol: inp.symbol, period: inp.period, page: inp.page, limit: inp.limit, from: inp.from_date, to: inp.to_date, exchange: inp.exchange };
  if (Array.isArray(inp.symbols)) P.symbols = inp.symbols.slice(0, 50).join(',');
  for (const [k, v] of Object.entries(P)) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v).slice(0, 200));
  u.searchParams.set('apikey', ENV.FMP_API_KEY);
  const r = await fetch(u);
  const txt = await r.text();
  let j = null; try { j = JSON.parse(txt); } catch { /* Text */ }
  const msg = j && !Array.isArray(j) && typeof j === 'object' ? (j['Error Message'] || j.error || j.message) : (j ? null : txt);
  if (r.status === 429 || /limit reach/i.test(String(msg || ''))) return 'Limit Reach: ' + String(msg || 'zu viele Abrufe heute').slice(0, 160);
  if (r.status === 401 || r.status === 402 || r.status === 403 || /restricted|premium|subscription|upgrade|not available under/i.test(String(msg || ''))) return 'ACCESS DENIED: requires higher plan. ' + String(msg || '').slice(0, 160);
  if (!r.ok) return 'FMP Fehler ' + r.status + ': ' + String(msg || txt).slice(0, 160);
  if (msg && !Array.isArray(j)) return 'FMP: ' + String(msg).slice(0, 200);
  return j;
}

async function parallel(tool, inp) {
  if (tool !== 'web_search') throw Object.assign(new Error('Werkzeug nicht freigegeben'), { code: 'not_in_manifest', status: 200 });
  if (!ENV.PARALLEL_API_KEY) throw Object.assign(new Error('Parallel Search ist nicht eingerichtet'), { code: 'server_not_connected', status: 200 });
  const body = { objective: str(inp.objective, 4900) || undefined, search_queries: (Array.isArray(inp.search_queries) ? inp.search_queries : []).slice(0, 5).map(q => str(q, 190)).filter(Boolean) };
  if (!body.search_queries.length) body.search_queries = [str(inp.objective, 190) || 'news'];
  const r = await fetch(PAR, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': ENV.PARALLEL_API_KEY }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j) throw Object.assign(new Error('Parallel Search ' + r.status + ': ' + String(j && (j.error && j.error.message || j.message) || '').slice(0, 160)), { code: r.status === 429 ? 'rate_limited' : 'tool_error', status: 200 });
  return { search_id: j.search_id || '', results: (j.results || []).map(x => ({ url: x.url, title: x.title || '', publish_date: x.publish_date || null, excerpts: Array.isArray(x.excerpts) ? x.excerpts : [] })) };
}

function ttl(server, tool, inp) {
  if (server === 'Twelve Data') {
    if (tool === 'get_quote') return 60_000;
    if (tool === 'search_symbol') return 7 * 864e5;
    return /day|week|month/.test(String(inp.interval || '1day')) ? 30 * 60_000 : 2 * 60_000;
  }
  if (server === 'FMP') {
    const e = String(inp.endpoint || '');
    if (/quote/.test(e)) return 60_000;
    if (/intraday/.test(e)) return 2 * 60_000;
    if (/profile|list|peers/.test(e)) return 7 * 864e5;
    if (/earnings-calendar/.test(e)) return 3 * 36e5;
    return 6 * 36e5;
  }
  return 10 * 60_000;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { ok: false, code: 'method' });
  try {
    await requireUser(req);
    const b = await readBody(req);
    const server = String(b.server || ''), tool = String(b.tool || ''), inp = (b.input && typeof b.input === 'object') ? b.input : {};
    if (!['Twelve Data', 'FMP', 'Parallel Search'].includes(server)) return send(res, 200, { ok: false, code: 'server_not_connected', message: 'Unbekannte Datenquelle' });
    const key = 'mcp|' + server + '|' + tool + '|' + JSON.stringify(Object.keys(inp).sort().reduce((o, k) => (o[k] = inp[k], o), {}));
    const T = ttl(server, tool, inp);
    const hit = await cacheGet(key, b.refresh ? Math.min(T, 30_000) : T);
    if (hit) return send(res, 200, { ok: true, payload: hit.body, storedAt: hit.at, cached: true });
    let payload;
    if (server === 'Twelve Data') payload = await twelveData(tool, inp);
    else if (server === 'FMP') payload = await fmp(tool, inp);
    else payload = await parallel(tool, inp);
    const bad = typeof payload === 'string' || (payload && typeof payload.result === 'string' && !/^(symbol|datetime|\[)/.test(payload.result));
    const v = bad ? { at: Date.now(), body: payload } : await cachePut(key, payload);
    return send(res, 200, { ok: true, payload: v.body, storedAt: v.at });
  } catch (e) { return fail(res, e); }
}
