"use strict";

/**
 * admin.js ✅ PRO (SUPABASE CRUD EVENTS) — 2026-01 (DOM REAL + HIT robusto)
 * - NO maneja login/sesión/logout (eso va en admin-auth.js)
 * - Requiere: supabaseClient.js (APP.supabase) cargado antes
 * - Corre en: admin.html (#appPanel)
 *
 * DOM REAL (confirmado):
 *  - Lista:        #eventList
 *  - Form:         #eventForm
 *  - Hidden id:    #eventId
 *  - Inputs:       #evTitle #evType #evMonth #evImg #evDesc #evLocation #evTimeRange #evDurationHours #evDuration
 *  - Botones:      #newEventBtn #dupEventBtn #saveEventBtn #deleteEventBtn #addDateBtn
 *  - Notas:        #storageNote #eventNote
 *  - Tabs:         .tab[data-tab]
 *  - Empty:        #editorEmpty
 *
 * Tabla:
 *  public.events (
 *    id, title, type, month_key, "desc", img, location, time_range, duration_hours, created_at, updated_at
 *  )
 *
 * Convención elegida (✅ ALINEADO):
 *  - type se guarda como TEXTO: "Cata de vino" | "Maridajes" | "Cocteles"
 *
 * Fixes PRO:
 *  ✅ IDs alineados al HTML real (sin #eventsList/#eventTitle/etc)
 *  ✅ HIT: listeners no dependen de refresh
 *  ✅ CRUD actualiza UI inmediatamente + refetch suave para sincronizar
 *  ✅ Manejo RLS (42501) y error útil
 *  ✅ No rompe si faltan elementos (guard clauses)
 */

