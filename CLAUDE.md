# CLAUDE.md – JU Toolbox

Statische Website (GitHub Pages) mit Video-Tools für JuicyUnderground. Alles läuft lokal im Browser (ffmpeg.wasm, Single-Thread). Kein Server, kein Upload, kein Tracking.

Tools:
- `01.Mono`: Tonspur Stereo -> Mono, Bild unverändert (`-c:v copy`).
- `02.Overlay`: Video hinter ein PNG legen, beide Ebenen verschieb-/skalierbar, Ausschnitt wählbar (15 s, 30 s, frei), Ausgabe MP4 (H.264/AAC, neu kodiert).
- Abbrechen: `engine.cancel()` beendet ffmpeg per `terminate()`, der nächste Lauf lädt die Engine neu.

- Vanilla JS, ES Modules, kein Build-Step. Alle Texte und `VERSION` in `text.js`, Farben nur als CSS-Variablen.
- Dateien: `index.html`, `style.css`, `app.js` (Rahmen, Tabs, UI Mono), `overlay-ui.js` (UI Overlay), `ui.js` (gemeinsame UI-Helfer), `engine.js` (eine gemeinsame ffmpeg-Instanz, lazy, ein Job gleichzeitig), `convert.js` (Mono-Logik), `overlay.js` (Overlay-Logik/Filtergraph), `vendor/ffmpeg/` (selbst gehostet, `VERSION.txt`), `fonts/` (Bricolage Grotesque, OFL), `assets/` (JU-Logo), `tests/` (Testvideos + `frame.png`).
- Branding: JuicyUnderground Design-System (5 Markenfarben flächig, keine Verläufe/weichen Schatten, Bricolage Grotesque, runde Ecken, Kapitel-Titel wie `01.Mono`).
- Starten: `python3 -m http.server 8000` (file:// geht nicht).
- Prüfen: `node --check` auf JS, Playwright gegen den lokalen Server, `ffprobe` auf dem Ergebnis (Mono: 1 Audiokanal, Video-Codec/Dauer unverändert; Overlay: Maße = Format, Dauer = Video).
- Neues Tool: Tab + Panel in `index.html`, Texte in `text.js`, Logik über `engine.js` (`engine.lock`).
- Workflow: direkt auf `main` arbeiten und pushen (kein Feature-Branch, kein PR). Jeder Push deployt sofort auf GitHub Pages.
- Keine externen Requests (CSP im HTML), keine Speicherung, Dateien nur im Speicher.
- Grenzen: ~1 GB Warnung, 2 GB gesperrt, Overlay-Rendering in WASM ist langsam bei langen Videos.
