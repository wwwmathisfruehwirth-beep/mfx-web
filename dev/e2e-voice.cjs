// Test für den Sprachmodus (MFX Voice) gegen den Fake-Server.
// Spracherkennung und Stimme werden im Browser simuliert.
// FAKE=1 node dev/server.mjs  (und für den Befehlsmodus zusätzlich FAKE=1 FAKE_NO_AI=1 PORT=8788 node dev/server.mjs)
// node dev/e2e-voice.cjs
const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright');
const BASE = process.env.BASE || 'http://localhost:8787';
const BASE2 = process.env.BASE2 || 'http://localhost:8788';
const OUT = process.env.OUT || '/tmp/claude-0/web/'; require('fs').mkdirSync(OUT, { recursive: true });

const MOCK = () => {
  window.__SRQ = []; window.__spoken = []; window.__srStarts = 0;
  class FakeSR {
    start() {
      window.__srStarts++;
      const t = window.__SRQ.shift();
      setTimeout(() => {
        this.onstart && this.onstart();
        if (t === undefined || t === null) { setTimeout(() => { this.onerror && this.onerror({ error: 'no-speech' }); this.onend && this.onend(); }, 150); return; }
        const res = (fin) => { const r = [{ transcript: t, confidence: 0.9 }]; r.isFinal = fin; return { results: [r] }; };
        this.onresult && this.onresult(res(false));
        setTimeout(() => { this.onresult && this.onresult(res(true)); this.onend && this.onend(); }, 250);
      }, 80);
    }
    stop() { } abort() { setTimeout(() => { this.onerror && this.onerror({ error: 'aborted' }); this.onend && this.onend(); }, 10); }
  }
  window.webkitSpeechRecognition = FakeSR; window.SpeechRecognition = FakeSR;
  const fakeTTS = {
    speaking: false, _q: [],
    getVoices() { return [{ name: 'Anna', lang: 'de-DE', voiceURI: 'Anna', localService: true }, { name: 'Google Deutsch', lang: 'de-DE', voiceURI: 'Google Deutsch', localService: false }]; },
    speak(u) { if (String(u.text).trim()) window.__spoken.push(u.text); setTimeout(() => { u.onboundary && u.onboundary({}); u.onend && u.onend({}); }, 120); },
    cancel() { }, addEventListener() { }, pause() { }, resume() { }
  };
  Object.defineProperty(window, 'speechSynthesis', { value: fakeTTS, configurable: true });
};

async function login(p, base) {
  await p.goto(base + '/'); await p.waitForTimeout(1200);
  await p.fill('#g-em', 'test@mfx.de'); await p.fill('#g-pw', 'passwort123');
  await Promise.all([p.waitForNavigation(), p.click('#g-go')]); await p.waitForTimeout(3500);
}
const waitIdle = (p, ms = 8000) => p.waitForFunction(() => { const s = mfxVoice.state(); return s.state === 'idle' || s.state === 'err' || !s.open; }, null, { timeout: ms });

