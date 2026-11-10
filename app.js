// UI-Logik: Datei wählen, Validierung, Fortschritt, Download, Fehleranzeige.
import { Converter, CODECS, WARN_BYTES, MAX_BYTES, getExt, outputName } from "./convert.js";

// Alle Texte zentral (später de/en möglich)
const VERSION = "v1.0";

const TEXT = {
  title: "Mono Converter",
  sub: "Wandelt die Tonspur eines Videos von Stereo zu Mono um. Das Bild bleibt unverändert.",
  privacy: "Deine Datei verlässt deinen Rechner nie. Alles läuft lokal im Browser.",
  dropzone: "Video hier ablegen oder klicken zum Auswählen (MP4, MOV, M4V, MKV, WebM)",
  go: "Umwandeln",
  goBusy: "Bitte warten ...",
  loadingEngine: "Lade Engine ... (beim ersten Mal ca. 30 MB)",
  analyzing: "Analysiere Datei ...",
  converting: (p) => (p == null ? "Wandle um ..." : `Wandle um ... ${p} %`),
  size: (name, bytes) => `${name} (${fmt(bytes)})`,
  warnBig: "Große Datei: Die Umwandlung kann viel Speicher brauchen, der Tab könnte abstürzen.",
  tooBig: "Datei zu groß (über 2 GB). Der Browser-Speicher reicht dafür nicht, bitte ein Desktop-Tool nutzen.",
  badType: "Dieses Format wird nicht unterstützt. Erlaubt: MP4, MOV, M4V, MKV, WebM.",
  noAudio: "Keine Tonspur gefunden.",
  alreadyMono: "Die Tonspur ist schon mono. Es gibt nichts umzuwandeln.",
  surround: "Surround -> Mono",
  surroundNote: (n) => `Hinweis: ${n} Tonspur(en) mit mehr als 2 Kanälen (Surround -> Mono).`,
  done: (a, b) => `Fertig. Größe vorher: ${fmt(a)}, nachher: ${fmt(b)}.`,
  download: (name) => `Herunterladen: ${name}`,
  error: "Die Umwandlung ist fehlgeschlagen. Die Datei ist evtl. beschädigt oder zu groß. Details unten.",
  engineError: "Die Engine konnte nicht geladen werden. Bitte Seite neu laden.",
  details: "Details (ffmpeg-Log)",
  footer: 'Umwandlung mit <a href="https://github.com/ffmpegwasm/ffmpeg.wasm">ffmpeg.wasm</a> (<a href="https://ffmpeg.org/legal.html">FFmpeg</a>, LGPL/GPL), lokal gehostet. Lizenztexte in <a href="vendor/ffmpeg/LICENSE-NOTICE.txt">vendor/ffmpeg/</a>.',
};

function fmt(bytes) {
  if (bytes >= 1024 ** 3) return (bytes / 1024 ** 3).toFixed(2) + " GB";
  if (bytes >= 1024 ** 2) return (bytes / 1024 ** 2).toFixed(1) + " MB";
  return Math.max(1, Math.round(bytes / 1024)) + " KB";
}

const $ = (id) => document.getElementById(id);
const el = {
  file: $("file"), drop: $("dropzone"), info: $("fileinfo"), go: $("go"),
  progWrap: $("progress-wrap"), prog: $("progress"), progLabel: $("progress-label"),
  status: $("status"), dl: $("download"), details: $("details"), log: $("log"),
};

$("t-title").textContent = TEXT.title;
$("t-sub").textContent = TEXT.sub;
$("t-privacy").textContent = TEXT.privacy;
$("dz-text").textContent = TEXT.dropzone;
$("t-details").textContent = TEXT.details;
$("t-footer").innerHTML = TEXT.footer;
el.go.textContent = TEXT.go;
$("version").textContent = VERSION;

const conv = new Converter();
let current = null; // gewählte Datei
let busy = false;
let downloadUrl = null;

function setStatus(msg, kind = "") {
  el.status.textContent = msg;
  el.status.className = kind;
}

function resetResult() {
  if (downloadUrl) { URL.revokeObjectURL(downloadUrl); downloadUrl = null; }
  el.dl.hidden = true;
  el.details.hidden = true;
  el.progWrap.hidden = true;
  setStatus("");
}

function setProgress(p) {
  el.progWrap.hidden = false;
  if (p == null || !isFinite(p)) {
    el.prog.removeAttribute("value");
    el.progLabel.textContent = "";
  } else {
    const pct = Math.max(0, Math.min(100, Math.round(p * 100)));
    el.prog.value = pct;
    el.progLabel.textContent = pct + " %";
    setStatus(TEXT.converting(pct));
  }
}

function pick(file) {
  if (busy || !file) return;
  resetResult();
  current = null;
  el.go.disabled = true;
  el.info.hidden = false;
  el.info.textContent = TEXT.size(file.name, file.size);
  if (!CODECS[getExt(file.name)]) return setStatus(TEXT.badType, "error");
  if (file.size >= MAX_BYTES) return setStatus(TEXT.tooBig, "error");
  if (file.size >= WARN_BYTES) setStatus(TEXT.warnBig, "warn");
  current = file;
  el.go.disabled = false;
}

async function run() {
  if (!current || busy) return;
  const file = current;
  busy = true;
  el.go.disabled = true;
  el.go.textContent = TEXT.goBusy;
  resetResult();
  conv.onLoadStart = () => setStatus(TEXT.loadingEngine);
  conv.onProgress = setProgress;
  let stage = "engine";
  try {
    setProgress(null);
    setStatus(TEXT.loadingEngine);
    const { streams } = await conv.analyze(file);
    stage = "convert";
    if (!streams.length) {
      await conv.discard(file);
      return setStatus(TEXT.noAudio, "error");
    }
    if (streams.every((s) => s.channels === 1)) {
      await conv.discard(file);
      return setStatus(TEXT.alreadyMono, "ok");
    }
    const surround = streams.filter((s) => s.channels > 2).length;
    setStatus(TEXT.converting(null));
    setProgress(null);
    const blob = await conv.convert(file, streams);
    downloadUrl = URL.createObjectURL(blob);
    const name = outputName(file.name);
    el.dl.href = downloadUrl;
    el.dl.download = name;
    el.dl.textContent = TEXT.download(name);
    el.dl.hidden = false;
    el.prog.value = 100;
    let msg = TEXT.done(file.size, blob.size);
    if (surround) msg += " " + TEXT.surroundNote(surround);
    setStatus(msg, "ok");
  } catch (e) {
    el.log.textContent = conv.log + "\n" + (e && e.message ? e.message : e);
    el.details.hidden = false;
    setStatus(stage === "engine" && !conv.log ? TEXT.engineError : TEXT.error, "error");
    el.progWrap.hidden = true;
  } finally {
    busy = false;
    el.go.textContent = TEXT.go;
    el.go.disabled = !current;
  }
}

el.file.addEventListener("change", () => pick(el.file.files[0]));
el.go.addEventListener("click", run);
for (const ev of ["dragenter", "dragover"]) {
  el.drop.addEventListener(ev, (e) => { e.preventDefault(); el.drop.classList.add("drag"); });
}
for (const ev of ["dragleave", "drop"]) {
  el.drop.addEventListener(ev, (e) => { e.preventDefault(); el.drop.classList.remove("drag"); });
}
el.drop.addEventListener("drop", (e) => pick(e.dataTransfer.files[0]));
