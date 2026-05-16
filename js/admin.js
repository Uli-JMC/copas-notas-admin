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

  const VERSION = "2026-05-16.admin.events-phase3.1";
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const appPanel = $("#appPanel");
  const authGate = $("#authGate");
  if (!appPanel) return;

  const EVENTS_TABLE = "events";
  const VIEW_BINDINGS_LATEST = "v_media_bindings_latest";
  const EVENT_DATES_TABLE = "event_dates";
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
    selectedEventDates: [],
    selectedEventMediaMap: {},
    lastReadiness: null,
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

    // Si volvemos a Eventos después de editar fechas/medios, refrescamos relaciones
    // sin tocar la funcionalidad base. Esto evita que campos/resúmenes queden vacíos
    // o desactualizados después de guardar en otros módulos.
    if (state.activeTab === "events" && state.selectedEventId) {
      refreshSelectedEventRelations({ silent: true });
    }
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


  async function fetchEventDatesForEvent(eventId) {
    const sb = getSB();
    if (!sb) throw new Error("APP.supabase no existe.");
    const eid = safeStr(eventId || "").trim();
    if (!eid) return [];

    const { data, error } = await sb
      .from(EVENT_DATES_TABLE)
      .select("id, label, start_at, ends_at, seats_total, seats_available, created_at")
      .eq("event_id", eid)
      .order("created_at", { ascending: false })
      .limit(10);

    if (error) throw error;
    return Array.isArray(data) ? data : [];
  }

  function setSaveStatus(text, mode) {
    const el = $("#eventSaveStatus");
    if (!el) return;
    el.textContent = text || "Sin cambios";
    el.dataset.mode = mode || "neutral";
  }

  function firstEventDateText() {
    const d = (state.selectedEventDates || [])[0];
    if (!d) return "";
    return cleanSpaces(d.label || d.start_at || "");
  }


  function formatDateHuman(value) {
    if (!value) return "";
    try {
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return "";
      return d.toLocaleDateString("es-CR", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
    } catch (_) { return ""; }
  }

  function formatTimeHuman(value) {
    if (!value) return "";
    try {
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return "";
      return d.toLocaleTimeString("es-CR", { hour: "2-digit", minute: "2-digit" });
    } catch (_) { return ""; }
  }

  function buildDateLabelFromRow(row) {
    if (!row) return "";
    const manual = cleanSpaces(row.label || "");
    const day = formatDateHuman(row.start_at);
    const start = formatTimeHuman(row.start_at);
    const end = formatTimeHuman(row.ends_at);
    if (day && start && end) return `${day} · ${start} a ${end}`;
    if (day && start) return `${day} · ${start}`;
    return manual || day || "Fecha configurada";
  }

  function calculateDurationFromDateRow(row) {
    if (!row?.start_at || !row?.ends_at) return "";
    try {
      const start = new Date(row.start_at).getTime();
      const end = new Date(row.ends_at).getTime();
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return "";
      const hours = (end - start) / 1000 / 60 / 60;
      if (hours <= 0) return "";
      return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} horas`;
    } catch (_) { return ""; }
  }

  function renderEventDatesSummary() {
    const host = $("#eventDatesSummary");
    if (!host) return;
    const dates = Array.isArray(state.selectedEventDates) ? state.selectedEventDates : [];

    if (!dates.length) {
      host.innerHTML = `
        <div class="eventDatesEmpty">
          <strong>Sin fechas configuradas</strong>
          <span>Entrá a Fechas para agregar fecha, hora y cupos.</span>
        </div>
      `;
      return;
    }

    host.innerHTML = dates.map((d, idx) => {
      const label = buildDateLabelFromRow(d);
      const seatsTotal = d.seats_total ?? "—";
      const seatsAvailable = d.seats_available ?? "—";
      const duration = calculateDurationFromDateRow(d);
      return `
        <article class="eventDateSummaryItem ${idx === 0 ? "isMain" : ""}">
          <div>
            <span class="eventDateSummaryTag">${idx === 0 ? "Fecha principal" : "Fecha"}</span>
            <strong>${escapeHtml(label)}</strong>
            ${duration ? `<p>${escapeHtml(duration)}</p>` : ""}
          </div>
          <div class="eventDateSummarySeats">
            <span>${escapeHtml(String(seatsAvailable))}</span>
            <small>de ${escapeHtml(String(seatsTotal))} cupos</small>
          </div>
        </article>
      `;
    }).join("");
  }

  function syncEventFieldsFromDatesIfEmpty() {
    const first = (state.selectedEventDates || [])[0];
    if (!first) return;
    const scheduleEl = $("#evSchedule");
    const durationEl = $("#evDurationHours");
    const monthEl = $("#evMonth");

    const label = buildDateLabelFromRow(first);
    if (scheduleEl && !cleanSpaces(scheduleEl.value || "") && label) scheduleEl.value = label;

    const duration = calculateDurationFromDateRow(first);
    if (durationEl && !cleanSpaces(durationEl.value || "") && duration) durationEl.value = duration;

    if (monthEl && first.start_at) {
      try {
        const d = new Date(first.start_at);
        const idx = d.getMonth();
        if (idx >= 0 && idx < MONTHS.length) monthEl.value = MONTHS[idx];
      } catch (_) {}
    }
  }

  function calculateEventReadiness(payloadOverride) {
    const payload = payloadOverride || readEditorPayload();
    const desktop = cleanSpaces($("#evBannerDesktopUrl")?.value || state.selectedEventMediaMap?.desktop_event || "");
    const mobile = cleanSpaces($("#evBannerMobileUrl")?.value || state.selectedEventMediaMap?.mobile_event || "");
    const dates = Array.isArray(state.selectedEventDates) ? state.selectedEventDates : [];
    const hasDateRecord = dates.length > 0;
    const firstDate = dates[0] || null;
    const seatsOk = !firstDate || (Number(firstDate.seats_total || 0) >= 0 && Number(firstDate.seats_available || 0) >= 0);

    const checks = [
      { key: "title", label: "Título definido", ok: !!cleanSpaces(payload.title || "") },
      { key: "typeMonth", label: "Tipo y mes definidos", ok: !!cleanSpaces(payload.type || "") && !!cleanSpaces(payload.month_key || "") },
      { key: "description", label: "Descripción agregada", ok: !!cleanSpaces(payload.description || "") },
      { key: "place", label: "Lugar definido", ok: !!cleanSpaces(payload.location || "") },
      { key: "schedule", label: hasDateRecord ? `Fecha conectada: ${firstEventDateText() || "configurada"}` : "Horario visible definido", ok: hasDateRecord || !!cleanSpaces(payload.time_range || "") },
      { key: "seats", label: hasDateRecord ? "Cupos configurados" : "Fecha/cupos en módulo Fechas pendiente", ok: hasDateRecord && seatsOk },
      { key: "desktop", label: "Banner desktop asignado", ok: !!desktop },
      { key: "mobile", label: "Banner mobile asignado", ok: !!mobile },
    ];

    const missing = checks.filter((x) => !x.ok);
    return {
      ok: missing.length === 0,
      checks,
      missing,
      score: checks.length - missing.length,
      total: checks.length,
    };
  }

  function renderEventReadiness(readiness) {
    const r = readiness || calculateEventReadiness();
    state.lastReadiness = r;

    const badge = $("#eventReadinessBadge");
    const list = $("#eventReadinessList");
    const miniStatus = $("#eventReadinessMiniStatus");
    const miniText = $("#eventReadinessMiniText");

    if (badge) {
      badge.textContent = r.ok ? "Listo para publicar" : `${r.score}/${r.total} listo`;
      badge.dataset.ready = r.ok ? "true" : "false";
    }

    if (miniStatus) {
      miniStatus.textContent = r.ok ? "Listo para publicar" : "Publicación incompleta";
      miniStatus.dataset.ready = r.ok ? "true" : "false";
    }

    if (miniText) {
      miniText.textContent = r.ok
        ? "El evento cumple con los puntos principales."
        : `Faltan ${r.missing.length} punto(s) antes de publicar.`;
    }

    if (list) {
      list.innerHTML = r.checks.map((item) => `
        <li class="${item.ok ? "isOk" : "isMissing"}">
          <span>${item.ok ? "✓" : "!"}</span>
          <strong>${escapeHtml(item.label)}</strong>
        </li>
      `).join("");
    }

    return r;
  }

  function refreshReadinessSoon() {
    try { renderEventReadiness(); } catch (_) {}
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
    refreshReadinessSoon();
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

    // Fechas y medios reales se recargan al abrir el evento.
    // Importante: primero limpiamos estado y luego renderizamos, para no mostrar
    // datos viejos ni dejar labels/resúmenes en blanco de forma inconsistente.
    state.selectedEventMediaMap = {};
    state.selectedEventDates = [];
    $("#evBannerDesktopUrl") && ($("#evBannerDesktopUrl").value = "");
    $("#evBannerMobileUrl") && ($("#evBannerMobileUrl").value = "");
    renderEventDatesSummary();
    setSaveStatus("Sin cambios", "neutral");
    updateEventStatusUi();
    updateEventMediaSummary();
  }

  async function refreshSelectedEventRelations(opts = {}) {
    const id = state.selectedEventId;
    if (!id) return;

    try {
      const [map, dates] = await Promise.all([
        fetchEventSlotUrlsLatest(id).catch((err) => { console.warn("[admin] refresh media", err); return state.selectedEventMediaMap || {}; }),
        fetchEventDatesForEvent(id).catch((err) => { console.warn("[admin] refresh dates", err); return state.selectedEventDates || []; }),
      ]);

      state.selectedEventMediaMap = map || {};
      state.selectedEventDates = dates || [];

      $("#evBannerDesktopUrl") && ($("#evBannerDesktopUrl").value = state.selectedEventMediaMap.desktop_event || "");
      $("#evBannerMobileUrl") && ($("#evBannerMobileUrl").value = state.selectedEventMediaMap.mobile_event || "");

      syncEventFieldsFromDatesIfEmpty();
      renderEventDatesSummary();
      updateEventMediaSummary();
      renderEventReadiness();

      if (!opts.silent) toast("Actualizado", "Se sincronizaron fechas y medios del evento.", 1400);
    } catch (err) {
      console.warn("[admin] refreshSelectedEventRelations", err);
    }
  }

  async function openEvent(eventId) {
    const ev = (state.events || []).find((x) => x.id === eventId);
    if (!ev) return;

    state.selectedEventId = ev.id;
    setEditorVisible(true);
    fillEditor(ev);
    renderEventList();

    await refreshSelectedEventRelations({ silent: true });
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
    $("#evDesc")?.addEventListener("input", () => { setDescCount(); setSaveStatus("Cambios sin guardar", "dirty"); refreshReadinessSoon(); });
    $("#evActive")?.addEventListener("change", () => { updateEventStatusUi(); setSaveStatus("Cambios sin guardar", "dirty"); refreshReadinessSoon(); });
    ["#evTitle", "#evType", "#evMonth", "#evPlace", "#evSchedule", "#evDurationHours", "#evPriceAmount", "#evCurrency", "#evSlug", "#evBadge", "#evAlt"].forEach((sel) => {
      const el = $(sel);
      if (!el) return;
      el.addEventListener("input", () => { setSaveStatus("Cambios sin guardar", "dirty"); refreshReadinessSoon(); });
      el.addEventListener("change", () => { setSaveStatus("Cambios sin guardar", "dirty"); refreshReadinessSoon(); });
    });
    $("#validateEventBtn")?.addEventListener("click", () => {
      const r = renderEventReadiness();
      toast(r.ok ? "Validación OK" : "Faltan datos", r.ok ? "El evento está listo para publicarse." : `Faltan ${r.missing.length} punto(s) para publicar.`, 2600);
    });
    $("#evBannerDesktopBtn")?.addEventListener("click", () => setTab("media"));
    $("#evBannerMobileBtn")?.addEventListener("click", () => setTab("media"));
    $("#eventManageDatesBtn")?.addEventListener("click", () => setTab("dates"));

    // Sincronización entre módulos: si Fechas o Medios cambian el evento actual,
    // refrescamos el resumen/labels/checklist sin obligar a recargar la página.
    const onRelatedChange = (e) => {
      const detail = e?.detail || {};
      if (!state.selectedEventId) return;
      if (detail.scope && detail.scope !== "event") return;
      if (detail.eventId && String(detail.eventId) !== String(state.selectedEventId)) return;
      if (detail.scope_id && String(detail.scope_id) !== String(state.selectedEventId)) return;
      refreshSelectedEventRelations({ silent: true });
    };
    window.addEventListener("admin:dates:changed", onRelatedChange);
    document.addEventListener("admin:dates:changed", onRelatedChange);
    window.addEventListener("admin:media:changed", onRelatedChange);
    document.addEventListener("admin:media:changed", onRelatedChange);

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
        const payload = readEditorPayload();
        const readiness = renderEventReadiness(calculateEventReadiness(payload));
        if (payload.active && !readiness.ok) {
          toast("No se puede publicar", `Faltan ${readiness.missing.length} punto(s) del checklist. Guardá como borrador o completá los datos.`, 5200);
          return;
        }
        setSaveStatus("Guardando…", "saving");
        toast("Guardando", "Actualizando evento…", 900);
        const updated = await updateEvent(id, payload);
        state.events = state.events.map((x) => (x.id === id ? updated : x));
        state.selectedEventId = id;
        renderEventList();
        await openEvent(id);
        setSaveStatus("Sincronizado", "saved");
        toast("Guardado", payload.active ? "Evento publicado y actualizado." : "Evento guardado como borrador/actualizado.", 1800);
      } catch (err) {
        console.warn(err);
        setSaveStatus("Error al guardar", "error");
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
