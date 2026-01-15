"use strict";

/**
 * admin-gallery.js ✅ (Local-first)
 * - Admin sube fotos para la galería (SIN BD por ahora)
 * - Guarda en localStorage como DataURL (base64)
 * - Campos: nombre, tags, tipo (cocteles|maridajes), fecha automática
 *
 * Requiere:
 * - admin.html tenga #tab-gallery
 * - Elementos:
 *   #galleryForm, #galType, #galFile, #galName, #galTags, #galResetBtn, #galleryList, #galPreview
 *
 * Integra con admin.js:
 * - expone window.ECN_ADMIN_GALLERY = { init, render }
 */

(function () {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  if (!$("#appPanel")) return;

  // Panel
  const panel = $("#tab-gallery");
  if (!panel) return;

  // Elements
  const listEl = $("#galleryList", panel);

  const formEl = $("#galleryForm", panel);
  const typeSel = $("#galType", panel);
  const fileInp = $("#galFile", panel);
  const nameInp = $("#galName", panel);
  const tagsInp = $("#galTags", panel);
  const resetBtn = $("#galResetBtn", panel);

  // ✅ preview container real
  const previewBox = $("#galPreview", panel);

  // Toast: reutiliza admin.js si existe
  function toast(title, msg, timeoutMs = 3200) {
    try {
      if (typeof window.toast === "function") return window.toast(title, msg, timeoutMs);
    } catch (_) {}
    const toastsEl = $("#toasts");
    if (!toastsEl) return;
    const el = document.createElement("div");
    el.className = "toast";
    el.innerHTML = `
      <div>
        <p class="tTitle">${escapeHtml(title)}</p>
        <p class="tMsg">${escapeHtml(msg)}</p>
      </div>
      <button class="close" aria-label="Cerrar" type="button">✕</button>
    `;
    toastsEl.appendChild(el);
    const kill = () => {
      el.style.opacity = "0";
      el.style.transform = "translateY(-6px)";
      setTimeout(() => el.remove(), 180);
    };
    el.querySelector(".close")?.addEventListener("click", kill);
    setTimeout(kill, timeoutMs);
  }

  function escapeHtml(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (_) {
      return fallback;
    }
  }

  function writeJSON(key, val) {
    localStorage.setItem(key, JSON.stringify(val));
  }

  function uid(prefix = "gal") {
    return `${prefix}_${Math.random().toString(16).slice(2, 10)}${Date.now().toString(16).slice(-4)}`;
  }

  function clampStr(s, max) {
    const v = String(s || "").trim();
    if (!v) return "";
    return v.length > max ? v.slice(0, max) : v;
  }

  function normTags(input) {
    const raw = String(input || "")
      .replaceAll("\n", " ")
      .replaceAll("\r", " ")
      .trim();
    if (!raw) return [];
    const parts = raw
      .split(/[,; ]+/g)
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => (t.startsWith("#") ? t : `#${t}`))
      .map((t) => t.replace(/#+/g, "#"));
    return Array.from(new Set(parts)).slice(0, 12);
  }

  function nowISO() {
    return new Date().toISOString();
  }

  function fmtShortDate(iso) {
    try {
      const d = new Date(String(iso));
      if (isNaN(d.getTime())) return "—";
      return d
        .toLocaleDateString("es-CR", { day: "2-digit", month: "short", year: "numeric" })
        .replace(".", "");
    } catch (_) {
      return "—";
    }
  }

  function bytesFromDataUrl(dataUrl) {
    try {
      const base64 = String(dataUrl).split(",")[1] || "";
      const binary = atob(base64);
      return binary.length;
    } catch (_) {
      return 0;
    }
  }

  function humanKB(bytes) {
    const kb = bytes / 1024;
    if (kb < 1024) return `${Math.round(kb)} KB`;
    const mb = kb / 1024;
    return `${mb.toFixed(1)} MB`;
  }

  // Storage key
  const LS_KEY =
    (window.ECN && ECN.LS && ECN.LS.GALLERY) ? ECN.LS.GALLERY : "ecn_gallery_items";

  // State
  let state = {
    items: [],
    selectedFileDataUrl: "",
    selectedFileBytes: 0,
    didBind: false
  };

  function loadItems() {
    const arr = readJSON(LS_KEY, []);
    state.items = Array.isArray(arr) ? arr : [];
  }

  function saveItems() {
    writeJSON(LS_KEY, state.items);
  }

  function sortNewestFirst(arr) {
    return arr.slice().sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  }

  // ✅ Preview UI (se pinta dentro de #galPreview)
  function ensurePreviewSkeleton() {
    if (!previewBox) return null;

    if (!previewBox.dataset.ready) {
      previewBox.innerHTML = `
        <div class="notice" style="margin:0;">
          <span class="badge">Preview</span>
          <span>Seleccioná una foto para previsualizar.</span>
        </div>

        <div class="galPrev" style="margin-top:12px; display:grid; grid-template-columns: 120px 1fr; gap:12px; align-items:start;">
          <img id="galPreviewImg" alt="Preview" style="width:120px;height:120px;object-fit:cover;border-radius:0;border:1px solid rgba(255,255,255,.10);display:none;">
          <div>
            <p id="galPreviewTitle" class="itemTitle" style="margin:0 0 6px 0;">Sin imagen seleccionada</p>
            <p id="galPreviewMeta" class="itemMeta" style="margin:0 0 10px 0;">Seleccioná una foto para previsualizar.</p>
            <div id="galPreviewTags" class="pills" style="display:flex; flex-wrap:wrap; gap:8px;"></div>
          </div>
        </div>
      `;
      previewBox.dataset.ready = "1";
    }

    return {
      img: $("#galPreviewImg", previewBox),
      title: $("#galPreviewTitle", previewBox),
      meta: $("#galPreviewMeta", previewBox),
      tags: $("#galPreviewTags", previewBox),
    };
  }

  function resetPreview() {
    state.selectedFileDataUrl = "";
    state.selectedFileBytes = 0;

    const ui = ensurePreviewSkeleton();
    if (!ui) return;

    ui.img.src = "";
    ui.img.style.display = "none";
    ui.title.textContent = "Sin imagen seleccionada";
    ui.meta.textContent = "Seleccioná una foto para previsualizar.";
    ui.tags.innerHTML = "";
  }

  function renderPreview() {
    const ui = ensurePreviewSkeleton();
    if (!ui) return;

    const name = clampStr(nameInp ? nameInp.value : "", 70) || "(sin nombre)";
    const tags = normTags(tagsInp ? tagsInp.value : "");
    const type = typeSel ? String(typeSel.value || "maridajes") : "maridajes";

    ui.title.textContent = name;

    const meta = [
      type === "cocteles" ? "Cocteles" : "Maridajes",
      state.selectedFileBytes ? humanKB(state.selectedFileBytes) : "—",
      fmtShortDate(nowISO())
    ].join(" · ");

    ui.meta.textContent = meta;

    ui.tags.innerHTML = tags.length
      ? tags.map((t) => `<span class="pill">${escapeHtml(t)}</span>`).join("")
      : `<span class="pill">#sin-tags</span>`;

    if (state.selectedFileDataUrl) {
      ui.img.src = state.selectedFileDataUrl;
      ui.img.alt = name;
      ui.img.style.display = "block";
    } else {
      ui.img.src = "";
      ui.img.style.display = "none";
    }
  }

  // List render
  function renderList() {
    if (!listEl) return;

    const items = sortNewestFirst(state.items);
    listEl.innerHTML = "";

    if (!items.length) {
      listEl.innerHTML = `<div class="item" style="cursor:default;">
        <div>
          <p class="itemTitle">Sin fotos</p>
          <p class="itemMeta">Subí una imagen para empezar.</p>
        </div>
      </div>`;
      return;
    }

    const frag = document.createDocumentFragment();

    items.forEach((it) => {
      const row = document.createElement("div");
      row.className = "item";
      row.dataset.id = String(it.id || "");

      const typeLabel = String(it.type) === "cocteles" ? "Cocteles" : "Maridajes";
      const meta = `${typeLabel} • ${fmtShortDate(it.createdAt)} • ${(it.tags || []).length} tag(s)`;

      const tags = Array.isArray(it.tags) ? it.tags.slice(0, 6) : [];

      row.innerHTML = `
        <div style="display:flex; gap:12px; align-items:flex-start; width:100%;">
          <img src="${escapeHtml(it.dataUrl || "")}" alt="${escapeHtml(it.name || "Foto")}"
               style="width:70px;height:70px;object-fit:cover;border-radius:0;border:1px solid rgba(255,255,255,.10);flex:0 0 auto;" loading="lazy">
          <div style="flex:1 1 auto;">
            <p class="itemTitle">${escapeHtml(it.name || "Sin nombre")}</p>
            <p class="itemMeta">${escapeHtml(meta)}</p>
            <div class="pills" style="margin-top:8px;">
              ${tags.length ? tags.map((x) => `<span class="pill">${escapeHtml(x)}</span>`).join("") : `<span class="pill">#sin-tags</span>`}
            </div>
          </div>
          <div class="pills" style="justify-content:flex-end; flex:0 0 auto;">
            <button class="btn" type="button" data-action="copy">Copiar tags</button>
            <button class="btn" type="button" data-action="delete">Eliminar</button>
          </div>
        </div>
      `;

      frag.appendChild(row);
    });

    listEl.appendChild(frag);
  }

  // File change
  function onFileChange() {
    const f = fileInp && fileInp.files ? fileInp.files[0] : null;
    if (!f) {
      resetPreview();
      return;
    }

    if (!/^image\//.test(f.type)) {
      toast("Archivo inválido", "Seleccioná una imagen (JPG/PNG/WebP).");
      fileInp.value = "";
      resetPreview();
      return;
    }

    // Soft limit (localStorage)
    const MAX_MB = 2.2;
    const maxBytes = MAX_MB * 1024 * 1024;
    if (f.size > maxBytes) {
      toast("Muy pesada", `La imagen pesa ${humanKB(f.size)}. Usá una menor a ~${MAX_MB}MB por ahora.`);
      fileInp.value = "";
      resetPreview();
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      state.selectedFileDataUrl = dataUrl;
      state.selectedFileBytes = bytesFromDataUrl(dataUrl) || f.size;

      // autocompletar nombre si está vacío
      if (nameInp && !String(nameInp.value || "").trim()) {
        const base = f.name.replace(/\.[a-z0-9]+$/i, "");
        nameInp.value = base;
      }

      renderPreview();
    };
    reader.onerror = () => {
      toast("Error", "No se pudo leer la imagen.");
      resetPreview();
    };
    reader.readAsDataURL(f);
  }

  // Submit
  function onSubmit(e) {
    e.preventDefault();

    if (!state.selectedFileDataUrl) {
      toast("Falta imagen", "Seleccioná una foto antes de subir.");
      return;
    }

    const type = typeSel ? String(typeSel.value || "maridajes") : "maridajes";
    const name = clampStr(nameInp ? nameInp.value : "", 60);
    const tags = normTags(tagsInp ? tagsInp.value : "");

    if (!name) {
      toast("Falta nombre", "Poné un nombre para identificar la foto.");
      return;
    }

    const item = {
      id: uid("gal"),
      type: (type === "cocteles") ? "cocteles" : "maridajes",
      name,
      tags,
      createdAt: nowISO(),
      dataUrl: state.selectedFileDataUrl
    };

    loadItems();
    state.items.unshift(item);
    saveItems();

    toast("Listo", "La foto se agregó a la galería (local).");
    renderList();

    // limpiar form
    formEl?.reset();
    resetPreview();
  }

  // Reset button
  function onReset() {
    formEl?.reset();
    resetPreview();
    toast("Limpiado", "Formulario y preview reiniciados.");
  }

  // List actions
  function onListClick(e) {
    const btn = e.target && e.target.closest ? e.target.closest("[data-action]") : null;
    if (!btn) return;

    const row = btn.closest(".item");
    if (!row) return;

    const id = String(row.dataset.id || "");
    const action = String(btn.dataset.action || "");

    loadItems();
    const idx = state.items.findIndex((x) => String(x.id) === id);
    if (idx < 0) return;

    const it = state.items[idx];

    if (action === "delete") {
      const ok = confirm(`Eliminar esta foto?\n\n${it.name || "Sin nombre"}\n\n(Se borra solo en este navegador)`);
      if (!ok) return;
      state.items.splice(idx, 1);
      saveItems();
      renderList();
      toast("Eliminada", "Se eliminó la foto.");
      return;
    }

    if (action === "copy") {
      const text = (Array.isArray(it.tags) && it.tags.length) ? it.tags.join(" ") : "";
      if (!text) {
        toast("Sin tags", "Esta foto no tiene tags para copiar.");
        return;
      }
      navigator.clipboard?.writeText(text).then(
        () => toast("Copiado", "Tags copiados al portapapeles."),
        () => toast("Copiar", "No pude acceder al portapapeles.")
      );
      return;
    }
  }

  function bindOnce() {
    if (state.didBind) return;
    state.didBind = true;

    fileInp?.addEventListener("change", onFileChange);
    nameInp?.addEventListener("input", renderPreview);
    tagsInp?.addEventListener("input", renderPreview);
    typeSel?.addEventListener("change", renderPreview);

    formEl?.addEventListener("submit", onSubmit);
    resetBtn?.addEventListener("click", onReset);
    listEl?.addEventListener("click", onListClick);

    window.addEventListener("storage", (ev) => {
      if (ev && ev.key === LS_KEY) {
        loadItems();
        renderList();
      }
    });
  }

  // ✅ API pública para admin.js
  function init() {
    bindOnce();
    loadItems();
    renderList();
    resetPreview();
  }

  function render() {
    // para cuando cambias a tab gallery
    loadItems();
    renderList();
    // no resetea form, pero refresca preview si hay data
    renderPreview();
  }

  // ✅ Auto-init al cargar
  init();

  // ✅ Hook para admin.js (tu admin.js actualizado lo llama)
  window.ECN_ADMIN_GALLERY = { init, render };
})();
