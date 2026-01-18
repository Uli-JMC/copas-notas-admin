"use strict";

/**
 * admin.js ✅ PRO 2026 (SUPABASE CRUD EVENTS) — ALINEADO A TU HTML REAL
 *
 * Requiere:
 * - Supabase CDN + ./js/supabaseClient.js (APP.supabase)
 * - admin-auth.js (dispara window event "admin:ready" y setea APP.adminReady=true)
 *
 * HTML (admin.html) IDs usados:
 * - Tabs: .tab + #tab-events
 * - Search: #search
 * - Lista: #eventsList, #eventsEmpty
 * - Form: #eventForm, #eventId (hidden)
 *   Campos: #eventTitle, #eventType, #eventMonthKey, #eventImg, #eventDesc,
 *           #eventLocation, #eventTimeRange, #eventDurationHours, #eventDuration
 *   Botones: #newEventBtn, #deleteEventBtn
 * - Nota: #eventNote
 *
 * Tabla:
 * - public.events (id, title, type, month_key, "desc", img, location, time_range, duration_hours, created_at, updated_at)
 *
 * Nota:
 * - "desc" se lee como ev["desc"] y se escribe como payload.desc
 */

(function () {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // ------------------------------------------------------------
  // Guard: solo corre en admin.html con panel y tab-events
  // ------------------------------------------------------------
  const appPanel = $("#appPanel");
  const tabEvents = $("#tab-events");
  if (!appPanel || !tabEvents) return;

  // ------------------------------------------------------------
  // Admin gate: esperar "admin:ready" para evitar que toque RLS antes
  // ------------------------------------------------------------
  async function waitAdminReady() {
    if (window.APP && window.APP.adminReady) return true;
    return await new Promise((resolve) => {
      const t = setTimeout(() => resolve(false), 8000);
      window.addEventListener(
        "admin:ready",
        () => {
          clearTimeout(t);
          resolve(true);
        },
        { once: true }
      );
    });
  }

  // ------------------------------------------------------------
  // UI helpers
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
    const note = $("#eventNote");
    if (!note) return;
    note.textContent = String(msg || "");
  }

  function cleanSpaces(s) {
    return String(s ?? "").replace(/\s+/g, " ").trim();
  }

  // ------------------------------------------------------------
  // Month helpers (tu schema usa month_key text)
  // ------------------------------------------------------------
  const MONTHS = [
    "ENERO", "FEBRERO", "MARZO", "ABRIL",
    "MAYO", "JUNIO", "JULIO", "AGOSTO",
    "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE",
  ];

  function normalizeMonth(m) {
    const up = cleanSpaces(m).toUpperCase();
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
    if (t && h) return `${t} · ${h} hrs`;
    return t || (h ? `${h} hrs` : "Por confirmar");
  }

  // ------------------------------------------------------------
  // Supabase helpers
  // ------------------------------------------------------------
  function getSB() {
    return window.APP && (window.APP.supabase || window.APP.sb) ? (window.APP.supabase || window.APP.sb) : null;
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
      m.includes("new row violates row-level security")
    );
  }

  function prettyError(err) {
    return String(err?.message || err || "") || "Ocurrió un error.";
  }

  // ------------------------------------------------------------
  // DB mapping
  // ------------------------------------------------------------
  const EVENTS_TABLE = "events";
  const SELECT_EVENTS = `
    id,
    title,
    type,
    month_key,
    "desc",
    img,
    location,
    time_range,
    duration_hours,
    created_at,
    updated_at
  `;

  // ------------------------------------------------------------
  // State
  // ------------------------------------------------------------
  const state = {
    activeTab: "events",
    query: "",
    activeEventId: null,
    events: [],
    mode: "supabase", // supabase | blocked | missing
    busy: false,
    didWire: false,
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
  // Tabs (solo control visual; otros módulos tienen sus propios scripts)
  // ------------------------------------------------------------
  function hideAllTabs() {
    $("#tab-events") && ($("#tab-events").hidden = true);
    $("#tab-dates") && ($("#tab-dates").hidden = true);
    $("#tab-regs") && ($("#tab-regs").hidden = true);
    $("#tab-media") && ($("#tab-media").hidden = true);
    $("#tab-gallery") && ($("#tab-gallery").hidden = true);
    $("#tab-promos") && ($("#tab-promos").hidden = true);
  }

  function setTab(tab) {
    state.activeTab = tab || "events";

    $$(".tab").forEach((t) =>
      t.setAttribute("aria-selected", t.dataset.tab === state.activeTab ? "true" : "false")
    );

    hideAllTabs();

    if (state.activeTab === "events") $("#tab-events") && ($("#tab-events").hidden = false);
    if (state.activeTab === "dates") $("#tab-dates") && ($("#tab-dates").hidden = false);
    if (state.activeTab === "regs") $("#tab-regs") && ($("#tab-regs").hidden = false);
    if (state.activeTab === "media") $("#tab-media") && ($("#tab-media").hidden = false);
    if (state.activeTab === "gallery") $("#tab-gallery") && ($("#tab-gallery").hidden = false);
    if (state.activeTab === "promos") $("#tab-promos") && ($("#tab-promos").hidden = false);

    renderAll();
  }

  // ------------------------------------------------------------
  // Supabase CRUD
  // ------------------------------------------------------------
  async function fetchEvents() {
    const sb = getSB();
    if (!sb) {
      state.mode = "missing";
      state.events = [];
      return;
    }

    setNote("Cargando eventos…");

    const { data, error } = await sb
      .from(EVENTS_TABLE)
      .select(SELECT_EVENTS)
      .order("created_at", { ascending: false });

    if (error) {
      state.events = [];
      state.mode = isRLSError(error) ? "blocked" : "supabase";
      setNote(isRLSError(error) ? "⚠️ RLS bloquea lectura (events)." : "No se pudieron cargar eventos.");
      throw error;
    }

    state.mode = "supabase";
    state.events = Array.isArray(data) ? data : [];
    setNote("");
  }

  async function insertEvent(payload) {
    const sb = getSB();
    if (!sb) throw new Error("APP.supabase no existe (orden de scripts).");

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
    if (!sb) throw new Error("APP.supabase no existe (orden de scripts).");

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
    if (!sb) throw new Error("APP.supabase no existe (orden de scripts).");

    const { error } = await sb.from(EVENTS_TABLE).delete().eq("id", id);
    if (error) throw error;
  }

  // ------------------------------------------------------------
  // Render helpers
  // ------------------------------------------------------------
  function setEditorVisible(show) {
    // Tu HTML NO tiene #editorEmpty; maneja el form directamente
    const form = $("#eventForm");
    if (form) form.hidden = !show;
  }

  function clearEditorForm() {
    const ids = [
      "eventId",
      "eventTitle",
      "eventType",
      "eventMonthKey",
      "eventImg",
      "eventDesc",
      "eventLocation",
      "eventTimeRange",
      "eventDurationHours",
      "eventDuration",
    ];
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });
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
    const box = $("#eventsList");
    const empty = $("#eventsEmpty");
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
      if (empty) empty.hidden = true;
      return;
    }

    if (state.mode === "blocked") {
      box.innerHTML = `
        <div class="item" style="cursor:default;">
          <div>
            <p class="itemTitle">Acceso bloqueado por RLS</p>
            <p class="itemMeta">Faltan policies para leer/crear/editar eventos.</p>
          </div>
        </div>`;
      if (empty) empty.hidden = true;
      return;
    }

    if (!filtered.length) {
      box.innerHTML = "";
      if (empty) empty.hidden = false;
      return;
    }

    if (empty) empty.hidden = true;
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
        <div class="pills"><span class="pill">${String(ev.id) === String(state.activeEventId) ? "ACTIVO" : "EDITAR"}</span></div>
      `;

      item.addEventListener("click", () => {
        state.activeEventId = ev.id;
        renderAll();
      });

      box.appendChild(item);
    });
  }

  function renderEventEditor() {
    const ev = (state.events || []).find((e) => String(e.id) === String(state.activeEventId)) || null;

    if (!ev) {
      clearEditorForm();
      setEditorVisible(false);
      return;
    }

    setEditorVisible(true);

    $("#eventId") && ($("#eventId").value = ev.id || "");
    $("#eventTitle") && ($("#eventTitle").value = ev.title || "");
    $("#eventType") && ($("#eventType").value = ev.type || "vino");
    $("#eventMonthKey") && ($("#eventMonthKey").value = ev.month_key || "");
    $("#eventImg") && ($("#eventImg").value = ev.img || "");

    const d = ev["desc"] || "";
    $("#eventDesc") && ($("#eventDesc").value = d);

    $("#eventLocation") && ($("#eventLocation").value = ev.location || "");
    $("#eventTimeRange") && ($("#eventTimeRange").value = ev.time_range || "");
    $("#eventDurationHours") && ($("#eventDurationHours").value = ev.duration_hours || "");

    const dur = $("#eventDuration");
    if (dur) {
      const label = buildDurationLabel(ev.time_range || "", ev.duration_hours || "");
      dur.value = label === "Por confirmar" ? "" : label;
    }
  }

  function renderAll() {
    // Pull search
    const s = $("#search");
    state.query = s ? String(s.value || "") : state.query;

    if (state.activeTab === "events") {
      renderEventList();
      renderEventEditor();
    }
  }

  // ------------------------------------------------------------
  // Actions
  // ------------------------------------------------------------
  const actionCreateNewEvent = withLock(async function () {
    if (state.mode !== "supabase") {
      toast("Bloqueado", "Primero habilitá RLS/policies para admin.");
      return;
    }

    try {
      setNote("Creando evento…");

      const payload = {
        title: "Nuevo evento",
        type: "vino",                // ✅ alineado al select del HTML
        month_key: "ENERO",
        img: "",
        desc: "",
        location: "",
        time_range: "",
        duration_hours: "",
      };

      const created = await insertEvent(payload);
      state.events.unshift(created);
      state.activeEventId = created.id;

      toast("Evento creado", "Ya podés editarlo y guardar.", 1800);
      setNote("");
      renderAll();
    } catch (err) {
      console.error(err);
      if (isRLSError(err)) {
        state.mode = "blocked";
        setNote("⚠️ RLS bloquea INSERT (events).");
        toast("RLS", "Falta policy INSERT para tabla events.", 4200);
      } else {
        setNote("Error creando evento.");
        toast("Error", prettyError(err), 4200);
      }
    }
  });

  const actionDeleteActiveEvent = withLock(async function () {
    const ev = (state.events || []).find((e) => String(e.id) === String(state.activeEventId));
    if (!ev) return toast("Eliminar", "Seleccioná un evento primero.");

    const ok = window.confirm(`Eliminar evento:\n\n${ev.title}\n\nEsta acción no se puede deshacer.`);
    if (!ok) return;

    try {
      setNote("Eliminando evento…");
      await deleteEvent(ev.id);

      state.events = (state.events || []).filter((x) => String(x.id) !== String(ev.id));
      state.activeEventId = state.events.length ? state.events[0].id : null;

      toast("Evento eliminado", "Se eliminó correctamente.", 1600);
      setNote("");
      renderAll();
    } catch (err) {
      console.error(err);
      if (isRLSError(err)) {
        state.mode = "blocked";
        setNote("⚠️ RLS bloquea DELETE (events).");
        toast("RLS", "Falta policy DELETE para tabla events.", 4200);
      } else {
        setNote("Error eliminando evento.");
        toast("Error", prettyError(err), 4200);
      }
    }
  });

  const actionSaveActiveEvent = withLock(async function () {
    const ev = (state.events || []).find((e) => String(e.id) === String(state.activeEventId));
    if (!ev) return;

    const title = cleanSpaces($("#eventTitle")?.value || "");
    const type = cleanSpaces($("#eventType")?.value || "vino");
    const month_key = normalizeMonth($("#eventMonthKey")?.value || "ENERO");
    const img = cleanSpaces($("#eventImg")?.value || "");
    const desc = cleanSpaces($("#eventDesc")?.value || "");

    const location = cleanSpaces($("#eventLocation")?.value || "");
    const time_range = normalizeTimeRange($("#eventTimeRange")?.value || "");
    const duration_hours = parseHoursNumber($("#eventDurationHours")?.value || "");

    if (!title) {
      toast("Falta título", "Ingresá el título del evento.", 2800);
      return;
    }

    const payload = {
      title,
      type,
      month_key,
      img,
      desc,
      location,
      time_range,
      duration_hours,
    };

    try {
      setNote("Guardando cambios…");
      const updated = await updateEvent(ev.id, payload);

      state.events = (state.events || []).map((x) => (String(x.id) === String(updated.id) ? updated : x));

      toast("Guardado", "Evento actualizado en Supabase.", 1400);
      setNote("");
      renderAll();
    } catch (err) {
      console.error(err);
      if (isRLSError(err)) {
        state.mode = "blocked";
        setNote("⚠️ RLS bloquea UPDATE (events).");
        toast("RLS", "Falta policy UPDATE para tabla events.", 4200);
      } else {
        setNote("Error guardando.");
        toast("Error", prettyError(err), 4200);
      }
    }
  });

  // ------------------------------------------------------------
  // Wiring
  // ------------------------------------------------------------
  function wireOnce() {
    if (state.didWire) return;
    state.didWire = true;

    // Tabs
    $$(".tab").forEach((t) => {
      t.addEventListener("click", () => setTab(t.dataset.tab));
    });

    // Search
    $("#search")?.addEventListener("input", () => renderAll());

    // Buttons
    $("#newEventBtn")?.addEventListener("click", actionCreateNewEvent);
    $("#deleteEventBtn")?.addEventListener("click", actionDeleteActiveEvent);

    // Form submit
    $("#eventForm")?.addEventListener("submit", (e) => {
      e.preventDefault();
      actionSaveActiveEvent();
    });

    // Auto duration (solo UI)
    const durInput = $("#eventDuration");
    const timeInput = $("#eventTimeRange");
    const hoursInput = $("#eventDurationHours");

    function autoFillDurationIfEmpty() {
      if (!durInput) return;
      const manual = cleanSpaces(durInput.value || "");
      if (manual) return;
      const label = buildDurationLabel(timeInput?.value || "", hoursInput?.value || "");
      durInput.value = label === "Por confirmar" ? "" : label;
    }

    timeInput?.addEventListener("input", autoFillDurationIfEmpty);
    hoursInput?.addEventListener("input", autoFillDurationIfEmpty);

    // Default tab
    setTab("events");
  }

  // ------------------------------------------------------------
  // Init
  // ------------------------------------------------------------
  (async function init() {
    wireOnce();

    // ✅ esperar gate admin (evita que módulos queden “muertos” sin refresh)
    const ok = await waitAdminReady();
    if (!ok) {
      // si no es admin o gate no pasó, admin-auth redirige; acá solo evitamos ruido
      return;
    }

    try {
      await fetchEvents();

      // Selección inicial
      if (!state.activeEventId && state.events.length) state.activeEventId = state.events[0].id;

      renderAll();
    } catch (err) {
      console.error(err);
      toast("Supabase", "No se pudieron cargar eventos. Revisá RLS/policies.", 4200);
      renderAll();
    }
  })();
})();
