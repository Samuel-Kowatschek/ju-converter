// Tool 02: Video hinter ein PNG legen (PNG mit Transparenz liegt oben).
// Ergebnis ist immer MP4 (H.264 + AAC), weil das Bild neu berechnet werden muss.
import { engine, getExt, baseName } from "./engine.js";

export const VIDEO_EXTS = ["mp4", "mov", "m4v", "mkv", "webm"];

// Ausgabeformate (Instagram-Formate aus dem Designsystem). null = Größe des PNG.
export const FORMATS = {
  png: null,
  square: [1080, 1080],
  portrait: [1080, 1350],
  story: [1080, 1920],
};

const FALLBACK_FPS = 30;

// x264 + yuv420p brauchen gerade Maße
export function even(n) {
  return Math.max(2, Math.round(n / 2) * 2);
}

export function outputName(videoName) {
  return `${baseName(videoName)}_overlay.mp4`;
}

export function parseFps(log) {
  const m = /Stream #\d+:\d+.*?: Video: .*?([\d.]+) fps/.exec(log);
  const fps = m ? Number(m[1]) : NaN;
  return fps > 0 && fps <= 120 ? fps : FALLBACK_FPS;
}

// Sekunden für ffmpeg (Punkt als Dezimaltrenner, 3 Nachkommastellen)
const sec = (n) => Math.max(0, n).toFixed(3);

// Filtergraph: Hintergrundfarbe -> Video -> PNG obendrauf
export function buildArgs({ vIn, pIn, out, fps, canvas, bg, v, p, trim }) {
  const W = even(canvas.w);
  const H = even(canvas.h);
  const color = "0x" + bg.replace("#", "");
  const filter =
    `color=c=${color}:s=${W}x${H}:r=${fps},format=yuv420p[bg];` +
    `[0:v]scale=${even(v.w)}:${even(v.h)},setsar=1[v];` +
    `[1:v]scale=${even(p.w)}:${even(p.h)},format=rgba[p];` +
    `[bg][v]overlay=${Math.round(v.x)}:${Math.round(v.y)}:shortest=1[t];` +
    `[t][p]overlay=${Math.round(p.x)}:${Math.round(p.y)}:shortest=1:format=auto,format=yuv420p[out]`;
  // Ausschnitt: -ss/-t vor -i schneidet Bild und Ton (exakt, da neu kodiert wird)
  const cut = trim ? ["-ss", sec(trim.start), "-t", sec(trim.end - trim.start)] : [];
  return [
    ...cut,
    "-i", vIn,
    "-loop", "1", "-i", pIn,
    "-filter_complex", filter,
    "-map", "[out]",
    "-map", "0:a:0?",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k",
    "-shortest",
    "-movflags", "+faststart",
    out,
  ];
}

// Fallback, falls der Browser das Video nicht abspielen kann: Maße per ffmpeg lesen
export async function probeVideoSize(file) {
  const name = "ov_probe." + getExt(file.name);
  try {
    await engine.write(name, file);
    await engine.exec(["-hide_banner", "-i", name]);
    const m = /Stream #\d+:\d+.*?: Video: .*?, (\d{2,5})x(\d{2,5})/.exec(engine.log);
    const d = /Duration: (\d+):(\d+):([\d.]+)/.exec(engine.log);
    if (!m) return null;
    return {
      w: Number(m[1]), h: Number(m[2]),
      duration: d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : 0,
    };
  } finally {
    await engine.remove(name);
  }
}

// job: { video: File, png: File, canvas, bg, v, p, trim: {start, end} | null } (Koordinaten in Ausgabe-Pixeln)
export async function compose(job) {
  const vIn = "ov_in." + getExt(job.video.name);
  const pIn = "ov_in.png";
  const out = "ov_out.mp4";
  try {
    await engine.write(vIn, job.video);
    await engine.exec(["-hide_banner", "-i", vIn]); // nur für die Bildrate
    const fps = parseFps(engine.log);
    await engine.write(pIn, job.png);
    const code = await engine.exec(buildArgs({ ...job, vIn, pIn, out, fps }));
    if (code !== 0) throw new Error("ffmpeg exit " + code);
    const data = await engine.read(out);
    return new Blob([data], { type: "video/mp4" });
  } catch (e) {
    const log = engine.log;
    engine.reset();
    engine.log = log;
    throw e;
  } finally {
    await engine.remove(vIn, pIn, out);
  }
}
