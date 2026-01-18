/* ============================================================
   admin-registrations.js ✅ PRO (Supabase READ + Filtros + CSV) — 2026-01 FIX
   - Admin: lista inscripciones desde public.registrations
   - Join: events.title + event_dates.label (vía FK)
   - Filtro usa el search global #search
   - Exporta CSV (lo filtrado en pantalla)
   - Botón "seedRegsBtn" se usa como "Refrescar"

   Requiere (admin.html):
   - #tab-regs (panel)
   - #regsTbody (tbody)
   - #exportCsvBtn (botón)
   - #seedRegsBtn (botón) -> "Refrescar"
   - #search (input search global)

   IMPORTANTE:
   - Si ves 403/42501 => faltan policies (RLS) para registrations (y joins).
   ============================================================ */
(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);

  // ------------------------------------------------------------
  // Guards
  // ------------------------------------------------------------
  if (!document.getElementById("appPanel")) return;

  if (!window.APP || !(APP.supabase || APP.sb)) {
    console.error(
      "APP.supabase no existe. Revisá el orden: Supabase CDN -> supabaseClient.js -> admin-registrations.js"
    );
    return;
  }

  const sb = APP.supabase || APP.sb;

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
  // Config DB — ALINEADO A TU SCHEMA
  // ------------------------------------------------------------
  const TABLE = "registrations";

  // Estrategias:
  // A) Join directo (si PostgREST reconoce relaciones)
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

  // B) Join por nombre FK típico (más robusto)
  // (en tu DDL existen constraints registrations_event_id_fkey / registrations_event_date_id_fkey)
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

  // C) Flat (último recurso) — no depende de relaciones
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
    mode: "unknown", // joinA|joinB|flat
  };

  // ------------------------------------------------------------
  // Auth check
  // ------------------------------------------------------------
  async function ensureSession() {
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
  // Fetch
  // ------------------------------------------------------------
  async function fetchRegistrations(selectStr) {
    const { data, error } = await sb
      .from(TABLE)
      .select(selectStr)
      .order("created_at", { ascending: false })
      .limit(1000);

    if (error) throw error;
    return Array.isArray(data) ? data : [];
  }

  async function fetchSmart() {
    // A) Join normal
    try {
      const data = await fetchRegistrations(SELECT_JOIN_A);
      S.mode = "joinA";
      return data;
    } catch (eA) {
      // B) Join por FK
      if (isJoinRelationError(eA)) {
        try {
          const data = await fetchRegistrations(SELECT_JOIN_B);
          S.mode = "joinB";
          return data;
        } catch (eB) {
          // seguimos a FLAT
        }
      }
      // C) Flat
      const data = await fetchRegistrations(SELECT_FLAT);
      S.mode = "flat";
      return data;
    }
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
      const hay = `${x.eventTitle} ${x.dateLabel} ${x.name} ${x.email} ${x.phone}`.toLowerCase();
      return hay.includes(q);
    });
  }

  // ------------------------------------------------------------
  // Render
  // ------------------------------------------------------------
  function render() {
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
  // Refresh
  // ------------------------------------------------------------
  async function refreshNow(opts) {
    const silent = !!opts?.silent;
    if (S.loading) return;
    S.loading = true;

    if (!silent) toast("Inscripciones", "Cargando registros…", 900);

    try {
      const session = await ensureSession();
      if (!session) {
        S.list = [];
        render();
        return;
      }

      const data = await fetchSmart();
      S.list = data.map(normalizeRow);

      if (!silent) {
        const tag =
          S.mode === "joinA" ? "" :
          S.mode === "joinB" ? " (join por FK)" :
          " (sin joins)";
        toast("Listo", "Inscripciones actualizadas." + tag, 1100);
      }

      render();
    } catch (err) {
      console.error("[admin-registrations]", err);

      if (isMissingTable(err)) {
        toast("BD", "La tabla registrations no existe en Supabase (public.registrations).", 4200);
      } else if (isRLSError(err)) {
        // ✅ Esto es tu caso actual
        toast(
          "RLS bloqueando",
          "No hay permiso para leer registrations. Hay que crear policy SELECT para admins (y para joins).",
          5200
        );
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

    const csv = "\uFEFF" + lines.join("\n");
    const fname = `registrations_${new Date().toISOString().slice(0, 10)}.csv`;
    downloadTextFile(fname, csv, "text/csv;charset=utf-8");
    toast("Exportar", "CSV generado.", 1200);
  }

  // ------------------------------------------------------------
  // Bind
  // ------------------------------------------------------------
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

    // Al abrir tab regs, refrescamos suave
    document.querySelectorAll('.tab[data-tab="regs"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        render();
        refreshDebounced(120);
      });
    });
  }

  // ------------------------------------------------------------
  // Init
  // ------------------------------------------------------------
  (async function init() {
    bindOnce();
    render();

    // No spamear al cargar: solo si el tab está activo
    if (isRegsTabActive()) {
      await refreshNow({ silent: true });
    }
  })();
})();
