"use strict";

/**
 * admin.js ✅ PRO+STABLE (Events CRUD + Tabs Orchestrator)
 * - ✅ NO arranca hasta recibir admin:ready (evita recargas)
 * - ✅ Tabs: click + evento admin:tab para módulos (gallery/promos/media)
 * - ✅ Init una sola vez (sin doble boot por cache/reload/auth events)
 */

(function () {
  const VERSION = "2026-01-18.2";

  const $ = (sel, root = document) => root.querySelector(sel);

  // ------------------------------------------------------------
  // Guard: solo corre en admin.html
  // ------------------------------------------------------------
  const appPanel = $("#appPanel");
  if (!appPanel) return;

  // ------------------------------------------------------------
  // Boot gating: esperar admin:ready
  // ------------------------------------------------------------
  let BOOTED = false;

  function log(...args) {
    try { console.log("[admin]", ...args); } catch (_) {}
  }
  function warn(...args) {
    try { console.warn("[admin]", ...args); } catch (_) {}
  }
  function err(...args) {
    try { console.error("[admin]", ...args); } catch (_) {}
  }

  function escapeHtml(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function toast(title, msg, timeoutMs = 3200) {
    // Si existe un toast global o APP.toast, úsalo
    try {
      if (window.APP && typeof APP.toast === "function") return APP.toast(title, msg, timeoutMs);
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

  function note(el, msg, kind) {
    if (!el) return;
    el.textContent = msg || "";
    el.dataset.kind = kind || "";
  }

  function ensureSupabase() {
    if (!window.APP || !APP.supabase) {
      err("APP.supabase no existe. Revisá orden: Supabase CDN -> supabaseClient.js -> admin-auth.js -> admin.js");
      return false;
    }
    return true;
  }

  // ------------------------------------------------------------
  // Tabs (orquestador)
  // ------------------------------------------------------------
  function setActiveTab(tabName) {
    const tabs = [...document.querySelectorAll(".tab[data-tab]")];
    const panels = ["events", "dates", "regs", "media", "gallery", "promos"];

    tabs.forEach((btn) => {
      const isOn = btn.dataset.tab === tabName;
      btn.setAttribute("aria-selected", isOn ? "true" : "false");
    });

    panels.forEach((k) => {
      const panel = document.getElementById(`tab-${k}`);
      if (!panel) return;
      panel.hidden = k !== tabName;
    });

    // Notificar a módulos (gallery/promos/media) cuando su tab está visible
    try {
      window.dispatchEvent(new CustomEvent("admin:tab", { detail: { tab: tabName } }));
    } catch (_) {}
  }

  function wireTabs() {
    const tabs = [...document.querySelectorAll(".tab[data-tab]")];
    if (!tabs.length) return;

    if (document.body.dataset.tabsWired === "1") return;
    document.body.dataset.tabsWired = "1";

    tabs.forEach((btn) => {
      btn.addEventListener("click", () => {
        setActiveTab(btn.dataset.tab || "events");
      });
    });

    // Permite activar tab desde consola o desde otros módulos
    window.addEventListener("admin:tab", (e) => {
      const name = e?.detail?.tab;
      if (!name) return;
      // Evitar loop: si el evento lo emite setActiveTab no necesitamos re-emitir
      const panel = document.getElementById(`tab-${name}`);
      if (panel && panel.hidden) {
        setActiveTab(name);
      }
    });
  }

  // ------------------------------------------------------------
  // EVENTS (CRUD)
  // ------------------------------------------------------------
  const ui = {
    eventList: $("#eventList"),
    eventsEmpty: $("#eventsEmpty"),
    editorEmpty: $("#editorEmpty"),
    form: $("#eventForm"),
    note: $("#eventNote"),
    storageNote: $("#storageNote"),

    newBtn: $("#newEventBtn"),
    dupBtn: $("#dupEventBtn"),
    saveBtn: $("#saveEventBtn"),
    deleteBtn: $("#deleteEventBtn"),
    addDateBtn: $("#addDateBtn"),

    search: $("#search"),

    id: $("#eventId"),
    title: $("#evTitle"),
    type: $("#evType"),
    month: $("#evMonth"),
    img: $("#evImg"),
    desc: $("#evDesc"),
    descCount: $("#descCount"),
    location: $("#evLocation"),
    timeRange: $("#evTimeRange"),
    durationHours: $("#evDurationHours"),
    duration: $("#evDuration"),

    datesList: $("#datesList"),
  };

  let state = {
    events: [],
    selectedId: null,
    busy: false,
  };

  function setBusy(on, msg) {
    state.busy = !!on;
    if (ui.saveBtn) ui.saveBtn.disabled = on;
    if (ui.deleteBtn) ui.deleteBtn.disabled = on;
    if (ui.newBtn) ui.newBtn.disabled = on;
    if (ui.dupBtn) ui.dupBtn.disabled = on;
    note(ui.note, msg || "", on ? "busy" : "");
  }

  function showEditorEmpty(on) {
    if (!ui.editorEmpty || !ui.form) return;
    ui.editorEmpty.hidden = !on;
    ui.form.hidden = on;
  }

  function clearForm() {
    if (!ui.form) return;
    ui.id.value = "";
    ui.title.value = "";
    ui.type.value = "Cata de vino";
    ui.month.value = "ENERO";
    ui.img.value = "";
    ui.desc.value = "";
    ui.location.value = "";
    ui.timeRange.value = "";
    ui.durationHours.value = "";
    ui.duration.value = "";
    if (ui.descCount) ui.descCount.textContent = "0";
    if (ui.datesList) ui.datesList.innerHTML = "";
  }

  function renderList(filtered) {
    const list = ui.eventList;
    if (!list) return;

    const items = filtered || state.events;

    list.innerHTML = "";

    if (!items.length) {
      if (ui.eventsEmpty) ui.eventsEmpty.hidden = false;
      return;
    }
    if (ui.eventsEmpty) ui.eventsEmpty.hidden = true;

    items.forEach((ev) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "rowItem";
      btn.dataset.id = ev.id;

      const active = state.selectedId === ev.id;
      if (active) btn.classList.add("active");

      btn.innerHTML = `
        <div class="rowMain">
          <div class="rowTitle">${escapeHtml(ev.title || "Sin título")}</div>
          <div class="rowMeta">${escapeHtml(ev.type || "—")} · ${escapeHtml(ev.month_key || "—")}</div>
        </div>
      `;

      btn.addEventListener("click", () => selectEvent(ev.id));
      list.appendChild(btn);
    });
  }

  function patchForm(ev) {
    ui.id.value = ev?.id || "";
    ui.title.value = ev?.title || "";
    ui.type.value = ev?.type || "Cata de vino";
    ui.month.value = ev?.month_key || "ENERO";
    ui.img.value = ev?.image_url || "";
    ui.desc.value = ev?.description || "";
    ui.location.value = ev?.location || "";
    ui.timeRange.value = ev?.time_range || "";
    ui.durationHours.value = ev?.duration_hours != null ? String(ev.duration_hours) : "";
    ui.duration.value = ev?.duration_text || "";
    if (ui.descCount) ui.descCount.textContent = String((ui.desc.value || "").length);

    // Mini resumen de fechas (si existe columna/relación)
    if (ui.datesList) ui.datesList.innerHTML = "";
  }

  async function fetchEvents() {
    if (!ensureSupabase()) return [];

    note(ui.storageNote, "Cargando eventos…", "busy");

    const res = await APP.supabase
      .from("events")
      .select("*")
      .order("created_at", { ascending: false });

    if (res.error) {
      err("fetchEvents error:", res.error);
      note(ui.storageNote, "Error cargando eventos. Revisá policies/RLS.", "error");
      toast("Error", "No se pudieron cargar eventos. Revisá consola.", 5000);
      return [];
    }

    note(ui.storageNote, "", "");
    return res.data || [];
  }

  async function selectEvent(id) {
    state.selectedId = id;
    renderList();

    const ev = state.events.find((x) => x.id === id);
    if (!ev) {
      showEditorEmpty(true);
      return;
    }

    patchForm(ev);
    showEditorEmpty(false);
    note(ui.note, "Listo para editar. Guardá cambios cuando terminés.", "");
  }

  async function createEvent() {
    if (!ensureSupabase()) return;

    setBusy(true, "Creando evento…");

    try {
      const payload = {
        title: "Nuevo evento",
        type: "Cata de vino",
        month_key: "ENERO",
        image_url: null,
        description: null,
        location: null,
        time_range: null,
        duration_hours: null,
        duration_text: null,
      };

      const res = await APP.supabase
        .from("events")
        .insert(payload)
        .select("*")
        .single();

      if (res.error) {
        err("createEvent error:", res.error);
        toast("Error", "No se pudo crear el evento (RLS/policies o tabla).", 5200);
        return;
      }

      toast("Evento", "Evento creado. Ya podés editarlo.", 2200);

      // refrescar state
      state.events = await fetchEvents();
      renderList();

      // seleccionar el nuevo
      if (res.data?.id) await selectEvent(res.data.id);
    } finally {
      setBusy(false, "");
    }
  }

  async function duplicateEvent() {
    if (!state.selectedId) return toast("Duplicar", "Seleccioná un evento primero.", 2800);
    const ev = state.events.find((x) => x.id === state.selectedId);
    if (!ev) return;

    setBusy(true, "Duplicando evento…");

    try {
      const payload = {
        title: (ev.title || "Evento") + " (copia)",
        type: ev.type || "Cata de vino",
        month_key: ev.month_key || "ENERO",
        image_url: ev.image_url || null,
        description: ev.description || null,
        location: ev.location || null,
        time_range: ev.time_range || null,
        duration_hours: ev.duration_hours ?? null,
        duration_text: ev.duration_text || null,
      };

      const res = await APP.supabase
        .from("events")
        .insert(payload)
        .select("*")
        .single();

      if (res.error) {
        err("duplicateEvent error:", res.error);
        toast("Error", "No se pudo duplicar el evento.", 5200);
        return;
      }

      toast("Duplicado", "Evento duplicado.", 2000);
      state.events = await fetchEvents();
      renderList();
      if (res.data?.id) await selectEvent(res.data.id);
    } finally {
      setBusy(false, "");
    }
  }

  async function saveEvent(e) {
    e?.preventDefault?.();

    if (!state.selectedId) return toast("Guardar", "Seleccioná un evento primero.", 2800);

    setBusy(true, "Guardando…");

    try {
      const payload = {
        title: ui.title.value.trim(),
        type: ui.type.value,
        month_key: ui.month.value,
        image_url: ui.img.value.trim() || null,
        description: ui.desc.value.trim() || null,
        location: ui.location.value.trim() || null,
        time_range: ui.timeRange.value.trim() || null,
        duration_hours: ui.durationHours.value.trim() || null,
        duration_text: ui.duration.value.trim() || null,
      };

      if (!payload.title) {
        toast("Validación", "El título es requerido.", 3000);
        return;
      }

      const res = await APP.supabase
        .from("events")
        .update(payload)
        .eq("id", state.selectedId)
        .select("*")
        .single();

      if (res.error) {
        err("saveEvent error:", res.error);
        toast("Error", "No se pudo guardar (RLS/policies). Revisá consola.", 5200);
        return;
      }

      toast("Guardado", "Cambios guardados.", 1800);

      state.events = await fetchEvents();
      renderList();
      await selectEvent(state.selectedId);
    } finally {
      setBusy(false, "");
    }
  }

  async function deleteEvent() {
    if (!state.selectedId) return;
    const ok = confirm("¿Eliminar este evento? Esto no se puede deshacer.");
    if (!ok) return;

    setBusy(true, "Eliminando…");

    try {
      const res = await APP.supabase
        .from("events")
        .delete()
        .eq("id", state.selectedId);

      if (res.error) {
        err("deleteEvent error:", res.error);
        toast("Error", "No se pudo eliminar (RLS/policies).", 5200);
        return;
      }

      toast("Eliminado", "Evento eliminado.", 2000);

      state.selectedId = null;
      clearForm();
      showEditorEmpty(true);

      state.events = await fetchEvents();
      renderList();
    } finally {
      setBusy(false, "");
    }
  }

  function wireUI() {
    // Evitar doble wiring
    if (document.body.dataset.eventsWired === "1") return;
    document.body.dataset.eventsWired = "1";

    ui.desc?.addEventListener("input", () => {
      if (ui.descCount) ui.descCount.textContent = String((ui.desc.value || "").length);
    });

    ui.newBtn?.addEventListener("click", createEvent);
    ui.dupBtn?.addEventListener("click", duplicateEvent);
    ui.form?.addEventListener("submit", saveEvent);
    ui.deleteBtn?.addEventListener("click", deleteEvent);

    // Botón "Administrar fechas" -> cambia tab a "dates"
    ui.addDateBtn?.addEventListener("click", () => {
      setActiveTab("dates");
    });

    // Búsqueda global
    ui.search?.addEventListener("input", () => {
      const q = String(ui.search.value || "").trim().toLowerCase();
      if (!q) return renderList();

      const filtered = state.events.filter((ev) => {
        const t = String(ev.title || "").toLowerCase();
        const ty = String(ev.type || "").toLowerCase();
        const m = String(ev.month_key || "").toLowerCase();
        return t.includes(q) || ty.includes(q) || m.includes(q);
      });

      renderList(filtered);
    });
  }

  async function boot(detail) {
    if (BOOTED) return;
    BOOTED = true;

    if (!ensureSupabase()) return;

    log("boot", { VERSION, user: detail || null, title: document.title });

    // Tabs + UI
    wireTabs();
    wireUI();

    // Tab default
    setActiveTab("events");

    // Estado inicial editor
    showEditorEmpty(true);

    // Data load (ya con sesión lista)
    state.events = await fetchEvents();
    renderList();

    // Señal visual
    note(ui.storageNote, "", "");
  }

  // Si ya está listo, arrancar. Si no, esperar admin:ready.
  if (window.APP && APP.__adminReady) {
    boot();
  } else {
    window.addEventListener(
      "admin:ready",
      (e) => {
        // e.detail tiene userId/email si lo emitís así desde admin-auth
        boot(e?.detail || {});
      },
      { once: true }
    );
  }
})();
