/* ============================================================
   admin-registrations.js ✅ PRO (Supabase READ + Filtros + CSV)
   - Admin: lista inscripciones desde public.registrations
   - Join ligero: events.title + event_dates.label (si existe event_date_id)
   - Filtro usa el search global #search
   - Exporta CSV (lo filtrado en pantalla)
   - Botón "Cargar demo" (seedRegsBtn) se usa como "Refrescar"
   - NO depende de data.js / ECN

   Requiere (admin.html):
   - #tab-regs (panel)
   - #regsTbody (tbody)
   - #exportCsvBtn (botón)
   - #seedRegsBtn (botón)  -> lo usamos como "Refrescar"
   - #search (input search global)

   Nota importante:
   - Este archivo NO asume que registrations tiene event_date_id.
     Si no existe, cae a joins parciales o sin joins.
   ============================================================ */
(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);

  // ------------------------------------------------------------
  // Guards
  // ------------------------------------------------------------
  if (!document.getElementById("appPanel")) return;

  if (!window.APP || !APP.supabase) {
    console.error(
      "APP.supabase no existe. Revisá el orden: Supabase CDN -> supabaseClient.js -> admin-registrations.js"
    );
    return;
  }

  const tab = $("#tab-regs");
  const tbody = $("#regsTbody");
  const exportBtn = $("#exportCsvBtn");
  const refreshBtn = $("#seedRegsBtn"); // HTML dice "Cargar demo" pero acá es Refrescar
  const searchEl = $("#search");

  if (!tab || !tbody || !exportBtn) return;

  // ------------------------------------------------------------
  // Toast unificado
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
    el.querySelector(".close")?.addEventListener("click", kill);
    setTimeout(kill, timeoutMs);
  }

  // ------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------
  function safeStr(x) {
    return String(x ?? "");
  }
  function cleanSpaces(s) {
    return safeStr(s).replace(/\s+/g, " ").trim();
  }

  function isRLSError(err) {
    const m = safeStr(err?.message || "").toLowerCase();
    const code = safeStr(err?.code || "").toLowerCase();
    return (
      code === "42501" ||
      m.includes("42501") ||
      m.includes("rls") ||
      m.includes("permission") ||
      m.includes("not allowed") ||
      m.includes("row level security") ||
      m.includes("new row violates row-level security")
    );
  }

  function isMissingTable(err) {
    const m = safeStr(err?.message || "").toLowerCase();
    return (m.includes("relation") && m.includes("does not exist")) || m.includes("does not exist");
  }

  function isMissingColumn(err) {
    const m = safeStr(err?.message || "").toLowerCase();
    // PostgREST: column "x" does not exist / Could not find the 'x' column
    return m.includes("column") && m.includes("does not exist") || m.includes("could not find") && m.includes("column");
  }

  function isJoinRelationError(err) {
    const msg = safeStr(err?.message || "").toLowerCase();
    return (
      msg.includes("could not find") ||
      msg.includes("relationship") ||
      msg.includes("embedded") ||
      msg.includes("schema cache") ||
      msg.includes("foreign key")
    );
  }

  function prettyError(err) {
    const msg = safeStr(err?.message || err || "");
    return msg || "Ocurrió un error.";
  }

  function fmtDate(iso) {
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return "—";
      return d.toLocaleString("es-CR", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch (_) {
      return "—";
    }
  }

  function getQuery() {
    return cleanSpaces(searchEl?.value || "").toLowerCase();
  }

  function isRegsTabActive() {
    const btn = document.querySelector('.tab[data-tab="regs"]');
    const selected = btn ? btn.getAttribute("aria-selected") === "true" : false;
    return selected && !tab.hidden;
  }

  // CSV helpers
  function csvCell(v) {
    const s = safeStr(v);
    const needs = /[",\n\r]/.test(s);
    const esc = s.replaceAll('"', '""');
    return needs ? `"${esc}"` : esc;
  }

  function downloadTextFile(filename, content, mime) {
    try {
      const blob = new Blob([content], { type: mime || "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 500);
    } catch (e) {
      console.error(e);
      toast("Exportar", "No pude generar el archivo en este navegador.");
    }
  }

  // ------------------------------------------------------------
  // Config DB
  // ------------------------------------------------------------
  const TABLE = "registrations";

  // IMPORTANTE:
  // - No asumimos que existe event_date_id.
  // - Intentamos niveles: FULL JOIN (events+event_dates) -> events only -> flat.
  //
  // Nota: si tus FK tienen nombres "registrations_event_id_fkey", etc,
  // el fallback con alias suele funcionar. Pero igual puede variar, por eso hay niveles.

  // Nivel 1: columnas completas + join "simple"
  const SELECT_FULL_A = `
    id,
    event_id,
    event_date_id,
    name,
    email,
    phone,
    marketing_opt_in,
    created_at,
    events ( title ),
    event_dates ( label )
  `;

  // Nivel 1b: FULL JOIN con alias por FK name típico
  const SELECT_FULL_B = `
    id,
    event_id,
    event_date_id,
    name,
    email,
    phone,
    marketing_opt_in,
    created_at,
    events:events!registrations_event_id_fkey ( title ),
    event_dates:event_dates!registrations_event_date_id_fkey ( label )
  `;

  // Nivel 2: SOLO events (si no existe event_date_id o el join a event_dates falla)
  const SELECT_EVENTS_A = `
    id,
    event_id,
    name,
    email,
    phone,
    marketing_opt_in,
    created_at,
    events ( title )
  `;

  // Nivel 2b: SOLO events con alias por FK
  const SELECT_EVENTS_B = `
    id,
    event_id,
    name,
    email,
    phone,
    marketing_opt_in,
    created_at,
    events:events!registrations_event_id_fkey ( title )
  `;

  // Nivel 3: sin joins (no rompe nunca)
  const SELECT_FLAT = `
    id,
    event_id,
    event_date_id,
    name,
    email,
    phone,
    marketing_opt_in,
    created_at
  `;

  // ------------------------------------------------------------
  // State
  // ------------------------------------------------------------
  const S = {
    list: [],
    loading: false,
    didBind: false,
    refreshT: null,

    // debug: qué estrategia se usó
    mode: "unknown", // fullA|fullB|eventsA|eventsB|flat
  };

  // ------------------------------------------------------------
  // Fetch
  // ------------------------------------------------------------
  async function ensureSession() {
    try {
      const res = await APP.supabase.auth.getSession();
      const s = res?.data?.session || null;
      if (!s) {
        toast("Sesión", "Tu sesión expiró. Volvé a iniciar sesión.", 3600);
        return null;
      }
      return s;
    } catch (e) {
      toast("Error", "No se pudo validar sesión con Supabase.", 3200);
      return null;
    }
  }

  async function fetchRegistrations(selectStr) {
    const { data, error } = await APP.supabase
      .from(TABLE)
      .select(selectStr)
      .order("created_at", { ascending: false })
      .limit(1000);

    if (error) throw error;
    return Array.isArray(data) ? data : [];
  }

  async function fetchSmart() {
    // 1) FULL A
    try {
      const data = await fetchRegistrations(SELECT_FULL_A);
      S.mode = "fullA";
      return data;
    } catch (errA) {
      // si falla por columna missing (ej: no existe event_date_id), nos vamos a nivel 2/3
      const missingCol = isMissingColumn(errA);
      const joinErr = isJoinRelationError(errA);

      // 1b) FULL B solo si parece problema de relación/join
      if (!missingCol && joinErr) {
        try {
          const data = await fetchRegistrations(SELECT_FULL_B);
          S.mode = "fullB";
          return data;
        } catch (errB) {
          // seguimos
        }
      }

      // 2) EVENTS A
      try {
        const data = await fetchRegistrations(SELECT_EVENTS_A);
        S.mode = "eventsA";
        return data;
      } catch (err2A) {
        const joinErr2 = isJoinRelationError(err2A);
        if (joinErr2) {
          // 2b) EVENTS B
          try {
            const data = await fetchRegistrations(SELECT_EVENTS_B);
            S.mode = "eventsB";
            return data;
          } catch (err2B) {
            // seguimos
          }
        }
      }

      // 3) FLAT (último recurso)
      const dataFlat = await fetchRegistrations(SELECT_FLAT);
      S.mode = "flat";
      return dataFlat;
    }
  }

  function normalizeRow(r) {
    // FULL/EVENTS: r.events.title
    const evTitle = r?.events?.title || "—";

    // FULL: r.event_dates.label
    const dateLabel = r?.event_dates?.label || "—";

    return {
      id: safeStr(r?.id),

      eventTitle: safeStr(evTitle),
      dateLabel: safeStr(dateLabel),

      name: safeStr(r?.name),
      email: safeStr(r?.email),
      phone: safeStr(r?.phone || ""),

      marketing: !!r?.marketing_opt_in,

      createdAt: safeStr(r?.created_at || ""),

      eventId: safeStr(r?.event_id || ""),
      eventDateId: safeStr(r?.event_date_id || ""),
    };
  }

  function filterList(list) {
    const q = getQuery();
    if (!q) return list;

    return list.filter((x) => {
      const hay = `${x.eventTitle} ${x.dateLabel} ${x.name} ${x.email} ${x.phone}`.toLowerCase();
      return hay.includes(q);
    });
  }

  // ------------------------------------------------------------
  // Render
  // ------------------------------------------------------------
  function render() {
    if (!tbody) return;

    const list = filterList(S.list);

    if (!list.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="opacity:.75; padding:14px;">
            ${S.loading ? "Cargando…" : "No hay inscripciones para mostrar."}
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = list
      .map((r) => {
        return `
          <tr data-id="${escapeHtml(r.id)}">
            <td>${escapeHtml(r.eventTitle)}</td>
            <td>${escapeHtml(r.dateLabel)}</td>
            <td>${escapeHtml(r.name)}</td>
            <td>${escapeHtml(r.email)}</td>
            <td>${escapeHtml(r.phone || "—")}</td>
            <td>${r.marketing ? "Sí" : "No"}</td>
            <td>${escapeHtml(fmtDate(r.createdAt))}</td>
          </tr>
        `;
      })
      .join("");
  }

  // ------------------------------------------------------------
  // Refresh (debounced)
  // ------------------------------------------------------------
  async function refreshNow(opts) {
    const silent = !!opts?.silent;

    if (S.loading) return;
    S.loading = true;

    if (!silent) toast("Inscripciones", "Cargando registros…", 1200);

    try {
      const s = await ensureSession();
      if (!s) return;

      const data = await fetchSmart();
      S.list = data.map(normalizeRow);

      if (!silent) {
        const tag =
          S.mode === "fullA" ? "" :
          S.mode === "fullB" ? " (join full B)" :
          S.mode === "eventsA" ? " (solo events)" :
          S.mode === "eventsB" ? " (solo events B)" :
          " (sin joins)";
        toast("Listo", "Inscripciones actualizadas." + tag, 1400);
      }

      render();
    } catch (err) {
      console.error(err);

      if (isMissingTable(err)) {
        toast("BD", "La tabla registrations no existe en Supabase (public.registrations).", 4200);
      } else if (isRLSError(err)) {
        toast("RLS", "Acceso bloqueado. Falta policy SELECT para registrations (y sus joins).", 4200);
      } else {
        toast("Error", prettyError(err), 4200);
      }

      S.list = [];
      render();
    } finally {
      S.loading = false;
    }
  }

  function refreshDebounced(ms) {
    clearTimeout(S.refreshT);
    S.refreshT = setTimeout(() => refreshNow({ silent: true }), ms || 250);
  }

  // ------------------------------------------------------------
  // Export CSV (filtrado)
  // ------------------------------------------------------------
  function exportCsv() {
    const rows = filterList(S.list);

    if (!rows.length) {
      toast("Exportar", "No hay registros para exportar.");
      return;
    }

    const header = [
      "event",
      "event_date",
      "name",
      "email",
      "phone",
      "marketing_opt_in",
      "created_at",
      "event_id",
      "event_date_id",
      "registration_id",
    ];

    const lines = [];
    lines.push(header.map(csvCell).join(","));

    rows.forEach((r) => {
      lines.push(
        [
          r.eventTitle,
          r.dateLabel,
          r.name,
          r.email,
          r.phone || "",
          r.marketing ? "true" : "false",
          r.createdAt,
          r.eventId,
          r.eventDateId,
          r.id,
        ]
          .map(csvCell)
          .join(",")
      );
    });

    // BOM para Excel (mejor soporte UTF-8)
    const csv = "\uFEFF" + lines.join("\n");
    const fname = `registrations_${new Date().toISOString().slice(0, 10)}.csv`;
    downloadTextFile(fname, csv, "text/csv;charset=utf-8");
    toast("Exportar", "CSV generado.", 1400);
  }

  // ------------------------------------------------------------
  // Bind
  // ------------------------------------------------------------
  function bindOnce() {
    if (S.didBind) return;
    S.didBind = true;

    if (refreshBtn) {
      try {
        refreshBtn.textContent = "Refrescar";
      } catch (_) {}
      refreshBtn.addEventListener("click", () => refreshNow({ silent: false }));
    }

    exportBtn.addEventListener("click", exportCsv);

    // Filtro global (local)
    searchEl?.addEventListener("input", () => render());

    // Cuando se abre la pestaña regs, refrescamos (suave)
    document.querySelectorAll('.tab[data-tab="regs"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        render();
        refreshDebounced(150);
      });
    });
  }

  // ------------------------------------------------------------
  // Init
  // ------------------------------------------------------------
  (async function init() {
    bindOnce();
    render();

    if (isRegsTabActive()) {
      await refreshNow({ silent: true });
    } else {
      // no spamear: refresca una vez por si ya hay datos y el usuario entra luego
      refreshDebounced(250);
    }
  })();
})();
