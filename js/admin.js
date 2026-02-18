"use strict";

/**
 * admin.js ✅ PRO (SUPABASE CRUD EVENTS) — 2026-02 PATCH (precio) + FIX description + VIDEO (mínimo)
 * + ✅ PATCH 2026-02-17: soporte opcional (NO rompe) para:
 *   - events.img_desktop (text)
 *   - events.img_mobile  (text)
 *   - events.more_img    (text)
 *   - events.more_img_alt(text)
 *
 * Objetivo:
 * - Mantener TODO lo demás igual.
 * - Si la DB aún NO tiene esas columnas -> NO falla (fallback automático a SELECT legacy).
 * - Si el HTML aún NO tiene inputs nuevos -> NO falla (ignora).
 * - No pisa valores existentes si input no existe / viene vacío.
 */

(function () {
  const VERSION = "2026-02-17.2"; // ✅ bump por fix missing-column detector

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

  // ============================================================
  // Utils
  // ============================================================
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

  // ✅ Precio
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

  // ✅ Column missing (schema legacy) — FIX robusto para PostgREST
  function isMissingColumnError(err) {
    const code = String(err?.code || "").toUpperCase();
    const msg = String(err?.message || "").toLowerCase();
    const details = String(err?.details || "").toLowerCase();
    const hint = String(err?.hint || "").toLowerCase();

    // Postgres undefined_column = 42703
    if (code === "42703") return true;

    // PostgREST: "Could not find the 'xyz' column..." (suele ser PGRST204)
    if (code === "PGRST204") return true;

    // Fallback por texto (varía según versión)
    const hayColumnaInexistente =
      (msg.includes("does not exist") && msg.includes("column")) ||
      msg.includes("could not find the") ||
      msg.includes("unknown field") ||
      details.includes("could not find the") ||
      hint.includes("could not find the");

    return hayColumnaInexistente;
  }

  function prettyError(err) {
    const msg = String(err?.message || err || "");
    return msg || "Ocurrió un error.";
  }

  // ============================================================
  // DB mapping
  // ============================================================
  const EVENTS_TABLE = "events";

  // Legacy (solo lo que ya existía)
  const SELECT_EVENTS_V1 = `
    id,
    title,
    type,
    month_key,
    description,
    img,
    video_url,
    location,
    time_range,
    duration_hours,
    price_amount,
    price_currency,
    created_at,
    updated_at
  `;

  // V2 (opcional: imágenes separadas + ver más)
  const SELECT_EVENTS_V2 = `
    id,
    title,
    type,
    month_key,
    description,
    img,
    img_desktop,
    img_mobile,
    more_img,
    more_img_alt,
    video_url,
    location,
    time_range,
    duration_hours,
    price_amount,
    price_currency,
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
    didBoot: false,
    didLoadOnce: false,

    // ✅ Schema capability (auto-detect)
    schema: {
      selectV2: null, // null = unknown, true/false decided at runtime
    },
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

    // ✅ Intento V2 primero (si no sabemos / si sabemos que existe)
    const tryV2First = state.schema.selectV2 !== false;

    const runSelect = async (selectStr) => {
      return await sb
        .from(EVENTS_TABLE)
        .select(selectStr)
        .order("created_at", { ascending: false });
    };

    let data, error;

    if (tryV2First) {
      ({ data, error } = await runSelect(SELECT_EVENTS_V2));
      if (error && isMissingColumnError(error)) {
        // fallback a legacy
        state.schema.selectV2 = false;
        ({ data, error } = await runSelect(SELECT_EVENTS_V1));
      } else if (!error) {
        state.schema.selectV2 = true;
      }
    } else {
      ({ data, error } = await runSelect(SELECT_EVENTS_V1));
    }

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

    const selectStr = state.schema.selectV2 ? SELECT_EVENTS_V2 : SELECT_EVENTS_V1;

    const { data, error } = await sb
      .from(EVENTS_TABLE)
      .insert(payload)
      .select(selectStr)
      .single();

    if (error) throw error;
    return data;
  }

  async function updateEvent(id, payload) {
    const sb = getSB();
    if (!sb) throw new Error("APP.supabase no existe. Revisá el orden: supabaseClient.js → admin.js");

    const selectStr = state.schema.selectV2 ? SELECT_EVENTS_V2 : SELECT_EVENTS_V1;

    const { data, error } = await sb
      .from(EVENTS_TABLE)
      .update(payload)
      .eq("id", id)
      .select(selectStr)
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
      "eventId","evTitle","evType","evMonth","evImg","evDesc","evVideoUrl",
      "evLocation","evTimeRange","evDurationHours","evDuration",
      "evPriceAmount","evPriceCurrency",

      // ✅ opcionales (pueden no existir en el HTML todavía)
      "evImgDesktop","evImgMobile","evMoreImg","evMoreImgAlt",
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

    // ✅ Mantener evImg como "fallback/general"
    $("#evImg") && ($("#evImg").value = ev.img || "");

    // ✅ Nuevos campos (si existen en el HTML)
    const imgDeskEl = $("#evImgDesktop");
    const imgMobEl = $("#evImgMobile");
    const moreImgEl = $("#evMoreImg");
    const moreAltEl = $("#evMoreImgAlt");

    if (imgDeskEl) imgDeskEl.value = ev.img_desktop || "";
    if (imgMobEl) imgMobEl.value = ev.img_mobile || "";
    if (moreImgEl) moreImgEl.value = ev.more_img || "";
    if (moreAltEl) moreAltEl.value = ev.more_img_alt || "";

    // ✅ Video URL (opcional)
    const vEl = $("#evVideoUrl");
    if (vEl) vEl.value = ev.video_url || "";

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

    // ✅ Precio (si los inputs existen)
    const priceAmountEl = $("#evPriceAmount");
    const priceCurrencyEl = $("#evPriceCurrency");

    if (priceAmountEl) {
      const pa = ev.price_amount;
      priceAmountEl.value = pa == null ? "" : String(pa);
    }
    if (priceCurrencyEl) {
      priceCurrencyEl.value = normalizeCurrency(ev.price_currency, "USD");
    }
  }

  function renderAll() {
    if (state.activeTab !== "events") return;
    renderEventList();
    renderEventEditor();
  }

  // ============================================================
  // On-demand loader
  // ============================================================
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
      renderAll();
    }
  }

  // ============================================================
  // Helpers: payload safe (no pisa si no hay input / vacío)
  // ============================================================
  function readOptionalInputValue(id) {
    const el = document.getElementById(id);
    if (!el) return { exists: false, value: "" };
    return { exists: true, value: cleanSpaces(el.value || "") };
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

      // ✅ payload base (legacy seguro)
      const payload = {
        title: "Nuevo evento",
        type: typeFallback,
        month_key: "ENERO",
        img: "./assets/img/hero-1.jpg",
        video_url: "",
        description: "",
        location: "Por confirmar",
        time_range: "",
        duration_hours: "",
        price_amount: null,
        price_currency: "USD",
      };

      // ✅ si el schema V2 existe, agregamos campos nuevos sin romper
      if (state.schema.selectV2 === true) {
        payload.img_desktop = "";
        payload.img_mobile = "";
        payload.more_img = "";
        payload.more_img_alt = "";
      }

      const created = await insertEvent(payload);

      state.events.unshift(created);
      state.activeEventId = created.id;

      toast("Evento creado", "Ya podés editarlo y guardarlo.", 1600);
      renderAll();

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
        img: ev.img || "./assets/img/hero-1.jpg",
        video_url: ev.video_url || "",
        description: ev.description || "",
        location: ev.location || "Por confirmar",
        time_range: ev.time_range || "",
        duration_hours: ev.duration_hours || "",
        price_amount: ev.price_amount == null ? null : ev.price_amount,
        price_currency: normalizeCurrency(ev.price_currency, "USD"),
      };

      if (state.schema.selectV2 === true) {
        payload.img_desktop = ev.img_desktop || "";
        payload.img_mobile = ev.img_mobile || "";
        payload.more_img = ev.more_img || "";
        payload.more_img_alt = ev.more_img_alt || "";
      }

      const created = await insertEvent(payload);

      state.events.unshift(created);
      state.activeEventId = created.id;

      toast("Duplicado", "Copia creada.", 1500);
      renderAll();

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
      renderAll();

      try { await ensureEventsLoaded(true); } catch (_) {}
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
    const type = cleanSpaces($("#evType")?.value || "Cata de vino");
    const month_key = normalizeMonth($("#evMonth")?.value || "ENERO");

    const img = cleanSpaces($("#evImg")?.value || "");

    // ✅ Importante: si el input no existe o está vacío, NO queremos borrar el valor en DB.
    const video_url_input = cleanSpaces($("#evVideoUrl")?.value || "");

    const description = cleanSpaces($("#evDesc")?.value || "");

    const location = cleanSpaces($("#evLocation")?.value || "");
    const time_range = normalizeTimeRange($("#evTimeRange")?.value || "");
    const duration_hours = parseHoursNumber($("#evDurationHours")?.value || "");

    const priceAmountEl = $("#evPriceAmount");
    const priceCurrencyEl = $("#evPriceCurrency");

    let price_amount = ev.price_amount == null ? null : ev.price_amount;
    let price_currency = normalizeCurrency(ev.price_currency, "USD");

    if (priceAmountEl) {
      const parsed = parseMoneyAmount(priceAmountEl.value);
      price_amount = parsed;
    }
    if (priceCurrencyEl) {
      price_currency = normalizeCurrency(priceCurrencyEl.value, "USD");
    }

    if (!title) {
      toast("Falta el nombre", "Ingresá el nombre del evento.");
      return false;
    }

    // ✅ FIX: mantener el video previo si no hay valor nuevo
    const final_video_url = video_url_input || (ev.video_url || "");

    // ✅ Nuevos inputs opcionales (si existen en el HTML)
    const imgDesk = readOptionalInputValue("evImgDesktop");
    const imgMob = readOptionalInputValue("evImgMobile");
    const moreImg = readOptionalInputValue("evMoreImg");
    const moreAlt = readOptionalInputValue("evMoreImgAlt");

    // ✅ payload base (legacy seguro)
    const payload = {
      title,
      type,
      month_key,
      img: img || "./assets/img/hero-1.jpg",
      video_url: final_video_url,
      description,
      location: location || "Por confirmar",
      time_range,
      duration_hours: duration_hours === "0" ? "" : duration_hours,
      price_amount,
      price_currency,
    };

    // ✅ Solo incluir columnas V2 si el schema existe (evita errores)
    if (state.schema.selectV2 === true) {
      // Si el input existe:
      // - si trae valor -> actualiza
      // - si viene vacío -> conserva el valor anterior (no pisa)
      payload.img_desktop = imgDesk.exists ? (imgDesk.value || (ev.img_desktop || "")) : (ev.img_desktop || "");
      payload.img_mobile  = imgMob.exists  ? (imgMob.value  || (ev.img_mobile  || "")) : (ev.img_mobile  || "");
      payload.more_img    = moreImg.exists ? (moreImg.value || (ev.more_img    || "")) : (ev.more_img    || "");
      payload.more_img_alt= moreAlt.exists ? (moreAlt.value || (ev.more_img_alt|| "")) : (ev.more_img_alt|| "");

      // ✅ Mantener "img" como fallback coherente:
      // preferimos mobile, si no desktop, si no el img actual.
      const fallbackImg = payload.img_mobile || payload.img_desktop || payload.img || (ev.img || "");
      payload.img = fallbackImg || "./assets/img/hero-1.jpg";
    }

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

      try { await ensureEventsLoaded(true); } catch (_) {}
      return true;
    } catch (err) {
      console.error(err);

      // ✅ Si por alguna razón falló por columnas faltantes, degradamos schema y reintentamos 1 vez (sin romper)
      if (isMissingColumnError(err) && state.schema.selectV2 !== false) {
        try {
          state.schema.selectV2 = false;

          // Remover campos V2 del payload y reintentar
          const payloadLegacy = { ...payload };
          delete payloadLegacy.img_desktop;
          delete payloadLegacy.img_mobile;
          delete payloadLegacy.more_img;
          delete payloadLegacy.more_img_alt;

          setBusy(true, "Guardando cambios…");
          const updated2 = await updateEvent(ev.id, payloadLegacy);

          state.events = (state.events || []).map((x) =>
            String(x.id) === String(updated2.id) ? updated2 : x
          );

          toast("Guardado", "Evento actualizado en Supabase.", 1400);
          setNote("");
          renderAll();

          try { await ensureEventsLoaded(true); } catch (_) {}
          return true;
        } catch (err2) {
          console.error(err2);
          if (isRLSError(err2)) {
            state.mode = "blocked";
            toast("RLS", "Falta policy UPDATE para events (admins).", 5200);
          } else {
            toast("Error", prettyError(err2), 5200);
          }
          return false;
        } finally {
          setBusy(false, "");
        }
      }

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

  // ============================================================
  // Boot (espera admin:ready)
  // ============================================================
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
