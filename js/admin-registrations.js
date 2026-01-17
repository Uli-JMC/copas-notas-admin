/* ============================================================
   admin-registrations.js ✅ PRO (Supabase READ + Filtros + CSV)
   - Admin: lista inscripciones desde public.registrations
   - Join ligero para mostrar: events.title + event_dates.label
   - Filtro usa el search global #search (mismo del panel)
   - Exporta CSV (lo que esté filtrado en pantalla)
   - NO depende de data.js / ECN

   Requiere (admin.html):
   - #tab-regs (panel)
   - #regsTbody (tbody)
   - #exportCsvBtn (botón)
   - #seedRegsBtn (botón)  -> lo usamos como "Refrescar"
   - #search (input search global)
   ============================================================ */
(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);

  // ------------------------------------------------------------
  // Guards
  // ------------------------------------------------------------
  if (!document.getElementById("appPanel")) return;

  if (!window.APP || !APP.supabase) {
    console.error("APP.supabase no existe. Revisá el orden: Supabase CDN -> supabaseClient.js -> admin-registrations.js");
    return;
  }

  const tab = $("#tab-regs");
  const tbody = $("#regsTbody");
  const exportBtn = $("#exportCsvBtn");
  const refreshBtn = $("#seedRegsBtn"); // en HTML decía "Cargar demo", acá lo convertimos en refrescar
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
  function safeStr(x) { return String(x ?? ""); }
  function cleanSpaces(s) { return safeStr(s).replace(/\s+/g, " ").trim(); }

  function isRLSError(err) {
    const m = safeStr(err?.message || "").toLowerCase();
    return (
      m.includes("rls") ||
      m.includes("permission") ||
      m.includes("not allowed") ||
      m.includes("row level security") ||
      m.includes("new row violates row-level security")
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
    // tab visible + aria-selected true en botón
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

  // Importante:
  // PostgREST (Supabase) permite nested select por FK si están bien definidas.
  // Con tus FK: registrations.event_id -> events.id y registrations.event_date_id -> event_dates.id,
  // esto normalmente funciona:
  //
  // events ( title )
  // event_dates ( label )
  //
  // Si en tu proyecto el join no resuelve (por nombres de relaciones), lo ajustamos.
  const SELECT = `
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

  // ------------------------------------------------------------
  // State
  // ------------------------------------------------------------
  const S = {
    list: [],
    loading: false,
    didBind: false,
    refreshT: null,
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

  async function fetchRegistrations() {
    // OJO: en registros normalmente crecen mucho.
    // MVP: traemos los más recientes.
    // Si luego querés paginación o filtros por evento/fecha, lo agregamos.
    const { data, error } = await APP.supabase
      .from(TABLE)
      .select(SELECT)
      .order("created_at", { ascending: false })
      .limit(1000);

    if (error) throw error;
    return Array.isArray(data) ? data : [];
  }

  function normalizeRow(r) {
    const evTitle = r?.events?.title || "—";
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
      const hay = (
        `${x.eventTitle} ${x.dateLabel} ${x.name} ${x.email} ${x.phone}`
      ).toLowerCase();

      return hay.includes(q);
    });
  }

  // ------------------------------------------------------------
  // Render
  // ------------------------------------------------------------
  function render() {
    if (!tbody) return;

    // Solo re-render “pesado” si la pestaña está activa
    // (igual, si no lo está, dejamos listo para cuando entren)
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

    tbody.innerHTML = list.map((r) => {
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
    }).join("");
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

      const data = await fetchRegistrations();
      S.list = data.map(normalizeRow);

      if (!silent) toast("Listo", "Inscripciones actualizadas.", 1400);
      render();
    } catch (err) {
      console.error(err);
      if (isRLSError(err)) {
        toast("RLS", "Acceso bloqueado. Falta policy SELECT para registrations (y joins).", 4200);
      } else {
        toast("Error", prettyError(err), 4200);
      }
      // fallback UI vacío
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
      lines.push([
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
      ].map(csvCell).join(","));
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

    // Convertimos “Cargar demo” -> “Refrescar”
    if (refreshBtn) {
      try { refreshBtn.textContent = "Refrescar"; } catch (_) {}
      refreshBtn.addEventListener("click", () => refreshNow({ silent: false }));
    }

    exportBtn.addEventListener("click", exportCsv);

    // Filtro global
    searchEl?.addEventListener("input", () => {
      // Si hay muchos, no recargamos DB: filtramos local.
      // Si querés búsqueda server-side después, lo hacemos.
      render();
    });

    // Cuando se abre la pestaña regs, refrescamos (pero debounced)
    document.querySelectorAll('.tab[data-tab="regs"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        // Render inmediato (por si hay cache) + refresh silencioso
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

    // primer render “vacío”
    render();

    // Si el usuario ya cae en regs, cargamos de una.
    // Si no, igual hacemos un fetch silencioso para tener cache listo.
    if (isRegsTabActive()) {
      await refreshNow({ silent: true });
    } else {
      // cache en background (pero sin prometer nada)
      refreshDebounced(250);
    }
  })();
})();
