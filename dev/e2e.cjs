// Ende-zu-Ende-Test gegen den lokalen Fake-Server (FAKE=1 node dev/server.mjs)
const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright');
const BASE = process.env.BASE || 'http://localhost:8787';
const OUT = '/tmp/claude-0/web/'; require('fs').mkdirSync(OUT, { recursive: true });
(async () => {
  const br = await chromium.launch(); const errs = []; const R = {};
  const ctx = await br.newContext({ viewport: { width: 390, height: 860 }, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push('pageerror ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push('console ' + m.text().slice(0, 200)); });
  await p.goto(BASE + '/'); await p.waitForTimeout(1500);
  R.gate = await p.evaluate(() => ({ visible: !document.getElementById('gate').hidden, guestHidden: document.getElementById('g-guest').hidden, chip: document.querySelector('.g-chip').textContent.trim(), gok: document.documentElement.classList.contains('gok') }));
  await p.screenshot({ path: OUT + '1-login.png' });
  // falsches Passwort
  await p.fill('#g-em', 'test@mfx.de'); await p.fill('#g-pw', 'falsch'); await p.click('#g-go'); await p.waitForTimeout(800);
  R.wrong = await p.textContent('#g-msg');
  // richtig
  await p.fill('#g-pw', 'passwort123'); await Promise.all([p.waitForNavigation(), p.click('#g-go')]); await p.waitForTimeout(4000);
  R.after = await p.evaluate(() => ({ gok: document.documentElement.classList.contains('gok'), gateHidden: document.getElementById('gate').hidden || getComputedStyle(document.getElementById('gate')).display === 'none', session: window.mfxWeb.session() }));
  // Daten: Kurse, Radar
  await p.waitForTimeout(3000);
  R.data = await p.evaluate(() => ({ tape: (document.getElementById('trk') || {}).textContent.slice(0, 80), radar: document.querySelectorAll('#mr-start .mr-i').length, radarErr: (document.querySelector('#mr-start .mr-note') || {}).textContent || '' }));
  await p.screenshot({ path: OUT + '2-start.png', fullPage: false });
  // Journal im Speicher-Modus db
  await p.evaluate(() => { mfxMode('tj'); __TJ.tab('dash'); }); await p.waitForTimeout(1500);
  R.journal = await p.evaluate(() => { const r = document.getElementById('tj-host').shadowRoot; const s = r.querySelector('.sync'); return { sync: s ? s.textContent.trim() : null }; });
  // Einen Trade über die Datenbank schreiben und lesen
  R.db = await p.evaluate(async () => { const db = await claude.use('db'), u = await claude.use('user'); const id = await u.id(); await db.doc('data/users/' + id + '/journal/trades/t_test').set({ v: 1, id: 't_test', sym: 'NVDA', dir: 'long', ep: 200, qty: 1, et: '2026-10-20T10:00' }); const s = await db.doc('data/users/' + id + '/journal/trades/t_test').get(); let denied = null; try { await db.doc('data/users/someone-else/x').set({ a: 1 }); } catch (e) { denied = e.code; } return { id, exists: s.exists, sym: s.data().sym, denied }; });
  await p.waitForTimeout(500);
  R.trades = await p.evaluate(() => (window.__TJ && __TJ.ST && __TJ.ST.trades || []).length);
  await p.evaluate(() => { mfxMode('mz'); tab('stk'); skOpen('NVDA'); }); await p.waitForTimeout(3500);
  R.stock = await p.evaluate(() => ({ head: (document.getElementById('sk-head') || {}).textContent.slice(0, 80), mr: document.querySelectorAll('#sk-mr .mr-i').length }));
  await p.screenshot({ path: OUT + '3-aktie.png' });
  // Guide mit Werkzeug-Runde
  await p.evaluate(() => mfxGuide.open()); await p.waitForTimeout(300);
  await p.fill('#gd-in', 'Was ist der Bias?'); await p.press('#gd-in', 'Enter'); await p.waitForTimeout(3000);
  R.guide = await p.evaluate(() => { const a = [...document.querySelectorAll('#gd-m .gd-b.a')].pop(); return a ? a.textContent.slice(0, 160) : null; });
  await p.screenshot({ path: OUT + '4-guide.png' });
  await p.evaluate(() => mfxGuide.close());
  // Neu laden: bleibt angemeldet
  await p.reload(); await p.waitForTimeout(2500);
  R.reload = await p.evaluate(() => ({ gok: document.documentElement.classList.contains('gok'), session: !!window.mfxWeb.session(), trades: (window.__TJ && __TJ.ST && __TJ.ST.trades || []).filter(t => t.id === 't_test').length }));
  // Abmelden
  await p.evaluate(() => { const b = document.getElementById('g-out'); b && b.click(); }); await p.waitForTimeout(800);
  R.logout = await p.evaluate(() => ({ gateVisible: !document.getElementById('gate').hidden, session: window.mfxWeb.session(), ls: localStorage.getItem('mfx-sb-session') }));
  await p.reload(); await p.waitForTimeout(1500);
  R.logoutReload = await p.evaluate(() => ({ gateVisible: !document.getElementById('gate').hidden, gok: document.documentElement.classList.contains('gok') }));
  // Einladungslink
  const tok = await p.evaluate(async () => { const r = await fetch('/__sb/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: 'anon-test', 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'test@mfx.de', password: 'passwort123' }) }); return r.json(); });
  await p.goto('about:blank');
  await p.goto(BASE + '/#access_token=' + tok.access_token + '&refresh_token=' + tok.refresh_token + '&expires_in=3600&type=invite'); await p.waitForTimeout(1500);
  R.invite = await p.evaluate(() => ({ dialog: !!document.querySelector('.mw-ov'), hash: location.hash }));
  await p.screenshot({ path: OUT + '5-einladung.png' });
  console.log(JSON.stringify(R));
  await p.fill('#mw-p1', 'neuesPasswort1'); await p.fill('#mw-p2', 'neuesPasswort1');
  await Promise.all([p.waitForNavigation(), p.click('.mw-card button')]); await p.waitForTimeout(2000);
  R.inviteDone = await p.evaluate(() => ({ gok: document.documentElement.classList.contains('gok'), session: !!window.mfxWeb.session() }));
  const st = await (await fetch(BASE + '/__test/state')).json();
  R.ai = st.ai; R.docs = Object.keys(st.docs);
  console.log(JSON.stringify(R, null, 1));
  console.log('ERRORS', errs);
  await br.close();
})().catch(e => { console.error(e); process.exit(1); });
