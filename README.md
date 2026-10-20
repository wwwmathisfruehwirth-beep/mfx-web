# MFX Makro-Zentrale – Webseite für Freunde (Prototyp)

Die Makro-Zentrale samt Trading Journal als eigene Webseite. Deine Freunde melden sich mit E-Mail und Passwort an, ohne Claude-Konto.

**So ist es aufgebaut:**
- **Vercel** liefert die Seite aus und startet vier kleine Server-Funktionen (Ordner `api/`).
- **Supabase** übernimmt Login (nur mit Einladung) und speichert die Journale. Jeder sieht nur seine eigenen Daten.
- **Twelve Data, FMP und Parallel Search** liefern Kurse, Termine, Analysten und Suche, mit deinen eigenen Schlüsseln. Die Schlüssel liegen nur auf dem Server, nie im Browser.
- **Anthropic (Claude-API)** übernimmt Guide, News-Einordnung, Markt-Radar und Coach, mit einem Tageslimit pro Person.

Ein gemeinsamer Zwischenspeicher sorgt dafür, dass ein Kurs, den ein Freund gerade geladen hat, für alle anderen kurz wiederverwendet wird. Das schont die kostenlosen Abruf-Kontingente.

Für die Einrichtung brauchst du etwa 45–60 Minuten. Kosten: Vercel, Supabase, Twelve Data (Basic) und FMP (Free) sind kostenlos. Für die KI zahlst du bei Anthropic nach Verbrauch. Leg dort am besten ein Monatslimit fest.

---

## 1. Konten anlegen

| Dienst | Wofür | Adresse |
|---|---|---|
| GitHub | Hier liegt der Code | github.com |
| Vercel | Hostet die Seite (mit GitHub anmelden) | vercel.com |
| Supabase | Login und Datenbank | supabase.com |
| Twelve Data | Live-Kurse | twelvedata.com → API Key |
| Financial Modeling Prep | Termine, Analysten, Profile | financialmodelingprep.com → API Key |
| Parallel | Web-Suche für News und Markt-Radar | platform.parallel.ai → API Keys |
| Anthropic | KI-Funktionen | console.anthropic.com → API Keys (Guthaben aufladen, Limit setzen) |

Die Schlüssel kopierst du dir in eine Notiz. Sie sind geheim, also nie öffentlich teilen.

## 2. Supabase einrichten

