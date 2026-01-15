"use strict";

/**
 * admin.js (DEPURADO: SOLO MÓDULO ADMIN)
 * - NO maneja login / sesión / logout (eso va en admin-auth.js)
 * - Requiere: data.js (ECN) cargado antes
 * - Página esperada: admin.html (debe existir #appPanel)
 *
 * ✅ UPDATE 1:1 (Punto: nuevos campos de evento)
 * - Admin ahora guarda y carga:
 *   - location (Lugar / dirección)
 *   - timeRange (Hora: "9–10 am" / "9-10 am")
 *   - durationHours (Duración horas: "3" -> "3 hrs")
 *   - duration (Horario/Resumen visible en event.html)
 */

// ============================================================
// Helpers
// ============================================================
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

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
  el.querySelector(".close")?.addEventListener("click", kill);
  setTimeout(kill, timeoutMs);
}

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}
function writeJSON(key, val) {
  localStorage.setItem(key, JSON.stringify(val));
}

function uid(prefix = "ev") {
  return `${prefix}_${Math.random().toString(16).slice(2, 10)}${Date.now()
    .toString(16)
    .slice(-4)}`;
}

function normalizeMonth(m) {
  return String(m || "").trim().toUpperCase();
}

// ✅ helpers nuevos (campos)
function cleanSpaces(s) {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}
function parseHoursNumber(input) {
  const raw = cleanSpaces(input);
  if (!raw) return "";
  // acepta: "3", "3hrs", "3 hrs", "3.5", "2,5"
  const m = raw.replace(",", ".").match(/(\d+(\.\d+)?)/);
  if (!m) return "";
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return "";
  // si es entero, sin decimales
  return Number.isInteger(n) ? String(n) : String(n);
}
function humanizeDurationFromHours(hoursStr) {
  const h = parseHoursNumber(hoursStr);
  if (!h) return "";
  return `${h} hrs`;
}
function normalizeTimeRange(s) {
  // no forzamos formato; solo limpiamos espacios
  return cleanSpaces(s);
}
function buildDurationLabel(timeRange, durationHours) {
  const t = normalizeTimeRange(timeRange);
  const d = humanizeDurationFromHours(durationHours);
  if (t && d) return `${t} · ${d}`;
  return t || d || "Por confirmar";
}

// ============================================================
// ECN guard
// ============================================================
function requireECN() {
  if (!window.ECN || !ECN.LS) {
    console.error("ECN (data.js) no está cargado antes de admin.js");
    toast("Error", "Falta cargar data.js antes de admin.js");
    return false;
  }
  return true;
}

// ============================================================
// State (RAW para eventos)
// ============================================================
let state = {
  eventsRaw: [], // RAW (dates {label,seats})
  regs: [],
  media: null,
  activeTab: "events",
  activeEventId: null,
  query: "",
};

// ============================================================
// Load/Save (usando API del data.js)
// ============================================================
function loadAll() {
  state.eventsRaw = (ECN.getEventsRaw ? ECN.getEventsRaw() : readJSON(ECN.LS.EVENTS, [])) || [];
  state.media = (ECN.getMedia ? ECN.getMedia() : readJSON(ECN.LS.MEDIA, {})) || {};

  // ✅ regs: fuente única = ECN si existe
  if (typeof ECN.getRegistrations === "function") state.regs = ECN.getRegistrations() || [];
  else if (typeof ECN.getRegs === "function") state.regs = ECN.getRegs() || [];
  else state.regs = readJSON(ECN.LS.REGS, []) || [];

  if (!Array.isArray(state.regs)) state.regs = [];
}

function saveEventsRaw() {
  // Si existe setEventsRaw, úsalo; si no, LS directo
  if (ECN.setEventsRaw) state.eventsRaw = ECN.setEventsRaw(state.eventsRaw);
  else writeJSON(ECN.LS.EVENTS, state.eventsRaw);
}

function saveRegsWhole(nextRegs) {
  state.regs = Array.isArray(nextRegs) ? nextRegs : [];
  writeJSON(ECN.LS.REGS, state.regs);
}

