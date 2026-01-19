/**
 * admin-dates.js ✅ PRO (SUPABASE CRUD event_dates) — 2026-01 PRO PATCH
 *
 * ✅ NO requiere recargar:
 * - Espera evento "admin:ready" emitido por admin-auth.js
 * - Se activa al entrar al tab "dates" vía evento "admin:tab"
 *
 * Requiere:
 *  - Supabase CDN + ./js/supabaseClient.js (APP.supabase o APP.sb)
 *  - admin-auth.js emitiendo "admin:ready"
 *  - admin.html con IDs:
 *    #tab-dates, #datesNote, #datesRefreshBtn, #datesNewBtn
 *    #datesEventList, #datesEmpty, #datesEditor
 *    #datesEventTitle, #datesEventMeta, #datesListByEvent
 *    Form: #dateForm, #dateId, #dateLabel, #dateSeatsTotal, #dateSeatsAvailable
 *          #dateSaveBtn (opcional), #dateClearBtn, #dateDeleteBtn
 *    Global: #search
 *
 * Tablas:
 * - public.events (id, title, type, month_key, created_at, ...)
 * - public.event_dates (id, event_id, label, seats_total, seats_available, created_at)
 * - public.registrations (event_date_id, ...)  ✅ para calcular booked (si RLS lo permite)
 */
