// Seitenrahmen (Texte, Tabs, Version) und UI für Tool 01.Mono.
import { TEXT, VERSION } from "./text.js";
import { $, bindDrop, createOutput } from "./ui.js";
import { engine, WARN_BYTES, MAX_BYTES, getExt, BusyError } from "./engine.js";
import { CODECS, outputName, analyze, convert, discard } from "./convert.js";
import { initOverlay } from "./overlay-ui.js";

// ---------- Rahmen ----------
$("t-title").textContent = TEXT.title;
$("t-sub").textContent = TEXT.sub;
$("t-privacy").textContent = TEXT.privacy;
$("t-footer").innerHTML = TEXT.footer;
$("version").textContent = VERSION;
$("tabs").setAttribute("aria-label", TEXT.tabsLabel);
for (const s of document.querySelectorAll(".t-details")) s.textContent = TEXT.details;

// ---------- Tabs (per Hash verlinkbar: #mono, #overlay) ----------
const TOOLS = ["mono", "overlay"];
const tabs = TOOLS.map((t) => $(`tab-${t}`));
tabs.forEach((b, i) => { b.textContent = TEXT[TOOLS[i]].tab; });

function show(tool, focus = false) {
  if (!TOOLS.includes(tool)) tool = TOOLS[0];
  TOOLS.forEach((t, i) => {
    const on = t === tool;
    tabs[i].setAttribute("aria-selected", String(on));
    tabs[i].tabIndex = on ? 0 : -1;
    $(`panel-${t}`).hidden = !on;
  });
  if (focus) tabs[TOOLS.indexOf(tool)].focus();
  if (location.hash !== "#" + tool) history.replaceState(null, "", "#" + tool);
  document.dispatchEvent(new CustomEvent("toolchange", { detail: tool }));
}
tabs.forEach((b, i) => {
  b.addEventListener("click", () => show(TOOLS[i]));
  b.addEventListener("keydown", (e) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (d) { e.preventDefault(); show(TOOLS[(i + d + TOOLS.length) % TOOLS.length], true); }
  });
});
window.addEventListener("hashchange", () => show(location.hash.slice(1)));
show(location.hash.slice(1));

// ---------- 01.Mono ----------
const T = TEXT.mono;
$("m-title").textContent = T.title;
$("m-sub").textContent = T.sub;
$("m-drop").textContent = T.dropzone;
$("m-hint").textContent = T.dropHint;

const go = $("mono-go");
const info = $("mono-info");
const drop = $("mono-drop");
const out = createOutput("mono");
go.textContent = T.go;

let current = null;
let running = false;

function pick(file) {
  if (running) return;
  out.reset();
  current = null;
  go.disabled = true;
  drop.classList.add("has-file");
  info.hidden = false;
  info.textContent = TEXT.size(file.name, file.size);
  if (!CODECS[getExt(file.name)]) return out.status(T.badType, "error");
  if (file.size >= MAX_BYTES) return out.status(TEXT.tooBig, "error");
  if (file.size >= WARN_BYTES) out.status(TEXT.warnBig, "warn");
  current = file;
  go.disabled = false;
}

async function run() {
  if (!current || running) return;
  const file = current;
  running = true;
  go.disabled = true;
  out.reset();
  let loaded = !!engine.ff;
  try {
    await engine.lock(async () => {
      out.running(true, TEXT.cancel, () => engine.cancel());
      out.progress(null);
      out.status(TEXT.loadingEngine, "info");
      await engine.load();
      loaded = true;
      const streams = await analyze(file);
      if (!streams.length) {
        await discard(file);
        out.hideProgress();
        return out.status(T.noAudio, "error");
      }
      if (streams.every((s) => s.channels === 1)) {
        await discard(file);
        out.hideProgress();
        return out.status(T.alreadyMono, "ok");
      }
      const surround = streams.filter((s) => s.channels > 2).length;
      out.status(T.converting, "info");
      engine.onProgress = (p) => {
        const pct = out.progress(p);
        if (pct != null) out.status(TEXT.progress(pct), "info");
      };
      const blob = await convert(file, streams);
      const name = outputName(file.name);
      out.progress(1);
      out.download(blob, name, TEXT.download(name));
      let msg = T.done(file.size, blob.size);
      if (surround) msg += " " + T.surroundNote(surround);
      out.status(msg, "ok");
    });
  } catch (e) {
    out.hideProgress();
    if (e instanceof BusyError) {
      out.status(TEXT.busyOther, "warn");
    } else if (engine.cancelled) {
      out.status(TEXT.cancelled, "info");
    } else {
      out.showLog(engine.log + "\n" + (e && e.message ? e.message : e));
      out.status(loaded ? T.error : TEXT.engineError, "error");
    }
  } finally {
    out.running(false);
    running = false;
    go.disabled = !current;
  }
}

bindDrop(drop, $("mono-file"), pick);
go.addEventListener("click", run);

// ---------- 02.Overlay ----------
initOverlay();