function saveMedia(nextMedia) {
  // ECN.setMedia ya escribe
  state.media = ECN.setMedia ? ECN.setMedia(nextMedia) : nextMedia;
  if (!ECN.setMedia) writeJSON(ECN.LS.MEDIA, state.media);
}

// ============================================================
// UI: logo dinámico en topbar
// ============================================================
function syncAdminLogo() {
  try {
    const img = $("#adminLogo");
    if (!img) return;
    const m = state.media || {};
    if (m.logoPath) img.src = m.logoPath;
  } catch (_) {}
}

// ============================================================
// Tabs
// ============================================================
function hideAllTabs() {
  $("#tab-events") && ($("#tab-events").hidden = true);
  $("#tab-regs") && ($("#tab-regs").hidden = true);
  $("#tab-media") && ($("#tab-media").hidden = true);
  $("#tab-gallery") && ($("#tab-gallery").hidden = true);

  // ✅ listo para futuro: promos
  $("#tab-promos") && ($("#tab-promos").hidden = true);
}

function setTab(tab) {
  state.activeTab = tab;

  $$(".tab").forEach((t) =>
    t.setAttribute("aria-selected", t.dataset.tab === tab ? "true" : "false")
  );

  hideAllTabs();

  if (tab === "events") $("#tab-events") && ($("#tab-events").hidden = false);
  if (tab === "regs") $("#tab-regs") && ($("#tab-regs").hidden = false);
  if (tab === "media") $("#tab-media") && ($("#tab-media").hidden = false);
  if (tab === "gallery") $("#tab-gallery") && ($("#tab-gallery").hidden = false);

  // ✅ listo para futuro: promos
  if (tab === "promos") $("#tab-promos") && ($("#tab-promos").hidden = false);

  renderAll();
}

// ============================================================
// Seats (RAW)
// ============================================================
function sumSeatsRaw(evRaw) {
  if (window.ECN && typeof ECN.totalSeats === "function") return ECN.totalSeats(evRaw);
  return (evRaw?.dates || []).reduce((acc, d) => acc + (Number(d?.seats) || 0), 0);
}

// ============================================================
// Render: Events list + editor
// ============================================================
function renderEventList() {
  const box = $("#eventList");
  if (!box) return;

  const q = state.query.trim().toLowerCase();

  const filtered = state.eventsRaw.filter((ev) => {
    if (!q) return true;
    return (
      (ev.title || "").toLowerCase().includes(q) ||
      (ev.type || "").toLowerCase().includes(q) ||
      (ev.monthKey || "").toLowerCase().includes(q)
    );
  });

  if (filtered.length === 0) {
    box.innerHTML = `<div class="item" style="cursor:default;">
      <div>
        <p class="itemTitle">Sin resultados</p>
        <p class="itemMeta">Probá otra búsqueda.</p>
      </div>
    </div>`;
    return;
  }

  box.innerHTML = "";

  filtered.forEach((evRaw) => {
    const evUI = ECN.flattenEventForUI ? ECN.flattenEventForUI(evRaw) : evRaw;

    const total = sumSeatsRaw(evRaw);
    const soldOut = total <= 0;

    const item = document.createElement("div");
    item.className = "item";
    item.innerHTML = `
      <div>
        <p class="itemTitle">${escapeHtml(evUI.title)}</p>
        <p class="itemMeta">${escapeHtml(evUI.type)} • ${escapeHtml(
      evUI.monthKey
    )} • ${escapeHtml((evRaw.dates || []).length)} fecha(s)</p>
      </div>
      <div class="pills">
        <span class="pill">${soldOut ? "AGOTADO" : `CUPOS ${total}`}</span>
        ${soldOut ? `<span class="pill danger">0</span>` : ``}
      </div>
    `;

    item.addEventListener("click", () => {
      state.activeEventId = evRaw.id;
      renderEventEditor();
    });

    box.appendChild(item);
  });
}

function setEditorVisible(show) {
  $("#editorEmpty") && ($("#editorEmpty").hidden = show);
  $("#eventForm") && ($("#eventForm").hidden = !show);
}