(function () {
  "use strict";

  const VERSION = "2026-01-19.2";
  const $ = (sel, root = document) => root.querySelector(sel);

  // ------------------------------------------------------------
  // Guard: solo corre si existe el tab de fechas en el DOM
  // ------------------------------------------------------------
  const tabEl = $("#tab-dates");
  if (!tabEl) return;

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

  function setNote(msg) {
    const note = $("#datesNote");
    if (note) note.textContent = String(msg || "");
  }

  function cleanSpaces(s) {
    return String(s ?? "").replace(/\s+/g, " ").trim();
  }

  function clampInt(n, min, max) {
    const x = Number(n);
    if (!Number.isFinite(x)) return min;
    return Math.max(min, Math.min(max, Math.trunc(x)));
  }

  function fmtMonthKey(mk) {
    const s = cleanSpaces(mk).toUpperCase();
    return s || "—";
  }

  // ------------------------------------------------------------
  // Supabase helpers
  // ------------------------------------------------------------
  function getSB() {
    if (!window.APP) return null;
    return window.APP.supabase || window.APP.sb || null;
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

  // ------------------------------------------------------------
  // Queries
  // ------------------------------------------------------------
  const EVENTS_TABLE = "events";
  const EVENT_DATES_TABLE = "event_dates";
  const REGS_TABLE = "registrations"; // ✅ para booked count (si RLS lo permite)

  const EVENTS_SELECT = `id, title, type, month_key, created_at`;
  const DATES_SELECT = `id, event_id, label, seats_total, seats_available, created_at`;

  // ------------------------------------------------------------
  // State
  // ------------------------------------------------------------
  const S = {
    events: [],
    dates: [],
    activeEventId: null,
    activeDateId: null,
    query: "",
    busy: false,

    didBind: false,
    didBoot: false,
    didLoadOnce: false,

    lastLoadAt: 0, // throttle
    bookedByDateId: Object.create(null), // { [dateId]: number }
    canReadRegs: true, // si RLS bloquea registrations, cae a false
  };

  function withLock(fn) {
    return async function (...args) {
      if (S.busy) return;
      S.busy = true;
      try {
        return await fn(...args);
      } finally {
        S.busy = false;
      }
    };
  }

  // ------------------------------------------------------------
  // DOM refs
  // ------------------------------------------------------------
  function R() {
    return {
      eventsList: $("#datesEventList"),
      empty: $("#datesEmpty"),
      editor: $("#datesEditor"),

      eventTitle: $("#datesEventTitle"),
      eventMeta: $("#datesEventMeta"),

      datesList: $("#datesListByEvent"),

      btnRefresh: $("#datesRefreshBtn"),
      btnNew: $("#datesNewBtn"),

      search: $("#search"),

      form: $("#dateForm"),
      dateId: $("#dateId"),
      label: $("#dateLabel"),
      seatsTotal: $("#dateSeatsTotal"),
      seatsAvail: $("#dateSeatsAvailable"),

      btnSave: $("#dateSaveBtn"),
      btnClear: $("#dateClearBtn"),
      btnDelete: $("#dateDeleteBtn"),
    };
  }

  // ------------------------------------------------------------
  // Data loading
  // ------------------------------------------------------------
  async function fetchEvents() {
    const sb = getSB();
    if (!sb) throw new Error("APP.supabase no existe. Revisá el orden de scripts.");

    const { data, error } = await sb
      .from(EVENTS_TABLE)
      .select(EVENTS_SELECT)
      .order("created_at", { ascending: false });

    if (error) throw error;
    S.events = Array.isArray(data) ? data : [];
  }

  async function fetchDatesForEvent(eventId) {
    const sb = getSB();
    if (!sb) throw new Error("APP.supabase no existe. Revisá el orden de scripts.");

    const { data, error } = await sb
      .from(EVENT_DATES_TABLE)
      .select(DATES_SELECT)
      .eq("event_id", eventId)
      .order("created_at", { ascending: false });

    if (error) throw error;
    S.dates = Array.isArray(data) ? data : [];
  }

  // ✅ booked count por dateId (si RLS lo permite)
  async function fetchBookedCountForDate(dateId) {
    const sb = getSB();
    if (!sb) return 0;
    if (!S.canReadRegs) return 0;

    try {
      const { count, error } = await sb
        .from(REGS_TABLE)
        .select("id", { count: "exact", head: true })
        .eq("event_date_id", dateId);

      if (error) throw error;
      return Number(count || 0) || 0;
    } catch (err) {
      // si falla por RLS, degradamos para no spamear errores
      if (isRLSError(err)) S.canReadRegs = false;
      return 0;
    }
  }

  async function refreshBookedCacheForCurrentDates() {
    if (!S.canReadRegs) return;

    const ids = (S.dates || []).map((d) => String(d.id));
    if (!ids.length) return;

    // Secuencial (simple, seguro). Si querés optimizar, lo hacemos batch con Promise.all.
    for (const id of ids) {
      const c = await fetchBookedCountForDate(id);
      S.bookedByDateId[id] = c;
    }
  }

  // ------------------------------------------------------------
  // CRUD
  // ------------------------------------------------------------
  async function createDate(eventId, label, seatsTotal) {
    const sb = getSB();
    if (!sb) throw new Error("APP.supabase no existe. Revisá el orden de scripts.");

    const seats_total = clampInt(seatsTotal, 0, 1000000);

    const payload = {
      event_id: eventId,
      label: cleanSpaces(label) || "Por definir",
      seats_total,
      seats_available: seats_total, // al crear: todo disponible
    };

    const { data, error } = await sb
      .from(EVENT_DATES_TABLE)
      .insert(payload)
      .select(DATES_SELECT)
      .single();

    if (error) throw error;
    return data;
  }

  async function updateDate(dateId, patch) {
    const sb = getSB();
    if (!sb) throw new Error("APP.supabase no existe. Revisá el orden de scripts.");

    const next = { ...patch };

    if (typeof next.seats_total !== "undefined") {
      const total = clampInt(next.seats_total, 0, 1000000);
      next.seats_total = total;

      if (typeof next.seats_available !== "undefined") {
        next.seats_available = clampInt(next.seats_available, 0, total);
      }
    } else if (typeof next.seats_available !== "undefined") {
      next.seats_available = clampInt(next.seats_available, 0, 1000000);
    }

    const { data, error } = await sb
      .from(EVENT_DATES_TABLE)
      .update(next)
      .eq("id", dateId)
      .select(DATES_SELECT)
      .single();

    if (error) throw error;
    return data;
  }

  async function deleteDate(dateId) {
    const sb = getSB();
    if (!sb) throw new Error("APP.supabase no existe. Revisá el orden de scripts.");

    const { error } = await sb.from(EVENT_DATES_TABLE).delete().eq("id", dateId);
    if (error) throw error;
  }

  // ------------------------------------------------------------
  // Search / filters
  // ------------------------------------------------------------
  function pullGlobalSearch() {
    const search = $("#search");
    S.query = cleanSpaces(search ? search.value : "").toLowerCase();
  }

  function filteredEvents() {
    const q = S.query;
    if (!q) return S.events;

    return S.events.filter((e) => {
      return (
        String(e.title || "").toLowerCase().includes(q) ||
        String(e.type || "").toLowerCase().includes(q) ||
        String(e.month_key || "").toLowerCase().includes(q)
      );
    });
  }

  // ------------------------------------------------------------
  // Editor helpers
  // ------------------------------------------------------------
  function setEditorVisible(on) {
    const r = R();
    if (!r.empty || !r.editor) {
      setNote(on ? "" : "Seleccioná un evento a la izquierda para administrar sus fechas.");
      return;
    }
    r.empty.hidden = !!on;
    r.editor.hidden = !on;
  }

  function getActiveEvent() {
    return S.events.find((x) => String(x.id) === String(S.activeEventId)) || null;
  }

  function getActiveDate() {
    return S.dates.find((x) => String(x.id) === String(S.activeDateId)) || null;
  }

  function computeAvailFromBooked(total, booked) {
    const t = clampInt(total, 0, 1000000);
    const b = clampInt(booked, 0, 1000000);
    return Math.max(0, t - b);
  }

  function fillFormFromDate(d) {
    const r = R();
    if (!d) return;

    const id = String(d.id);
    const total = clampInt(d.seats_total, 0, 1000000);

    const booked = S.canReadRegs ? clampInt(S.bookedByDateId[id] ?? 0, 0, 1000000) : null;
    const avail =
      booked == null
        ? clampInt(d.seats_available, 0, total)
        : computeAvailFromBooked(total, booked);

    S.activeDateId = id;

    if (r.dateId) r.dateId.value = S.activeDateId;
    if (r.label) r.label.value = d.label || "";
    if (r.seatsTotal) r.seatsTotal.value = String(total);
    if (r.seatsAvail) r.seatsAvail.value = String(avail);
    if (r.btnDelete) r.btnDelete.disabled = false;
  }

  function setFormMode(dateIdOrNull) {
    const r = R();
    S.activeDateId = dateIdOrNull ? String(dateIdOrNull) : null;

    if (r.dateId) r.dateId.value = S.activeDateId || "";
    if (r.btnDelete) r.btnDelete.disabled = !S.activeDateId;

    if (!S.activeDateId) {
      if (r.label) r.label.value = "";
      if (r.seatsTotal) r.seatsTotal.value = "0";
      if (r.seatsAvail) r.seatsAvail.value = "0";
      return;
    }

    const d = getActiveDate();
    if (d) fillFormFromDate(d);
  }

  function safeConfirm(msg) {
    try { return window.confirm(msg); } catch (_) { return false; }
  }

  // ------------------------------------------------------------
  // Render
  // ------------------------------------------------------------
  function renderEventsList() {
    const r = R();
    if (!r.eventsList) return;

    pullGlobalSearch();
    const list = filteredEvents();
    const active = getActiveEvent();

    r.eventsList.innerHTML = "";

    if (active && S.query && !list.some((x) => String(x.id) === String(active.id))) {
      const pinned = document.createElement("div");
      pinned.className = "item active";
      pinned.innerHTML = `
        <div>
          <p class="itemTitle">${escapeHtml(active.title || "—")}</p>
          <p class="itemMeta">${escapeHtml(active.type || "—")} • ${escapeHtml(fmtMonthKey(active.month_key))}</p>
        </div>
        <div class="pills">
          <span class="pill">ACTIVO</span>
          <span class="pill">FUERA DEL FILTRO</span>
        </div>
      `;
      pinned.addEventListener("click", () => {
        toast("Filtro", "Este evento está activo, pero no coincide con la búsqueda actual.", 2200);
      });
      r.eventsList.appendChild(pinned);
    }

    if (!list.length && !active) {
      r.eventsList.innerHTML = `
        <div class="item" style="cursor:default;">
          <div>
            <p class="itemTitle">Sin eventos</p>
            <p class="itemMeta">Creá eventos en la pestaña “Eventos”.</p>
          </div>
        </div>`;
      return;
    }

    list.forEach((ev) => {
      const item = document.createElement("div");
      item.className = "item";
      item.dataset.id = String(ev.id);

      if (S.activeEventId && String(ev.id) === String(S.activeEventId)) item.classList.add("active");

      item.innerHTML = `
        <div>
          <p class="itemTitle">${escapeHtml(ev.title || "—")}</p>
          <p class="itemMeta">${escapeHtml(ev.type || "—")} • ${escapeHtml(fmtMonthKey(ev.month_key))}</p>
        </div>
        <div class="pills">
          <span class="pill">${String(ev.id) === String(S.activeEventId) ? "ACTIVO" : "FECHAS"}</span>
        </div>
      `;

      item.addEventListener(
        "click",
        withLock(async () => {
          try {
            if (String(S.activeEventId) === String(ev.id)) return;

            S.activeEventId = ev.id;
            S.activeDateId = null;

            setNote("Cargando fechas…");
            await fetchDatesForEvent(S.activeEventId);

            // booked cache (si se puede)
            await refreshBookedCacheForCurrentDates();

            setEditorVisible(true);
            setFormMode(null);
            setNote("Listo.");

            renderSelectedEventHeader();
            renderDatesList();
            renderEventsList();
          } catch (err) {
            console.error(err);
            if (isRLSError(err)) setNote("⚠️ RLS bloquea lectura. Falta policy SELECT en event_dates.");
            toast("Error", isRLSError(err) ? "RLS bloquea (SELECT event_dates)." : prettyError(err), 5200);
          }
        })
      );

      r.eventsList.appendChild(item);
    });
  }

  function renderSelectedEventHeader() {
    const r = R();
    const ev = getActiveEvent();
    if (!ev) return;

    if (r.eventTitle) r.eventTitle.textContent = ev.title || "—";

    // meta con resumen
    const totalDates = (S.dates || []).length;
    const bookedSum = S.canReadRegs
      ? (S.dates || []).reduce((acc, d) => acc + (Number(S.bookedByDateId[String(d.id)] || 0) || 0), 0)
      : null;

    const meta =
      bookedSum == null
        ? `${ev.type || "—"} • ${fmtMonthKey(ev.month_key)} • ${totalDates} fecha(s)`
        : `${ev.type || "—"} • ${fmtMonthKey(ev.month_key)} • ${totalDates} fecha(s) • Reservas: ${bookedSum}`;

    if (r.eventMeta) r.eventMeta.textContent = meta;
  }

  function renderDatesList() {
    const r = R();
    if (!r.datesList) return;

    const items = Array.isArray(S.dates) ? S.dates : [];
    r.datesList.innerHTML = "";

    if (!items.length) {
      r.datesList.innerHTML = `
        <div class="notice">
          <span class="badge">Fechas</span>
          <span>Este evento no tiene fechas todavía. Usá “+ Nueva fecha”.</span>
        </div>
      `;
      return;
    }

    const frag = document.createDocumentFragment();

    items.forEach((d) => {
      const row = document.createElement("div");
      row.className = "item";
      row.dataset.id = String(d.id);

      if (S.activeDateId && String(d.id) === String(S.activeDateId)) row.classList.add("active");

      const id = String(d.id);
      const total = clampInt(d.seats_total, 0, 1000000);

      const booked = S.canReadRegs ? clampInt(S.bookedByDateId[id] ?? 0, 0, 1000000) : null;
      const avail =
        booked == null
          ? clampInt(d.seats_available, 0, total)
          : computeAvailFromBooked(total, booked);

      row.innerHTML = `
        <div>
          <p class="itemTitle">${escapeHtml(d.label || "—")}</p>
          <p class="itemMeta">
            ${booked == null
              ? `Cupos: ${escapeHtml(String(avail))}/${escapeHtml(String(total))}`
              : `Cupos: ${escapeHtml(String(avail))}/${escapeHtml(String(total))} • Reservas: ${escapeHtml(String(booked))}`
            }
          </p>
        </div>
        <div class="pills">
          <span class="pill">TOTAL ${escapeHtml(String(total))}</span>
          ${
            avail <= 0
              ? `<span class="pill danger">AGOTADO</span>`
              : `<span class="pill">DISP ${escapeHtml(String(avail))}</span>`
          }
        </div>
      `;

      row.addEventListener("click", () => {
        fillFormFromDate(d);
        renderDatesList();
        toast("Editando", "Ajustá etiqueta y cupo total. Guardá para aplicar cambios.", 1800);
      });

      frag.appendChild(row);
    });

    r.datesList.appendChild(frag);
  }

  function renderEditor() {
    if (!S.activeEventId) {
      setEditorVisible(false);
      setNote("Seleccioná un evento a la izquierda para administrar sus fechas.");
      return;
    }
    setEditorVisible(true);
    renderSelectedEventHeader();
    renderDatesList();
  }

  function renderAll() {
    renderEventsList();
    renderEditor();
  }

  // ------------------------------------------------------------
  // Actions
  // ------------------------------------------------------------
  const actionRefreshAll = withLock(async function () {
    try {
      const session = await ensureSession();
      if (!session) {
        setNote("⚠️ Sin sesión. Volvé a iniciar sesión.");
        toast("Sesión", "No hay sesión activa en Supabase.", 3800);
        return;
      }

      setNote("Cargando eventos…");
      await fetchEvents();

      if (S.activeEventId && !S.events.some((e) => String(e.id) === String(S.activeEventId))) {
        S.activeEventId = null;
        S.dates = [];
        setFormMode(null);
      }

      if (!S.activeEventId && S.events.length) S.activeEventId = S.events[0].id;

      if (S.activeEventId) {
        setNote("Cargando fechas…");
        await fetchDatesForEvent(S.activeEventId);
        await refreshBookedCacheForCurrentDates();
      }

      setFormMode(null);
      setNote("Listo.");
      renderAll();
    } catch (err) {
      console.error(err);
      if (isRLSError(err)) setNote("⚠️ RLS bloquea. Faltan policies SELECT para events/event_dates.");
      toast("Error", isRLSError(err) ? "RLS bloquea (SELECT events/event_dates)." : prettyError(err), 5200);
      setNote("No se pudo refrescar.");
    }
  });

  const actionNewDate = withLock(async function () {
    if (!S.activeEventId) {
      toast("Fechas", "Primero seleccioná un evento.");
      return;
    }
    setFormMode(null);

    const r = R();
    const total = clampInt(r.seatsTotal?.value || 0, 0, 1000000);
    if (r.seatsAvail) r.seatsAvail.value = String(total);

    toast("Nueva fecha", "Completá la etiqueta y cupo total, luego Guardar.", 2000);
  });

  const actionSaveDate = withLock(async function (e) {
    if (e && typeof e.preventDefault === "function") e.preventDefault();

    if (!S.activeEventId) {
      toast("Fechas", "Primero seleccioná un evento.");
      return;
    }

    const r = R();
    const label = cleanSpaces(r.label ? r.label.value : "");
    const total = clampInt(r.seatsTotal ? r.seatsTotal.value : 0, 0, 1000000);

    if (!label) {
      toast("Falta etiqueta", "Ingresá el texto/etiqueta de la fecha.");
      return;
    }

    try {
      const session = await ensureSession();
      if (!session) {
        toast("Sesión", "Tu sesión expiró. Volvé a iniciar sesión.", 4200);
        return;
      }

      // ✅ Create
      if (!S.activeDateId) {
        setNote("Creando fecha…");
        const created = await createDate(S.activeEventId, label, total);

        // refrescar fechas y booked cache (mejor consistencia)
        await fetchDatesForEvent(S.activeEventId);
        await refreshBookedCacheForCurrentDates();

        // seleccionar la nueva
        S.activeDateId = String(created.id);
        const latest = getActiveDate();
        if (latest) fillFormFromDate(latest);

        setNote("Fecha creada.");
        toast("Listo", "Fecha creada.", 1200);
        renderAll();
        return;
      }

      // ✅ Update (cupos correctos)
      const id = String(S.activeDateId);

      // booked actual (si se puede)
      const booked = await fetchBookedCountForDate(id);
      S.bookedByDateId[id] = booked;

      // seats_available SIEMPRE consistente si se puede leer regs
      const nextAvail = S.canReadRegs
        ? computeAvailFromBooked(total, booked)
        : clampInt(r.seatsAvail ? r.seatsAvail.value : 0, 0, total);

      if (S.canReadRegs && r.seatsAvail) {
        // reflejar en UI lo que realmente se guardará
        r.seatsAvail.value = String(nextAvail);
      }

      setNote("Guardando cambios…");
      const updated = await updateDate(S.activeDateId, {
        label,
        seats_total: total,
        seats_available: nextAvail,
      });

      S.dates = S.dates.map((d) => (String(d.id) === String(updated.id) ? updated : d));
      fillFormFromDate(updated);

      setNote("Guardado.");
      toast(
        "Guardado",
        S.canReadRegs
          ? "Fecha actualizada (cupos recalculados por reservas)."
          : "Fecha actualizada.",
        1400
      );
      renderAll();
    } catch (err) {
      console.error(err);
      if (isRLSError(err)) {
        setNote("⚠️ RLS bloquea escritura. Faltan policies INSERT/UPDATE en event_dates.");
        toast("RLS", "Bloqueado. Falta policy INSERT/UPDATE en event_dates.", 5200);
      } else {
        setNote("Error guardando.");
        toast("Error", prettyError(err), 4200);
      }
    }
  });

  const actionDeleteDate = withLock(async function () {
    if (!S.activeDateId) {
      toast("Eliminar", "Seleccioná una fecha de la lista primero.");
      return;
    }

    const current = getActiveDate();
    const label = current?.label ? String(current.label) : "esta fecha";

    // Si podemos leer regs, prevenimos borrar si hay reservas (evita orfandad)
    const id = String(S.activeDateId);
    const booked = await fetchBookedCountForDate(id);
    S.bookedByDateId[id] = booked;

    if (S.canReadRegs && booked > 0) {
      toast("No permitido", `Esta fecha tiene ${booked} reserva(s). Primero eliminá/mové esas inscripciones.`, 5200);
      return;
    }

    const ok = safeConfirm(`¿Eliminar ${label}?\n\nEsta acción no se puede deshacer.`);
    if (!ok) return;

    try {
      const session = await ensureSession();
      if (!session) {
        toast("Sesión", "Tu sesión expiró. Volvé a iniciar sesión.", 4200);
        return;
      }

      setNote("Eliminando fecha…");
      await deleteDate(S.activeDateId);

      S.dates = S.dates.filter((d) => String(d.id) !== String(S.activeDateId));
      delete S.bookedByDateId[id];

      S.activeDateId = null;
      setFormMode(null);

      setNote("Eliminada.");
      toast("Eliminada", "Se eliminó la fecha.", 1200);
      renderAll();
    } catch (err) {
      console.error(err);
      if (isRLSError(err)) {
        setNote("⚠️ RLS bloquea delete. Falta policy DELETE en event_dates.");
        toast("RLS", "Bloqueado. Falta policy DELETE en event_dates.", 5200);
      } else {
        setNote("Error eliminando.");
        toast("Error", prettyError(err), 4200);
      }
    }
  });

  const actionClearForm = withLock(async function () {
    if (!S.activeEventId) {
      toast("Fechas", "Primero seleccioná un evento.");
      return;
    }
    setFormMode(null);
    toast("Nueva", "Formulario listo para crear una fecha nueva.", 1600);
  });

  // ------------------------------------------------------------
  // Load-on-demand (solo cuando tab “dates” se abre)
  // ------------------------------------------------------------
  async function ensureLoaded(force) {
    bindOnce();

    const now = Date.now();
    if (!force && now - S.lastLoadAt < 600) return;
    if (force && now - S.lastLoadAt < 250) return; // anti doble-disparo por click+event
    S.lastLoadAt = now;

    const isHidden = !!$("#tab-dates")?.hidden;
    if (!force && isHidden) return;

    const sb = getSB();
    if (!sb) {
      toast("Supabase", "Falta supabaseClient.js antes de admin-dates.js");
      setNote("⚠️ Falta Supabase Client. Revisá el orden de scripts.");
      return;
    }

    try {
      const session = await ensureSession();
      if (!session) {
        setEditorVisible(false);
        setNote("⚠️ Sin sesión. Volvé a iniciar sesión en Admin.");
        toast("Sesión", "No hay sesión activa.", 3200);
        return;
      }

      if (S.didLoadOnce && !force) {
        renderAll();
        return;
      }

      setNote("Cargando eventos…");
      await fetchEvents();

      if (!S.events.length) {
        S.activeEventId = null;
        S.dates = [];
        S.didLoadOnce = true;
        setEditorVisible(false);
        setNote("No hay eventos todavía. Crealos en “Eventos”.");
        renderEventsList();
        return;
      }

      if (!S.activeEventId) S.activeEventId = S.events[0].id;

      setNote("Cargando fechas…");
      await fetchDatesForEvent(S.activeEventId);
      await refreshBookedCacheForCurrentDates();

      setFormMode(null);
      S.didLoadOnce = true;

      setNote("Listo.");
      renderAll();
    } catch (err) {
      console.error(err);
      if (isRLSError(err)) {
        setNote("⚠️ RLS bloquea. Faltan policies SELECT para events/event_dates.");
        toast("RLS", "Acceso bloqueado. Falta policy SELECT para events/event_dates.", 5200);
      } else {
        setNote("Error cargando datos.");
        toast("Error", prettyError(err), 4200);
      }
    }
  }

  // ------------------------------------------------------------
  // Bind once
  // ------------------------------------------------------------
  function onAdminTab(e) {
    const t = e?.detail?.tab;
    if (t === "dates") ensureLoaded(true);
  }

  function bindOnce() {
    if (S.didBind) return;
    S.didBind = true;

    const r = R();

    r.btnRefresh?.addEventListener("click", actionRefreshAll);
    r.btnNew?.addEventListener("click", actionNewDate);

    r.form?.addEventListener("submit", actionSaveDate);
    r.btnSave?.addEventListener("click", actionSaveDate);
    r.btnClear?.addEventListener("click", actionClearForm);
    r.btnDelete?.addEventListener("click", actionDeleteDate);

    // UX: al cambiar total, actualizamos available según reservas si podemos
    r.seatsTotal?.addEventListener("input", async () => {
      const total = clampInt(r.seatsTotal.value, 0, 1000000);

      if (!S.activeDateId) {
        if (r.seatsAvail) r.seatsAvail.value = String(total);
        return;
      }

      if (!S.canReadRegs) {
        // fallback: mantener avail <= total
        const currAvail = clampInt(r.seatsAvail ? r.seatsAvail.value : 0, 0, total);
        if (r.seatsAvail) r.seatsAvail.value = String(currAvail);
        return;
      }

      const booked = await fetchBookedCountForDate(String(S.activeDateId));
      S.bookedByDateId[String(S.activeDateId)] = booked;

      const nextAvail = computeAvailFromBooked(total, booked);
      if (r.seatsAvail) r.seatsAvail.value = String(nextAvail);

      renderSelectedEventHeader();
      renderDatesList();
    });

    r.search?.addEventListener("input", () => {
      renderEventsList();
    });

    window.addEventListener("admin:tab", onAdminTab);
  }

  // ------------------------------------------------------------
  // Boot: esperar admin:ready
  // ------------------------------------------------------------
  function boot() {
    if (S.didBoot) return;
    S.didBoot = true;

    console.log("[admin-dates] boot", { VERSION });

    if (window.APP && APP.__adminReady) {
      bindOnce();
      if (!$("#tab-dates")?.hidden) ensureLoaded(true);
      return;
    }

    window.addEventListener(
      "admin:ready",
      () => {
        bindOnce();
        if (!$("#tab-dates")?.hidden) ensureLoaded(true);
      },
      { once: true }
    );
  }

  boot();
})();
