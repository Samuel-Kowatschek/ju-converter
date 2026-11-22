// Tool 01: Tonspur Stereo -> Mono. Bild wird nicht neu kodiert.
import { engine, getExt, baseName } from "./engine.js";

// Endung -> Audio-Codec
export const CODECS = {
  mp4: "aac",
  mov: "aac",
  m4v: "aac",
  mkv: "aac",
  webm: "libopus",
};

const FALLBACK_BITRATE = "128k";

export function outputName(name) {
  return `${baseName(name)}_mono.${getExt(name)}`;
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

// Datei einlesen und Tonspuren analysieren. Die Eingabe bleibt im MEMFS liegen.
export async function analyze(file) {
  const inName = "mono_in." + getExt(file.name);
  try {
    await engine.write(inName, file);
    // Ohne Ausgabedatei endet ffmpeg mit Fehlercode, das Log reicht aber.
    await engine.exec(["-hide_banner", "-i", inName]);
    return parseAudioStreams(engine.log);
  } catch (e) {
    engine.reset();
    throw e;
  }
}

// Umwandeln. Setzt analyze() voraus.
export async function convert(file, streams) {
  const ext = getExt(file.name);
  const inName = "mono_in." + ext;
  const outName = "mono_out." + ext;
  const bitrate = streams.find((s) => s.kbps)?.kbps;
  const br = bitrate ? `${bitrate}k` : FALLBACK_BITRATE;
  try {
    const code = await engine.exec([
      "-i", inName,
      // Bild, alle Tonspuren, Untertitel. Datenspuren (Timecode, Handy-Metadaten)
      // werden weggelassen, MP4 kann sie beim Kopieren oft nicht aufnehmen.
      "-map", "0:v?",
      "-map", "0:a",
      "-map", "0:s?",
      "-c:v", "copy",
      "-c:s", "copy",
      "-ac", "1",
      "-c:a", CODECS[ext],
      "-b:a", br,
      outName,
    ]);
    if (code !== 0) throw new Error("ffmpeg exit " + code);
    const out = await engine.read(outName);
    return new Blob([out], { type: file.type || "video/" + ext });
  } catch (e) {
    const log = engine.log;
    engine.reset();
    engine.log = log;
    throw e;
  } finally {
    await engine.remove(inName, outName);
  }
}

// Eingabe wieder entfernen, ohne umzuwandeln
export async function discard(file) {
  await engine.remove("mono_in." + getExt(file.name));
}
