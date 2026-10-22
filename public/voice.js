/* MFX Voice: Sprachmodus der Makro-Zentrale (im Stil von JARVIS).
   - Spracheingabe und Stimme kommen vom Browser (Web Speech API, kostenlos).
   - Antworten kommen von der KI der Seite (/api/sample) mit den Werkzeugen des MFX Guide plus Live-Kurs.
   - Einfache Befehle („Wie steht Nvidia?“, „Öffne den Kalender“) laufen ohne KI, also sofort und ohne Kosten.
   - Ohne KI-Schlüssel bleibt der Befehlsmodus nutzbar.
   Wird nach shim.js mit defer geladen. Öffnen: Mikrofon-Knopf unten rechts, Mikrofon im Guide oder window.mfxVoice.open(). */
(function () {
  'use strict';
  if (window.mfxVoice) return;
  var H = document.documentElement;
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;
  var TTS = ('speechSynthesis' in window) && window.SpeechSynthesisUtterance ? window.speechSynthesis : null;
  var RM = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* ---------- Einstellungen (nur in diesem Browser) ---------- */
  var CFG_KEY = 'mfx-voice-cfg', HIST_KEY = 'mfx-voice-h';
  var CFG = { talk: true, speak: true, voice: '', rate: 1.05 };
  try { var c0 = JSON.parse(localStorage.getItem(CFG_KEY) || 'null'); if (c0 && typeof c0 === 'object') for (var k in CFG) if (k in c0 && typeof c0[k] === typeof CFG[k]) CFG[k] = c0[k]; } catch (e) { }
  function saveCfg() { try { localStorage.setItem(CFG_KEY, JSON.stringify(CFG)); } catch (e) { } }
  var HIST = [];
  try { HIST = JSON.parse(sessionStorage.getItem(HIST_KEY) || '[]'); if (!Array.isArray(HIST)) HIST = []; } catch (e) { HIST = []; }
  HIST = HIST.filter(function (m) { return m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content; }).slice(-12);
  function saveHist() { HIST = HIST.slice(-12); try { sessionStorage.setItem(HIST_KEY, JSON.stringify(HIST)); } catch (e) { } }

  /* ---------- Helfer ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(id) { return document.getElementById(id); }
  function num(v, d) { if (v == null || !isFinite(v)) return '?'; return v.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function ucFirst(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function errMsgOf(e) { return String((e && (e.message || e.code)) || e || 'Fehler'); }

  /* ---------- Instrumente und Seiten, die der Befehlsmodus kennt ---------- */
  var INS = [
    [/\bn ?vidia\b|\benvidia\b|\bnvdia\b|\bnvda\b/, 'NVDA', 'Nvidia'],
    [/\bapple\b|\baepple\b|\baapl\b/, 'AAPL', 'Apple'],
    [/\bmicrosoft\b|\bmsft\b/, 'MSFT', 'Microsoft'],
    [/\bamazon\b|\bamzn\b/, 'AMZN', 'Amazon'],
    [/\balphabet\b|\bgoogle\b|\bgoogl\b/, 'GOOGL', 'Alphabet'],
    [/\bmeta\b|\bfacebook\b/, 'META', 'Meta'],
    [/\btesla\b|\btsla\b/, 'TSLA', 'Tesla'],
    [/\bnetflix\b/, 'NFLX', 'Netflix'],
    [/\bamd\b|\ba m d\b/, 'AMD', 'AMD'],
    [/\bbroadcom\b/, 'AVGO', 'Broadcom'],
    [/\bpalantir\b/, 'PLTR', 'Palantir'],
    [/\bintel\b/, 'INTC', 'Intel'],
    [/\btsmc\b|\btaiwan semi/, 'TSM', 'TSMC'],
    [/\bmicron\b/, 'MU', 'Micron'],
    [/\bcoinbase\b/, 'COIN', 'Coinbase'],
    [/\bnasdaq\b|\btech ?100\b|\bqqq\b/, 'QQQ', 'der Nasdaq-100-ETF'],
    [/\bs ?(?:&|und|and) ?p\b|\bs ?p ?500\b|\bus ?500\b|\bspy\b/, 'SPY', 'der S&P-500-ETF'],
    [/\bdow\b|\bdow jones\b|\bus ?30\b/, 'DIA', 'der Dow-ETF'],
    [/\brussell\b/, 'IWM', 'der Russell-2000-ETF'],
    [/\bgold\b|\bgoldpreis\b|\bxau\b/, 'XAU/USD', 'Gold'],
    [/\bsilber\b|\bsilver\b/, 'XAG/USD', 'Silber'],
    [/\bbitcoin\b|\bbtc\b/, 'BTC/USD', 'Bitcoin'],
    [/\bether\b|\bethereum\b|\beth\b/, 'ETH/USD', 'Ether'],
    [/\beuro ?dollar\b|\beur ?usd\b|\beuro\b/, 'EUR/USD', 'Euro-Dollar'],
    [/\bpfund\b|\bgbp ?usd\b/, 'GBP/USD', 'Pfund-Dollar'],
    [/\byen\b|\bdollar ?yen\b|\busd ?jpy\b/, 'USD/JPY', 'Dollar-Yen']
  ];
  var NAV = [
    [/trade erfassen|neuen trade|trade eintragen|erfassen/, 'journal', 'new', 'das Erfassen im Journal'],
    [/coach/, 'journal', 'coach', 'der Coach'],
    [/meine trades|\btrades\b/, 'journal', 'list', 'deine Trades', 1],
    [/journal/, 'journal', 'dash', 'dein Trading Journal'],
    [/kalender|termine/, 'makro', 'cal', 'der Kalender'],
    [/\bnews\b|nachrichten|radar/, 'makro', 'news', 'der Markt-Radar'],
    [/futures/, 'makro', 'fut', 'die Futures-Seite'],
    [/marktlage/, 'makro', 'heute', 'die Marktlage'],
    [/uebersicht|startseite/, 'makro', 'start', 'die Übersicht'],
    [/makro|analyse/, 'makro', 'ana', 'die Makro-Analyse'],
    [/aktienmarkt/, 'makro', 'mkt', 'der Aktienmarkt'],
    [/\bgold\b|waehrung|devisen|forex/, 'makro', 'gold', 'Gold und Währungen', 1],
    [/krypto|bitcoin/, 'makro', 'kry', 'die Krypto-Seite'],
    [/watchlist|watch list|beobachtungsliste/, 'makro', 'wl', 'deine Watchlist'],
    [/quartalszahlen|q zahlen|mag ?7 zahlen|zahlen/, 'makro', 'zs', 'die Mag-7-Zahlen', 1],
    [/aktie finden|aktiensuche/, 'makro', 'stk', 'die Aktiensuche'],
    [/\betf/, 'makro', 'etf', 'der ETF-Rechner'],
    [/rechner/, 'makro', 'rch', 'der Trade-Rechner'],
    [/lernpfad|lernen/, 'makro', 'lern', 'der Lernpfad'],
    [/lexikon/, 'makro', 'lex', 'das Lexikon']
  ];
  var Q_INTENT = /\b(wie steht|wie stehen|wo steht|wo stehen|wie laeuft|wie laufen|was macht|was machen|was kostet|was kosten|kurs|kurse|preis|notiert|steht)\b/;
  var NAV_VERB = /\b(oeffne|oeffnen|zeig|zeige|geh|gehe|bring|wechsel|wechsle|spring|navigier\w*)\b/;
  var BYE = /^(danke|danke schoen|dankeschoen|vielen dank|merci|tschuess|ciao|das wars|das war s|das war es|ende|beenden|schliessen|schluss)( mfx| dir| jarvis)?$/;
  var STOPW = /^(stopp|stop|halt|abbrechen|ruhe|sei still)$/;
  var NOT_SIMPLE = /\b(warum|wieso|weshalb|bias|termin|termine|analyst|analysten|news|nachricht|erklaer|erklaere|prognose|soll ich|kaufen|verkaufen|cot|einschaetzung|vergleich|und warum)\b/;

  function norm(s) { return String(s || '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[„“"’?!.,;:]/g, ' ').replace(/\s+/g, ' ').trim(); }
  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function findIns(t, allowWl) {
    for (var i = 0; i < INS.length; i++) if (INS[i][0].test(t)) return { sym: INS[i][1], label: INS[i][2] };
    if (allowWl) {
      var wl = Array.isArray(window.WL) ? window.WL : [];
      for (var j = 0; j < wl.length; j++) { var s = String(wl[j] || ''); if (s.length >= 3 && new RegExp('\\b' + escRe(s.toLowerCase()) + '\\b').test(t)) return { sym: s, label: s }; }
    }
    return null;
  }
  function findNav(t) { for (var i = 0; i < NAV.length; i++) if (NAV[i][0].test(t)) return { area: NAV[i][1], tab: NAV[i][2], label: NAV[i][3], pl: !!NAV[i][4] }; return null; }
  function parseCmd(raw) {
    var t = norm(raw).replace(/^(hey|hallo|hi|ok|okay|jarvis|mfx)( mfx| jarvis)?\s*/, '');
    if (!t) return null;
    var words = t.split(' ').length, qi = Q_INTENT.test(t), nv = NAV_VERB.test(t);
    if (STOPW.test(t)) return { type: 'stop' };
    if (BYE.test(t)) return { type: 'bye' };
    var nav = findNav(t), ins = findIns(t, qi);
    if (nv && nav && !/\b(kurs|preis|steht)\b/.test(t) && words <= 7) return { type: 'nav', area: nav.area, tab: nav.tab, label: nav.label, pl: nav.pl };
    if (nv && ins && /^[A-Z]{1,5}$/.test(ins.sym) && !qi && words <= 6) return { type: 'nav', area: 'makro', tab: 'stk', symbol: ins.sym, label: ins.label };
    if (ins && ((qi && words <= 8) || words <= 3) && !NOT_SIMPLE.test(t)) return { type: 'quote', sym: ins.sym, label: ins.label };
    return null;
  }

  /* ---------- Dienste der Seite (über shim.js) ---------- */
  var MCP = null, SMP = undefined;
  function getMcp() {
    if (MCP) return Promise.resolve(MCP);
    if (!window.claude || !claude.use) return Promise.resolve(null);
    return claude.use('mcp').then(function (m) { if (m) MCP = m; return m; }, function () { return null; });
  }
  function getSample() {
    if (SMP) return Promise.resolve(SMP);
    if (!window.claude || !claude.use) return Promise.resolve(null);
    return claude.use('sample').then(function (s) { SMP = s || null; return SMP; }, function () { return null; });
  }

  function normSym(s) {
    s = String(s || '').toUpperCase().trim().replace(/\s+/g, '');
    if (/^(GOLD|XAU|XAUUSD)$/.test(s)) return 'XAU/USD';
    if (/^(SILBER|SILVER|XAG|XAGUSD)$/.test(s)) return 'XAG/USD';
    if (/^(BTC|BITCOIN)$/.test(s)) return 'BTC/USD';
    if (/^(ETH|ETHER|ETHEREUM)$/.test(s)) return 'ETH/USD';
    if (/^(NAS100|US100|NDX|NASDAQ|NASDAQ100)$/.test(s)) return 'QQQ';
    if (/^(US500|SPX|SPX500|SP500)$/.test(s)) return 'SPY';
    if (/^(US30|DJI|DOW)$/.test(s)) return 'DIA';
    return s.replace(/^([A-Z]{3})([A-Z]{3})$/, function (m, a, b) { return /^(EUR|USD|GBP|JPY|AUD|CHF|CAD|NZD|XAU|XAG|BTC|ETH)$/.test(a) && /^(EUR|USD|GBP|JPY|AUD|CHF|CAD|NZD)$/.test(b) ? a + '/' + b : m; });
  }
  function tdText(r) {
    var t = r && r.payload && typeof r.payload === 'object' && typeof r.payload.result === 'string' ? r.payload.result : (r && r.content && r.content[0] && r.content[0].text) || '';
    if (typeof t === 'string' && t.charAt(0) === '{') { try { var o = JSON.parse(t); if (typeof o.result === 'string') t = o.result; } catch (e) { } }
    return String(t || '');
  }
  function quote(sym) {
    return getMcp().then(function (m) {
      if (!m) throw new Error('Live-Kurse sind gerade nicht verfügbar. Bitte anmelden und die Seite neu laden.');
      return m.callTool('Twelve Data', 'get_quote', { symbol: sym }, { cache: { staleTime: 30000, gcTime: 600000 } });
    }).then(function (r) {
      var t = tdText(r).trim(), L = t.split('\n');
      if (L.length < 2 || L[0].indexOf('symbol') < 0) {
        if (/api credits|run out|limit/i.test(t)) throw new Error('Gerade zu viele Kursabrufe. Versuch es in einer Minute noch einmal.');
        throw new Error('Für ' + sym + ' gibt es gerade keinen Kurs' + (t ? ': ' + t.replace(/\*\*/g, '').slice(0, 120) : '.'));
      }
      var K = L[0].split(';'), V = L[1].split(';'), o = {};
      K.forEach(function (k, i) { o[k] = V[i]; });
      var n = function (x) { var v = parseFloat(x); return isFinite(v) ? v : null; };
      var cur = o.currency || (/US Dollar/i.test(o.currency_quote || '') ? 'USD' : /Euro/i.test(o.currency_quote || '') ? 'EUR' : /Japanese Yen/i.test(o.currency_quote || '') ? 'JPY' : '');
      return {
        symbol: o.symbol || sym, name: o.name || '', currency: cur, close: n(o.close), change: n(o.change), pct: n(o.percent_change),
        prev: n(o.previous_close), high: n(o.high), low: n(o.low), open: o.is_market_open === 'true',
        ts: (n(o.last_quote_at) || n(o.timestamp) || 0) * 1000, w52lo: n(o.fifty_two_week_low), w52hi: n(o.fifty_two_week_high),
        ext: n(o.extended_price), extPct: n(o.extended_percent_change)
      };
    }, function (e) { throw new Error(e && e.code === 'server_not_connected' ? 'Twelve Data ist auf dem Server nicht eingerichtet.' : errMsgOf(e)); });
  }
  function isFx(sym) { return /\//.test(sym) && !/^(XAU|XAG|BTC|ETH)\//.test(sym); }
  function is247(sym) { return /^(BTC|ETH)\//.test(sym); }
  function curWord(c) { return c === 'USD' ? 'Dollar' : c === 'EUR' ? 'Euro' : c === 'GBP' ? 'Pfund' : c === 'JPY' ? 'Yen' : c === 'CHF' ? 'Franken' : (c || ''); }
  function stand(ts) { return ts ? new Date(ts).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) + ' Uhr' : ''; }
  function quoteSentence(q, label) {
    var fx = isFx(q.symbol), d = fx ? 4 : (q.close != null && q.close < 10 ? 3 : 2);
    var s = ucFirst(label || q.name || q.symbol) + ' steht bei ' + num(q.close, d) + (fx ? '' : ' ' + curWord(q.currency || (/\/USD$/.test(q.symbol) ? 'USD' : '')));
    if (q.pct != null) s += ', ' + (q.pct >= 0 ? 'plus ' : 'minus ') + num(Math.abs(q.pct), 2) + ' Prozent zum Vortag';
    s += '.';
    if (!q.open && !fx && !is247(q.symbol)) {
      s += ' Die Börse ist gerade zu, das ist der letzte Stand.';
      if (q.ext && q.extPct) s += ' Außerbörslich ' + (q.extPct >= 0 ? 'plus ' : 'minus ') + num(Math.abs(q.extPct), 2) + ' Prozent.';
    }
    return s;
  }

  /* ---------- Werkzeuge für die KI ---------- */
  var QUOTE_TOOL = {
    name: 'get_quote',
    description: 'Holt den aktuellen Live-Kurs von Twelve Data für eine Aktie, einen ETF, ein Devisenpaar, Gold, Silber oder Krypto: Kurs, Veränderung zum Vortag in Prozent, Tageshoch und -tief, 52-Wochen-Spanne, ob die Börse offen ist, Zeitpunkt und außerbörslicher Kurs. Indizes gibt es nicht: nimm für Nasdaq 100 QQQ, für S&P 500 SPY, für Dow DIA, für Russell 2000 IWM und sag dazu, dass es der ETF ist. Deutsche Aktien und DAX sind im aktuellen Tarif meist nicht verfügbar.',
    inputSchema: { type: 'object', properties: { symbol: { type: 'string', description: 'Kürzel, z. B. NVDA, AAPL, QQQ, EUR/USD, XAU/USD, BTC/USD' } }, required: ['symbol'] },
    execute: function (i) {
      var s = normSym(i && i.symbol);
      if (!s) throw new Error('Kein Kürzel angegeben');
      status('Holt den Live-Kurs von ' + s + ' …');
      return quote(s).then(function (q) {
        return {
          symbol: q.symbol, name: q.name || undefined, kurs: q.close, waehrung: q.currency || undefined, veraenderung: q.change, veraenderung_prozent: q.pct,
          vortag: q.prev, tageshoch: q.high, tagestief: q.low, spanne_52_wochen: q.w52lo != null && q.w52hi != null ? q.w52lo + ' bis ' + q.w52hi : undefined,
          boerse_offen: isFx(q.symbol) || is247(q.symbol) ? 'Handel rund um die Uhr (Wochenende ggf. Pause)' : q.open, stand: stand(q.ts) || undefined,
          ausserboerslich: !q.open && q.ext ? { kurs: q.ext, veraenderung_prozent: q.extPct } : undefined
        };
      });
    }
  };
  var TOOL_STATUS = { search_tool: 'Durchsucht die Zentrale …', get_instrument: 'Schaut, was die Zentrale dazu sagt …', get_journal: 'Liest dein Journal …', open_section: 'Öffnet die Seite …' };
  var NAVED = false;
  function aiTools() {
    var G = window.mfxGuide, list = [];
    (G && Array.isArray(G.tools) ? G.tools : []).forEach(function (t) {
      list.push({ name: t.name, description: t.description, inputSchema: t.inputSchema, execute: function (i) { status(TOOL_STATUS[t.name] || 'Arbeitet …'); if (t.name === 'open_section') NAVED = true; return t.execute(i); } });
    });
    list.push(QUOTE_TOOL);
    return list.slice(0, 8);
  }
  var VOICE_RULES = [
    'SPRACHMODUS – diese Regeln gehen allen Format-Regeln oben vor:',
    'Du bist jetzt „MFX Voice“, die Stimme der MFX-Zentrale: ein persönlicher Markt-Assistent im Stil von JARVIS. Ruhig, selbstbewusst, schnell auf den Punkt, gern mit einem kurzen, trockenen Spruch, aber nie auf Kosten der Fakten. Du duzt.',
    'Deine Antwort wird laut vorgelesen. Deshalb:',
    '- Meist 1 bis 3 kurze Sätze, höchstens etwa 60 Wörter. Nur wenn ausdrücklich eine Erklärung gewünscht ist, bis 6 Sätze.',
    '- Keine Listen, keine Sternchen, keine Emojis, keine Links, keine Tabellen, keine Kürzel in Klammern.',
    '- Schreib Zahlen so, wie man sie spricht: „182,40 Dollar“, „plus 2,1 Prozent“. Nenne Namen statt Kürzel (Nvidia statt NVDA, Gold statt XAU/USD, Euro-Dollar statt EUR/USD).',
    '- Für aktuelle Kurse immer get_quote nutzen und Kurs plus Veränderung zum Vortag nennen. Ist die Börse zu, sag, dass es der letzte Stand ist. Für die Einschätzung der Zentrale (Bias, Termine, COT, Analysten) nutze get_instrument.',
    '- Rufe Werkzeuge ohne Vorrede auf, also ohne „Ich schaue nach“.',
    '- Will der Nutzer etwas sehen, öffne es mit open_section und sag in einem Satz, wohin du ihn gebracht hast.',
    '- Die Frage kommt aus einer Spracherkennung und kann Hörfehler enthalten (z. B. „Envidia“ = Nvidia, „Mac 7“ = Mag 7). Deute sie sinnvoll und frag nur bei echter Unklarheit kurz nach.',
    '- Keine Anlageberatung: keine Kauf- oder Verkaufsempfehlung. Sag bei solchen Fragen kurz, was die Zentrale anzeigt, und dass die Entscheidung beim Nutzer liegt.'
  ].join('\n');

  function askAI(s, text, signal) {
    var G = window.mfxGuide, base = '';
    try { base = G && G.rules ? G.rules(true) : ''; } catch (e) { base = ''; }
    var hist = HIST.slice(-8).map(function (m) { return { role: m.role, content: m.content.slice(0, 1500) }; });
    while (hist.length && hist[0].role !== 'user') hist.shift();
    var msgs = [{ role: 'user', content: (base ? base + '\n\n' : '') + VOICE_RULES }].concat(hist).concat([{ role: 'user', content: text.slice(0, 1000) }]);
    var last = '';
    NAVED = false;
    return s(msgs, {
      signal: signal, cache: false, modelTier: 'quick', tools: aiTools(),
      onText: function (u) { if (u && u.delta) { last = String(u.delta).trim(); status('Antwortet …'); } }
    }).then(function (r) {
      var full = String(r && r.text || '').trim();
      return { text: last || full, nav: NAVED };
    });
  }
  function noAI(text) {
    var t = norm(text);
    if (Q_INTENT.test(t)) {
      var name = t.replace(Q_INTENT, ' ').replace(/\b(der|die|das|den|dem|von|vom|fuer|aktie|aktien|gerade|heute|aktuell|jetzt|mal|bitte|so|eigentlich|denn|mir|wie|was|wo|ist|sind|bei|im|in|an|hey|mfx)\b/g, ' ').replace(/\s+/g, ' ').trim();
      if (name.length >= 2 && name.split(' ').length <= 3) {
        status('Sucht „' + name + '“ …');
        return getMcp().then(function (m) {
          if (!m) throw new Error('Live-Kurse sind gerade nicht verfügbar.');
          return m.callTool('Twelve Data', 'search_symbol', { symbol: name, outputsize: 5 }, { cache: { staleTime: 864e5 } });
        }).then(function (r) {
          var arr = []; try { arr = JSON.parse(tdText(r)); } catch (e) { }
          if (!Array.isArray(arr) || !arr.length) return 'Zu „' + name + '“ habe ich nichts gefunden. Versuch es mit dem Firmennamen oder dem Kürzel.';
          var hit = arr.filter(function (x) { return x && x.country === 'United States'; })[0] || arr[0];
          return quote(hit.symbol).then(function (q) { return quoteSentence(q, hit.instrument_name || hit.symbol); });
        });
      }
    }
    return Promise.resolve('Ohne KI verstehe ich nur einfache Befehle, zum Beispiel „Wie steht Nvidia?“ oder „Öffne den Kalender“. Sobald der KI-Schlüssel auf dem Server eingerichtet ist, beantworte ich dir alles rund um die Zentrale.');
  }
  function navTo(cmd) {
    var G = window.mfxGuide, tool = G && Array.isArray(G.tools) ? G.tools.filter(function (t) { return t.name === 'open_section'; })[0] : null;
    if (!tool) throw new Error('Navigation ist gerade nicht verfügbar.');
    tool.execute({ area: cmd.area, tab: cmd.tab, symbol: cmd.symbol });
  }
  function aiErr(c) {
    return c === 'rate_limited' ? 'Das Tageslimit für KI-Antworten ist erreicht. Einfache Befehle wie Kurse oder „Öffne den Kalender“ gehen weiter.'
      : c === 'timeout' ? 'Die KI hat zu lange gebraucht. Frag gern noch einmal, vielleicht etwas kürzer.'
        : c === 'overloaded' ? 'Die KI ist gerade überlastet. Versuch es gleich noch einmal.'
          : c === 'network' ? 'Keine Verbindung zum Server. Prüf dein Internet.'
            : c === 'not_signed_in' ? 'Du bist nicht mehr angemeldet. Bitte melde dich neu an.'
              : 'Das hat gerade nicht geklappt. Versuch es noch einmal.';
  }

  /* ---------- Sprachausgabe ---------- */
  var VOICES = [], UTTS = [], SPEAK_END = null;
  function loadVoices() { if (!TTS) return []; try { VOICES = TTS.getVoices().filter(function (v) { return /^de([-_]|$)/i.test(v.lang); }); } catch (e) { VOICES = []; } return VOICES; }
  if (TTS) { loadVoices(); try { TTS.addEventListener('voiceschanged', function () { loadVoices(); fillVoices(); }); } catch (e) { } }
  function voiceScore(v) { var n = v.name || ''; return (/natural|neural|online|premium|enhanced|siri/i.test(n) ? 8 : 0) + (/google/i.test(n) ? 4 : 0) + (/de-DE/i.test(v.lang) ? 2 : 0) + (/anna|helena|markus|petra|yannick|katja|conrad|seraphina|florian|amala|killian/i.test(n) ? 1 : 0); }
  function pickVoice() {
    if (!VOICES.length) loadVoices();
    for (var i = 0; i < VOICES.length; i++) if (VOICES[i].voiceURI === CFG.voice) return VOICES[i];
    return VOICES.slice().sort(function (a, b) { return voiceScore(b) - voiceScore(a); })[0] || null;
  }
  var TICK_NAMES = { NVDA: 'Nvidia', AAPL: 'Apple', MSFT: 'Microsoft', AMZN: 'Amazon', GOOGL: 'Alphabet', GOOG: 'Alphabet', META: 'Meta', TSLA: 'Tesla', AVGO: 'Broadcom', PLTR: 'Palantir', NFLX: 'Netflix', INTC: 'Intel', TSM: 'TSMC' };
  function forSpeech(t) {
    return String(t || '')
      .replace(/\*\*|__|`|^#+\s*/gm, '').replace(/https?:\/\/\S+/g, '').replace(/^\s*[-•*]\s+/gm, '')
      .replace(/\bXAU\/USD\b/g, 'Gold').replace(/\bXAG\/USD\b/g, 'Silber').replace(/\bBTC\/USD\b/g, 'Bitcoin').replace(/\bETH\/USD\b/g, 'Ether')
      .replace(/\bEUR\/USD\b/g, 'Euro-Dollar').replace(/\bUSD\/JPY\b/g, 'Dollar-Yen').replace(/\bGBP\/USD\b/g, 'Pfund-Dollar')
      .replace(/\b(NVDA|AAPL|MSFT|AMZN|GOOGL|GOOG|META|TSLA|AVGO|PLTR|NFLX|INTC|TSM)\b/g, function (m) { return TICK_NAMES[m] || m; })
      .replace(/\bMag ?7\b/gi, 'Mag Seven').replace(/\$\s?(\d[\d.,]*)/g, '$1 Dollar').replace(/\s?\$/g, ' Dollar').replace(/(\d)\s?€/g, '$1 Euro').replace(/€\s?(\d[\d.,]*)/g, '$1 Euro')
      .replace(/(\d)\s?%/g, '$1 Prozent').replace(/(^|[\s(])\+(?=\d)/g, '$1plus ').replace(/(^|[\s(])[-−](?=\d)/g, '$1minus ').replace(/[()]/g, ', ').replace(/→|->|⇒/g, ', ').replace(/\s+,/g, ',').replace(/,(\s*,)+/g, ',').replace(/,\s*([.!?])/g, '$1').replace(/[▲▼↑↓↕]/g, '').replace(/\s+/g, ' ').trim();
  }
  function sentences(t) {
    var out = [], parts = t.match(/[^.!?…]+[.!?…]+["“”»]?|[^.!?…]+$/g) || [t];
    parts.forEach(function (p) { p = p.trim(); if (!p) return; if (out.length && (out[out.length - 1].length < 40 || p.length < 12)) out[out.length - 1] += ' ' + p; else out.push(p); });
    return out;
  }
  function stopSpeak() { if (TTS) { try { TTS.cancel(); } catch (e) { } } if (SPEAK_END) { var f = SPEAK_END; SPEAK_END = null; f(); } }
  function speak(text) {
    return new Promise(function (resolve) {
      if (!TTS || !CFG.speak || !text) return resolve();
      try { TTS.cancel(); } catch (e) { }
      var parts = sentences(forSpeech(text)), v = pickVoice(), i = 0, done = false, wd = 0;
      function fin() { if (done) return; done = true; clearTimeout(wd); UTTS = []; if (SPEAK_END === fin) SPEAK_END = null; resolve(); }
      SPEAK_END = fin;
      function next() {
        clearTimeout(wd);
        if (done) return;
        if (i >= parts.length) return fin();
        var txt = parts[i++], u = new SpeechSynthesisUtterance(txt);
        u.lang = v ? v.lang : 'de-DE'; try { if (v) u.voice = v; } catch (e) { } u.rate = CFG.rate; u.pitch = 1;
        u.onboundary = function () { bump(0.32); };
        u.onend = next;
        u.onerror = function (e) { if (e && (e.error === 'interrupted' || e.error === 'canceled')) fin(); else next(); };
        UTTS.push(u); // Chrome verliert sonst manchmal das onend-Ereignis
        // Sicherheitsnetz, falls der Browser kein Ende meldet
        wd = setTimeout(next, Math.max(4000, txt.split(' ').length * 650 / (CFG.rate || 1) + 2500));
        try { TTS.speak(u); } catch (e) { next(); }
      }
      next();
    });
  }
  function unlockTTS() { if (!TTS || unlockTTS.done) return; unlockTTS.done = true; try { var u = new SpeechSynthesisUtterance(' '); u.volume = 0; TTS.speak(u); } catch (e) { } }

  /* ---------- Oberfläche ---------- */
  var I = {
    mic: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/></svg>',
    stop: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2.2" fill="currentColor"/></svg>',
    gear: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></svg>',
    min: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
    max: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>',
    x: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    send: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>'
  };
  var CSS = [
    '.mv-fab{position:fixed;right:max(24px,calc(env(safe-area-inset-right,0px) + 6px));bottom:calc(max(18px,env(safe-area-inset-bottom,0px)) + 70px);z-index:950;width:46px;height:46px;border-radius:50%;border:1px solid rgba(110,150,255,.55);background:radial-gradient(circle at 35% 30%,#1b2f6b,#0a1230 70%);color:#cfe0ff;display:grid;place-items:center;cursor:pointer;box-shadow:0 10px 26px -10px rgba(40,90,255,.9),0 0 22px -8px #4f8cff;transition:transform .2s,box-shadow .2s;font-family:Inter,system-ui,sans-serif}',
    '.mv-fab:hover,.mv-fab:focus-visible{transform:translateY(-2px) scale(1.05);outline:none;box-shadow:0 0 0 3px rgba(79,140,255,.35),0 14px 30px -10px rgba(40,90,255,1)}',
    '.mv-fab svg{width:22px;height:22px}',
    '.mv-fab .mv-tip{position:absolute;right:56px;top:50%;white-space:nowrap;font:700 .78rem Inter,system-ui,sans-serif;padding:7px 11px;border-radius:99px;background:#0b1430;border:1px solid #1b2649;color:#eaf0ff;opacity:0;transform:translate(6px,-50%);transition:opacity .2s,transform .2s;pointer-events:none}',
    '.mv-fab:hover .mv-tip,.mv-fab:focus-visible .mv-tip{opacity:1;transform:translate(0,-50%)}',
    'html.gd-open .mv-fab,html.mv-on .mv-fab{display:none}',
    '@media (max-width:699px){html.mv-open,html.mv-open body{overflow:hidden}}',
    '.gd-mic{width:42px;height:42px;flex:none;border-radius:12px;border:1px solid #1b2649;background:rgba(63,125,255,.1);color:#8fb4ff;display:grid;place-items:center;cursor:pointer}',
    '.gd-mic:hover,.gd-mic:focus-visible{border-color:#4a86ff;color:#fff;outline:none}',
    '.gd-mic svg{width:20px;height:20px}',
    '.mv{position:fixed;inset:0;z-index:990;display:grid;grid-template-columns:minmax(0,1fr);grid-template-rows:auto 1fr auto auto auto;font-family:Inter,system-ui,sans-serif;color:#eaf0ff;background:radial-gradient(70% 55% at 50% 38%,rgba(37,86,230,.22),transparent 70%),radial-gradient(120% 80% at 50% 120%,rgba(16,40,120,.5),transparent 60%),rgba(2,4,10,.97);padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px);animation:mvIn .35s cubic-bezier(.2,.8,.2,1);overflow:hidden}',
    '.mv[hidden]{display:none}',
    '.mv,.mv *,.mv *::before,.mv *::after{box-sizing:border-box}',
    '@supports (backdrop-filter:blur(4px)){.mv{background:radial-gradient(70% 55% at 50% 38%,rgba(37,86,230,.22),transparent 70%),radial-gradient(120% 80% at 50% 120%,rgba(16,40,120,.5),transparent 60%),rgba(2,4,10,.9);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px)}}',
    '@keyframes mvIn{from{opacity:0;transform:scale(.985)}to{opacity:1;transform:none}}',
    '.mv-top{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 16px}',
    '.mv-brand{display:flex;align-items:center;gap:10px;min-width:0}',
    '.mv-logo{width:34px;height:34px;border-radius:50%;overflow:hidden;flex:none;background:#000;box-shadow:0 0 0 1px rgba(110,150,255,.4),0 0 16px -4px rgba(63,125,255,.8)}',
    '.mv-logo img{width:100%;height:100%;object-fit:cover;display:block}',
    '.mv-brand b{display:block;font:800 1rem Montserrat,Inter,sans-serif;letter-spacing:.06em}',
    '.mv-brand small{display:flex;align-items:center;gap:6px;color:#8d98c0;font-size:.74rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.mv-brand small i{width:7px;height:7px;border-radius:50%;background:#8d98c0;flex:none}',
    '.mv-brand small.on i{background:#34d399;box-shadow:0 0 8px #34d399}',
    '.mv-brand small.cmd i{background:#e8bd62}',
    '.mv-acts{display:flex;gap:6px}',
    '.mv-ib{width:38px;height:38px;border-radius:11px;border:1px solid #1b2649;background:rgba(9,14,29,.6);color:#8d98c0;display:grid;place-items:center;cursor:pointer}',
    '.mv-ib:hover,.mv-ib:focus-visible,.mv-ib[aria-expanded="true"]{color:#fff;border-color:#4a86ff;outline:none}',
    '.mv-setp{position:absolute;top:calc(env(safe-area-inset-top,0px) + 62px);right:16px;z-index:2;width:min(340px,calc(100vw - 32px));display:grid;gap:12px;padding:16px;border-radius:16px;border:1px solid #243062;background:#090e1d;box-shadow:0 24px 60px -20px #000;font-size:.88rem}',
    '.mv-setp[hidden]{display:none}',
    '.mv-setp label{display:grid;gap:6px;font-weight:600}',
    '.mv-setp label.ck{display:flex;align-items:flex-start;gap:10px;font-weight:500;line-height:1.4}',
    '.mv-setp input[type=checkbox]{width:18px;height:18px;margin:1px 0 0;accent-color:#3f7dff;flex:none}',
    '.mv-setp select{font:500 .9rem Inter,system-ui,sans-serif;padding:9px 10px;border-radius:10px;border:1px solid #1b2649;background:#050812;color:#eaf0ff;max-width:100%}',
    '.mv-setp .row{display:flex;gap:8px;flex-wrap:wrap}',
    '.mv-setp button{font:600 .82rem Inter,system-ui,sans-serif;padding:8px 12px;border-radius:10px;border:1px solid #1b2649;background:rgba(63,125,255,.1);color:#cfe0ff;cursor:pointer}',
    '.mv-setp p{margin:0;color:#8d98c0;font-size:.76rem;line-height:1.5}',
    '.mv-stage{display:grid;place-items:center;align-content:center;gap:14px;min-height:0;padding:0 16px}',
    '.mv-orb{width:min(70vw,300px,38vh);height:min(70vw,300px,38vh);border-radius:50%;border:0;padding:0;background:none;cursor:pointer;position:relative;-webkit-tap-highlight-color:transparent}',
    '.mv-orb:focus-visible{outline:2px solid #4a86ff;outline-offset:6px}',
    '.mv-orb canvas{width:100%;height:100%;display:block}',
    '.mv-state{margin:0;font:700 .78rem Inter,system-ui,sans-serif;letter-spacing:.16em;text-transform:uppercase;color:#8fb4ff;text-align:center;min-height:1.2em}',
    '.mv.s-listen .mv-state{color:#7ee0ff}.mv.s-err .mv-state{color:#ff6b7a}',
    '.mv-talk{width:min(640px,100%);margin:0 auto;padding:4px 18px 8px;display:grid;gap:10px;max-height:34vh;overflow-y:auto;overscroll-behavior:contain;text-align:center}',
    '.mv-you{margin:0;color:#8d98c0;font-size:.95rem;line-height:1.45;min-height:1.4em}',
    '.mv-you.live{color:#cfe0ff}',
    '.mv-you b{color:#5d6b8f;font-weight:600;margin-right:4px}',
    '.mv-ans{font:600 clamp(1.05rem,2.6vw,1.3rem)/1.5 Inter,system-ui,sans-serif;color:#eaf0ff;min-height:0}',
    '.mv-ans:empty{display:none}',
    '.mv-ans .hint{font-weight:500;font-size:.95rem;color:#8d98c0}',
    '.mv-sg{display:flex;flex-wrap:wrap;gap:8px;justify-content:center}',
    '.mv-sg:empty{display:none}',
    '.mv-sg button{font:600 .82rem Inter,system-ui,sans-serif;padding:9px 13px;border-radius:99px;border:1px solid #243062;background:rgba(9,14,29,.7);color:#cfe0ff;cursor:pointer}',
    '.mv-sg button:hover,.mv-sg button:focus-visible{border-color:#4a86ff;outline:none;color:#fff}',
    '.mv-bot{display:flex;gap:10px;align-items:center;width:min(640px,100%);margin:0 auto;padding:8px 16px 6px}',
    '.mv-type{flex:1;display:flex;gap:6px;min-width:0}',
    '.mv-type input{flex:1;min-width:0;font:500 1rem Inter,system-ui,sans-serif;padding:12px 14px;border-radius:14px;border:1px solid #1b2649;background:rgba(5,8,18,.75);color:#eaf0ff}',
    '.mv-type input:focus{outline:none;border-color:#4a86ff}',
    '.mv-type button{width:46px;flex:none;border-radius:14px;border:1px solid #1b2649;background:rgba(9,14,29,.7);color:#8fb4ff;display:grid;place-items:center;cursor:pointer}',
    '.mv-mic{width:58px;height:58px;flex:none;border-radius:50%;border:1px solid #4a86ff;background:linear-gradient(135deg,#2556e6,#4a86ff);color:#fff;display:grid;place-items:center;cursor:pointer;box-shadow:0 12px 30px -10px rgba(40,90,255,1),0 0 26px -6px #4f8cff;transition:transform .15s}',
    '.mv-mic:active{transform:scale(.95)}.mv-mic:focus-visible{outline:2px solid #fff;outline-offset:3px}',
    '.mv.s-listen .mv-mic,.mv.s-think .mv-mic,.mv.s-speak .mv-mic{background:linear-gradient(135deg,#1a2a5c,#24408f)}',
    '.mv-mic[hidden]{display:none}',
    '.mv-foot{margin:0;padding:2px 16px 12px;text-align:center;font-size:.68rem;color:#5d6b8f}',
    /* kompakte Ansicht: Seite bleibt sichtbar */
    '.mv.mini{inset:auto max(12px,env(safe-area-inset-right,0px)) max(12px,env(safe-area-inset-bottom,0px)) auto;width:min(460px,calc(100vw - 24px));grid-template-columns:74px minmax(0,1fr);grid-template-rows:auto auto auto;grid-template-areas:"top top" "stage talk" "bot bot";border-radius:20px;border:1px solid rgba(90,130,255,.35);background:radial-gradient(100% 70% at 0% 0%,rgba(40,90,255,.2),transparent 60%),rgba(6,11,25,.97);box-shadow:0 30px 80px -20px rgba(0,0,0,.9),0 0 50px -20px rgba(63,125,255,.7);padding:0 0 4px}',
    '.mv.mini .mv-top{grid-area:top;padding:10px 10px 4px 14px}',
    '.mv.mini .mv-logo{width:26px;height:26px}.mv.mini .mv-brand b{font-size:.86rem}.mv.mini .mv-ib{width:32px;height:32px}',
    '.mv.mini .mv-stage{grid-area:stage;padding:0 0 0 12px;align-content:start}',
    '.mv.mini .mv-orb{width:62px;height:62px}',
    '.mv.mini .mv-state{display:none}',
    '.mv.mini .mv-talk{grid-area:talk;text-align:left;max-height:26vh;padding:2px 14px 4px 10px;gap:4px}',
    '.mv.mini .mv-ans{font-size:.95rem}.mv.mini .mv-you{font-size:.82rem}',
    '.mv.mini .mv-sg,.mv.mini .mv-foot{display:none}',
    '.mv.mini .mv-bot{grid-area:bot;padding:6px 12px 8px}',
    '.mv.mini .mv-mic{width:46px;height:46px}',
    '.mv.mini .mv-type input{padding:10px 12px;font-size:.95rem}',
    '.mv.mini .mv-setp{top:52px;right:10px}',
    '@media (max-width:699px){.mv-fab{bottom:calc(76px + 54px + 14px + env(safe-area-inset-bottom,0px));right:max(22px,calc(env(safe-area-inset-right,0px) + 4px))}.mv.mini{bottom:calc(80px + env(safe-area-inset-bottom,0px));left:max(8px,env(safe-area-inset-left,0px));right:max(8px,env(safe-area-inset-right,0px));width:auto}}',
    '@media (max-width:560px){.mv-fab .mv-tip{display:none}}',
    '@media (max-height:560px){.mv-orb{width:min(40vh,220px);height:min(40vh,220px)}.mv-talk{max-height:28vh}}',
    '@media (prefers-reduced-motion:reduce){.mv{animation:none}.mv-fab,.mv-mic{transition:none}}'
  ].join('\n');
  var st = document.createElement('style'); st.id = 'mv-css'; st.textContent = CSS; document.head.appendChild(st);

  var fab = document.createElement('button');
  fab.type = 'button'; fab.id = 'mv-fab'; fab.className = 'mv-fab';
  fab.setAttribute('aria-label', 'MFX Voice: per Stimme fragen');
  fab.innerHTML = I.mic + '<span class="mv-tip">Per Stimme fragen</span>';
  document.body.appendChild(fab);

  var root = document.createElement('div');
  root.id = 'mv'; root.className = 'mv s-idle'; root.hidden = true;
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'MFX Voice, Sprachmodus');
  root.innerHTML =
    '<div class="mv-top"><div class="mv-brand"><span class="mv-logo" id="mv-logo"></span><div><b>MFX VOICE</b><small id="mv-mode"><i></i><span>Prüft …</span></small></div></div>' +
    '<div class="mv-acts"><button type="button" class="mv-ib" id="mv-set" aria-label="Einstellungen" aria-expanded="false" title="Einstellungen">' + I.gear + '</button>' +
    '<button type="button" class="mv-ib" id="mv-min" aria-label="Verkleinern" title="Verkleinern">' + I.min + '</button>' +
    '<button type="button" class="mv-ib" id="mv-x" aria-label="Sprachmodus schließen" title="Schließen">' + I.x + '</button></div></div>' +
    '<div class="mv-setp" id="mv-setp" hidden>' +
    '<label>Stimme<select id="mv-voice"></select></label>' +
    '<label>Tempo<select id="mv-rate"><option value="0.95">Ruhig</option><option value="1.05">Normal</option><option value="1.2">Schnell</option></select></label>' +
    '<label class="ck"><input type="checkbox" id="mv-speak"><span>Antworten vorlesen</span></label>' +
    '<label class="ck"><input type="checkbox" id="mv-talkm"><span>Gesprächsmodus: nach der Antwort automatisch weiter zuhören</span></label>' +
    '<div class="row"><button type="button" id="mv-test">Stimme testen</button><button type="button" id="mv-clear">Verlauf löschen</button></div>' +
    '<p>Die Spracherkennung macht dein Browser (Chrome über Google, Safari über Apple). Deine Frage geht als Text an die KI der Seite. Audio wird nicht gespeichert.</p></div>' +
    '<div class="mv-stage"><button type="button" class="mv-orb" id="mv-orb" aria-label="Sprechen"><canvas id="mv-cv" aria-hidden="true"></canvas></button><p class="mv-state" id="mv-state" aria-live="polite"></p></div>' +
    '<div class="mv-talk" id="mv-talk"><p class="mv-you" id="mv-you"></p><div class="mv-ans" id="mv-ans" aria-live="polite"></div><div class="mv-sg" id="mv-sg"></div></div>' +
    '<div class="mv-bot"><form class="mv-type" id="mv-type" autocomplete="off"><input id="mv-in" maxlength="500" placeholder="Oder hier tippen …" aria-label="Frage eintippen" enterkeyhint="send"><button type="submit" aria-label="Senden">' + I.send + '</button></form>' +
    '<button type="button" class="mv-mic" id="mv-mic" aria-label="Sprechen">' + I.mic + '</button></div>' +
    '<p class="mv-foot">KI kann sich irren · keine Anlageberatung</p>';
  document.body.appendChild(root);
  try { var lg = document.querySelector('.brand img.logo'); if (lg) $('mv-logo').appendChild(lg.cloneNode(false)); } catch (e) { }
  if (!SR) $('mv-mic').hidden = true;

  /* ---------- Orb (Canvas) ---------- */
  var CV = $('mv-cv'), CX = CV.getContext ? CV.getContext('2d') : null, RAF = 0, EN = 0.2, BUMP = 0, ROT = 0, LASTT = 0;
  function bump(v) { BUMP = Math.min(0.6, BUMP + v); }
  function arc(x, cx, cy, r, a0, len, w, col) { x.beginPath(); x.strokeStyle = col; x.lineWidth = w; x.lineCap = 'round'; x.arc(cx, cy, r, a0, a0 + len); x.stroke(); }
  function draw(t) {
    if (!CX) return;
    var dpr = Math.min(2, window.devicePixelRatio || 1), w = CV.clientWidth, h = CV.clientHeight;
    if (!w || !h) return;
    if (CV.width !== Math.round(w * dpr) || CV.height !== Math.round(h * dpr)) { CV.width = Math.round(w * dpr); CV.height = Math.round(h * dpr); }
    var x = CX; x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, w, h);
    var dt = LASTT ? Math.min(50, t - LASTT) : 16; LASTT = t;
    var S = STATE, tgt = S === 'listen' ? 0.5 : S === 'speak' ? 0.48 : S === 'think' ? 0.3 : 0.16;
    if (S === 'speak' && !RM) tgt += 0.22 * Math.abs(Math.sin(t / 130) * Math.sin(t / 340));
    EN += (tgt + BUMP - EN) * 0.09; BUMP *= 0.9;
    var sp = RM ? 0.15 : S === 'think' ? 3 : S === 'listen' ? 1.3 : S === 'speak' ? 1 : 0.45;
    ROT += 0.0011 * sp * dt;
    var cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2, err = S === 'err';
    var C1 = err ? '255,107,122' : '79,140,255', C2 = err ? '255,170,180' : '143,180,255';
    // Skala außen
    var n = R > 60 ? 72 : 36;
    x.save(); x.translate(cx, cy); x.rotate(ROT * 0.25);
    for (var i = 0; i < n; i++) {
      var a = i / n * Math.PI * 2, lg = i % 6 === 0, r1 = R * 0.95, r2 = R * (lg ? 0.87 : 0.905);
      x.strokeStyle = 'rgba(' + C2 + ',' + (lg ? 0.55 : 0.2) + ')'; x.lineWidth = lg ? 1.6 : 1;
      x.beginPath(); x.moveTo(Math.cos(a) * r1, Math.sin(a) * r1); x.lineTo(Math.cos(a) * r2, Math.sin(a) * r2); x.stroke();
    }
    x.restore();
    // Bögen
    var lw = Math.max(1.5, R * 0.022);
    arc(x, cx, cy, R * 0.8, ROT * 1.5, 1.2, lw, 'rgba(' + C1 + ',.95)');
    arc(x, cx, cy, R * 0.8, ROT * 1.5 + Math.PI, 0.55, lw, 'rgba(' + C1 + ',.6)');
    arc(x, cx, cy, R * 0.71, -ROT * 2.1, 0.9, lw * 0.6, 'rgba(' + C2 + ',.55)');
    arc(x, cx, cy, R * 0.71, -ROT * 2.1 + 2.6, 0.35, lw * 0.6, 'rgba(' + C2 + ',.4)');
    x.beginPath(); x.strokeStyle = 'rgba(' + C2 + ',.12)'; x.lineWidth = 1; x.arc(cx, cy, R * 0.8, 0, Math.PI * 2); x.stroke();
    // Kern
    var cr = R * (0.33 + EN * 0.13 + (RM ? 0 : Math.sin(t / 700) * 0.008));
    var g = x.createRadialGradient(cx, cy, cr * 0.2, cx, cy, cr * 2);
    g.addColorStop(0, 'rgba(' + C2 + ',.55)'); g.addColorStop(0.45, 'rgba(' + C1 + ',.28)'); g.addColorStop(1, 'rgba(' + C1 + ',0)');
    x.fillStyle = g; x.beginPath(); x.arc(cx, cy, cr * 2, 0, Math.PI * 2); x.fill();
    // Schallwellen um den Kern
    if ((S === 'listen' || S === 'speak') && !RM) {
      var m = 56;
      for (var j = 0; j < m; j++) {
        var b = j / m * Math.PI * 2, amp = 0.05 + EN * 0.42 * (0.35 + 0.65 * Math.abs(Math.sin(j * 1.7 + t / 170) * Math.cos(j * 0.6 - t / 260)));
        var q1 = cr * 1.16, q2 = cr * (1.16 + amp);
        x.strokeStyle = 'rgba(' + C2 + ',.55)'; x.lineWidth = Math.max(1.2, R * 0.012); x.lineCap = 'round';
        x.beginPath(); x.moveTo(cx + Math.cos(b) * q1, cy + Math.sin(b) * q1); x.lineTo(cx + Math.cos(b) * q2, cy + Math.sin(b) * q2); x.stroke();
      }
    }
    var g2 = x.createRadialGradient(cx - cr * 0.32, cy - cr * 0.36, cr * 0.05, cx, cy, cr);
    if (err) { g2.addColorStop(0, '#ffe3e6'); g2.addColorStop(0.3, '#ff9aa5'); g2.addColorStop(0.7, '#e5465a'); g2.addColorStop(1, '#8c1b2c'); }
    else { g2.addColorStop(0, '#f2f7ff'); g2.addColorStop(0.25, '#9cc0ff'); g2.addColorStop(0.65, '#3f7dff'); g2.addColorStop(1, '#173aa8'); }
    x.fillStyle = g2; x.beginPath(); x.arc(cx, cy, cr, 0, Math.PI * 2); x.fill();
    if (S === 'think' && !RM) arc(x, cx, cy, cr * 1.18, ROT * 4, 1.6, lw * 0.8, 'rgba(' + C2 + ',.8)');
  }
  function loop(t) { draw(t); RAF = requestAnimationFrame(loop); }
  function startLoop() { if (!RAF && CX) RAF = requestAnimationFrame(loop); }
  function stopLoop() { if (RAF) cancelAnimationFrame(RAF); RAF = 0; LASTT = 0; }

  /* ---------- Zustand ---------- */
  var STATE = 'idle', OPEN = false, REC = null, RUN = null, MODE_AI = null, NOSPEECH = 0, SEQ = 0;
  var LABEL = { idle: SR ? 'Tippe auf den Kreis und sprich' : 'Tippe deine Frage unten ein', listen: 'Ich höre zu …', think: 'Denke nach …', speak: 'Spricht …', err: 'Hoppla' };
  function setState(s, label) {
    STATE = s;
    root.className = root.className.replace(/\bs-\w+/g, '').trim() + ' s-' + s;
    $('mv-state').textContent = label || LABEL[s] || '';
    var mic = $('mv-mic'), busy = s === 'listen' || s === 'think' || s === 'speak';
    mic.innerHTML = busy ? I.stop : I.mic;
    var lab = s === 'listen' ? 'Zuhören beenden' : s === 'think' ? 'Abbrechen' : s === 'speak' ? 'Unterbrechen und sprechen' : 'Sprechen';
    mic.setAttribute('aria-label', lab); $('mv-orb').setAttribute('aria-label', lab);
  }
  function status(s) { if (OPEN && STATE === 'think') $('mv-state').textContent = s; }
  function showYou(t, fin) { var e = $('mv-you'); e.className = 'mv-you' + (fin ? '' : ' live'); e.innerHTML = t ? '<b>Du:</b>' + esc(t) : ''; }
  function showAns(t, hint) { $('mv-ans').innerHTML = t ? (hint ? '<span class="hint">' + esc(t) + '</span>' : esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n+/g, '<br>')) : ''; var tk = $('mv-talk'); tk.scrollTop = tk.scrollHeight; }
  var SUG_AI = ['Wie steht Nvidia?', 'Was sagt die Zentrale zu Gold?', 'Welche Termine sind diese Woche wichtig?', 'Wie läuft mein Trading?', 'Öffne den Kalender'];
  var SUG_CMD = ['Wie steht Nvidia?', 'Wie steht Gold?', 'Bitcoin', 'Öffne den Kalender', 'Zeig mir die News'];
  function showSug(on) { $('mv-sg').innerHTML = on ? (MODE_AI ? SUG_AI : SUG_CMD).map(function (s) { return '<button type="button" data-q="' + esc(s) + '">' + esc(s) + '</button>'; }).join('') : ''; }
  function setModeLabel() {
    var m = $('mv-mode');
    m.className = MODE_AI ? 'on' : MODE_AI === false ? 'cmd' : '';
    m.querySelector('span').textContent = MODE_AI ? 'KI aktiv · Live-Kurse' : MODE_AI === false ? 'Befehlsmodus · KI noch nicht eingerichtet' : 'Prüft …';
  }
  function setMini(on) {
    root.classList.toggle('mini', !!on);
    H.classList.toggle('mv-open', !on);
    root.setAttribute('aria-modal', on ? 'false' : 'true');
    var b = $('mv-min'); b.innerHTML = on ? I.max : I.min; b.setAttribute('aria-label', on ? 'Vergrößern' : 'Verkleinern'); b.title = on ? 'Vergrößern' : 'Verkleinern';
  }

  /* ---------- Spracherkennung ---------- */
  function micErr(code) {
    if (code === 'not-allowed' || code === 'service-not-allowed') return 'Ich darf dein Mikrofon nicht nutzen. Erlaube den Mikrofon-Zugriff für diese Seite (Schloss-Symbol neben der Adresse). Auf dem iPhone muss außerdem Diktieren eingeschaltet sein. Du kannst die Frage auch unten eintippen.';
    if (code === 'audio-capture') return 'Ich finde kein Mikrofon. Schließ eins an oder tippe deine Frage unten ein.';
    if (code === 'network') return 'Die Spracherkennung braucht eine Internetverbindung. Du kannst die Frage auch unten eintippen.';
    if (code === 'language-not-supported') return 'Dein Browser erkennt kein Deutsch. Tippe deine Frage unten ein.';
    return 'Die Spracherkennung hat nicht geklappt. Tippe noch einmal auf den Kreis.';
  }
  function stopRec(abort) { var r = REC; if (!r) return; try { abort ? r.abort() : r.stop(); } catch (e) { } if (abort) REC = null; }
  function listen(auto) {
    if (!OPEN) return;
    if (!SR) { setState('idle'); showAns('Spracheingabe kann dieser Browser nicht. Tippe deine Frage unten ein. Mit Chrome, Edge oder Safari kannst du auch sprechen.', true); try { $('mv-in').focus(); } catch (e) { } return; }
    stopSpeak(); cancelRun(); stopRec(true);
    var r = new SR(), fin = '', tmp = '', err = '', silence = 0, my = ++SEQ;
    REC = r;
    try { r.lang = 'de-DE'; r.interimResults = true; r.continuous = false; r.maxAlternatives = 1; } catch (e) { }
    r.onstart = function () { if (REC === r) setState('listen'); };
    r.onresult = function (e) {
      if (REC !== r) return;
      var f = '', t = '';
      for (var i = 0; i < e.results.length; i++) { var res = e.results[i]; if (res && res[0]) { if (res.isFinal) f += res[0].transcript; else t += res[0].transcript; } }
      fin = f; tmp = t; showYou((f + ' ' + t).trim(), !t); bump(0.28);
      clearTimeout(silence);
      silence = setTimeout(function () { if (REC === r) { try { r.stop(); } catch (x) { } } }, f && !t ? 900 : 2200);
    };
    r.onerror = function (e) { err = e && e.error || 'error'; };
    r.onend = function () {
      clearTimeout(silence);
      if (REC !== r || my !== SEQ) return;
      REC = null;
      var said = (fin || tmp).trim();
      if (said) { NOSPEECH = 0; handle(said); return; }
      if (err === 'aborted') { setState('idle'); return; }
      if (err && err !== 'no-speech') { setState('err', 'Mikrofon'); showAns(micErr(err), true); return; }
      NOSPEECH++;
      if (auto) { setState('idle', 'Tippe zum Weitersprechen'); return; }
      setState('idle');
      showAns('Ich habe nichts gehört. Tippe auf den Kreis und sprich.', true);
    };
    try { r.start(); setState('listen'); if (!auto) { showYou('', true); showAns(''); } }
    catch (e) { REC = null; setState('idle'); showAns(auto ? 'Tippe auf den Kreis, um weiterzusprechen.' : 'Das Mikrofon konnte nicht starten. Tippe noch einmal auf den Kreis.', true); }
  }

  /* ---------- Ablauf einer Frage ---------- */
  function cancelRun() { if (RUN) { try { RUN.abort(); } catch (e) { } RUN = null; } }
  function handle(text) {
    text = String(text || '').trim();
    if (!text || !OPEN) return;
    stopRec(true); stopSpeak(); cancelRun();
    showYou(text, true); showAns(''); showSug(false);
    var ctl = new AbortController(); RUN = ctl;
    setState('think');
    var cmd = parseCmd(text), nav = false, end = false, failed = false;
    var p;
    if (cmd && cmd.type === 'stop') { RUN = null; setState('idle'); return; }
    if (cmd && cmd.type === 'bye') { end = true; p = Promise.resolve(pick(['Gern. Ich bin da, wenn du mich brauchst.', 'Immer gern.', 'Jederzeit. Viel Erfolg beim Traden.'])); }
    else if (cmd && cmd.type === 'quote') { status('Holt den Live-Kurs …'); p = quote(cmd.sym).then(function (q) { return quoteSentence(q, cmd.label); }); }
    else if (cmd && cmd.type === 'nav') { p = Promise.resolve().then(function () { navTo(cmd); nav = true; return 'Hier ' + (cmd.pl ? 'sind ' : 'ist ') + cmd.label + '.'; }); }
    else {
      p = getSample().then(function (s) {
        MODE_AI = !!s; setModeLabel();
        if (!s) return noAI(text);
        return askAI(s, text, ctl.signal).then(function (r) { nav = r.nav; return r.text || 'Dazu habe ich gerade keine Antwort.'; }, function (e) {
          var c = e && e.code;
          if (c === 'cancelled') throw e;
          if (c === 'capability_disabled') { SMP = null; MODE_AI = false; setModeLabel(); return noAI(text); }
          failed = true; return (e && e.text ? String(e.text).trim() + ' ' : '') + aiErr(c);
        });
      });
    }
    p.then(function (ans) { return ans; }, function (e) {
      if (ctl.signal.aborted || (e && e.code === 'cancelled')) throw { code: 'cancelled' };
      failed = true; return errMsgOf(e);
    }).then(function (ans) {
      if (RUN !== ctl || !OPEN) return;
      RUN = null;
      ans = String(ans || '').trim();
      HIST.push({ role: 'user', content: text }, { role: 'assistant', content: ans }); saveHist();
      showAns(ans, false);
      if (nav && !root.classList.contains('mini')) setMini(true);
      if (failed) setState('err', 'Hinweis'); else setState('speak');
      var my = ++SEQ;
      return speak(ans).then(function () {
        if (!OPEN || my !== SEQ || STATE === 'listen') return;
        if (end) { setState('idle'); setTimeout(function () { if (OPEN && my === SEQ) close(); }, 700); return; }
        if (CFG.talk && !end && !failed && SR && !document.hidden) listen(true);
        else setState('idle');
      });
    }).catch(function (e) { if (RUN === ctl) RUN = null; if (e && e.code === 'cancelled') { if (OPEN && STATE === 'think') setState('idle'); return; } if (OPEN) { setState('err', 'Hinweis'); showAns(errMsgOf(e), true); } });
  }

  /* ---------- Öffnen und Schließen ---------- */
  var LASTFOCUS = null;
  function open(listenNow) {
    if (window.mfxGuide && window.mfxGuide.close) { try { window.mfxGuide.close(); } catch (e) { } }
    if (!OPEN) {
      OPEN = true; LASTFOCUS = document.activeElement;
      root.hidden = false; H.classList.add('mv-on'); setMini(false); startLoop();
      setState('idle');
      if (!HIST.length) { showYou('', true); showAns(''); }
      else { var la = HIST[HIST.length - 1]; showYou(HIST[HIST.length - 2] ? HIST[HIST.length - 2].content : '', true); showAns(la.content); }
      showSug(!HIST.length);
      setModeLabel();
      getSample().then(function (s) { MODE_AI = !!s; setModeLabel(); if (!HIST.length && STATE !== 'think') showSug(true); });
      try { $('mv-orb').focus({ preventScroll: true }); } catch (e) { }
    }
    unlockTTS();
    if (listenNow && SR) listen(false);
    else if (!SR) setTimeout(function () { try { $('mv-in').focus(); } catch (e) { } }, 60);
  }
  function close() {
    if (!OPEN) return;
    OPEN = false; SEQ++;
    stopRec(true); stopSpeak(); cancelRun();
    root.hidden = true; root.classList.remove('mini'); H.classList.remove('mv-open'); H.classList.remove('mv-on');
    $('mv-setp').hidden = true; $('mv-set').setAttribute('aria-expanded', 'false');
    stopLoop(); setState('idle');
    try { (LASTFOCUS && LASTFOCUS.focus ? LASTFOCUS : fab).focus({ preventScroll: true }); } catch (e) { }
  }
  function tapMain() {
    unlockTTS();
    if (STATE === 'listen') { stopRec(false); return; }
    if (STATE === 'think') { cancelRun(); setState('idle'); return; }
    if (STATE === 'speak') { SEQ++; stopSpeak(); listen(false); return; }
    listen(false);
  }

  /* ---------- Einstellungen ---------- */
  function fillVoices() {
    var sel = $('mv-voice'); if (!sel) return;
    var vs = VOICES.slice().sort(function (a, b) { return voiceScore(b) - voiceScore(a); });
    sel.innerHTML = '<option value="">' + (vs.length ? 'Automatisch (beste deutsche Stimme)' : (TTS ? 'Keine deutsche Stimme gefunden' : 'Sprachausgabe nicht verfügbar')) + '</option>' +
      vs.map(function (v) { return '<option value="' + esc(v.voiceURI) + '"' + (v.voiceURI === CFG.voice ? ' selected' : '') + '>' + esc(v.name) + (v.localService ? '' : ' (online)') + '</option>'; }).join('');
    sel.disabled = !vs.length;
  }
  function syncSettings() {
    fillVoices();
    var r = $('mv-rate'), best = '1.05', d = 9;
    [].forEach.call(r.options, function (o) { var x = Math.abs(parseFloat(o.value) - CFG.rate); if (x < d) { d = x; best = o.value; } });
    r.value = best;
    $('mv-speak').checked = !!CFG.speak; $('mv-talkm').checked = !!CFG.talk;
    $('mv-speak').disabled = !TTS; $('mv-talkm').disabled = !SR; $('mv-test').disabled = !TTS;
  }

  /* ---------- Ereignisse ---------- */
  fab.addEventListener('click', function () { open(true); });
  $('mv-x').addEventListener('click', close);
  $('mv-min').addEventListener('click', function () { setMini(!root.classList.contains('mini')); });
  $('mv-orb').addEventListener('click', tapMain);
  $('mv-mic').addEventListener('click', tapMain);
  $('mv-type').addEventListener('submit', function (e) { e.preventDefault(); var v = $('mv-in').value.trim(); if (!v) return; $('mv-in').value = ''; unlockTTS(); handle(v); });
  $('mv-sg').addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('[data-q]'); if (b) { unlockTTS(); handle(b.getAttribute('data-q')); } });
  $('mv-set').addEventListener('click', function () { var p = $('mv-setp'), on = p.hidden; if (on) { loadVoices(); syncSettings(); } p.hidden = !on; this.setAttribute('aria-expanded', on ? 'true' : 'false'); });
  $('mv-voice').addEventListener('change', function () { CFG.voice = this.value; saveCfg(); });
  $('mv-rate').addEventListener('change', function () { CFG.rate = parseFloat(this.value) || 1.05; saveCfg(); });
  $('mv-speak').addEventListener('change', function () { CFG.speak = this.checked; saveCfg(); if (!CFG.speak) stopSpeak(); });
  $('mv-talkm').addEventListener('change', function () { CFG.talk = this.checked; saveCfg(); });
  $('mv-test').addEventListener('click', function () { unlockTTS(); var was = CFG.speak; CFG.speak = true; speak('Systeme online. Ich bin MFX Voice. Frag mich nach Kursen, Terminen oder deinem Journal.').then(function () { CFG.speak = was; }); });
  $('mv-clear').addEventListener('click', function () { HIST = []; saveHist(); showYou('', true); showAns(''); showSug(true); });
  document.addEventListener('keydown', function (e) {
    if (!OPEN || e.key !== 'Escape') return;
    if (!$('mv-setp').hidden) { $('mv-setp').hidden = true; $('mv-set').setAttribute('aria-expanded', 'false'); return; }
    close();
  });
  document.addEventListener('visibilitychange', function () { if (document.hidden && OPEN) { stopRec(true); if (STATE === 'listen') setState('idle'); } });

  /* ---------- Mikrofon im MFX Guide ---------- */
  function wireGuide() {
    var f = document.getElementById('gd-f'), s = document.getElementById('gd-send');
    if (!f || !s || document.getElementById('gd-mic')) return;
    var b = document.createElement('button');
    b.type = 'button'; b.id = 'gd-mic'; b.className = 'gd-mic'; b.title = 'Per Stimme fragen';
    b.setAttribute('aria-label', 'MFX Voice starten: per Stimme fragen'); b.innerHTML = I.mic;
    b.addEventListener('click', function () { open(true); });
    f.insertBefore(b, s);
  }
  wireGuide();
  if (document.readyState !== 'complete') window.addEventListener('load', wireGuide);

  window.mfxVoice = { open: open, close: close, ask: function (t) { open(false); handle(t); }, parse: parseCmd, speech: forSpeech, state: function () { return { state: STATE, open: OPEN, mini: root.classList.contains('mini'), ai: MODE_AI, hist: HIST.slice() }; } };
})();
