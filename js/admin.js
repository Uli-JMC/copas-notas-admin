"use strict";

/**
 * admin.js (PRO: SUPABASE CRUD EVENTS)
 * - NO maneja login/sesión/logout (eso va en admin-auth.js)
 * - Requiere: supabaseClient.js (APP.supabase) cargado antes
 * - Página: admin.html (#appPanel)
 *
 * Meta fase 1:
 * ✅ CRUD real de events contra Supabase (tabla: events)
 * ⏳ event_dates / registrations / media / promos / gallery quedan para siguientes archivos
 *
 * Nota:
 * - Este archivo NO depende de data.js/ECN.
 * - Si RLS bloquea, muestra mensajes claros.
 */

// ============================================================
// Selectores
// ============================================================
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// ============================================================
// UI helpers
// ============================================================
function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toast(title, msg, timeoutMs = 3600) {
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

function setBusy(on, msg) {
  const note = $("#storageNote");
  if (!note) return;
  if (!on && msg == null) return;
  note.textContent = on ? (msg || "Procesando…") : (msg || note.textContent || "");
}

// ============================================================
// Utils
// ============================================================
function cleanSpaces(s) {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

const MONTHS = [
  "ENERO", "FEBRERO", "MARZO", "ABRIL",
  "MAYO", "JUNIO", "JULIO", "AGOSTO",
  "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"
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
  if (!Number.isFinite(n) || n <= 0) return "";
  return String(n);
}

function humanizeDurationFromHours(hoursStr) {
  const h = parseHoursNumber(hoursStr);
  if (!h) return "";
  return `${h} hrs`;
}

function normalizeTimeRange(s) {
  return cleanSpaces(s);
}

function buildDurationLabel(timeRange, durationHours) {
  const t = normalizeTimeRange(timeRange);
  const d = humanizeDurationFromHours(durationHours);
  if (t && d) return `${t} · ${d}`;
  return t || d || "Por confirmar";
}

// ============================================================
// Supabase guard
// ============================================================
function getSB() {
  if (window.APP && window.APP.supabase) return window.APP.supabase;
  return null;
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
  const msg = String(err?.message || err || "");
  if (!msg) return "Ocurrió un error.";
  return msg;
}

// ============================================================
// DB mapping (events)
// ============================================================
const EVENTS_TABLE = "events";
const EVENTS_SELECT = `
  id,
  title,
  type,
  month_key,
  img,
  desc,
  location,
  time_range,
  duration_hours,
  duration,
  created_at
`;

// ============================================================
// State
// ============================================================
let state = {
  activeTab: "events",
  query: "",
  activeEventId: null,
  events: [],
  mode: "supabase", // supabase | blocked | missing
  busy: false,
};

// ============================================================
// Tabs (solo control visual; otros módulos vendrán luego)
// ============================================================
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

// ============================================================
// Supabase: CRUD events
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
    .select(EVENTS_SELECT)
    .order("created_at", { ascending: false });

  if (error) {
    state.events = [];
    state.mode = isRLSError(error) ? "blocked" : "supabase";
    setBusy(false, "No se pudieron cargar eventos (revisá RLS/policies).");
    throw error;
  }

  state.mode = "supabase";
  state.events = Array.isArray(data) ? data : [];
  setBusy(false, "");
}

async function insertEvent(payload) {
  const sb = getSB();
  if (!sb) throw new Error("APP.supabase no existe (orden de scripts).");

  const { data, error } = await sb
    .from(EVENTS_TABLE)
    .insert(payload)
    .select(EVENTS_SELECT)
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
    .select(EVENTS_SELECT)
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

// ============================================================
// Render: Events list + editor
// ============================================================
function setEditorVisible(show) {
  $("#editorEmpty") && ($("#editorEmpty").hidden = show);
  $("#eventForm") && ($("#eventForm").hidden = !show);
}

function clearEditorForm() {
  const ids = [
    "evTitle", "evType", "evMonth", "evImg", "evDesc",
    "evLocation", "evTimeRange", "evDurationHours", "evDuration"
  ];
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  $("#descCount") && ($("#descCount").textContent = "0");
  const datesList = $("#datesList");
  if (datesList) datesList.innerHTML = "";
  $("#soldNotice") && ($("#soldNotice").hidden = true);
}

function getFilteredEvents() {
  const q = state.query.trim().toLowerCase();
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
          <p class="itemMeta">Necesitamos policies para que el admin pueda leer/crear/editar eventos.</p>
        </div>
      </div>`;
    return;
  }

  if (!filtered.length) {
    box.innerHTML = `
      <div class="item" style="cursor:default;">
        <div>
          <p class="itemTitle">Sin eventos</p>
          <p class="itemMeta">Creá el primer evento con “+ Nuevo evento”.</p>
        </div>
      </div>`;
    return;
  }

  box.innerHTML = "";

  filtered.forEach((ev) => {
    const item = document.createElement("div");
    item.className = "item";
    if (state.activeEventId && String(ev.id) === String(state.activeEventId)) {
      item.classList.add("active");
    }

    item.innerHTML = `
      <div>
        <p class="itemTitle">${escapeHtml(ev.title || "—")}</p>
        <p class="itemMeta">${escapeHtml(ev.type || "—")} • ${escapeHtml(ev.month_key || "—")}</p>
      </div>
      <div class="pills">
        <span class="pill">SUPABASE</span>
      </div>
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

  $("#evTitle") && ($("#evTitle").value = ev.title || "");
  $("#evType") && ($("#evType").value = ev.type || "Cata de vino");
  $("#evMonth") && ($("#evMonth").value = normalizeMonth(ev.month_key));
  $("#evImg") && ($("#evImg").value = ev.img || "");
  $("#evDesc") && ($("#evDesc").value = ev.desc || "");
  $("#descCount") && ($("#descCount").textContent = String((ev.desc || "").length));

  $("#evLocation") && ($("#evLocation").value = ev.location || "");
  $("#evTimeRange") && ($("#evTimeRange").value = ev.time_range || "");
  $("#evDurationHours") && ($("#evDurationHours").value = ev.duration_hours || "");

  if ($("#evDuration")) {
    const label =
      cleanSpaces(ev.duration || "") ||
      buildDurationLabel(ev.time_range || "", ev.duration_hours || "");
    $("#evDuration").value = label === "Por confirmar" ? "" : label;
  }

  // Fechas se conectan en admin-dates.js (event_dates)
  const datesList = $("#datesList");
  if (datesList) {
    datesList.innerHTML = `
      <div class="notice">
        <span class="badge">Fechas</span>
        <span>
          Las fechas/cupos se gestionan en la sección <strong>“Fechas”</strong> usando la tabla <code>event_dates</code>.
        </span>
      </div>
    `;
  }
  $("#soldNotice") && ($("#soldNotice").hidden = true);
}

// ============================================================
// Busy lock
// ============================================================
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
// Actions: Events (Supabase)
// ============================================================
const createNewEvent = withLock(async function () {
  try {
    if (state.mode !== "supabase") {
      toast("Bloqueado", "Primero necesitamos habilitar RLS/policies para admin.");
      return;
    }

    setBusy(true, "Creando evento…");

    const payload = {
      title: "Nuevo evento",
      type: "Cata de vino",
      month_key: "ENERO",
      img: "./assets/img/hero-1.jpg",
      desc: "",
      location: "Por confirmar",
      time_range: "",
      duration_hours: "",
      duration: "Por confirmar",
    };

    const created = await insertEvent(payload);

    state.events.unshift(created);
    state.activeEventId = created.id;

    toast("Evento creado", "Ya podés editarlo y guardarlo.");
    renderAll();
  } catch (err) {
    console.error(err);
    if (isRLSError(err)) {
      state.mode = "blocked";
      toast("RLS", "Acceso bloqueado. Falta policy de INSERT para admin.");
    } else {
      toast("Error", prettyError(err));
    }
  } finally {
    setBusy(false, null);
  }
});

const duplicateActiveEvent = withLock(async function () {
  const ev = (state.events || []).find((e) => String(e.id) === String(state.activeEventId));
  if (!ev) {
    toast("Seleccioná un evento", "Abrí un evento para poder duplicarlo.");
    return;
  }

  try {
    if (state.mode !== "supabase") {
      toast("Bloqueado", "Primero necesitamos habilitar RLS/policies para admin.");
      return;
    }

    setBusy(true, "Duplicando evento…");

    const payload = {
      title: `${ev.title || "Evento"} (Copia)`,
      type: ev.type || "Cata de vino",
      month_key: normalizeMonth(ev.month_key || "ENERO"),
      img: ev.img || "./assets/img/hero-1.jpg",
      desc: ev.desc || "",
      location: ev.location || "",
      time_range: ev.time_range || "",
      duration_hours: ev.duration_hours || "",
      duration: cleanSpaces(ev.duration || "") || buildDurationLabel(ev.time_range || "", ev.duration_hours || ""),
    };

    const created = await insertEvent(payload);
    state.events.unshift(created);
    state.activeEventId = created.id;

    toast("Evento duplicado", "Se creó una copia para editar rápidamente.");
    renderAll();
  } catch (err) {
    console.error(err);
    if (isRLSError(err)) {
      state.mode = "blocked";
      toast("RLS", "Acceso bloqueado. Falta policy de INSERT para admin.");
    } else {
      toast("Error", prettyError(err));
    }
  } finally {
    setBusy(false, null);
  }
});

const deleteActiveEvent = withLock(async function () {
  const ev = (state.events || []).find((e) => String(e.id) === String(state.activeEventId));
  if (!ev) return;

  const ok = confirm(`Eliminar evento:\n\n${ev.title}\n\nEsta acción no se puede deshacer.`);
  if (!ok) return;

  try {
    if (state.mode !== "supabase") {
      toast("Bloqueado", "Primero necesitamos habilitar RLS/policies para admin.");
      return;
    }

    setBusy(true, "Eliminando evento…");

    await deleteEvent(ev.id);

    state.events = (state.events || []).filter((x) => String(x.id) !== String(ev.id));
    state.activeEventId = null;

    toast("Evento eliminado", "Se eliminó correctamente.");
    renderAll();
  } catch (err) {
    console.error(err);
    if (isRLSError(err)) {
      state.mode = "blocked";
      toast("RLS", "Acceso bloqueado. Falta policy de DELETE para admin.");
    } else {
      toast("Error", prettyError(err));
    }
  } finally {
    setBusy(false, null);
  }
});

const saveActiveEvent = withLock(async function () {
  const ev = (state.events || []).find((e) => String(e.id) === String(state.activeEventId));
  if (!ev) return false;

  const title = cleanSpaces($("#evTitle")?.value || "");
  const type = cleanSpaces($("#evType")?.value || "Cata de vino");
  const month_key = normalizeMonth($("#evMonth")?.value || "ENERO");
  const img = cleanSpaces($("#evImg")?.value || "");
  const desc = cleanSpaces($("#evDesc")?.value || "");

  const location = cleanSpaces($("#evLocation")?.value || "");
  const time_range = normalizeTimeRange($("#evTimeRange")?.value || "");
  const duration_hours = parseHoursNumber($("#evDurationHours")?.value || "");
  const durationManual = cleanSpaces($("#evDuration")?.value || "");

  if (!title) {
    toast("Falta el nombre", "Ingresá el nombre del evento.");
    return false;
  }

  const duration = durationManual || buildDurationLabel(time_range, duration_hours);

  const payload = {
    title,
    type,
    month_key,
    img: img || "./assets/img/hero-1.jpg",
    desc,
    location: location || "Por confirmar",
    time_range,
    duration_hours,
    duration,
  };

  try {
    if (state.mode !== "supabase") {
      toast("Bloqueado", "Primero necesitamos habilitar RLS/policies para admin.");
      return false;
    }

    setBusy(true, "Guardando cambios…");

    const updated = await updateEvent(ev.id, payload);

    state.events = (state.events || []).map((x) => (String(x.id) === String(updated.id) ? updated : x));

    toast("Guardado", "Evento actualizado en Supabase.");
    renderAll();
    return true;
  } catch (err) {
    console.error(err);
    if (isRLSError(err)) {
      state.mode = "blocked";
      toast("RLS", "Acceso bloqueado. Falta policy de UPDATE para admin.");
    } else {
      toast("Error", prettyError(err));
    }
    return false;
  } finally {
    setBusy(false, null);
  }
});

// ============================================================
// Wiring
// ============================================================
function wire() {
  // Tabs
  $$(".tab").forEach((t) => t.addEventListener("click", () => setTab(t.dataset.tab)));

  // Search
  $("#search")?.addEventListener("input", (e) => {
    state.query = e.target.value || "";
    renderAll();
  });

  // Events buttons
  $("#newEventBtn")?.addEventListener("click", createNewEvent);
  $("#dupEventBtn")?.addEventListener("click", duplicateActiveEvent);
  $("#deleteEventBtn")?.addEventListener("click", deleteActiveEvent);

  // Desc counter
  $("#evDesc")?.addEventListener("input", () => {
    const v = $("#evDesc")?.value || "";
    $("#descCount") && ($("#descCount").textContent = String(v.length));
  });

  // Auto duration if empty (no pisa manual)
  const durInput = $("#evDuration");
  const timeInput = $("#evTimeRange");
  const hoursInput = $("#evDurationHours");

  function autoFillDurationIfEmpty() {
    if (!durInput) return;
    const manual = cleanSpaces(durInput.value || "");
    if (manual) return;
    const t = normalizeTimeRange(timeInput?.value || "");
    const h = parseHoursNumber(hoursInput?.value || "");
    const label = buildDurationLabel(t, h);
    durInput.value = label === "Por confirmar" ? "" : label;
  }

  timeInput?.addEventListener("input", autoFillDurationIfEmpty);
  hoursInput?.addEventListener("input", autoFillDurationIfEmpty);

  // Form submit
  $("#eventForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    saveActiveEvent();
  });

  // Ir a fechas
  $("#addDateBtn")?.addEventListener("click", () => {
    toast("Fechas", "Ahora pasamos a conectar event_dates en la sección “Fechas”.", 2200);
    setTab("dates");
  });

  // Default tab
  setTab("events");
}

// ============================================================
// Render all
// ============================================================
function renderAll() {
  // SOLO events acá
  if (state.activeTab === "events") {
    renderEventList();
    renderEventEditor();

    const note = $("#storageNote");
    if (note) {
      if (state.mode === "supabase") {
        note.textContent = "✅ Eventos guardan en Supabase (CRUD real).";
      } else if (state.mode === "blocked") {
        note.textContent = "⚠️ Supabase conectado, pero RLS bloquea. Faltan policies para events.";
      } else {
        note.textContent = "⚠️ Falta Supabase Client. Revisá el orden de scripts.";
      }
    }
  }
}

// ============================================================
// Init
// ============================================================
(async function init() {
  if (!$("#appPanel")) return;

  wire();

  try {
    await fetchEvents();
  } catch (err) {
    console.error(err);
    toast("Supabase", "No se pudieron cargar eventos. Revisá policies/RLS.");
  } finally {
    renderAll();
  }
})();
