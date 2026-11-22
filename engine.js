// Gemeinsame ffmpeg-Engine für alle Tools: lazy laden, ausführen, aufräumen.
// Es gibt genau eine Instanz, damit die ~30 MB Engine nur einmal im Speicher liegt.
import { FFmpeg } from "./vendor/ffmpeg/ffmpeg/index.js";
import { fetchFile } from "./vendor/ffmpeg/util/index.js";

export const WARN_BYTES = 1024 ** 3; // ab 1 GB Warnung
export const MAX_BYTES = 2 * 1024 ** 3; // ab 2 GB gesperrt

export function getExt(name) {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1].toLowerCase() : "";
}

export function baseName(name) {
  const ext = getExt(name);
  return ext ? name.slice(0, -(ext.length + 1)) : name;
}

class Engine {
  ff = null;
  loading = null; // Instanz, die gerade lädt
  #lines = [];

  // Log als Text. "Last message repeated N times" wird zu einer Zeile zusammengefasst,
  // damit die eigentliche Meldung darüber sichtbar bleibt.
  get log() { return this.#lines.join("\n"); }
  set log(text) { this.#lines = text ? text.split("\n") : []; }

  #addLog(message) {
    const rep = /^\s*Last message repeated (\d+) times?/.exec(message);
    const last = this.#lines.length - 1;
    if (rep && last >= 0 && /^\s*\(oben: /.test(this.#lines[last])) {
      this.#lines[last] = `    (oben: Meldung ${Number(rep[1]) + 1}x insgesamt)`;
    } else if (rep) {
      this.#lines.push(`    (oben: Meldung ${Number(rep[1]) + 1}x insgesamt)`);
    } else {
      this.#lines.push(message);
    }
  }
  busy = false;
  cancelled = false;
  onProgress = () => {};
  onTime = () => {}; // Sekunden der Ausgabe, aus den ffmpeg-Statuszeilen

  async load(onLoadStart = () => {}) {
    if (this.ff) return;
    onLoadStart();
    const ff = new FFmpeg();
    ff.on("log", ({ message }) => {
      this.#addLog(message);
      const t = /time=(\d+):(\d+):([\d.]+)/.exec(message);
      if (t) this.onTime(Number(t[1]) * 3600 + Number(t[2]) * 60 + Number(t[3]));
    });
    ff.on("progress", ({ progress }) => this.onProgress(progress));
    this.loading = ff;
    try {
      await ff.load({
        coreURL: new URL("./vendor/ffmpeg/core/ffmpeg-core.js", import.meta.url).href,
        wasmURL: new URL("./vendor/ffmpeg/core/ffmpeg-core.wasm", import.meta.url).href,
      });
    } catch (e) {
      try { ff.terminate(); } catch {}
      throw e;
    } finally {
      this.loading = null;
    }
    if (this.cancelled) throw new Error("cancelled");
    this.ff = ff;
  }

  // Nach Fehlern: Instanz verwerfen, beim nächsten Lauf neu laden
  reset() {
    if (this.ff) {
      try { this.ff.terminate(); } catch {}
      this.ff = null;
    }
  }

  async exec(args) {
    this.log = "";
    return this.ff.exec(args);
  }

  // File -> MEMFS, ohne die Daten doppelt zu halten
  async write(name, file) {
    let data = await fetchFile(file);
    await this.ff.writeFile(name, data);
    data = null;
  }

  async read(name) {
    return this.ff.readFile(name);
  }

  async remove(...names) {
    if (!this.ff) return;
    for (const n of names) {
      try { await this.ff.deleteFile(n); } catch {}
    }
  }

  // Laufenden Job abbrechen: ffmpeg.wasm kann nur per terminate() stoppen,
  // die Engine wird beim nächsten Lauf neu geladen (aus dem Browser-Cache).
  cancel() {
    if (!this.busy) return;
    this.cancelled = true;
    if (this.loading) {
      try { this.loading.terminate(); } catch {}
    }
    this.reset();
  }

  // Sperrt die Engine für die Dauer eines Laufs (immer nur ein Job gleichzeitig)
  async lock(fn) {
    if (this.busy) throw new BusyError();
    this.busy = true;
    this.cancelled = false;
    try {
      return await fn();
    } finally {
      this.busy = false;
      this.onProgress = () => {};
      this.onTime = () => {};
    }
  }
}

export class BusyError extends Error {}

export const engine = new Engine();
