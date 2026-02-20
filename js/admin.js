"use strict";

/**
 * admin.js — Entre Copas & Notas ✅ (Eventos + Tabs)
 * - Mantiene tu panel funcionando (events/dates/regs/media/gallery/promos)
 * - ✅ Deshabilita “Media Library” embebido en Eventos para evitar duplicación
 * - ✅ Los medios se gestionan SOLO en el tab Medios (admin-media.js)
 */

(function () {
  // ---------------------------
  // DOM helpers
  // ---------------------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const appPanel = $("#appPanel");
  if (!appPanel) return;

  const VERSION = "2026-02-20.admin.clean.1";

  // ---------------------------
  // Toast
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

  // ---------------------------
  // Utils
  // ---------------------------
  const cleanSpaces = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
  const safeStr = (x) => String(x ?? "");
  const safeNum = (x, def = 0) => {
    const n = Number(x);
    return Number.isFinite(n) ? n : def;
  };

  function looksLikeRLSError(err) {
    const m = safeStr(err?.message || "").toLowerCase();
    const c = safeStr(err?.code || "").toLowerCase();
    return (
      c === "42501" ||
      m.includes("42501") ||
      m.includes("rls") ||
      m.includes("row level security") ||
      m.includes("permission") ||
      m.includes("not allowed") ||
      m.includes("violates row-level security") ||
      m.includes("new row violates row-level security")
    );
  }

  // ---------------------------
  // Supabase
  // ---------------------------
  function getSB() {
    if (!window.APP) return null;
    return window.APP.supabase || window.APP.sb || null;
  }

  async function ensureSession() {
    const sb = getSB();
    if (!sb) {
      toast("Supabase", "APP.supabase no existe. Orden: CDN → supabaseClient.js → admin-auth.js → admin.js", 5200);
      return null;
    }
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

  // ---------------------------
  // Config
  // ---------------------------
  const EVENTS_TABLE = "events";
  const VIEW_BINDINGS_LATEST = "v_media_bindings_latest";
  const EVENT_SLOTS = ["slide_img", "slide_video", "desktop_event", "mobile_event", "event_more"];

  // ---------------------------
  // Tabs
  // ---------------------------
  const state = {
    activeTab: "events",
    didBindTabs: false,
    query: "",
    events: [],
    selectedEventId: null,
  };

  function hideAllTabs() {
    $$('[role="tabpanel"]', appPanel).forEach((p) => (p.hidden = true));
  }

  function setTab(tabName) {
    state.activeTab = tabName || "events";

    $$(".tab", appPanel).forEach((t) => {
      t.setAttribute("aria-selected", t.dataset.tab === state.activeTab ? "true" : "false");
    });

    hideAllTabs();
    const panel = $("#tab-" + state.activeTab);
    if (panel) panel.hidden = false;

    document.dispatchEvent(new CustomEvent("admin:tab", { detail: { tab: state.activeTab } }));
  }

  function bindTabsOnce() {
    if (state.didBindTabs) return;
    state.didBindTabs = true;

    $$(".tab", appPanel).forEach((btn) => {
      btn.addEventListener("click", () => setTab(btn.dataset.tab || "events"));
    });

    $("#search")?.addEventListener("input", (e) => {
      state.query = cleanSpaces(e.target.value || "");
      renderEventList();
    });
  }

  // ---------------------------
  // ✅ Deshabilitar Media Library embebido (evita duplicación)
  // ---------------------------
  function ensureMediaLibraryPanel() {
    // ✅ Entre Copas & Notas: la gestión de Medios vive SOLO en el tab “Medios” (admin-media.js).
    // Este panel embebido en Eventos se deshabilita para evitar duplicación/confusión.
    return null;
  }

  // ---------------------------
  // ✅ Eventos: campos de media son SOLO lectura (gestión en tab Medios)
  // ---------------------------
  function setEventMediaFieldsReadOnly(on) {
    const ids = ["evImg", "evImgDesktop", "evImgMobile", "evVideoUrl", "evMoreImg"];
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.readOnly = !!on;
      el.title = on ? "Gestionar en Medios" : "";
    });
  }

  // ---------------------------
  // Events CRUD
  // ---------------------------
  function mapEventRow(row) {
    const ev = row || {};
    return {
      id: ev.id,
      title: safeStr(ev.title || ""),
      type: safeStr(ev.type || ""),
      month_key: safeStr(ev.month_key || ""),
      description: safeStr(ev.description || ""),
      location: safeStr(ev.location || ""),
      time_range: safeStr(ev.time_range || ""),
      duration_hours: ev.duration_hours,
      price_amount: ev.price_amount,
      price_currency: safeStr(ev.price_currency || "CRC"),
      more_img_alt: safeStr(ev.more_img_alt || ""),
      created_at: safeStr(ev.created_at || ""),
      updated_at: safeStr(ev.updated_at || ""),
    };
  }

  async function fetchEvents() {
    const sb = getSB();
    if (!sb) throw new Error("APP.supabase no existe.");
    const { data, error } = await sb.from(EVENTS_TABLE).select("*").order("created_at", { ascending: false });
    if (error) throw error;
    state.events = Array.isArray(data) ? data.map(mapEventRow) : [];
  }

  async function insertEvent(payload) {
    const sb = getSB();
    const { data, error } = await sb.from(EVENTS_TABLE).insert(payload).select("*").single();
    if (error) throw error;
    return mapEventRow(data);
  }

  async function updateEvent(id, payload) {
    const sb = getSB();
    const { data, error } = await sb.from(EVENTS_TABLE).update(payload).eq("id", id).select("*").single();
    if (error) throw error;
    return mapEventRow(data);
  }

  async function deleteEvent(id) {
    const sb = getSB();
    const { error } = await sb.from(EVENTS_TABLE).delete().eq("id", id);
    if (error) throw error;
  }

  // ---------------------------
  // Media (solo lectura) desde v_media_bindings_latest
  // ---------------------------
  async function fetchEventSlotUrlsLatest(eventId) {
    const sb = getSB();
    if (!sb) throw new Error("APP.supabase no existe.");
    const eid = safeStr(eventId || "").trim();
    if (!eid) return {};

    const { data, error } = await sb
      .from(VIEW_BINDINGS_LATEST)
      .select("slot, public_url, path")
      .eq("scope", "event")
      .eq("scope_id", eid)
      .in("slot", EVENT_SLOTS);

    if (error) throw error;

    const map = {};
    (Array.isArray(data) ? data : []).forEach((r) => {
      const slot = safeStr(r?.slot || "").trim();
      const url = safeStr(r?.public_url || r?.path || "").trim();
      if (slot) map[slot] = url;
    });
    return map;
  }

  // ---------------------------
  // Render list
  // ---------------------------
  function renderEventList() {
    const list = $("#eventList");
    const empty = $("#eventsEmpty");
    if (!list) return;

    const q = cleanSpaces(state.query).toLowerCase();
    const items = (state.events || []).filter((ev) => {
      if (!q) return true;
      return (
        safeStr(ev.title).toLowerCase().includes(q) ||
        safeStr(ev.type).toLowerCase().includes(q) ||
        safeStr(ev.month_key).toLowerCase().includes(q)
      );
    });

    list.innerHTML = "";
    if (!items.length) {
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;

    const frag = document.createDocumentFragment();
    items.forEach((ev) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "item";
      btn.innerHTML = `
        <div style="display:flex; justify-content:space-between; gap:12px;">
          <div style="min-width:0;">
            <div style="font-weight:800; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(ev.title)}</div>
            <div style="opacity:.72; font-size:13px;">${escapeHtml(ev.type)} · ${escapeHtml(ev.month_key)}</div>
          </div>
          <div style="opacity:.65; font-size:12px;">Editar</div>
        </div>
      `;
      btn.addEventListener("click", () => openEvent(ev.id));
      frag.appendChild(btn);
    });
    list.appendChild(frag);
  }

  // ---------------------------
  // Editor
  // ---------------------------
  function setNote(msg) {
    const el = $("#eventNote");
    if (el) el.textContent = cleanSpaces(msg || "");
  }

  function setStorageNote(msg) {
    const el = $("#storageNote");
    if (el) el.textContent = cleanSpaces(msg || "");
  }

  function setEditorVisible(on) {
    const empty = $("#editorEmpty");
    const form = $("#eventForm");
    if (empty) empty.hidden = !!on;
    if (form) form.hidden = !on;
  }

  function fillEditor(ev) {
    $("#eventId") && ($("#eventId").value = ev.id || "");
    $("#evTitle") && ($("#evTitle").value = ev.title || "");
    $("#evType") && ($("#evType").value = ev.type || "Cata de vino");
    $("#evMonth") && ($("#evMonth").value = ev.month_key || "ENERO");
    $("#evDesc") && ($("#evDesc").value = ev.description || "");
    $("#descCount") && ($("#descCount").textContent = String((ev.description || "").length));
    $("#evLocation") && ($("#evLocation").value = ev.location || "");
    $("#evTimeRange") && ($("#evTimeRange").value = ev.time_range || "");
    $("#evDurationHours") && ($("#evDurationHours").value = ev.duration_hours ?? "");
    $("#evPriceAmount") && ($("#evPriceAmount").value = ev.price_amount ?? "");
    $("#evPriceCurrency") && ($("#evPriceCurrency").value = ev.price_currency || "CRC");
    $("#evMoreImgAlt") && ($("#evMoreImgAlt").value = ev.more_img_alt || "");

    // media readonly (se llena por view)
    setEventMediaFieldsReadOnly(true);
    $("#evImg") && ($("#evImg").value = "");
    $("#evVideoUrl") && ($("#evVideoUrl").value = "");
    $("#evImgDesktop") && ($("#evImgDesktop").value = "");
    $("#evImgMobile") && ($("#evImgMobile").value = "");
    $("#evMoreImg") && ($("#evMoreImg").value = "");
  }

  async function openEvent(eventId) {
    const ev = (state.events || []).find((x) => x.id === eventId);
    if (!ev) return;

    state.selectedEventId = ev.id;
    setEditorVisible(true);
    fillEditor(ev);
    setNote("");

    // cargar urls latest para inputs (solo lectura)
    try {
      const map = await fetchEventSlotUrlsLatest(ev.id);
      $("#evImg") && ($("#evImg").value = map.slide_img || "");
      $("#evVideoUrl") && ($("#evVideoUrl").value = map.slide_video || "");
      $("#evImgDesktop") && ($("#evImgDesktop").value = map.desktop_event || "");
      $("#evImgMobile") && ($("#evImgMobile").value = map.mobile_event || "");
      $("#evMoreImg") && ($("#evMoreImg").value = map.event_more || "");
    } catch (e) {
      console.warn(e);
    }
  }

  function readEditorPayload() {
    return {
      title: cleanSpaces($("#evTitle")?.value || ""),
      type: cleanSpaces($("#evType")?.value || ""),
      month_key: cleanSpaces($("#evMonth")?.value || ""),
      description: cleanSpaces($("#evDesc")?.value || ""),
      location: cleanSpaces($("#evLocation")?.value || ""),
      time_range: cleanSpaces($("#evTimeRange")?.value || ""),
      duration_hours: safeNum($("#evDurationHours")?.value || null, null),
      price_amount: safeNum($("#evPriceAmount")?.value || null, null),
      price_currency: cleanSpaces($("#evPriceCurrency")?.value || "CRC"),
      more_img_alt: cleanSpaces($("#evMoreImgAlt")?.value || ""),
    };
  }

  // ---------------------------
  // Bind editor buttons
  // ---------------------------
  function bindEditorOnce() {
    $("#evDesc")?.addEventListener("input", (e) => {
      const v = safeStr(e.target.value || "");
      $("#descCount") && ($("#descCount").textContent = String(v.length));
    });

    $("#newEventBtn")?.addEventListener("click", async () => {
      setTab("events");
      setEditorVisible(true);
      setNote("");

      const draft = {
        title: "Nuevo evento",
        type: "Cata de vino",
        month_key: "ENERO",
        description: "",
        location: "",
        time_range: "",
        duration_hours: null,
        price_amount: null,
        price_currency: "CRC",
        more_img_alt: "",
      };

      try {
        setStorageNote("Creando evento…");
        const created = await insertEvent(draft);
        state.events.unshift(created);
        renderEventList();
        await openEvent(created.id);
        setStorageNote("");
        toast("Evento", "Creado. Completá el editor y guardá.", 2600);
      } catch (e) {
        console.warn(e);
        setStorageNote("");
        toast("Error", looksLikeRLSError(e) ? "RLS bloquea crear eventos." : (e.message || String(e)));
      }
    });

    $("#eventForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = cleanSpaces($("#eventId")?.value || "");
      if (!id) return;

      try {
        setStorageNote("Guardando…");
        const payload = readEditorPayload();
        const updated = await updateEvent(id, payload);
        state.events = state.events.map((x) => (x.id === id ? updated : x));
        renderEventList();
        setStorageNote("");
        toast("Guardado", "Evento actualizado.", 2200);
      } catch (err) {
        console.warn(err);
        setStorageNote("");
        toast("Error", looksLikeRLSError(err) ? "RLS bloquea editar eventos." : (err.message || String(err)));
      }
    });

    $("#delEventBtn")?.addEventListener("click", async () => {
      const id = cleanSpaces($("#eventId")?.value || "");
      if (!id) return;
      const ok = confirm("¿Eliminar este evento?");
      if (!ok) return;

      try {
        setStorageNote("Eliminando…");
        await deleteEvent(id);
        state.events = state.events.filter((x) => x.id !== id);
        state.selectedEventId = null;
        renderEventList();
        setEditorVisible(false);
        setStorageNote("");
        toast("Eliminado", "Evento eliminado.", 2200);
      } catch (err) {
        console.warn(err);
        setStorageNote("");
        toast("Error", looksLikeRLSError(err) ? "RLS bloquea eliminar eventos." : (err.message || String(err)));
      }
    });
  }

  // ---------------------------
  // Boot
  // ---------------------------
  async function boot() {
    bindTabsOnce();
    bindEditorOnce();
    setTab("events");

    const s = await ensureSession();
    if (!s) return;

    try {
      setStorageNote("Cargando…");
      await fetchEvents();
      renderEventList();
      setStorageNote("");
    } catch (e) {
      console.warn(e);
      setStorageNote("");
      toast("Error", looksLikeRLSError(e) ? "RLS bloquea lectura de eventos." : (e.message || String(e)));
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();