(function () {
  // ============================================================
  // Selectores
  // ============================================================
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // Guard: solo corre en admin.html real
  const appPanel = $("#appPanel");
  if (!appPanel) return;

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

  // ============================================================
  // Utils
  // ============================================================
  function cleanSpaces(s) {
    return String(s ?? "").replace(/\s+/g, " ").trim();
  }

  const MONTHS = [
    "ENERO",
    "FEBRERO",
    "MARZO",
    "ABRIL",
    "MAYO",
    "JUNIO",
    "JULIO",
    "AGOSTO",
    "SEPTIEMBRE",
    "OCTUBRE",
    "NOVIEMBRE",
    "DICIEMBRE",
  ];

  function normalizeMonth(m) {
    const up = String(m || "").trim().toUpperCase();
    return MONTHS.includes(up) ? up : "ENERO";
  }

  // DB guarda duration_hours como TEXT: aceptamos "2", "2.5", "".
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

  // ============================================================
  // Supabase helpers
  // ============================================================
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

  // ============================================================
  // DB mapping
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
  const state = {
    activeTab: "events",
    query: "",
    activeEventId: null,
    events: [],
    mode: "supabase", // supabase | blocked | missing
    busy: false,
    didBind: false,
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
  // Tabs (solo control visual; otros módulos se manejan por sus JS)
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

    $$(".tab").forEach((t) => {
      t.setAttribute("aria-selected", t.dataset.tab === state.activeTab ? "true" : "false");
    });

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
      setBusy(false, isRLSError(error) ? "RLS bloquea. Faltan policies para events." : "No se pudieron cargar eventos.");
      throw error;
    }

    state.mode = "supabase";
    state.events = Array.isArray(data) ? data : [];
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
      "eventId",
      "evTitle",
      "evType",
      "evMonth",
      "evImg",
      "evDesc",
      "evLocation",
      "evTimeRange",
      "evDurationHours",
      "evDuration",
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

    $("#eventId") && ($("#eventId").value = String(ev.id || ""));
    $("#evTitle") && ($("#evTitle").value = ev.title || "");

    // ✅ type TEXTO (alineado al HTML)
    const typeEl = $("#evType");
    if (typeEl) {
      const dbType = String(ev.type || "Cata de vino");
      const hasOption = Array.from(typeEl.options || []).some((o) => String(o.value) === dbType);
      typeEl.value = hasOption ? dbType : "Cata de vino";
      if (!hasOption && dbType) {
        setNote(`Nota: el tipo guardado en DB es "${dbType}". Ajustá las opciones del selector si querés incluirlo.`);
      }
    }

    $("#evMonth") && ($("#evMonth").value = normalizeMonth(ev.month_key));
    $("#evImg") && ($("#evImg").value = ev.img || "");

    const d = ev["desc"] || "";
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
  }

  function renderAll() {
    if (state.activeTab === "events") {
      renderEventList();
      renderEventEditor();
    }
  }

  // ============================================================
  // Actions
  // ============================================================
  const createNewEvent = withLock(async function () {
    try {
      if (state.mode !== "supabase") {
        toast("Bloqueado", "Supabase no está listo o RLS bloquea. Revisá policies.");
        return;
      }

      setBusy(true, "Creando evento…");

      // ✅ type TEXTO (alineado al HTML)
      const typeFallback = $("#evType")?.value || "Cata de vino";

      const payload = {
        title: "Nuevo evento",
        type: typeFallback,
        month_key: "ENERO",
        img: "./assets/img/hero-1.jpg",
        desc: "",
        location: "Por confirmar",
        time_range: "",
        duration_hours: "",
      };

      const created = await insertEvent(payload);

      // UI inmediata
      state.events.unshift(created);
      state.activeEventId = created.id;

      toast("Evento creado", "Ya podés editarlo y guardarlo.", 1600);
      renderAll();

      // Refetch suave para sincronizar (updated_at/orden)
      try {
        await fetchEvents();
      } catch (_) {}
      renderAll();
    } catch (err) {
      console.error(err);
      if (isRLSError(err)) {
        state.mode = "blocked";
        toast("RLS", "Falta policy INSERT para events (admins).", 5200);
      } else {
        toast("Error", prettyError(err), 5200);
      }
    } finally {
      setBusy(false, "");
    }
  });

  const duplicateActiveEvent = withLock(async function () {
    const ev = (state.events || []).find((e) => String(e.id) === String(state.activeEventId));
    if (!ev) return toast("Duplicar", "Seleccioná un evento primero.");

    try {
      if (state.mode !== "supabase") {
        toast("Bloqueado", "Supabase no está listo o RLS bloquea. Revisá policies.");
        return;
      }

      setBusy(true, "Duplicando evento…");

      const payload = {
        title: `${ev.title || "Evento"} (Copia)`,
        type: ev.type || ($("#evType")?.value || "Cata de vino"),
        month_key: normalizeMonth(ev.month_key || "ENERO"),
        img: ev.img || "./assets/img/hero-1.jpg",
        desc: ev["desc"] || "",
        location: ev.location || "Por confirmar",
        time_range: ev.time_range || "",
        duration_hours: ev.duration_hours || "",
      };

      const created = await insertEvent(payload);

      state.events.unshift(created);
      state.activeEventId = created.id;

      toast("Duplicado", "Copia creada.", 1500);
      renderAll();

      try {
        await fetchEvents();
      } catch (_) {}
      renderAll();
    } catch (err) {
      console.error(err);
      if (isRLSError(err)) {
        state.mode = "blocked";
        toast("RLS", "Falta policy INSERT para events (admins).", 5200);
      } else {
        toast("Error", prettyError(err), 5200);
      }
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
      if (state.mode !== "supabase") {
        toast("Bloqueado", "Supabase no está listo o RLS bloquea. Revisá policies.");
        return;
      }

      setBusy(true, "Eliminando evento…");
      await deleteEvent(ev.id);

      state.events = (state.events || []).filter((x) => String(x.id) !== String(ev.id));
      state.activeEventId = null;

      toast("Evento eliminado", "Se eliminó correctamente.", 1600);
      renderAll();

      try {
        await fetchEvents();
      } catch (_) {}
      renderAll();
    } catch (err) {
      console.error(err);
      if (isRLSError(err)) {
        state.mode = "blocked";
        toast("RLS", "Falta policy DELETE para events (admins).", 5200);
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
    const type = cleanSpaces($("#evType")?.value || "Cata de vino"); // ✅ TEXTO
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
      desc,
      location: location || "Por confirmar",
      time_range,
      duration_hours: duration_hours === "0" ? "" : duration_hours, // 0 => vacío (por confirmar)
    };

    try {
      if (state.mode !== "supabase") {
        toast("Bloqueado", "Supabase no está listo o RLS bloquea. Revisá policies.");
        return false;
      }

      setBusy(true, "Guardando cambios…");
      const updated = await updateEvent(ev.id, payload);

      state.events = (state.events || []).map((x) =>
        String(x.id) === String(updated.id) ? updated : x
      );

      toast("Guardado", "Evento actualizado en Supabase.", 1400);
      setNote("");
      renderAll();

      try {
        await fetchEvents();
      } catch (_) {}
      renderAll();

      return true;
    } catch (err) {
      console.error(err);
      if (isRLSError(err)) {
        state.mode = "blocked";
        toast("RLS", "Falta policy UPDATE para events (admins).", 5200);
      } else {
        toast("Error", prettyError(err), 5200);
      }
      return false;
    } finally {
      setBusy(false, "");
    }
  });

  // ============================================================
  // Wiring (HIT)
  // ============================================================
  function bindOnce() {
    if (state.didBind) return;
    state.didBind = true;

    // Tabs
    $$(".tab").forEach((t) => {
      t.addEventListener("click", () => setTab(t.dataset.tab));
    });

    // Search
    $("#search")?.addEventListener("input", (e) => {
      state.query = e.target.value || "";
      renderAll();
    });

    // Buttons events
    $("#newEventBtn")?.addEventListener("click", createNewEvent);
    $("#dupEventBtn")?.addEventListener("click", duplicateActiveEvent);
    $("#deleteEventBtn")?.addEventListener("click", deleteActiveEvent);

    // Save (submit) + botón explícito
    $("#eventForm")?.addEventListener("submit", (e) => {
      e.preventDefault();
      saveActiveEvent();
    });
    $("#saveEventBtn")?.addEventListener("click", (e) => {
      e.preventDefault();
      saveActiveEvent();
    });

    // Counter desc
    $("#evDesc")?.addEventListener("input", () => {
      const v = $("#evDesc")?.value || "";
      $("#descCount") && ($("#descCount").textContent = String(v.length));
    });

    // Auto duration (solo UI)
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

    // Ir a fechas
    $("#addDateBtn")?.addEventListener("click", () => {
      toast("Fechas", "Abrí la pestaña “Fechas” para administrar cupos por evento.", 1800);
      setTab("dates");
    });

    // Default tab
    setTab("events");
  }

  // ============================================================
  // Init
  // ============================================================
  (async function init() {
    bindOnce();

    // pequeña espera para estabilizar auth state (sin bloquear)
    try {
      await new Promise((r) => setTimeout(r, 60));
    } catch (_) {}

    try {
      await fetchEvents();

      // Auto-select primer evento si existe
      if (!state.activeEventId && state.events.length) {
        state.activeEventId = state.events[0].id;
      }
    } catch (err) {
      console.error(err);
      if (isRLSError(err)) {
        state.mode = "blocked";
        toast("RLS", "No se pudo leer events. Falta policy SELECT para admins.", 5200);
      } else {
        toast("Supabase", "No se pudieron cargar eventos. Revisá consola.", 5200);
      }
    } finally {
      renderAll();
    }
  })();
})();
