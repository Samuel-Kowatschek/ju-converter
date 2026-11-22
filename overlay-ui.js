// UI für Tool 02.Overlay: Video + PNG laden, beide Ebenen positionieren, rendern.
import { TEXT } from "./text.js";
import { $, bindDrop, createOutput } from "./ui.js";
import { engine, WARN_BYTES, MAX_BYTES, getExt, BusyError } from "./engine.js";
import { VIDEO_EXTS, FORMATS, outputName, compose, probeVideoSize } from "./overlay.js";

const T = TEXT.overlay;
const DEFAULT_CANVAS = FORMATS.portrait;

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
  chips($("ov-layers"), "ov-layer", Object.entries(T.layers), st.layer, (k) => {
    st.layer = k; render();
  });

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
    render();
    if (!VIDEO_EXTS.includes(getExt(file.name))) return out.status(T.badVideo, "error");
    if (!checkSize(file)) return;
    if (st.vUrl) URL.revokeObjectURL(st.vUrl);
    st.vUrl = URL.createObjectURL(file);
    vidEl.hidden = false; ph.hidden = true;
    vidEl.onloadedmetadata = () => {
      if (!vidEl.videoWidth) return vidEl.onerror();
      st.video = file;
      st.vNat = { w: vidEl.videoWidth, h: vidEl.videoHeight };
      st.v = fit(st.vNat, "cover");
      render();
      vidEl.play().catch(() => {});
    };
    vidEl.onerror = async () => {
      // Vorschau nicht möglich (z. B. Codec) -> Maße per ffmpeg ermitteln
      vidEl.hidden = true; ph.hidden = false;
      out.status(T.videoUnreadable, "warn");
      try {
        const size = await engine.lock(async () => {
          await engine.load(() => out.status(TEXT.loadingEngine, "info"));
          return probeVideoSize(file);
        });
        if (!size) throw new Error("no size");
        st.video = file;
        st.vNat = size;
        st.v = fit(size, "cover");
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
    };
    try {
      await engine.lock(async () => {
        out.progress(null);
        out.status(TEXT.loadingEngine, "info");
        await engine.load();
        loaded = true;
        out.status(T.rendering, "info");
        engine.onProgress = (p) => {
          const pct = out.progress(p);
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
      } else {
        out.showLog(engine.log + "\n" + (e && e.message ? e.message : e));
        out.status(loaded ? T.error : TEXT.engineError, "error");
      }
    } finally {
      running = false;
      render();
    }
  }
  go.addEventListener("click", run);
  render();
}
