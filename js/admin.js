"use strict";

/**
 * admin.js ✅ PRO (EVENTS CRUD + MEDIA LIBRARY) — 2026-02-19
 *
 * OBJETIVO (lo que estamos haciendo):
 * ✅ Sin “Destino/Target” como filtro (el admin trabaja en scope=event para bindings)
 * ✅ Antes de subir: elegís SOLO la carpeta/slot (slide_img, slide_video, etc.)
 * ✅ Se sube el archivo al bucket correcto (media / video / gallery)
 * ✅ Se genera Public URL y:
 *    - se copia al portapapeles
 *    - y si hay un input de imagen/video activo (evImg/evVideoUrl/etc) lo rellena
 * ✅ Permite reutilizar el MISMO media_id en múltiples bindings (repetir imágenes)
 *
 * IMPORTANTE:
 * - Este admin soporta 2 modos:
 *   A) NUEVO sistema (recomendado): media_assets + media_bindings (+ view media_library opcional)
 *   B) Legacy: media_items (tu sistema viejo con target/event_id/folder)
 *
 * Si tu BD ya tiene media_library (por el SELECT que mostraste), este archivo
 * va a intentar usar el NUEVO sistema primero. Si falla (tabla no existe), cae a legacy.
 */

(function () {
  const VERSION = "2026-02-19.1";

  // ---------------------------
  // DOM helpers
  // ---------------------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const appPanel = $("#appPanel");
  if (!appPanel) return;

  // ---------------------------
  // Utils
  // ---------------------------
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

  function setNote(msg) {
    const el = $("#eventNote");
    if (!el) return;
    el.textContent = String(msg || "");
  }

  function setBusy(on, msg) {
    const note = $("#storageNote");
    if (!note) return;
    if (!on && msg == null) return;
    note.textContent = on ? (msg || "Procesando…") : (msg || "");
  }

  function cleanSpaces(s) {
    return String(s ?? "").replace(/\s+/g, " ").trim();
  }

  function slugifyName(s) {
    return cleanSpaces(s)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "file";
  }

  function inferExt(file) {
    const n = String(file?.name || "").toLowerCase();
    const dot = n.lastIndexOf(".");
    if (dot > -1 && dot < n.length - 1) return n.slice(dot + 1).replace(/[^a-z0-9]/g, "") || "bin";
    const t = String(file?.type || "").toLowerCase();
    if (t.includes("png")) return "png";
    if (t.includes("jpeg")) return "jpg";
    if (t.includes("webp")) return "webp";
    if (t.includes("gif")) return "gif";
    if (t.includes("mp4")) return "mp4";
    if (t.includes("webm")) return "webm";
    return "bin";
  }

  function isVideoExt(ext) {
    const e = String(ext || "").toLowerCase();
    return e === "mp4" || e === "webm" || e === "mov" || e === "m4v" || e === "avi";
  }

  async function copyToClipboard(text) {
    const t = String(text || "");
    if (!t) return false;

    try {
      await navigator.clipboard.writeText(t);
      return true;
    } catch (_) {}

    try {
      const ta = document.createElement("textarea");
      ta.value = t;
      ta.setAttribute("readonly", "readonly");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return !!ok;
    } catch (_) {}

    return false;
  }

  function getSB() {
    return window.APP && (window.APP.supabase || window.APP.sb)
      ? window.APP.supabase || window.APP.sb
      : null;
  }

  function isRLSError(err) {
    const m = String(err?.message || "").toLowerCase();
    const code = String(err?.code || "").toLowerCase();
    return (
      code === "42501" ||
      m.includes("42501") ||
      m.includes("rls") ||
      m.includes("permission") ||
      m.includes("not allowed") ||
      m.includes("row level security") ||
      m.includes("violates row-level security") ||
      m.includes("new row violates row-level security")
    );
  }

  function prettyError(err) {
    const msg = String(err?.message || err || "");
    return msg || "Ocurrió un error.";
  }

  // ---------------------------
  // Event helpers
  // ---------------------------
  const MONTHS = [
    "ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO",
    "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE",
  ];

  function normalizeMonth(m) {
    const up = String(m || "").trim().toUpperCase();
    return MONTHS.includes(up) ? up : "ENERO";
  }

  function parseHoursNumber(input) {
    const raw = cleanSpaces(input);
    if (!raw) return "";
    const m = raw.replace(",", ".").match(/(\d+(\.\d+)?)/);
    if (!m) return "";
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n < 0) return "";
    return String(n);
  }

  function normalizeTimeRange(s) {
    return cleanSpaces(s);
  }

  function buildDurationLabel(timeRange, durationHours) {
    const t = normalizeTimeRange(timeRange);
    const h = parseHoursNumber(durationHours);
    const hasH = h !== "" && Number(h) > 0;

    if (t && hasH) return `${t} · ${h} hrs`;
    if (t) return t;
    if (hasH) return `${h} hrs`;
    return "Por confirmar";
  }

  function normalizeCurrency(input, fallback = "USD") {
    const v = cleanSpaces(input).toUpperCase();
    if (!v) return fallback;
    if (v === "USD" || v === "CRC") return v;
    if (v.includes("$")) return "USD";
    if (v.includes("₡")) return "CRC";
    return fallback;
  }

  function parseMoneyAmount(input) {
    const raw = cleanSpaces(input);
    if (!raw) return null;
    const cleaned = raw.replace(/[^\d.,-]/g, "").replace(",", ".");
    const m = cleaned.match(/-?\d+(\.\d+)?/);
    if (!m) return null;
    const n = Number(m[0]);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.round(n * 100) / 100;
  }

  // ---------------------------
  // DB mapping
  // ---------------------------
  const EVENTS_TABLE = "events";

  // NEW media system tables (preferred)
  const MEDIA_ASSETS_TABLE = "media_assets";
  const MEDIA_BINDINGS_TABLE = "media_bindings";
  const MEDIA_LIBRARY_VIEW = "media_library"; // si existe, lo usamos para reads rápidos

  // Legacy table (fallback)
  const MEDIA_ITEMS_TABLE = "media_items";

  const SELECT_EVENTS = `
    id,
    title,
    type,
    month_key,
    description,
    location,
    time_range,
    duration_hours,
    price_amount,
    price_currency,
    more_img_alt,
    created_at,
    updated_at
  `;

  // ---------------------------
  // Slots / folders oficiales
  // ---------------------------
  const EVENT_SLOTS = ["slide_img", "slide_video", "desktop_event", "mobile_event", "event_more"];

  // Si querés meter galería en este mismo admin:
  // (si tu admin.html no lo muestra todavía, igual lo dejamos listo)
  const GALLERY_FOLDERS = ["gallery"];

  // Buckets que vos tenés:
  const STORAGE_BUCKETS = {
    eventsMedia: "media",
    eventsVideo: "video",
    gallery: "gallery",
  };

  const STORAGE_DIR = {
    media: "events",
    video: "events",
    gallery: "gallery",
  };

  function pickBucketAndDir(file, folder) {
    const f = cleanSpaces(folder || "");
    const ext = inferExt(file);
    const isVid = isVideoExt(ext);

    // carpeta de galería
    if (GALLERY_FOLDERS.includes(f)) {
      return { bucket: STORAGE_BUCKETS.gallery, dir: STORAGE_DIR.gallery };
    }

    // slot video o archivo video => bucket video
    if (f === "slide_video" || isVid) {
      return { bucket: STORAGE_BUCKETS.eventsVideo, dir: STORAGE_DIR.video };
    }

    // default => imágenes de eventos => bucket media
    return { bucket: STORAGE_BUCKETS.eventsMedia, dir: STORAGE_DIR.media };
  }

  // ---------------------------
  // State
  // ---------------------------
  const state = {
    activeTab: "events",
    query: "",
    activeEventId: null,
    events: [],
    mode: "supabase",
    busy: false,
    didBind: false,
    didBoot: false,
    didLoadOnce: false,

    // media mode: "new" | "legacy"
    mediaMode: "new",
  };

  function withLock(fn) {
    return async function (...args) {
      if (state.busy) return;
      state.busy = true;
      try {
        return await fn(...args);
      } finally {
        state.busy = false;
      }
    };
  }

  // ============================================================
  // MEDIA LAYER (NEW, with fallback)
  // ============================================================

  async function probeMediaMode() {
    const sb = getSB();
    if (!sb) return (state.mediaMode = "legacy");

    // probamos el VIEW primero (si existe)
    try {
      const t = await sb.from(MEDIA_LIBRARY_VIEW).select("binding_id").limit(1);
      if (!t.error) {
        state.mediaMode = "new";
        return;
      }
    } catch (_) {}

    // probamos tablas new
    try {
      const t1 = await sb.from(MEDIA_ASSETS_TABLE).select("id").limit(1);
      if (!t1.error) {
        state.mediaMode = "new";
        return;
      }
    } catch (_) {}

    // fallback legacy
    state.mediaMode = "legacy";
  }

  // ---------- Upload to Storage (bucket routing) ----------
  async function uploadToStorage(file, folder) {
    const sb = getSB();
    if (!sb) throw new Error("APP.supabase no existe.");

    const f = file;
    if (!f) throw new Error("No hay archivo.");

    const slotFolder = cleanSpaces(folder || "");
    const ext = inferExt(f);

    const { bucket, dir } = pickBucketAndDir(f, slotFolder);

    const baseName = slugifyName(slotFolder || (isVideoExt(ext) ? "video" : "img"));
    const filename = `${baseName}_${Date.now()}.${ext}`;
    const storagePath = `${dir}/${filename}`;

    const up = await sb.storage.from(bucket).upload(storagePath, f, {
      cacheControl: "3600",
      upsert: false,
      contentType: f.type || undefined,
    });
    if (up.error) throw up.error;

    const pub = sb.storage.from(bucket).getPublicUrl(storagePath);
    const publicUrl = pub?.data?.publicUrl ? String(pub.data.publicUrl) : "";

    return { path: storagePath, public_url: publicUrl, bucket, folder: slotFolder, name: filename };
  }

  // ---------- NEW: insert asset, then bind ----------
  async function insertMediaAsset(asset) {
    const sb = getSB();
    if (!sb) throw new Error("APP.supabase no existe.");

    // asset: { folder, name, path, public_url, mime, bytes }
    const payload = {
      folder: cleanSpaces(asset.folder || ""),
      name: cleanSpaces(asset.name || ""),
      path: cleanSpaces(asset.path || ""),
      public_url: cleanSpaces(asset.public_url || ""),
      mime: asset.mime || null,
      bytes: asset.bytes || null,
    };

    const { data, error } = await sb.from(MEDIA_ASSETS_TABLE).insert(payload).select("*").single();
    if (error) throw error;
    return data;
  }

  async function upsertBinding(scope, scope_id, slot, media_id) {
    const sb = getSB();
    if (!sb) throw new Error("APP.supabase no existe.");

    const payload = {
      scope: cleanSpaces(scope),
      scope_id: String(scope_id),
      slot: cleanSpaces(slot),
      media_id: String(media_id),
    };

    // Normalmente tu UNIQUE debería ser (scope, scope_id, slot) para 1 por slot.
    // Reutilizar el mismo media_id en varios eventos SÍ se permite.
    const { error } = await sb
      .from(MEDIA_BINDINGS_TABLE)
      .upsert(payload, { onConflict: "scope,scope_id,slot" });

    if (error) throw error;
  }

  async function deleteBinding(scope, scope_id, slot) {
    const sb = getSB();
    if (!sb) throw new Error("APP.supabase no existe.");

    const { error } = await sb
      .from(MEDIA_BINDINGS_TABLE)
      .delete()
      .eq("scope", scope)
      .eq("scope_id", scope_id)
      .eq("slot", slot);

    if (error) throw error;
  }

  // ---------- NEW: fetch event media (map slot->url) ----------
  async function fetchEventMedia_NEW(eventId) {
    const sb = getSB();
    if (!sb) throw new Error("APP.supabase no existe.");

    const eid = String(eventId || "").trim();
    if (!eid) return {};

    // Si existe view media_library, es la más cómoda (como tu tabla)
    // columnas vistas: scope, scope_id, slot, public_url, path, etc.
    let rows = null;

    try {
      const { data, error } = await sb
        .from(MEDIA_LIBRARY_VIEW)
        .select("slot, public_url, path")
        .eq("scope", "event")
        .eq("scope_id", eid)
        .in("slot", EVENT_SLOTS);

      if (!error) rows = Array.isArray(data) ? data : [];
    } catch (_) {}

    // fallback: join manual (si no hay view)
    if (!rows) {
      const { data: binds, error: bErr } = await sb
        .from(MEDIA_BINDINGS_TABLE)
        .select("slot, media_id")
        .eq("scope", "event")
        .eq("scope_id", eid)
        .in("slot", EVENT_SLOTS);

      if (bErr) throw bErr;

      const ids = (Array.isArray(binds) ? binds : []).map((x) => x.media_id).filter(Boolean);
      if (!ids.length) return {};

      const { data: assets, error: aErr } = await sb
        .from(MEDIA_ASSETS_TABLE)
        .select("id, public_url, path")
        .in("id", ids);

      if (aErr) throw aErr;

      const assetMap = new Map((assets || []).map((a) => [String(a.id), a]));
      rows = (binds || []).map((b) => {
        const a = assetMap.get(String(b.media_id));
        return { slot: b.slot, public_url: a?.public_url || "", path: a?.path || "" };
      });
    }

    const map = {};
    rows.forEach((r) => {
      const slot = cleanSpaces(r?.slot || "");
      const url = cleanSpaces(r?.public_url || r?.path || "");
      if (slot) map[slot] = url;
    });

    return map;
  }

  // ---------- LEGACY: fetch event media (media_items target=event) ----------
  async function fetchEventMedia_LEGACY(eventId) {
    const sb = getSB();
    if (!sb) throw new Error("APP.supabase no existe.");

    const eid = String(eventId || "").trim();
    if (!eid) return {};

    const { data, error } = await sb
      .from(MEDIA_ITEMS_TABLE)
      .select("folder, public_url, path")
      .eq("target", "event")
      .eq("event_id", eid)
      .in("folder", EVENT_SLOTS);

    if (error) throw error;

    const map = {};
    (Array.isArray(data) ? data : []).forEach((row) => {
      const f = String(row?.folder || "").trim();
      const url = String(row?.public_url || row?.path || "").trim();
      if (f) map[f] = url;
    });

    return map;
  }

  async function fetchEventMedia(eventId) {
    if (state.mediaMode === "new") return fetchEventMedia_NEW(eventId);
    return fetchEventMedia_LEGACY(eventId);
  }

  // ---------- LEGACY: upsert/delete media_items ----------
  async function legacyDeleteEventMedia(eventId, folder) {
    const sb = getSB();
    if (!sb) throw new Error("APP.supabase no existe.");

    const eid = String(eventId || "").trim();
    const f = String(folder || "").trim();
    if (!eid || !f) return;

    const { error } = await sb
      .from(MEDIA_ITEMS_TABLE)
      .delete()
      .eq("target", "event")
      .eq("event_id", eid)
      .eq("folder", f);

    if (error) throw error;
  }

  async function legacyUpsertEventMedia(eventId, folder, url) {
    const sb = getSB();
    if (!sb) throw new Error("APP.supabase no existe.");

    const eid = String(eventId || "").trim();
    const f = String(folder || "").trim();
    const u = String(url || "").trim();

    if (!eid || !f) return;

    if (!u) {
      await legacyDeleteEventMedia(eid, f);
      return;
    }

    const payload = {
      target: "event",
      folder: f,
      name: f,
      path: u,
      public_url: u,
      event_id: eid,
    };

    const { error } = await sb
      .from(MEDIA_ITEMS_TABLE)
      .upsert(payload, { onConflict: "event_id,folder" });

    if (error) throw error;
  }

  // ---------- Save media bindings based on URL fields ----------
  async function saveEventMediaFromEditor(eventId, urlsBySlot) {
    const sb = getSB();
    if (!sb) throw new Error("APP.supabase no existe.");

    const eid = String(eventId || "").trim();
    if (!eid) return;

    if (state.mediaMode === "legacy") {
      // legacy: direct save url into media_items
      for (const slot of EVENT_SLOTS) {
        const u = cleanSpaces(urlsBySlot[slot] || "");
        await legacyUpsertEventMedia(eid, slot, u);
      }
      return;
    }

    // NEW:
    // Si el usuario pegó un URL externo (no de supabase), lo guardamos como asset igual (public_url=url, path=url).
    // Luego bind.
    for (const slot of EVENT_SLOTS) {
      const u = cleanSpaces(urlsBySlot[slot] || "");
      if (!u) {
        await deleteBinding("event", eid, slot);
        continue;
      }

      // 1) Crear asset (si querés dedupe por URL, eso se hace con unique/lookup en SQL; acá no bloqueamos repetidos)
      const asset = await insertMediaAsset({
        folder: slot,
        name: slot,
        path: u,
        public_url: u,
        mime: null,
        bytes: null,
      });

      // 2) Bind al slot del evento
      await upsertBinding("event", eid, slot, asset.id);
    }
  }

  // ============================================================
  // TABS
  // ============================================================
  function hideAllTabs() {
    $$('[role="tabpanel"]', appPanel).forEach((p) => {
      p.hidden = true;
    });
  }

  function setTab(tabName) {
    const next = tabName || "events";
    if (next === state.activeTab) return;

    state.activeTab = next;

    $$(".tab", appPanel).forEach((t) => {
      t.setAttribute("aria-selected", t.dataset.tab === state.activeTab ? "true" : "false");
    });

    hideAllTabs();

    const panel = $("#tab-" + state.activeTab);
    if (panel) panel.hidden = false;

    if (state.activeTab === "events") {
      ensureEventsLoaded(false);
      renderAll();
    }
  }

  // ============================================================
  // SUPABASE CRUD: EVENTS
  // ============================================================
  async function fetchEvents() {
    const sb = getSB();
    if (!sb) {
      state.mode = "missing";
      state.events = [];
      return;
    }

    setBusy(true, "Cargando eventos desde Supabase…");

    const { data, error } = await sb
      .from(EVENTS_TABLE)
      .select(SELECT_EVENTS)
      .order("created_at", { ascending: false });

    if (error) {
      state.events = [];
      state.mode = isRLSError(error) ? "blocked" : "supabase";
      setBusy(
        false,
        isRLSError(error)
          ? "RLS bloquea. Faltan policies para events."
          : "No se pudieron cargar eventos."
      );
      throw error;
    }

    state.mode = "supabase";
    state.events = Array.isArray(data) ? data : [];
    state.didLoadOnce = true;
    setBusy(false, "");
  }

  async function insertEvent(payload) {
    const sb = getSB();
    if (!sb) throw new Error("APP.supabase no existe. Revisá el orden: supabaseClient.js → admin.js");

    const { data, error } = await sb
      .from(EVENTS_TABLE)
      .insert(payload)
      .select(SELECT_EVENTS)
      .single();

    if (error) throw error;
    return data;
  }

  async function updateEvent(id, payload) {
    const sb = getSB();
    if (!sb) throw new Error("APP.supabase no existe. Revisá el orden: supabaseClient.js → admin.js");

    const { data, error } = await sb
      .from(EVENTS_TABLE)
      .update(payload)
      .eq("id", id)
      .select(SELECT_EVENTS)
      .single();

    if (error) throw error;
    return data;
  }

  async function deleteEvent(id) {
    const sb = getSB();
    if (!sb) throw new Error("APP.supabase no existe. Revisá el orden: supabaseClient.js → admin.js");

    const { error } = await sb.from(EVENTS_TABLE).delete().eq("id", id);
    if (error) throw error;

    // Cleanup bindings/items
    try {
      if (state.mediaMode === "new") {
        const del = await sb.from(MEDIA_BINDINGS_TABLE).delete().eq("scope", "event").eq("scope_id", id);
        if (del.error) throw del.error;
      } else {
        const del = await sb.from(MEDIA_ITEMS_TABLE).delete().eq("target", "event").eq("event_id", id);
        if (del.error) throw del.error;
      }
    } catch (e) {
      console.warn("[admin] cleanup media failed:", e);
    }
  }

  // ============================================================
  // RENDER: list + editor
  // ============================================================
  function setEditorVisible(show) {
    $("#editorEmpty") && ($("#editorEmpty").hidden = show);
    $("#eventForm") && ($("#eventForm").hidden = !show);
  }

  function clearEditorForm() {
    const ids = [
      "eventId",
      "evTitle",
      "evType",
      "evMonth",
      "evDesc",
      "evLocation",
      "evTimeRange",
      "evDurationHours",
      "evDuration",
      "evPriceAmount",
      "evPriceCurrency",

      // campos existentes de media (URLs)
      "evImg",
      "evImgDesktop",
      "evImgMobile",
      "evVideoUrl",
      "evMoreImg",

      "evMoreImgAlt",
    ];

    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });

    $("#descCount") && ($("#descCount").textContent = "0");
    setNote("");
  }

  function getFilteredEvents() {
    const q = cleanSpaces(state.query).toLowerCase();
    return (state.events || []).filter((ev) => {
      if (!q) return true;
      return (
        String(ev.title || "").toLowerCase().includes(q) ||
        String(ev.type || "").toLowerCase().includes(q) ||
        String(ev.month_key || "").toLowerCase().includes(q)
      );
    });
  }

  function renderEventList() {
    const box = $("#eventList");
    if (!box) return;

    const filtered = getFilteredEvents();

    if (state.mode === "missing") {
      box.innerHTML = `
        <div class="item" style="cursor:default;">
          <div>
            <p class="itemTitle">Sin conexión a Supabase</p>
            <p class="itemMeta">Falta cargar supabaseClient.js antes de admin.js.</p>
          </div>
        </div>`;
      return;
    }

    if (state.mode === "blocked") {
      box.innerHTML = `
        <div class="item" style="cursor:default;">
          <div>
            <p class="itemTitle">Acceso bloqueado por RLS</p>
            <p class="itemMeta">Faltan policies SELECT/INSERT/UPDATE/DELETE para <code>events</code>.</p>
          </div>
        </div>`;
      return;
    }

    if (!filtered.length) {
      box.innerHTML = `
        <div class="item" style="cursor:default;">
          <div>
            <p class="itemTitle">Sin eventos</p>
            <p class="itemMeta">Creá el primero con “Nuevo”.</p>
          </div>
        </div>`;
      return;
    }

    box.innerHTML = "";

    filtered.forEach((ev) => {
      const item = document.createElement("div");
      item.className = "item";
      if (state.activeEventId && String(ev.id) === String(state.activeEventId)) item.classList.add("active");

      item.innerHTML = `
        <div>
          <p class="itemTitle">${escapeHtml(ev.title || "—")}</p>
          <p class="itemMeta">${escapeHtml(ev.type || "—")} • ${escapeHtml(ev.month_key || "—")}</p>
        </div>
        <div class="pills"><span class="pill">SUPABASE</span></div>
      `;

      item.addEventListener("click", async () => {
        state.activeEventId = ev.id;
        await renderAll();
      });

      box.appendChild(item);
    });
  }

  async function renderEventEditor() {
    const ev = (state.events || []).find((e) => String(e.id) === String(state.activeEventId)) || null;

    if (!ev) {
      clearEditorForm();
      setEditorVisible(false);
      return;
    }

    setEditorVisible(true);

    $("#eventId") && ($("#eventId").value = String(ev.id || ""));
    $("#evTitle") && ($("#evTitle").value = ev.title || "");

    const typeEl = $("#evType");
    if (typeEl) {
      const dbType = String(ev.type || "Cata de vino");
      const hasOption = Array.from(typeEl.options || []).some((o) => String(o.value) === dbType);
      typeEl.value = hasOption ? dbType : "Cata de vino";
      if (!hasOption && dbType) setNote(`Nota: el tipo guardado en DB es "${dbType}".`);
    }

    $("#evMonth") && ($("#evMonth").value = normalizeMonth(ev.month_key));
    const d = ev.description || "";
    $("#evDesc") && ($("#evDesc").value = d);
    $("#descCount") && ($("#descCount").textContent = String(String(d).length));

    $("#evLocation") && ($("#evLocation").value = ev.location || "");
    $("#evTimeRange") && ($("#evTimeRange").value = ev.time_range || "");
    $("#evDurationHours") && ($("#evDurationHours").value = ev.duration_hours || "");

    const dur = $("#evDuration");
    if (dur) {
      const label = buildDurationLabel(ev.time_range || "", ev.duration_hours || "");
      dur.value = label === "Por confirmar" ? "" : label;
    }

    const priceAmountEl = $("#evPriceAmount");
    const priceCurrencyEl = $("#evPriceCurrency");
    if (priceAmountEl) priceAmountEl.value = ev.price_amount == null ? "" : String(ev.price_amount);
    if (priceCurrencyEl) priceCurrencyEl.value = normalizeCurrency(ev.price_currency, "USD");

    const altEl = $("#evMoreImgAlt");
    if (altEl) altEl.value = ev.more_img_alt || "";

    // media urls (slot map -> inputs)
    try {
      const media = await fetchEventMedia(ev.id);

      // UI existente:
      // evImg -> slide_img
      // evVideoUrl -> slide_video
      // evImgDesktop -> desktop_event
      // evImgMobile -> mobile_event
      // evMoreImg -> event_more
      const slideImgEl = $("#evImg");
      const slideVideoEl = $("#evVideoUrl");
      const deskEl = $("#evImgDesktop") || $("#evImg");
      const mobEl = $("#evImgMobile");
      const moreEl = $("#evMoreImg");

      if (slideImgEl) slideImgEl.value = media.slide_img || "";
      if (slideVideoEl) slideVideoEl.value = media.slide_video || "";
      if (deskEl) deskEl.value = media.desktop_event || "";
      if (mobEl) mobEl.value = media.mobile_event || "";
      if (moreEl) moreEl.value = media.event_more || "";
    } catch (err) {
      console.error(err);
      toast("Media", "No se pudo cargar media (revisá RLS/policies).", 4200);
    }
  }

  async function renderAll() {
    if (state.activeTab !== "events") return;
    renderEventList();
    await renderEventEditor();
  }

  async function ensureEventsLoaded(force) {
    if (state.mode === "missing") return;
    if (state.didLoadOnce && !force) return;

    try {
      await fetchEvents();
      if (!state.activeEventId && state.events.length) state.activeEventId = state.events[0].id;
    } catch (err) {
      console.error(err);
      toast(
        isRLSError(err) ? "RLS" : "Supabase",
        isRLSError(err) ? "No se pudo leer events. Falta policy SELECT." : "No se pudieron cargar eventos.",
        5200
      );
    } finally {
      await renderAll();
    }
  }

  // ============================================================
  // ACTIONS
  // ============================================================
  const createNewEvent = withLock(async function () {
    try {
      if (state.mode !== "supabase") return toast("Bloqueado", "Supabase no está listo o RLS bloquea.");

      setBusy(true, "Creando evento…");
      const typeFallback = $("#evType")?.value || "Cata de vino";

      const payload = {
        title: "Nuevo evento",
        type: typeFallback,
        month_key: "ENERO",
        description: "",
        location: "Por confirmar",
        time_range: "",
        duration_hours: "",
        price_amount: null,
        price_currency: "USD",
        more_img_alt: "",
      };

      const created = await insertEvent(payload);
      state.events.unshift(created);
      state.activeEventId = created.id;

      toast("Evento creado", "Ya podés editarlo y guardarlo.", 1600);
      await renderAll();
      try {
        await ensureEventsLoaded(true);
      } catch (_) {}
    } catch (err) {
      console.error(err);
      toast(
        isRLSError(err) ? "RLS" : "Error",
        isRLSError(err) ? "Falta policy INSERT para events." : prettyError(err),
        5200
      );
    } finally {
      setBusy(false, "");
    }
  });

  const duplicateActiveEvent = withLock(async function () {
    const ev = (state.events || []).find((e) => String(e.id) === String(state.activeEventId));
    if (!ev) return toast("Duplicar", "Seleccioná un evento primero.");

    try {
      if (state.mode !== "supabase") return toast("Bloqueado", "Supabase no está listo o RLS bloquea.");

      setBusy(true, "Duplicando evento…");

      const payload = {
        title: `${ev.title || "Evento"} (Copia)`,
        type: ev.type || ($("#evType")?.value || "Cata de vino"),
        month_key: normalizeMonth(ev.month_key || "ENERO"),
        description: ev.description || "",
        location: ev.location || "Por confirmar",
        time_range: ev.time_range || "",
        duration_hours: ev.duration_hours || "",
        price_amount: ev.price_amount == null ? null : ev.price_amount,
        price_currency: normalizeCurrency(ev.price_currency, "USD"),
        more_img_alt: ev.more_img_alt || "",
      };

      const created = await insertEvent(payload);

      // Copiar media: acá copiamos URLs (y se rebindea a assets nuevos si estás en NEW mode)
      try {
        const m = await fetchEventMedia(ev.id);

        // Llenamos inputs temporalmente y guardamos usando el mismo pipeline
        const urlsBySlot = {
          slide_img: m.slide_img || "",
          slide_video: m.slide_video || "",
          desktop_event: m.desktop_event || "",
          mobile_event: m.mobile_event || "",
          event_more: m.event_more || "",
        };

        await saveEventMediaFromEditor(created.id, urlsBySlot);
      } catch (e) {
        console.warn("[admin] duplicate media failed:", e);
      }

      state.events.unshift(created);
      state.activeEventId = created.id;

      toast("Duplicado", "Copia creada.", 1500);
      await renderAll();
      try {
        await ensureEventsLoaded(true);
      } catch (_) {}
    } catch (err) {
      console.error(err);
      toast(
        isRLSError(err) ? "RLS" : "Error",
        isRLSError(err) ? "Falta policy INSERT para events." : prettyError(err),
        5200
      );
    } finally {
      setBusy(false, "");
    }
  });

  const deleteActiveEvent = withLock(async function () {
    const ev = (state.events || []).find((e) => String(e.id) === String(state.activeEventId));
    if (!ev) return toast("Eliminar", "Seleccioná un evento primero.");

    const ok = window.confirm(`Eliminar evento:\n\n${ev.title}\n\nEsta acción no se puede deshacer.`);
    if (!ok) return;

    try {
      if (state.mode !== "supabase") return toast("Bloqueado", "Supabase no está listo o RLS bloquea.");

      setBusy(true, "Eliminando evento…");
      await deleteEvent(ev.id);

      state.events = (state.events || []).filter((x) => String(x.id) !== String(ev.id));
      state.activeEventId = null;

      toast("Evento eliminado", "Se eliminó correctamente.", 1600);
      await renderAll();
      try {
        await ensureEventsLoaded(true);
      } catch (_) {}
    } catch (err) {
      console.error(err);
      toast(
        isRLSError(err) ? "RLS" : "Error",
        isRLSError(err) ? "Falta policy DELETE." : prettyError(err),
        5200
      );
    } finally {
      setBusy(false, "");
    }
  });

  const saveActiveEvent = withLock(async function () {
    const ev = (state.events || []).find((e) => String(e.id) === String(state.activeEventId));
    if (!ev) return false;

    const title = cleanSpaces($("#evTitle")?.value || "");
    const type = cleanSpaces($("#evType")?.value || "Cata de vino");
    const month_key = normalizeMonth($("#evMonth")?.value || "ENERO");

    const description = cleanSpaces($("#evDesc")?.value || "");
    const location = cleanSpaces($("#evLocation")?.value || "");
    const time_range = normalizeTimeRange($("#evTimeRange")?.value || "");
    const duration_hours = parseHoursNumber($("#evDurationHours")?.value || "");

    const priceAmountEl = $("#evPriceAmount");
    const priceCurrencyEl = $("#evPriceCurrency");

    let price_amount = ev.price_amount == null ? null : ev.price_amount;
    let price_currency = normalizeCurrency(ev.price_currency, "USD");

    if (priceAmountEl) price_amount = parseMoneyAmount(priceAmountEl.value);
    if (priceCurrencyEl) price_currency = normalizeCurrency(priceCurrencyEl.value, "USD");

    const moreAlt = cleanSpaces($("#evMoreImgAlt")?.value || ev.more_img_alt || "");

    if (!title) {
      toast("Falta el nombre", "Ingresá el nombre del evento.");
      return false;
    }

    const payload = {
      title,
      type,
      month_key,
      description,
      location: location || "Por confirmar",
      time_range,
      duration_hours: duration_hours === "0" ? "" : duration_hours,
      price_amount,
      price_currency,
      more_img_alt: moreAlt,
    };

    // Media inputs (URLs)
    const slideImgEl = $("#evImg");
    const deskEl = $("#evImgDesktop") || $("#evImg");
    const mobEl = $("#evImgMobile");
    const slideVideoEl = $("#evVideoUrl");
    const moreEl = $("#evMoreImg");

    const urlsBySlot = {
      slide_img: cleanSpaces(slideImgEl?.value || ""),
      desktop_event: cleanSpaces(deskEl?.value || ""),
      mobile_event: cleanSpaces(mobEl?.value || ""),
      slide_video: cleanSpaces(slideVideoEl?.value || ""),
      event_more: cleanSpaces(moreEl?.value || ""),
    };

    try {
      if (state.mode !== "supabase") return false;

      setBusy(true, "Guardando cambios…");
      const updated = await updateEvent(ev.id, payload);

      // ✅ media save (new bindings or legacy media_items)
      await saveEventMediaFromEditor(ev.id, urlsBySlot);

      state.events = (state.events || []).map((x) => (String(x.id) === String(updated.id) ? updated : x));

      toast("Guardado", `Evento actualizado (${state.mediaMode === "new" ? "Media Library" : "Legacy"}).`, 1400);
      setNote("");
      await renderAll();
      try {
        await ensureEventsLoaded(true);
      } catch (_) {}
      return true;
    } catch (err) {
      console.error(err);
      toast(
        isRLSError(err) ? "RLS" : "Error",
        isRLSError(err)
          ? "RLS bloqueó el guardado. Revisá policies en media_assets/media_bindings (o media_items)."
          : prettyError(err),
        5200
      );
      return false;
    } finally {
      setBusy(false, "");
    }
  });

  // ============================================================
  // MINI UPLOADER “SIN DESTINO”: elegir folder, subir, copiar URL, autollenar input
  // ============================================================
  function getMediaFolderSelect() {
    // Si tu admin.html tiene un select para folder (como el screenshot), intentamos tomarlo.
    // Priorizamos ids comunes: #folderSelect, #mediaFolder, #folder
    return $("#folderSelect") || $("#mediaFolder") || $("#folder") || null;
  }

  function getFileInput() {
    // ids típicos: #mediaFile, #uploadFile, #file
    return $("#mediaFile") || $("#uploadFile") || $("#file") || null;
  }

  function getUploadButton() {
    // ids típicos: #uploadBtn, #btnUpload
    return $("#uploadBtn") || $("#btnUpload") || null;
  }

  function getCopyUrlButton() {
    return $("#copyUrlBtn") || $("#btnCopyUrl") || null;
  }

  function getUrlOutputInput() {
    return $("#mediaUrl") || $("#urlOutput") || $("#publicUrl") || null;
  }

  function getLastFocusedMediaInput() {
    // si el usuario está editando un campo de URL (evImg, evVideoUrl, etc.)
    // y tiene foco, lo usamos para pegar.
    const a = document.activeElement;
    if (!a) return null;
    const id = String(a.id || "");
    const okIds = ["evImg", "evVideoUrl", "evImgDesktop", "evImgMobile", "evMoreImg"];
    if (okIds.includes(id)) return a;
    return null;
  }

  async function handleUploadFlow() {
    const sb = getSB();
    if (!sb) return toast("Error", "Supabase no está cargado. Revisá scripts.");

    const folderSel = getMediaFolderSelect();
    const fileEl = getFileInput();

    const folder = cleanSpaces(folderSel?.value || "");
    const file = fileEl?.files?.[0] || null;

    if (!folder) return toast("Falta carpeta", "Elegí la carpeta/slot antes de subir.");
    if (!file) return toast("Falta archivo", "Seleccioná un archivo para subir.");

    try {
      setBusy(true, "Subiendo a Storage…");

      const up = await uploadToStorage(file, folder);

      // URL final
      const url = up.public_url || "";

      // mostrar en output si existe
      const out = getUrlOutputInput();
      if (out) out.value = url;

      // copiar
      const copied = await copyToClipboard(url);

      // autollenar en el input activo (si aplica)
      const targetInput = getLastFocusedMediaInput();
      if (targetInput) {
        targetInput.value = url;
        targetInput.dispatchEvent(new Event("input", { bubbles: true }));
      }

      // si estás en NEW mode y querés que la subida también cree asset inmediatamente:
      if (state.mediaMode === "new") {
        try {
          await insertMediaAsset({
            folder,
            name: up.name || folder,
            path: up.path,
            public_url: url,
            mime: file.type || null,
            bytes: file.size || null,
          });
        } catch (e) {
          // si falla por RLS, igual ya tenés el URL, no rompemos el flow
          console.warn("[admin] insertMediaAsset failed:", e);
        }
      }

      toast(
        "Listo",
        copied ? "Subido y URL copiado. Pegalo donde querás." : "Subido. Copiá el URL y pegalo donde querás.",
        2400
      );
    } catch (err) {
      console.error(err);
      toast(isRLSError(err) ? "RLS" : "Upload", isRLSError(err) ? "RLS bloqueó Storage/DB." : prettyError(err), 5200);
    } finally {
      setBusy(false, "");
      // opcional: limpiar file input
      try {
        if (fileEl) fileEl.value = "";
      } catch (_) {}
    }
  }

  async function handleCopyUrl() {
    const out = getUrlOutputInput();
    const url = cleanSpaces(out?.value || "");
    if (!url) return toast("Nada para copiar", "Primero subí un archivo o pegá un URL.");
    const ok = await copyToClipboard(url);
    toast(ok ? "Copiado" : "Copiá manual", ok ? "URL copiado al portapapeles." : "No pude copiar automáticamente.", 1800);
  }

  // ============================================================
  // WIRING
  // ============================================================
  function bindOnce() {
    if (state.didBind) return;
    state.didBind = true;

    // tabs
    $$(".tab", appPanel).forEach((t) => {
      t.addEventListener("click", () => setTab(t.dataset.tab));
    });

    // search
    $("#search")?.addEventListener("input", (e) => {
      state.query = e.target.value || "";
      renderAll();
    });

    // events actions
    $("#newEventBtn")?.addEventListener("click", createNewEvent);
    $("#dupEventBtn")?.addEventListener("click", duplicateActiveEvent);
    $("#deleteEventBtn")?.addEventListener("click", deleteActiveEvent);

    $("#eventForm")?.addEventListener("submit", (e) => {
      e.preventDefault();
      saveActiveEvent();
    });
    $("#saveEventBtn")?.addEventListener("click", (e) => {
      e.preventDefault();
      saveActiveEvent();
    });

    // desc counter
    $("#evDesc")?.addEventListener("input", () => {
      const v = $("#evDesc")?.value || "";
      $("#descCount") && ($("#descCount").textContent = String(v.length));
    });

    // duration autofill
    const durInput = $("#evDuration");
    const timeInput = $("#evTimeRange");
    const hoursInput = $("#evDurationHours");

    function autoFillDurationIfEmpty() {
      if (!durInput) return;
      const manual = cleanSpaces(durInput.value || "");
      if (manual) return;
      const label = buildDurationLabel(timeInput?.value || "", hoursInput?.value || "");
      durInput.value = label === "Por confirmar" ? "" : label;
    }

    timeInput?.addEventListener("input", autoFillDurationIfEmpty);
    hoursInput?.addEventListener("input", autoFillDurationIfEmpty);

    // "Fechas" shortcut
    $("#addDateBtn")?.addEventListener("click", () => {
      toast("Fechas", "Abrí la pestaña “Fechas” para administrar cupos por evento.", 1800);
      if (state.activeTab !== "dates") setTab("dates");
    });

    // uploader (si existe en tu admin.html)
    getUploadButton()?.addEventListener("click", (e) => {
      e.preventDefault();
      handleUploadFlow();
    });

    getCopyUrlButton()?.addEventListener("click", (e) => {
      e.preventDefault();
      handleCopyUrl();
    });

    // Si existe el select “Destino” en tu HTML, lo ignoramos (y lo podés esconder con CSS).
    // Pero por si estorba UX, lo deshabilitamos.
    const destino = $("#targetSelect") || $("#destino") || $("#scopeSelect") || null;
    if (destino) {
      destino.disabled = true;
      destino.title = "Este admin ya no usa Destino. Solo elegí carpeta/slot.";
    }
  }

  async function boot() {
    if (state.didBoot) return;
    state.didBoot = true;

    console.log("[admin.js] boot", { VERSION });

    // Decide media mode (new vs legacy)
    await probeMediaMode();
    console.log("[admin.js] mediaMode =", state.mediaMode);

    bindOnce();

    state.activeTab = "__init__";
    setTab("events");
  }

  if (window.APP && APP.__adminReady) {
    boot();
  } else {
    window.addEventListener("admin:ready", boot, { once: true });
  }
})();
