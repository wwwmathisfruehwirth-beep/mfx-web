import { ENV, send, requireUser } from './_lib/util.js';

// Prüfseite: /api/health zeigt, welche Schlüssel gesetzt sind (ohne sie zu verraten).
// /api/health?ping=1&secret=HEALTH_SECRET (oder angemeldet als OWNER_EMAIL) testet jede Quelle mit einem echten, kleinen Abruf.
export default async function handler(req, res) {
  const out = {
    supabase: !!(ENV.SUPABASE_URL && ENV.SUPABASE_ANON_KEY),
    supabaseService: !!ENV.SUPABASE_SERVICE_ROLE_KEY,
    twelveData: !!ENV.TWELVEDATA_API_KEY,
    fmp: !!ENV.FMP_API_KEY,
    parallel: !!ENV.PARALLEL_API_KEY,
    anthropic: !!ENV.ANTHROPIC_API_KEY,
    models: { quick: ENV.MODEL_QUICK, default: ENV.MODEL_DEFAULT },
    aiDailyLimit: ENV.AI_DAILY_LIMIT,
  };
  const url = new URL(req.url, 'http://x');
  if (url.searchParams.get('ping') !== '1') return send(res, 200, out);
  const secret = process.env.HEALTH_SECRET || '';
  if (!(secret && url.searchParams.get('secret') === secret)) {
    try {
      const u = await requireUser(req);
      if (!ENV.OWNER_EMAIL || u.email !== ENV.OWNER_EMAIL) return send(res, 403, { ok: false, code: 'forbidden', message: 'Nur für OWNER_EMAIL' });
    } catch (e) { return send(res, 401, { ok: false, code: 'not_signed_in', message: 'Öffne /api/health?ping=1&secret=DEIN_HEALTH_SECRET' }); }
  }
  const ping = {};
  async function t(name, fn) { try { ping[name] = await fn(); } catch (e) { ping[name] = 'Fehler: ' + String(e && e.message || e).slice(0, 160); } }
  await Promise.all([
    t('twelveData', async () => { const r = await fetch('https://api.twelvedata.com/quote?symbol=AAPL&apikey=' + ENV.TWELVEDATA_API_KEY); const j = await r.json(); return j.symbol ? 'ok (AAPL ' + j.close + ')' : 'Fehler: ' + (j.message || r.status); }),
    t('fmp', async () => { const r = await fetch('https://financialmodelingprep.com/stable/quote?symbol=AAPL&apikey=' + ENV.FMP_API_KEY); const x = await r.text(); return r.ok && x.startsWith('[') ? 'ok' : 'Fehler ' + r.status + ': ' + x.slice(0, 120); }),
    t('parallel', async () => { const r = await fetch('https://api.parallel.ai/v1/search', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': ENV.PARALLEL_API_KEY }, body: JSON.stringify({ objective: 'Nasdaq heute', search_queries: ['Nasdaq today'] }) }); return r.ok ? 'ok' : 'Fehler ' + r.status; }),
    t('anthropic', async () => { const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': ENV.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: ENV.MODEL_QUICK, max_tokens: 16, messages: [{ role: 'user', content: 'Sag nur: ok' }] }) }); const j = await r.json(); return r.ok ? 'ok (' + (j.model || ENV.MODEL_QUICK) + ')' : 'Fehler ' + r.status + ': ' + (j.error && j.error.message || ''); }),
  ]);
  return send(res, 200, { ...out, ping });
}