function renderEventEditor() {
  const ev = state.eventsRaw.find((e) => e.id === state.activeEventId) || null;
  if (!ev) {
    setEditorVisible(false);
    return;
  }

  setEditorVisible(true);

  $("#evTitle") && ($("#evTitle").value = ev.title || "");
  $("#evType") && ($("#evType").value = ev.type || "Cata de vino");
  $("#evMonth") && ($("#evMonth").value = normalizeMonth(ev.monthKey) || "ENERO");
  $("#evImg") && ($("#evImg").value = ev.img || "");
  $("#evDesc") && ($("#evDesc").value = ev.desc || "");
  $("#descCount") && ($("#descCount").textContent = String((ev.desc || "").length));

  // ✅ nuevos campos (si existen en el HTML)
  if ($("#evLocation")) $("#evLocation").value = ev.location || "";
  if ($("#evTimeRange")) $("#evTimeRange").value = ev.timeRange || "";
  if ($("#evDurationHours")) $("#evDurationHours").value = ev.durationHours || "";
  if ($("#evDuration")) {
    const label = ev.duration || buildDurationLabel(ev.timeRange || "", ev.durationHours || "");
    $("#evDuration").value = label === "Por confirmar" ? "" : label;
  }

  renderDatesEditor(ev);

  const sold = sumSeatsRaw(ev) <= 0;
  $("#soldNotice") && ($("#soldNotice").hidden = !sold);
}

function renderDatesEditor(ev) {
  const list = $("#datesList");
  if (!list) return;

  list.innerHTML = "";

  (ev.dates || []).forEach((d, idx) => {
    const row = document.createElement("div");
    row.className = "dateRow";
    row.innerHTML = `
      <input type="text" data-k="label" data-i="${idx}" placeholder="Ej: 18-19 enero" value="${escapeHtml(
      d.label || ""
    )}">
      <input type="number" data-k="seats" data-i="${idx}" min="0" placeholder="Cupos" value="${escapeHtml(
      d.seats ?? 0
    )}">
      <button class="btn" type="button" data-del="${idx}">Eliminar</button>
    `;
    list.appendChild(row);
  });

  if ((ev.dates || []).length === 0) {
    list.innerHTML = `<div class="notice">
      <span class="badge">Fechas</span>
      <span>Este evento no tiene fechas. Agregá al menos una.</span>
    </div>`;
  }
}

// ============================================================
// Render: regs table
// ============================================================
function getFilteredRegs() {
  const q = state.query.trim().toLowerCase();
  return state.regs.filter((r) => {
    if (!q) return true;
    return (
      (r.event_title || "").toLowerCase().includes(q) ||
      (r.first_name || "").toLowerCase().includes(q) ||
      (r.last_name || "").toLowerCase().includes(q) ||
      (r.email || "").toLowerCase().includes(q) ||
      (r.phone || "").toLowerCase().includes(q)
    );
  });
}

function renderRegs() {
  const tbody = $("#regsTbody");
  if (!tbody) return;

  const rows = getFilteredRegs();

  tbody.innerHTML = "";
  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="color: rgba(255,255,255,.72);">Sin registros (aún).</td></tr>`;
    return;
  }

  rows
    .slice()
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
    .forEach((r) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(r.event_title || "—")}</td>
        <td>${escapeHtml(r.event_date || "—")}</td>
        <td>${escapeHtml((r.first_name || "") + " " + (r.last_name || ""))}</td>
        <td>${escapeHtml(r.email || "—")}</td>
        <td>${escapeHtml(r.phone || "—")}</td>
        <td>${r.marketing_opt_in ? "Sí" : "No"}</td>
        <td>${escapeHtml((r.created_at || "").replace("T", " ").slice(0, 19) || "—")}</td>
      `;
      tbody.appendChild(tr);
    });
}

// ============================================================
// Render: media
// ============================================================
function renderMedia() {
  $("#logoPath") && ($("#logoPath").value = state.media.logoPath || "");
  $("#defaultHero") && ($("#defaultHero").value = state.media.defaultHero || "");
}

