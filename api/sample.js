import { ENV, send, readBody, requireUser, sbService, fail } from './_lib/util.js';

// Ersetzt Claude-in-der-Seite: ruft die Anthropic-API mit deinem Schlüssel auf.
// Pro Person gibt es ein Tageslimit (AI_DAILY_LIMIT), damit die Kosten klein bleiben.

const MEMUSE = new Map(); // Ersatz, falls kein Supabase-Dienstschlüssel gesetzt ist

function dayKey() { return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' }); }

async function takeCall(uid) {
  if (!ENV.AI_DAILY_LIMIT) return { n: 0, ok: true };
  try {
    const n = await sbService('rpc/ai_take', { method: 'POST', body: JSON.stringify({ p_user: uid }) });
    if (typeof n === 'number') return { n, ok: n <= ENV.AI_DAILY_LIMIT };
  } catch { /* Ersatz unten */ }
  const k = uid + '|' + dayKey(), n = (MEMUSE.get(k) || 0) + 1; MEMUSE.set(k, n);
  return { n, ok: n <= ENV.AI_DAILY_LIMIT };
}

function cleanBlocks(c) {
  if (typeof c === 'string') return c.slice(0, 120_000);
  if (!Array.isArray(c)) return '';
  return c.slice(0, 40).map(b => {
    if (!b || typeof b !== 'object') return null;
    if (b.type === 'text') return { type: 'text', text: String(b.text || '').slice(0, 120_000) };
    if (b.type === 'tool_use') return { type: 'tool_use', id: String(b.id), name: String(b.name).slice(0, 64), input: b.input && typeof b.input === 'object' ? b.input : {} };
    if (b.type === 'tool_result') return { type: 'tool_result', tool_use_id: String(b.tool_use_id), content: typeof b.content === 'string' ? b.content.slice(0, 60_000) : JSON.stringify(b.content || '').slice(0, 60_000), ...(b.is_error ? { is_error: true } : {}) };
    return null;
  }).filter(Boolean);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { ok: false, code: 'method' });
  try {
    const user = await requireUser(req);
    if (!ENV.ANTHROPIC_API_KEY) return send(res, 200, { ok: false, code: 'capability_disabled', message: 'KI ist auf dieser Seite nicht eingerichtet.' });
    const b = await readBody(req);
    let messages = typeof b.input === 'string' ? [{ role: 'user', content: b.input }] : Array.isArray(b.input) ? b.input : [];
    messages = messages.slice(-40).map(m => ({ role: m && m.role === 'assistant' ? 'assistant' : 'user', content: cleanBlocks(m && m.content) })).filter(m => m.content && m.content.length);
    if (!messages.length || messages[messages.length - 1].role !== 'user') return send(res, 200, { ok: false, code: 'bad_request', message: 'Leere Anfrage' });
    const round = Math.max(0, parseInt(b.round || 0, 10) || 0);
    if (round > 8) return send(res, 200, { ok: false, code: 'bad_request', message: 'Zu viele Runden' });
    const t = await takeCall(user.id); // jede Anfrage zählt, auch Werkzeug-Runden des Guides
    if (!t.ok) return send(res, 200, { ok: false, code: 'rate_limited', message: 'Tageslimit für KI-Antworten erreicht (' + ENV.AI_DAILY_LIMIT + ' pro Tag). Morgen geht es weiter.' });
    const tier = b.modelTier === 'quick' ? 'quick' : b.modelTier === 'complex' ? 'complex' : 'default';
    const model = tier === 'quick' ? ENV.MODEL_QUICK : tier === 'complex' ? ENV.MODEL_COMPLEX : ENV.MODEL_DEFAULT;
    const body = { model, max_tokens: Math.min(ENV.AI_MAX_TOKENS, Math.max(256, parseInt(b.max_tokens || ENV.AI_MAX_TOKENS, 10) || ENV.AI_MAX_TOKENS)), messages };
    if (typeof b.system === 'string' && b.system.trim()) body.system = b.system.slice(0, 20_000);
    if (Array.isArray(b.tools) && b.tools.length) body.tools = b.tools.slice(0, 8).map(t => ({ name: String(t.name).slice(0, 64), description: String(t.description || '').slice(0, 2000), input_schema: t.input_schema && typeof t.input_schema === 'object' ? t.input_schema : { type: 'object', properties: {} } }));
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': ENV.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(58_000),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j) {
      const code = r.status === 429 ? 'rate_limited' : r.status === 529 || r.status === 503 ? 'overloaded' : r.status === 400 ? 'bad_request' : 'upstream_error';
      return send(res, 200, { ok: false, code, message: String(j && j.error && j.error.message || ('Anthropic ' + r.status)).slice(0, 300) });
    }
    try { if (j.usage) await sbService('rpc/ai_tokens', { method: 'POST', body: JSON.stringify({ p_user: user.id, p_in: j.usage.input_tokens || 0, p_out: j.usage.output_tokens || 0 }) }); } catch { /* optional */ }
    return send(res, 200, { ok: true, content: j.content || [], stop_reason: j.stop_reason, model: j.model || model, tier });
  } catch (e) {
    if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) return send(res, 200, { ok: false, code: 'timeout', message: 'Die KI hat zu lange gebraucht.' });
    return fail(res, e);
  }
}
