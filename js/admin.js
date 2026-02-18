"use strict";

/**
 * admin.js ✅ PRO (SUPABASE CRUD EVENTS + MEDIA_ITEMS) — 2026-02-18 PATCH
 *
 * ✅ FIXES / CHANGES:
 * - ✅ Folders oficiales:
 *   HOME (asociado a evento): slide_img | slide_video
 *   EVENT PAGE: desktop_event | mobile_event | event_more
 * - ✅ upsert onConflict alineado a tu BD: event_id,folder (evita 400 Bad Request)
 * - ✅ Carga/guarda media_items desde el editor sin tocar admin.html
 * - ✅ Duplicado copia también media_items con folders oficiales
 */

(function () {
  const VERSION = "2026-02-18.3";

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
  // DB mapping
  // ---------------------------
  const EVENTS_TABLE = "events";
  const MEDIA_TABLE = "media_items";

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

  // ============================================================
  // Media helpers (event)
  // ============================================================
  // ✅ folders oficiales
  const EVENT_FOLDERS = ["slide_img", "slide_video", "desktop_event", "mobile_event", "event_more"];

  async function fetchEventMedia(eventId) {
    const sb = getSB();
    if (!sb) throw new Error("APP.supabase no existe.");

    const eid = String(eventId || "").trim();
    if (!eid) return {};

    const { data, error } = await sb
      .from(MEDIA_TABLE)
      .select("folder, public_url, path")
      .eq("target", "event")
      .eq("event_id", eid)
      .in("folder", EVENT_FOLDERS);

    if (error) throw error;

    const map = {};
    (Array.isArray(data) ? data : []).forEach((row) => {
      const f = String(row?.folder || "").trim();
      const url = String(row?.public_url || row?.path || "").trim();
      if (f) map[f] = url;
    });

    return map;
  }

  async function deleteEventMedia(eventId, folder) {
    const sb = getSB();
    if (!sb) throw new Error("APP.supabase no existe.");

    const eid = String(eventId || "").trim();
    const f = String(folder || "").trim();
    if (!eid || !f) return;

    const { error } = await sb
      .from(MEDIA_TABLE)
      .delete()
      .eq("target", "event")
      .eq("event_id", eid)
      .eq("folder", f);

    if (error) throw error;
  }

  async function upsertEventMedia(eventId, folder, url) {
    const sb = getSB();
    if (!sb) throw new Error("APP.supabase no existe.");

    const eid = String(eventId || "").trim();
    const f = String(folder || "").trim();
    const u = String(url || "").trim();

    if (!eid || !f) return;

    // vacío => borrar
    if (!u) {
      await deleteEventMedia(eid, f);
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

    // ✅ Alineado a tu UNIQUE real: (event_id, folder)
    const { error } = await sb
      .from(MEDIA_TABLE)
      .upsert(payload, { onConflict: "event_id,folder" });

    if (error) throw error;
  }

  // ============================================================
  // Tabs
  // ============================================================
  function hideAllTabs() {
    $$('[role="tabpanel"]', appPanel).forEach((p) => { p.hidden = true; });
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
  // Supabase CRUD
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
      setBusy(false, isRLSError(error)
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

    try {
      const del = await sb.from(MEDIA_TABLE).delete().eq("target", "event").eq("event_id", id);
      if (del.error) throw del.error;
    } catch (e) {
      console.warn("[admin] cleanup media_items failed:", e);
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
      "eventId","evTitle","evType","evMonth",
      "evDesc","evLocation","evTimeRange","evDurationHours","evDuration",
      "evPriceAmount","evPriceCurrency",
      "evImg", "evImgDesktop", "evImgMobile", "evVideoUrl", "evMoreImg",
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

  // ✅ Carga media_items y llena campos del editor (mapeo a folders oficiales)
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

    // ✅ more_img_alt vive en events
    const altEl = $("#evMoreImgAlt");
    if (altEl) altEl.value = ev.more_img_alt || "";

    // ✅ Media desde media_items
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
      toast("Media", "No se pudo cargar media_items (revisá RLS de media_items).", 4200);
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
      toast(isRLSError(err) ? "RLS" : "Supabase",
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
      try { await ensureEventsLoaded(true); } catch (_) {}
    } catch (err) {
      console.error(err);
      toast(isRLSError(err) ? "RLS" : "Error",
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

      // Duplicar media_items del evento original (folders oficiales)
      try {
        const m = await fetchEventMedia(ev.id);
        await upsertEventMedia(created.id, "slide_img", m.slide_img || "");
        await upsertEventMedia(created.id, "slide_video", m.slide_video || "");
        await upsertEventMedia(created.id, "desktop_event", m.desktop_event || "");
        await upsertEventMedia(created.id, "mobile_event", m.mobile_event || "");
        await upsertEventMedia(created.id, "event_more", m.event_more || "");
      } catch (e) {
        console.warn("[admin] duplicate media failed:", e);
      }

      state.events.unshift(created);
      state.activeEventId = created.id;

      toast("Duplicado", "Copia creada.", 1500);
      await renderAll();
      try { await ensureEventsLoaded(true); } catch (_) {}
    } catch (err) {
      console.error(err);
      toast(isRLSError(err) ? "RLS" : "Error",
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
      try { await ensureEventsLoaded(true); } catch (_) {}
    } catch (err) {
      console.error(err);
      toast(isRLSError(err) ? "RLS" : "Error",
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

    // Media inputs (UI existente mapeada a folders oficiales)
    const slideImgEl = $("#evImg");
    const deskEl = $("#evImgDesktop") || $("#evImg");
    const mobEl = $("#evImgMobile");
    const slideVideoEl = $("#evVideoUrl");
    const moreEl = $("#evMoreImg");

    const slideImgUrl = cleanSpaces(slideImgEl?.value || "");
    const deskUrl = cleanSpaces(deskEl?.value || "");
    const mobUrl = cleanSpaces(mobEl?.value || "");
    const slideVideoUrl = cleanSpaces(slideVideoEl?.value || "");
    const moreUrl = cleanSpaces(moreEl?.value || "");

    try {
      if (state.mode !== "supabase") return false;

      setBusy(true, "Guardando cambios…");

      const updated = await updateEvent(ev.id, payload);

      // ✅ upsert/delete media_items (folders oficiales)
      await upsertEventMedia(ev.id, "slide_img", slideImgUrl);
      await upsertEventMedia(ev.id, "slide_video", slideVideoUrl);

      await upsertEventMedia(ev.id, "desktop_event", deskUrl);
      await upsertEventMedia(ev.id, "mobile_event", mobUrl);
      await upsertEventMedia(ev.id, "event_more", moreUrl);

      state.events = (state.events || []).map((x) =>
        String(x.id) === String(updated.id) ? updated : x
      );

      toast("Guardado", "Evento actualizado en Supabase.", 1400);
      setNote("");
      await renderAll();
      try { await ensureEventsLoaded(true); } catch (_) {}
      return true;
    } catch (err) {
      console.error(err);
      toast(isRLSError(err) ? "RLS" : "Error",
        isRLSError(err)
          ? "RLS bloqueó el guardado. Revisá policies INSERT/UPDATE/DELETE en media_items."
          : prettyError(err),
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
