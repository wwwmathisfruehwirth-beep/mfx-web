"""Baut public/index.html aus der aktuellen Makro-Zentrale (mz.html).
Aufruf: python3 dev/build_web.py [/pfad/zu/mz.html]
- bindet die Web-Brücke (shim.js) als erstes Script ein
- ersetzt Hinweise, die nur in Claude Sinn ergeben
"""
import sys, os
SRC = sys.argv[1] if len(sys.argv) > 1 else '/home/claude/mz/mz.html'
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'index.html')
s = open(SRC, encoding='utf-8').read()
k = '<body>\n<!DOCTYPE html>'
if s.startswith('<!doctype html><html><head><meta charset=utf8>') and k in s[:2000]:
    s = s[s.index(k) + len('<body>\n'):]
if s.endswith('\n</body></html>'):
    s = s[:-len('\n</body></html>')]
assert s.startswith('<!DOCTYPE html>')
a = '<meta charset="utf-8">'
assert s.count(a) >= 1
s = s.replace(a, a + '\n<script src="/shim.js"></script>', 1)
R = [
    ('Kurse, KI-Funktionen und Speicher laufen nur, wenn das Tool in Claude geöffnet ist. Wegen der Live-Daten gibt es keinen öffentlichen Link. Guide, News-Kurzfassungen und Coach nutzen die eigene Claude-Nutzung.',
     'Kurse, KI-Funktionen und Speicher laufen über dein Konto auf dieser Seite. Guide, News-Kurzfassungen und Coach nutzen die KI der Seite, mit einem Tageslimit pro Person.'),
    ('Nutzt deine Claude-Nutzung · keine Anlageberatung', 'KI kann sich irren · keine Anlageberatung'),
    (' Das Suchen nutzt deine Claude-Nutzung', ' Die KI-Einordnung hat ein Tageslimit pro Person'),
    ('Das Review nutzt deine eigene Claude-Nutzung', 'Das Review nutzt die KI der Seite (mit Tageslimit)'),
    ('Guide, News-Kurzfassungen und Coach nutzen die eigene Claude-Nutzung', 'Guide, News-Kurzfassungen und Coach nutzen die KI der Seite (mit Tageslimit)'),
    ('Verbinde es in claude.ai unter Einstellungen → Konnektoren und lade die Seite neu.', 'Der Schlüssel dafür ist auf dem Server noch nicht eingerichtet.'),
    ('Öffne die Seite direkt in Claude (nicht als gespeicherte Datei) und erlaube den Zugriff.', 'Melde dich an und lade die Seite neu.'),
    ('Öffne die Seite direkt in Claude und erlaube den Zugriff.', 'Melde dich an und lade die Seite neu.'),
    ('Öffne sie direkt in Claude und erlaube den Zugriff.', 'Melde dich an und lade die Seite neu.'),
    ('Öffne das Tool direkt in Claude, dann laden die Werte automatisch.', 'Melde dich an, dann laden die Werte automatisch.'),
    ('Der Coach braucht Claude. Öffne das Journal direkt in Claude.', 'Der Coach braucht die KI-Funktion, die gerade nicht verfügbar ist.'),
    ('Öffne das Journal direkt in Claude.', 'Melde dich an und lade die Seite neu.'),
    ('in dieser Ansicht nicht verfügbar. Öffne das Tool direkt in Claude.', 'gerade nicht verfügbar. Melde dich an und lade die Seite neu.'),
    ('Live-Kurs braucht Twelve Data (Seite in Claude öffnen)', 'Live-Kurs braucht Twelve Data (bitte anmelden)'),
    ('FMP ist in claude.ai nicht verbunden (Einstellungen → Konnektoren)', 'FMP ist auf dem Server nicht eingerichtet'),
    ('FMP bitte in claude.ai unter Einstellungen → Konnektoren neu verbinden.', 'FMP-Schlüssel auf dem Server prüfen.'),
    ('Twelve Data ist nicht verbunden (claude.ai, Einstellungen → Konnektoren).', 'Twelve Data ist auf dem Server nicht eingerichtet.'),
    ('Die Kurzfassung durch Claude ist für diese Seite nicht erlaubt. Du siehst die rohen Suchtreffer.',
     'Die KI-Kurzfassung ist auf dieser Seite noch nicht eingerichtet. Du siehst die neuesten Schlagzeilen aus der Nachrichtensuche.'),
    ('(C.why==="not_granted"?"Claude darf auf dieser Seite gerade nicht einordnen. ":"Claude konnte die Treffer gerade nicht einordnen. ")',
     '(C.why==="no_sample"||C.why==="not_granted"?"Die KI-Einordnung ist auf dieser Seite noch nicht eingerichtet. ":"Die KI konnte die Treffer gerade nicht einordnen. ")'),
    ('"Websuche über Parallel Search"',
     '"Nachrichtensuche"'),
    ('srcChip("News: Parallel Search"',
     'srcChip("News"'),
    ('News über Parallel Search, von Claude zusammengefasst',
     'News aus der Nachrichtensuche'),
    ('News über eine Websuche (Parallel Search), die Claude auf Deutsch zusammenfasst und nach Wichtigkeit sortiert.',
     'News über eine Nachrichtensuche. Ist die KI eingerichtet, fasst sie die Meldungen auf Deutsch zusammen und sortiert sie nach Wichtigkeit.'),
    ('Er stellt vier Suchanfragen über Parallel Search:',
     'Er stellt vier Suchanfragen an die Nachrichtensuche:'),
]
miss = []
for a, b in R:
    n = s.count(a)
    if not n: miss.append(a[:60])
    s = s.replace(a, b)
open(OUT, 'w', encoding='utf-8').write(s)
print(OUT, len(s), 'fehlend:', miss)
