/* ============================================================
   admin-registrations.js ✅ PRO (Supabase READ + Filtros + CSV) — 2026-01 PATCH+
   - Admin: lista inscripciones desde public.registrations (solo lectura)
   - Join: events.title + event_dates.label (vía FK)
   - Filtro usa el search global #search (filtra local, sin pedir a DB)
   - Exporta CSV (lo filtrado en pantalla)
   - Botón "seedRegsBtn" se usa como "Refrescar"

   ✅ SIN RECARGAR / SIN DOBLES CARGAS:
   - Espera admin:ready (admin-auth.js)
   - Carga solo al abrir tab "regs" vía admin:tab (admin.js)
   - Throttle anti rebote
============================================================ */
(function () {
  "use strict";

  // ✅ Guard global anti doble eval
  if (window.__ecnRegsMounted === true) return;
  window.__ecnRegsMounted = true;

  const VERSION = "2026-01-19.3";
  const $ = (sel) => document.querySelector(sel);

  // ------------------------------------------------------------
  // Guard DOM
  // ------------------------------------------------------------
  if (!document.getElementById("appPanel")) return;

  const tab = $("#tab-regs");
  const tbody = $("#regsTbody");
  const exportBtn = $("#exportCsvBtn");
  const refreshBtn = $("#seedRegsBtn");
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

  // ------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------
  function safeStr(x) { return String(x ?? ""); }
  function cleanSpaces(s) { return safeStr(s).replace(/\s+/g, " ").trim(); }

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
      m.includes("violates row-level security") ||
      m.includes("new row violates row-level security")
    );
  }

  function isMissingTable(err) {
    const m = safeStr(err?.message || "").toLowerCase();
    return (m.includes("relation") && m.includes("does not exist")) || m.includes("does not exist");
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
  // Supabase client
  // ------------------------------------------------------------
  function getSB() {
    if (!window.APP) return null;
    return APP.supabase || APP.sb || null;
  }

  async function ensureSession(sb) {
    try {
      const res = await sb.auth.getSession();
      const s = res?.data?.session || null;
      if (!s) {
        toast("Sesión", "Tu sesión expiró. Volvé a iniciar sesión.", 3600);
        return null;
      }
      return s;
    } catch (_) {
      toast("Error", "No se pudo validar sesión con Supabase.", 3200);
      return null;
    }
  }

  // ------------------------------------------------------------
  // Config DB
  // ------------------------------------------------------------
  const TABLE = "registrations";

  const SELECT_JOIN_A = `
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

  const SELECT_JOIN_B = `
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
    loadingUi: false, // ✅ NUEVO: para mostrar "Actualizando…" aunque haya data
    didBind: false,
    didBoot: false,
    didLoadOnce: false,
    mode: "unknown", // joinA|joinB|flat
    lastLoadAt: 0,
  };

  function withLock(fn) {
    return async function (...args) {
      if (S.loading) return;
      S.loading = true;
      try {
        return await fn(...args);
      } finally {
        S.loading = false;
      }
    };
  }

  // ------------------------------------------------------------
  // Fetch
  // ------------------------------------------------------------
  async function fetchRegistrations(sb, selectStr) {
    const { data, error } = await sb
      .from(TABLE)
      .select(selectStr)
      .order("created_at", { ascending: false })
      .limit(1000);

    if (error) throw error;
    return Array.isArray(data) ? data : [];
  }

  async function fetchSmart(sb) {
    try {
      const data = await fetchRegistrations(sb, SELECT_JOIN_A);
      S.mode = "joinA";
      return data;
    } catch (eA) {
      if (isJoinRelationError(eA)) {
        try {
          const data = await fetchRegistrations(sb, SELECT_JOIN_B);
          S.mode = "joinB";
          return data;
        } catch (_) {}
      }
      const data = await fetchRegistrations(sb, SELECT_FLAT);
      S.mode = "flat";
      return data;
    }
  }

  function normalizeRow(r) {
    // ✅ Soportar object o array (según relación/embedded)
    const ev = Array.isArray(r?.events) ? r.events[0] : r?.events;
    const dt = Array.isArray(r?.event_dates) ? r.event_dates[0] : r?.event_dates;

    const evTitle = ev?.title || "";
    const dateLabel = dt?.label || "";

    const evFallback = r?.event_id ? `ID: ${safeStr(r.event_id)}` : "—";
    const dtFallback = r?.event_date_id ? `ID: ${safeStr(r.event_date_id)}` : "—";

    return {
      id: safeStr(r?.id),
      eventTitle: safeStr(evTitle || evFallback),
      dateLabel: safeStr(dateLabel || dtFallback),
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
    const list = filterList(S.list);

    // ✅ Mensaje de “actualizando” aunque haya data
    if (S.loadingUi && list.length) {
      // Mantenemos tabla, pero dejamos 1 fila arriba tipo status
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="opacity:.75; padding:14px;">
            Actualizando…
          </td>
        </tr>
      ` + list.slice(0, 999).map((r) => {
        const created = fmtDate(r.createdAt);
        return `
          <tr data-id="${escapeHtml(r.id)}">
            <td>${escapeHtml(r.eventTitle)}</td>
            <td>${escapeHtml(r.dateLabel)}</td>
            <td>${escapeHtml(r.name)}</td>
            <td>${escapeHtml(r.email)}</td>
            <td>${escapeHtml(r.phone || "—")}</td>
            <td>${r.marketing ? "Sí" : "No"}</td>
            <td>${escapeHtml(created)}</td>
          </tr>
        `;
      }).join("");
      return;
    }

    if (S.loadingUi && !list.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="opacity:.75; padding:14px;">
            Cargando…
          </td>
        </tr>
      `;
      return;
    }

    if (!list.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="opacity:.75; padding:14px;">
            No hay inscripciones para mostrar.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = list
      .map((r) => {
        const created = fmtDate(r.createdAt);
        return `
          <tr data-id="${escapeHtml(r.id)}">
            <td>${escapeHtml(r.eventTitle)}</td>
            <td>${escapeHtml(r.dateLabel)}</td>
            <td>${escapeHtml(r.name)}</td>
            <td>${escapeHtml(r.email)}</td>
            <td>${escapeHtml(r.phone || "—")}</td>
            <td>${r.marketing ? "Sí" : "No"}</td>
            <td>${escapeHtml(created)}</td>
          </tr>
        `;
      })
      .join("");
  }

  // ------------------------------------------------------------
  // Refresh
  // ------------------------------------------------------------
  const refreshNow = withLock(async function (opts) {
    const silent = !!opts?.silent;

    S.loadingUi = true;
    try {
      // UX: bloquear botones durante carga
      if (refreshBtn) refreshBtn.disabled = true;
      if (exportBtn) exportBtn.disabled = true;

      if (!silent) toast("Inscripciones", "Cargando registros…", 900);
      render();

      const sb = getSB();
      if (!sb) {
        toast("Supabase", "Falta supabaseClient.js antes de admin-registrations.js", 4200);
        S.list = [];
        return;
      }

      const session = await ensureSession(sb);
      if (!session) {
        S.list = [];
        return;
      }

      const data = await fetchSmart(sb);
      S.list = data.map(normalizeRow);
      S.didLoadOnce = true;

      if (!silent) {
        const tag =
          S.mode === "joinA" ? "" :
          S.mode === "joinB" ? " (join por FK)" :
          " (sin joins)";
        toast("Listo", "Inscripciones actualizadas." + tag, 1100);
      }
    } catch (err) {
      console.error("[admin-registrations]", err);

      if (isMissingTable(err)) {
        toast("BD", "La tabla registrations no existe en Supabase (public.registrations).", 4200);
      } else if (isRLSError(err)) {
        toast("RLS bloqueando", "No hay permiso para leer registrations (admins).", 5200);
      } else {
        toast("Error", prettyError(err), 4200);
      }

      S.list = [];
    } finally {
      S.loadingUi = false;
      if (refreshBtn) refreshBtn.disabled = false;
      if (exportBtn) exportBtn.disabled = false;
      render();
    }
  });

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

    const csv = "\uFEFF" + lines.join("\n");
    const fname = `registrations_${new Date().toISOString().slice(0, 10)}.csv`;
    downloadTextFile(fname, csv, "text/csv;charset=utf-8");
    toast("Exportar", "CSV generado.", 1200);
  }

  // ------------------------------------------------------------
  // Bind
  // ------------------------------------------------------------
  function onAdminTab(e) {
    const t = e?.detail?.tab;
    if (t === "regs") ensureLoaded(true);
  }

  function bindOnce() {
    if (S.didBind) return;
    S.didBind = true;

    if (refreshBtn) {
      try { refreshBtn.textContent = "Refrescar"; } catch (_) {}
      refreshBtn.addEventListener("click", () => refreshNow({ silent: false }));
    }

    exportBtn.addEventListener("click", exportCsv);

    // Filtro global (local)
    searchEl?.addEventListener("input", () => render());

    // Evento de tabs (única fuente)
    window.addEventListener("admin:tab", onAdminTab);
  }

  // ------------------------------------------------------------
  // Load-on-demand (throttle)
  // ------------------------------------------------------------
  async function ensureLoaded(force) {
    bindOnce();

    const isHidden = !!$("#tab-regs")?.hidden;
    if (!force && isHidden) return;

    const now = Date.now();
    if (!force && now - S.lastLoadAt < 600) return;
    if (force && now - S.lastLoadAt < 250) return;
    S.lastLoadAt = now;

    if (S.didLoadOnce && !force) {
      render();
      return;
    }

    await refreshNow({ silent: true });
  }

  // ------------------------------------------------------------
  // Boot: esperar admin:ready
  // ------------------------------------------------------------
  function boot() {
    if (S.didBoot) return;
    S.didBoot = true;

    console.log("[admin-registrations] boot", { VERSION });

    bindOnce();
    if (!$("#tab-regs")?.hidden) ensureLoaded(true);
  }

  if (window.APP && APP.__adminReady) boot();
  else window.addEventListener("admin:ready", boot, { once: true });
})();
