"use strict";

/**
 * admin.js ✅ PRO (SUPABASE CRUD EVENTS + MEDIA_ITEMS) — 2026-02 MEDIA PATCH
 * - events: SOLO datos + more_img_alt
 * - media_items: fuente de verdad de media por evento:
 *    - event_img_desktop
 *    - event_img_mobile (opcional)
 *    - event_video (hero video home)
 *    - event_more_img (modal / ver más)
 * - NO usa events.img / events.video_url
 */

(function () {
  const VERSION = "2026-02-18.2";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const appPanel = $("#appPanel");
  if (!appPanel) return;

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
    if (!on && msg == null) return;
    note.textContent = on ? (msg || "Procesando…") : (msg || "");
  }

  function cleanSpaces(s) {
    return String(s ?? "").replace(/\s+/g, " ").trim();
  }

  const MONTHS = [
    "ENERO","FEBRERO","MARZO","ABRIL","MAYO","JUNIO",
    "JULIO","AGOSTO","SEPTIEMBRE","OCTUBRE","NOVIEMBRE","DICIEMBRE",
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

  function normalizeCurrency(input, fallback = "USD") {
    const v = cleanSpaces(input).toUpperCase();
    if (!v) return fallback;
    if (v === "USD" || v === "CRC") return v;
    if (v.includes("$")) return "USD";
    if (v.includes("₡")) return "CRC";
    return fallback;
  }

  function parseMoneyAmount(input) {
    const raw = cleanSpaces(input);
    if (!raw) return null;

    const cleaned = raw
      .replace(/[^\d.,-]/g, "")
      .replace(",", ".");

    const m = cleaned.match(/-?\d+(\.\d+)?/);
    if (!m) return null;

    const n = Number(m[0]);
    if (!Number.isFinite(n) || n < 0) return null;

    return Math.round(n * 100) / 100;
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
    const msg = String(err?.message || err || "");
    return msg || "Ocurrió un error.";
  }

  // ============================================================
  // DB mapping
  // ============================================================
  const EVENTS_TABLE = "events";
  const MEDIA_TABLE = "media_items";

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
  // Media helpers (event)
  // ============================================================
  const EVENT_FOLDERS = ["event_img_desktop", "event_img_mobile", "event_video", "event_more_img"];

  async function fetchEventMedia(eventId) {
    const sb = getSB();
    if (!sb) throw new Error("APP.supabase no existe.");

    const eid = String(eventId || "").trim();
    if (!eid) return {};

    // 🔥 ordena por updated_at desc para quedarnos con el más reciente por folder
    const { data, error } = await sb
      .from(MEDIA_TABLE)
      .select("id, folder, public_url, path, updated_at")
      .eq("target", "event")
      .eq("event_id", eid)
      .in("folder", EVENT_FOLDERS)
      .order("updated_at", { ascending: false });

    if (error) throw error;

    const map = {};
    (Array.isArray(data) ? data : []).forEach((row) => {
      const f = String(row?.folder || "").trim();
      const url = String(row?.public_url || row?.path || "").trim();
      if (!f || !url) return;
      // como viene desc, el primero por folder es el más nuevo
      if (!map[f]) map[f] = url;
    });

    return map;
  }

  async function upsertEventMedia(eventId, folder, url) {
    const sb = getSB();
    if (!sb) throw new Error("APP.supabase no existe.");

    const eid = String(eventId || "").trim();
    const f = String(folder || "").trim();
    const u = String(url || "").trim();

    if (!eid || !f) return;

    // si vacío => borramos
    if (!u) {
      const del = await sb
        .from(MEDIA_TABLE)
        .delete()
        .eq("target", "event")
        .eq("event_id", eid)
        .eq("folder", f);

      if (del.error) throw del.error;
      return;
    }

    const payload = {
      target: "event",
      folder: f,
      name: f,
      path: u,
      public_url: u,
      event_id: eid,
    };

    // ✅ conflicto robusto: intenta (target,event_id,folder) y si tu índice es (event_id,folder) también lo soporta
    let res = await sb.from(MEDIA_TABLE).upsert(payload, { onConflict: "target,event_id,folder" });
    if (res.error) {
      // fallback por si tu unique está definido solo en (event_id,folder) con índice parcial
      res = await sb.from(MEDIA_TABLE).upsert(payload, { onConflict: "event_id,folder" });
    }
    if (res.error) throw res.error;
  }

  // ============================================================
  // Tabs
  // ============================================================
  function hideAllTabs() {
    $$('[role="tabpanel"]', appPanel).forEach((p) => { p.hidden = true; });
  }

  function emitTab(tabName) {
    try {
      window.dispatchEvent(new CustomEvent("admin:tab", { detail: { tab: tabName } }));
    } catch (_) {}
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

    emitTab(state.activeTab);

    if (state.activeTab === "events") {
      ensureEventsLoaded(false);
      renderAll();
    }
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
      setBusy(
        false,
        isRLSError(error)
          ? "RLS bloquea. Faltan policies para events."
          : "No se pudieron cargar eventos."
      );
      throw error;
    }

    state.mode = "supabase";
    state.events = Array.isArray(data) ? data : [];
    state.didLoadOnce = true;
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

    // Limpieza media asociada (best effort)
    try {
      await sb.from(MEDIA_TABLE).delete().eq("target", "event").eq("event_id", id);
    } catch (_) {}
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
      "eventId","evTitle","evType","evMonth",
      "evDesc","evLocation","evTimeRange","evDurationHours","evDuration",
      "evPriceAmount","evPriceCurrency",
      // media fields (tolerantes)
      "evImg","evImgDesktop","evImgMobile",
      "evVideo","evVideoDesktop",
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
            <p class="itemMeta">Faltan policies SELECT/INSERT/UPDATE/DELETE para <code>events</code> y <code>media_items</code>.</p>
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

  // ✅ Carga media_items y llena campos del editor
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
      if (!hasOption && dbType) {
        setNote(`Nota: el tipo guardado en DB es "${dbType}". Ajustá el selector si querés incluirlo.`);
      }
    }

    $("#evMonth") && ($("#evMonth").value = normalizeMonth(ev.month_key));
    const d = ev.description || "";
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

    const priceAmountEl = $("#evPriceAmount");
    const priceCurrencyEl = $("#evPriceCurrency");

    if (priceAmountEl) {
      const pa = ev.price_amount;
      priceAmountEl.value = pa == null ? "" : String(pa);
    }
    if (priceCurrencyEl) {
      priceCurrencyEl.value = normalizeCurrency(ev.price_currency, "USD");
    }

    // ✅ more_img_alt vive en events
    const altEl = $("#evMoreImgAlt");
    if (altEl) altEl.value = ev.more_img_alt || "";

    // ✅ Media desde media_items
    try {
      const media = await fetchEventMedia(ev.id);

      const imgDesktopEl = $("#evImgDesktop") || $("#evImg"); // compat legacy
      const imgMobileEl = $("#evImgMobile");
      const videoEl = $("#evVideo") || $("#evVideoDesktop");
      const moreImgEl = $("#evMoreImg");

      if (imgDesktopEl) imgDesktopEl.value = media.event_img_desktop || "";
      if (imgMobileEl) imgMobileEl.value = media.event_img_mobile || "";
      if (videoEl) videoEl.value = media.event_video || "";
      if (moreImgEl) moreImgEl.value = media.event_more_img || "";
    } catch (err) {
      console.error(err);
      toast("Media", isRLSError(err)
        ? "RLS bloquea media_items (falta policy SELECT/UPDATE/INSERT/DELETE)."
        : "No se pudo cargar media_items del evento (revisá consola).", 5200);
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
      await renderAll();
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
      const typeFallback = $("#evType")?.value || "Cata de vino";

      const payload = {
        title: "Nuevo evento",
        type: typeFallback,
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

      toast("Evento creado", "Ya podés editarlo y guardarlo.", 1600);
      await renderAll();

      try { await ensureEventsLoaded(true); } catch (_) {}
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
        description: ev.description || "",
        location: ev.location || "Por confirmar",
        time_range: ev.time_range || "",
        duration_hours: ev.duration_hours || "",
        price_amount: ev.price_amount == null ? null : ev.price_amount,
        price_currency: normalizeCurrency(ev.price_currency, "USD"),
        more_img_alt: ev.more_img_alt || "",
      };

      const created = await insertEvent(payload);

      // Duplicar media_items del evento original (si existe)
      try {
        const m = await fetchEventMedia(ev.id);
        await upsertEventMedia(created.id, "event_img_desktop", m.event_img_desktop || "");
        await upsertEventMedia(created.id, "event_img_mobile", m.event_img_mobile || "");
        await upsertEventMedia(created.id, "event_video", m.event_video || "");
        await upsertEventMedia(created.id, "event_more_img", m.event_more_img || "");
      } catch (_) {}

      state.events.unshift(created);
      state.activeEventId = created.id;

      toast("Duplicado", "Copia creada.", 1500);
      await renderAll();

      try { await ensureEventsLoaded(true); } catch (_) {}
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
      await renderAll();

      try { await ensureEventsLoaded(true); } catch (_) {}
    } catch (err) {
      console.error(err);
      if (isRLSError(err)) {
        state.mode = "blocked";
        toast("RLS", "Falta policy DELETE para events/media_items (admins).", 5200);
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

    const description = cleanSpaces($("#evDesc")?.value || "");
    const location = cleanSpaces($("#evLocation")?.value || "");
    const time_range = normalizeTimeRange($("#evTimeRange")?.value || "");
    const duration_hours = parseHoursNumber($("#evDurationHours")?.value || "");

    const priceAmountEl = $("#evPriceAmount");
    const priceCurrencyEl = $("#evPriceCurrency");

    let price_amount = ev.price_amount == null ? null : ev.price_amount;
    let price_currency = normalizeCurrency(ev.price_currency, "USD");

    if (priceAmountEl) price_amount = parseMoneyAmount(priceAmountEl.value);
    if (priceCurrencyEl) price_currency = normalizeCurrency(priceCurrencyEl.value, "USD");

    // more_img_alt en events
    const moreAlt = cleanSpaces(($("#evMoreImgAlt")?.value) || ev.more_img_alt || "");

    if (!title) {
      toast("Falta el nombre", "Ingresá el nombre del evento.");
      return false;
    }

    const payload = {
      title,
      type,
      month_key,
      description,
      location: location || "Por confirmar",
      time_range,
      duration_hours: duration_hours === "0" ? "" : duration_hours,
      price_amount,
      price_currency,
      more_img_alt: moreAlt,
    };

    // Media inputs (compat)
    const imgDesktopEl = $("#evImgDesktop") || $("#evImg"); // legacy
    const imgMobileEl = $("#evImgMobile");
    const videoEl = $("#evVideo") || $("#evVideoDesktop");
    const moreImgEl = $("#evMoreImg");

    const imgDesktopUrl = cleanSpaces(imgDesktopEl?.value || "");
    const imgMobileUrl = cleanSpaces(imgMobileEl?.value || "");
    const videoUrl = cleanSpaces(videoEl?.value || "");
    const moreImgUrl = cleanSpaces(moreImgEl?.value || "");

    try {
      if (state.mode !== "supabase") {
        toast("Bloqueado", "Supabase no está listo o RLS bloquea. Revisá policies.");
        return false;
      }

      setBusy(true, "Guardando cambios…");

      // 1) guarda datos del evento
      const updated = await updateEvent(ev.id, payload);

      // 2) guarda media_items (si esto falla, te lo decimos)
      await upsertEventMedia(ev.id, "event_img_desktop", imgDesktopUrl);
      await upsertEventMedia(ev.id, "event_img_mobile", imgMobileUrl);
      await upsertEventMedia(ev.id, "event_video", videoUrl);
      await upsertEventMedia(ev.id, "event_more_img", moreImgUrl);

      state.events = (state.events || []).map((x) =>
        String(x.id) === String(updated.id) ? updated : x
      );

      toast("Guardado", "Evento y media guardados en Supabase.", 1400);
      setNote("");
      await renderAll();

      try { await ensureEventsLoaded(true); } catch (_) {}
      return true;
    } catch (err) {
      console.error(err);
      if (isRLSError(err)) {
        state.mode = "blocked";
        toast("RLS", "RLS bloquea UPDATE/INSERT en events o media_items. Hay que ajustar policies.", 5200);
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
  function bindOnce() {
    if (state.didBind) return;
    state.didBind = true;

    $$(".tab", appPanel).forEach((t) => {
      t.addEventListener("click", () => setTab(t.dataset.tab));
    });

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

    $("#addDateBtn")?.addEventListener("click", () => {
      toast("Fechas", "Abrí la pestaña “Fechas” para administrar cupos por evento.", 1800);
      if (state.activeTab !== "dates") setTab("dates");
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
