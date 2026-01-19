/* ============================================================
   admin-registrations.js ✅ PRO (Supabase READ + Filtros + CSV + DELETE) — 2026-01 PATCH
   - Admin: lista inscripciones desde public.registrations
   - Join: events.title + event_dates.label (vía FK)
   - Filtro usa el search global #search (filtra local, sin pedir a DB)
   - Exporta CSV (lo filtrado en pantalla)
   - Botón "seedRegsBtn" se usa como "Refrescar"
   - ✅ NUEVO: borrar inscripción (si tu RLS lo permite para admins)

   ✅ SIN RECARGAR:
   - Espera admin:ready (admin-auth.js)
   - Carga solo al abrir tab "regs" vía admin:tab o click fallback
   - Protecciones anti-duplicado (throttle)

   Requiere (admin.html):
   - #tab-regs (panel)
   - #regsTbody (tbody)
   - #exportCsvBtn (botón)
   - #seedRegsBtn (botón) -> "Refrescar"
   - #search (input search global)
   ============================================================ */
(function () {
  "use strict";

  const VERSION = "2026-01-19.1";
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
    didBind: false,
    didBoot: false,
    didLoadOnce: false,
    mode: "unknown", // joinA|joinB|flat
    lastLoadAt: 0,   // throttle tab switching
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
    const evTitle = r?.events?.title || "";
    const dateLabel = r?.event_dates?.label || "";

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
  // Delete (admin)
  // ------------------------------------------------------------
  async function deleteRegistrationById(sb, id) {
    // Si tenés FK ON DELETE CASCADE a registration_notes, esto limpia todo.
    const { error } = await sb.from(TABLE).delete().eq("id", id);
    if (error) throw error;
  }

  // ------------------------------------------------------------
  // Render
  // ------------------------------------------------------------
  function render() {
    const list = filterList(S.list);

    if (S.loading && !list.length) {
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
        // ✅ Botón delete embebido en la misma celda (no cambia columnas)
        return `
          <tr data-id="${escapeHtml(r.id)}">
            <td>${escapeHtml(r.eventTitle)}</td>
            <td>${escapeHtml(r.dateLabel)}</td>
            <td>${escapeHtml(r.name)}</td>
            <td>${escapeHtml(r.email)}</td>
            <td>${escapeHtml(r.phone || "—")}</td>
            <td>${r.marketing ? "Sí" : "No"}</td>
            <td>
              <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
                <span>${escapeHtml(created)}</span>
                <button
                  type="button"
                  class="regDel"
                  data-id="${escapeHtml(r.id)}"
                  title="Eliminar inscripción"
                  aria-label="Eliminar inscripción"
                  style="border:0; background:transparent; cursor:pointer; opacity:.8; font-size:16px; line-height:1;"
                >🗑</button>
              </div>
            </td>
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

    if (!silent) toast("Inscripciones", "Cargando registros…", 900);
    render(); // muestra estado

    try {
      const sb = getSB();
      if (!sb) {
        toast("Supabase", "Falta supabaseClient.js antes de admin-registrations.js", 4200);
        S.list = [];
        render();
        return;
      }

      const session = await ensureSession(sb);
      if (!session) {
        S.list = [];
        render();
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

      render();
    } catch (err) {
      console.error("[admin-registrations]", err);

      if (isMissingTable(err)) {
        toast("BD", "La tabla registrations no existe en Supabase (public.registrations).", 4200);
      } else if (isRLSError(err)) {
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
  // Handlers UI
  // ------------------------------------------------------------
  const handleDeleteClick = withLock(async function (id) {
    const row = (S.list || []).find((x) => String(x.id) === String(id));
    const label = row ? `${row.name} • ${row.email}` : id;

    const ok = window.confirm(
      `Eliminar inscripción?\n\n${label}\n\nEsto NO se puede deshacer.`
    );
    if (!ok) return;

    try {
      const sb = getSB();
      if (!sb) return toast("Supabase", "Falta supabaseClient.js", 4200);

      const session = await ensureSession(sb);
      if (!session) return;

      toast("Eliminando", "Procesando…", 900);

      await deleteRegistrationById(sb, id);

      // actualizar local (sin reload)
      S.list = (S.list || []).filter((x) => String(x.id) !== String(id));
      render();
      toast("Listo", "Inscripción eliminada.", 1400);

      // refresh suave para garantizar consistencia (si querés comentar esta línea, decime)
      try { await refreshNow({ silent: true }); } catch (_) {}
    } catch (err) {
      console.error("[admin-registrations][delete]", err);

      if (isRLSError(err)) {
        toast(
          "RLS bloqueando",
          "Tu policy no permite DELETE en registrations para admins. Si querés esta acción, hay que habilitarla en RLS.",
          5200
        );
      } else {
        toast("Error", prettyError(err), 4200);
      }
    }
  });

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

    // Delegación: delete button
    tbody.addEventListener("click", (e) => {
      const btn = e.target && e.target.closest ? e.target.closest(".regDel") : null;
      if (!btn) return;
      const id = btn.getAttribute("data-id");
      if (!id) return;
      e.preventDefault();
      e.stopPropagation();
      handleDeleteClick(id);
    });

    // Click del tab (fallback) — NO duplica por throttle
    document.querySelectorAll('.tab[data-tab="regs"]').forEach((btn) => {
      btn.addEventListener("click", () => ensureLoaded(true));
    });

    // Evento de tabs (preferido)
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
    if (force && now - S.lastLoadAt < 250) return; // anti doble-disparo por click+event
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

    if (window.APP && APP.__adminReady) {
      bindOnce();
      if (!$("#tab-regs")?.hidden) ensureLoaded(true);
      return;
    }

    window.addEventListener(
      "admin:ready",
      () => {
        bindOnce();
        if (!$("#tab-regs")?.hidden) ensureLoaded(true);
      },
      { once: true }
    );
  }

  boot();
})();
