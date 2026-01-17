"use strict";

/**
 * admin-dates.js ✅ PRO (SUPABASE CRUD event_dates) — UI NUEVA (admin.html actualizado)
 *
 * Requiere:
 *  - Supabase CDN + ./js/supabaseClient.js (APP.supabase)
 *  - admin.html con IDs:
 *    Tabs/containers:
 *      #tab-dates
 *      #datesNote
 *      #datesRefreshBtn
 *      #datesNewBtn
 *      #datesEventList
 *      #datesEmpty
 *      #datesEditor
 *      Dentro de #datesEditor:
 *        #datesEventTitle
 *        #datesEventMeta
 *        #datesListByEvent
 *        Form:
 *          #dateForm, #dateId, #dateLabel, #dateSeatsTotal, #dateSeatsAvailable
 *          #dateSaveBtn, #dateClearBtn, #dateDeleteBtn
 *    Global:
 *      #search (búsqueda global)
 *
 * Tablas:
 * - public.events (id, title, type, month_key, created_at, ...)
 * - public.event_dates (id, event_id, label, seats_total, seats_available, created_at)
 *
 * Reglas:
 * - Create: seats_available = seats_total
 * - Update:
 *   - clamp: seats_total >= 0
 *   - seats_available <= seats_total
 */

(function () {
  const $ = (sel, root = document) => root.querySelector(sel);

  // ------------------------------------------------------------
  // Guard: solo corre en admin.html con tab-dates
  // ------------------------------------------------------------
  const tab = $("#tab-dates");
  if (!tab) return;

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
    el.querySelector(".close")?.addEventListener("click", kill);
    setTimeout(kill, timeoutMs);
  }

  function setNote(msg) {
    const note = $("#datesNote");
    if (!note) return;
    note.textContent = String(msg || "");
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
    return window.APP && window.APP.supabase ? window.APP.supabase : null;
  }

  function isRLSError(err) {
    const m = String(err?.message || "").toLowerCase();
    return (
      m.includes("rls") ||
      m.includes("permission") ||
      m.includes("not allowed") ||
      m.includes("row level security") ||
      m.includes("new row violates row-level security")
    );
  }

  function prettyError(err) {
    const msg = String(err?.message || err || "");
    return msg || "Ocurrió un error.";
  }

  // ------------------------------------------------------------
  // Queries
  // ------------------------------------------------------------
  const EVENTS_TABLE = "events";
  const EVENT_DATES_TABLE = "event_dates";

  const EVENTS_SELECT = `id, title, type, month_key, created_at`;
  const DATES_SELECT = `id, event_id, label, seats_total, seats_available, created_at`;

  // ------------------------------------------------------------
  // State
  // ------------------------------------------------------------
  const S = {
    events: [],
    activeEventId: null,
    dates: [],
    query: "",
    didBind: false,
    activeDateId: null, // dateId en edición
  };

  // ------------------------------------------------------------
  // DOM refs (admin.html actualizado)
  // ------------------------------------------------------------
  function R() {
    return {
      eventsList: $("#datesEventList"),
      empty: $("#datesEmpty"),
      editor: $("#datesEditor"),

      // header selected event
      eventTitle: $("#datesEventTitle"),
      eventMeta: $("#datesEventMeta"),

      // list by event
      datesList: $("#datesListByEvent"),

      // controls
      btnRefresh: $("#datesRefreshBtn"),
      btnNew: $("#datesNewBtn"),

      // global search
      search: $("#search"),

      // form
      form: $("#dateForm"),
      dateId: $("#dateId"),
      label: $("#dateLabel"),
      seatsTotal: $("#dateSeatsTotal"),
      seatsAvail: $("#dateSeatsAvailable"),
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
      seats_available: seats_total, // arranque
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

    // clamp con regla avail<=total
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
    if (!r.empty || !r.editor) return;
    r.empty.hidden = !!on;
    r.editor.hidden = !on;
  }

  function getActiveEvent() {
    return S.events.find((x) => x.id === S.activeEventId) || null;
  }

  function setFormMode(dateIdOrNull) {
    const r = R();
    S.activeDateId = dateIdOrNull ? String(dateIdOrNull) : null;

    if (!r.dateId || !r.btnDelete) return;

    r.dateId.value = S.activeDateId || "";
    r.btnDelete.disabled = !S.activeDateId;

    if (!S.activeDateId) {
      // modo "Nueva"
      if (r.label) r.label.value = "";
      if (r.seatsTotal) r.seatsTotal.value = "0";
      if (r.seatsAvail) r.seatsAvail.value = "0";
    }
  }

  function fillFormFromDate(d) {
    const r = R();
    if (!d) return;

    const total = clampInt(d.seats_total, 0, 1000000);
    const avail = clampInt(d.seats_available, 0, total);

    S.activeDateId = String(d.id);

    if (r.dateId) r.dateId.value = S.activeDateId;
    if (r.label) r.label.value = d.label || "";
    if (r.seatsTotal) r.seatsTotal.value = String(total);
    if (r.seatsAvail) r.seatsAvail.value = String(avail);

    if (r.btnDelete) r.btnDelete.disabled = false;
  }

  // ------------------------------------------------------------
  // Render
  // ------------------------------------------------------------
  function renderEventsList() {
    const r = R();
    if (!r.eventsList) return;

    const list = filteredEvents();

    if (!list.length) {
      r.eventsList.innerHTML = `
        <div class="item" style="cursor:default;">
          <div>
            <p class="itemTitle">Sin eventos</p>
            <p class="itemMeta">Creá eventos en la pestaña “Eventos”.</p>
          </div>
        </div>`;
      return;
    }

    r.eventsList.innerHTML = "";

    list.forEach((ev) => {
      const item = document.createElement("div");
      item.className = "item";
      item.dataset.id = ev.id;

      item.innerHTML = `
        <div>
          <p class="itemTitle">${escapeHtml(ev.title || "—")}</p>
          <p class="itemMeta">${escapeHtml(ev.type || "—")} • ${escapeHtml(fmtMonthKey(ev.month_key))}</p>
        </div>
        <div class="pills">
          <span class="pill">${ev.id === S.activeEventId ? "ACTIVO" : "FECHAS"}</span>
        </div>
      `;

      item.addEventListener("click", async () => {
        try {
          if (S.activeEventId === ev.id) return;
          S.activeEventId = ev.id;
          setNote("Cargando fechas…");
          await fetchDatesForEvent(S.activeEventId);
          setNote("Listo.");
          setEditorVisible(true);
          setFormMode(null);
          renderDatesList();
          renderSelectedEventHeader();
        } catch (err) {
          console.error(err);
          if (isRLSError(err)) setNote("⚠️ RLS bloquea lectura. Falta policy SELECT en event_dates.");
          toast("Error", isRLSError(err) ? "RLS bloquea (SELECT event_dates)." : prettyError(err));
        }
      });

      r.eventsList.appendChild(item);
    });
  }

  function renderSelectedEventHeader() {
    const r = R();
    const ev = getActiveEvent();
    if (!ev) return;

    if (r.eventTitle) r.eventTitle.textContent = ev.title || "—";
    if (r.eventMeta) r.eventMeta.textContent = `${ev.type || "—"} • ${fmtMonthKey(ev.month_key)} • ${S.dates.length} fecha(s)`;
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

      const total = clampInt(d.seats_total, 0, 1000000);
      const avail = clampInt(d.seats_available, 0, total);

      const pills = [];
      pills.push(`<span class="pill">TOTAL ${escapeHtml(String(total))}</span>`);
      pills.push(
        avail <= 0
          ? `<span class="pill danger">AGOTADO</span>`
          : `<span class="pill">DISP ${escapeHtml(String(avail))}</span>`
      );

      row.innerHTML = `
        <div>
          <p class="itemTitle">${escapeHtml(d.label || "—")}</p>
          <p class="itemMeta">Cupos: ${escapeHtml(String(avail))}/${escapeHtml(String(total))}</p>
        </div>
        <div class="pills">
          ${pills.join("")}
        </div>
      `;

      row.addEventListener("click", () => {
        fillFormFromDate(d);
        toast("Editando", "Podés ajustar etiqueta y cupos. Guardá para aplicar cambios.", 2000);
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
    pullGlobalSearch();
    renderEventsList();
    renderEditor();
  }

  // ------------------------------------------------------------
  // Actions
  // ------------------------------------------------------------
  async function actionRefreshAll() {
    try {
      setNote("Cargando eventos…");
      await fetchEvents();

      // mantener active si existe
      if (S.activeEventId && !S.events.some((e) => e.id === S.activeEventId)) {
        S.activeEventId = null;
        S.dates = [];
        setFormMode(null);
      }

      // si no hay active, elegir primero
      if (!S.activeEventId && S.events.length) {
        S.activeEventId = S.events[0].id;
      }

      if (S.activeEventId) {
        setNote("Cargando fechas…");
        await fetchDatesForEvent(S.activeEventId);
      }

      setNote("Listo.");
      renderAll();
    } catch (err) {
      console.error(err);
      if (isRLSError(err)) setNote("⚠️ RLS bloquea. Faltan policies SELECT para events/event_dates.");
      toast("Error", isRLSError(err) ? "RLS bloquea (SELECT events/event_dates)." : prettyError(err));
      setNote("No se pudo refrescar.");
    }
  }

  async function actionNewDate() {
    if (!S.activeEventId) {
      toast("Fechas", "Primero seleccioná un evento.");
      return;
    }
    setFormMode(null);
    toast("Nueva fecha", "Completá la etiqueta y cupos, luego Guardar.", 2200);
  }

  async function actionSaveDate(e) {
    e.preventDefault();

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
      // create
      if (!S.activeDateId) {
        setNote("Creando fecha…");
        const created = await createDate(S.activeEventId, label, total);
        S.dates.unshift(created);
        setNote("Fecha creada.");
        toast("Listo", "Fecha creada.");
        fillFormFromDate(created); // queda seleccionada
        renderSelectedEventHeader();
        renderDatesList();
        return;
      }

      // update
      const current = S.dates.find((x) => String(x.id) === String(S.activeDateId));
      const currTotal = clampInt(current?.seats_total, 0, 1000000);
      const currAvail = clampInt(current?.seats_available, 0, currTotal);

      // regla segura:
      // - si total cambia y no sabemos "used", preservamos avail dentro del nuevo total:
      //     newAvail = min(currAvail, newTotal)
      const nextAvail = Math.min(currAvail, total);

      setNote("Guardando cambios…");
      const updated = await updateDate(S.activeDateId, {
        label,
        seats_total: total,
        seats_available: nextAvail,
      });

      S.dates = S.dates.map((d) => (d.id === updated.id ? updated : d));
      setNote("Guardado.");
      toast("Guardado", "Fecha actualizada.");
      fillFormFromDate(updated);
      renderSelectedEventHeader();
      renderDatesList();
    } catch (err) {
      console.error(err);
      if (isRLSError(err)) {
        setNote("⚠️ RLS bloquea escritura. Faltan policies INSERT/UPDATE en event_dates.");
        toast("RLS", "Bloqueado. Falta policy INSERT/UPDATE en event_dates.");
      } else {
        setNote("Error guardando.");
        toast("Error", prettyError(err));
      }
    }
  }

  async function actionDeleteDate() {
    if (!S.activeDateId) {
      toast("Eliminar", "Seleccioná una fecha de la lista primero.");
      return;
    }

    const current = S.dates.find((x) => String(x.id) === String(S.activeDateId));
    const label = current?.label ? String(current.label) : "esta fecha";

    const ok = confirm(`¿Eliminar ${label}?\n\nEsta acción no se puede deshacer.`);
    if (!ok) return;

    try {
      setNote("Eliminando fecha…");
      await deleteDate(S.activeDateId);

      S.dates = S.dates.filter((d) => String(d.id) !== String(S.activeDateId));
      S.activeDateId = null;

      setFormMode(null);
      setNote("Eliminada.");
      toast("Eliminada", "Se eliminó la fecha.");

      renderSelectedEventHeader();
      renderDatesList();
    } catch (err) {
      console.error(err);
      if (isRLSError(err)) {
        setNote("⚠️ RLS bloquea delete. Falta policy DELETE en event_dates.");
        toast("RLS", "Bloqueado. Falta policy DELETE en event_dates.");
      } else {
        setNote("Error eliminando.");
        toast("Error", prettyError(err));
      }
    }
  }

  function actionClearForm() {
    if (!S.activeEventId) {
      toast("Fechas", "Primero seleccioná un evento.");
      return;
    }
    setFormMode(null);
    toast("Nueva", "Formulario listo para crear una fecha nueva.", 2000);
  }

  // ------------------------------------------------------------
  // Bind
  // ------------------------------------------------------------
  function bindOnce() {
    if (S.didBind) return;
    S.didBind = true;

    const r = R();

    r.btnRefresh?.addEventListener("click", actionRefreshAll);
    r.btnNew?.addEventListener("click", actionNewDate);

    r.form?.addEventListener("submit", actionSaveDate);
    r.btnClear?.addEventListener("click", actionClearForm);
    r.btnDelete?.addEventListener("click", actionDeleteDate);

    // Clamp UI: cuando cambia total, ajusta el available (disabled) por consistencia visual
    r.seatsTotal?.addEventListener("input", () => {
      const total = clampInt(r.seatsTotal.value, 0, 1000000);
      if (r.seatsAvail) r.seatsAvail.value = String(total); // en create lo refleja, en edit se recalcula en save
    });

    // Búsqueda global re-render
    r.search?.addEventListener("input", () => renderAll());
  }

  // ------------------------------------------------------------
  // Init
  // ------------------------------------------------------------
  (async function init() {
    const sb = getSB();
    if (!sb) {
      toast("Supabase", "Falta supabaseClient.js antes de admin-dates.js");
      setNote("⚠️ Falta Supabase Client. Revisá el orden de scripts.");
      return;
    }

    bindOnce();

    try {
      setNote("Cargando eventos…");
      await fetchEvents();

      if (!S.events.length) {
        S.activeEventId = null;
        S.dates = [];
        setEditorVisible(false);
        setNote("No hay eventos todavía. Crealos en “Eventos”.");
        renderEventsList();
        return;
      }

      if (!S.activeEventId) S.activeEventId = S.events[0].id;

      setNote("Cargando fechas…");
      await fetchDatesForEvent(S.activeEventId);

      setNote("Listo.");
      setFormMode(null);
      renderAll();
    } catch (err) {
      console.error(err);
      if (isRLSError(err)) {
        setNote("⚠️ RLS bloquea. Faltan policies SELECT para events/event_dates.");
        toast("RLS", "Acceso bloqueado. Falta policy SELECT para events/event_dates.");
      } else {
        setNote("Error cargando datos.");
        toast("Error", prettyError(err));
      }
    }
  })();
})();
