/* js/admin.js ✅ PRO (SUPABASE CRUD EVENTS) — FIX 2026-01
 * - NO maneja login/sesión/logout (eso va en admin-auth.js)
 * - Requiere: Supabase CDN + supabaseClient.js (APP.supabase o APP.sb) antes
 * - Página: admin.html (#appPanel)
 *
 * Schema real events:
 *  id, title, type, month_key, "desc", img, location, time_range, duration_hours, created_at, updated_at
 *
 * Notas:
 * - "desc" se maneja como ev["desc"] (y payload: { desc: ... })
 * - evDuration es SOLO UI (no existe en DB)
 */
"use strict";

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

// Toast unificado (si existe window.toast, lo reutilizamos)
function toast(title, msg, timeoutMs = 3600) {
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

function setBusy(on, msg) {
  const note = $("#storageNote");
  if (!note) return;
  if (!on && msg == null) return;
  note.textContent = on ? (msg || "Procesando…") : (msg || "");
}

// ============================================================
// Utils
// ============================================================
function cleanSpaces(s) {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

const MONTHS = [
  "ENERO","FEBRERO","MARZO","ABRIL",
  "MAYO","JUNIO","JULIO","AGOSTO",
  "SEPTIEMBRE","OCTUBRE","NOVIEMBRE","DICIEMBRE"
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
// Supabase helpers
// ============================================================
function getSB() {
  if (!window.APP) return null;
  return window.APP.supabase || window.APP.sb || null;
}

async function ensureSession() {
  const sb = getSB();
  if (!sb) return null;
  try {
    const res = await sb.auth.getSession();
    return res?.data?.session || null;
  } catch (_) {
    return null;
  }
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

// ============================================================
// DB mapping (events) — ALINEADO A TU SCHEMA REAL
// ============================================================
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
// Tabs
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
    .select(SELECT_EVENTS)
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

  // Auto-select: si no hay activo, agarramos el primero
  if (!state.activeEventId && state.events.length) {
    state.activeEventId = state.events[0].id;
  }
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

// ============================================================
// Render: Events list + editor
// ============================================================
function setEditorVisible(show) {
  $("#editorEmpty") && ($("#editorEmpty").hidden = show);
  $("#eventForm") && ($("#eventForm").hidden = !show);
}

function clearEditorForm() {
  const ids = [
    "evTitle","evType","evMonth","evImg","evDesc",
    "evLocation","evTimeRange","evDurationHours","evDuration"
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
  const q = (state.query || "").trim().toLowerCase();
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
          <p class="itemMeta">Faltan policies para que el admin pueda leer/crear/editar eventos.</p>
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
  const ev =
    (state.events || []).find((e) => String(e.id) === String(state.activeEventId)) || null;

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

  const d = ev["desc"] || "";
  $("#evDesc") && ($("#evDesc").value = d);
  $("#descCount") && ($("#descCount").textContent = String(String(d).length));

  $("#evLocation") && ($("#evLocation").value = ev.location || "");
  $("#evTimeRange") && ($("#evTimeRange").value = ev.time_range || "");
  $("#evDurationHours") && ($("#evDurationHours").value = ev.duration_hours || "");

  // UI only
  const durInput = $("#evDuration");
  if (durInput) {
    const label = buildDurationLabel(ev.time_range || "", ev.duration_hours || "");
    durInput.value = label === "Por confirmar" ? "" : label;
  }

  // Hint para fechas (event_dates se gestiona en admin-dates.js)
  const datesList = $("#datesList");
  if (datesList) {
    datesList.innerHTML = `
      <div class="notice">
        <span class="badge">Fechas</span>
        <span>Las fechas/cupos se gestionan en <strong>“Fechas”</strong> (tabla <code>event_dates</code>).</span>
      </div>
    `;
  }

  $("#soldNotice") && ($("#soldNotice").hidden = true);
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

    // opcional: sesión
    const s = await ensureSession();
    if (!s) {
      toast("Sesión", "No hay sesión activa. Iniciá sesión en el panel Admin.", 4200);
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
      toast("RLS", "Acceso bloqueado. Falta policy de INSERT para events.", 5200);
    } else {
      toast("Error", prettyError(err), 5200);
    }
  } finally {
    setBusy(false, "");
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

    const s = await ensureSession();
    if (!s) {
      toast("Sesión", "No hay sesión activa. Iniciá sesión en el panel Admin.", 4200);
      return;
    }

    setBusy(true, "Duplicando evento…");

    const payload = {
      title: `${ev.title || "Evento"} (Copia)`,
      type: ev.type || "Cata de vino",
      month_key: normalizeMonth(ev.month_key || "ENERO"),
      img: ev.img || "./assets/img/hero-1.jpg",
      desc: ev["desc"] || "",
      location: ev.location || "",
      time_range: ev.time_range || "",
      duration_hours: ev.duration_hours || "",
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
      toast("RLS", "Acceso bloqueado. Falta policy de INSERT para events.", 5200);
    } else {
      toast("Error", prettyError(err), 5200);
    }
  } finally {
    setBusy(false, "");
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

    const s = await ensureSession();
    if (!s) {
      toast("Sesión", "No hay sesión activa. Iniciá sesión en el panel Admin.", 4200);
      return;
    }

    setBusy(true, "Eliminando evento…");

    await deleteEvent(ev.id);

    state.events = (state.events || []).filter((x) => String(x.id) !== String(ev.id));
    state.activeEventId = state.events[0]?.id || null;

    toast("Evento eliminado", "Se eliminó correctamente.");
    renderAll();
  } catch (err) {
    console.error(err);
    if (isRLSError(err)) {
      state.mode = "blocked";
      toast("RLS", "Acceso bloqueado. Falta policy de DELETE para events.", 5200);
    } else {
      toast("Error", prettyError(err), 5200);
    }
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
  const img = cleanSpaces($("#evImg")?.value || "");
  const desc = cleanSpaces($("#evDesc")?.value || "");

  const location = cleanSpaces($("#evLocation")?.value || "");
  const time_range = normalizeTimeRange($("#evTimeRange")?.value || "");
  const duration_hours = parseHoursNumber($("#evDurationHours")?.value || "");

  if (!title) {
    toast("Falta el nombre", "Ingresá el nombre del evento.");
    return false;
  }

  const payload = {
    title,
    type,
    month_key,
    img: img || "./assets/img/hero-1.jpg",
    desc, // 👈 columna "desc" real
    location: location || "Por confirmar",
    time_range,
    duration_hours,
  };

  try {
    if (state.mode !== "supabase") {
      toast("Bloqueado", "Primero necesitamos habilitar RLS/policies para admin.");
      return false;
    }

    const s = await ensureSession();
    if (!s) {
      toast("Sesión", "No hay sesión activa. Iniciá sesión en el panel Admin.", 4200);
      return false;
    }

    setBusy(true, "Guardando cambios…");

    const updated = await updateEvent(ev.id, payload);

    state.events = (state.events || []).map((x) =>
      String(x.id) === String(updated.id) ? updated : x
    );

    toast("Guardado", "Evento actualizado en Supabase.");
    renderAll();
    return true;
  } catch (err) {
    console.error(err);
    if (isRLSError(err)) {
      state.mode = "blocked";
      toast("RLS", "Acceso bloqueado. Falta policy de UPDATE para events.", 5200);
    } else {
      toast("Error", prettyError(err), 5200);
    }
    return false;
  } finally {
    setBusy(false, "");
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
    // no tocar storageNote aquí: cada tab lo controla
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

  // Auto duration (UI only)
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
    toast("Fechas", "Administrá fechas/cupos en la pestaña “Fechas”.", 1800);
    setTab("dates");
  });

  setTab("events");
}

// ============================================================
// Render
// ============================================================
function renderAll() {
  // Solo esta pestaña controla su render
  if (state.activeTab !== "events") return;

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
    toast("Supabase", "No se pudieron cargar eventos. Revisá RLS/policies.", 5200);
  } finally {
    renderAll();
  }
})();
