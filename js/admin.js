"use strict";

/**
 * admin.js — Entre Copas & Notas ✅ PRO (Eventos + Tabs) — Opción B
 *
 * Opción B:
 * - admin-auth.js valida sesión/permisos y emite "admin:ready"
 * - admin.js controla UI/gate del panel (hidden) y arranca módulos/tabs
 *
 * Eficiencia:
 * - NO vuelve a validar sesión si ya llegó admin:ready
 * - Boot único, anti doble montaje
 * - admin:tab se dispara en window + document
 */

(function () {
  // ------------------------------------------------------------
  // Guard anti doble montaje
  // ------------------------------------------------------------
  if (window.__ecnAdminMounted === true) return;
  window.__ecnAdminMounted = true;

  const VERSION = "2026-02-22.admin.B.pro.2";

  // ------------------------------------------------------------
  // DOM helpers
  // ------------------------------------------------------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const appPanel = $("#appPanel");
  if (!appPanel) return;

  console.log("[admin] loaded", { VERSION });

  // ------------------------------------------------------------
  // Toast
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

  // ------------------------------------------------------------
  // Utils
  // ------------------------------------------------------------
  const cleanSpaces = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
  const safeStr = (x) => String(x ?? "");
  const safeNum = (x, def = null) => {
    if (x === null || x === undefined || x === "") return def;
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

  // ------------------------------------------------------------
  // Supabase (solo para CRUD y lecturas)
  // ------------------------------------------------------------
  function getSB() {
    if (!window.APP) return null;
    return window.APP.supabase || window.APP.sb || null;
  }

  // ------------------------------------------------------------
  // Config DB
  // ------------------------------------------------------------
  const EVENTS_TABLE = "events";
  const VIEW_BINDINGS_LATEST = "v_media_bindings_latest";

  // slots readonly usados por TU HTML actual
  const EVENT_SLOTS_READONLY = ["desktop_event", "mobile_event"];

  // ------------------------------------------------------------
  // State
  // ------------------------------------------------------------
  const state = {
    activeTab: "events",
    didBindTabs: false,
    didBindEditor: false,
    didBoot: false,
    query: "",
    events: [],
    selectedEventId: null,
  };

  // ------------------------------------------------------------
  // Gate UI (Opción B)
  // ------------------------------------------------------------
  function showPanel() {
    try { appPanel.hidden = false; } catch (_) {}
  }

  function hidePanel() {
    // si querés, podés ocultarlo mientras espera auth
    // (no redirige: eso lo hace admin-auth)
    try { appPanel.hidden = true; } catch (_) {}
  }

  // ------------------------------------------------------------
  // Tabs
  // ------------------------------------------------------------
  function hideAllTabs() {
    $$('[role="tabpanel"]', appPanel).forEach((p) => (p.hidden = true));
  }

  function dispatchAdminTab(tab) {
    try { window.dispatchEvent(new CustomEvent("admin:tab", { detail: { tab } })); } catch (_) {}
    try { document.dispatchEvent(new CustomEvent("admin:tab", { detail: { tab } })); } catch (_) {}
  }

  function setTab(tabName) {
    state.activeTab = tabName || "events";

    $$(".tab", appPanel).forEach((t) => {
      const on = t.dataset.tab === state.activeTab;
      t.setAttribute("aria-selected", on ? "true" : "false");
      t.classList.toggle("isActive", on);
    });

    hideAllTabs();
    const panel = $("#tab-" + state.activeTab);
    if (panel) panel.hidden = false;

    dispatchAdminTab(state.activeTab);
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
      // regs/media/etc escuchan #search o admin:tab en sus propios módulos
    });
  }

  // ------------------------------------------------------------
  // Events mapping + CRUD
  // ------------------------------------------------------------
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
      slug: safeStr(ev.slug || ""),
      badge: safeStr(ev.badge || ""),
      active: typeof ev.active === "boolean" ? ev.active : null,
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

  // ------------------------------------------------------------
  // Media readonly desde v_media_bindings_latest
  // ------------------------------------------------------------
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
      .in("slot", EVENT_SLOTS_READONLY);

    if (error) throw error;

    const map = {};
    (Array.isArray(data) ? data : []).forEach((r) => {
      const slot = safeStr(r?.slot || "").trim();
      const url = safeStr(r?.public_url || r?.path || "").trim();
      if (slot) map[slot] = url;
    });
    return map;
  }

  // ------------------------------------------------------------
  // Render list (Eventos)
  // ------------------------------------------------------------
  function renderEventList() {
    const list = $("#eventList");
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
      const div = document.createElement("div");
      div.className = "empty";
      div.textContent = "No hay eventos para mostrar.";
      list.appendChild(div);
      return;
    }

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

  // ------------------------------------------------------------
  // Editor (alineado a tu admin.html PRO)
  // ------------------------------------------------------------
  function setEditorVisible(on) {
    const form = $("#eventForm");
    if (form) form.hidden = !on;
  }

  function setDescCount() {
    const desc = $("#evDesc");
    const count = $("#evDescCount");
    if (!desc || !count) return;
    const len = safeStr(desc.value || "").length;
    count.textContent = `${len}/520`;
  }

  function fillEditor(ev) {
    $("#evId") && ($("#evId").value = ev.id || "");
    $("#evTitle") && ($("#evTitle").value = ev.title || "");
    $("#evDesc") && ($("#evDesc").value = ev.description || "");
    setDescCount();

    $("#evPlace") && ($("#evPlace").value = ev.location || "");
    $("#evSchedule") && ($("#evSchedule").value = ev.time_range || "");
    $("#evDurationHours") && ($("#evDurationHours").value = ev.duration_hours ?? "");
    $("#evPriceAmount") && ($("#evPriceAmount").value = ev.price_amount ?? "");
    $("#evCurrency") && ($("#evCurrency").value = ev.price_currency || "CRC");

    $("#evSlug") && ($("#evSlug").value = ev.slug || "");
    $("#evBadge") && ($("#evBadge").value = ev.badge || "");
    if ($("#evActive") && typeof ev.active === "boolean") $("#evActive").value = ev.active ? "true" : "false";
    $("#evAlt") && ($("#evAlt").value = ev.more_img_alt || "");

    // media readonly
    $("#evBannerDesktopUrl") && ($("#evBannerDesktopUrl").value = "");
    $("#evBannerMobileUrl") && ($("#evBannerMobileUrl").value = "");
  }

  async function openEvent(eventId) {
    const ev = (state.events || []).find((x) => x.id === eventId);
    if (!ev) return;

    state.selectedEventId = ev.id;
    setEditorVisible(true);
    fillEditor(ev);

    try {
      const map = await fetchEventSlotUrlsLatest(ev.id);
      $("#evBannerDesktopUrl") && ($("#evBannerDesktopUrl").value = map.desktop_event || "");
      $("#evBannerMobileUrl") && ($("#evBannerMobileUrl").value = map.mobile_event || "");
    } catch (e) {
      console.warn(e);
    }
  }

  function readEditorPayload() {
    const payload = {
      title: cleanSpaces($("#evTitle")?.value || ""),
      description: cleanSpaces($("#evDesc")?.value || ""),
      location: cleanSpaces($("#evPlace")?.value || ""),
      time_range: cleanSpaces($("#evSchedule")?.value || ""),
      duration_hours: safeNum($("#evDurationHours")?.value ?? null, null),
      price_amount: safeNum($("#evPriceAmount")?.value ?? null, null),
      price_currency: cleanSpaces($("#evCurrency")?.value || "CRC"),
      more_img_alt: cleanSpaces($("#evAlt")?.value || ""),
    };

    const slug = cleanSpaces($("#evSlug")?.value || "");
    if (slug) payload.slug = slug;

    const badge = cleanSpaces($("#evBadge")?.value || "");
    if (badge) payload.badge = badge;

    const activeStr = cleanSpaces($("#evActive")?.value || "");
    if (activeStr === "true" || activeStr === "false") payload.active = activeStr === "true";

    return payload;
  }

  // ------------------------------------------------------------
  // Bind editor actions
  // ------------------------------------------------------------
  function bindEditorOnce() {
    if (state.didBindEditor) return;
    state.didBindEditor = true;

    $("#evDesc")?.addEventListener("input", setDescCount);

    // "Gestionar en Medios"
 $("#evManageMediaBtn")?.addEventListener("click", () => setTab("media"));

    $("#newEventBtn")?.addEventListener("click", async () => {
      setTab("events");
      setEditorVisible(true);

      const draft = {
        title: "Nuevo evento",
        description: "",
        location: "",
        time_range: "",
        duration_hours: null,
        price_amount: null,
        price_currency: "CRC",
        more_img_alt: "",
      };

      try {
        toast("Evento", "Creando…", 900);
        const created = await insertEvent(draft);
        state.events.unshift(created);
        renderEventList();
        await openEvent(created.id);
        toast("Evento", "Creado. Completá el editor y guardá.", 2200);
      } catch (e) {
        console.warn(e);
        toast("Error", looksLikeRLSError(e) ? "RLS bloquea crear eventos." : (e.message || String(e)));
      }
    });

    $("#eventForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = cleanSpaces($("#evId")?.value || "");
      if (!id) return;

      try {
        toast("Guardando", "Actualizando evento…", 900);
        const payload = readEditorPayload();
        const updated = await updateEvent(id, payload);
        state.events = state.events.map((x) => (x.id === id ? updated : x));
        renderEventList();
        toast("Guardado", "Evento actualizado.", 1800);
      } catch (err) {
        console.warn(err);
        toast("Error", looksLikeRLSError(err) ? "RLS bloquea editar eventos." : (err.message || String(err)));
      }
    });

    $("#deleteEventBtn")?.addEventListener("click", async () => {
      const id = cleanSpaces($("#evId")?.value || "");
      if (!id) return;
      const ok = confirm("¿Eliminar este evento?");
      if (!ok) return;

      try {
        toast("Eliminando", "Procesando…", 900);
        await deleteEvent(id);
        state.events = state.events.filter((x) => x.id !== id);
        state.selectedEventId = null;
        renderEventList();
        setEditorVisible(false);
        toast("Eliminado", "Evento eliminado.", 1800);
      } catch (err) {
        console.warn(err);
        toast("Error", looksLikeRLSError(err) ? "RLS bloquea eliminar eventos." : (err.message || String(err)));
      }
    });
  }

  // ------------------------------------------------------------
  // Boot (solo cuando admin-auth diga READY)
  // ------------------------------------------------------------
  async function bootAfterReady(detail) {
    if (state.didBoot) return;
    state.didBoot = true;

    console.log("[admin] bootAfterReady", { VERSION, detail });

    showPanel();
    bindTabsOnce();
    bindEditorOnce();
    setTab("events");

    // seguridad: si no hay supabase (debería existir), avisamos
    const sb = getSB();
    if (!sb) {
      toast("Supabase", "APP.supabase no existe. Revisá el orden de scripts.", 5200);
      return;
    }

    try {
      await fetchEvents();
      renderEventList();
    } catch (e) {
      console.warn(e);
      toast("Error", looksLikeRLSError(e) ? "RLS bloquea lectura de eventos." : (e.message || String(e)));
    }
  }

  // ------------------------------------------------------------
  // Esperar admin:ready (window y document por compat)
  // ------------------------------------------------------------
  function waitForReady() {
    // opcional: ocultar panel mientras auth valida
    hidePanel();

    if (window.APP && APP.__adminReady === true) {
      // ya listo
      bootAfterReady({ alreadyReady: true });
      return;
    }

    const handler = (e) => {
      // e.detail viene del auth
      bootAfterReady(e?.detail || null);
      // limpiamos listeners (por si disparan en ambos)
      try { window.removeEventListener("admin:ready", handler); } catch (_) {}
      try { document.removeEventListener("admin:ready", handler); } catch (_) {}
    };

    window.addEventListener("admin:ready", handler, { once: true });
    document.addEventListener("admin:ready", handler, { once: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", waitForReady, { once: true });
  } else {
    waitForReady();
  }
})();