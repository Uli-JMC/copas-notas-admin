/* ============================================================
   admin-media.js ✅ PRO (Supabase Storage PUBLIC) — 2026-01 FIX
   - Bucket: "media" (PUBLIC recomendado)
   - Sube imágenes y genera URL pública
   - Lista objetos del bucket (por carpeta)
   - Preview + copiar URL + eliminar
   - No usa DB (ideal para "copiar y pegar URL" en Eventos/Promos/Galería)
   - Requiere: Supabase CDN -> supabaseClient.js -> admin-auth.js -> admin-media.js
   - Corre SOLO cuando:
       1) admin:ready (sesión OK + admin OK)
       2) tab "media" está activo (admin:tab)
============================================================ */
(function () {
  "use strict";

  const VERSION = "2026-01-18.2";
  const $ = (sel, root = document) => root.querySelector(sel);

  // ------------------------------------------------------------
  // Guards base
  // ------------------------------------------------------------
  if (!document.getElementById("appPanel")) return;

  const panel = document.getElementById("tab-media");
  if (!panel) return;

  // ------------------------------------------------------------
  // Config
  // ------------------------------------------------------------
  const BUCKET = "media";
  const MAX_MB = 6;
  const MAX_BYTES = MAX_MB * 1024 * 1024;
  const LIST_LIMIT = 60;

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
    try { if (window.APP && typeof APP.toast === "function") return APP.toast(title, msg, timeoutMs); } catch (_) {}
    try { if (typeof window.toast === "function") return window.toast(title, msg, timeoutMs); } catch (_) {}

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
    el.querySelector(".close")?.addEventListener("click", kill, { once: true });
    setTimeout(kill, timeoutMs);
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
    if (["jpg", "jpeg", "png", "webp", "gif"].includes(fromName)) return fromName === "jpeg" ? "jpg" : fromName;

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
    const c = safeStr(err?.code || "").toLowerCase();
    return (
      c === "42501" ||
      m.includes("42501") ||
      m.includes("rls") ||
      m.includes("row level security") ||
      m.includes("permission") ||
      m.includes("not allowed") ||
      m.includes("violates row-level security")
    );
  }

  function looksLikeStorageError(err) {
    const m = safeStr(err?.message || err || "").toLowerCase();
    return m.includes("bucket") || m.includes("storage") || m.includes("object") || m.includes("not found");
  }

  function getSB() {
    return window.APP && (APP.supabase || APP.sb) ? (APP.supabase || APP.sb) : null;
  }

  async function ensureSession() {
    const sb = getSB();
    if (!sb) return null;

    try {
      const res = await sb.auth.getSession();
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
    const sb = getSB();
    const p = cleanSpaces(path);
    if (!sb || !p) return "";
    try {
      const res = sb.storage.from(BUCKET).getPublicUrl(p);
      return res?.data?.publicUrl || "";
    } catch (_) {
      return "";
    }
  }

  // ------------------------------------------------------------
  // DOM refs (solo dentro del panel)
  // ------------------------------------------------------------
  function R() {
    return {
      formEl: $("#mediaForm", panel),
      fileInp: $("#mediaFile", panel),
      folderSel: $("#mediaFolder", panel),
      nameInp: $("#mediaName", panel),
      urlInp: $("#mediaUrl", panel),

      uploadBtn: $("#mediaUploadBtn", panel),
      copyBtn: $("#mediaCopyBtn", panel),
      resetBtn: $("#mediaResetBtn", panel),
      noteEl: $("#mediaNote", panel),

      previewEmpty: $("#mediaPreviewEmpty", panel),
      previewWrap: $("#mediaPreview", panel),
      previewImg: $("#mediaPreviewImg", panel),
      previewMeta: $("#mediaPreviewMeta", panel),

      refreshBtn: $("#mediaRefreshBtn", panel),
      listEl: $("#mediaList", panel),
    };
  }

  function setNote(msg, kind) {
    const r = R();
    if (!r.noteEl) return;
    r.noteEl.textContent = msg || "";
    r.noteEl.dataset.kind = kind || "";
  }

  // ------------------------------------------------------------
  // State
  // ------------------------------------------------------------
  const S = {
    didBind: false,
    didBoot: false,
    busy: false,
    previewUrl: "",
    lastUploadedPath: "",
    list: [],
    currentFolder: "events",
    lastLoadedAt: 0,
  };

  function setBusy(on) {
    S.busy = !!on;
    const r = R();
    try {
      const els = panel.querySelectorAll("input, select, button, textarea");
      els.forEach((el) => (el.disabled = S.busy));
    } catch (_) {}

    try {
      if (r.uploadBtn) r.uploadBtn.textContent = S.busy ? "Subiendo…" : "Subir";
    } catch (_) {}
  }

  // ------------------------------------------------------------
  // Preview
  // ------------------------------------------------------------
  function resetPreview() {
    const r = R();
    if (S.previewUrl) {
      try { URL.revokeObjectURL(S.previewUrl); } catch (_) {}
      S.previewUrl = "";
    }
    if (r.previewImg) r.previewImg.src = "";
    if (r.previewMeta) r.previewMeta.textContent = "";
    if (r.previewWrap) r.previewWrap.hidden = true;
    if (r.previewEmpty) r.previewEmpty.hidden = false;
  }

  function renderPreview(file) {
    const r = R();
    if (!file) { resetPreview(); return; }

    try { if (S.previewUrl) URL.revokeObjectURL(S.previewUrl); } catch (_) {}
    S.previewUrl = URL.createObjectURL(file);

    if (r.previewImg) {
      r.previewImg.src = S.previewUrl;
      r.previewImg.alt = file.name || "Preview";
    }

    const meta = [
      file.name || "archivo",
      humanKB(file.size),
      (file.type || "image/*"),
      fmtShortDate(Date.now()),
    ].join(" · ");

    if (r.previewMeta) r.previewMeta.textContent = meta;

    if (r.previewEmpty) r.previewEmpty.hidden = true;
    if (r.previewWrap) r.previewWrap.hidden = false;
  }

  // ------------------------------------------------------------
  // Storage ops
  // ------------------------------------------------------------
  async function listFolder(folder) {
    const sb = getSB();
    if (!sb) throw new Error("APP.supabase no existe.");

    const f = cleanSpaces(folder) || "events";

    const { data, error } = await sb.storage
      .from(BUCKET)
      .list(f, { limit: LIST_LIMIT, offset: 0, sortBy: { column: "updated_at", order: "desc" } });

    if (error) throw error;

    const items = Array.isArray(data) ? data : [];
    return items
      .filter((x) => x && x.name && !String(x.name).endsWith("/"))
      .map((x) => {
        const path = `${f}/${x.name}`;
        return {
          name: x.name,
          path,
          url: publicUrlFromPath(path),
          updated_at: x.updated_at || x.created_at || "",
          size: x.metadata?.size || 0,
          mime: x.metadata?.mimetype || "",
        };
      })
      .sort((a, b) => safeStr(b.updated_at).localeCompare(safeStr(a.updated_at)));
  }

  async function uploadFile(file, folder, customName) {
    const sb = getSB();
    if (!sb) throw new Error("APP.supabase no existe.");

    const f = cleanSpaces(folder) || "events";
    const ext = extFromNameOrMime(file);

    const base =
      slugify(customName) ||
      slugify(String(file.name || "").replace(/\.[a-z0-9]+$/i, "")) ||
      "img";

    const path = `${f}/${base}_${Date.now()}.${ext}`;

    const { error } = await sb.storage.from(BUCKET).upload(path, file, {
      cacheControl: "3600",
      upsert: false,
    });
    if (error) throw error;

    return path;
  }

  async function deleteObject(path) {
    const sb = getSB();
    if (!sb) throw new Error("APP.supabase no existe.");

    const p = cleanSpaces(path);
    if (!p) return;

    const { error } = await sb.storage.from(BUCKET).remove([p]);
    if (error) throw error;
    return true;
  }

  // ------------------------------------------------------------
  // Render list
  // ------------------------------------------------------------
  function esc(s) { return escapeHtml(safeStr(s)); }

  function renderList() {
    const r = R();
    const arr = Array.isArray(S.list) ? S.list : [];

    if (!r.listEl) return;
    r.listEl.innerHTML = "";

    if (!arr.length) {
      r.listEl.innerHTML = `
        <div class="item" style="cursor:default;">
          <div>
            <p class="itemTitle">Sin archivos en <b>${esc(S.currentFolder)}</b></p>
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

    r.listEl.appendChild(frag);
  }

  // ------------------------------------------------------------
  // Refresh list (con throttle)
  // ------------------------------------------------------------
  async function refreshList(opts) {
    const silent = !!opts?.silent;
    const force = !!opts?.force;

    if (S.busy) return;

    // throttle 600ms para evitar spam (folder change + tab click)
    const now = Date.now();
    if (!force && now - S.lastLoadedAt < 600) return;
    S.lastLoadedAt = now;

    try {
      setNote("", "");
      const s = await ensureSession();
      if (!s) return;

      const r = R();
      const folder = cleanSpaces(r.folderSel?.value) || S.currentFolder || "events";
      S.currentFolder = folder;

      if (!silent) toast("Media", "Cargando…", 800);

      S.list = await listFolder(folder);
      renderList();

      if (!silent) toast("Listo", "Media actualizada.", 900);
    } catch (err) {
      console.error("[admin-media]", err);

      if (looksLikeRLSError(err)) {
        toast("RLS", "Acceso bloqueado. Revisá policies del bucket media (SELECT/INSERT/DELETE).", 5200);
      } else if (looksLikeStorageError(err)) {
        toast("Storage", "Error en bucket media (existe? policies? nombre?).", 5200);
      } else {
        toast("Error", "No se pudo cargar la lista del bucket media.", 4200);
      }
    }
  }

  // ------------------------------------------------------------
  // Handlers
  // ------------------------------------------------------------
  function onFileChange() {
    const r = R();
    const f = r.fileInp?.files && r.fileInp.files[0] ? r.fileInp.files[0] : null;
    if (!f) { resetPreview(); return; }

    if (!/^image\//.test(f.type)) {
      toast("Archivo inválido", "Seleccioná una imagen (JPG/PNG/WebP).");
      try { r.fileInp.value = ""; } catch (_) {}
      resetPreview();
      return;
    }

    if (Number(f.size || 0) > MAX_BYTES) {
      toast("Muy pesada", `La imagen pesa ${humanKB(f.size)}. Usá una menor a ~${MAX_MB}MB.`);
      try { r.fileInp.value = ""; } catch (_) {}
      resetPreview();
      return;
    }

    renderPreview(f);
  }

  async function onUpload(e) {
    if (e && typeof e.preventDefault === "function") e.preventDefault();

    const r = R();
    const file = r.fileInp?.files && r.fileInp.files[0] ? r.fileInp.files[0] : null;

    if (!file) {
      toast("Falta imagen", "Seleccioná una imagen antes de subir.");
      return;
    }

    const folder = cleanSpaces(r.folderSel?.value) || "events";
    const customName = cleanSpaces(r.nameInp?.value || "");

    setBusy(true);
    try {
      setNote("Subiendo a Supabase…", "info");
      const s = await ensureSession();
      if (!s) return;

      const path = await uploadFile(file, folder, customName);
      const url = publicUrlFromPath(path);

      S.lastUploadedPath = path;
      if (r.urlInp) r.urlInp.value = url || "";

      setNote("Listo. URL pública generada.", "ok");
      toast("Subido", "Imagen subida y URL lista para copiar.", 2200);

      await refreshList({ silent: true, force: true });

      // limpia input file (pero deja URL)
      try { r.fileInp.value = ""; } catch (_) {}
      resetPreview();
    } catch (err) {
      console.error(err);
      setNote("", "");

      if (looksLikeRLSError(err)) {
        toast("RLS", "Bloqueado. Falta policy INSERT en bucket media para authenticated.", 5200);
      } else if (looksLikeStorageError(err)) {
        toast("Storage", "Error en bucket media (policies / nombre / ruta).", 5200);
      } else {
        toast("Error", "No se pudo subir la imagen.", 4200);
      }
    } finally {
      setBusy(false);
    }
  }

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

  function onReset() {
    const r = R();
    try { r.formEl?.reset(); } catch (_) {}
    if (r.urlInp) r.urlInp.value = "";
    setNote("", "");
    resetPreview();
    toast("Limpiado", "Formulario reiniciado.");
  }

  async function onListClick(e) {
    const btn = e.target && e.target.closest ? e.target.closest("[data-act]") : null;
    if (!btn) return;

    const row = btn.closest(".item");
    if (!row) return;

    const act = btn.dataset.act;
    const path = row.dataset.path || "";
    const url = row.dataset.url || "";

    const r = R();

    if (act === "use") {
      if (r.urlInp) r.urlInp.value = url || "";
      setNote("URL lista. Pegala en Eventos/Promos/Galería.", "ok");

      if (r.previewImg && url) {
        if (r.previewEmpty) r.previewEmpty.hidden = true;
        if (r.previewWrap) r.previewWrap.hidden = false;
        r.previewImg.src = url;
        r.previewImg.alt = "Seleccionada";
        if (r.previewMeta) r.previewMeta.textContent = `${path} · ${fmtShortDate(Date.now())}`;
      }

      toast("Seleccionada", "URL cargada en el campo.", 1600);
      return;
    }

    if (act === "copy") {
      await copyUrl(url || r.urlInp?.value || "");
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

        if (cleanSpaces(r.urlInp?.value || "") === cleanSpaces(url)) {
          if (r.urlInp) r.urlInp.value = "";
        }

        toast("Eliminado", "Archivo eliminado del bucket.", 2200);
        await refreshList({ silent: true, force: true });
      } catch (err) {
        console.error(err);
        if (looksLikeRLSError(err)) toast("RLS", "Bloqueado. Falta policy DELETE en bucket media.", 5200);
        else toast("Error", "No se pudo eliminar el archivo.", 4200);
      } finally {
        setBusy(false);
      }
      return;
    }
  }

  // ------------------------------------------------------------
  // Bind once
  // ------------------------------------------------------------
  function bindOnce() {
    if (S.didBind) return;
    S.didBind = true;

    const r = R();
    if (!r.formEl || !r.fileInp || !r.folderSel || !r.urlInp || !r.uploadBtn || !r.copyBtn || !r.resetBtn || !r.refreshBtn || !r.listEl) {
      console.warn("[admin-media] Faltan elementos en el HTML del tab-media.");
      return;
    }

    r.fileInp.addEventListener("change", onFileChange);
    r.folderSel.addEventListener("change", () => refreshList({ silent: true, force: true }));
    r.refreshBtn.addEventListener("click", () => refreshList({ silent: false, force: true }));

    r.formEl.addEventListener("submit", onUpload);
    r.copyBtn.addEventListener("click", () => copyUrl(r.urlInp.value));
    r.resetBtn.addEventListener("click", onReset);

    r.listEl.addEventListener("click", onListClick);

    resetPreview();
    setNote("", "");
  }

  // ------------------------------------------------------------
  // Boot (admin:ready)
  // ------------------------------------------------------------
  function boot() {
    if (S.didBoot) return;
    S.didBoot = true;

    const sb = getSB();
    if (!sb) {
      console.error("[admin-media] APP.supabase no existe (orden scripts incorrecto).");
      return;
    }

    // folder inicial
    try {
      const r = R();
      S.currentFolder = cleanSpaces(r.folderSel?.value) || "events";
    } catch (_) {}

    bindOnce();
    console.log("[admin-media] boot", { VERSION, BUCKET });
  }

  // ------------------------------------------------------------
  // Activación por tab (admin:tab)
  // ------------------------------------------------------------
  async function onTab(e) {
    const tab = e?.detail?.tab || "";
    if (tab !== "media") return;

    // solo cuando el panel ya está visible
    try { if (panel.hidden) return; } catch (_) {}

    // refresh on-demand
    await refreshList({ silent: true, force: false });
  }

  // init wiring
  if (window.APP && APP.__adminReady) boot();
  else window.addEventListener("admin:ready", boot, { once: true });

  window.addEventListener("admin:tab", onTab);

  // Si el usuario ya cae con media activa (hard refresh)
  try {
    const btn = document.querySelector('.tab[data-tab="media"]');
    const selected = btn ? btn.getAttribute("aria-selected") === "true" : false;
    if (selected && !panel.hidden) {
      if (window.APP && APP.__adminReady) {
        boot();
        refreshList({ silent: true, force: true });
      }
    }
  } catch (_) {}
})();