// ============================================================
// ✅ Render: gallery (delegado a admin-gallery.js si existe)
// ============================================================
function renderGallery() {
  // Si tu archivo admin-gallery.js expone un init/render, lo usamos.
  // Esto evita "pantalla en blanco" al entrar al tab.
  try {
    if (window.ECN_ADMIN_GALLERY && typeof window.ECN_ADMIN_GALLERY.render === "function") {
      window.ECN_ADMIN_GALLERY.render();
      return;
    }
    if (window.ECN_ADMIN_GALLERY && typeof window.ECN_ADMIN_GALLERY.init === "function") {
      window.ECN_ADMIN_GALLERY.init();
      if (typeof window.ECN_ADMIN_GALLERY.render === "function") window.ECN_ADMIN_GALLERY.render();
      return;
    }
    if (window.AdminGallery && typeof window.AdminGallery.render === "function") {
      window.AdminGallery.render();
      return;
    }
    if (window.AdminGallery && typeof window.AdminGallery.init === "function") {
      window.AdminGallery.init();
      if (typeof window.AdminGallery.render === "function") window.AdminGallery.render();
      return;
    }

    // Fallback: al menos no se ve vacío total
    const list = $("#galleryList");
    const preview = $("#galPreview");
    if (list && !list.innerHTML.trim()) {
      list.innerHTML = `
        <div class="item" style="cursor:default;">
          <div>
            <p class="itemTitle">Galería lista</p>
            <p class="itemMeta">Falta conectar admin-gallery.js (init/render). El formulario ya está.</p>
          </div>
        </div>
      `;
    }
    if (preview && !preview.innerHTML.trim()) {
      preview.innerHTML = `
        <div class="notice">
          <span class="badge">Tip</span>
          <span>Si no aparece nada, revisá consola: admin-gallery.js debe inicializar el módulo.</span>
        </div>
      `;
    }
  } catch (err) {
    console.error(err);
    toast("Galería", "Ocurrió un error inicializando la galería. Revisá la consola.");
  }
}

// ============================================================
// ✅ Render: promos (placeholder para cuando lo agreguemos)
// ============================================================
function renderPromos() {
  try {
    if (window.ECN_ADMIN_PROMOS && typeof window.ECN_ADMIN_PROMOS.render === "function") {
      window.ECN_ADMIN_PROMOS.render();
      return;
    }
    if (window.ECN_ADMIN_PROMOS && typeof window.ECN_ADMIN_PROMOS.init === "function") {
      window.ECN_ADMIN_PROMOS.init();
      if (typeof window.ECN_ADMIN_PROMOS.render === "function") window.ECN_ADMIN_PROMOS.render();
      return;
    }

    // fallback visual si no cargó el script
    const list = $("#promosList");
    if (list && !list.innerHTML.trim()) {
      list.innerHTML = `
        <div class="item" style="cursor:default;">
          <div>
            <p class="itemTitle">Promos listo</p>
            <p class="itemMeta">Falta cargar ./js/admin-promos.js o revisá la consola.</p>
          </div>
        </div>
      `;
    }
  } catch (err) {
    console.error(err);
    toast("Promos", "Ocurrió un error inicializando promos. Revisá la consola.");
  }
}

// ============================================================
// Render All
// ============================================================
function renderAll() {
  loadAll();
  syncAdminLogo();

  if (state.activeTab === "events") {
    renderEventList();
    renderEventEditor();
  }
  if (state.activeTab === "regs") {
    renderRegs();
  }
  if (state.activeTab === "media") {
    renderMedia();
  }
  if (state.activeTab === "gallery") {
    renderGallery();
  }
  if (state.activeTab === "promos") {
    renderPromos();
  }
}

// ============================================================
// Actions: events CRUD (RAW)
// ============================================================
function createNewEvent() {
  const media = state.media || {};
  const ev = {
    id: uid("ev"),
    type: "Cata de vino",
    monthKey: "ENERO",
    title: "Nuevo evento",
    desc: "",
    img: media.defaultHero || "./assets/img/hero-1.jpg",

    // ✅ nuevos (valores por defecto)
    location: "Por confirmar",
    timeRange: "",
    durationHours: "",
    duration: "Por confirmar",

    dates: [{ label: "Por definir", seats: 0 }],
  };

  if (typeof ECN.upsertEvent === "function") {
    ECN.upsertEvent(ev);
  } else {
    state.eventsRaw.unshift(ev);
    saveEventsRaw();
  }

  state.activeEventId = ev.id;
  toast("Evento creado", "Ahora podés editarlo y guardarlo.");
  renderAll();
}

