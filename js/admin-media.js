/* ============================================================
   admin-media.js ✅ PRO (Supabase Storage PUBLIC) — v1
   - Bucket: "media" (PUBLIC recomendado)
   - Sube imágenes y genera URL pública
   - Lista objetos del bucket (por carpeta)
   - Preview + copiar URL + eliminar
   - No usa DB (ideal para "copiar y pegar URL" en Eventos/Promos)
   - Requiere: Supabase CDN -> supabaseClient.js -> admin-auth.js
   - UI: tab-media (IDs del HTML que ya tenés)
============================================================ */
(function () {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);

  // ------------------------------------------------------------
  // Guards
  // ------------------------------------------------------------
  if (!document.getElementById("appPanel")) return;

  if (!window.APP || !APP.supabase) {
    console.error("[admin-media] APP.supabase no existe. Orden: Supabase CDN -> supabaseClient.js -> admin-media.js");
    return;
  }

  const panel = document.getElementById("tab-media");
  if (!panel) return;

  // Form + fields
  const formEl = $("#mediaForm", panel);
  const fileInp = $("#mediaFile", panel);
  const folderSel = $("#mediaFolder", panel);
  const nameInp = $("#mediaName", panel);
  const urlInp = $("#mediaUrl", panel);

  const uploadBtn = $("#mediaUploadBtn", panel);
  const copyBtn = $("#mediaCopyBtn", panel);
  const resetBtn = $("#mediaResetBtn", panel);
  const noteEl = $("#mediaNote", panel);

  // Preview + list
  const previewEmpty = $("#mediaPreviewEmpty", panel);
  const previewWrap = $("#mediaPreview", panel);
  const previewImg = $("#mediaPreviewImg", panel);
  const previewMeta = $("#mediaPreviewMeta", panel);

  const refreshBtn = $("#mediaRefreshBtn", panel);
  const listEl = $("#mediaList", panel);

  if (!formEl || !fileInp || !folderSel || !urlInp || !uploadBtn || !copyBtn || !resetBtn || !refreshBtn || !listEl) {
    console.warn("[admin-media] Faltan elementos en el HTML del tab-media.");
    return;
  }

  // ------------------------------------------------------------
  // Config
  // ------------------------------------------------------------
  const BUCKET = "media";

  const MAX_MB = 6;
  const MAX_BYTES = MAX_MB * 1024 * 1024;

  const ENABLE_REALTIME = false; // Storage no tiene realtime como Postgres; lo dejamos off
  const LIST_LIMIT = 60;         // máximo items mostrados

  // ------------------------------------------------------------
  // Toast / Note
  // ------------------------------------------------------------
  function escapeHtml(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function toast(title, msg, timeoutMs = 3200) {
    try { if (typeof window.toast === "function") return window.toast(title, msg, timeoutMs); } catch (_) {}
    try { if (window.APP && typeof APP.toast === "function") return APP.toast(title, msg, timeoutMs); } catch (_) {}

    const toastsEl = document.getElementById("toasts");
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

  function setNote(msg, kind) {
    if (!noteEl) return;
    noteEl.textContent = msg || "";
    noteEl.dataset.kind = kind || "";
  }

  // ------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------
  function safeStr(x) { return String(x ?? ""); }
  function cleanSpaces(s) { return safeStr(s).replace(/\s+/g, " ").trim(); }

  function slugify(s) {
    return cleanSpaces(s)
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9\-]/g, "")
      .replace(/\-+/g, "-")
      .replace(/^\-|\-$/g, "");
  }

  function extFromNameOrMime(file) {
    const name = safeStr(file?.name || "");
    const m = safeStr(file?.type || "").toLowerCase();

    const fromName = (name.split(".").pop() || "").toLowerCase();
    if (["jpg","jpeg","png","webp","gif"].includes(fromName)) return fromName === "jpeg" ? "jpg" : fromName;

    if (m.includes("png")) return "png";
    if (m.includes("webp")) return "webp";
    if (m.includes("gif")) return "gif";
    return "jpg";
  }

  function humanKB(bytes) {
    const b = Number(bytes || 0);
    if (!Number.isFinite(b) || b <= 0) return "—";
    const kb = b / 1024;
    if (kb < 1024) return `${Math.round(kb)} KB`;
    const mb = kb / 1024;
    return `${mb.toFixed(1)} MB`;
  }

  function fmtShortDate(isoOrMs) {
    try {
      const d = typeof isoOrMs === "number" ? new Date(isoOrMs) : new Date(safeStr(isoOrMs));
      if (isNaN(d.getTime())) return "—";
      return d.toLocaleDateString("es-CR", { day: "2-digit", month: "short", year: "numeric" }).replace(".", "");
    } catch (_) {
      return "—";
    }
  }

  function looksLikeRLSError(err) {
    const m = safeStr(err?.message || err || "").toLowerCase();
    return m.includes("rls") || m.includes("row level security") || m.includes("permission") || m.includes("not allowed");
  }

  function looksLikeStorageError(err) {
    const m = safeStr(err?.message || err || "").toLowerCase();
    return m.includes("bucket") || m.includes("storage") || m.includes("object") || m.includes("not found");
  }

  async function ensureSession() {
    try {
      const res = await APP.supabase.auth.getSession();
      const s = res?.data?.session || null;
      if (!s) {
        toast("Sesión", "Tu sesión expiró. Volvé a iniciar sesión.", 3600);
        return null;
      }
      return s;
    } catch (_) {
      toast("Error", "No se pudo validar sesión con Supabase.", 3200);
      return null;
    }
  }

  function publicUrlFromPath(path) {
    const p = cleanSpaces(path);
    if (!p) return "";
    try {
      const res = APP.supabase.storage.from(BUCKET).getPublicUrl(p);
      return res?.data?.publicUrl || "";
    } catch (_) {
      return "";
    }
  }

  // ------------------------------------------------------------
  // State
  // ------------------------------------------------------------
  let state = {
    previewUrl: "",
    lastUploadedPath: "",
    list: [],
    busy: false,
    currentFolder: cleanSpaces(folderSel.value) || "events"
  };

  function setBusy(on) {
    state.busy = !!on;
    try {
      const els = panel.querySelectorAll("input, select, button, textarea");
      els.forEach((el) => (el.disabled = state.busy));
    } catch (_) {}

    try {
      uploadBtn.textContent = state.busy ? "Subiendo…" : "Subir";
    } catch (_) {}
  }

  // ------------------------------------------------------------
  // Preview
  // ------------------------------------------------------------
  function resetPreview() {
    if (state.previewUrl) {
      try { URL.revokeObjectURL(state.previewUrl); } catch (_) {}
      state.previewUrl = "";
    }
    if (previewImg) previewImg.src = "";
    if (previewMeta) previewMeta.textContent = "";
    if (previewWrap) previewWrap.hidden = true;
    if (previewEmpty) previewEmpty.hidden = false;
  }

  function renderPreview(file) {
    if (!file) { resetPreview(); return; }

    try {
      if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    } catch (_) {}

    state.previewUrl = URL.createObjectURL(file);

    if (previewImg) {
      previewImg.src = state.previewUrl;
      previewImg.alt = file.name || "Preview";
    }

    const meta = [
      file.name || "archivo",
      humanKB(file.size),
      (file.type || "image/*"),
      fmtShortDate(Date.now())
    ].join(" · ");

    if (previewMeta) previewMeta.textContent = meta;

    if (previewEmpty) previewEmpty.hidden = true;
    if (previewWrap) previewWrap.hidden = false;
  }

  // ------------------------------------------------------------
  // Storage: list/upload/delete
  // ------------------------------------------------------------
  async function listFolder(folder) {
    const f = cleanSpaces(folder) || "events";

    // Lista simple del folder. Si tenés subfolders profundos, se listan por niveles.
    const { data, error } = await APP.supabase.storage
      .from(BUCKET)
      .list(f, { limit: LIST_LIMIT, offset: 0, sortBy: { column: "updated_at", order: "desc" } });

    if (error) throw error;

    const items = Array.isArray(data) ? data : [];

    // Convertimos a rows "renderables"
    return items
      .filter((x) => x && x.name && !x.name.endsWith("/"))
      .map((x) => {
        const path = `${f}/${x.name}`;
        return {
          name: x.name,
          path,
          url: publicUrlFromPath(path),
          updated_at: x.updated_at || x.created_at || "",
          size: x.metadata?.size || 0,
          mime: x.metadata?.mimetype || ""
        };
      })
      .sort((a, b) => safeStr(b.updated_at).localeCompare(safeStr(a.updated_at)));
  }

  async function uploadFile(file, folder, customName) {
    const f = cleanSpaces(folder) || "events";

    const ext = extFromNameOrMime(file);
    const base = slugify(customName) || slugify(file.name.replace(/\.[a-z0-9]+$/i, "")) || "img";
    const path = `${f}/${base}_${Date.now()}.${ext}`;

    const { error } = await APP.supabase.storage.from(BUCKET).upload(path, file, {
      cacheControl: "3600",
      upsert: false
    });
    if (error) throw error;

    return path;
  }

  async function deleteObject(path) {
    const p = cleanSpaces(path);
    if (!p) return;

    const { error } = await APP.supabase.storage.from(BUCKET).remove([p]);
    if (error) throw error;
    return true;
  }

  // ------------------------------------------------------------
  // Render list
  // ------------------------------------------------------------
  function esc(s) { return escapeHtml(safeStr(s)); }

  function renderList() {
    const arr = Array.isArray(state.list) ? state.list : [];
    listEl.innerHTML = "";

    if (!arr.length) {
      listEl.innerHTML = `
        <div class="item" style="cursor:default;">
          <div>
            <p class="itemTitle">Sin archivos en <b>${esc(state.currentFolder)}</b></p>
            <p class="itemMeta">Subí una imagen para que aparezca aquí.</p>
          </div>
        </div>`;
      return;
    }

    const frag = document.createDocumentFragment();

    arr.forEach((it) => {
      const row = document.createElement("div");
      row.className = "item";
      row.dataset.path = it.path || "";
      row.dataset.url = it.url || "";

      row.innerHTML = `
        <div style="display:flex; gap:12px; align-items:flex-start; width:100%;">
          <img src="${esc(it.url)}" alt="${esc(it.name)}"
               style="width:70px;height:70px;object-fit:cover;border-radius:0;border:1px solid rgba(255,255,255,.10);flex:0 0 auto;" loading="lazy">
          <div style="flex:1 1 auto;">
            <p class="itemTitle">${esc(it.name)}</p>
            <p class="itemMeta">${esc(fmtShortDate(it.updated_at))} · ${esc(humanKB(it.size))}</p>
            <p class="itemMeta" style="opacity:.75;">${esc(it.path)}</p>
          </div>
          <div class="pills" style="justify-content:flex-end; flex:0 0 auto;">
            <button class="btn" type="button" data-act="use">Usar</button>
            <button class="btn" type="button" data-act="copy">Copiar URL</button>
            <button class="btn" type="button" data-act="delete">Eliminar</button>
          </div>
        </div>
      `;

      frag.appendChild(row);
    });

    listEl.appendChild(frag);
  }

  // ------------------------------------------------------------
  // Refresh list
  // ------------------------------------------------------------
  async function refreshList() {
    try {
      setNote("", "");
      const s = await ensureSession();
      if (!s) return;

      state.currentFolder = cleanSpaces(folderSel.value) || state.currentFolder || "events";
      state.list = await listFolder(state.currentFolder);

      renderList();
    } catch (err) {
      console.error(err);
      if (looksLikeRLSError(err)) {
        toast("RLS", "Acceso bloqueado. Falta policy SELECT en bucket media.", 4200);
      } else if (looksLikeStorageError(err)) {
        toast("Storage", "Error en bucket media (existe? policies? público?).", 4200);
      } else {
        toast("Error", "No se pudo cargar la lista del bucket media.", 4200);
      }
    }
  }

  // ------------------------------------------------------------
  // File input change -> preview
  // ------------------------------------------------------------
  function onFileChange() {
    const f = fileInp.files && fileInp.files[0] ? fileInp.files[0] : null;
    if (!f) { resetPreview(); return; }

    if (!/^image\//.test(f.type)) {
      toast("Archivo inválido", "Seleccioná una imagen (JPG/PNG/WebP).");
      fileInp.value = "";
      resetPreview();
      return;
    }

    if (Number(f.size || 0) > MAX_BYTES) {
      toast("Muy pesada", `La imagen pesa ${humanKB(f.size)}. Usá una menor a ~${MAX_MB}MB.`);
      fileInp.value = "";
      resetPreview();
      return;
    }

    renderPreview(f);
  }

  // ------------------------------------------------------------
  // Submit upload
  // ------------------------------------------------------------
  async function onUpload(e) {
    e.preventDefault();

    const file = fileInp.files && fileInp.files[0] ? fileInp.files[0] : null;
    if (!file) {
      toast("Falta imagen", "Seleccioná una imagen antes de subir.");
      return;
    }

    const folder = cleanSpaces(folderSel.value) || "events";
    const customName = cleanSpaces(nameInp.value || "");

    setBusy(true);
    try {
      setNote("Subiendo a Supabase…", "info");
      const s = await ensureSession();
      if (!s) return;

      const path = await uploadFile(file, folder, customName);
      const url = publicUrlFromPath(path);

      state.lastUploadedPath = path;
      urlInp.value = url || "";

      setNote("Listo. URL pública generada.", "ok");
      toast("Subido", "Imagen subida y URL lista para copiar.", 2200);

      // refresca lista y selecciona “use”
      await refreshList();

      // limpia input file (pero deja URL)
      fileInp.value = "";
      resetPreview();
    } catch (err) {
      console.error(err);
      setNote("", "");

      if (looksLikeRLSError(err)) {
        toast("RLS", "Bloqueado. Falta policy INSERT en bucket media para authenticated.", 4200);
      } else if (looksLikeStorageError(err)) {
        toast("Storage", "Error en bucket media (policies / nombre / ruta).", 4200);
      } else {
        toast("Error", "No se pudo subir la imagen.", 4200);
      }
    } finally {
      setBusy(false);
    }
  }

  // ------------------------------------------------------------
  // Copy URL
  // ------------------------------------------------------------
  async function copyUrl(text) {
    const t = cleanSpaces(text || "");
    if (!t) {
      toast("Sin URL", "Primero subí o seleccioná un archivo de la lista.");
      return;
    }
    try {
      await navigator.clipboard.writeText(t);
      toast("Copiado", "URL copiada al portapapeles.", 1800);
    } catch (_) {
      toast("Copiar", "No pude acceder al portapapeles. Copiala manualmente.", 2800);
    }
  }

  // ------------------------------------------------------------
  // Reset form
  // ------------------------------------------------------------
  function onReset() {
    formEl.reset();
    urlInp.value = "";
    setNote("", "");
    resetPreview();
    toast("Limpiado", "Formulario reiniciado.");
    // no refrescamos lista aquí a propósito
  }

  // ------------------------------------------------------------
  // List actions (delegation)
  // ------------------------------------------------------------
  async function onListClick(e) {
    const btn = e.target && e.target.closest ? e.target.closest("[data-act]") : null;
    if (!btn) return;

    const row = btn.closest(".item");
    if (!row) return;

    const act = btn.dataset.act;
    const path = row.dataset.path || "";
    const url = row.dataset.url || "";

    if (act === "use") {
      // llena URL y muestra preview
      urlInp.value = url || "";
      setNote("URL lista. Pegala en Eventos/Promos/Galería.", "ok");

      if (previewImg && url) {
        if (previewEmpty) previewEmpty.hidden = true;
        if (previewWrap) previewWrap.hidden = false;
        previewImg.src = url;
        previewImg.alt = "Seleccionada";
        if (previewMeta) previewMeta.textContent = `${path} · ${fmtShortDate(Date.now())}`;
      }
      toast("Seleccionada", "URL cargada en el campo.", 1600);
      return;
    }

    if (act === "copy") {
      await copyUrl(url || urlInp.value);
      return;
    }

    if (act === "delete") {
      const ok = confirm(`¿Eliminar este archivo?\n\n${path}\n\n(Se borra del bucket media)`);
      if (!ok) return;

      setBusy(true);
      try {
        const s = await ensureSession();
        if (!s) return;

        await deleteObject(path);

        // Si estabas usando ese url, lo limpiamos
        if (cleanSpaces(urlInp.value) === cleanSpaces(url)) {
          urlInp.value = "";
        }

        toast("Eliminado", "Archivo eliminado del bucket.", 2200);
        await refreshList();
      } catch (err) {
        console.error(err);
        if (looksLikeRLSError(err)) toast("RLS", "Bloqueado. Falta policy DELETE en bucket media.", 4200);
        else toast("Error", "No se pudo eliminar el archivo.", 4200);
      } finally {
        setBusy(false);
      }
      return;
    }
  }

  // ------------------------------------------------------------
  // Bind
  // ------------------------------------------------------------
  fileInp.addEventListener("change", onFileChange);
  folderSel.addEventListener("change", () => refreshList());
  refreshBtn.addEventListener("click", refreshList);

  formEl.addEventListener("submit", onUpload);
  copyBtn.addEventListener("click", () => copyUrl(urlInp.value));
  resetBtn.addEventListener("click", onReset);

  listEl.addEventListener("click", onListClick);

  // ------------------------------------------------------------
  // Init
  // ------------------------------------------------------------
  (async function init() {
    setNote("", "");
    resetPreview();
    await refreshList();

    if (ENABLE_REALTIME) {
      // (Storage no realtime real; placeholder)
    }

    // Debug mínimo
    console.log("[admin-media] ready. bucket:", BUCKET);
  })();
})();
