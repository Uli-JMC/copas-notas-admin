"use strict";

/**
 * admin.js — Entre Copas & Notas ✅ PRO (Eventos + Tabs) — Opción B
 * - admin-auth.js valida ingreso/permisos y emite admin:ready
 * - admin.js muestra #appPanel, controla tabs y CRUD de events
 * - Alineado a BD real:
 *   events.title/type/month_key son NOT NULL
 *   events.duration_hours es text
 *   events.active existe y es boolean NOT NULL default false
 * - Media en Eventos es solo lectura desde v_media_bindings_latest
 */
(function () {
  if (window.__ecnAdminMounted === true) return;
  window.__ecnAdminMounted = true;

  const VERSION = "2026-05-16.admin.events-phase1.1";
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const appPanel = $("#appPanel");
  const authGate = $("#authGate");
  if (!appPanel) return;

  const EVENTS_TABLE = "events";
  const VIEW_BINDINGS_LATEST = "v_media_bindings_latest";
  const EVENT_SLOTS_READONLY = ["desktop_event", "mobile_event"];

  const MONTHS = [
    "ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO",
    "JULIO", "AGOSTO", "SETIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"
  ];

  const state = {
    didBoot: false,
    didBindTabs: false,
    didBindEditor: false,
    activeTab: "events",
    query: "",
    events: [],
    selectedEventId: null,
  };

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

  const safeStr = (x) => String(x ?? "");
  const cleanSpaces = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

  function parseDecimalOrNull(v) {
    const raw = String(v ?? "").trim().replace(",", ".");
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }

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
      m.includes("violates row-level security")
    );
  }

  function getSB() {
    if (!window.APP) return null;
    return APP.supabase || APP.sb || null;
  }

  function showPanel() {
    if (authGate) authGate.hidden = true;
    appPanel.hidden = false;
  }

  function hidePanel() {
    appPanel.hidden = true;
  }

  function dispatchAdminTab(tab) {
    try { window.dispatchEvent(new CustomEvent("admin:tab", { detail: { tab } })); } catch (_) {}
    try { document.dispatchEvent(new CustomEvent("admin:tab", { detail: { tab } })); } catch (_) {}
  }

  function hideAllTabs() {
    $$('[role="tabpanel"]', appPanel).forEach((p) => (p.hidden = true));
  }

  function setTab(tabName) {
    state.activeTab = tabName || "events";

    $$(".tab", appPanel).forEach((btn) => {
      const on = btn.dataset.tab === state.activeTab;
      btn.setAttribute("aria-selected", on ? "true" : "false");
      btn.classList.toggle("isActive", on);
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
    });
  }

  function mapEventRow(row) {
    const ev = row || {};
    return {
      id: ev.id,
      title: safeStr(ev.title || ""),
      type: safeStr(ev.type || "Cata de vino"),
      month_key: safeStr(ev.month_key || "ENERO"),
      description: safeStr(ev.description || ""),
      location: safeStr(ev.location || ""),
      time_range: safeStr(ev.time_range || ""),
      duration_hours: ev.duration_hours == null ? "" : String(ev.duration_hours),
      price_amount: ev.price_amount,
      price_currency: safeStr(ev.price_currency || "CRC"),
      more_img_alt: safeStr(ev.more_img_alt || ""),
      active: typeof ev.active === "boolean" ? ev.active : false,
      badge: safeStr(ev.badge || ""),
      slug: safeStr(ev.slug || ""),
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
    if (!sb) throw new Error("APP.supabase no existe.");
    const safePayload = {
      title: cleanSpaces(payload.title || "Nuevo evento") || "Nuevo evento",
      type: cleanSpaces(payload.type || "Cata de vino") || "Cata de vino",
      month_key: cleanSpaces(payload.month_key || "ENERO") || "ENERO",
      description: payload.description ?? "",
      location: payload.location ?? "",
      time_range: payload.time_range ?? "",
      duration_hours: payload.duration_hours == null ? null : String(payload.duration_hours),
      price_amount: payload.price_amount ?? null,
      price_currency: payload.price_currency || "CRC",
      more_img_alt: payload.more_img_alt ?? "",
      active: typeof payload.active === "boolean" ? payload.active : false,
      badge: payload.badge ?? null,
      slug: payload.slug || null,
    };
    const { data, error } = await sb.from(EVENTS_TABLE).insert(safePayload).select("*").single();
    if (error) throw error;
    return mapEventRow(data);
  }

  async function updateEvent(id, payload) {
    const sb = getSB();
    if (!sb) throw new Error("APP.supabase no existe.");
    const { data, error } = await sb.from(EVENTS_TABLE).update(payload).eq("id", id).select("*").single();
    if (error) throw error;
    return mapEventRow(data);
  }

  async function deleteEvent(id) {
    const sb = getSB();
    if (!sb) throw new Error("APP.supabase no existe.");
    const { error } = await sb.from(EVENTS_TABLE).delete().eq("id", id);
    if (error) throw error;
  }

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
      if (ev.id === state.selectedEventId) btn.classList.add("active");
      btn.innerHTML = `
        <div style="display:flex; justify-content:space-between; gap:12px; width:100%;">
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

  function setEditorVisible(on) {
    const form = $("#eventForm");
    if (form) form.hidden = !on;
  }

  function setDescCount() {
    const desc = $("#evDesc");
    const count = $("#evDescCount");
    if (!desc || !count) return;
    count.textContent = `${safeStr(desc.value || "").length}/520`;
  }


  function updateEventStatusUi() {
    const label = $("#eventStatusLabel");
    const dot = $(".eventStatusDot");
    const active = $("#evActive")?.value === "true";
    if (label) label.textContent = active ? "Publicado" : "Borrador";
    if (dot) dot.classList.toggle("isPublished", active);
  }

  function formatTime12(value) {
    const raw = safeStr(value || "").trim();
    const m = raw.match(/^(\d{1,2}):(\d{2})/);
    if (!m) return "";
    let h = Number(m[1]);
    const min = m[2];
    const suffix = h >= 12 ? "pm" : "am";
    h = h % 12;
    if (h === 0) h = 12;
    return `${h}:${min} ${suffix}`;
  }

  function syncMonthFromDateUi() {
    const dateEl = $("#evDateUi");
    const monthEl = $("#evMonth");
    const raw = safeStr(dateEl?.value || "");
    if (!raw || !monthEl) return;
    const parts = raw.split("-");
    if (parts.length < 2) return;
    const idx = Number(parts[1]) - 1;
    if (idx >= 0 && idx < MONTHS.length) monthEl.value = MONTHS[idx];
  }

  function syncScheduleFromTimeUi() {
    const start = $("#evStartTimeUi")?.value || "";
    const end = $("#evEndTimeUi")?.value || "";
    const scheduleEl = $("#evSchedule");
    const durationEl = $("#evDurationHours");

    if (scheduleEl && start && end) {
      scheduleEl.value = `${formatTime12(start)} a ${formatTime12(end)}`;
    } else if (scheduleEl && start) {
      scheduleEl.value = formatTime12(start);
    }

    if (durationEl && start && end) {
      const [sh, sm] = start.split(":").map(Number);
      const [eh, em] = end.split(":").map(Number);
      if (Number.isFinite(sh) && Number.isFinite(eh)) {
        let minutes = (eh * 60 + (em || 0)) - (sh * 60 + (sm || 0));
        if (minutes < 0) minutes += 24 * 60;
        if (minutes > 0) {
          const hours = minutes / 60;
          durationEl.value = `${Number.isInteger(hours) ? hours : hours.toFixed(1)} horas`;
        }
      }
    }
  }

  function updateEventMediaSummary() {
    const desktop = cleanSpaces($("#evBannerDesktopUrl")?.value || "");
    const mobile = cleanSpaces($("#evBannerMobileUrl")?.value || "");
    const desktopPill = $("#eventDesktopMediaStatus");
    const mobilePill = $("#eventMobileMediaStatus");
    if (desktopPill) {
      desktopPill.textContent = desktop ? "Desktop asignado" : "Desktop pendiente";
      desktopPill.classList.toggle("isReady", !!desktop);
    }
    if (mobilePill) {
      mobilePill.textContent = mobile ? "Mobile asignado" : "Mobile pendiente";
      mobilePill.classList.toggle("isReady", !!mobile);
    }
  }

  function openCreateEventModal() {
    const modal = $("#eventCreateModal");
    if (!modal) return false;
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    const title = $("#newEventTitle");
    if (title) {
      title.value = "";
      setTimeout(() => title.focus(), 0);
    }
    return true;
  }

  function closeCreateEventModal() {
    const modal = $("#eventCreateModal");
    if (!modal) return;
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
  }

  function ensureMonthSelectOptions() {
    const el = $("#evMonth");
    if (!el || el.options.length) return;
    el.innerHTML = MONTHS.map((m) => `<option value="${m}">${m}</option>`).join("");
  }

  function fillEditor(ev) {
    ensureMonthSelectOptions();

    $("#evId") && ($("#evId").value = ev.id || "");
    $("#evTitle") && ($("#evTitle").value = ev.title || "");
    $("#evType") && ($("#evType").value = ev.type || "Cata de vino");
    $("#evMonth") && ($("#evMonth").value = ev.month_key || "ENERO");
    $("#evDesc") && ($("#evDesc").value = ev.description || "");
    setDescCount();

    $("#evPlace") && ($("#evPlace").value = ev.location || "");
    $("#evSchedule") && ($("#evSchedule").value = ev.time_range || "");
    $("#evDurationHours") && ($("#evDurationHours").value = ev.duration_hours ?? "");
    $("#evPriceAmount") && ($("#evPriceAmount").value = ev.price_amount ?? "");
    $("#evCurrency") && ($("#evCurrency").value = ev.price_currency || "CRC");
    $("#evSlug") && ($("#evSlug").value = ev.slug || "");
    $("#evBadge") && ($("#evBadge").value = ev.badge || "");
    $("#evActive") && ($("#evActive").value = ev.active ? "true" : "false");
    $("#evAlt") && ($("#evAlt").value = ev.more_img_alt || "");

    // Campos visuales de ayuda: no persisten fecha real todavía.
    $("#evDateUi") && ($("#evDateUi").value = "");
    $("#evStartTimeUi") && ($("#evStartTimeUi").value = "");
    $("#evEndTimeUi") && ($("#evEndTimeUi").value = "");

    $("#evBannerDesktopUrl") && ($("#evBannerDesktopUrl").value = "");
    $("#evBannerMobileUrl") && ($("#evBannerMobileUrl").value = "");
    updateEventStatusUi();
    updateEventMediaSummary();
  }

  async function openEvent(eventId) {
    const ev = (state.events || []).find((x) => x.id === eventId);
    if (!ev) return;

    state.selectedEventId = ev.id;
    setEditorVisible(true);
    fillEditor(ev);
    renderEventList();

    try {
      const map = await fetchEventSlotUrlsLatest(ev.id);
      $("#evBannerDesktopUrl") && ($("#evBannerDesktopUrl").value = map.desktop_event || "");
      $("#evBannerMobileUrl") && ($("#evBannerMobileUrl").value = map.mobile_event || "");
      updateEventMediaSummary();
    } catch (e) {
      console.warn("[admin] media readonly", e);
    }
  }

  function readEditorPayload() {
    const current = (state.events || []).find((x) => x.id === state.selectedEventId) || {};
    const duration = cleanSpaces($("#evDurationHours")?.value ?? "");
    const slug = cleanSpaces($("#evSlug")?.value || "");
    const badge = cleanSpaces($("#evBadge")?.value || "");
    const activeStr = cleanSpaces($("#evActive")?.value || "false");

    return {
      title: cleanSpaces($("#evTitle")?.value || "") || "Nuevo evento",
      type: cleanSpaces($("#evType")?.value || current.type || "Cata de vino") || "Cata de vino",
      month_key: cleanSpaces($("#evMonth")?.value || current.month_key || "ENERO") || "ENERO",
      description: cleanSpaces($("#evDesc")?.value || ""),
      location: cleanSpaces($("#evPlace")?.value || ""),
      time_range: cleanSpaces($("#evSchedule")?.value || ""),
      duration_hours: duration || null,
      price_amount: parseDecimalOrNull($("#evPriceAmount")?.value ?? ""),
      price_currency: cleanSpaces($("#evCurrency")?.value || "CRC") || "CRC",
      more_img_alt: cleanSpaces($("#evAlt")?.value || ""),
      active: activeStr === "true",
      badge: badge || null,
      slug: slug || null,
    };
  }

  function bindEditorOnce() {
    if (state.didBindEditor) return;
    state.didBindEditor = true;

    ensureMonthSelectOptions();
    $("#evDesc")?.addEventListener("input", setDescCount);
    $("#evActive")?.addEventListener("change", updateEventStatusUi);
    $("#evDateUi")?.addEventListener("change", syncMonthFromDateUi);
    $("#evStartTimeUi")?.addEventListener("change", syncScheduleFromTimeUi);
    $("#evEndTimeUi")?.addEventListener("change", syncScheduleFromTimeUi);
    $("#evBannerDesktopBtn")?.addEventListener("click", () => setTab("media"));
    $("#evBannerMobileBtn")?.addEventListener("click", () => setTab("media"));

    $("#eventCreateClose")?.addEventListener("click", closeCreateEventModal);
    $("#eventCreateCancel")?.addEventListener("click", closeCreateEventModal);
    $("[data-close='eventCreate']")?.addEventListener("click", closeCreateEventModal);

    $("#newEventBtn")?.addEventListener("click", async () => {
      setTab("events");
      if (openCreateEventModal()) return;

      // Fallback si el modal no existe.
      const fallback = {
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
        active: false,
        badge: null,
        slug: null,
      };
      try {
        const created = await insertEvent(fallback);
        state.events.unshift(created);
        renderEventList();
        await openEvent(created.id);
      } catch (e) {
        console.warn(e);
        toast("Error", looksLikeRLSError(e) ? "RLS bloquea crear eventos." : (e.message || String(e)), 5200);
      }
    });

    $("#eventCreateForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const title = cleanSpaces($("#newEventTitle")?.value || "") || "Nuevo evento";
      const type = cleanSpaces($("#newEventType")?.value || "Cata de vino") || "Cata de vino";
      const month = cleanSpaces($("#newEventMonth")?.value || "ENERO") || "ENERO";
      const draft = {
        title,
        type,
        month_key: month,
        description: "",
        location: "",
        time_range: "",
        duration_hours: null,
        price_amount: null,
        price_currency: "CRC",
        more_img_alt: "",
        active: false,
        badge: null,
        slug: null,
      };

      try {
        toast("Evento", "Creando…", 900);
        const created = await insertEvent(draft);
        state.events.unshift(created);
        closeCreateEventModal();
        renderEventList();
        await openEvent(created.id);
        toast("Evento", "Creado. Completá el editor y guardá.", 2200);
      } catch (e2) {
        console.warn(e2);
        toast("Error", looksLikeRLSError(e2) ? "RLS bloquea crear eventos." : (e2.message || String(e2)), 5200);
      }
    });

    $("#eventForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = cleanSpaces($("#evId")?.value || "");
      if (!id) return toast("Evento", "Seleccioná o creá un evento primero.");

      try {
        toast("Guardando", "Actualizando evento…", 900);
        const payload = readEditorPayload();
        const updated = await updateEvent(id, payload);
        state.events = state.events.map((x) => (x.id === id ? updated : x));
        state.selectedEventId = id;
        renderEventList();
        await openEvent(id);
        toast("Guardado", "Evento actualizado.", 1800);
      } catch (err) {
        console.warn(err);
        toast("Error", looksLikeRLSError(err) ? "RLS bloquea editar eventos." : (err.message || String(err)), 5200);
      }
    });

    $("#deleteEventBtn")?.addEventListener("click", async () => {
      const id = cleanSpaces($("#evId")?.value || "");
      if (!id) return;
      if (!confirm("¿Eliminar este evento?")) return;

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
        toast("Error", looksLikeRLSError(err) ? "RLS bloquea eliminar eventos." : (err.message || String(err)), 5200);
      }
    });
  }

  async function bootAfterReady(detail) {
    if (state.didBoot) return;
    state.didBoot = true;

    console.log("[admin] boot", { VERSION, detail });
    showPanel();
    bindTabsOnce();
    bindEditorOnce();
    setTab("events");

    try {
      await fetchEvents();
      renderEventList();
      if (state.events[0]?.id) await openEvent(state.events[0].id);
    } catch (e) {
      console.warn(e);
      toast("Error", looksLikeRLSError(e) ? "RLS bloquea lectura de eventos." : (e.message || String(e)), 5200);
    }
  }

  function waitForReady() {
    hidePanel();

    if (window.APP && APP.__adminReady === true) {
      bootAfterReady({ alreadyReady: true });
      return;
    }

    const handler = (e) => {
      bootAfterReady(e?.detail || null);
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
