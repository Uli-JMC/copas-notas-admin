"use strict";

/**
 * admin.js ✅ PRO (SUPABASE CRUD EVENTS + MEDIA LIBRARY + BINDINGS) — 2026-02-19 ✅ ALINEADO A TU BD
 *
 * ✅ Alineado a tu BD FINAL:
 * - public.media_assets            (TABLE)  ✅ assets
 * - public.media_bindings          (TABLE)  ✅ bindings (permite repetidos; NO unique por slot)
 * - public.media_library           (VIEW)   ✅ join (lectura fácil)
 * - public.v_media_bindings_latest (VIEW)   ✅ latest por slot (recomendado)
 *
 * ✅ Lo que hace:
 * - Subida: elegís BUCKET + folder antes de subir
 * - Cada upload crea asset NUEVO (permitidos repetidos)
 * - Copiar URL
 * - “Usar en evento…” crea binding NUEVO (sin upsert)
 * - En el editor: carga el “latest” por slot usando v_media_bindings_latest (o fallback)
 */

(function () {
  const VERSION = "2026-02-19.3";

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

  function safeOrQuery(q) {
    // Evita que comas/quotes rompan el .or()
    return cleanSpaces(q).replace(/[,]/g, " ").slice(0, 120);
  }

  // ---------------------------
  // DB mapping (✅ alineado a tu BD FINAL)
  // ---------------------------
  const EVENTS_TABLE = "events";

  // ✅ TABLAS reales
  const ASSETS_TABLE = "media_assets";
  const BINDINGS_TABLE = "media_bindings";

  // ✅ VIEWS reales
  const VIEW_LIBRARY = "media_library";
  const VIEW_LATEST = "v_media_bindings_latest";

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

  // Slots oficiales que tu frontend usa (lugares)
  const EVENT_SLOTS = ["slide_img", "slide_video", "desktop_event", "mobile_event", "event_more"];

  // Tus buckets
  const STORAGE_BUCKETS = ["videos", "media", "gallery"];

  // Defaults: bucket -> folder + accept
  const BUCKET_DEFAULTS = {
    media: { folder: "events", accept: "image/*,.jpg,.jpeg,.png,.webp,.avif" },
    gallery: { folder: "gallery", accept: "image/*,.jpg,.jpeg,.png,.webp,.avif" },
    videos: { folder: "videos", accept: "video/mp4,video/webm,.mp4,.webm" },
  };

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

    // Media Library UI state
    mediaFolder: "events",
    mediaBucket: "media",
    mediaSearch: "",
    mediaList: [],
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
  // Media / bindings helpers
  // ============================================================
  async function insertAsset({ folder, name, path, public_url, mime, bytes }) {
    const sb = getSB();
    if (!sb) throw new Error("APP.supabase no existe.");

    const payload = {
      folder: cleanSpaces(folder || "misc"),
      name: cleanSpaces(name || ""),
      path: cleanSpaces(path || ""),
      public_url: cleanSpaces(public_url || ""),
      mime: mime || null,
      bytes: bytes ?? null,
    };

    const { data, error } = await sb
      .from(ASSETS_TABLE)
      .insert(payload)
      .select("id, folder, name, path, public_url, mime, bytes, created_at, updated_at")
      .single();

    if (error) throw error;
    return data;
  }

  async function fetchAssetsLatest({ folder, q, limit = 24 }) {
    const sb = getSB();
    if (!sb) throw new Error("APP.supabase no existe.");

    let req = sb
      .from(ASSETS_TABLE)
      .select("id, folder, name, path, public_url, mime, bytes, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);

    const f = cleanSpaces(folder || "");
    if (f) req = req.eq("folder", f);

    const query = safeOrQuery(q || "").toLowerCase();
    if (query) {
      req = req.or(`name.ilike.%${query}%,path.ilike.%${query}%,public_url.ilike.%${query}%`);
    }

    const { data, error } = await req;
    if (error) throw error;

    return Array.isArray(data) ? data : [];
  }

  async function createBinding({ scope = "event", scope_id, slot, media_id, note = null }) {
    const sb = getSB();
    if (!sb) throw new Error("APP.supabase no existe.");

    const sid = String(scope_id || "").trim();
    if (!sid) throw new Error("scope_id es requerido para crear bindings.");

    const payload = {
      scope: String(scope || "event"),
      scope_id: sid,
      slot: String(slot || "misc"),
      media_id: String(media_id),
      note: note ? String(note) : null,
    };

    const { error } = await sb.from(BINDINGS_TABLE).insert(payload);
    if (error) throw error;
  }

  async function deleteBindingsForSlot({ scope = "event", scope_id, slot }) {
    const sb = getSB();
    if (!sb) throw new Error("APP.supabase no existe.");

    const sid = String(scope_id || "").trim();
    if (!sid) return;

    const { error } = await sb
      .from(BINDINGS_TABLE)
      .delete()
      .eq("scope", String(scope || "event"))
      .eq("scope_id", sid)
      .eq("slot", String(slot));

    if (error) throw error;
  }

  async function fetchEventSlotUrlsLatest(eventId) {
    const sb = getSB();
    if (!sb) throw new Error("APP.supabase no existe.");

    const eid = String(eventId || "").trim();
    if (!eid) return {};

    // 1) Try view latest
    try {
      const { data, error } = await sb
        .from(VIEW_LATEST)
        .select("slot, public_url, path")
        .eq("scope", "event")
        .eq("scope_id", eid)
        .in("slot", EVENT_SLOTS);

      if (error) throw error;

      const map = {};
      (Array.isArray(data) ? data : []).forEach((r) => {
        const slot = String(r?.slot || "").trim();
        const url = String(r?.public_url || r?.path || "").trim();
        if (slot) map[slot] = url;
      });
      return map;
    } catch (e) {
      console.warn("[admin] v_media_bindings_latest no disponible, fallback:", e);
    }

    // 2) Fallback: bindings + join assets (tomar el primero por slot)
    const { data: b, error: bErr } = await sb
      .from(BINDINGS_TABLE)
      .select("slot, media_id, updated_at")
      .eq("scope", "event")
      .eq("scope_id", eid)
      .in("slot", EVENT_SLOTS)
      .order("updated_at", { ascending: false });

    if (bErr) throw bErr;

    const ids = Array.from(new Set((Array.isArray(b) ? b : []).map((x) => x.media_id).filter(Boolean)));
    if (!ids.length) return {};

    const { data: a, error: aErr } = await sb
      .from(ASSETS_TABLE)
      .select("id, public_url, path")
      .in("id", ids);

    if (aErr) throw aErr;

    const byId = {};
    (Array.isArray(a) ? a : []).forEach((x) => (byId[String(x.id)] = x));

    const map = {};
    (Array.isArray(b) ? b : []).forEach((row) => {
      const slot = String(row.slot || "");
      if (map[slot]) return;
      const asset = byId[String(row.media_id)] || null;
      const url = String(asset?.public_url || asset?.path || "").trim();
      if (slot && url) map[slot] = url;
    });

    return map;
  }

  // ============================================================
  // Tabs
  // ============================================================
  function hideAllTabs() {
    $$('[role="tabpanel"]', appPanel).forEach((p) => (p.hidden = true));
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
  // Supabase CRUD events
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
      setBusy(false, isRLSError(error) ? "RLS bloquea. Faltan policies para events." : "No se pudieron cargar eventos.");
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

    const { data, error } = await sb.from(EVENTS_TABLE).insert(payload).select(SELECT_EVENTS).single();
    if (error) throw error;
    return data;
  }

  async function updateEvent(id, payload) {
    const sb = getSB();
    if (!sb) throw new Error("APP.supabase no existe. Revisá el orden: supabaseClient.js → admin.js");

    const { data, error } = await sb.from(EVENTS_TABLE).update(payload).eq("id", id).select(SELECT_EVENTS).single();
    if (error) throw error;
    return data;
  }

  async function deleteEvent(id) {
    const sb = getSB();
    if (!sb) throw new Error("APP.supabase no existe. Revisá el orden: supabaseClient.js → admin.js");

    const { error } = await sb.from(EVENTS_TABLE).delete().eq("id", id);
    if (error) throw error;

    // No borramos assets (reusables). Sí borramos bindings del evento.
    try {
      const del = await sb.from(BINDINGS_TABLE).delete().eq("scope", "event").eq("scope_id", id);
      if (del.error) throw del.error;
    } catch (e) {
      console.warn("[admin] cleanup bindings failed:", e);
    }
  }

  // ============================================================
  // Render: events list + editor
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

  // ============================================================
  // Media Library UI (inyectada)
  // ============================================================
  function ensureMediaLibraryStylesOnce() {
    if (document.getElementById("ecnAdminMediaStyles")) return;

    const s = document.createElement("style");
    s.id = "ecnAdminMediaStyles";
    s.textContent = `
      .ecnMediaPanel{ margin-top:14px; border:1px solid rgba(18,18,18,.10); border-radius:14px; background:rgba(18,18,18,.02); overflow:hidden; }
      .ecnMediaHead{ display:flex; align-items:center; justify-content:space-between; gap:10px; padding:12px; border-bottom:1px solid rgba(18,18,18,.08); }
      .ecnMediaHead h3{ margin:0; font-size:12px; letter-spacing:.12em; text-transform:uppercase; font-weight:900; color:rgba(18,18,18,.86); }
      .ecnMediaBody{ padding:12px; }
      .ecnMediaRow{ display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:10px; }
      @media (max-width:520px){ .ecnMediaRow{ grid-template-columns:1fr; } }
      .ecnMediaField label{ display:block; font-size:11px; letter-spacing:.10em; text-transform:uppercase; color:rgba(18,18,18,.62); margin-bottom:6px; }
      .ecnMediaField input,.ecnMediaField select{
        width:100%; min-height:44px; border-radius:12px; border:1px solid rgba(18,18,18,.14); background:#fff; padding:10px 12px; outline:none;
      }
      .ecnMediaField input:focus,.ecnMediaField select:focus{ box-shadow:0 0 0 3px rgba(75,110,255,.16); border-color:rgba(75,110,255,.35); }
      .ecnMediaActions{ display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-top:8px; }
      .ecnBtn{
        min-height:44px; padding:10px 14px; border-radius:12px; border:1px solid rgba(18,18,18,.14);
        background:rgba(18,18,18,.04); cursor:pointer; font-weight:900; letter-spacing:.10em; text-transform:uppercase; font-size:12px; color:rgba(18,18,18,.86);
      }
      .ecnBtn:hover{ background:rgba(18,18,18,.06); border-color:rgba(18,18,18,.20); }
      .ecnBtn--primary{ background:#000; border-color:#000; color:#fff; }
      .ecnBtn--primary:hover{ filter:brightness(1.06); }
      .ecnMediaList{ margin-top:12px; display:flex; flex-direction:column; gap:10px; }
      .ecnMediaItem{ border:1px solid rgba(18,18,18,.10); border-radius:12px; background:#fff; padding:10px; display:flex; align-items:center; justify-content:space-between; gap:10px; }
      .ecnMediaMeta{ min-width:0; }
      .ecnMediaMeta .t{
        margin:0; font-weight:900; letter-spacing:.06em; text-transform:uppercase; font-size:12px; color:rgba(18,18,18,.86);
        overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
      }
      .ecnMediaMeta .s{
        margin:6px 0 0; font-size:12px; color:rgba(18,18,18,.62); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:72ch;
      }
      .ecnMediaMiniActions{ display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end; align-items:center; }
      .ecnChip{
        display:inline-flex; align-items:center; padding:6px 10px; border-radius:999px; border:1px solid rgba(18,18,18,.12);
        background:rgba(18,18,18,.03); font-size:10px; letter-spacing:.14em; text-transform:uppercase; font-weight:900; color:rgba(18,18,18,.70);
      }
      .ecnHint{ margin:10px 0 0; font-size:12px; color:rgba(18,18,18,.62); line-height:1.55; }
      .ecnSlotSelect{ min-height:44px; padding:10px 12px; border-radius:12px; border:1px solid rgba(18,18,18,.14); background:#fff; font-weight:900; letter-spacing:.10em; text-transform:uppercase; font-size:12px; }
    `;
    document.head.appendChild(s);
  }

  function ensureMediaLibraryPanel() {
    ensureMediaLibraryStylesOnce();

    const host = $("#eventForm");
    if (!host) return null;

    if ($("#ecnMediaPanel")) return $("#ecnMediaPanel");

    const wrap = document.createElement("div");
    wrap.className = "ecnMediaPanel";
    wrap.id = "ecnMediaPanel";

    wrap.innerHTML = `
      <div class="ecnMediaHead">
        <h3>Media Library</h3>
        <span class="ecnChip">v${escapeHtml(VERSION)}</span>
      </div>

      <div class="ecnMediaBody">
        <div class="ecnMediaRow">
          <div class="ecnMediaField">
            <label>Bucket</label>
            <select id="mlBucket">
              ${STORAGE_BUCKETS.map((b) => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join("")}
            </select>
          </div>

          <div class="ecnMediaField">
            <label>Carpeta lógica (folder)</label>
            <input id="mlFolder" type="text" placeholder="events | gallery | videos | misc" />
          </div>
        </div>

        <div class="ecnMediaRow">
          <div class="ecnMediaField">
            <label>Archivo</label>
            <input id="mlFile" type="file" />
          </div>

          <div class="ecnMediaField">
            <label>Buscar en librería</label>
            <input id="mlSearch" type="text" placeholder="nombre / path / url" />
          </div>
        </div>

        <div class="ecnMediaActions">
          <button class="ecnBtn ecnBtn--primary" type="button" id="mlUploadBtn">Subir + generar URL</button>
          <button class="ecnBtn" type="button" id="mlRefreshBtn">Refrescar</button>
          <span class="ecnHint" id="mlHint">
            Bucket + folder antes de subir. Cada upload crea un asset nuevo (repetidos OK) y copia el URL.
          </span>
        </div>

        <div class="ecnMediaList" id="mlList"></div>
      </div>
    `;

    host.appendChild(wrap);
    return wrap;
  }

  function applyBucketDefaults() {
    const bEl = $("#mlBucket");
    const fEl = $("#mlFolder");
    const fileEl = $("#mlFile");
    if (!bEl || !fEl || !fileEl) return;

    const b = cleanSpaces(bEl.value || "").toLowerCase() || "media";
    const def = BUCKET_DEFAULTS[b] || BUCKET_DEFAULTS.media;

    const curFolder = cleanSpaces(fEl.value || "");
    const wasDefault = ["", "events", "gallery", "videos", "misc"].includes(curFolder);
    if (wasDefault) fEl.value = def.folder;

    fileEl.setAttribute("accept", def.accept);

    state.mediaBucket = b;
    state.mediaFolder = cleanSpaces(fEl.value || def.folder) || def.folder;

    const f = fileEl.files && fileEl.files[0];
    if (f) {
      const mime = String(f.type || "").toLowerCase();
      const name = String(f.name || "").toLowerCase();
      const isImage = mime.startsWith("image/") || /\.(jpg|jpeg|png|webp|avif)$/.test(name);
      const isVideo = mime.startsWith("video/") || /\.(mp4|webm)$/.test(name);

      if (b === "videos" && !isVideo) {
        fileEl.value = "";
        toast("Archivo inválido", "En bucket VIDEOS solo se permite .mp4 o .webm");
      }
      if ((b === "media" || b === "gallery") && !isImage) {
        fileEl.value = "";
        toast("Archivo inválido", "En MEDIA/GALLERY solo se permiten imágenes (jpg/png/webp/avif)");
      }
    }
  }

  async function refreshMediaList() {
    const panel = ensureMediaLibraryPanel();
    if (!panel) return;

    const list = $("#mlList");
    if (!list) return;

    const folder = cleanSpaces($("#mlFolder")?.value || state.mediaFolder) || "events";
    const q = cleanSpaces($("#mlSearch")?.value || state.mediaSearch);

    state.mediaFolder = folder;
    state.mediaSearch = q || "";

    list.innerHTML = `<div class="ecnHint">Cargando…</div>`;

    try {
      const rows = await fetchAssetsLatest({ folder: state.mediaFolder, q: state.mediaSearch, limit: 24 });
      state.mediaList = rows;

      if (!rows.length) {
        list.innerHTML = `<div class="ecnHint">No hay archivos en esa carpeta (o no coincide la búsqueda).</div>`;
        return;
      }

      list.innerHTML = "";

      rows.forEach((a) => {
        const url = String(a.public_url || "").trim() || String(a.path || "").trim();
        const title = a.name || a.path || a.id;

        const item = document.createElement("div");
        item.className = "ecnMediaItem";
        item.innerHTML = `
          <div class="ecnMediaMeta">
            <p class="t">${escapeHtml(title)}</p>
            <p class="s">${escapeHtml(url)}</p>
          </div>
          <div class="ecnMediaMiniActions">
            <button class="ecnBtn" type="button" data-act="copy">Copiar URL</button>
            ${
              state.activeEventId
                ? `
              <select class="ecnSlotSelect" data-act="slot">
                <option value="">Usar en evento…</option>
                ${EVENT_SLOTS.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("")}
              </select>
            `
                : ``
            }
          </div>
        `;

        item.querySelector('[data-act="copy"]')?.addEventListener("click", async () => {
          try {
            await navigator.clipboard.writeText(url);
            toast("Copiado", "URL copiada al portapapeles.", 1400);
          } catch {
            toast("Copiar", "No se pudo copiar. Copiala manualmente.", 2200);
          }
        });

        const slotSel = item.querySelector('[data-act="slot"]');
        if (slotSel) {
          slotSel.addEventListener("change", async () => {
            const slot = slotSel.value || "";
            if (!slot) return;
            slotSel.value = "";

            try {
              await createBinding({
                scope: "event",
                scope_id: String(state.activeEventId),
                slot,
                media_id: String(a.id),
                note: "admin_use_asset",
              });

              const mapInputIdBySlot = {
                slide_img: "evImg",
                slide_video: "evVideoUrl",
                desktop_event: "evImgDesktop",
                mobile_event: "evImgMobile",
                event_more: "evMoreImg",
              };
              const inputId = mapInputIdBySlot[slot];
              const input = inputId ? document.getElementById(inputId) : null;
              if (input) input.value = url;

              toast("Asignado", `Binding creado para ${slot}.`, 1600);
            } catch (e) {
              console.error(e);
              toast(isRLSError(e) ? "RLS" : "Error", prettyError(e), 5200);
            }
          });
        }

        list.appendChild(item);
      });
    } catch (e) {
      console.error(e);
      list.innerHTML = `<div class="ecnHint">Error cargando librería. ${escapeHtml(prettyError(e))}</div>`;
    }
  }

  async function uploadToStorageAndSaveAsset() {
    const sb = getSB();
    if (!sb) throw new Error("APP.supabase no existe.");

    const bEl = $("#mlBucket");
    const fEl = $("#mlFolder");
    const fileEl = $("#mlFile");

    const bucket = cleanSpaces(bEl?.value || state.mediaBucket) || "media";
    const folder = normalizeFolder(fEl?.value || state.mediaFolder) || (BUCKET_DEFAULTS[bucket]?.folder || "events");
    const file = fileEl?.files?.[0];

    if (!STORAGE_BUCKETS.includes(bucket)) {
      toast("Bucket", "Elegí un bucket válido (videos / media / gallery).");
      return;
    }
    if (!file) {
      toast("Archivo", "Elegí un archivo para subir.");
      return;
    }

    // validar según bucket
    const mime = String(file.type || "").toLowerCase();
    const name = String(file.name || "").toLowerCase();
    const isImage = mime.startsWith("image/") || /\.(jpg|jpeg|png|webp|avif)$/.test(name);
    const isVideo = mime.startsWith("video/") || /\.(mp4|webm)$/.test(name);

    if (bucket === "videos" && !isVideo) {
      toast("Archivo inválido", "En bucket VIDEOS solo se permite .mp4 o .webm");
      return;
    }
    if ((bucket === "media" || bucket === "gallery") && !isImage) {
      toast("Archivo inválido", "En MEDIA/GALLERY solo se permiten imágenes (jpg/png/webp/avif)");
      return;
    }

    const ext = extFromName(file.name) || (bucket === "videos" ? "mp4" : "webp");
    const storagePath = `${folder}/${Date.now()}_${safeId()}.${ext}`;

    setBusy(true, "Subiendo archivo…");

    const up = await sb.storage.from(bucket).upload(storagePath, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type || undefined,
    });

    if (up.error) throw up.error;

    const pub = sb.storage.from(bucket).getPublicUrl(storagePath);
    const public_url = String(pub?.data?.publicUrl || "").trim();
    if (!public_url) throw new Error("No se pudo generar publicUrl (revisá bucket public).");

    // Guardar asset NUEVO (repetidos OK)
    const asset = await insertAsset({
      folder, // carpeta lógica (para filtrar en librería)
      name: file.name || storagePath,
      path: `${bucket}/${storagePath}`, // trazable (bucket + ruta)
      public_url,
      mime: file.type || null,
      bytes: file.size ?? null,
    });

    try {
      await navigator.clipboard.writeText(public_url);
    } catch (_) {}

    toast("Subido", "URL generada y copiada. Pegala donde quieras.", 2200);
    setBusy(false, "");

    await refreshMediaList();
    if (fileEl) fileEl.value = "";

    state.mediaBucket = bucket;
    state.mediaFolder = folder;

    return asset;
  }

  // ============================================================
  // Editor render (event + slot urls latest)
  // ============================================================
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

    $("#evMonth") && ($("#evMonth").value = String(ev.month_key || "ENERO"));
    const d = ev.description || "";
    $("#evDesc") && ($("#evDesc").value = d);
    $("#descCount") && ($("#descCount").textContent = String(String(d).length));

    $("#evLocation") && ($("#evLocation").value = ev.location || "");
    $("#evTimeRange") && ($("#evTimeRange").value = ev.time_range || "");
    $("#evDurationHours") && ($("#evDurationHours").value = ev.duration_hours || "");

    const altEl = $("#evMoreImgAlt");
    if (altEl) altEl.value = ev.more_img_alt || "";

    // cargar urls latest para inputs
    try {
      const map = await fetchEventSlotUrlsLatest(ev.id);

      $("#evImg") && ($("#evImg").value = map.slide_img || "");
      $("#evVideoUrl") && ($("#evVideoUrl").value = map.slide_video || "");
      $("#evImgDesktop") && ($("#evImgDesktop").value = map.desktop_event || "");
      $("#evImgMobile") && ($("#evImgMobile").value = map.mobile_event || "");
      $("#evMoreImg") && ($("#evMoreImg").value = map.event_more || "");
    } catch (err) {
      console.error(err);
      toast("Media", "No se pudieron cargar bindings (revisá RLS de media_bindings / view).", 4200);
    }

    // panel media
    const panel = ensureMediaLibraryPanel();
    if (panel) {
      const bEl = $("#mlBucket");
      const fEl = $("#mlFolder");
      const sEl = $("#mlSearch");

      if (bEl) bEl.value = state.mediaBucket || "media";
      if (fEl) fEl.value = state.mediaFolder || "events";
      if (sEl && !sEl.value) sEl.value = state.mediaSearch || "";

      applyBucketDefaults();
      await refreshMediaList();
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
  // Actions
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
      toast(isRLSError(err) ? "RLS" : "Error", isRLSError(err) ? "Falta policy INSERT para events." : prettyError(err), 5200);
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
        month_key: String(ev.month_key || "ENERO"),
        description: ev.description || "",
        location: ev.location || "Por confirmar",
        time_range: ev.time_range || "",
        duration_hours: ev.duration_hours || "",
        price_amount: ev.price_amount == null ? null : ev.price_amount,
        price_currency: ev.price_currency || "USD",
        more_img_alt: ev.more_img_alt || "",
      };

      const created = await insertEvent(payload);

      // copiar bindings latest si el view existe
      try {
        const sb = getSB();
        if (sb) {
          const { data: latest, error } = await sb
            .from(VIEW_LATEST)
            .select("slot, media_id")
            .eq("scope", "event")
            .eq("scope_id", String(ev.id))
            .in("slot", EVENT_SLOTS);

          if (!error && Array.isArray(latest)) {
            for (const row of latest) {
              if (!row?.media_id || !row?.slot) continue;
              await createBinding({
                scope: "event",
                scope_id: String(created.id),
                slot: String(row.slot),
                media_id: String(row.media_id),
                note: "dup_from_event",
              });
            }
          }
        }
      } catch (e) {
        console.warn("[admin] duplicate bindings failed:", e);
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
      toast(isRLSError(err) ? "RLS" : "Error", isRLSError(err) ? "Falta policy INSERT para events." : prettyError(err), 5200);
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
      toast(isRLSError(err) ? "RLS" : "Error", isRLSError(err) ? "Falta policy DELETE." : prettyError(err), 5200);
    } finally {
      setBusy(false, "");
    }
  });

  const saveActiveEvent = withLock(async function () {
    const ev = (state.events || []).find((e) => String(e.id) === String(state.activeEventId));
    if (!ev) return false;

    const title = cleanSpaces($("#evTitle")?.value || "");
    const type = cleanSpaces($("#evType")?.value || "Cata de vino");
    const month_key = cleanSpaces($("#evMonth")?.value || "ENERO");

    const description = cleanSpaces($("#evDesc")?.value || "");
    const location = cleanSpaces($("#evLocation")?.value || "");
    const time_range = cleanSpaces($("#evTimeRange")?.value || "");
    const duration_hours = cleanSpaces($("#evDurationHours")?.value || "");

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
      duration_hours,
      more_img_alt: moreAlt,
    };

    // URLs manuales
    const slideImgUrl = cleanSpaces($("#evImg")?.value || "");
    const slideVideoUrl = cleanSpaces($("#evVideoUrl")?.value || "");
    const deskUrl = cleanSpaces($("#evImgDesktop")?.value || "");
    const mobUrl = cleanSpaces($("#evImgMobile")?.value || "");
    const moreUrl = cleanSpaces($("#evMoreImg")?.value || "");

    try {
      if (state.mode !== "supabase") return false;

      setBusy(true, "Guardando cambios…");

      const updated = await updateEvent(ev.id, payload);

      // binding desde URL: si vacío => borrar bindings del slot. si no => crear asset + binding (siempre nuevo)
      async function bindFromUrl(slot, url) {
        if (!slot) return;

        if (!url) {
          await deleteBindingsForSlot({ scope: "event", scope_id: ev.id, slot });
          return;
        }

        const isSupabaseStorage = url.includes("/storage/v1/object/public/");
        const folder = isSupabaseStorage ? (state.mediaFolder || "events") : "external";
        const name = `${slot}`;

        const asset = await insertAsset({
          folder,
          name,
          path: url, // externo: guardamos url
          public_url: url,
          mime: null,
          bytes: null,
        });

        await createBinding({
          scope: "event",
          scope_id: String(ev.id),
          slot,
          media_id: String(asset.id),
          note: "admin_bind_from_url",
        });
      }

      await bindFromUrl("slide_img", slideImgUrl);
      await bindFromUrl("slide_video", slideVideoUrl);
      await bindFromUrl("desktop_event", deskUrl);
      await bindFromUrl("mobile_event", mobUrl);
      await bindFromUrl("event_more", moreUrl);

      state.events = (state.events || []).map((x) => (String(x.id) === String(updated.id) ? updated : x));

      toast("Guardado", "Evento actualizado + bindings creados.", 1600);
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
        isRLSError(err) ? "RLS bloqueó el guardado. Revisá policies en media_assets y media_bindings." : prettyError(err),
        5200
      );
      return false;
    } finally {
      setBusy(false, "");
    }
  });

  // ============================================================
  // Wiring
  // ============================================================
  function bindOnce() {
    if (state.didBind) return;
    state.didBind = true;

    $$(".tab", appPanel).forEach((t) => t.addEventListener("click", () => setTab(t.dataset.tab)));

    $("#search")?.addEventListener("input", (e) => {
      state.query = e.target.value || "";
      renderAll();
    });

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

    $("#evDesc")?.addEventListener("input", () => {
      const v = $("#evDesc")?.value || "";
      $("#descCount") && ($("#descCount").textContent = String(v.length));
    });

    // Media Library events (delegado)
    appPanel.addEventListener("click", async (e) => {
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;

      if (t.id === "mlRefreshBtn") {
        e.preventDefault();
        await refreshMediaList();
      }

      if (t.id === "mlUploadBtn") {
        e.preventDefault();
        try {
          await uploadToStorageAndSaveAsset();
        } catch (err) {
          console.error(err);
          toast(isRLSError(err) ? "RLS" : "Error", prettyError(err), 5200);
          setBusy(false, "");
        }
      }
    });

    appPanel.addEventListener("change", async (e) => {
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;
      if (t.id === "mlBucket" || t.id === "mlFolder" || t.id === "mlFile") applyBucketDefaults();
    });

    appPanel.addEventListener("input", async (e) => {
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;

      if (t.id === "mlFolder") state.mediaFolder = cleanSpaces(t.value || "");
      if (t.id === "mlBucket") state.mediaBucket = cleanSpaces(t.value || "");
      if (t.id === "mlSearch") {
        state.mediaSearch = cleanSpaces(t.value || "");
        clearTimeout(bindOnce.__mlTimer);
        bindOnce.__mlTimer = setTimeout(refreshMediaList, 280);
      }
    });
  }

  function boot() {
    if (state.didBoot) return;
    state.didBoot = true;

    console.log("[admin.js] boot", { VERSION, ASSETS_TABLE, BINDINGS_TABLE, VIEW_LATEST, VIEW_LIBRARY });

    bindOnce();

    state.activeTab = "__init__";
    setTab("events");

    setTimeout(() => {
      const panel = ensureMediaLibraryPanel();
      if (panel) {
        const b = $("#mlBucket");
        const f = $("#mlFolder");
        if (b) b.value = state.mediaBucket || "media";
        if (f) f.value = state.mediaFolder || "events";
        applyBucketDefaults();
      }
    }, 0);
  }

  if (window.APP && APP.__adminReady) {
    boot();
  } else {
    window.addEventListener("admin:ready", boot, { once: true });
  }
})();