function duplicateActiveEvent() {
  const ev = state.eventsRaw.find((e) => e.id === state.activeEventId);
  if (!ev) {
    toast("Seleccioná un evento", "Abrí un evento para poder duplicarlo.");
    return;
  }

  const copy = JSON.parse(JSON.stringify(ev));
  copy.id = uid("ev");
  copy.title = `${copy.title || "Evento"} (Copia)`;

  if (typeof ECN.upsertEvent === "function") {
    ECN.upsertEvent(copy);
  } else {
    state.eventsRaw.unshift(copy);
    saveEventsRaw();
  }

  state.activeEventId = copy.id;
  toast("Evento duplicado", "Se creó una copia para editar rápidamente.");
  renderAll();
}

function deleteActiveEvent() {
  const ev = state.eventsRaw.find((e) => e.id === state.activeEventId);
  if (!ev) return;

  const ok = confirm(`Eliminar evento:\n\n${ev.title}\n\nEsta acción no se puede deshacer.`);
  if (!ok) return;

  if (typeof ECN.deleteEvent === "function") {
    ECN.deleteEvent(state.activeEventId);
  } else {
    state.eventsRaw = state.eventsRaw.filter((e) => e.id !== state.activeEventId);
    saveEventsRaw();
  }

  state.activeEventId = null;
  toast("Evento eliminado", "Se eliminó correctamente.");
  renderAll();
}

function saveActiveEvent() {
  const ev = state.eventsRaw.find((e) => e.id === state.activeEventId);
  if (!ev) return false;

  const title = cleanSpaces($("#evTitle")?.value || "");
  const type = String($("#evType")?.value || "Cata de vino");
  const monthKey = normalizeMonth($("#evMonth")?.value || "ENERO");
  const img = cleanSpaces($("#evImg")?.value || "");
  const desc = cleanSpaces($("#evDesc")?.value || "");

  // ✅ nuevos campos (si no existen, no rompen)
  const location = cleanSpaces($("#evLocation")?.value || ev.location || "");
  const timeRange = normalizeTimeRange($("#evTimeRange")?.value || ev.timeRange || "");
  const durationHours = parseHoursNumber($("#evDurationHours")?.value || ev.durationHours || "");
  const durationManual = cleanSpaces($("#evDuration")?.value || "");

  if (!title) {
    toast("Falta el nombre", "Ingresá el nombre del evento.");
    return false;
  }

  // ✅ Regla: duration (lo que ve event.html) = manual si el user lo puso; si no, se arma con hora + horas.
  const duration = durationManual || buildDurationLabel(timeRange, durationHours);

  const next = {
    ...ev,
    title,
    type,
    monthKey,
    img: img || (state.media.defaultHero || "./assets/img/hero-1.jpg"),
    desc,

    // ✅ persistimos campos nuevos
    location: location || "Por confirmar",
    timeRange,
    durationHours,
    duration,

    dates: (ev.dates || [])
      .map((d) => ({
        label: String(d.label || "").trim(),
        seats: Math.max(0, Number(d.seats) || 0),
      }))
      .filter((d) => d.label.length > 0),
  };

  if (next.dates.length === 0) {
    next.dates = [{ label: "Por definir", seats: 0 }];
  }

  if (typeof ECN.upsertEvent === "function") {
    ECN.upsertEvent(next);
  } else {
    Object.assign(ev, next);
    saveEventsRaw();
  }

  toast("Guardado", "Evento actualizado.");
  renderAll();
  return true;
}

