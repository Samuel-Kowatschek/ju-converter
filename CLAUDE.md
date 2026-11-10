# CLAUDE.md – Mono Converter

Statische Website (GitHub Pages): wandelt die Tonspur eines Videos lokal im Browser (ffmpeg.wasm, Single-Thread) von Stereo zu Mono um. Bild wird nicht neu kodiert (`-c:v copy`). Kein Server, kein Upload, kein Tracking.

- Vanilla JS, ES Modules, kein Build-Step. Texte zentral in `TEXT` (app.js), Farben nur als CSS-Variablen.
- Dateien: `index.html`, `style.css`, `app.js` (UI), `convert.js` (ffmpeg-Wrapper), `vendor/ffmpeg/` (selbst gehostet, Versionen in `VERSION.txt`), `tests/` (Testvideos).
- Starten: `python3 -m http.server 8000` (file:// geht nicht).
- Prüfen: `node --check` auf JS, Playwright gegen den lokalen Server, `ffprobe` auf dem Ergebnis (1 Audiokanal, Video-Codec/Dauer unverändert).
- Workflow: Feature-Branch, Merge per PR nach `main`.
- Keine externen Requests (CSP im HTML), keine Speicherung, Dateien nur im Speicher.
- Grenzen: ~1 GB Warnung, 2 GB gesperrt, kein Batch, keine Normalisierung, keine Kanalwahl.