(async () => {
  const br = await chromium.launch(); const errs = []; const R = {};
  async function page(base, vp) {
    const ctx = await br.newContext({ viewport: vp, locale: 'de-DE', timezoneId: 'Europe/Berlin', deviceScaleFactor: 2 });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await ctx.addInitScript(MOCK);
    const p = await ctx.newPage();
    p.on('pageerror', e => { if (e.message !== 'Object') errs.push('pageerror ' + e.message); }); // 'Object' = bekannte {code:'empty'}-Ablehnungen der Seite im Testbetrieb
    p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push('console ' + m.text().slice(0, 200)); });
    await login(p, base);
    return p;
  }

  /* ---------- Handy, mit KI ---------- */
  const p = await page(BASE, { width: 390, height: 844 });
  R.fab = await p.evaluate(() => { const b = document.getElementById('mv-fab'), g = document.getElementById('gd-fab'); const r1 = b.getBoundingClientRect(), r2 = g.getBoundingClientRect(); return { visible: getComputedStyle(b).display !== 'none', above: r1.bottom < r2.top, centered: Math.abs((r1.left + r1.right) / 2 - (r2.left + r2.right) / 2) < 2, gdMic: !!document.getElementById('gd-mic') }; });
  await p.screenshot({ path: OUT + 'v1-start.png' });
  R.parse = await p.evaluate(() => ['Wie steht Nvidia?', 'Envidia', 'Öffne den Kalender', 'Zeig mir meine Trades', 'Warum fällt Nvidia heute?', 'Hey MFX, wie steht der Goldpreis gerade?', 'öffne Tesla', 'Danke', 'Wie steht der S&P 500?', 'Was sagt die Zentrale zu Gold?'].map(t => [t, JSON.stringify(mfxVoice.parse(t))]));
  R.speech = await p.evaluate(() => mfxVoice.speech('**NVDA** steht bei $182,40 (+2,1 %). XAU/USD → 2.650 €'));
  // 1) Schnellweg: Kurs per Stimme, dann im Gesprächsmodus weiter: KI-Frage mit Werkzeug, dann Stille
  await p.evaluate(() => { window.__SRQ.push('Wie steht Nvidia?', 'Was sagt die Zentrale zu Gold und wie läuft es?'); });
  await p.click('#mv-fab'); await p.waitForTimeout(250);
  await p.screenshot({ path: OUT + 'v2-listen.png' });
  await p.waitForFunction(() => window.__spoken.length >= 1, null, { timeout: 6000 });
  R.quoteSpoken = await p.evaluate(() => window.__spoken[0]);
  await p.waitForFunction(() => window.__spoken.length >= 2, null, { timeout: 8000 });
  await p.waitForTimeout(600);
  await waitIdle(p);
  R.aiFlow = await p.evaluate(() => ({ spoken: window.__spoken.slice(), starts: window.__srStarts, st: mfxVoice.state().state, ai: mfxVoice.state().ai, ans: document.getElementById('mv-ans').textContent, mode: document.getElementById('mv-mode').textContent }));
  await p.screenshot({ path: OUT + 'v3-answer.png' });
  // 2) Navigation per Tippen: verkleinert sich, Seite sichtbar
  await p.fill('#mv-in', 'Öffne den Kalender'); await p.press('#mv-in', 'Enter');
  await p.waitForTimeout(900);
  R.nav = await p.evaluate(() => ({ mini: mfxVoice.state().mini, cal: !document.getElementById('p-cal').hidden, ans: document.getElementById('mv-ans').textContent, fabHidden: getComputedStyle(document.getElementById('mv-fab')).display === 'none' }));
  await p.evaluate(() => { window.__SRQ.length = 0; });
  await waitIdle(p);
  await p.screenshot({ path: OUT + 'v4-mini.png' });
  // 3) Einstellungen
  await p.click('#mv-min'); await p.waitForTimeout(300); await p.click('#mv-set'); await p.waitForTimeout(200);
  R.settings = await p.evaluate(() => ({ voices: [...document.querySelectorAll('#mv-voice option')].map(o => o.textContent), talk: document.getElementById('mv-talkm').checked }));
  await p.screenshot({ path: OUT + 'v5-settings.png' });
  await p.click('#mv-set');
  // 4) Verabschiedung schließt
  await p.fill('#mv-in', 'Danke'); await p.press('#mv-in', 'Enter'); await p.waitForTimeout(1600);
  R.bye = await p.evaluate(() => ({ open: mfxVoice.state().open, last: window.__spoken[window.__spoken.length - 1] }));
  // 5) Guide-Mikrofon öffnet den Sprachmodus
  await p.evaluate(() => mfxGuide.open()); await p.waitForTimeout(300);
  await p.screenshot({ path: OUT + 'v6-guide.png' });
  await p.click('#gd-mic'); await p.waitForTimeout(700);
  R.guideMic = await p.evaluate(() => ({ open: mfxVoice.state().open, guideClosed: document.getElementById('gd-p').hidden }));
  await waitIdle(p); await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  R.esc = await p.evaluate(() => mfxVoice.state().open);
  const st = await (await fetch(BASE + '/__test/state')).json(); R.aiCalls = st.ai;

  /* ---------- Desktop, ohne KI (Befehlsmodus) ---------- */
  const d = await page(BASE2, { width: 1366, height: 860 });
  await d.screenshot({ path: OUT + 'v7-desktop.png' });
  await d.evaluate(() => { window.__SRQ.push('Wie steht Bitcoin?'); });
  await d.click('#mv-fab'); await d.waitForFunction(() => window.__spoken.length >= 1, null, { timeout: 6000 });
  await d.waitForTimeout(500); await waitIdle(d);
  await d.screenshot({ path: OUT + 'v8-desktop-voice.png' });
  await d.fill('#mv-in', 'Erklär mir den COT-Bericht'); await d.press('#mv-in', 'Enter'); await d.waitForTimeout(1200); await waitIdle(d);
  await d.fill('#mv-in', 'Wie steht Rheinmetall?'); await d.press('#mv-in', 'Enter'); await d.waitForTimeout(1500); await waitIdle(d);
  R.noAi = await d.evaluate(() => ({ spoken: window.__spoken.slice(), mode: document.getElementById('mv-mode').textContent }));
  await d.screenshot({ path: OUT + 'v9-desktop-cmd.png' });

  console.log(JSON.stringify(R, null, 1));
  console.log('ERRORS', errs);
  await br.close();
})().catch(e => { console.error(e); process.exit(1); });