1. **New project:** Name zum Beispiel `mfx`, Region **Frankfurt (eu-central-1)**. Das Datenbank-Passwort brauchst du nicht weiter.
2. Links auf **SQL Editor**. Den ganzen Inhalt von `supabase/schema.sql` einfügen und **Run** drücken. Danach steht „Success“ da.
3. **Authentication → Sign In / Providers → Email:** eingeschaltet lassen. Den Punkt **„Allow new users to sign up“ ausschalten**, damit nur eingeladene Personen hineinkommen.
4. **Project Settings → API Keys** (bzw. **Data API** für die URL): Diese drei Werte kopieren:
   - `Project URL` (https://….supabase.co) → wird zu `SUPABASE_URL`
   - `Publishable key` (beginnt mit `sb_publishable_`) oder der alte `anon`-Schlüssel → wird zu `SUPABASE_ANON_KEY`
   - `Secret key` (beginnt mit `sb_secret_`) oder der alte `service_role`-Schlüssel → wird zu `SUPABASE_SERVICE_ROLE_KEY` (**geheim!**)

## 3. Code auf GitHub hochladen

1. Auf GitHub **New repository** anlegen, Name `mfx-web`, auf **Private** stellen und erstellen.
2. **„uploading an existing file“** wählen. Den entpackten Ordnerinhalt hineinziehen: `api`, `public`, `supabase`, `dev`, `vercel.json`, `package.json`, `README.md`. Dann **Commit changes**.

## 4. Auf Vercel veröffentlichen

1. **Add New → Project** wählen, das Repository `mfx-web` importieren. Bei Framework Preset **Other** einstellen.
2. **Environment Variables** eintragen (Name = Wert):

| Name | Wert |
|---|---|
| `SUPABASE_URL` | aus Schritt 2 |
| `SUPABASE_ANON_KEY` | aus Schritt 2 |
| `SUPABASE_SERVICE_ROLE_KEY` | aus Schritt 2 |
| `TWELVEDATA_API_KEY` | dein Twelve-Data-Schlüssel |
| `FMP_API_KEY` | dein FMP-Schlüssel |
| `PARALLEL_API_KEY` | optional: dein Parallel-Schlüssel. Ohne ihn holt die Seite die News kostenlos aus Bing News |
| `ANTHROPIC_API_KEY` | dein Anthropic-Schlüssel |
| `OWNER_EMAIL` | deine E-Mail-Adresse |
| `HEALTH_SECRET` | ein langes Zufallswort für die Prüfseite |
| `PARALLEL_MODE` | optional, Standard `fast` (1 $ je 1000 Suchen). `basic` liefert längere Auszüge, kostet aber 5 $ je 1000 |
| `AI_DAILY_LIMIT` | optional, Standard 60 KI-Anfragen pro Person und Tag (eine Guide-Frage zählt oft 2–3) |

3. **Deploy** drücken. Danach bekommst du eine Adresse wie `https://mfx-web-xyz.vercel.app`.
4. Zurück in **Supabase → Authentication → URL Configuration**. Bei **Site URL** deine Vercel-Adresse eintragen, die gleiche Adresse auch bei **Redirect URLs** hinzufügen. Sonst führen die Einladungs-Links ins Leere.

## 5. Prüfen

- Öffne `https://DEINE-ADRESSE/api/health`. Bei jedem Dienst sollte `true` stehen.
- Öffne `https://DEINE-ADRESSE/api/health?ping=1&secret=DEIN_HEALTH_SECRET`. Die Seite ruft jeden Dienst einmal echt ab. Überall sollte `ok` stehen. Steht irgendwo „Fehler“, ist meist der Schlüssel falsch kopiert.

## 6. Dich selbst und Freunde einladen

1. **Supabase → Authentication → Users → Invite user**, deine E-Mail eintragen.
2. In der E-Mail auf den Link tippen. Die Seite öffnet sich und fragt nach einem neuen Passwort.
3. Danach bist du angemeldet. Beim nächsten Mal meldest du dich mit E-Mail und Passwort an.
4. Freunde lädst du genauso ein. „Passwort vergessen?“ auf der Anmeldeseite schickt einen Link zum Zurücksetzen.

Hinweis: Der eingebaute E-Mail-Versand von Supabase schafft nur wenige Mails pro Stunde. Für ein paar Freunde reicht das.

---

## Was du wissen solltest

- **Kontingente werden geteilt.** Alle Freunde nutzen deine Schlüssel. Twelve Data (kostenlos) erlaubt 8 Abrufe pro Minute, FMP (kostenlos) etwa 250 pro Tag. Der Zwischenspeicher hilft, aber bei vielen gleichzeitigen Nutzern kommt manchmal „gerade zu viele Abrufe“. Dann hilft ein kleiner bezahlter Tarif.
- **News ohne Schlüssel:** Solange kein Parallel-Schlüssel gesetzt ist, kommen News und Markt-Radar kostenlos aus dem Bing-News-Feed (Schlagzeile, Quelle, kurzer Auszug). `https://DEINE-ADRESSE/api/health?news=1` prüft, ob das klappt. Mit Parallel werden die Treffer genauer, mit der KI zusätzlich auf Deutsch zusammengefasst.
- **News-Kosten:** Parallel schenkt jedem Konto mit hinterlegter Karte 5 $ Guthaben pro Monat. Im Modus `fast` reicht das für etwa 5.000 Suchen. Gleiche Suchen teilen sich alle Freunde 15 Minuten lang.
- **KI-Kosten:** Jede Person hat ein Tageslimit (`AI_DAILY_LIMIT`). Den Verbrauch siehst du in der Anthropic-Konsole, oder in Supabase im SQL Editor mit der Abfrage am Ende von `schema.sql`.
- **Die Wochenanalyse steckt in der Seite.** Wenn die Makroanalyse aktualisiert wird, ersetzt du `public/index.html` auf GitHub durch die neue Datei. Vercel veröffentlicht dann automatisch neu.
- **Die Seite selbst ist erreichbar, die Daten nicht.** Wer die Adresse kennt, sieht die Anmeldemaske und könnte den Quelltext mit der statischen Wochenanalyse lesen. Kurse, KI, Suche und alle Journale gibt es nur nach dem Login.
- **Abendläufe aus Claude** (automatisch gespeicherte Ergebnisse und Quartalszahlen) sind hier noch nicht angebunden. Die Seite nutzt dafür ihre eingebauten Daten.
- **Rechtliches:** Für einen privaten Freundeskreis ist das ein Test. Bevor die Seite öffentlich wird oder Geld kostet: Impressum, Datenschutzerklärung und eine rechtliche Prüfung der Inhalte (keine Anlageberatung).

## Lokal testen (für Entwickler)

```
FAKE=1 node dev/server.mjs     # simuliert alle Dienste, Login: test@mfx.de / passwort123
node dev/e2e.cjs               # Ende-zu-Ende-Test (braucht Playwright)
python3 dev/build_web.py PFAD/mz.html   # baut public/index.html aus der aktuellen Makro-Zentrale
```
