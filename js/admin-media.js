/* ============================================================
   admin-media.js ✅ PRO (Supabase Storage PUBLIC) — 2026-02 VIDEO PRO PATCH
   - Buckets:
       - "media" (PUBLIC)   -> imágenes
       - "video" (PUBLIC)   -> videos (MP4/WebM)
   - ✅ Selector PRO: #mediaBucket (sube/lista/borrar por bucket seleccionado)
   - ✅ Auto-switch: si el archivo es video -> selecciona "video"; si es imagen -> "media"
   - ✅ UX PRO:
       - Cambia accept: bucket media -> image/* | bucket video -> video/*
       - Warning visible cuando bucket = video (sin optimización)
   - Preview (img/video) + copiar URL + eliminar
   - No usa DB (ideal para "copiar y pegar URL")

   ✅ PATCH 2026-02-17 (EVENT ASSIGNMENT):
   - Modo opcional: "Subir y asignar a evento"
     - HERO -> events.img
     - MORE -> events.more_img (si existe)
   - UI se inyecta (no requiere cambiar admin.html)
   - Si no hay evento seleccionado o columna no existe -> solo avisa y deja URL para copiar
============================================================ */
(function () {
  "use strict";

  const VERSION = "2026-02-17.1";
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
  const BUCKET_IMG = "media";
  const BUCKET_VID = "video";

  const MAX_IMG_MB = 25;
  const MAX_VID_MB = 25;

  const MAX_IMG_BYTES = MAX_IMG_MB * 1024 * 1024;
  const MAX_VID_BYTES = MAX_VID_MB * 1024 * 1024;

  const LIST_LIMIT = 60;

  const COMPRESS_MAX_DIM_DEFAULT = 1920;
  const COMPRESS_QUALITY_DEFAULT = 0.82;
  const COMPRESS_MIN_BYTES = 900 * 1024;
  const COMPRESS_TIMEOUT_MS = 12000;

  const LS_KEYS = {
    optimize: "admin_media_optimize",
    forceWebp: "admin_media_force_webp",
    quality: "admin_media_quality",
    maxDim: "admin_media_max_dim",

    // ✅ nuevo
    assignMode: "admin_media_assign_mode",     // "copy" | "assign"
    assignTarget: "admin_media_assign_target", // "hero" | "more"
  };

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

  function clampNum(n, min, max) {
    const x = Number(n);
    if (!Number.isFinite(x)) return min;
    return Math.max(min, Math.min(max, x));
  }

  function sanitizeFolder(folder) {
    let f = cleanSpaces(folder || "events").toLowerCase();
    f = f.replace(/\\/g, "/");
    f = f.replace(/\.\./g, "");
    f = f.replace(/\/+/g, "/");
    f = f.replace(/^\/|\/$/g, "");
    if (!f) f = "events";
    return f;
  }

  function slugify(s) {
    return cleanSpaces(s)
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9\-]/g, "")
      .replace(/\-+/g, "-")
      .replace(/^\-|\-$/g, "");
  }

  function isVideoFile(file) {
    return !!file && /^video\//i.test(file.type || "");
  }
  function isImageFile(file) {
    return !!file && /^image\//i.test(file.type || "");
  }

  function extFromNameOrMime(file) {
    const name = safeStr(file?.name || "");
    const m = safeStr(file?.type || "").toLowerCase();
    const fromName = (name.split(".").pop() || "").toLowerCase();

    if (["mp4", "webm"].includes(fromName)) return fromName;
    if (m.includes("mp4")) return "mp4";
    if (m.includes("webm")) return "webm";

    if (["jpg", "jpeg", "png", "webp", "gif"].includes(fromName)) return fromName === "jpeg" ? "jpg" : fromName;
    if (m.includes("webp")) return "webp";
    if (m.includes("png")) return "png";
    if (m.includes("gif")) return "gif";
    if (m.includes("jpeg") || m.includes("jpg")) return "jpg";

    return isVideoFile(file) ? "mp4" : "jpg";
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

  function publicUrlFromPath(bucket, path) {
    const sb = getSB();
    const b = cleanSpaces(bucket);
    const p = cleanSpaces(path);
    if (!sb || !b || !p) return "";
    try {
      const res = sb.storage.from(b).getPublicUrl(p);
      return res?.data?.publicUrl || "";
    } catch (_) {
      return "";
    }
  }

  function normalizeBucket(b) {
    const v = cleanSpaces(b || "").toLowerCase();
    if (v === BUCKET_VID) return BUCKET_VID;
    return BUCKET_IMG;
  }

  // ------------------------------------------------------------
  // ✅ Settings (localStorage)
  // ------------------------------------------------------------
  function readLS(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      if (v == null) return fallback;
      return v;
    } catch (_) {
      return fallback;
    }
  }

  function writeLS(key, value) {
    try { localStorage.setItem(key, String(value)); } catch (_) {}
  }

  function loadSettings() {
    const optimize = readLS(LS_KEYS.optimize, "1") !== "0";
    const forceWebp = readLS(LS_KEYS.forceWebp, "0") === "1";
    const quality = clampNum(Number(readLS(LS_KEYS.quality, String(COMPRESS_QUALITY_DEFAULT))), 0.55, 0.95);
    const maxDim = Math.round(clampNum(Number(readLS(LS_KEYS.maxDim, String(COMPRESS_MAX_DIM_DEFAULT))), 800, 4096));

    const assignMode = readLS(LS_KEYS.assignMode, "copy");     // copy|assign
    const assignTarget = readLS(LS_KEYS.assignTarget, "hero"); // hero|more

    return { optimize, forceWebp, quality, maxDim, assignMode, assignTarget };
  }

  // ------------------------------------------------------------
  // ✅ Auto-compress helpers (solo imágenes)
  // ------------------------------------------------------------
  function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timeout")), ms);
      promise
        .then((v) => { clearTimeout(t); resolve(v); })
        .catch((e) => { clearTimeout(t); reject(e); });
    });
  }

  function canvasToBlob(canvas, mime, quality) {
    return new Promise((resolve) => {
      try { canvas.toBlob((blob) => resolve(blob || null), mime, quality); }
      catch (_) { resolve(null); }
    });
  }

  function supportsWebP() {
    try {
      const c = document.createElement("canvas");
      if (!c.getContext) return false;
      return c.toDataURL("image/webp").startsWith("data:image/webp");
    } catch (_) {
      return false;
    }
  }

  async function loadImageFromFile(file) {
    if (typeof createImageBitmap === "function") {
      try {
        const bmp = await createImageBitmap(file);
        return { kind: "bitmap", img: bmp, width: bmp.width, height: bmp.height };
      } catch (_) {}
    }

    return await new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve({ kind: "img", img, width: img.naturalWidth || img.width, height: img.naturalHeight || img.height });
      };
      img.onerror = () => {
        try { URL.revokeObjectURL(url); } catch (_) {}
        reject(new Error("image_load_failed"));
      };
      img.src = url;
    });
  }

  function computeTargetSize(w, h, maxDim) {
    const W = Number(w || 0), H = Number(h || 0);
    if (!W || !H) return { tw: W, th: H, scale: 1 };
    const maxSide = Math.max(W, H);
    if (maxSide <= maxDim) return { tw: W, th: H, scale: 1 };
    const scale = maxDim / maxSide;
    return { tw: Math.max(1, Math.round(W * scale)), th: Math.max(1, Math.round(H * scale)), scale };
  }

  async function compressImageSmart(originalFile, opts) {
    const file = originalFile;

    const enabled = !!opts?.optimize;
    if (!enabled) return { file, changed: false, note: "" };

    const quality = clampNum(Number(opts?.quality ?? COMPRESS_QUALITY_DEFAULT), 0.55, 0.95);
    const maxDim = Math.round(clampNum(Number(opts?.maxDim ?? COMPRESS_MAX_DIM_DEFAULT), 800, 4096));
    const forceWebp = !!opts?.forceWebp;

    if (!file || !/^image\//.test(file.type)) return { file, changed: false, note: "" };

    const size = Number(file.size || 0);
    const maybeSkipBySize = size > 0 && size < COMPRESS_MIN_BYTES;

    let info;
    try {
      info = await withTimeout(loadImageFromFile(file), COMPRESS_TIMEOUT_MS);
    } catch (_) {
      return { file, changed: false, note: "" };
    }

    const w = info.width, h = info.height;
    const { tw, th, scale } = computeTargetSize(w, h, maxDim);

    if (scale === 1 && maybeSkipBySize) {
      try { if (info.kind === "bitmap" && info.img && info.img.close) info.img.close(); } catch (_) {}
      return { file, changed: false, note: "" };
    }

    const canvas = document.createElement("canvas");
    canvas.width = tw || w;
    canvas.height = th || h;

    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) {
      try { if (info.kind === "bitmap" && info.img && info.img.close) info.img.close(); } catch (_) {}
      return { file, changed: false, note: "" };
    }

    try {
      ctx.drawImage(info.img, 0, 0, canvas.width, canvas.height);
    } catch (_) {
      try { if (info.kind === "bitmap" && info.img && info.img.close) info.img.close(); } catch (_) {}
      return { file, changed: false, note: "" };
    } finally {
      try { if (info.kind === "bitmap" && info.img && info.img.close) info.img.close(); } catch (_) {}
    }

    const webpOK = supportsWebP();
    // ✅ Comportamiento correcto:
    // - Si forceWebp ON -> webp si soporta
    // - Si forceWebp OFF -> webp igual si soporta (tu diseño actual), pero esto te permite cambiarlo luego si querés.
    const useWebP = webpOK; // (mantenemos tu decisión: WebP si el navegador soporta)
    const mime = useWebP ? "image/webp" : "image/jpeg";

    let blob = await withTimeout(canvasToBlob(canvas, mime, quality), COMPRESS_TIMEOUT_MS).catch(() => null);
    if (!blob) return { file, changed: false, note: "" };

    if (Number(blob.size || 0) >= size && scale === 1) {
      return { file, changed: false, note: "" };
    }

    const baseName = (file.name || "img").replace(/\.[a-z0-9]+$/i, "");
    const ext = useWebP ? "webp" : "jpg";
    const newName = `${baseName}.${ext}`;
    const out = new File([blob], newName, { type: mime, lastModified: Date.now() });

    const note = useWebP
      ? (forceWebp ? "Optimizada a WebP (forzado)" : "Optimizada a WebP")
      : "Optimizada a JPG";

    return {
      file: out,
      changed: true,
      note,
      meta: { from: { w, h, size }, to: { w: canvas.width, h: canvas.height, size: out.size }, quality, maxDim },
    };
  }

  // ------------------------------------------------------------
  // DOM refs (solo dentro del panel)
  // ------------------------------------------------------------
  function R() {
    return {
      formEl: $("#mediaForm", panel),
      fileInp: $("#mediaFile", panel),

      bucketSel: $("#mediaBucket", panel),
      folderSel: $("#mediaFolder", panel),

      nameInp: $("#mediaName", panel),
      urlInp: $("#mediaUrl", panel),

      uploadBtn: $("#mediaUploadBtn", panel),
      copyBtn: $("#mediaCopyBtn", panel),
      resetBtn: $("#mediaResetBtn", panel),
      noteEl: $("#mediaNote", panel),

      previewEmpty: $("#mediaPreviewEmpty", panel),
      previewWrap: $("#mediaPreview", panel),
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
    lastUploadedBucket: "",

    list: [],
    currentFolder: "events",
    currentBucket: BUCKET_IMG,

    lastLoadedAt: 0,
    lastTabLoadAt: 0,

    settings: loadSettings(),
  };

  function setBusy(on) {
    S.busy = !!on;
    const r = R();

    try {
      const els = panel.querySelectorAll("input, select, button, textarea");
      els.forEach((el) => {
        const id = (el && el.id) ? el.id : "";
        const keepEnabled = (id === "mediaUrl" || id === "mediaCopyBtn");
        el.disabled = S.busy ? !keepEnabled : false;
      });
    } catch (_) {}

    try {
      if (r.uploadBtn) r.uploadBtn.textContent = S.busy ? "Subiendo…" : "Subir";
    } catch (_) {}
  }

  // ------------------------------------------------------------
  // ✅ UX PRO helpers: accept + bucket hint
  // ------------------------------------------------------------
  function applyAcceptForBucket(bucket) {
    const r = R();
    const b = normalizeBucket(bucket);

    if (r.fileInp) {
      r.fileInp.accept = (b === BUCKET_VID) ? "video/*" : "image/*,video/*";
    }

    setBucketHint(b);
  }

  function setBucketHint(bucket) {
    const r = R();
    if (!r.bucketSel) return;

    let hint = panel.querySelector('[data-media-bucket-hint="1"]');
    if (!hint) {
      hint = document.createElement("div");
      hint.setAttribute("data-media-bucket-hint", "1");
      hint.style.marginTop = "6px";
      hint.style.fontSize = "12px";
      hint.style.opacity = ".85";
      hint.style.padding = "6px 10px";
      hint.style.borderRadius = "10px";
      hint.style.border = "1px solid rgba(255,255,255,.10)";
      hint.style.background = "rgba(255,255,255,.03)";

      const field = r.bucketSel.closest(".field");
      if (field) field.appendChild(hint);
      else r.bucketSel.parentNode?.appendChild(hint);
    }

    const isVid = normalizeBucket(bucket) === BUCKET_VID;
    if (isVid) {
      hint.textContent = `Bucket video: sin optimización. Recomendado MP4/WebM (≤ ~${MAX_VID_MB}MB).`;
      hint.style.opacity = "1";
    } else {
      hint.textContent = `Bucket media: imágenes. Optimización disponible (WebP/JPG) antes de subir (≤ ~${MAX_IMG_MB}MB).`;
      hint.style.opacity = ".85";
    }
  }

  // ------------------------------------------------------------
  // ✅ Asignación a evento (DB) — helpers
  // ------------------------------------------------------------
  function getActiveEventId() {
    // 1) si admin.js expone algo (opcional)
    try {
      const v = window.APP && APP.__activeEventId ? String(APP.__activeEventId) : "";
      if (v && v !== "null" && v !== "undefined") return v;
    } catch (_) {}

    // 2) fallback: input oculto del form (si hay evento seleccionado)
    const el = document.getElementById("eventId");
    const v2 = cleanSpaces(el?.value || "");
    return v2 || "";
  }

  async function assignUrlToEvent(url) {
    const sb = getSB();
    if (!sb) throw new Error("APP.supabase no existe.");

    const eventId = getActiveEventId();
    if (!eventId) {
      toast("Asignación", "No hay evento seleccionado. Andá a 'Eventos' y seleccioná uno.", 4200);
      return { ok: false, reason: "no_event" };
    }

    const mode = cleanSpaces(S.settings.assignMode || "copy");
    if (mode !== "assign") return { ok: false, reason: "mode_copy" };

    const target = cleanSpaces(S.settings.assignTarget || "hero"); // hero|more
    const field = (target === "more") ? "more_img" : "img";

    // ✅ Solo permitimos asignación cuando es imagen en bucket media
    if (normalizeBucket(S.currentBucket) !== BUCKET_IMG) {
      toast("Asignación", "Solo podés asignar imágenes (bucket media) a eventos.", 4200);
      return { ok: false, reason: "not_image_bucket" };
    }

    // Guardar en DB
    const payload = {};
    payload[field] = url;

    const { error } = await sb
      .from("events")
      .update(payload)
      .eq("id", eventId);

    if (error) {
      // Si no existe more_img, esto te lo va a decir aquí
      toast("DB", `No pude guardar en events.${field}. ${error.message || "Error"}`, 5200);
      return { ok: false, reason: "db_error", error };
    }

    toast("Evento actualizado", `Imagen guardada en ${field} (evento ${eventId}).`, 2200);
    return { ok: true, field, eventId };
  }

  // ------------------------------------------------------------
  // ✅ Settings UI injection (sin tocar HTML)
  // ------------------------------------------------------------
  function ensureSettingsUI() {
    if (panel.querySelector('[data-media-settings="1"]')) return;

    const wrap = document.createElement("div");
    wrap.setAttribute("data-media-settings", "1");
    wrap.style.margin = "12px 0";
    wrap.style.padding = "10px 12px";
    wrap.style.border = "1px solid rgba(255,255,255,.10)";
    wrap.style.background = "rgba(255,255,255,.03)";
    wrap.style.borderRadius = "10px";

    const webpOK = supportsWebP();

    wrap.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
        <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
          <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
            <input type="checkbox" id="mediaOptToggle" ${S.settings.optimize ? "checked" : ""}>
            <span style="opacity:.95;">Optimizar antes de subir (solo imágenes)</span>
          </label>

          <label style="display:flex; align-items:center; gap:8px; cursor:pointer; opacity:${webpOK ? "1" : ".55"};">
            <input type="checkbox" id="mediaForceWebp" ${S.settings.forceWebp ? "checked" : ""} ${webpOK ? "" : "disabled"}>
            <span>Forzar WebP</span>
            <span style="font-size:12px; opacity:.75;">${webpOK ? "" : "(no soportado)"}</span>
          </label>
        </div>

        <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
          <span style="opacity:.85; font-size:12px;">Calidad</span>
          <input type="range" id="mediaQuality" min="55" max="95" step="1" value="${Math.round(S.settings.quality * 100)}" style="width:160px;">
          <span id="mediaQualityVal" style="min-width:36px; text-align:right; font-variant-numeric:tabular-nums;">${Math.round(S.settings.quality * 100)}</span>
        </div>
      </div>

      <hr style="border:0;border-top:1px solid rgba(255,255,255,.10);margin:10px 0;" />

      <!-- ✅ NUEVO: Modo asignación a evento -->
      <div style="display:flex; gap:14px; flex-wrap:wrap; align-items:center; justify-content:space-between;">
        <div style="display:flex; gap:14px; flex-wrap:wrap; align-items:center;">
          <div style="font-size:12px; opacity:.8;">Modo</div>

          <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
            <input type="radio" name="mediaAssignMode" value="copy" ${S.settings.assignMode !== "assign" ? "checked" : ""}>
            <span>Solo subir (copiar URL)</span>
          </label>

          <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
            <input type="radio" name="mediaAssignMode" value="assign" ${S.settings.assignMode === "assign" ? "checked" : ""}>
            <span>Subir y asignar al evento activo</span>
          </label>

          <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
            <span style="font-size:12px; opacity:.75;">Campo:</span>
            <label style="display:flex; align-items:center; gap:6px; cursor:pointer;">
              <input type="radio" name="mediaAssignTarget" value="hero" ${S.settings.assignTarget !== "more" ? "checked" : ""}>
              <span>HERO (events.img)</span>
            </label>
            <label style="display:flex; align-items:center; gap:6px; cursor:pointer;">
              <input type="radio" name="mediaAssignTarget" value="more" ${S.settings.assignTarget === "more" ? "checked" : ""}>
              <span>MORE (events.more_img)</span>
            </label>
          </div>
        </div>

        <div style="font-size:12px; opacity:.75;">
          Evento activo: <b id="mediaActiveEventId">${escapeHtml(getActiveEventId() || "—")}</b>
        </div>
      </div>

      <div style="margin-top:8px; display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap;">
        <div style="opacity:.75; font-size:12px;">
          Resize máx: <b id="mediaMaxDimVal">${S.settings.maxDim}</b>px ·
          <span style="opacity:.75;">(automático)</span>
          <span style="margin-left:10px; opacity:.75;">Buckets: <b>${BUCKET_IMG}</b> (img) / <b>${BUCKET_VID}</b> (video)</span>
        </div>

        <button type="button" class="btn" id="mediaResetSettingsBtn" style="white-space:nowrap;">Reset settings</button>
      </div>
    `;

    try {
      const r = R();
      if (r.formEl && r.formEl.parentNode) r.formEl.parentNode.insertBefore(wrap, r.formEl);
      else panel.insertBefore(wrap, panel.firstChild);
    } catch (_) {
      panel.insertBefore(wrap, panel.firstChild);
    }

    const optToggle = wrap.querySelector("#mediaOptToggle");
    const forceWebp = wrap.querySelector("#mediaForceWebp");
    const quality = wrap.querySelector("#mediaQuality");
    const qualityVal = wrap.querySelector("#mediaQualityVal");
    const resetBtn = wrap.querySelector("#mediaResetSettingsBtn");

    const eventIdLabel = wrap.querySelector("#mediaActiveEventId");
    const updateEventIdLabel = () => {
      try { if (eventIdLabel) eventIdLabel.textContent = getActiveEventId() || "—"; } catch (_) {}
    };

    // Radios
    const modeRadios = Array.from(wrap.querySelectorAll('input[name="mediaAssignMode"]'));
    const targetRadios = Array.from(wrap.querySelectorAll('input[name="mediaAssignTarget"]'));

    modeRadios.forEach((r) => {
      r.addEventListener("change", () => {
        const v = modeRadios.find(x => x.checked)?.value || "copy";
        S.settings.assignMode = v;
        writeLS(LS_KEYS.assignMode, v);
        updateEventIdLabel();
        toast("Media", v === "assign" ? "Asignación a evento: ACTIVADA" : "Asignación a evento: desactivada", 1400);
      });
    });

    targetRadios.forEach((r) => {
      r.addEventListener("change", () => {
        const v = targetRadios.find(x => x.checked)?.value || "hero";
        S.settings.assignTarget = v;
        writeLS(LS_KEYS.assignTarget, v);
        toast("Media", v === "more" ? "Target: MORE (events.more_img)" : "Target: HERO (events.img)", 1400);
      });
    });

    function syncUI() {
      const webp = supportsWebP();
      if (forceWebp) {
        forceWebp.disabled = !webp;
        forceWebp.parentElement.style.opacity = webp ? "1" : ".55";
        if (!webp) {
          forceWebp.checked = false;
          S.settings.forceWebp = false;
          writeLS(LS_KEYS.forceWebp, "0");
        }
      }
      if (quality && qualityVal) {
        const q = clampNum(Number(quality.value) / 100, 0.55, 0.95);
        qualityVal.textContent = String(Math.round(q * 100));
      }
      updateEventIdLabel();
    }

    optToggle?.addEventListener("change", () => {
      S.settings.optimize = !!optToggle.checked;
      writeLS(LS_KEYS.optimize, S.settings.optimize ? "1" : "0");
      toast("Media", S.settings.optimize ? "Optimización activada." : "Optimización desactivada.", 1200);
    });

    forceWebp?.addEventListener("change", () => {
      S.settings.forceWebp = !!forceWebp.checked;
      writeLS(LS_KEYS.forceWebp, S.settings.forceWebp ? "1" : "0");
      toast("Media", S.settings.forceWebp ? "Forzar WebP activado." : "Forzar WebP desactivado.", 1200);
    });

    quality?.addEventListener("input", () => {
      const q = clampNum(Number(quality.value) / 100, 0.55, 0.95);
      S.settings.quality = q;
      writeLS(LS_KEYS.quality, String(q));
      if (qualityVal) qualityVal.textContent = String(Math.round(q * 100));
    });

    resetBtn?.addEventListener("click", () => {
      S.settings = {
        optimize: true,
        forceWebp: false,
        quality: COMPRESS_QUALITY_DEFAULT,
        maxDim: COMPRESS_MAX_DIM_DEFAULT,

        assignMode: "copy",
        assignTarget: "hero",
      };
      writeLS(LS_KEYS.optimize, "1");
      writeLS(LS_KEYS.forceWebp, "0");
      writeLS(LS_KEYS.quality, String(COMPRESS_QUALITY_DEFAULT));
      writeLS(LS_KEYS.maxDim, String(COMPRESS_MAX_DIM_DEFAULT));
      writeLS(LS_KEYS.assignMode, "copy");
      writeLS(LS_KEYS.assignTarget, "hero");

      if (optToggle) optToggle.checked = true;
      if (forceWebp) forceWebp.checked = false;
      if (quality) quality.value = String(Math.round(COMPRESS_QUALITY_DEFAULT * 100));

      // radios reset
      modeRadios.forEach(x => x.checked = (x.value === "copy"));
      targetRadios.forEach(x => x.checked = (x.value === "hero"));

      const md = wrap.querySelector("#mediaMaxDimVal");
      if (md) md.textContent = String(COMPRESS_MAX_DIM_DEFAULT);

      syncUI();
      toast("Media", "Settings reiniciados.", 1200);
    });

    // refresca etiqueta cuando cambias de evento (admin.js puede disparar este evento)
    window.addEventListener("admin:eventSelected", syncUI);

    syncUI();
  }

  // ------------------------------------------------------------
  // Preview (img/video)
  // ------------------------------------------------------------
  function resetPreview() {
    const r = R();
    if (S.previewUrl) {
      try { URL.revokeObjectURL(S.previewUrl); } catch (_) {}
      S.previewUrl = "";
    }

    if (r.previewWrap) r.previewWrap.innerHTML = "";
    if (r.previewMeta) r.previewMeta.textContent = "";
    if (r.previewWrap) r.previewWrap.hidden = true;
    if (r.previewEmpty) r.previewEmpty.hidden = false;
  }

  function renderPreview(file) {
    const r = R();
    if (!file) { resetPreview(); return; }

    try { if (S.previewUrl) URL.revokeObjectURL(S.previewUrl); } catch (_) {}
    S.previewUrl = URL.createObjectURL(file);

    if (r.previewWrap) {
      r.previewWrap.innerHTML = "";

      if (isVideoFile(file)) {
        const v = document.createElement("video");
        v.src = S.previewUrl;
        v.muted = true;
        v.loop = true;
        v.playsInline = true;
        v.autoplay = true;
        v.controls = true;
        v.style.width = "100%";
        v.style.height = "auto";
        v.style.border = "1px solid rgba(255,255,255,.10)";
        r.previewWrap.appendChild(v);
      } else {
        const img = document.createElement("img");
        img.src = S.previewUrl;
        img.alt = file.name || "Preview";
        img.style.width = "100%";
        img.style.height = "auto";
        img.style.border = "1px solid rgba(255,255,255,.10)";
        r.previewWrap.appendChild(img);
      }
    }

    const meta = [
      file.name || "archivo",
      humanKB(file.size),
      (file.type || "*/*"),
      fmtShortDate(Date.now()),
    ].join(" · ");

    if (r.previewMeta) r.previewMeta.textContent = meta;

    if (r.previewEmpty) r.previewEmpty.hidden = true;
    if (r.previewWrap) r.previewWrap.hidden = false;
  }

  // ------------------------------------------------------------
  // Storage ops (bucket seleccionado)
  // ------------------------------------------------------------
  async function listFolderFromBucket(bucket, folder) {
    const sb = getSB();
    if (!sb) throw new Error("APP.supabase no existe.");

    const b = normalizeBucket(bucket);
    const f = sanitizeFolder(folder);

    const { data, error } = await sb.storage
      .from(b)
      .list(f, { limit: LIST_LIMIT, offset: 0, sortBy: { column: "updated_at", order: "desc" } });

    if (error) throw error;

    const items = Array.isArray(data) ? data : [];
    return items
      .filter((x) => x && x.name && !String(x.name).endsWith("/"))
      .map((x) => {
        const path = `${f}/${x.name}`;
        const updated = x.updated_at || x.created_at || x.last_accessed_at || "";
        return {
          bucket: b,
          name: x.name,
          path,
          url: publicUrlFromPath(b, path),
          updated_at: updated,
          size: x.metadata?.size || 0,
          mime: x.metadata?.mimetype || "",
        };
      })
      .sort((a, b) => safeStr(b.updated_at).localeCompare(safeStr(a.updated_at)));
  }

  async function uploadFile(bucket, file, folder, customName) {
    const sb = getSB();
    if (!sb) throw new Error("APP.supabase no existe.");

    const b = normalizeBucket(bucket);
    const f = sanitizeFolder(folder);
    const ext = extFromNameOrMime(file);

    const base =
      slugify(customName) ||
      slugify(String(file.name || "").replace(/\.[a-z0-9]+$/i, "")) ||
      "media";

    const path = `${f}/${base}_${Date.now()}.${ext}`;

    const { error } = await sb.storage.from(b).upload(path, file, {
      cacheControl: "3600",
      upsert: false,
    });
    if (error) throw error;

    return { bucket: b, path };
  }

  async function deleteObject(bucket, path) {
    const sb = getSB();
    if (!sb) throw new Error("APP.supabase no existe.");

    const b = normalizeBucket(bucket);
    const p = cleanSpaces(path);
    if (!b || !p) return;

    const { error } = await sb.storage.from(b).remove([p]);
    if (error) throw error;
    return true;
  }

  // ------------------------------------------------------------
  // Render list (img/video)
  // ------------------------------------------------------------
  function esc(s) { return escapeHtml(safeStr(s)); }

  function isVideoPathOrMime(it) {
    const name = safeStr(it?.name || "").toLowerCase();
    const mime = safeStr(it?.mime || "").toLowerCase();
    return mime.startsWith("video/") || name.endsWith(".mp4") || name.endsWith(".webm");
  }

  function renderList() {
    const r = R();
    const arr = Array.isArray(S.list) ? S.list : [];

    if (!r.listEl) return;
    r.listEl.innerHTML = "";

    if (!arr.length) {
      r.listEl.innerHTML = `
        <div class="item" style="cursor:default;">
          <div>
            <p class="itemTitle">Sin archivos en <b>${esc(S.currentBucket)}/${esc(S.currentFolder)}</b></p>
            <p class="itemMeta">Subí un medio para que aparezca aquí.</p>
          </div>
        </div>`;
      return;
    }

    const frag = document.createDocumentFragment();

    arr.forEach((it) => {
      const isVid = isVideoPathOrMime(it);

      const thumb = isVid
        ? `<video src="${esc(it.url)}" muted playsinline preload="metadata"
             style="width:70px;height:70px;object-fit:cover;border-radius:0;border:1px solid rgba(255,255,255,.10);flex:0 0 auto;"></video>`
        : `<img src="${esc(it.url)}" alt="${esc(it.name)}"
             style="width:70px;height:70px;object-fit:cover;border-radius:0;border:1px solid rgba(255,255,255,.10);flex:0 0 auto;" loading="lazy">`;

      const row = document.createElement("div");
      row.className = "item";
      row.dataset.bucket = it.bucket || "";
      row.dataset.path = it.path || "";
      row.dataset.url = it.url || "";

      row.innerHTML = `
        <div style="display:flex; gap:12px; align-items:flex-start; width:100%;">
          ${thumb}
          <div style="flex:1 1 auto;">
            <p class="itemTitle">${esc(it.name)}</p>
            <p class="itemMeta">${esc(fmtShortDate(it.updated_at))} · ${esc(humanKB(it.size))} · ${esc(it.mime || (isVid ? "video/*" : "image/*"))}</p>
            <p class="itemMeta" style="opacity:.75;">${esc(it.bucket)} · ${esc(it.path)}</p>
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

    const now = Date.now();
    if (!force && now - S.lastLoadedAt < 600) return;
    S.lastLoadedAt = now;

    try {
      setNote("", "");
      const s = await ensureSession();
      if (!s) return;

      const r = R();
      const folder = sanitizeFolder(r.folderSel?.value || S.currentFolder || "events");
      const bucket = normalizeBucket(r.bucketSel?.value || S.currentBucket || BUCKET_IMG);

      S.currentFolder = folder;
      S.currentBucket = bucket;

      applyAcceptForBucket(bucket);

      if (!silent) toast("Media", "Cargando…", 800);

      S.list = await listFolderFromBucket(bucket, folder);
      renderList();

      if (!silent) toast("Listo", "Media actualizada.", 900);
    } catch (err) {
      console.error("[admin-media]", err);

      if (looksLikeRLSError(err)) {
        toast("RLS", `Acceso bloqueado. Revisá policies del bucket (${S.currentBucket}).`, 5200);
      } else if (looksLikeStorageError(err)) {
        toast("Storage", `Error en bucket (${S.currentBucket}). (existe? policies? nombre?)`, 5200);
      } else {
        toast("Error", "No se pudo cargar la lista de Storage.", 4200);
      }
    }
  }

  // ------------------------------------------------------------
  // Clipboard
  // ------------------------------------------------------------
  async function copyUrl(text) {
    const t = cleanSpaces(text || "");
    if (!t) {
      toast("Sin URL", "Primero subí o seleccioná un archivo de la lista.");
      return;
    }

    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        await navigator.clipboard.writeText(t);
        toast("Copiado", "URL copiada al portapapeles.", 1800);
        return;
      }
    } catch (_) {}

    try {
      const ta = document.createElement("textarea");
      ta.value = t;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.style.top = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      toast("Copiado", ok ? "URL copiada al portapapeles." : "Copiala manualmente.", 2200);
    } catch (_) {
      toast("Copiar", "No pude acceder al portapapeles. Copiala manualmente.", 2800);
    }
  }

  // ------------------------------------------------------------
  // Handlers
  // ------------------------------------------------------------
  function onFileChange() {
    const r = R();
    const f = r.fileInp?.files && r.fileInp.files[0] ? r.fileInp.files[0] : null;
    if (!f) { resetPreview(); return; }

    const isImg = isImageFile(f);
    const isVid = isVideoFile(f);

    if (!isImg && !isVid) {
      toast("Archivo inválido", "Seleccioná una imagen (JPG/PNG/WebP) o un video (MP4/WebM).");
      try { r.fileInp.value = ""; } catch (_) {}
      resetPreview();
      return;
    }

    if (r.bucketSel) {
      r.bucketSel.value = isVid ? BUCKET_VID : BUCKET_IMG;
      S.currentBucket = normalizeBucket(r.bucketSel.value);
      applyAcceptForBucket(S.currentBucket);
    }

    const maxBytes = isVid ? MAX_VID_BYTES : MAX_IMG_BYTES;
    const maxMb = isVid ? MAX_VID_MB : MAX_IMG_MB;

    if (Number(f.size || 0) > maxBytes) {
      toast("Muy pesado", `El archivo pesa ${humanKB(f.size)}. Usá uno menor a ~${maxMb}MB.`);
      try { r.fileInp.value = ""; } catch (_) {}
      resetPreview();
      return;
    }

    renderPreview(f);
  }

  async function onUpload(e) {
    if (e && typeof e.preventDefault === "function") e.preventDefault();

    const r = R();
    const originalFile = r.fileInp?.files && r.fileInp.files[0] ? r.fileInp.files[0] : null;

    if (!originalFile) {
      toast("Falta archivo", "Seleccioná un archivo antes de subir.");
      return;
    }

    const isVid = isVideoFile(originalFile);
    const isImg = isImageFile(originalFile);

    if (!isVid && !isImg) {
      toast("Formato no soportado", "Solo imágenes (JPG/PNG/WebP) o videos (MP4/WebM).");
      return;
    }

    const folder = sanitizeFolder(r.folderSel?.value || "events");
    const customName = cleanSpaces(r.nameInp?.value || "");

    let bucket = normalizeBucket(r.bucketSel?.value || (isVid ? BUCKET_VID : BUCKET_IMG));

    if (isVid && bucket !== BUCKET_VID) bucket = BUCKET_VID;
    if (isImg && bucket !== BUCKET_IMG) bucket = BUCKET_IMG;

    if (r.bucketSel) r.bucketSel.value = bucket;
    applyAcceptForBucket(bucket);

    setBusy(true);
    try {
      let fileToUpload = originalFile;

      if (isImg) {
        setNote("Optimizando imagen…", "info");
        try {
          const out = await compressImageSmart(originalFile, S.settings);
          if (out && out.file) {
            fileToUpload = out.file;
            if (out.changed) {
              const from = out?.meta?.from;
              const to = out?.meta?.to;
              const q = Math.round((out?.meta?.quality || S.settings.quality) * 100);
              const md = out?.meta?.maxDim || S.settings.maxDim;

              const msg =
                `${out.note} · Q${q} · Max ${md}px ` +
                `(${humanKB(from?.size)} → ${humanKB(to?.size)} | ${from?.w}×${from?.h} → ${to?.w}×${to?.h})`;

              setNote(msg, "ok");
            } else {
              setNote("Imagen lista (sin cambios).", "ok");
            }
          }
        } catch (_) {
          setNote("Imagen lista (sin optimización).", "ok");
        }
      } else {
        setNote(`Video listo para subir (bucket: ${BUCKET_VID}).`, "ok");
      }

      const maxBytes = isVid ? MAX_VID_BYTES : MAX_IMG_BYTES;
      const maxMb = isVid ? MAX_VID_MB : MAX_IMG_MB;
      if (Number(fileToUpload.size || 0) > maxBytes) {
        toast("Muy pesado", `El archivo pesa ${humanKB(fileToUpload.size)}. Probá uno < ${maxMb}MB.`, 4200);
        setNote("⚠️ Archivo excede el límite.", "warn");
        return;
      }

      setNote("Subiendo a Supabase…", "info");
      const s = await ensureSession();
      if (!s) return;

      const up = await uploadFile(bucket, fileToUpload, folder, customName);
      const url = publicUrlFromPath(up.bucket, up.path);

      S.lastUploadedBucket = up.bucket;
      S.lastUploadedPath = up.path;

      if (r.urlInp) r.urlInp.value = url || "";

      setNote(`Listo. URL pública generada (${up.bucket}).`, "ok");
      toast("Subido", isVid ? "Video subido y URL lista." : "Imagen subida y URL lista.", 2200);

      // ✅ NUEVO: si está en modo asignación, intenta guardar en DB
      if (!isVid && url) {
        const res = await assignUrlToEvent(url);
        if (res?.ok) {
          setNote(`Listo: asignado a events.${res.field}.`, "ok");
        }
      }

      await refreshList({ silent: true, force: true });

      try { r.fileInp.value = ""; } catch (_) {}
      resetPreview();
    } catch (err) {
      console.error(err);
      setNote("", "");

      if (looksLikeRLSError(err)) {
        toast("RLS", `Bloqueado. Falta policy INSERT en bucket (${bucket}) para authenticated.`, 5200);
      } else if (looksLikeStorageError(err)) {
        toast("Storage", `Error en bucket (${bucket}) (policies / nombre / ruta).`, 5200);
      } else {
        toast("Error", "No se pudo subir el archivo.", 4200);
      }
    } finally {
      setBusy(false);
    }
  }

  function onReset() {
    const r = R();
    try { r.formEl?.reset(); } catch (_) {}
    if (r.urlInp) r.urlInp.value = "";
    setNote("", "");
    resetPreview();

    const b = normalizeBucket(r.bucketSel?.value || BUCKET_IMG);
    applyAcceptForBucket(b);

    toast("Limpiado", "Formulario reiniciado.");
  }

  async function onListClick(e) {
    const btn = e.target && e.target.closest ? e.target.closest("[data-act]") : null;
    if (!btn) return;

    const row = btn.closest(".item");
    if (!row) return;

    const act = btn.dataset.act;
    const bucket = row.dataset.bucket || "";
    const path = row.dataset.path || "";
    const url = row.dataset.url || "";

    const r = R();

    if (act === "use") {
      if (r.urlInp) r.urlInp.value = url || "";
      setNote("URL lista. Pegala en Eventos/Promos/Galería.", "ok");

      if (r.previewWrap && url) {
        if (r.previewEmpty) r.previewEmpty.hidden = true;
        r.previewWrap.hidden = false;
        r.previewWrap.innerHTML = "";

        const isVid = /\.(mp4|webm)(\?|#|$)/i.test(url);

        if (isVid) {
          const v = document.createElement("video");
          v.src = url;
          v.muted = true;
          v.loop = true;
          v.playsInline = true;
          v.autoplay = true;
          v.controls = true;
          v.style.width = "100%";
          v.style.height = "auto";
          v.style.border = "1px solid rgba(255,255,255,.10)";
          r.previewWrap.appendChild(v);
        } else {
          const img = document.createElement("img");
          img.src = url;
          img.alt = "Seleccionada";
          img.style.width = "100%";
          img.style.height = "auto";
          img.style.border = "1px solid rgba(255,255,255,.10)";
          r.previewWrap.appendChild(img);
        }

        if (r.previewMeta) r.previewMeta.textContent = `${bucket} · ${path} · ${fmtShortDate(Date.now())}`;
      }

      toast("Seleccionada", "URL cargada en el campo.", 1600);
      return;
    }

    if (act === "copy") {
      await copyUrl(url || r.urlInp?.value || "");
      return;
    }

    if (act === "delete") {
      const ok = confirm(`¿Eliminar este archivo?\n\n${bucket} :: ${path}\n\n(Se borra del bucket correspondiente)`);
      if (!ok) return;

      setBusy(true);
      try {
        const s = await ensureSession();
        if (!s) return;

        await deleteObject(bucket, path);

        if (cleanSpaces(r.urlInp?.value || "") === cleanSpaces(url)) {
          if (r.urlInp) r.urlInp.value = "";
        }

        toast("Eliminado", "Archivo eliminado del bucket.", 2200);
        await refreshList({ silent: true, force: true });
      } catch (err) {
        console.error(err);
        if (looksLikeRLSError(err)) toast("RLS", `Bloqueado. Falta policy DELETE en bucket (${bucket}).`, 5200);
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
    if (!r.formEl || !r.fileInp || !r.bucketSel || !r.folderSel || !r.urlInp || !r.uploadBtn || !r.copyBtn || !r.resetBtn || !r.refreshBtn || !r.listEl) {
      console.warn("[admin-media] Faltan elementos en el HTML del tab-media.");
      return;
    }

    ensureSettingsUI();

    S.currentBucket = normalizeBucket(r.bucketSel.value || BUCKET_IMG);
    S.currentFolder = sanitizeFolder(r.folderSel.value || "events");

    applyAcceptForBucket(S.currentBucket);

    r.fileInp.addEventListener("change", onFileChange);

    r.bucketSel.addEventListener("change", () => {
      const b = normalizeBucket(r.bucketSel.value || BUCKET_IMG);
      S.currentBucket = b;
      applyAcceptForBucket(b);
      refreshList({ silent: true, force: true });
    });

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

    S.settings = loadSettings();
    bindOnce();
    console.log("[admin-media] boot", { VERSION, BUCKET_IMG, BUCKET_VID, MAX_IMG_MB, MAX_VID_MB });
  }

  // ------------------------------------------------------------
  // Activación por tab (admin:tab)
  // ------------------------------------------------------------
  async function onTab(e) {
    const t = e?.detail?.tab || "";
    if (t !== "media") return;

    try { if (panel.hidden) return; } catch (_) {}

    const now = Date.now();
    if (now - S.lastTabLoadAt < 300) return;
    S.lastTabLoadAt = now;

    S.settings = loadSettings();
    ensureSettingsUI();

    const r = R();
    const b = normalizeBucket(r.bucketSel?.value || S.currentBucket || BUCKET_IMG);
    applyAcceptForBucket(b);

    await refreshList({ silent: true, force: false });
  }

  if (window.APP && APP.__adminReady) boot();
  else window.addEventListener("admin:ready", boot, { once: true });

  window.addEventListener("admin:tab", onTab);

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
