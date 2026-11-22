// UI für Tool 02.Overlay: Video + PNG laden, beide Ebenen positionieren, rendern.
import { TEXT } from "./text.js";
import { $, bindDrop, createOutput } from "./ui.js";
import { engine, WARN_BYTES, MAX_BYTES, getExt, BusyError } from "./engine.js";
import { VIDEO_EXTS, FORMATS, outputName, compose, probeVideoSize } from "./overlay.js";

const T = TEXT.overlay;
const DEFAULT_CANVAS = FORMATS.portrait;
// Ausschnitt-Presets in Sekunden (null = freie Auswahl)
const TRIM_PRESETS = { s15: 15, s30: 30, free: null };
const MIN_LEN = 0.5; // kürzester freier Ausschnitt

// 75.3 -> "1:15,3"
function fmtTime(t) {
  const m = Math.floor(t / 60);
  const s = (t - m * 60).toFixed(1).padStart(4, "0").replace(".", ",");
  return `${m}:${s}`;
}
const fmtLen = (t) => t.toFixed(1).replace(".", ",") + " s";

export function initOverlay() {
  $("o-title").textContent = T.title;
  $("o-sub").textContent = T.sub;
  $("o-video-drop").textContent = T.videoDrop;
  $("ov-video-name").textContent = T.videoHint;
  $("o-png-drop").textContent = T.pngDrop;
  $("ov-png-name").textContent = T.pngHint;
  $("o-format").textContent = T.format;
  $("o-bg").textContent = T.background;
  $("o-layer").textContent = T.layer;
  $("o-x").textContent = T.x;
  $("o-y").textContent = T.y;
  $("o-scale").textContent = T.scale;
  $("o-trim").textContent = T.trim;
  $("o-start").textContent = T.start;
  $("o-end").textContent = T.end;
  $("ov-center").textContent = T.center;
  $("ov-cover").textContent = T.cover;
  $("ov-contain").textContent = T.contain;
  $("ov-note").textContent = T.slowNote;
  $("ov-stage").setAttribute("aria-label", T.stageLabel);

  const go = $("ov-go");
  go.textContent = T.go;
  const out = createOutput("ov");
  const stage = $("ov-stage");
  const vidEl = $("ov-video");
  const imgEl = $("ov-png");
  const editor = $("ov-editor");
  const sliders = { x: $("ov-x"), y: $("ov-y"), scale: $("ov-scale") };
  const outputs = { x: $("ov-x-out"), y: $("ov-y-out"), scale: $("ov-scale-out") };
  const trimEl = {
    box: document.querySelector(".trim"),
    start: $("ov-start"), end: $("ov-end"),
    startOut: $("ov-start-out"), endOut: $("ov-end-out"),
    endRow: $("ov-end-row"), info: $("ov-trim-info"),
    sel: $("ov-tl-sel"), head: $("ov-tl-head"),
  };

  // Ton der Vorschau (Autoplay geht nur stumm, daher per Klick einschalten)
  const soundBtn = $("ov-sound");
  const soundLabel = $("ov-sound-label");
  function renderSound() {
    const on = !vidEl.muted;
    soundBtn.setAttribute("aria-pressed", String(on));
    soundLabel.textContent = on ? T.soundOff : T.soundOn;
  }
  soundBtn.addEventListener("click", () => {
    vidEl.muted = !vidEl.muted;
    vidEl.play().catch(() => {});
    renderSound();
  });
  renderSound();

  // Platzhalter, falls der Browser das Video nicht zeigen kann
  const ph = document.createElement("div");
  ph.className = "ph";
  ph.hidden = true;
  stage.insertBefore(ph, imgEl);
  const sel = document.createElement("div");
  sel.className = "sel";
  stage.appendChild(sel);

  const st = {
    video: null, png: null,
    vNat: null, pNat: null, // natürliche Maße
    vUrl: null, pUrl: null,
    format: "png", bg: "black", layer: "video",
    canvas: { w: DEFAULT_CANVAS[0], h: DEFAULT_CANVAS[1] },
    v: null, p: null, // Ebenen in Ausgabe-Pixeln {x,y,w,h}
    dur: 0, // Videolänge in s (0 = unbekannt -> kein Zuschnitt)
    trimMode: "free",
    trim: { start: 0, end: 0 },
  };
  let running = false;

  // ---------- Chips ----------
  function chips(container, name, entries, value, onChange, dot = false) {
    for (const [key, label] of entries) {
      const l = document.createElement("label");
      l.className = "opt";
      const i = document.createElement("input");
      i.type = "radio"; i.name = name; i.value = key; i.checked = key === value;
      i.addEventListener("change", () => onChange(key));
      const s = document.createElement("span");
      if (dot) {
        const d = document.createElement("i");
        d.className = `dot bg-${key}`;
        s.appendChild(d);
      }
      s.appendChild(document.createTextNode(label));
      l.append(i, s);
      container.appendChild(l);
    }
  }
  chips($("ov-formats"), "ov-format", Object.entries(T.formats), st.format, (k) => {
    st.format = k; layoutCanvas(); resetLayers();
  });
  chips($("ov-colors"), "ov-bg", Object.entries(T.colors), st.bg, (k) => {
    st.bg = k; render();
  }, true);
  chips($("ov-trims"), "ov-trim", Object.entries(T.trimModes), st.trimMode, (k) => {
    st.trimMode = k; applyTrimMode(); seekToStart();
  });
  chips($("ov-layers"), "ov-layer", Object.entries(T.layers), st.layer, (k) => {
    st.layer = k; render();
  });

  // ---------- Ausschnitt ----------
  const presetLen = () => TRIM_PRESETS[st.trimMode];

  function setDuration(d) {
    st.dur = isFinite(d) && d > 0 ? d : 0;
    // Presets, die länger als das Video sind, deaktivieren
    for (const input of document.querySelectorAll('input[name="ov-trim"]')) {
      const n = TRIM_PRESETS[input.value];
      const off = n != null && st.dur > 0 && st.dur <= n;
      input.disabled = off;
      input.parentElement.title = off ? T.trimTooShort(n) : "";
      input.parentElement.classList.toggle("disabled", off);
    }
    if (presetLen() != null && st.dur <= presetLen()) st.trimMode = "free";
    for (const input of document.querySelectorAll('input[name="ov-trim"]')) input.checked = input.value === st.trimMode;
    st.trim = { start: 0, end: st.dur };
    applyTrimMode();
  }

  function applyTrimMode() {
    const n = presetLen();
    const t = st.trim;
    if (n != null) {
      t.start = Math.min(t.start, Math.max(0, st.dur - n));
      t.end = t.start + Math.min(n, st.dur);
    } else if (t.end - t.start < MIN_LEN) {
      t.end = Math.min(st.dur, t.start + MIN_LEN);
    }
    renderTrim();
  }

  function setStart(v) {
    const n = presetLen();
    const t = st.trim;
    if (n != null) {
      t.start = Math.min(Math.max(0, v), Math.max(0, st.dur - n));
      t.end = t.start + Math.min(n, st.dur);
    } else {
      t.start = Math.min(Math.max(0, v), Math.max(0, t.end - MIN_LEN));
    }
    renderTrim();
  }

  function setEnd(v) {
    const t = st.trim;
    t.end = Math.max(Math.min(st.dur, v), Math.min(st.dur, t.start + MIN_LEN));
    renderTrim();
  }

  function renderTrim() {
    trimEl.box.hidden = !st.dur;
    if (!st.dur) return;
    const t = st.trim;
    for (const r of [trimEl.start, trimEl.end]) r.max = String(st.dur);
    trimEl.start.value = String(t.start);
    trimEl.end.value = String(t.end);
    trimEl.startOut.textContent = fmtTime(t.start);
    trimEl.endOut.textContent = fmtTime(t.end);
    trimEl.endRow.hidden = presetLen() != null;
    trimEl.info.textContent = T.trimInfo(fmtTime(t.start), fmtTime(t.end), fmtLen(t.end - t.start));
    trimEl.sel.style.left = (t.start / st.dur) * 100 + "%";
    trimEl.sel.style.width = ((t.end - t.start) / st.dur) * 100 + "%";
  }

  function seekToStart() {
    if (st.dur && !vidEl.hidden) {
      try { vidEl.currentTime = st.trim.start; } catch {}
    }
  }

  trimEl.start.addEventListener("input", () => { setStart(Number(trimEl.start.value)); seekToStart(); });
  trimEl.end.addEventListener("input", () => {
    setEnd(Number(trimEl.end.value));
    // Vorschau kurz vor das Ende setzen, damit man den Schnittpunkt sieht
    if (!vidEl.hidden) try { vidEl.currentTime = Math.max(st.trim.start, st.trim.end - 1); } catch {}
  });

  // Vorschau nur im Ausschnitt abspielen + Abspielkopf anzeigen
  function loop() {
    if (st.dur && !vidEl.hidden && vidEl.readyState >= 1) {
      const t = st.trim;
      const now = vidEl.currentTime;
      if (now >= t.end || now < t.start - 0.25) {
        try { vidEl.currentTime = t.start; } catch {}
      }
      trimEl.head.style.left = (Math.min(now, st.dur) / st.dur) * 100 + "%";
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // ---------- Geometrie ----------
  function fit(nat, mode) {
    const { w: W, h: H } = st.canvas;
    const s = mode === "cover" ? Math.max(W / nat.w, H / nat.h) : Math.min(W / nat.w, H / nat.h);
    const w = nat.w * s, h = nat.h * s;
    return { x: (W - w) / 2, y: (H - h) / 2, w, h };
  }
  function layoutCanvas() {
    const f = FORMATS[st.format];
    if (f) st.canvas = { w: f[0], h: f[1] };
    else if (st.pNat) st.canvas = { ...st.pNat };
    else st.canvas = { w: DEFAULT_CANVAS[0], h: DEFAULT_CANVAS[1] };
  }
  function resetLayers() {
    if (st.vNat) st.v = fit(st.vNat, "cover");
    if (st.pNat) st.p = fit(st.pNat, "contain");
    render();
  }
  const active = () => (st.layer === "video" ? st.v : st.p);
  const activeNat = () => (st.layer === "video" ? st.vNat : st.pNat);

  function place(el, r) {
    const { w: W, h: H } = st.canvas;
    el.style.left = (r.x / W) * 100 + "%";
    el.style.top = (r.y / H) * 100 + "%";
    el.style.width = (r.w / W) * 100 + "%";
    el.style.height = (r.h / H) * 100 + "%";
  }

  function render() {
    const ready = !!(st.v && st.p);
    editor.hidden = !ready;
    go.disabled = !ready || running;
    if (!ready) return;
    const { w: W, h: H } = st.canvas;
    stage.style.aspectRatio = `${W} / ${H}`;
    stage.style.width = `min(100%, calc(62vh * ${W / H}))`;
    for (const c of [...stage.classList]) if (c.startsWith("bg-")) stage.classList.remove(c);
    stage.classList.add(`bg-${st.bg}`);
    place(vidEl, st.v);
    place(ph, st.v);
    place(imgEl, st.p);
    const a = active();
    place(sel, a);
    sliders.x.min = String(Math.round(-a.w)); sliders.x.max = String(W);
    sliders.y.min = String(Math.round(-a.h)); sliders.y.max = String(H);
    sliders.x.value = String(Math.round(a.x));
    sliders.y.value = String(Math.round(a.y));
    sliders.scale.value = String(Math.round((a.w / W) * 100));
    outputs.x.textContent = Math.round(a.x) + " px";
    outputs.y.textContent = Math.round(a.y) + " px";
    outputs.scale.textContent = Math.round((a.w / W) * 100) + " %";
  }

  // Skalieren um den Mittelpunkt der Ebene
  function scaleTo(widthPx) {
    const a = active(), nat = activeNat();
    const w = Math.max(8, widthPx);
    const h = w * (nat.h / nat.w);
    a.x += (a.w - w) / 2; a.y += (a.h - h) / 2;
    a.w = w; a.h = h;
    render();
  }

  sliders.x.addEventListener("input", () => { active().x = Number(sliders.x.value); render(); });
  sliders.y.addEventListener("input", () => { active().y = Number(sliders.y.value); render(); });
  sliders.scale.addEventListener("input", () => scaleTo((Number(sliders.scale.value) / 100) * st.canvas.w));
  $("ov-center").addEventListener("click", () => {
    const a = active();
    a.x = (st.canvas.w - a.w) / 2; a.y = (st.canvas.h - a.h) / 2; render();
  });
  $("ov-cover").addEventListener("click", () => { Object.assign(active(), fit(activeNat(), "cover")); render(); });
  $("ov-contain").addEventListener("click", () => { Object.assign(active(), fit(activeNat(), "contain")); render(); });

  // ---------- Ziehen, Mausrad, Tastatur ----------
  let drag = null;
  stage.addEventListener("pointerdown", (e) => {
    if (!active()) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    stage.setPointerCapture(e.pointerId);
    stage.classList.add("dragging");
  });
  stage.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const k = st.canvas.w / stage.clientWidth;
    const a = active();
    a.x += (e.clientX - drag.x) * k;
    a.y += (e.clientY - drag.y) * k;
    drag.x = e.clientX; drag.y = e.clientY;
    render();
  });
  const endDrag = () => { drag = null; stage.classList.remove("dragging"); };
  stage.addEventListener("pointerup", endDrag);
  stage.addEventListener("pointercancel", endDrag);
  stage.addEventListener("wheel", (e) => {
    if (!active()) return;
    e.preventDefault();
    scaleTo(active().w * (e.deltaY < 0 ? 1.05 : 1 / 1.05));
  }, { passive: false });
  stage.addEventListener("keydown", (e) => {
    const a = active();
    if (!a) return;
    const step = e.shiftKey ? 20 : 2;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key]) {
      e.preventDefault();
      a.x += moves[e.key][0]; a.y += moves[e.key][1]; render();
    } else if (e.key === "+" || e.key === "=") {
      e.preventDefault(); scaleTo(a.w * 1.05);
    } else if (e.key === "-") {
      e.preventDefault(); scaleTo(a.w / 1.05);
    }
  });

  // ---------- Dateien ----------
  function checkSize(file) {
    if (file.size >= MAX_BYTES) { out.status(TEXT.tooBig, "error"); return false; }
    if (file.size >= WARN_BYTES) out.status(TEXT.warnBig, "warn");
    return true;
  }

  function pickVideo(file) {
    if (running) return;
    out.reset();
    const drop = $("ov-video-drop");
    $("ov-video-name").textContent = TEXT.size(file.name, file.size);
    drop.classList.add("has-file");
    st.video = null; st.vNat = null; st.v = null;
    setDuration(0);
    render();
    if (!VIDEO_EXTS.includes(getExt(file.name))) return out.status(T.badVideo, "error");
    if (!checkSize(file)) return;
    if (st.vUrl) URL.revokeObjectURL(st.vUrl);
    st.vUrl = URL.createObjectURL(file);
    vidEl.hidden = false; ph.hidden = true; soundBtn.hidden = false;
    vidEl.onloadedmetadata = () => {
      if (!vidEl.videoWidth) return vidEl.onerror();
      st.video = file;
      st.vNat = { w: vidEl.videoWidth, h: vidEl.videoHeight };
      st.v = fit(st.vNat, "cover");
      setDuration(vidEl.duration);
      render();
      vidEl.play().catch(() => {});
    };
    vidEl.onerror = async () => {
      // Vorschau nicht möglich (z. B. Codec) -> Maße per ffmpeg ermitteln
      vidEl.hidden = true; ph.hidden = false; soundBtn.hidden = true;
      out.status(T.videoUnreadable, "warn");
      try {
        const size = await engine.lock(async () => {
          await engine.load(() => out.status(TEXT.loadingEngine, "info"));
          return probeVideoSize(file);
        });
        if (!size) throw new Error("no size");
        st.video = file;
        st.vNat = { w: size.w, h: size.h };
        st.v = fit(st.vNat, "cover");
        setDuration(size.duration);
        out.status(T.videoUnreadable, "warn");
        render();
      } catch (e) {
        out.status(e instanceof BusyError ? TEXT.busyOther : T.badVideo, "error");
      }
    };
    vidEl.src = st.vUrl;
  }

  function pickPng(file) {
    if (running) return;
    out.reset();
    const drop = $("ov-png-drop");
    $("ov-png-name").textContent = TEXT.size(file.name, file.size);
    drop.classList.add("has-file");
    st.png = null; st.pNat = null; st.p = null;
    render();
    if (getExt(file.name) !== "png" && file.type !== "image/png") return out.status(T.badPng, "error");
    if (!checkSize(file)) return;
    if (st.pUrl) URL.revokeObjectURL(st.pUrl);
    st.pUrl = URL.createObjectURL(file);
    imgEl.onload = () => {
      st.png = file;
      st.pNat = { w: imgEl.naturalWidth, h: imgEl.naturalHeight };
      layoutCanvas();
      if (st.vNat) st.v = fit(st.vNat, "cover");
      st.p = fit(st.pNat, "contain");
      render();
    };
    imgEl.onerror = () => out.status(T.badPng, "error");
    imgEl.src = st.pUrl;
  }

  bindDrop($("ov-video-drop"), $("ov-video-file"), pickVideo);
  bindDrop($("ov-png-drop"), $("ov-png-file"), pickPng);

  // Video nur abspielen, solange das Tool sichtbar ist
  document.addEventListener("toolchange", (e) => {
    if (e.detail === "overlay" && st.vUrl) vidEl.play().catch(() => {});
    else vidEl.pause();
  });

  // ---------- Rendern ----------
  async function run() {
    if (running || !st.v || !st.p) return;
    running = true;
    go.disabled = true;
    out.reset();
    let loaded = !!engine.ff;
    const css = getComputedStyle(document.documentElement);
    const job = {
      video: st.video, png: st.png,
      canvas: { ...st.canvas },
      bg: css.getPropertyValue(`--juicy-${st.bg}`).trim(),
      v: { ...st.v }, p: { ...st.p },
      trim: null,
    };
    // Zuschneiden nur, wenn nicht das ganze Video gewählt ist
    const t = st.trim;
    if (st.dur && (t.start > 0.05 || t.end < st.dur - 0.05)) job.trim = { start: t.start, end: t.end };
    const len = job.trim ? job.trim.end - job.trim.start : st.dur;
    try {
      await engine.lock(async () => {
        out.running(true, TEXT.cancel, () => engine.cancel());
        out.progress(null);
        out.status(TEXT.loadingEngine, "info");
        await engine.load();
        loaded = true;
        out.status(T.rendering, "info");
        // Fortschritt aus der Ausgabezeit (stimmt auch beim Zuschnitt)
        engine.onTime = (sec) => {
          if (!len) return;
          const pct = out.progress(Math.min(1, sec / len));
          if (pct != null) out.status(TEXT.progress(pct), "info");
        };
        const blob = await compose(job);
        const name = outputName(job.video.name);
        out.progress(1);
        out.download(blob, name, TEXT.download(name));
        out.status(T.done(blob.size), "ok");
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
      render();
    }
  }
  go.addEventListener("click", run);
  render();
}
