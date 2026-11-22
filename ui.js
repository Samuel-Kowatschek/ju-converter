// Gemeinsame UI-Bausteine: Formatierung, Dropzones, Status/Fortschritt/Download pro Tool.

export const $ = (id) => document.getElementById(id);

export function fmt(bytes) {
  if (bytes >= 1024 ** 3) return (bytes / 1024 ** 3).toFixed(2) + " GB";
  if (bytes >= 1024 ** 2) return (bytes / 1024 ** 2).toFixed(1) + " MB";
  return Math.max(1, Math.round(bytes / 1024)) + " KB";
}

// Dropzone = <label> mit <input type="file"> (per Tastatur bedienbar)
export function bindDrop(label, input, onFile) {
  input.addEventListener("change", () => {
    if (input.files[0]) onFile(input.files[0]);
  });
  for (const ev of ["dragenter", "dragover"]) {
    label.addEventListener(ev, (e) => { e.preventDefault(); label.classList.add("drag"); });
  }
  for (const ev of ["dragleave", "drop"]) {
    label.addEventListener(ev, (e) => { e.preventDefault(); label.classList.remove("drag"); });
  }
  label.addEventListener("drop", (e) => {
    const f = e.dataTransfer.files[0];
    if (f) onFile(f);
  });
}

// Status, Fortschritt, Download und Log eines Tools (IDs mit Präfix, z. B. "mono-status")
export function createOutput(prefix) {
  const el = {
    status: $(`${prefix}-status`),
    wrap: $(`${prefix}-progress-wrap`),
    prog: $(`${prefix}-progress`),
    label: $(`${prefix}-progress-label`),
    dl: $(`${prefix}-download`),
    details: $(`${prefix}-details`),
    log: $(`${prefix}-log`),
    cancel: $(`${prefix}-cancel`),
  };
  let url = null;

  return {
    status(msg, kind = "") {
      el.status.textContent = msg;
      el.status.className = "status" + (kind ? " " + kind : "");
    },
    reset() {
      if (url) { URL.revokeObjectURL(url); url = null; }
      el.dl.hidden = true;
      el.details.hidden = true;
      el.wrap.hidden = true;
      this.status("");
    },
    progress(p) {
      el.wrap.hidden = false;
      if (p == null || !isFinite(p)) {
        el.prog.removeAttribute("value");
        el.label.textContent = "";
        return null;
      }
      const pct = Math.max(0, Math.min(100, Math.round(p * 100)));
      el.prog.value = pct;
      el.label.textContent = pct + " %";
      return pct;
    },
    hideProgress() { el.wrap.hidden = true; },
    // Abbrechen-Button nur während eines Laufs zeigen
    running(on, label, onCancel) {
      el.cancel.hidden = !on;
      if (label) el.cancel.textContent = label;
      if (onCancel) el.cancel.onclick = onCancel;
    },
    download(blob, name, label) {
      url = URL.createObjectURL(blob);
      el.dl.href = url;
      el.dl.download = name;
      el.dl.textContent = label;
      el.dl.hidden = false;
      // Die URL wird beim nächsten reset() freigegeben (sofortiges Freigeben bricht Downloads in manchen Browsern ab)
    },
    showLog(text) {
      el.log.textContent = text;
      el.details.hidden = false;
    },
  };
}
