"use strict";

/**
 * ECN Data Layer (Local-first) ✅ PRO
 * - Fuente única de verdad para: events, event_dates (fechas/cupos), media, regs, promos.
 * - Hoy: localStorage (demo).
 * - Luego: reemplazo por Supabase sin cambiar el resto del front.
 *
 * ✅ Cambio clave:
 * - event_dates ahora vive separado (ECN.LS.EVENT_DATES) y events[].dates es "legacy/derivado"
 *   para no romper el sitio público mientras migramos.
 */
(function () {
  // ============================================================
  // Namespace
  // ============================================================
  const ECN = (window.ECN = window.ECN || {});

  // ============================================================
  // Storage keys
  // ============================================================
  ECN.LS = {
    ADMIN_SESSION: "ecn_admin_session",
    EVENTS: "ecn_events",
    EVENT_DATES: "ecn_event_dates", // ✅ NUEVO (mapea tu tabla public.event_dates)
    REGS: "ecn_regs",
    MEDIA: "ecn_media",
    PROMOS: "ecn_promos",
  };

  // ============================================================
  // Defaults (seed)
  // ============================================================
  const DEFAULT_EVENTS = [
    {
      id: "vino-notas-ene",
      type: "Cata de vino",
      monthKey: "ENERO",
      title: "Cata: Notas & Maridajes",
      desc: "Explorá aromas y sabores con maridajes guiados. Ideal para principiantes y curiosos.",
      img: "./assets/img/hero-1.jpg",

      location: "San José (por confirmar)",
      timeRange: "Por confirmar",
      durationHours: "Por confirmar",
      duration: "1.5–2.5 horas",

      // Legacy dates (se migran a EVENT_DATES en ensureDefaults)
      dates: [{ label: "18-19 enero", seats: 12 }],
    },
    {
      id: "coctel-feb",
      type: "Coctelería",
      monthKey: "FEBRERO",
      title: "Cocteles Clásicos con Twist",
      desc: "Aprendé técnica, balance y presentación con recetas clásicas reinterpretadas.",
      img: "./assets/img/hero-2.jpg",

      location: "San José (por confirmar)",
      timeRange: "Por confirmar",
      durationHours: "Por confirmar",
      duration: "2 horas",

      dates: [{ label: "09 febrero", seats: 0 }],
    },
    {
      id: "vino-marzo",
      type: "Cata de vino",
      monthKey: "MARZO",
      title: "Ruta de Tintos",
      desc: "Comparación de perfiles, cuerpo, taninos y maridajes para cada estilo.",
      img: "./assets/img/hero-3.jpg",

      location: "Heredia (por confirmar)",
      timeRange: "Por confirmar",
      durationHours: "Por confirmar",
      duration: "2–2.5 horas",

      dates: [
        { label: "15 marzo", seats: 8 },
        { label: "22 marzo", seats: 8 },
      ],
    },
  ];

  const DEFAULT_MEDIA = {
    logoPath: "./assets/img/logo-entrecopasynotas.png",
    defaultHero: "./assets/img/hero-1.jpg",
    whatsappNumber: "5068845123",
    instagramUrl: "https://instagram.com/entrecopasynotas",
  };

  const DEFAULT_PROMOS = [
    {
      id: "club-vino-banner",
      active: true,
      kind: "BANNER",
      target: "home",
      priority: 10,

      badge: "NUEVO",
      title: "El Club del Vino viene pronto",
      desc: "Acceso anticipado, experiencias privadas y maridajes exclusivos.",

      ctaLabel: "Unirme a la lista VIP",
      ctaHref:
        "https://wa.me/5068845123?text=Hola%20quiero%20unirme%20a%20la%20lista%20VIP%20del%20Club%20del%20Vino%20%F0%9F%8D%B7",

      mediaImg: "",
      note: "",
      startAt: "",
      endAt: "",
      dismissDays: 3,

      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: "club-vino-modal",
      active: true,
      kind: "MODAL",
      target: "home",
      priority: 9,

      badge: "NUEVO",
      title: "🍷 Club del Vino (próximamente)",
      desc: "Una comunidad para probar, aprender y compartir. Cupos limitados en el lanzamiento.",
      note: "Tip: si te unís ahora, te avisamos primero cuando esté la página lista.",

      ctaLabel: "Quiero estar adentro",
      ctaHref:
        "https://wa.me/5068845123?text=Hola%20quiero%20estar%20en%20el%20Club%20del%20Vino%20%F0%9F%8D%B7",

      mediaImg: "./assets/img/hero-1.jpg",
      startAt: "",
      endAt: "",
      dismissDays: 7,

      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];

  // ============================================================
  // Helpers (storage + misc)
  // ============================================================
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

  function normalizeMonth(m) {
    return String(m || "").trim().toUpperCase();
  }

  function asArray(x) {
    return Array.isArray(x) ? x : [];
  }

  function safeStr(x) {
    return String(x ?? "");
  }

  function clampInt(n, min, max) {
    const v = Number(n);
    if (!Number.isFinite(v)) return min;
    return Math.max(min, Math.min(max, Math.trunc(v)));
  }

  function slugifyId(input) {
    return safeStr(input)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9\-]/g, "")
      .replace(/\-+/g, "-")
      .replace(/^\-|\-$/g, "");
  }

  function parseTimeMs(iso) {
    const s = safeStr(iso).trim();
    if (!s) return NaN;
    const t = Date.parse(s);
    return Number.isFinite(t) ? t : NaN;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  // uuid local (se parece a Supabase)
  function uuid() {
    try {
      if (crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
    } catch (_) {}
    // fallback (no perfecto, pero suficiente para local)
    return (
      "id_" +
      Math.random().toString(16).slice(2) +
      "_" +
      Date.now().toString(16)
    );
  }

  // ✅ Normaliza duración en horas (ej: "3", "3hrs", "3 hrs", "3h") => "3"
  function normalizeDurationHours(v) {
    const s = safeStr(v).trim().toLowerCase();
    if (!s) return "";
    const m = s.match(/(\d+(?:[.,]\d+)?)/);
    if (!m) return safeStr(v).trim();
    return m[1].replace(",", ".");
  }

  // ✅ duration (lo que ve event.html) = timeRange cuando exista; si no, usa duration legacy
  function pickSchedule(timeRange, legacyDuration) {
    const tr = safeStr(timeRange).trim();
    if (tr && tr !== "Por confirmar") return tr;
    const lg = safeStr(legacyDuration).trim();
    return lg || "Por confirmar";
  }

  // ✅ evita "javascript:" y basura rara en links
  function sanitizeHref(href) {
    const s = safeStr(href).trim();
    if (!s) return "#";
    const lower = s.toLowerCase();
    if (lower.startsWith("javascript:")) return "#";

    // permitimos: http(s), wa.me, mailto, tel, hash, /ruta, ./ruta
    if (
      lower.startsWith("http://") ||
      lower.startsWith("https://") ||
      lower.startsWith("mailto:") ||
      lower.startsWith("tel:") ||
      lower.startsWith("#") ||
      lower.startsWith("/") ||
      lower.startsWith("./")
    ) return s;

    // wa.me sin protocolo
    if (lower.startsWith("wa.me/")) return "https://" + s;

    return s; // default: lo dejamos (por si usás rutas internas)
  }

  // ============================================================
  // ✅ EVENT_DATES (mapea tabla public.event_dates)
  // Shape local:
  // { id, event_id, label, seats_total, seats_available, created_at }
  // ============================================================
  function cleanEventDate(row) {
    const r = row || {};
    const id = safeStr(r.id).trim() || uuid();
    const event_id = safeStr(r.event_id).trim();

    const label = safeStr(r.label).trim() || "Por definir";
    const seats_total = Math.max(0, Number(r.seats_total) || 0);

    // si seats_available no viene, lo igualamos a total
    const seats_available_raw = Number(r.seats_available);
    const seats_available =
      Number.isFinite(seats_available_raw)
        ? Math.max(0, seats_available_raw)
        : seats_total;

    const created_at = safeStr(r.created_at).trim() || nowIso();

    return { id, event_id, label, seats_total, seats_available, created_at };
  }

  ECN.getEventDatesRaw = function getEventDatesRaw() {
    return asArray(readJSON(ECN.LS.EVENT_DATES, []));
  };

  ECN.setEventDatesRaw = function setEventDatesRaw(rows) {
    const clean = asArray(rows).map(cleanEventDate).filter((x) => !!x.event_id);
    writeJSON(ECN.LS.EVENT_DATES, clean);
    // cada cambio a event_dates refresca legacy en events
    syncLegacyDatesIntoEvents();
    return clean;
  };

  ECN.getEventDatesByEventId = function getEventDatesByEventId(eventId) {
    const id = safeStr(eventId);
    return ECN.getEventDatesRaw()
      .filter((d) => safeStr(d.event_id) === id)
      .sort((a, b) => safeStr(a.created_at).localeCompare(safeStr(b.created_at)));
  };

  ECN.upsertEventDate = function upsertEventDate(row) {
    const next = cleanEventDate(row);
    if (!next.event_id) return null;

    const all = ECN.getEventDatesRaw();
    const i = all.findIndex((x) => safeStr(x.id) === safeStr(next.id));

    if (i >= 0) {
      // conserva created_at original
      next.created_at = safeStr(all[i]?.created_at || next.created_at);
      all[i] = next;
    } else {
      all.unshift(next);
    }

    ECN.setEventDatesRaw(all);
    return next;
  };

  ECN.deleteEventDate = function deleteEventDate(id) {
    const all = ECN.getEventDatesRaw();
    const before = all.length;
    const after = all.filter((d) => safeStr(d.id) !== safeStr(id));
    ECN.setEventDatesRaw(after);
    return after.length !== before;
  };

  ECN.deleteEventDatesByEventId = function deleteEventDatesByEventId(eventId) {
    const all = ECN.getEventDatesRaw();
    const before = all.length;
    const after = all.filter((d) => safeStr(d.event_id) !== safeStr(eventId));
    ECN.setEventDatesRaw(after);
    return after.length !== before;
  };

  // ============================================================
  // Legacy sync: event_dates => events[].dates (para no romper el sitio público)
  // events[].dates queda como:
  //   [{ label, seats }] donde seats = seats_available
  // ============================================================
  function syncLegacyDatesIntoEvents() {
    const events = asArray(readJSON(ECN.LS.EVENTS, []));
    if (!events.length) return;

    const allDates = ECN.getEventDatesRaw();
    const byEvent = new Map();
    allDates.forEach((d) => {
      const eid = safeStr(d.event_id);
      if (!byEvent.has(eid)) byEvent.set(eid, []);
      byEvent.get(eid).push(d);
    });

    const nextEvents = events.map((ev) => {
      const eid = safeStr(ev?.id);
      const rows = byEvent.get(eid) || [];

      // derivamos legacy dates (label + seats available)
      const legacyDates = rows
        .slice()
        .sort((a, b) => safeStr(a.created_at).localeCompare(safeStr(b.created_at)))
        .map((r) => ({
          label: safeStr(r.label).trim(),
          seats: Math.max(0, Number(r.seats_available) || 0),
        }));

      return {
        ...ev,
        dates: legacyDates,
      };
    });

    writeJSON(ECN.LS.EVENTS, nextEvents);
  }

  // Helper expuesto (por si admin-dates.js necesita forzar refresh)
  ECN.syncLegacyDates = function syncLegacyDates() {
    syncLegacyDatesIntoEvents();
  };

  // ============================================================
  // Seats totals (para UI)
  // ============================================================
  ECN.totalSeats = function totalSeats(ev) {
    const dates = asArray(ev?.dates);
    return dates.reduce((acc, d) => acc + (Number(d?.seats) || 0), 0);
  };

  // ============================================================
  // Ensure defaults + migrate dates
  // ============================================================
  function seedEventDatesFromLegacyIfMissing() {
    const existing = readJSON(ECN.LS.EVENT_DATES, null);
    if (Array.isArray(existing) && existing.length) return;

    // si no hay event_dates todavía, los creamos desde DEFAULT_EVENTS (o desde events si ya existen)
    const events = asArray(readJSON(ECN.LS.EVENTS, DEFAULT_EVENTS));
    const rows = [];

    events.forEach((ev) => {
      const eid = safeStr(ev?.id);
      asArray(ev?.dates).forEach((d, idx) => {
        const seats = Math.max(0, Number(d?.seats) || 0);
        rows.push(
          cleanEventDate({
            id: uuid(),
            event_id: eid,
            label: safeStr(d?.label || "Por definir").trim(),
            seats_total: seats,
            seats_available: seats,
            created_at: nowIso(), // en local no importa precisión
          })
        );
      });
      // no borramos legacy aquí; luego se sincroniza
    });

    writeJSON(ECN.LS.EVENT_DATES, rows);
    syncLegacyDatesIntoEvents();
  }

  ECN.ensureDefaults = function ensureDefaults() {
    const events = readJSON(ECN.LS.EVENTS, null);
    if (!events || !Array.isArray(events) || events.length === 0) {
      writeJSON(ECN.LS.EVENTS, DEFAULT_EVENTS);
    }

    const media = readJSON(ECN.LS.MEDIA, null);
    if (!media || typeof media !== "object") {
      writeJSON(ECN.LS.MEDIA, DEFAULT_MEDIA);
    }

    const regs = readJSON(ECN.LS.REGS, null);
    if (!regs || !Array.isArray(regs)) {
      writeJSON(ECN.LS.REGS, []);
    }

    const promos = readJSON(ECN.LS.PROMOS, null);
    if (!promos || !Array.isArray(promos)) {
      writeJSON(ECN.LS.PROMOS, DEFAULT_PROMOS);
    }

    // ✅ nuevo: event_dates
    seedEventDatesFromLegacyIfMissing();
  };

  // ============================================================
  // Events API (RAW)
  // ============================================================
  ECN.getEventsRaw = function getEventsRaw() {
    // aseguramos que legacy esté sincronizado si event_dates existe
    // (por si alguien tocó event_dates directo)
    try {
      const hasDates = asArray(readJSON(ECN.LS.EVENT_DATES, [])).length > 0;
      if (hasDates) syncLegacyDatesIntoEvents();
    } catch (_) {}
    return asArray(readJSON(ECN.LS.EVENTS, []));
  };

  ECN.setEventsRaw = function setEventsRaw(events) {
    const clean = asArray(events).map((ev) => {
      const location = safeStr(ev?.location || "Por confirmar");

      const timeRange = safeStr(ev?.timeRange || "").trim() || "Por confirmar";
      const durationHours =
        normalizeDurationHours(ev?.durationHours) ||
        normalizeDurationHours(ev?.durationHours || "") ||
        "Por confirmar";

      const duration = pickSchedule(timeRange, ev?.duration);

      return {
        id: safeStr(ev?.id),
        type: safeStr(ev?.type || "Cata de vino"),
        monthKey: normalizeMonth(ev?.monthKey || "ENERO"),
        title: safeStr(ev?.title || "Evento"),
        desc: safeStr(ev?.desc || ""),
        img: safeStr(ev?.img || DEFAULT_MEDIA.defaultHero),

        location,
        timeRange,
        durationHours,
        duration,

        // ✅ legacy dates: dejamos lo que venga, pero normalmente se derivan de event_dates
        dates: asArray(ev?.dates).map((d) => ({
          label: safeStr(d?.label || "Por definir").trim(),
          seats: Math.max(0, Number(d?.seats) || 0),
        })),
      };
    });

    writeJSON(ECN.LS.EVENTS, clean);

    // si ya hay event_dates, forzamos sync legacy desde event_dates para consistencia
    try {
      const hasDates = ECN.getEventDatesRaw().length > 0;
      if (hasDates) syncLegacyDatesIntoEvents();
    } catch (_) {}

    return clean;
  };

  ECN.getEventRawById = function getEventRawById(id) {
    const events = ECN.getEventsRaw();
    return events.find((e) => safeStr(e?.id) === safeStr(id)) || null;
  };

  // alias usado por register.js / admin.js
  ECN.getEventById = function getEventById(id) {
    return ECN.getEventRawById(id);
  };

  // Upsert (create/edit) para Admin
  ECN.upsertEvent = function upsertEvent(ev) {
    const raw = ev || {};
    const events = ECN.getEventsRaw();

    const id = safeStr(raw.id).trim() || slugifyId(raw.title || "evento");

    const location = safeStr(raw.location || "Por confirmar");

    const timeRange = safeStr(raw.timeRange || "").trim() || "Por confirmar";
    const durationHours =
      normalizeDurationHours(raw.durationHours) ||
      normalizeDurationHours(raw.durationHours || "") ||
      "Por confirmar";

    const duration = pickSchedule(timeRange, raw.duration);

    const next = {
      id,
      type: safeStr(raw.type || "Cata de vino"),
      monthKey: normalizeMonth(raw.monthKey || "ENERO"),
      title: safeStr(raw.title || "Evento"),
      desc: safeStr(raw.desc || ""),
      img: safeStr(raw.img || DEFAULT_MEDIA.defaultHero),

      location,
      timeRange,
      durationHours,
      duration,

      // legacy dates se mantienen pero el source real será event_dates
      dates: asArray(raw.dates).map((d) => ({
        label: safeStr(d?.label || "Por definir").trim(),
        seats: Math.max(0, Number(d?.seats) || 0),
      })),
    };

    const i = events.findIndex((x) => safeStr(x?.id) === id);
    if (i >= 0) events[i] = next;
    else events.unshift(next);

    ECN.setEventsRaw(events);

    // ✅ Si el admin aún manda dates legacy, las migramos a event_dates SOLO si no hay fechas para ese evento
    const existingDates = ECN.getEventDatesByEventId(id);
    if (!existingDates.length && next.dates.length) {
      next.dates.forEach((d) => {
        const seats = Math.max(0, Number(d.seats) || 0);
        ECN.upsertEventDate({
          id: uuid(),
          event_id: id,
          label: safeStr(d.label).trim(),
          seats_total: seats,
          seats_available: seats,
          created_at: nowIso(),
        });
      });
    } else {
      // si ya hay event_dates, refrescamos legacy
      syncLegacyDatesIntoEvents();
    }

    return next;
  };

  ECN.deleteEvent = function deleteEvent(id) {
    const events = ECN.getEventsRaw();
    const before = events.length;
    const after = events.filter((e) => safeStr(e?.id) !== safeStr(id));
    ECN.setEventsRaw(after);

    // ✅ cascade local: borrar fechas del evento
    ECN.deleteEventDatesByEventId(id);

    return after.length !== before;
  };

  /**
   * Descontar cupo por fecha
   * - Nuevo: opera sobre event_dates (label)
   * - Compat: actualiza legacy events[].dates automáticamente
   */
  ECN.decrementSeat = function decrementSeat(eventId, dateLabel) {
    const eid = safeStr(eventId);
    const lab = safeStr(dateLabel);

    const rows = ECN.getEventDatesByEventId(eid);
    if (!rows.length) {
      // fallback legacy (por si algo quedó viejo)
      const events = ECN.getEventsRaw();
      const i = events.findIndex((e) => safeStr(e?.id) === eid);
      if (i < 0) return false;

      const ev = events[i];
      const dates = asArray(ev?.dates);
      const j = dates.findIndex((d) => safeStr(d?.label) === lab);
      if (j < 0) return false;

      const cur = Math.max(0, Number(dates[j]?.seats) || 0);
      if (cur <= 0) return false;

      dates[j].seats = cur - 1;
      ev.dates = dates;
      events[i] = ev;

      ECN.setEventsRaw(events);
      return true;
    }

    // buscar por label (MVP: label como identificador)
    const idx = rows.findIndex((r) => safeStr(r.label) === lab);
    if (idx < 0) return false;

    const row = rows[idx];
    const cur = Math.max(0, Number(row.seats_available) || 0);
    if (cur <= 0) return false;

    row.seats_available = cur - 1;
    ECN.upsertEventDate(row); // esto ya sincroniza legacy

    return true;
  };

  // ============================================================
  // Events API (FLATTEN para UI)
  // ============================================================
  ECN.flattenEventForUI = function flattenEventForUI(evRaw) {
    const raw = evRaw || {};
    const datesObj = asArray(raw.dates);
    const dates = datesObj.map((d) => safeStr(d?.label).trim()).filter(Boolean);
    const seats = ECN.totalSeats(raw);

    const timeRange = safeStr(raw.timeRange || "Por confirmar");
    const durationHours = safeStr(raw.durationHours || "Por confirmar");
    const duration = pickSchedule(timeRange, raw.duration);

    return {
      id: safeStr(raw.id),
      type: safeStr(raw.type || "Experiencia"),
      monthKey: normalizeMonth(raw.monthKey || "—"),
      title: safeStr(raw.title || "Evento"),
      desc: safeStr(raw.desc || ""),
      img: safeStr(raw.img || ""),

      location: safeStr(raw.location || "Por confirmar"),
      timeRange,
      durationHours,
      duration,

      dates, // string[]
      seats, // total disponible
      _dates: datesObj, // legacy con seats disponibles
    };
  };

  ECN.getEvents = function getEvents() {
    return ECN.getEventsRaw().map(ECN.flattenEventForUI);
  };

  ECN.findEventById = function findEventById(id) {
    const raw = ECN.getEventsRaw().find((e) => safeStr(e?.id) === safeStr(id));
    return raw ? ECN.flattenEventForUI(raw) : null;
  };

  // ============================================================
  // Upcoming events (RAW) (alias usado por home.js)
  // ============================================================
  ECN.getUpcomingEvents = function getUpcomingEvents() {
    return ECN.getEventsRaw();
  };

  // ============================================================
  // Months window (3 meses) (alias usado por home.js)
  // ============================================================
  const MONTHS_ES = [
    "ENERO","FEBRERO","MARZO","ABRIL","MAYO","JUNIO",
    "JULIO","AGOSTO","SEPTIEMBRE","OCTUBRE","NOVIEMBRE","DICIEMBRE",
  ];

  ECN.getMonths3 = function getMonths3(fromDate) {
    const d =
      fromDate instanceof Date && !isNaN(fromDate.getTime())
        ? fromDate
        : new Date();
    const m0 = clampInt(d.getMonth(), 0, 11);
    return [MONTHS_ES[m0], MONTHS_ES[(m0 + 1) % 12], MONTHS_ES[(m0 + 2) % 12]];
  };

  // ============================================================
  // Media API
  // ============================================================
  ECN.getMedia = function getMedia() {
    const m = readJSON(ECN.LS.MEDIA, DEFAULT_MEDIA) || {};
    return {
      logoPath: safeStr(m.logoPath || DEFAULT_MEDIA.logoPath),
      defaultHero: safeStr(m.defaultHero || DEFAULT_MEDIA.defaultHero),
      whatsappNumber: safeStr(m.whatsappNumber || DEFAULT_MEDIA.whatsappNumber),
      instagramUrl: safeStr(m.instagramUrl || DEFAULT_MEDIA.instagramUrl),
    };
  };

  ECN.setMedia = function setMedia(media) {
    const next = { ...DEFAULT_MEDIA, ...(media || {}) };
    next.logoPath = safeStr(next.logoPath || DEFAULT_MEDIA.logoPath);
    next.defaultHero = safeStr(next.defaultHero || DEFAULT_MEDIA.defaultHero);
    next.whatsappNumber = safeStr(next.whatsappNumber || DEFAULT_MEDIA.whatsappNumber);
    next.instagramUrl = safeStr(next.instagramUrl || DEFAULT_MEDIA.instagramUrl);
    writeJSON(ECN.LS.MEDIA, next);
    return next;
  };

  // ============================================================
  // Regs API (oficial)
  // ============================================================
  ECN.getRegs = function getRegs() {
    const r = readJSON(ECN.LS.REGS, []);
    return asArray(r);
  };

  ECN.addReg = function addReg(reg) {
    const regs = ECN.getRegs();
    regs.unshift(reg);
    writeJSON(ECN.LS.REGS, regs);
    return regs;
  };

  ECN.getRegistrations = function getRegistrations() {
    return ECN.getRegs();
  };

  ECN.saveRegistration = function saveRegistration(reg) {
    return ECN.addReg(reg);
  };

  // ============================================================
  // Promos API (RAW) ✅ hardened
  // ============================================================
  function normalizePromoKind(k) {
    const v = safeStr(k).trim().toUpperCase();
    if (v === "MODAL") return "MODAL";
    return "BANNER";
  }

  function normalizePromoTarget(t) {
    const v = safeStr(t).trim().toLowerCase();
    return v || "home";
  }

  function cleanPromo(p) {
    const raw = p || {};
    const id = safeStr(raw.id).trim() || slugifyId(raw.title || "promo");

    const createdAt = safeStr(raw.createdAt).trim() || nowIso();
    const updatedAt = nowIso();

    // default active true cuando viene undefined (mejor UX en admin)
    const active = raw.active === undefined ? true : !!raw.active;

    return {
      id,
      active,
      kind: normalizePromoKind(raw.kind),
      target: normalizePromoTarget(raw.target),
      priority: Number(raw.priority) || 0,

      badge: safeStr(raw.badge || ""),
      title: safeStr(raw.title || "Promo"),
      desc: safeStr(raw.desc || ""),
      note: safeStr(raw.note || ""),

      ctaLabel: safeStr(raw.ctaLabel || "Conocer"),
      ctaHref: sanitizeHref(raw.ctaHref || "#"),

      mediaImg: safeStr(raw.mediaImg || ""),

      startAt: safeStr(raw.startAt || "").trim(),
      endAt: safeStr(raw.endAt || "").trim(),
      dismissDays: Math.max(1, Number(raw.dismissDays) || 7),

      createdAt,
      updatedAt,
    };
  }

  ECN.getPromosRaw = function getPromosRaw() {
    return asArray(readJSON(ECN.LS.PROMOS, []));
  };

  ECN.setPromosRaw = function setPromosRaw(promos) {
    const clean = asArray(promos).map(cleanPromo);
    writeJSON(ECN.LS.PROMOS, clean);
    return clean;
  };

  ECN.getPromoById = function getPromoById(id) {
    const promos = ECN.getPromosRaw();
    return promos.find((p) => safeStr(p?.id) === safeStr(id)) || null;
  };

  ECN.upsertPromo = function upsertPromo(promo) {
    const promos = ECN.getPromosRaw();
    const next = cleanPromo(promo);

    const i = promos.findIndex((x) => safeStr(x?.id) === next.id);
    if (i >= 0) {
      next.createdAt = safeStr(promos[i]?.createdAt || next.createdAt);
      promos[i] = next;
    } else {
      promos.unshift(next);
    }

    ECN.setPromosRaw(promos);
    return next;
  };

  ECN.deletePromo = function deletePromo(id) {
    const promos = ECN.getPromosRaw();
    const before = promos.length;
    const after = promos.filter((p) => safeStr(p?.id) !== safeStr(id));
    ECN.setPromosRaw(after);
    return after.length !== before;
  };

  ECN.getActivePromos = function getActivePromos(target) {
    const t = normalizePromoTarget(target || "home");
    const ms = Date.now();

    return ECN.getPromosRaw()
      .filter((p) => !!p.active)
      .filter((p) => normalizePromoTarget(p.target) === t)
      .filter((p) => {
        const s = parseTimeMs(p.startAt);
        const e = parseTimeMs(p.endAt);
        if (Number.isFinite(s) && ms < s) return false;
        if (Number.isFinite(e) && ms > e) return false;
        return true;
      })
      .sort((a, b) => (Number(b.priority) || 0) - (Number(a.priority) || 0));
  };

  // ============================================================
  // URL helpers
  // ============================================================
  ECN.getParam = function getParam(name) {
    const url = new URL(window.location.href);
    return url.searchParams.get(name);
  };

  // ============================================================
  // Boot
  // ============================================================
  ECN.ensureDefaults();

  // por si algo externo creó/alteró event_dates, sincronizamos legacy al cargar
  try { syncLegacyDatesIntoEvents(); } catch (_) {}
})();
