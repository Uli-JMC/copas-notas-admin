"use strict";

/**
 * admin.js ✅ PRO (EVENTS CRUD + MEDIA LIBRARY) — 2026-02-19.1
 *
 * OBJETIVO (lo que pediste):
 * ✅ No hay “target/destino” en UI.
 * ✅ Antes de subir: elegís "carpeta" (folder).
 * ✅ Sube a Storage (bucket "media"), guarda en media_library (con public_url).
 * ✅ Te da el URL y lo copia.
 * ✅ Permite repetir/reusar imágenes (mismo media_id se puede vincular a muchos eventos/slots).
 * ✅ (Opcional) Si estás editando un evento, crea/actualiza binding (scope=event, scope_id=eventId, slot=folder)
 *    para que el front pueda jalar “la última” desde v_media_bindings_latest.
 *
 * Requiere en DB:
 * - public.media_library
 * - public.media_bindings
 * - public.v_media_bindings_latest   (para leer el último por scope/scope_id/slot)
 *
 * Storage:
 * - bucket público: "media"
 * - subcarpeta: "events/" (default; podés cambiar STORAGE_DIR_DEFAULT)
 */

(function () {
  const VERSION = "2026-02-19.1";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const appPanel = $("#appPanel");
  if (!appPanel) return;

  // ------------------------------------------------------------
  // CONFIG
  // ------------------------------------------------------------
  const EVENTS_TABLE = "events";

  const MEDIA_LIB_TABLE = "media_library";
  const MEDIA_BIND_TABLE = "media_bindings";
  const MEDIA_VIEW_LATEST = "v_media_bindings_latest";

  const STORAGE_BUCKET = "media";
  const STORAGE_DIR_DEFAULT = "events"; // subcarpeta en el bucket

  // "Folders oficiales" (slots/carpetas que vas a usar)
  // Podés agregar más sin romper nada.
  const EVENT_SLOTS = ["slide_img", "slide_video", "desktop_event", "mobile_event", "event_more"];

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

  // ------------------------------------------------------------
  // Utils
  // ------------------------------------------------------------
  const cleanSpaces = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

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

  async function copyToClipboard(text) {
    const t = String(text || "");
    if (!t) return false;
    try {
      await navigator.clipboard.writeText(t);
      return true;
    } catch (_) {
      // fallback
      try {
        const ta = document.createElement("textarea");
        ta.value = t;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        ta.style.top = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        const ok = document.execCommand("copy");
        ta.remove();
        return !!ok;
      } catch (_) {}
    }
    return false;
  }

  // ------------------------------------------------------------
  // Months / Formatting (se mantiene igual que tu admin actual)
  // ------------------------------------------------------------
  const MONTHS = [
    "ENERO","FEBRERO","MARZO","ABRIL","MAYO","JUNIO",
    "JULIO","AGOSTO","SEPTIEMBRE","OCTUBRE","NOVIEMBRE","DICIEMBRE",
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

  function slugifyName(name) {
    const s = cleanSpaces(name || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
    return s || "media";
  }

  function inferExt(file) {
    const n = String(file?.name || "").toLowerCase();
    const m = n.match(/\.([a-z0-9]+)$/i);
    if (m && m[1]) return m[1].slice(0, 12);
    const type = String(file?.type || "").toLowerCase();
    if (type.includes("png")) return "png";
    if (type.includes("jpeg") || type.includes("jpg")) return "jpg";
    if (type.includes("webp")) return "webp";
    if (type.includes("gif")) return "gif";
    if (type.includes("mp4")) return "mp4";
    if (type.includes("quicktime")) return "mov";
    return "bin";
  }

  function isVideoExt(ext) {
    const e = String(ext || "").toLowerCase();
    return e === "mp4" || e === "mov" || e === "webm";
  }

  // ------------------------------------------------------------
  // State + Lock
  // ------------------------------------------------------------
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

  // ------------------------------------------------------------
  // MEDIA (New system): library + bindings
  // ------------------------------------------------------------

  /**
   * Lee “lo último” por slot desde la VIEW.
   * Retorna map: { slot -> public_url }
   */
  async function fetchEventMediaLatest(eventId) {
    const sb = getSB();
    if (!sb) throw new Error("APP.supabase no existe.");

    const eid = String(eventId || "").trim();
    if (!eid) return {};

    const { data, error } = await sb
      .from(MEDIA_VIEW_LATEST)
      .select("slot, public_url, path, media_id, folder, name, media_updated_at, binding_updated_at")
      .eq("scope", "event")
      .eq("scope_id", eid)
      .in("slot", EVENT_SLOTS);

    if (error) throw error;

    const map = {};
    (Array.isArray(data) ? data : []).forEach((row) => {
      const slot = cleanSpaces(row?.slot);
      const url = cleanSpaces(row?.public_url || row?.path);
      if (slot && url) map[slot] = url;
    });

    return map;
  }

  /**
   * Crea/actualiza un binding para el evento (scope=event, scope_id=eid, slot=slot)
   * Si tu tabla NO tiene unique, igual funciona con insert.
   * Si tiene unique(scope,scope_id,slot), hace upsert y listo.
   */
  async function upsertBinding(scope, scopeId, slot, mediaId) {
    const sb = getSB();
    if (!sb) throw new Error("APP.supabase no existe.");

    const payload = {
      scope: String(scope || "").trim(),
      scope_id: String(scopeId || "").trim(),
      slot: String(slot || "").trim(),
      media_id: String(mediaId || "").trim(),
    };

    if (!payload.scope || !payload.scope_id || !payload.slot || !payload.media_id) return;

    // Intento 1: upsert (si existe unique)
    const up = await sb.from(MEDIA_BIND_TABLE).upsert(payload, { onConflict: "scope,scope_id,slot" });
    if (!up.error) return;

    // Intento 2: insert simple (si no existe unique o si tu onConflict no aplica)
    const ins = await sb.from(MEDIA_BIND_TABLE).insert(payload);
    if (ins.error) throw ins.error;
  }

  /**
   * Inserta en media_library y devuelve { media_id, public_url, path }
   */
  async function insertMediaLibraryRow({ folder, name, path, public_url, mime, bytes }) {
    const sb = getSB();
    if (!sb) throw new Error("APP.supabase no existe.");

    const payload = {
      folder: String(folder || "").trim(),
      name: String(name || "").trim(),
      path: String(path || "").trim(),
      public_url: String(public_url || "").trim(),
      mime: mime ? String(mime) : null,
      bytes: bytes != null ? Number(bytes) : null,
    };

    const { data, error } = await sb
      .from(MEDIA_LIB_TABLE)
      .insert(payload)
      .select("id, folder, name, path, public_url, mime, bytes, updated_at")
      .single();

    if (error) throw error;

    return {
      media_id: data?.id ? String(data.id) : "",
      public_url: data?.public_url ? String(data.public_url) : "",
      path: data?.path ? String(data.path) : "",
    };
  }

  /**
   * Sube archivo a Storage y retorna { path, public_url }
   */
  async function uploadToStorage(file, folder) {
    const sb = getSB();
    if (!sb) throw new Error("APP.supabase no existe.");

    const f = file;
    if (!f) throw new Error("No hay archivo.");

    const slotFolder = cleanSpaces(folder || "");
    const ext = inferExt(f);

    // Guardamos todo en /events por default (tu bucket ya lo está usando así)
    const baseDir = STORAGE_DIR_DEFAULT;

    // Nombre único
    const baseName = slugifyName(slotFolder || (isVideoExt(ext) ? "video" : "img"));
    const filename = `${baseName}_${Date.now()}.${ext}`;
    const storagePath = `${baseDir}/${filename}`;

    // upload
    const up = await sb.storage.from(STORAGE_BUCKET).upload(storagePath, f, {
      cacheControl: "3600",
      upsert: false, // NO sobreescribe: mejor para histórico
      contentType: f.type || undefined,
    });

    if (up.error) throw up.error;

    const pub = sb.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);
    const publicUrl = pub?.data?.publicUrl ? String(pub.data.publicUrl) : "";

    return { path: storagePath, public_url: publicUrl };
  }

  /**
   * Flujo completo:
   * - upload storage
   * - insert media_library
   * - (opcional) binding al evento activo si se pide
   */
  async function handleUploadFlow({ file, folder, assignToEventId, assignSlot }) {
    if (!file) throw new Error("Seleccioná un archivo.");
    const f = cleanSpaces(folder);
    if (!f) throw new Error("Elegí una carpeta (folder).");

    setBusy(true, "Subiendo a Storage…");

    const { path, public_url } = await uploadToStorage(file, f);

    setBusy(true, "Guardando en media_library…");

    const lib = await insertMediaLibraryRow({
      folder: f,
      name: f,
      path,
      public_url,
      mime: file.type || null,
      bytes: file.size || null,
    });

    // asignación opcional al evento (binding)
    const eid = cleanSpaces(assignToEventId || "");
    const slot = cleanSpaces(assignSlot || f);

    if (eid && slot) {
      try {
        setBusy(true, "Creando binding…");
        await upsertBinding("event", eid, slot, lib.media_id);
      } catch (e) {
        console.warn("[media] binding failed:", e);
        // no abortamos; igual dejamos el URL listo
      }
    }

    setBusy(false, "");

    return { media_id: lib.media_id, public_url: lib.public_url || public_url, path: lib.path || path };
  }

  // ------------------------------------------------------------
  // Tabs (se mantiene)
  // ------------------------------------------------------------
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

  // ------------------------------------------------------------
  // Supabase CRUD events
  // ------------------------------------------------------------
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
        isRLSError(error) ? "RLS bloquea. Faltan policies para events." : "No se pudieron cargar eventos."
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
    if (!sb) throw new Error("APP.supabase no existe.");

    const { error } = await sb.from(EVENTS_TABLE).delete().eq("id", id);
    if (error) throw error;

    // Nota: bindings/lib NO se borran (histórico). Si quisieras, se hace después.
  }

  // ------------------------------------------------------------
  // Render: events list + editor
  // ------------------------------------------------------------
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

  // ------------------------------------------------------------
  // UI Injection: Mini panel de media + botones por input
  // ------------------------------------------------------------
  function ensureMediaPanelOnce() {
    if (document.getElementById("ecnMediaPanel")) return;

    // buscamos un lugar razonable dentro del editor
    const form = $("#eventForm");
    if (!form) return;

    const panel = document.createElement("div");
    panel.id = "ecnMediaPanel";
    panel.style.marginTop = "14px";
    panel.style.padding = "12px";
    panel.style.border = "1px solid rgba(18,18,18,.10)";
    panel.style.borderRadius = "14px";
    panel.style.background = "rgba(18,18,18,.02)";

    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
        <div>
          <div style="font-weight:900;letter-spacing:.10em;text-transform:uppercase;font-size:12px;">Media Library</div>
          <div style="color:rgba(18,18,18,.62);font-size:13px;line-height:1.5;margin-top:4px;">
            Subí por carpeta (folder). Se genera URL público y lo podés pegar donde querás.
          </div>
        </div>
        <button type="button" id="ecnMediaRefreshBtn" class="btn" style="min-height:44px;border-radius:14px;">
          Refrescar media del evento
        </button>
      </div>

      <div style="display:grid;grid-template-columns:1.1fr 1fr;gap:10px;margin-top:12px;align-items:end;">
        <div>
          <label style="display:block;font-size:12px;color:rgba(18,18,18,.62);letter-spacing:.10em;text-transform:uppercase;margin-bottom:6px;">
            Carpeta (folder / slot)
          </label>
          <select id="ecnFolder" style="width:100%;min-height:44px;border-radius:14px;border:1px solid rgba(18,18,18,.14);background:#fff;padding:10px 12px;">
            ${EVENT_SLOTS.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("")}
          </select>
        </div>

        <div>
          <label style="display:block;font-size:12px;color:rgba(18,18,18,.62);letter-spacing:.10em;text-transform:uppercase;margin-bottom:6px;">
            Archivo
          </label>
          <input id="ecnFile" type="file" accept="image/*,video/*" style="width:100%;min-height:44px;" />
        </div>
      </div>

      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px;align-items:center;">
        <button type="button" id="ecnUploadBtn" class="btn primary" style="min-height:44px;border-radius:14px;">
          Subir y copiar URL
        </button>
        <button type="button" id="ecnUploadBindBtn" class="btn" style="min-height:44px;border-radius:14px;">
          Subir + asignar al evento (binding)
        </button>
        <span id="ecnMediaOut" style="font-size:13px;color:rgba(18,18,18,.70);word-break:break-all;"></span>
      </div>
    `;

    form.appendChild(panel);

    $("#ecnMediaRefreshBtn")?.addEventListener("click", async () => {
      try {
        await refreshEditorMediaFromBindings();
        toast("Listo", "Media del evento refrescada.", 1600);
      } catch (e) {
        console.error(e);
        toast("Media", isRLSError(e) ? "RLS bloquea lectura de media." : "No se pudo refrescar media.", 4200);
      }
    });

    $("#ecnUploadBtn")?.addEventListener("click", async () => {
      await runUpload({ bind: false });
    });

    $("#ecnUploadBindBtn")?.addEventListener("click", async () => {
      await runUpload({ bind: true });
    });
  }

  async function runUpload({ bind }) {
    const fileEl = $("#ecnFile");
    const folderEl = $("#ecnFolder");
    const out = $("#ecnMediaOut");

    const file = fileEl?.files?.[0] || null;
    const folder = cleanSpaces(folderEl?.value || "");

    if (!file) return toast("Falta archivo", "Seleccioná una imagen o video.");
    if (!folder) return toast("Falta carpeta", "Elegí la carpeta (folder).");

    const eventId = cleanSpaces(state.activeEventId || "");
    const assign = bind && eventId ? eventId : "";
    const slot = folder;

    try {
      setBusy(true, "Subiendo…");

      const res = await handleUploadFlow({
        file,
        folder,
        assignToEventId: assign,
        assignSlot: slot,
      });

      const url = res.public_url || "";
      if (out) out.textContent = url ? `URL: ${url}` : "Subido, pero no se pudo obtener URL.";

      if (url) {
        const ok = await copyToClipboard(url);
        toast("Subido", ok ? "URL copiado al portapapeles." : "Subido. Copiá el URL manualmente.", 2200);
      } else {
        toast("Subido", "Listo. Revisá el registro en media_library.", 2200);
      }

      // si coincide con uno de tus inputs del editor, lo pegamos automático (conveniente)
      // regla simple: si el folder es un slot oficial, lo ponemos en el input correspondiente
      if (url) {
        const input = getInputForSlot(folder);
        if (input) input.value = url;
      }

      // si hicimos binding, refrescamos por si el editor usa la view
      if (bind && eventId) {
        await refreshEditorMediaFromBindings();
      }

      // limpiar file input
      if (fileEl) fileEl.value = "";
      setBusy(false, "");
    } catch (err) {
      console.error(err);
      setBusy(false, "");
      toast(isRLSError(err) ? "RLS" : "Error", isRLSError(err) ? "RLS bloqueó media_library/bindings." : prettyError(err), 5200);
    }
  }

  function getInputForSlot(slot) {
    const s = String(slot || "").trim();
    // mapeo a tu UI existente:
    // evImg -> slide_img
    // evVideoUrl -> slide_video
    // evImgDesktop -> desktop_event
    // evImgMobile -> mobile_event
    // evMoreImg -> event_more
    if (s === "slide_img") return $("#evImg");
    if (s === "slide_video") return $("#evVideoUrl");
    if (s === "desktop_event") return $("#evImgDesktop") || $("#evImg");
    if (s === "mobile_event") return $("#evImgMobile");
    if (s === "event_more") return $("#evMoreImg");
    return null;
  }

  function addMiniButtonsToInput(input, slot) {
    if (!input) return;
    if (input.dataset.ecnMediaButtons === "1") return;
    input.dataset.ecnMediaButtons = "1";

    const wrap = document.createElement("div");
    wrap.style.display = "grid";
    wrap.style.gridTemplateColumns = "1fr auto auto";
    wrap.style.gap = "8px";
    wrap.style.alignItems = "center";

    const parent = input.parentElement;
    if (!parent) return;

    parent.insertBefore(wrap, input);
    wrap.appendChild(input);

    const btnUp = document.createElement("button");
    btnUp.type = "button";
    btnUp.className = "btn";
    btnUp.textContent = "Subir";
    btnUp.style.minHeight = "44px";
    btnUp.style.borderRadius = "14px";

    const btnCopy = document.createElement("button");
    btnCopy.type = "button";
    btnCopy.className = "btn";
    btnCopy.textContent = "Copiar";
    btnCopy.style.minHeight = "44px";
    btnCopy.style.borderRadius = "14px";

    btnUp.addEventListener("click", () => {
      // setea folder seleccionado y enfoca el panel
      const folderEl = $("#ecnFolder");
      if (folderEl) folderEl.value = String(slot || "");
      $("#ecnFile")?.click?.();
    });

    btnCopy.addEventListener("click", async () => {
      const url = cleanSpaces(input.value || "");
      if (!url) return toast("Vacío", "No hay URL para copiar.");
      const ok = await copyToClipboard(url);
      toast("Copiado", ok ? "URL copiado." : "No se pudo copiar.", 1800);
    });

    wrap.appendChild(btnUp);
    wrap.appendChild(btnCopy);
  }

  function enhanceEditorMediaInputsOnce() {
    // agrega botoncitos a los inputs si existen en el admin.html actual
    addMiniButtonsToInput($("#evImg"), "slide_img");
    addMiniButtonsToInput($("#evVideoUrl"), "slide_video");
    addMiniButtonsToInput($("#evImgDesktop") || null, "desktop_event");
    addMiniButtonsToInput($("#evImgMobile") || null, "mobile_event");
    addMiniButtonsToInput($("#evMoreImg") || null, "event_more");
  }

  async function refreshEditorMediaFromBindings() {
    const evId = cleanSpaces(state.activeEventId || "");
    if (!evId) return;

    // lee desde view latest
    const media = await fetchEventMediaLatest(evId);

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
  }

  // ------------------------------------------------------------
  // Editor render
  // ------------------------------------------------------------
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

    // more_img_alt vive en events
    const altEl = $("#evMoreImgAlt");
    if (altEl) altEl.value = ev.more_img_alt || "";

    // 🔥 NUEVO: panel + botones + carga desde bindings latest
    ensureMediaPanelOnce();
    enhanceEditorMediaInputsOnce();

    try {
      await refreshEditorMediaFromBindings();
    } catch (err) {
      console.error(err);
      toast("Media", "No se pudo leer v_media_bindings_latest (revisá RLS/policies).", 4200);
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

  // ------------------------------------------------------------
  // Actions
  // ------------------------------------------------------------
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

      // 🔥 Nota: NO duplicamos media automáticamente aquí porque ahora es librería reusable.
      // Si querés copiar bindings también, lo hacemos en el siguiente paso (decime y lo habilito).

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

    const moreAlt = cleanSpaces(($("#evMoreImgAlt")?.value) || ev.more_img_alt || "");

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

    try {
      if (state.mode !== "supabase") return false;

      setBusy(true, "Guardando cambios…");

      const updated = await updateEvent(ev.id, payload);

      state.events = (state.events || []).map((x) => (String(x.id) === String(updated.id) ? updated : x));

      toast("Guardado", "Evento actualizado en Supabase.", 1400);
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
        isRLSError(err) ? "RLS bloqueó el guardado (events)." : prettyError(err),
        5200
      );
      return false;
    } finally {
      setBusy(false, "");
    }
  });

  // ------------------------------------------------------------
  // Wiring
  // ------------------------------------------------------------
  function bindOnce() {
    if (state.didBind) return;
    state.didBind = true;

    $$(".tab", appPanel).forEach((t) => {
      t.addEventListener("click", () => setTab(t.dataset.tab));
    });

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

    $("#addDateBtn")?.addEventListener("click", () => {
      toast("Fechas", "Abrí la pestaña “Fechas” para administrar cupos por evento.", 1800);
      if (state.activeTab !== "dates") setTab("dates");
    });
  }

  function boot() {
    if (state.didBoot) return;
    state.didBoot = true;

    console.log("[admin.js] boot", { VERSION });

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
