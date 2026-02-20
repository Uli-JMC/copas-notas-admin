"use strict";

/**
 * admin-media.js ✅ PRO — Media Library (Storage + DB + Bindings) — 2026-02-20
 *
 * Usa TU UI actual de admin.html (no crea paneles duplicados).
 * IDs existentes en tu HTML (tab Medios):
 *  - #mediaBucket, #mediaFolder, #mediaFile
 *  - #mediaUploadBtn, #mediaPublicUrl, #mediaCopyBtn, #mediaClearBtn
 *  - #mediaEventSelect, #mediaAssignedList
 *
 * BD real (según tu validación):
 *  - public.media_assets (TABLE)
 *  - public.media_bindings (TABLE) con UNIQUE (scope, scope_id, slot)
 *  - public.v_media_bindings_latest (VIEW)
 *
 * Qué hace:
 *  ✅ Subir a Storage (bucket: media|gallery|videos) + generar URL
 *  ✅ Guardar asset en media_assets
 *  ✅ Listar assets recientes (por “folder lógico” = events|gallery|videos)
 *  ✅ Copiar URL
 *  ✅ Asignar a evento + slot (UPsert en media_bindings)
 */

(function () {
  const VERSION = "2026-02-20.1";

  const $ = (sel, root = document) => root.querySelector(sel);

  const appPanel = $("#appPanel");
  if (!appPanel) return;

  // ---------------------------
  // Utils
  // ---------------------------
  function cleanSpaces(s) {
    return String(s ?? "").replace(/\s+/g, " ").trim();
  }

  function toast(title, msg, timeoutMs = 3200) {
    try {
      if (window.APP && typeof APP.toast === "function") return APP.toast(title, msg, timeoutMs);
    } catch (_) {}
    try {
      if (typeof window.toast === "function") return window.toast(title, msg, timeoutMs);
    } catch (_) {}

    const toastsEl = $("#toasts");
    if (!toastsEl) return;

    const el = document.createElement("div");
    el.className = "toast";
    el.innerHTML = `
      <div>
        <p class="tTitle">${String(title || "")}</p>
        <p class="tMsg">${String(msg || "")}</p>
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

  function getSB() {
    return window.APP && (window.APP.supabase || window.APP.sb)
      ? window.APP.supabase || window.APP.sb
      : null;
  }

  function prettyError(err) {
    return String(err?.message || err || "Ocurrió un error.");
  }

  function safeId() {
    return Math.random().toString(16).slice(2) + Date.now().toString(16);
  }

  function extFromName(name) {
    const n = String(name || "").trim();
    const m = n.match(/\.([a-z0-9]{1,10})$/i);
    return m ? m[1].toLowerCase() : "";
  }

  function normalizeFolder(f) {
    const x = cleanSpaces(f).toLowerCase();
    return x
      .replace(/[^a-z0-9/_-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^[-/]+|[-/]+$/g, "");
  }

  // ---------------------------
  // DB + Storage mapping
  // ---------------------------
  const EVENTS_TABLE = "events";
  const ASSETS_TABLE = "media_assets";
  const BINDINGS_TABLE = "media_bindings";
  const VIEW_LATEST = "v_media_bindings_latest";

  const STORAGE_BUCKETS = ["media", "gallery", "videos"];

  // folder lógico que guardamos en media_assets.folder (para filtrar en librería)
  const BUCKET_FOLDER = {
    media: "events",
    gallery: "gallery",
    videos: "videos",
  };

  // Slots (bindings.slot) que tu frontend usa
  const EVENT_SLOTS = ["slide_img", "slide_video", "desktop_event", "mobile_event", "event_more"];

  // ---------------------------
  // DOM refs (tu HTML actual)
  // ---------------------------
  const bucketEl = $("#mediaBucket");
  const slotEl = $("#mediaFolder"); // en tu UI actual esto funciona como “slot”
  const fileEl = $("#mediaFile");

  const uploadBtn = $("#mediaUploadBtn");
  const urlEl = $("#mediaPublicUrl");
  const copyBtn = $("#mediaCopyBtn");
  const clearBtn = $("#mediaClearBtn");

  const eventSel = $("#mediaEventSelect");
  const listEl = $("#mediaAssignedList");

  // El legacy tenía “target”. Ya no se usa; si existe, lo ocultamos sin romper tu HTML.
  const legacyTarget = $("#mediaTarget");
  if (legacyTarget) legacyTarget.closest(".field")?.classList?.add("is-hidden");

  const state = {
    busy: false,
    bucket: cleanSpaces(bucketEl?.value || "media") || "media",
    slot: cleanSpaces(slotEl?.value || "slide_img") || "slide_img",
    activeEventId: cleanSpaces(eventSel?.value || ""),
  };

  function setBusy(on, msg) {
    // tu admin usa #storageNote para mensajes; reusamos
    const note = $("#storageNote");
    if (!note) return;
    note.textContent = on ? (msg || "Procesando…") : (msg || "");
  }

  function validateBucketAndFile(bucket, file) {
    if (!STORAGE_BUCKETS.includes(bucket)) {
      toast("Bucket", "Elegí un bucket válido (media / gallery / videos).");
      return false;
    }
    if (!file) {
      toast("Archivo", "Elegí un archivo para subir.");
      return false;
    }

    const mime = String(file.type || "").toLowerCase();
    const name = String(file.name || "").toLowerCase();
    const isImage = mime.startsWith("image/") || /\.(jpg|jpeg|png|webp|avif)$/.test(name);
    const isVideo = mime.startsWith("video/") || /\.(mp4|webm)$/.test(name);

    if (bucket === "videos" && !isVideo) {
      toast("Archivo inválido", "En VIDEOS solo se permite .mp4 o .webm");
      return false;
    }
    if ((bucket === "media" || bucket === "gallery") && !isImage) {
      toast("Archivo inválido", "En MEDIA/GALLERY solo se permiten imágenes");
      return false;
    }
    return true;
  }

  async function fetchEvents() {
    const sb = getSB();
    if (!sb) return [];

    const { data, error } = await sb
      .from(EVENTS_TABLE)
      .select("id,title,month_key,type,created_at")
      .order("created_at", { ascending: false })
      .limit(250);

    if (error) throw error;
    return Array.isArray(data) ? data : [];
  }

  async function renderEventsSelect() {
    if (!eventSel) return;

    const current = String(eventSel.value || "");
    let events = [];

    try {
      events = await fetchEvents();
    } catch (e) {
      console.warn("[admin-media] no pude cargar eventos:", e);
    }

    eventSel.innerHTML =
      `<option value="">Seleccionar evento…</option>` +
      events
        .map((ev) => {
          const label = `${ev.title || "Evento"} • ${ev.month_key || ""} • ${ev.type || ""}`.trim();
          return `<option value="${ev.id}">${label}</option>`;
        })
        .join("");

    if (current && events.some((x) => String(x.id) === current)) {
      eventSel.value = current;
      state.activeEventId = current;
    } else {
      eventSel.value = "";
      state.activeEventId = "";
    }
  }

  async function insertAsset({ folder, name, path, public_url, mime, bytes }) {
    const sb = getSB();
    if (!sb) throw new Error("APP.supabase no existe.");

    const payload = {
      folder,
      name,
      path,
      public_url,
      mime: mime || null,
      bytes: bytes ?? null,
    };

    const { data, error } = await sb
      .from(ASSETS_TABLE)
      .insert(payload)
      .select("id, folder, name, path, public_url, created_at")
      .single();

    if (error) throw error;
    return data;
  }

  async function fetchAssetsLatest(folder, q, limit = 40) {
    const sb = getSB();
    if (!sb) throw new Error("APP.supabase no existe.");

    let req = sb
      .from(ASSETS_TABLE)
      .select("id, folder, name, path, public_url, mime, bytes, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (folder) req = req.eq("folder", folder);

    const query = cleanSpaces(q || "");
    if (query) req = req.or(`name.ilike.%${query}%,path.ilike.%${query}%,public_url.ilike.%${query}%`);

    const { data, error } = await req;
    if (error) throw error;
    return Array.isArray(data) ? data : [];
  }

  async function upsertBinding({ scope, scope_id, slot, media_id, note }) {
    const sb = getSB();
    if (!sb) throw new Error("APP.supabase no existe.");

    const payload = {
      scope,
      scope_id,
      slot,
      media_id,
      note: note || null,
      updated_at: new Date().toISOString(),
    };

    const { error } = await sb.from(BINDINGS_TABLE).upsert(payload, {
      onConflict: "scope,scope_id,slot",
    });

    if (error) throw error;
  }

  async function fetchLatestMapForEvent(eventId) {
    const sb = getSB();
    if (!sb) return {};

    try {
      const { data, error } = await sb
        .from(VIEW_LATEST)
        .select("slot, public_url, path")
        .eq("scope", "event")
        .eq("scope_id", String(eventId))
        .in("slot", EVENT_SLOTS);

      if (error) throw error;

      const map = {};
      (Array.isArray(data) ? data : []).forEach((r) => {
        const slot = String(r?.slot || "").trim();
        const url = String(r?.public_url || r?.path || "").trim();
        if (slot) map[slot] = url;
      });
      return map;
    } catch {
      return {};
    }
  }

  function renderAssetsList(rows, latestMap) {
    if (!listEl) return;

    if (!rows.length) {
      listEl.innerHTML = `<div class="hint">No hay archivos en esta carpeta.</div>`;
      return;
    }

    const evId = cleanSpaces(eventSel?.value || "");
    const slot = cleanSpaces(slotEl?.value || "");

    listEl.innerHTML = rows
      .map((a) => {
        const url = String(a.public_url || a.path || "").trim();
        const used = latestMap && Object.values(latestMap).includes(url);
        return `
          <div class="cardRow">
            <div class="rowMain">
              <div class="rowTitle">${a.name || a.id}${used ? ' <span class="pill">USADO</span>' : ""}</div>
              <div class="rowMeta">${url}</div>
            </div>
            <div class="rowActions">
              <button class="btn small" data-act="copy" data-url="${encodeURIComponent(url)}">Copiar</button>
              <button class="btn small primary" data-act="use" data-id="${a.id}" data-url="${encodeURIComponent(
          url
        )}" ${!evId || !slot ? "disabled" : ""}>Asignar</button>
            </div>
          </div>
        `;
      })
      .join("");

    // actions
    listEl.querySelectorAll("button[data-act='copy']").forEach((b) => {
      b.addEventListener("click", async () => {
        const url = decodeURIComponent(b.getAttribute("data-url") || "");
        try {
          await navigator.clipboard.writeText(url);
          toast("Copiado", "URL copiada.", 1200);
        } catch {
          toast("Copiar", "No se pudo copiar. Copiala manualmente.", 2200);
        }
      });
    });

    listEl.querySelectorAll("button[data-act='use']").forEach((b) => {
      b.addEventListener("click", async () => {
        const evId2 = cleanSpaces(eventSel?.value || "");
        const slot2 = cleanSpaces(slotEl?.value || "");
        const mediaId = String(b.getAttribute("data-id") || "");
        const url = decodeURIComponent(b.getAttribute("data-url") || "");

        if (!evId2) return toast("Asignar", "Elegí un evento.");
        if (!slot2) return toast("Asignar", "Elegí un slot.");

        try {
          setBusy(true, "Asignando…");
          await upsertBinding({
            scope: "event",
            scope_id: evId2,
            slot: slot2,
            media_id: mediaId,
            note: "admin_media_assign",
          });

          if (urlEl) urlEl.value = url;

          toast("Listo", `Asignado a ${slot2}.`, 1500);
          await refreshList(); // para refrescar badge “USADO”
        } catch (e) {
          console.error(e);
          toast("Error", prettyError(e), 5200);
        } finally {
          setBusy(false, "");
        }
      });
    });
  }

  async function refreshList() {
    const bucket = cleanSpaces(bucketEl?.value || state.bucket) || "media";
    const folderLogical = BUCKET_FOLDER[bucket] || "events";

    // search opcional: si existe input en tu HTML, lo tomamos; si no, queda vacío
    const qEl = $("#mediaSearch");
    const q = cleanSpaces(qEl?.value || "");

    const evId = cleanSpaces(eventSel?.value || "");
    const latestMap = evId ? await fetchLatestMapForEvent(evId) : null;

    const rows = await fetchAssetsLatest(folderLogical, q, 40);
    renderAssetsList(rows, latestMap);
  }

  async function upload() {
    const sb = getSB();
    if (!sb) throw new Error("APP.supabase no existe.");

    const bucket = cleanSpaces(bucketEl?.value || "media") || "media";
    const slot = cleanSpaces(slotEl?.value || "slide_img") || "slide_img";
    const file = fileEl?.files?.[0] || null;

    if (!validateBucketAndFile(bucket, file)) return;

    const folderLogical = BUCKET_FOLDER[bucket] || "events";
    const folderPath = normalizeFolder(folderLogical); // para el path en storage
    const ext = extFromName(file.name) || (bucket === "videos" ? "mp4" : "webp");
    const filename = `${folderPath}/${Date.now()}_${safeId()}.${ext}`;

    setBusy(true, "Subiendo archivo…");

    const up = await sb.storage.from(bucket).upload(filename, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type || undefined,
    });

    if (up.error) throw up.error;

    const pub = sb.storage.from(bucket).getPublicUrl(filename);
    const public_url = String(pub?.data?.publicUrl || "").trim();
    if (!public_url) throw new Error("No se pudo generar publicUrl (bucket no público).");

    setBusy(true, "Guardando en BD…");

    const asset = await insertAsset({
      folder: folderLogical, // events | gallery | videos
      name: slot, // slide_img | desktop_event | etc
      path: `${bucket}/${filename}`, // rastreable
      public_url,
      mime: file.type || null,
      bytes: file.size ?? null,
    });

    if (urlEl) urlEl.value = public_url;

    try {
      await navigator.clipboard.writeText(public_url);
      toast("Subido", "URL generada y copiada.", 1800);
    } catch {
      toast("Subido", "URL generada.", 1600);
    }

    // si hay evento seleccionado -> asignar directo
    const evId = cleanSpaces(eventSel?.value || "");
    if (evId && slot) {
      try {
        await upsertBinding({
          scope: "event",
          scope_id: evId,
          slot,
          media_id: asset.id,
          note: "admin_media_upload_assign",
        });
      } catch (e) {
        console.warn("[admin-media] subió pero no pudo asignar:", e);
      }
    }

    // limpiar file + refrescar lista
    if (fileEl) fileEl.value = "";
    await refreshList();

    setBusy(false, "");
  }

  // ---------------------------
  // Wiring
  // ---------------------------
  function bindOnce() {
    if (state.busy) return;
    const sb = getSB();
    if (!sb) return;

    // Si tu HTML tiene solo media/video, aquí lo forzamos a incluir gallery/videos si falta
    if (bucketEl && bucketEl.options.length < 3) {
      bucketEl.innerHTML = `
        <option value="media">media</option>
        <option value="gallery">gallery</option>
        <option value="videos">videos</option>
      `;
      bucketEl.value = "media";
    }

    // Si tu folder/slot select tiene legacy “home slider”, igual sirve: solo tomamos el value del option.
    // Recomendación: mantené values = slide_img, slide_video, desktop_event, mobile_event, event_more.
    // (Tu UI ya los tiene)

    uploadBtn?.addEventListener("click", async (e) => {
      e.preventDefault();
      try {
        await upload();
      } catch (err) {
        console.error(err);
        setBusy(false, "");
        toast("Error", prettyError(err), 5200);
      }
    });

    copyBtn?.addEventListener("click", async (e) => {
      e.preventDefault();
      const url = cleanSpaces(urlEl?.value || "");
      if (!url) return toast("Copiar", "No hay URL para copiar.");
      try {
        await navigator.clipboard.writeText(url);
        toast("Copiado", "URL copiada.", 1200);
      } catch {
        toast("Copiar", "No se pudo copiar. Copiala manualmente.", 2200);
      }
    });

    clearBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      if (urlEl) urlEl.value = "";
      if (fileEl) fileEl.value = "";
      toast("Listo", "Campos limpiados.", 1200);
    });

    bucketEl?.addEventListener("change", async () => {
      await refreshList();
    });

    eventSel?.addEventListener("change", async () => {
      await refreshList();
    });

    slotEl?.addEventListener("change", () => {
      // solo cambia el “slot actual” para upload/asignación; no refresca lista
    });
  }

  async function boot() {
    const sb = getSB();
    if (!sb) return;

    console.log("[admin-media.js] boot", { VERSION });

    setBusy(true, "Preparando Medios…");
    await renderEventsSelect();
    await refreshList();
    bindOnce();
    setBusy(false, "");
  }

  if (window.APP && APP.__adminReady) {
    boot();
  } else {
    window.addEventListener("admin:ready", boot, { once: true });
  }
})();