// ffmpeg-Wrapper: laden, analysieren, umwandeln, aufräumen.
import { FFmpeg } from "./vendor/ffmpeg/ffmpeg/index.js";
import { fetchFile } from "./vendor/ffmpeg/util/index.js";

// Endung -> Audio-Codec
export const CODECS = {
  mp4: "aac",
  mov: "aac",
  m4v: "aac",
  mkv: "aac",
  webm: "libopus",
};

export const WARN_BYTES = 1024 ** 3; // ab 1 GB Warnung
export const MAX_BYTES = 2 * 1024 ** 3; // ab 2 GB gesperrt

const FALLBACK_BITRATE = "128k";

export function getExt(name) {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1].toLowerCase() : "";
}

export function outputName(name) {
  const ext = getExt(name);
  const base = ext ? name.slice(0, -(ext.length + 1)) : name;
  return `${base}_mono.${ext}`;
}

// Tonspuren aus dem ffmpeg-Log lesen
export function parseAudioStreams(log) {
  const streams = [];
  for (const line of log.split("\n")) {
    const m = /Stream #\d+:\d+.*?: Audio: (\w+).*/.exec(line);
    if (!m) continue;
    const layout = /\d+ Hz, ([^,]+)/.exec(line);
    const kbps = /(\d+) kb\/s/.exec(line);
    const ch = layout ? layout[1].trim() : "";
    let channels = 2;
    if (/^mono/.test(ch) || /^1 channels?/.test(ch)) channels = 1;
    else if (/^stereo/.test(ch)) channels = 2;
    else {
      const n = /^(\d+)\.(\d)/.exec(ch);
      const c = /^(\d+) channels/.exec(ch);
      if (n) channels = Number(n[1]) + Number(n[2]);
      else if (c) channels = Number(c[1]);
      else channels = 3;
    }
    streams.push({ codec: m[1], channels, kbps: kbps ? Number(kbps[1]) : null });
  }
  return streams;
}

export class Converter {
  constructor() {
    this.ffmpeg = null;
    this.log = "";
    this.onProgress = () => {};
    this.onLoadStart = () => {};
  }

  async #ensure() {
    if (this.ffmpeg) return;
    this.onLoadStart();
    const ff = new FFmpeg();
    ff.on("log", ({ message }) => {
      this.log += message + "\n";
    });
    ff.on("progress", ({ progress }) => this.onProgress(progress));
    try {
      await ff.load({
        coreURL: new URL("./vendor/ffmpeg/core/ffmpeg-core.js", import.meta.url).href,
        wasmURL: new URL("./vendor/ffmpeg/core/ffmpeg-core.wasm", import.meta.url).href,
      });
    } catch (e) {
      try { ff.terminate(); } catch {}
      throw e;
    }
    this.ffmpeg = ff;
  }

  #reset() {
    if (this.ffmpeg) {
      try { this.ffmpeg.terminate(); } catch {}
      this.ffmpeg = null;
    }
  }

  // Datei einlesen und Tonspuren analysieren. Gibt { streams } zurück.
  async analyze(file) {
    await this.#ensure();
    this.log = "";
    const inName = "input." + getExt(file.name);
    try {
      let data = await fetchFile(file);
      await this.ffmpeg.writeFile(inName, data);
      data = null; // Referenz freigeben
      // Ohne Ausgabedatei endet ffmpeg mit Fehlercode, das Log reicht aber.
      await this.ffmpeg.exec(["-hide_banner", "-i", inName]);
      return { streams: parseAudioStreams(this.log), inName };
    } catch (e) {
      this.#reset();
      throw e;
    }
  }

  // Umwandeln. Setzt analyze() voraus (Datei liegt im MEMFS).
  async convert(file, streams) {
    const ext = getExt(file.name);
    const inName = "input." + ext;
    const outName = "output." + ext;
    const bitrate = streams.find((s) => s.kbps)?.kbps;
    const br = bitrate ? `${bitrate}k` : FALLBACK_BITRATE;
    this.log = "";
    try {
      const code = await this.ffmpeg.exec([
        "-i", inName,
        "-map", "0",
        "-c:v", "copy",
        "-c:s", "copy",
        "-ac", "1",
        "-c:a", CODECS[ext],
        "-b:a", br,
        outName,
      ]);
      if (code !== 0) throw new Error("ffmpeg exit " + code);
      const out = await this.ffmpeg.readFile(outName);
      return new Blob([out], { type: file.type || "video/" + ext });
    } catch (e) {
      this.#reset();
      throw e;
    } finally {
      await this.cleanup(inName, outName);
    }
  }

  async cleanup(...names) {
    if (!this.ffmpeg) return;
    for (const n of names.length ? names : []) {
      try { await this.ffmpeg.deleteFile(n); } catch {}
    }
  }

  // Eingabe wieder entfernen, ohne umzuwandeln
  async discard(file) {
    await this.cleanup("input." + getExt(file.name));
  }
}
