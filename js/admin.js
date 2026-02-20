"use strict";

/**
 * admin.js ✅ PRO (SUPABASE CRUD EVENTS + BINDINGS) — 2026-02-20 ✅
 *
 * - CRUD events
 * - Editor: carga URLs por slot desde v_media_bindings_latest
 * - Guardar: si pegás URL, crea asset (nuevo) + UPSERT binding (reemplaza el slot)
 *
 * NO inyecta panel de Media aquí (para evitar duplicados).
 * El panel único está en admin-media.js (tab Medios).
 */

(function () {
  const VERSION = "2026-02-20.2";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const appPanel = $("#appPanel");
  if (!appPanel) return;

  // ---------------------------
  // Utils
  // ---------------------------
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
    note.textContent = on ? (msg || "Procesando…") : (msg || "");
  }

  function cleanSpaces(s) {
    return String(s ?? "").replace(/\s+/g, " ").trim();
  }

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
    return String(err?.message || err || "Ocurrió un error.");
  }

  // ---------------------------
  // DB mapping (tu BD real)
  // ---------------------------
  const EVENTS_TABLE = "events";
  const ASSETS_TABLE = "media_assets";
  const BINDINGS_TABLE = "media_bindings";
  const VIEW_LATEST = "v_media_bindings_latest";

  const SELECT_EVENTS = `
    id,
    title,
    type,
    month_key,
    description,
    location,
    time_range,
    duration_hours,
    price_amount,
    price_currency,
    more_img_alt,
    created_at,
    updated_at
  `;

  const EVENT_SLOTS = ["slide_img", "slide_video", "desktop_event", "mobile_event", "event_more"];

  const state = {
    activeTab: "events",
    query: "",
    activeEventId: null,
    events: [],
    mode: "supabase",
    busy: false,
    didBind: false,
    didBoot: false,
    didLoadOnce: false,
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
  // Media helpers (assets + bindings)
  // ============================================================
  async function insertAssetFromUrl({ folder, name, url }) {
    const sb = getSB();
    if (!sb) throw new Error("APP.supabase no existe.");

    const payload = {
      folder: cleanSpaces(folder || "external"),
      name: cleanSpaces(name || "asset"),
      path: cleanSpaces(url || ""),
      public_url: cleanSpaces(url || "") || null,
      mime: null,
      bytes: null,
    };

    const { data, error } = await sb
      .from(ASSETS_TABLE)
      .insert(payload)
      .select("id")
      .single();

    if (error) throw error;
    return data;
  }

  async function upsertBinding({ scope = "event", scope_id, slot, media_id, note = null }) {
    const sb = getSB();
    if (!sb) throw new Error("APP.supabase no existe.");

    const payload = {
      scope: String(scope || "event"),
      scope_id: String(scope_id),
      slot: String(slot || "misc"),
      media_id: String(media_id),
      note: note ? String(note) : null,
      updated_at: new Date().toISOString(),
    };

    const { error } = await sb.from(BINDINGS_TABLE).upsert(payload, {
      onConflict: "scope,scope_id,slot",
    });

    if (error) throw error;
  }

  async function deleteBindingsForSlot({ scope = "event", scope_id, slot }) {
    const sb = getSB();
    if (!sb) throw new Error("APP.supabase no existe.");

    const { error } = await sb
      .from(BINDINGS_TABLE)
      .delete()
      .eq("scope", String(scope || "event"))
      .eq("scope_id", String(scope_id))
      .eq("slot", String(slot));

    if (error) throw error;
  }

  async function fetchEventSlotUrlsLatest(eventId) {
    const sb = getSB();
    if (!sb) throw new Error("APP.supabase no existe.");

    const eid = String(eventId || "").trim();
    if (!eid) return {};

    const { data, error } = await sb
      .from(VIEW_LATEST)
      .select("slot, public_url, path")
      .eq("scope", "event")
      .eq("scope_id", eid)
      .in("slot", EVENT_SLOTS);

    if (error) throw error;

    const map = {};
    (Array.isArray(data) ? data : []).forEach((r) => {
      const slot = String(r?.slot || "").trim();
      const url = String(r?.public_url || r?.path || "").trim();
      if (slot) map[slot] = url;
    });
    return map;
  }

  // ============================================================
  // Tabs
  // ============================================================
  function hideAllTabs() {
    $$('[role="tabpanel"]', appPanel).forEach((p) => (p.hidden = true));
  }

  function setTab(tabName) {
    const next = tabName || "events";
    if (next === state.activeTab) return;

    state.activeTab = next;

    $$(".tab", appPanel).forEach((t) => {
      t.setAttribute("aria-selected", t.dataset.tab === state.activeTab ? "true" : "false");
    });

    hideAllTabs();
    const panel = $("#tab-" + state.activeTab);
    if (panel) panel.hidden = false;

    if (state.activeTab === "events") {
      ensureEventsLoaded(false);
      renderAll();
    }
  }

  // ============================================================
  // Supabase CRUD events
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
      setBusy(false, isRLSError(error) ? "RLS bloquea events." : "No se pudieron cargar eventos.");
      throw error;
    }

    state.mode = "supabase";
    state.events = Array.isArray(data) ? data : [];
    state.didLoadOnce = true;
    setBusy(false, "");
  }

  async function insertEvent(payload) {
    const sb = getSB();
    if (!sb) throw new Error("APP.supabase no existe.");

    const { data, error } = await sb.from(EVENTS_TABLE).insert(payload).select(SELECT_EVENTS).single();
    if (error) throw error;
    return data;
  }

  async function updateEvent(id, payload) {
    const sb = getSB();
    if (!sb) throw new Error("APP.supabase no existe.");

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
    if (!sb) throw new Error("APP.supabase no existe.");

    const { error } = await sb.from(EVENTS_TABLE).delete().eq("id", id);
    if (error) throw error;

    // limpiar bindings del evento
    try {
      const del = await sb.from(BINDINGS_TABLE).delete().eq("scope", "event").eq("scope_id", id);
      if (del.error) throw del.error;
    } catch (e) {
      console.warn("[admin] cleanup bindings failed:", e);
    }
  }

  // ============================================================
  // Render: list + editor
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
      "evDesc",
      "evLocation",
      "evTimeRange",
      "evDurationHours",
      "evPriceAmount",
      "evPriceCurrency",
      "evImg",
      "evImgDesktop",
      "evImgMobile",
      "evVideoUrl",
      "evMoreImg",
      "evMoreImgAlt",
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
            <p class="itemMeta">Faltan policies para <code>events</code>.</p>
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

      item.addEventListener("click", async () => {
        state.activeEventId = ev.id;
        await renderAll();
      });

      box.appendChild(item);
    });
  }

  async function renderEventEditor() {
    const ev = (state.events || []).find((e) => String(e.id) === String(state.activeEventId)) || null;

    if (!ev) {
      clearEditorForm();
      setEditorVisible(false);
      return;
    }

    setEditorVisible(true);

    $("#eventId") && ($("#eventId").value = String(ev.id || ""));
    $("#evTitle") && ($("#evTitle").value = ev.title || "");

    const typeEl = $("#evType");
    if (typeEl) {
      const dbType = String(ev.type || "Cata de vino");
      const hasOption = Array.from(typeEl.options || []).some((o) => String(o.value) === dbType);
      typeEl.value = hasOption ? dbType : "Cata de vino";
      if (!hasOption && dbType) setNote(`Nota: el tipo guardado en DB es "${dbType}".`);
    }

    $("#evMonth") && ($("#evMonth").value = String(ev.month_key || "ENERO"));

    const d = ev.description || "";
    $("#evDesc") && ($("#evDesc").value = d);
    $("#descCount") && ($("#descCount").textContent = String(String(d).length));

    $("#evLocation") && ($("#evLocation").value = ev.location || "");
    $("#evTimeRange") && ($("#evTimeRange").value = ev.time_range || "");
    $("#evDurationHours") && ($("#evDurationHours").value = ev.duration_hours || "");

    const altEl = $("#evMoreImgAlt");
    if (altEl) altEl.value = ev.more_img_alt || "";

    // slots latest
    try {
      const map = await fetchEventSlotUrlsLatest(ev.id);
      $("#evImg") && ($("#evImg").value = map.slide_img || "");
      $("#evVideoUrl") && ($("#evVideoUrl").value = map.slide_video || "");
      $("#evImgDesktop") && ($("#evImgDesktop").value = map.desktop_event || "");
      $("#evImgMobile") && ($("#evImgMobile").value = map.mobile_event || "");
      $("#evMoreImg") && ($("#evMoreImg").value = map.event_more || "");
    } catch (err) {
      console.error(err);
      toast("Media", "No se pudieron cargar bindings (revisá view/policies).", 4200);
    }
  }

  async function renderAll() {
    if (state.activeTab !== "events") return;
    renderEventList();
    await renderEventEditor();
  }

  async function ensureEventsLoaded(force) {
    if (state.mode === "missing") return;
    if (state.didLoadOnce && !force) return;

    try {
      await fetchEvents();
      if (!state.activeEventId && state.events.length) state.activeEventId = state.events[0].id;
    } catch (err) {
      console.error(err);
      toast(isRLSError(err) ? "RLS" : "Supabase", prettyError(err), 5200);
    } finally {
      await renderAll();
    }
  }

  // ============================================================
  // Actions
  // ============================================================
  const createNewEvent = withLock(async function () {
    try {
      if (state.mode !== "supabase") return toast("Bloqueado", "Supabase no está listo o RLS bloquea.");

      setBusy(true, "Creando evento…");

      const payload = {
        title: "Nuevo evento",
        type: $("#evType")?.value || "Cata de vino",
        month_key: "ENERO",
        description: "",
        location: "Por confirmar",
        time_range: "",
        duration_hours: "",
        price_amount: null,
        price_currency: "USD",
        more_img_alt: "",
      };

      const created = await insertEvent(payload);

      state.events.unshift(created);
      state.activeEventId = created.id;

      toast("Evento creado", "Ya podés editarlo.", 1600);
      await renderAll();
      await ensureEventsLoaded(true);
    } catch (err) {
      console.error(err);
      toast(isRLSError(err) ? "RLS" : "Error", prettyError(err), 5200);
    } finally {
      setBusy(false, "");
    }
  });

  const duplicateActiveEvent = withLock(async function () {
    const ev = (state.events || []).find((e) => String(e.id) === String(state.activeEventId));
    if (!ev) return toast("Duplicar", "Seleccioná un evento primero.");

    try {
      if (state.mode !== "supabase") return toast("Bloqueado", "Supabase no está listo o RLS bloquea.");

      setBusy(true, "Duplicando evento…");

      const payload = {
        title: `${ev.title || "Evento"} (Copia)`,
        type: ev.type || "Cata de vino",
        month_key: String(ev.month_key || "ENERO"),
        description: ev.description || "",
        location: ev.location || "Por confirmar",
        time_range: ev.time_range || "",
        duration_hours: ev.duration_hours || "",
        price_amount: ev.price_amount == null ? null : ev.price_amount,
        price_currency: ev.price_currency || "USD",
        more_img_alt: ev.more_img_alt || "",
      };

      const created = await insertEvent(payload);

      // copiar bindings latest (si existe el view)
      try {
        const sb = getSB();
        if (sb) {
          const { data: latest, error } = await sb
            .from(VIEW_LATEST)
            .select("slot, media_id")
            .eq("scope", "event")
            .eq("scope_id", String(ev.id))
            .in("slot", EVENT_SLOTS);

          if (!error && Array.isArray(latest)) {
            for (const row of latest) {
              if (!row?.media_id || !row?.slot) continue;
              await upsertBinding({
                scope: "event",
                scope_id: String(created.id),
                slot: String(row.slot),
                media_id: String(row.media_id),
                note: "dup_from_event",
              });
            }
          }
        }
      } catch (e) {
        console.warn("[admin] duplicate bindings failed:", e);
      }

      state.events.unshift(created);
      state.activeEventId = created.id;

      toast("Duplicado", "Copia creada.", 1500);
      await renderAll();
      await ensureEventsLoaded(true);
    } catch (err) {
      console.error(err);
      toast(isRLSError(err) ? "RLS" : "Error", prettyError(err), 5200);
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
      if (state.mode !== "supabase") return toast("Bloqueado", "Supabase no está listo o RLS bloquea.");

      setBusy(true, "Eliminando evento…");
      await deleteEvent(ev.id);

      state.events = (state.events || []).filter((x) => String(x.id) !== String(ev.id));
      state.activeEventId = null;

      toast("Evento eliminado", "Se eliminó correctamente.", 1600);
      await renderAll();
      await ensureEventsLoaded(true);
    } catch (err) {
      console.error(err);
      toast(isRLSError(err) ? "RLS" : "Error", prettyError(err), 5200);
    } finally {
      setBusy(false, "");
    }
  });

  const saveActiveEvent = withLock(async function () {
    const ev = (state.events || []).find((e) => String(e.id) === String(state.activeEventId));
    if (!ev) return false;

    const title = cleanSpaces($("#evTitle")?.value || "");
    if (!title) return toast("Falta el nombre", "Ingresá el nombre del evento."), false;

    const payload = {
      title,
      type: cleanSpaces($("#evType")?.value || "Cata de vino"),
      month_key: cleanSpaces($("#evMonth")?.value || "ENERO"),
      description: cleanSpaces($("#evDesc")?.value || ""),
      location: cleanSpaces($("#evLocation")?.value || "") || "Por confirmar",
      time_range: cleanSpaces($("#evTimeRange")?.value || ""),
      duration_hours: cleanSpaces($("#evDurationHours")?.value || ""),
      more_img_alt: cleanSpaces($("#evMoreImgAlt")?.value || ev.more_img_alt || ""),
    };

    const slotToUrl = {
      slide_img: cleanSpaces($("#evImg")?.value || ""),
      slide_video: cleanSpaces($("#evVideoUrl")?.value || ""),
      desktop_event: cleanSpaces($("#evImgDesktop")?.value || ""),
      mobile_event: cleanSpaces($("#evImgMobile")?.value || ""),
      event_more: cleanSpaces($("#evMoreImg")?.value || ""),
    };

    try {
      setBusy(true, "Guardando cambios…");

      const updated = await updateEvent(ev.id, payload);

      for (const slot of EVENT_SLOTS) {
        const url = slotToUrl[slot] || "";

        if (!url) {
          await deleteBindingsForSlot({ scope: "event", scope_id: ev.id, slot });
          continue;
        }

        const isSupabaseStorage = url.includes("/storage/v1/object/public/");
        const folder = isSupabaseStorage ? "events" : "external";

        const asset = await insertAssetFromUrl({ folder, name: slot, url });

        await upsertBinding({
          scope: "event",
          scope_id: String(ev.id),
          slot,
          media_id: String(asset.id),
          note: "admin_bind_from_url",
        });
      }

      state.events = (state.events || []).map((x) => (String(x.id) === String(updated.id) ? updated : x));

      toast("Guardado", "Evento actualizado + bindings actualizados.", 1600);
      setNote("");

      await renderAll();
      await ensureEventsLoaded(true);
      return true;
    } catch (err) {
      console.error(err);
      toast(isRLSError(err) ? "RLS" : "Error", prettyError(err), 5200);
      return false;
    } finally {
      setBusy(false, "");
    }
  });

  // ============================================================
  // Wiring
  // ============================================================
  function bindOnce() {
    if (state.didBind) return;
    state.didBind = true;

    $$(".tab", appPanel).forEach((t) => t.addEventListener("click", () => setTab(t.dataset.tab)));

    $("#search")?.addEventListener("input", (e) => {
      state.query = e.target.value || "";
      renderAll();
    });

    $("#newEventBtn")?.addEventListener("click", createNewEvent);
    $("#dupEventBtn")?.addEventListener("click", duplicateActiveEvent);
    $("#deleteEventBtn")?.addEventListener("click", deleteActiveEvent);

    $("#eventForm")?.addEventListener("submit", (e) => {
      e.preventDefault();
      saveActiveEvent();
    });

    $("#saveEventBtn")?.addEventListener("click", (e) => {
      e.preventDefault();
      saveActiveEvent();
    });

    $("#evDesc")?.addEventListener("input", () => {
      const v = $("#evDesc")?.value || "";
      $("#descCount") && ($("#descCount").textContent = String(v.length));
    });
  }

  function boot() {
    if (state.didBoot) return;
    state.didBoot = true;

    console.log("[admin.js] boot", { VERSION });

    bindOnce();
    state.activeTab = "__init__";
    setTab("events");
  }

  if (window.APP && APP.__adminReady) {
    boot();
  } else {
    window.addEventListener("admin:ready", boot, { once: true });
  }
})();