function addDateToActive() {
  const ev = state.eventsRaw.find((e) => e.id === state.activeEventId);
  if (!ev) return;
  ev.dates = ev.dates || [];
  ev.dates.push({ label: "Nueva fecha", seats: 0 });

  if (typeof ECN.upsertEvent === "function") {
    ECN.upsertEvent(ev);
  } else {
    saveEventsRaw();
  }

  renderAll();
}

function updateDateField(idx, key, value) {
  const ev = state.eventsRaw.find((e) => e.id === state.activeEventId);
  if (!ev) return;
  const d = ev.dates?.[idx];
  if (!d) return;

  if (key === "label") {
    d.label = String(value || "");
  } else if (key === "seats") {
    d.seats = Math.max(0, Number(value) || 0);
  }

  if (typeof ECN.upsertEvent === "function") {
    ECN.upsertEvent(ev);
  } else {
    saveEventsRaw();
  }

  $("#soldNotice") && ($("#soldNotice").hidden = !(sumSeatsRaw(ev) <= 0));
}

function deleteDate(idx) {
  const ev = state.eventsRaw.find((e) => e.id === state.activeEventId);
  if (!ev) return;
  ev.dates.splice(idx, 1);

  if (typeof ECN.upsertEvent === "function") {
    ECN.upsertEvent(ev);
  } else {
    saveEventsRaw();
  }

  renderAll();
}

// ============================================================
// Actions: regs seed + import
// ============================================================
function loadRegsFromLocalCompat() {
  // Compat: si existe last_registration (viejo), lo mete una vez
  const last = readJSON("last_registration", null);
  if (!last) return;

  const nowRegs =
    typeof ECN.getRegistrations === "function"
      ? ECN.getRegistrations() || []
      : typeof ECN.getRegs === "function"
      ? ECN.getRegs() || []
      : readJSON(ECN.LS.REGS, []) || [];

  const exists = nowRegs.some((r) => r.created_at === last.created_at && r.email === last.email);
  if (exists) return;

  if (typeof ECN.saveRegistration === "function") {
    ECN.saveRegistration(last);
  } else {
    nowRegs.unshift(last);
    saveRegsWhole(nowRegs);
  }

  toast("Registro detectado", "Se importó la última inscripción local.");
}

function seedRegs() {
  const demo = [
    {
      event_id: "vino-notas-ene",
      event_title: "Cata: Notas & Maridajes",
      event_date: "18-19 enero",
      first_name: "María",
      last_name: "Gómez",
      birth_date: "1996-02-14",
      email: "maria@example.com",
      phone: "50688889999",
      allergies: "No mariscos",
      marketing_opt_in: true,
      created_at: new Date(Date.now() - 86400000).toISOString(),
    },
    {
      event_id: "coctel-feb",
      event_title: "Cocteles Clásicos con Twist",
      event_date: "09 febrero",
      first_name: "Carlos",
      last_name: "Vargas",
      birth_date: "1992-07-09",
      email: "carlos@example.com",
      phone: "50687776666",
      allergies: "",
      marketing_opt_in: false,
      created_at: new Date(Date.now() - 3600000).toISOString(),
    },
  ];

  if (typeof ECN.saveRegistration === "function") {
    demo.forEach((r) => ECN.saveRegistration(r));
  } else {
    const existing = readJSON(ECN.LS.REGS, []);
    const merged = [...demo, ...(Array.isArray(existing) ? existing : [])];
    writeJSON(ECN.LS.REGS, merged);
  }

  toast("Demo cargada", "Se agregaron registros de ejemplo.");
  renderAll();
}

// ============================================================
// CSV export
// ============================================================
function csvEscape(val) {
  const s = String(val ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

function exportRegsCSV() {
  const rows = getFilteredRegs()
    .slice()
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));

  if (!rows.length) {
    toast("Sin datos", "No hay registros para exportar con el filtro actual.");
    return;
  }

  const header = [
    "event_title",
    "event_date",
    "first_name",
    "last_name",
    "birth_date",
    "email",
    "phone",
    "allergies",
    "marketing_opt_in",
    "created_at",
    "event_id",
  ];

  const lines = [];
  lines.push(header.join(","));
  rows.forEach((r) => lines.push(header.map((k) => csvEscape(r[k])).join(",")));

  const csv = lines.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });

  const stamp = new Date().toISOString().slice(0, 19).replaceAll(":", "-");
  const filename = `inscripciones-ecn-${stamp}.csv`;

  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 0);

  toast("CSV generado", "Se descargó el archivo con las inscripciones.");
}

