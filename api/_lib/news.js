// Kostenlose Nachrichtensuche über den RSS-Feed von Bing News.
// Springt ein, solange kein Parallel-Schlüssel gesetzt ist (oder Parallel ausfällt). Kein Schlüssel nötig.

const BING = 'https://www.bing.com/news/search';
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function unent(s) {
  return String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; }
    return ENT[e.toLowerCase()] ?? m;
  });
}
function rssTag(x, n) { const m = x.match(new RegExp('<' + n + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + n + '>', 'i')); return m ? unent(m[1]).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : ''; }
function realUrl(l) { try { const t = new URL(l).searchParams.get('url'); if (t && /^https?:\/\//i.test(t)) return t; } catch { /* Link bleibt */ } return l; }
const isDe = (q) => /[äöüß]|\b(aktie|aktien|analysten|heute|nachrichten|hedgefonds|börse|zinsen|warnen)\b/i.test(q);
async function bingOne(q) {
  const de = isDe(q), u = new URL(BING);
  u.searchParams.set('q', q); u.searchParams.set('format', 'rss'); u.searchParams.set('qft', 'interval="8"'); // letzte 7 Tage
  u.searchParams.set('cc', de ? 'DE' : 'US'); u.searchParams.set('setlang', de ? 'de-DE' : 'en-US');
  const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MFX-Makro-Zentrale/1.0)', Accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.5' }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('Bing ' + r.status);
  const xml = await r.text();
  return (xml.match(/<item>[\s\S]*?<\/item>/gi) || []).slice(0, 12).map(it => {
    const url = realUrl(rssTag(it, 'link')), d = new Date(rssTag(it, 'pubDate'));
    const src = rssTag(it, 'News:Source');
    const ex = rssTag(it, 'description');
    return { url, title: rssTag(it, 'title').slice(0, 220), publish_date: isNaN(d) ? null : d.toISOString(), excerpts: ex ? [(src ? src + ': ' : '') + ex.slice(0, 900)] : (src ? [src] : []) };
  }).filter(x => /^https?:\/\//.test(x.url) && x.title);
}
export async function freeNews(qs) {
  const got = await Promise.allSettled(qs.slice(0, 4).map(bingOne));
  const all = got.filter(g => g.status === 'fulfilled').flatMap(g => g.value);
  if (!all.length) {
    const bad = got.find(g => g.status === 'rejected');
    throw Object.assign(new Error('Die Nachrichtensuche ist gerade nicht erreichbar' + (bad ? ' (' + String(bad.reason && bad.reason.message || '').slice(0, 60) + ')' : '')), { code: 'tool_error', status: 200 });
  }
  const seenU = new Set(), seenT = new Set(), out = [];
  for (const x of all.sort((a, b) => Date.parse(b.publish_date || 0) - Date.parse(a.publish_date || 0))) {
    const tk = x.title.toLowerCase().replace(/[^a-z0-9äöüß]+/g, '').slice(0, 60);
    if (seenU.has(x.url) || seenT.has(tk)) continue;
    seenU.add(x.url); seenT.add(tk); out.push(x);
    if (out.length >= 12) break;
  }
  return { search_id: 'news', source: 'bing', results: out };
}
