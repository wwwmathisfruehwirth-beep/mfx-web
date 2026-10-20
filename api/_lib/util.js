// Gemeinsame Helfer für die Server-Funktionen (Vercel, Node 18+).
// Alle geheimen Schlüssel kommen aus Umgebungsvariablen und verlassen nie den Server.

// Werte säubern: Leerzeichen/Zeilenumbrüche vom Kopieren entfernen, URL ohne /rest/v1 o. ä.
const clean = (v) => String(v || '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim().replace(/^["']|["']$/g, '').trim();
// Von der Supabase-Adresse zählt nur der Anfang (https://xyz.supabase.co), Zusätze wie /rest/v1 werden abgeschnitten
const origin = (v) => clean(v).replace(/\/+$/, '').replace(/\/(rest|auth|storage|realtime|functions|graphql)\/v1(\/.*)?$/i, '').replace(/\/+$/, '');
export const ENV = {
  SUPABASE_URL: origin(process.env.SUPABASE_URL),
  SUPABASE_ANON_KEY: clean(process.env.SUPABASE_ANON_KEY),
  SUPABASE_SERVICE_ROLE_KEY: clean(process.env.SUPABASE_SERVICE_ROLE_KEY),
  TWELVEDATA_API_KEY: clean(process.env.TWELVEDATA_API_KEY),
  FMP_API_KEY: clean(process.env.FMP_API_KEY),
  PARALLEL_API_KEY: clean(process.env.PARALLEL_API_KEY),
  // Such-Modus von Parallel: fast kostet 1 $ je 1000 Suchen, basic/advanced 5 $ (Standard der API wäre advanced)
  PARALLEL_MODE: ['turbo', 'fast', 'basic', 'advanced'].includes(clean(process.env.PARALLEL_MODE).toLowerCase()) ? clean(process.env.PARALLEL_MODE).toLowerCase() : 'fast',
  ANTHROPIC_API_KEY: clean(process.env.ANTHROPIC_API_KEY),
  MODEL_QUICK: process.env.MODEL_QUICK || 'claude-haiku-5-5',
  MODEL_DEFAULT: process.env.MODEL_DEFAULT || 'claude-sonnet-5-5',
  MODEL_COMPLEX: process.env.MODEL_COMPLEX || process.env.MODEL_DEFAULT || 'claude-sonnet-5-5',
  AI_DAILY_LIMIT: Math.max(0, parseInt(process.env.AI_DAILY_LIMIT || '60', 10) || 0),
  AI_MAX_TOKENS: Math.max(256, parseInt(process.env.AI_MAX_TOKENS || '4000', 10) || 4000),
  OWNER_EMAIL: clean(process.env.OWNER_EMAIL).toLowerCase(),
};

export function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

export async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > 1_500_000) throw Object.assign(new Error('too_large'), { code: 'too_large' }); chunks.push(c); }
  const s = Buffer.concat(chunks).toString('utf8');
  if (!s) return {};
  try { return JSON.parse(s); } catch { return {}; }
}

// ---------- Anmeldung prüfen (Supabase) ----------
const AUTHC = new Map(); // token -> {user, until}
export async function requireUser(req) {
  const h = req.headers['authorization'] || req.headers['Authorization'] || '';
  const tok = String(h).replace(/^Bearer\s+/i, '').trim();
  if (!tok) throw Object.assign(new Error('Nicht angemeldet'), { code: 'not_signed_in', status: 401 });
  const hit = AUTHC.get(tok);
  if (hit && hit.until > Date.now()) return hit.user;
  if (!ENV.SUPABASE_URL || !ENV.SUPABASE_ANON_KEY) throw Object.assign(new Error('Supabase ist nicht eingerichtet'), { code: 'not_configured', status: 500 });
  const r = await fetch(ENV.SUPABASE_URL + '/auth/v1/user', { headers: { apikey: ENV.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + tok } });
  if (!r.ok) throw Object.assign(new Error('Sitzung abgelaufen'), { code: 'not_signed_in', status: 401 });
  const u = await r.json();
  if (!u || !u.id) throw Object.assign(new Error('Sitzung abgelaufen'), { code: 'not_signed_in', status: 401 });
  const user = { id: u.id, email: String(u.email || '').toLowerCase() };
  if (AUTHC.size > 500) AUTHC.clear();
  AUTHC.set(tok, { user, until: Date.now() + 5 * 60_000 });
  return user;
}

// ---------- Supabase mit Dienst-Schlüssel (nur Server) ----------
export async function sbService(path, init = {}) {
  if (!ENV.SUPABASE_URL || !ENV.SUPABASE_SERVICE_ROLE_KEY) return null;
  const r = await fetch(ENV.SUPABASE_URL + '/rest/v1/' + path, {
    ...init,
    // Neue Supabase-Schlüssel (sb_secret_…) gehören nur in den apikey-Header, alte (JWT) zusätzlich in Authorization
    headers: { apikey: ENV.SUPABASE_SERVICE_ROLE_KEY, ...(ENV.SUPABASE_SERVICE_ROLE_KEY.startsWith('sb_') ? {} : { Authorization: 'Bearer ' + ENV.SUPABASE_SERVICE_ROLE_KEY }), 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  if (!r.ok) { const t = await r.text().catch(() => ''); throw Object.assign(new Error('Supabase ' + r.status + ': ' + t.slice(0, 200)), { code: 'db_error' }); }
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

// ---------- Gemeinsamer Zwischenspeicher (spart API-Abrufe für alle Freunde) ----------
const MEM = new Map();
export async function cacheGet(key, ttlMs) {
  const m = MEM.get(key);
  if (m && Date.now() - m.at < ttlMs) return m;
  try {
    const rows = await sbService('api_cache?select=body,at&key=eq.' + encodeURIComponent(key) + '&limit=1');
    if (rows && rows[0]) {
      const at = Date.parse(rows[0].at);
      const v = { at, body: rows[0].body };
      MEM.set(key, v);
      if (Date.now() - at < ttlMs) return v;
    }
  } catch { /* Speicher ist optional */ }
  return null;
}
export async function cachePut(key, body) {
  const v = { at: Date.now(), body };
  if (MEM.size > 800) MEM.clear();
  MEM.set(key, v);
  try {
    await sbService('api_cache?on_conflict=key', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ key, body, at: new Date(v.at).toISOString() }) });
  } catch { /* optional */ }
  return v;
}

export function fail(res, e) {
  const status = e && e.status ? e.status : 500;
  send(res, status, { ok: false, code: (e && e.code) || 'server_error', message: String((e && e.message) || 'Fehler').slice(0, 300) });
}
