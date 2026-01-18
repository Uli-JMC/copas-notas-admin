"use strict";

/**
 * admin-media.js ✅ PRO (Storage + DB metadata)
 * - Sube imágenes al bucket "media" y guarda metadata en public.media_items
 * - Lista ordenada desde DB (no depende de listar bucket)
 * - Copia URL pública
 * - Preview local + preview de items existentes
 *
 * UI (admin.html):
 * - #tab-media
 * - #mediaForm, #mediaFile, #mediaFolder, #mediaName
 * - #mediaUrl, #mediaUploadBtn, #mediaCopyBtn, #mediaResetBtn
 * - #mediaNote
 * - #mediaPreviewEmpty, #mediaPreview, #mediaPreviewImg, #mediaPreviewMeta
 * - #mediaRefreshBtn, #mediaList
 *
 * Supabase esperado:
 * - Bucket Storage: "media" (PUBLIC recomendado)
 * - Tabla public.media_items (RLS):
 *   - SELECT/INSERT/DELETE solo admins (via public.admins(user_id))
 */

(function () {
  const $ = (sel, root = document) => root.querySelector(sel);

  // ------------------------------------------------------------
  // Guards base
  // ------------------------------------------------------------
  if (!document.getElementById("appPanel")) return;

  if (!window.APP || !APP.supabase) {
    console.error("APP.supabase no existe. Orden: Supabase CDN -> supabaseClient.js -> admin-media.js");
    return;
  }

  const panel = document.getElementById("tab-media");
  if (!panel) return;

  // ------------------------------------------------------------
  // UI refs
  // ------------------------------------------------------------
  const formEl = $("#mediaForm", panel);
  const fileInp = $("#mediaFile", panel);
  const folderSel = $("#mediaFolder", panel);
  const nameInp = $("#mediaName", panel);

  const urlInp = $("#mediaUrl", panel);
  const uploadBtn = $("#mediaUploadBtn", panel);
  const copyBtn = $("#mediaCopyBtn", panel);
  const resetBtn = $("#mediaResetBtn", panel);

  const noteEl = $("#mediaNote", panel);

  const previewEmpty = $("#mediaPreviewEmpty", panel);
  const previewBox = $("#mediaPreview", panel);
  const prevImg = $("#mediaPreviewImg", panel);
  const prevMeta = $("#mediaPreviewMeta", panel);

  const refreshBtn = $("#mediaRefreshBtn", panel);
  const listEl = $("#mediaList", panel);

  if (!formEl || !fileInp || !folderSel || !urlInp || !listEl) {
    console.warn("[admin-media] Faltan elementos de UI en admin.html (#tab-media).");
    return;
  }

  // ------------------------------------------------------------
  // Config
  // ------------------------------------------------------------
  const TABLE = "media_items";
  const BUCKET = "media";
  const TARGET_DEFAULT = "home";

  const ENABLE_REALTIME = true;
  const REALTIME_DEBOUNCE_MS = 250;

  const MAX_MB = 6;
  const MAX_BYTES = MAX_MB * 1024 * 1024;

  // ------------------------------------------------------------
  // Toast (unificado)
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
    try {
      if (typeof window.toast === "function") return window.toast(title, msg, timeoutMs);
    } catch (_) {}
    try {
      if (window.APP && typeof APP.toast === "function") return APP.toast(title, msg, timeoutMs);
    } catch (_) {}

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

  // ------------------------------------------------------------
  // Utils
  // ------------------------------------------------------------
  function safeStr(x) { return String(x ?? ""); }
  function cleanSpaces(s) { return safeStr(s).replace(/\s+/g, " ").trim(); }

  function esc(s) { return escapeHtml(safeStr(s)); }

  function nowISO() { return new Date().toISOString(); }

  function fmtShortDate(iso) {
    try {
      const d = new Date(safeStr(iso));
      if (isNaN(d.getTime())) return "—";
      return d.toLocaleDateString("es-CR", { day: "2-digit", month: "short", year: "numeric" }).replace(".", "");
    } catch (_) {
      return "—";
    }
  }

  function humanKB(bytes) {
    const b = Number(bytes || 0);
    if (!Number.isFinite(b) || b <= 0) return "—";
    const kb = b / 1024;
    if (kb < 1024) return `${Math.round(kb)} KB`;
    const mb = kb / 1024;
    return `${mb.toFixed(1)} MB`;
  }

  function extFromMimeOrName(mime, fileName) {
    const m = safeStr(mime).toLowerCase();
    if (m.includes("png")) return "png";
    if (m.includes("webp")) return "webp";
    if (m.includes("gif")) return "gif";
    if (m.includes("jpeg") || m.includes("jpg")) return "jpg";

    const n = safeStr(fileName).toLowerCase();
    const mm = n.match(/\.([a-z0-9]+)$/i);
    const ext = mm ? mm[1] : "";
    if (ext === "png" || ext === "webp" || ext === "gif" || ext === "jpg" || ext === "jpeg") {
      return ext === "jpeg" ? "jpg" : ext;
    }
    return "jpg";
  }

  function slugify(s) {
    return cleanSpaces(s)
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9\-]/g, "")
      .replace(/\-+/g, "-")
      .replace(/^\-|\-$/g, "");
  }

  function looksLikeRLSError(err) {
    const m = safeStr(err?.message || "").toLowerCase();
    return (
      m.includes("rls") ||
      m.includes("row level security") ||
      m.includes("not allowed") ||
      m.includes("permission") ||
      m.includes("new row violates row-level security")
    );
  }

  function looksLikeBucketError(err) {
    const m = safeStr(err?.message || "").toLowerCase();
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

  function setNote(msg, isError) {
    if (!noteEl) return;
    noteEl.textContent = safeStr(msg || "");
    noteEl.style.opacity = msg ? "1" : "0.85";
    noteEl.style.color = isError ? "rgba(255,140,140,.95)" : "rgba(255,255,255,.75)";
  }

  function setBusy(on) {
    try {
      const els = formEl.querySelectorAll("input, select, button");
      els.forEach((el) => (el.disabled = !!on));
    } catch (_) {}

    if (uploadBtn) uploadBtn.textContent = on ? "Subiendo…" : "Subir";
  }

  // ------------------------------------------------------------
  // State
  // ------------------------------------------------------------
  let state = {
    items: [],
    selectedFile: null,
    selectedBytes: 0,
    selectedPreviewUrl: "",
    refreshing: false,
    pendingRefresh: false,
    didBind: false,
    channel: null
  };

  // ------------------------------------------------------------
  // Storage helpers
  // ------------------------------------------------------------
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

  async function uploadToStorage(file, path) {
    const { error } = await APP.supabase.storage.from(BUCKET).upload(path, file, {
      cacheControl: "3600",
      upsert: false
    });
    if (error) throw error;
    return true;
  }

  async function deleteStorageObject(path) {
    const p = cleanSpaces(path);
    if (!p) return;
    const { error } = await APP.supabase.storage.from(BUCKET).remove([p]);
    if (error) throw error;
  }

  // ------------------------------------------------------------
  // DB helpers
  // ------------------------------------------------------------
  function mapDbRow(r) {
    const row = r || {};
    return {
      id: row.id,
      target: safeStr(row.target || TARGET_DEFAULT),
      folder: safeStr(row.folder || "misc"),
      name: safeStr(row.name || "archivo"),
      path: safeStr(row.path || ""),
      public_url: safeStr(row.public_url || ""),
      mime: safeStr(row.mime || ""),
      bytes: Number(row.bytes || 0),
      created_at: safeStr(row.created_at || ""),
      updated_at: safeStr(row.updated_at || "")
    };
  }

  function stableSort(arr) {
    return (arr || []).slice().sort((a, b) => {
      const ca = safeStr(a?.created_at || "");
      const cb = safeStr(b?.created_at || "");
      const dcmp = cb.localeCompare(ca);
      if (dcmp !== 0) return dcmp;

      const na = safeStr(a?.name || "");
      const nb = safeStr(b?.name || "");
      const ncmp = na.localeCompare(nb);
      if (ncmp !== 0) return ncmp;

      return safeStr(a?.id || "").localeCompare(safeStr(b?.id || ""));
    });
  }

  async function fetchItems() {
    const { data, error } = await APP.supabase
      .from(TABLE)
      .select("*")
      .eq("target", TARGET_DEFAULT)
      .order("created_at", { ascending: false })
      .order("name", { ascending: true });

    if (error) throw error;

    const rows = Array.isArray(data) ? data.map(mapDbRow) : [];
    rows.forEach((it) => {
      if (!it.public_url && it.path) it.public_url = publicUrlFromPath(it.path);
    });

    return stableSort(rows);
  }

  async function insertDbRow(payload) {
    const { data, error } = await APP.supabase.from(TABLE).insert(payload).select("*").single();
    if (error) throw error;
    return mapDbRow(data);
  }

  async function deleteDbRow(id) {
    const { data, error } = await APP.supabase
      .from(TABLE)
      .delete()
      .eq("id", id)
      .select("id,path,public_url")
      .single();

    if (error) throw error;
    return data || null;
  }

  // ------------------------------------------------------------
  // Preview
  // ------------------------------------------------------------
  function resetPreview() {
    state.selectedFile = null;
    state.selectedBytes = 0;

    if (state.selectedPreviewUrl) {
      try { URL.revokeObjectURL(state.selectedPreviewUrl); } catch (_) {}
      state.selectedPreviewUrl = "";
    }

    if (prevImg) prevImg.src = "";
    if (previewBox) previewBox.hidden = true;
    if (previewEmpty) previewEmpty.hidden = false;

    if (prevMeta) prevMeta.textContent = "";
    if (urlInp) urlInp.value = "";
    if (setNote) setNote("", false);
  }

  function showPreview(url, metaText) {
    if (prevImg) prevImg.src = url || "";
    if (prevMeta) prevMeta.textContent = metaText || "";

    if (previewEmpty) previewEmpty.hidden = true;
    if (previewBox) previewBox.hidden = false;
  }

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

    if (Number(f.size || 0) > MAX_BYTES) {
      toast("Muy pesada", `La imagen pesa ${humanKB(f.size)}. Usá una menor a ~${MAX_MB}MB.`);
      fileInp.value = "";
      resetPreview();
      return;
    }

    try {
      if (state.selectedPreviewUrl) URL.revokeObjectURL(state.selectedPreviewUrl);
    } catch (_) {}

    state.selectedFile = f;
    state.selectedBytes = Number(f.size || 0);
    state.selectedPreviewUrl = URL.createObjectURL(f);

    // si no hay nombre, usar base del file
    const nm = cleanSpaces(nameInp ? nameInp.value : "");
    if (!nm && nameInp) {
      const base = safeStr(f.name).replace(/\.[a-z0-9]+$/i, "");
      nameInp.value = base;
    }

    const folder = safeStr(folderSel?.value || "misc");
    const meta = `${folder} • ${humanKB(state.selectedBytes)} • ${fmtShortDate(nowISO())}`;
    showPreview(state.selectedPreviewUrl, meta);

    setNote("Listo para subir.", false);
  }

  // ------------------------------------------------------------
  // Render list
  // ------------------------------------------------------------
  function renderList() {
    if (!listEl) return;

    const q = cleanSpaces(document.getElementById("search")?.value || "").toLowerCase();
    const items = stableSort(state.items || []).filter((it) => {
      if (!q) return true;
      const hay = (
        safeStr(it.name).toLowerCase().includes(q) ||
        safeStr(it.folder).toLowerCase().includes(q) ||
        safeStr(it.path).toLowerCase().includes(q)
      );
      return hay;
    });

    listEl.innerHTML = "";

    if (!items.length) {
      listEl.innerHTML = `
        <div class="item" style="cursor:default;">
          <div>
            <p class="itemTitle">Sin medios</p>
            <p class="itemMeta">Subí una imagen para empezar.</p>
          </div>
        </div>`;
      return;
    }

    const frag = document.createDocumentFragment();

    items.forEach((it) => {
      const row = document.createElement("div");
      row.className = "item";
      row.dataset.id = safeStr(it.id || "");

      const url = it.public_url || publicUrlFromPath(it.path) || "";
      const meta = `${it.folder} • ${humanKB(it.bytes)} • ${fmtShortDate(it.created_at)}`;

      row.innerHTML = `
        <div style="display:flex; gap:12px; align-items:flex-start; width:100%;">
          <img src="${esc(url)}" alt="${esc(it.name || "Imagen")}"
               style="width:70px;height:70px;object-fit:cover;border-radius:0;border:1px solid rgba(255,255,255,.10);flex:0 0 auto;"
               loading="lazy">
          <div style="flex:1 1 auto;">
            <p class="itemTitle">${esc(it.name || "Sin nombre")}</p>
            <p class="itemMeta">${esc(meta)}</p>
            <p class="itemMeta" style="opacity:.75; margin-top:6px; word-break:break-all;">
              ${esc(url)}
            </p>
          </div>
          <div class="pills" style="justify-content:flex-end; flex:0 0 auto;">
            <button class="btn" type="button" data-action="view">Ver</button>
            <button class="btn" type="button" data-action="copy">Copiar URL</button>
            <button class="btn" type="button" data-action="delete">Eliminar</button>
          </div>
        </div>
      `;

      frag.appendChild(row);
    });

    listEl.appendChild(frag);
  }

  // ------------------------------------------------------------
  // Refresh
  // ------------------------------------------------------------
  async function refreshList() {
    if (state.refreshing) {
      state.pendingRefresh = true;
      return;
    }
    state.refreshing = true;

    try {
      const s = await ensureSession();
      if (!s) return;

      state.items = await fetchItems();
      renderList();
      setNote(`Cargados: ${state.items.length}`, false);
    } catch (err) {
      console.error(err);
      if (looksLikeRLSError(err)) {
        toast("RLS", "Acceso bloqueado. Falta policy SELECT en media_items.", 4200);
      } else {
        toast("Error", "No se pudo cargar Medios. Revisá tabla/policies.", 4200);
      }
    } finally {
      state.refreshing = false;
      if (state.pendingRefresh) {
        state.pendingRefresh = false;
        setTimeout(refreshList, 0);
      }
    }
  }

  // ------------------------------------------------------------
  // Submit (upload + insert DB)
  // ------------------------------------------------------------
  async function onSubmit(e) {
    e.preventDefault();

    const f = state.selectedFile || (fileInp.files ? fileInp.files[0] : null);
    if (!f) {
      toast("Falta imagen", "Seleccioná una imagen antes de subir.");
      return;
    }

    if (Number(f.size || 0) > MAX_BYTES) {
      toast("Muy pesada", `La imagen pesa ${humanKB(f.size)}. Usá una menor a ~${MAX_MB}MB.`);
      return;
    }

    const folder = cleanSpaces(folderSel?.value || "misc") || "misc";
    const rawName = cleanSpaces(nameInp?.value || "") || safeStr(f.name).replace(/\.[a-z0-9]+$/i, "");
    const base = slugify(rawName) || "img";

    setBusy(true);
    setNote("Subiendo…", false);

    try {
      const s = await ensureSession();
      if (!s) return;

      const yyyyMm = nowISO().slice(0, 7);
      const ext = extFromMimeOrName(f.type, f.name);
      const path = `${folder}/${yyyyMm}/${base}_${Date.now()}.${ext}`;

      await uploadToStorage(f, path);

      const publicUrl = publicUrlFromPath(path);
      if (!publicUrl) {
        toast("Storage", "Subió, pero no pude generar URL pública. Revisá que el bucket sea PUBLIC.", 4200);
      }

      const payload = {
        target: TARGET_DEFAULT,
        folder,
        name: rawName,
        path,
        public_url: publicUrl || null,
        mime: safeStr(f.type || ""),
        bytes: Number(f.size || 0)
      };

      await insertDbRow(payload);

      if (urlInp) urlInp.value = publicUrl || "";
      showPreview(publicUrl || state.selectedPreviewUrl, `${folder} • ${humanKB(f.size)} • ${fmtShortDate(nowISO())}`);

      toast("Listo", "Imagen subida y guardada en Medios.", 2200);

      // reset file input (pero dejamos la URL lista)
      try { fileInp.value = ""; } catch (_) {}
      state.selectedFile = null;

      await refreshList();
      setNote("Subida completada.", false);
    } catch (err) {
      console.error(err);
      if (looksLikeRLSError(err)) {
        toast("RLS", "Bloqueado. Falta policy INSERT en media_items o policies de Storage.", 4200);
      } else if (looksLikeBucketError(err)) {
        toast("Storage", "Error en bucket media (existe? policies? público?).", 4200);
      } else {
        toast("Error", "No se pudo subir. Revisá bucket/policies/RLS.", 4200);
      }
      setNote("Error al subir. Revisá consola.", true);
    } finally {
      setBusy(false);
    }
  }

  // ------------------------------------------------------------
  // List actions
  // ------------------------------------------------------------
  async function onListClick(e) {
    const btn = e.target && e.target.closest ? e.target.closest("[data-action]") : null;
    if (!btn) return;

    const row = btn.closest(".item");
    if (!row) return;

    const id = safeStr(row.dataset.id || "");
    const action = safeStr(btn.dataset.action || "");

    const it = (state.items || []).find((x) => safeStr(x.id) === id);
    if (!it) return;

    const url = it.public_url || publicUrlFromPath(it.path) || "";

    if (action === "view") {
      if (urlInp) urlInp.value = url;
      showPreview(url, `${it.folder} • ${humanKB(it.bytes)} • ${fmtShortDate(it.created_at)}`);
      setNote("Preview cargado desde la lista.", false);
      return;
    }

    if (action === "copy") {
      if (!url) {
        toast("Sin URL", "Este item no tiene URL pública disponible.");
        return;
      }
      navigator.clipboard?.writeText(url).then(
        () => toast("Copiado", "URL copiada al portapapeles.", 2200),
        () => toast("Copiar", "No pude acceder al portapapeles.", 3200)
      );
      if (urlInp) urlInp.value = url;
      return;
    }

    if (action === "delete") {
      const ok = confirm(`¿Eliminar este medio?\n\n${it.name || "Sin nombre"}\n\nSe borra de DB y Storage.`);
      if (!ok) return;

      setBusy(true);
      setNote("Eliminando…", false);

      try {
        const s = await ensureSession();
        if (!s) return;

        // 1) borrar DB (devuelve path)
        const deleted = await deleteDbRow(it.id);

        // 2) borrar Storage (best-effort)
        const p = deleted?.path || it.path;
        if (p) {
          try {
            await deleteStorageObject(p);
          } catch (e2) {
            console.warn("[admin-media] Storage delete fail:", e2);
          }
        }

        toast("Eliminado", "Se eliminó el medio.", 2200);

        // si estabas previsualizando ese url, reset
        const currUrl = safeStr(urlInp?.value || "");
        if (currUrl && currUrl === url) resetPreview();

        await refreshList();
        setNote("Eliminación completada.", false);
      } catch (err) {
        console.error(err);
        if (looksLikeRLSError(err)) {
          toast("RLS", "Bloqueado. Falta policy DELETE en media_items o Storage.", 4200);
        } else {
          toast("Error", "No se pudo eliminar. Revisá policies.", 4200);
        }
        setNote("Error al eliminar. Revisá consola.", true);
      } finally {
        setBusy(false);
      }
      return;
    }
  }

  // ------------------------------------------------------------
  // Copy/Reset/Refresh
  // ------------------------------------------------------------
  function onCopyUrl() {
    const url = cleanSpaces(urlInp?.value || "");
    if (!url) {
      toast("Sin URL", "Primero subí o seleccioná un medio para obtener una URL.");
      return;
    }
    navigator.clipboard?.writeText(url).then(
      () => toast("Copiado", "URL copiada al portapapeles.", 2200),
      () => toast("Copiar", "No pude acceder al portapapeles.", 3200)
    );
  }

  function onReset() {
    formEl?.reset();
    resetPreview();
    toast("Listo", "Formulario reiniciado.", 1800);
  }

  // ------------------------------------------------------------
  // Realtime
  // ------------------------------------------------------------
  function wireRealtime() {
    if (!ENABLE_REALTIME) return;

    try {
      if (state.channel) {
        try { APP.supabase.removeChannel(state.channel); } catch (_) {}
        state.channel = null;
      }

      state.channel = APP.supabase
        .channel("admin-media-realtime")
        .on("postgres_changes", { event: "*", schema: "public", table: TABLE }, () => {
          clearTimeout(wireRealtime._t);
          wireRealtime._t = setTimeout(() => refreshList(), REALTIME_DEBOUNCE_MS);
        })
        .subscribe();
    } catch (e) {
      console.warn("[admin-media] Realtime no disponible:", e);
    }
  }

  // ------------------------------------------------------------
  // Bind + Tab init
  // ------------------------------------------------------------
  function bindOnce() {
    if (state.didBind) return;
    state.didBind = true;

    fileInp?.addEventListener("change", onFileChange);
    formEl?.addEventListener("submit", onSubmit);

    copyBtn?.addEventListener("click", onCopyUrl);
    resetBtn?.addEventListener("click", onReset);

    refreshBtn?.addEventListener("click", refreshList);
    listEl?.addEventListener("click", onListClick);

    document.getElementById("search")?.addEventListener("input", () => renderList());

    // cuando cambie la carpeta, actualiza meta del preview si hay file
    folderSel?.addEventListener("change", () => {
      if (state.selectedPreviewUrl && state.selectedBytes) {
        const folder = safeStr(folderSel.value || "misc");
        showPreview(state.selectedPreviewUrl, `${folder} • ${humanKB(state.selectedBytes)} • ${fmtShortDate(nowISO())}`);
      }
    });

    // Hook: cuando el usuario abre el tab media, refrescar
    window.addEventListener("admin:tab", (ev) => {
      const tab = ev?.detail?.tab;
      if (tab === "media") {
        // ojo: el panel puede estar hidden (tu admin.js lo controla)
        refreshList();
      }
    });
  }

  async function init() {
    bindOnce();
    resetPreview();
    await refreshList();
    wireRealtime();
  }

  // Inicializa:
  // 1) cuando el gate admin pase (admin-auth.js)
  // 2) fallback si ya está listo
  window.addEventListener("admin:ready", init, { once: true });

  // fallback: si admin-auth ya corrió antes
  try {
    if (window.APP && APP.adminReady) {
      init();
    }
  } catch (_) {}

  // API pública por si querés manual
  window.ECN_ADMIN_MEDIA = { init, refresh: refreshList };
})();