// ============================================================
// Actions: media
// ============================================================
function saveMediaForm(e) {
  e.preventDefault();
  const next = {
    logoPath: $("#logoPath")?.value.trim() || "./assets/img/logo-entrecopasynotas.png",
    defaultHero: $("#defaultHero")?.value.trim() || "./assets/img/hero-1.jpg",
  };
  saveMedia(next);
  syncAdminLogo();
  toast("Guardado", "Preferencias de medios actualizadas.");
}

function resetMedia() {
  saveMedia({
    logoPath: "./assets/img/logo-entrecopasynotas.png",
    defaultHero: "./assets/img/hero-1.jpg",
  });
  syncAdminLogo();
  toast("Reset", "Medios restaurados.");
  renderAll();
}

// ============================================================
// Wiring (defensivo)
// ============================================================
function wire() {
  // Tabs
  $$(".tab").forEach((t) => t.addEventListener("click", () => setTab(t.dataset.tab)));

  // Search
  $("#search")?.addEventListener("input", (e) => {
    state.query = e.target.value || "";
    renderAll();
  });

  // Events
  $("#newEventBtn")?.addEventListener("click", createNewEvent);
  $("#dupEventBtn")?.addEventListener("click", duplicateActiveEvent);

  $("#evDesc")?.addEventListener("input", () => {
    const v = $("#evDesc")?.value || "";
    $("#descCount") && ($("#descCount").textContent = String(v.length));
  });

  // ✅ si existen, mantenemos duration “viva” cuando cambian hora/horas (sin pisar si el user editó duration manual)
  const durInput = $("#evDuration");
  const timeInput = $("#evTimeRange");
  const hoursInput = $("#evDurationHours");

  function autoFillDurationIfEmpty() {
    if (!durInput) return;
    const manual = cleanSpaces(durInput.value || "");
    if (manual) return; // si el user escribió algo, no tocamos
    const t = normalizeTimeRange(timeInput?.value || "");
    const h = parseHoursNumber(hoursInput?.value || "");
    const label = buildDurationLabel(t, h);
    // no pongas "Por confirmar" como texto visible en input vacío
    durInput.value = label === "Por confirmar" ? "" : label;
  }

  timeInput?.addEventListener("input", autoFillDurationIfEmpty);
  hoursInput?.addEventListener("input", autoFillDurationIfEmpty);

  $("#addDateBtn")?.addEventListener("click", addDateToActive);

  $("#datesList")?.addEventListener("input", (e) => {
    const inp = e.target;
    const idx = Number(inp.getAttribute("data-i"));
    const key = inp.getAttribute("data-k");
    if (!Number.isFinite(idx) || !key) return;
    updateDateField(idx, key, inp.value);
  });

  $("#datesList")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-del]");
    if (!btn) return;
    const idx = Number(btn.getAttribute("data-del"));
    if (!Number.isFinite(idx)) return;
    deleteDate(idx);
  });

  $("#eventForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    saveActiveEvent();
  });

  $("#deleteEventBtn")?.addEventListener("click", deleteActiveEvent);

  // Regs
  $("#seedRegsBtn")?.addEventListener("click", seedRegs);
  $("#exportCsvBtn")?.addEventListener("click", exportRegsCSV);

  // Media
  $("#mediaForm")?.addEventListener("submit", saveMediaForm);
  $("#resetMediaBtn")?.addEventListener("click", resetMedia);
}

// ============================================================
// Init (ADMIN-ONLY)
// ============================================================
(function init() {
  // ✅ Solo corre en admin.html
  if (!$("#appPanel")) return;
  if (!requireECN()) return;

  loadAll();
  syncAdminLogo();
  wire();

  // Compat import (no molesta si no existe)
  loadRegsFromLocalCompat();

  // Render inicial
  renderAll();
})();
