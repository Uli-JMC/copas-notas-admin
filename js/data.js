"use strict";

/**
 * ECN Data Layer (Local-first)
 * - Fuente única de verdad para: eventos, fechas/cupos, media (logo/hero), registros, promos.
 * - Hoy: localStorage (demo).
 * - Luego: se reemplaza por Supabase sin cambiar el resto del front.
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
    REGS: "ecn_regs",
    MEDIA: "ecn_media",
    // ✅ NUEVO
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

      // ✅ Dirección
      location: "San José (por confirmar)",

      // ✅ NUEVOS (Admin)
      timeRange: "Por confirmar", // ej: "9–10 am"
      durationHours: "Por confirmar", // ej: "3"

      // ✅ Campo que usa el EVENT (event.html): horario completo
      // Regla: duration = timeRange (cuando exista), si no, cae a duration vieja
      duration: "1.5–2.5 horas",

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

  // ✅ NUEVO: Promos (banner + modal)
  const DEFAULT_PROMOS = [
    {
      id: "club-vino-banner",
      active: true,
      kind: "BANNER", // BANNER | MODAL
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
  // Helpers (storage)
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

  // ============================================================
  // Seats
  // ============================================================
  ECN.totalSeats = function totalSeats(ev) {
    const dates = asArray(ev?.dates);
    return dates.reduce((acc, d) => acc + (Number(d?.seats) || 0), 0);
  };

  // ============================================================
  // Ensure defaults
  // ============================================================
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
  };

  // ============================================================
  // Events API (RAW)
  // ============================================================
  ECN.getEventsRaw = function getEventsRaw() {
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

      // ✅ duration = horario (para event.html)
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
        duration, // ✅ horario visible

        dates: asArray(ev?.dates).map((d) => ({
          label: safeStr(d?.label || "Por definir").trim(),
          seats: Math.max(0, Number(d?.seats) || 0),
        })),
      };
    });

    writeJSON(ECN.LS.EVENTS, clean);
    return clean;
  };

  ECN.getEventRawById = function getEventRawById(id) {
    const events = ECN.getEventsRaw();
    return events.find((e) => safeStr(e?.id) === safeStr(id)) || null;
  };

  // ✅ alias usado por register.js / admin.js (debe ser RAW)
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

    // ✅ duration = horario (para event.html)
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

      dates: asArray(raw.dates).map((d) => ({
        label: safeStr(d?.label || "Por definir").trim(),
        seats: Math.max(0, Number(d?.seats) || 0),
      })),
    };

    const i = events.findIndex((x) => safeStr(x?.id) === id);
    if (i >= 0) events[i] = next;
    else events.unshift(next);

    ECN.setEventsRaw(events);
    return next;
  };

  ECN.deleteEvent = function deleteEvent(id) {
    const events = ECN.getEventsRaw();
    const before = events.length;
    const after = events.filter((e) => safeStr(e?.id) !== safeStr(id));
    ECN.setEventsRaw(after);
    return after.length !== before;
  };

  // Descontar cupo por fecha (para register.js)
  ECN.decrementSeat = function decrementSeat(eventId, dateLabel) {
    const events = ECN.getEventsRaw();
    const i = events.findIndex((e) => safeStr(e?.id) === safeStr(eventId));
    if (i < 0) return false;

    const ev = events[i];
    const dates = asArray(ev?.dates);
    const j = dates.findIndex((d) => safeStr(d?.label) === safeStr(dateLabel));
    if (j < 0) return false;

    const cur = Math.max(0, Number(dates[j]?.seats) || 0);
    if (cur <= 0) return false;

    dates[j].seats = cur - 1;
    ev.dates = dates;
    events[i] = ev;

    ECN.setEventsRaw(events);
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
      duration, // ✅ horario

      dates, // string[]
      seats, // total
      _dates: datesObj, // per-date seats
    };
  };

  // UI list (flatten)
  ECN.getEvents = function getEvents() {
    return ECN.getEventsRaw().map(ECN.flattenEventForUI);
  };

  // UI find (flatten)
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

  ECN.getMonths3 = function getMonths3(fromDate) {
    const d =
      fromDate instanceof Date && !isNaN(fromDate.getTime())
        ? fromDate
        : new Date();
    const m0 = clampInt(d.getMonth(), 0, 11);
    return [
      MONTHS_ES[m0],
      MONTHS_ES[(m0 + 1) % 12],
      MONTHS_ES[(m0 + 2) % 12],
    ];
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
    next.whatsappNumber = safeStr(
      next.whatsappNumber || DEFAULT_MEDIA.whatsappNumber
    );
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
  // ✅ Promos API (RAW)
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

    return {
      id,
      active: !!raw.active,
      kind: normalizePromoKind(raw.kind),
      target: normalizePromoTarget(raw.target),
      priority: Number(raw.priority) || 0,

      badge: safeStr(raw.badge || ""),
      title: safeStr(raw.title || "Promo"),
      desc: safeStr(raw.desc || ""),
      note: safeStr(raw.note || ""),

      ctaLabel: safeStr(raw.ctaLabel || "Conocer"),
      ctaHref: safeStr(raw.ctaHref || "#"),

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

  // Filtro de activos + ventana de tiempo
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
})();
