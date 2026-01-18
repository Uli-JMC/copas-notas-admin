/* ============================================================
   admin-promos.js ✅ PRO (DOM REAL + CRUD Supabase) — 2026-01
   UI REAL (admin.html):
   - Tab:          #tab-promos
   - Buttons:      #newPromoBtn #refreshPromosBtn
   - Table body:   #promosTbody

   Supabase:
   - Table: public.promos (RLS)
     Campos esperados (mínimo recomendado):
       id (uuid), active (bool), kind (text: BANNER|MODAL),
       target (text), priority (int),
       badge (text), title (text), description (text), note (text),
       cta_label (text), cta_href (text), media_img (text),
       dismiss_days (int),
       start_at (timestamptz nullable), end_at (timestamptz nullable),
       created_at, updated_at

   Features:
   ✅ Wake on tab (admin:tab)
   ✅ Render table (#promosTbody)
   ✅ Modal editor (sin tocar HTML)
   ✅ CRUD + toggle active
   ✅ Sanitiza CTA href
   ✅ Mensajes claros para RLS
============================================================ */
(function () {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);

  if (!window.APP || !APP.supabase) {
    console.error("[admin-promos] APP.supabase no existe. Orden: Supabase CDN -> supabaseClient.js -> admin-promos.js");
    return;
  }

  // DOM real
  const panel = $("#tab-promos");
  const tbody = $("#promosTbody");
  const btnNew = $("#newPromoBtn");
  const btnRefresh = $("#refreshPromosBtn");

  if (!panel || !tbody) return;

  // ---------------------------
  // Config
  // ---------------------------
  const TABLE = "promos";
  const TARGET_DEFAULT = "home";
  const MAX_DESC = 240;

  const ENABLE_REALTIME = true;
  const REALTIME_DEBOUNCE_MS = 250;
  let realtimeChannel = null;

  // ---------------------------
  // Toast
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

  // ---------------------------
  // Utils
  // ---------------------------
  const safeStr = (x) => String(x ?? "");
  const cleanSpaces = (s) => safeStr(s).replace(/\s+/g, " ").trim();

  function looksLikeRLSError(err) {
    const m = safeStr(err?.message || "").toLowerCase();
    const c = safeStr(err?.code || "").toLowerCase();
    return (
      c === "42501" ||
      m.includes("42501") ||
      m.includes("rls") ||
      m.includes("row level security") ||
      m.includes("permission") ||
      m.includes("not allowed") ||
      m.includes("violates row-level security")
    );
  }

  function fmtShortDate(iso) {
    try {
      const d = new Date(safeStr(iso));
      if (isNaN(d.getTime())) return "—";
      return d.toLocaleDateString("es-CR", { day: "2-digit", month: "short", year: "numeric" }).replace(".", "");
    } catch (_) {
      return "—";
    }
  }

  function toKind(v) {
    const t = safeStr(v).trim().toLowerCase();
    return t === "modal" ? "MODAL" : "BANNER";
  }

  function fromKind(k) {
    const v = safeStr(k).trim().toUpperCase();
    return v === "MODAL" ? "modal" : "banner";
  }

  // ✅ URL sanitizer
  function sanitizeHref(raw) {
    const s = safeStr(raw).trim();
    if (!s) return "#";
    if (s === "#") return "#";
    if (s.startsWith("#")) return s;
    if (/^(mailto:|tel:)/i.test(s)) return s;
    if (/^https?:\/\//i.test(s)) return s;
    if (/^(wa\.me\/|www\.wa\.me\/)/i.test(s)) return "https://" + s;
    if (/^(javascript:|data:|vbscript:|file:)/i.test(s)) return "#";
    if (/^[a-z0-9.-]+\.[a-z]{2,}([\/?#].*)?$/i.test(s)) return "https://" + s;
    return "#";
  }

  async function ensureSession() {
    try {
      const res = await APP.supabase.auth.getSession();
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

  function stableSort(arr) {
    return (arr || []).slice().sort((a, b) => {
      const pa = Number(a?.priority) || 0;
      const pb = Number(b?.priority) || 0;
      if (pb !== pa) return pb - pa;

      const ca = safeStr(a?.created_at || "");
      const cb = safeStr(b?.created_at || "");
      const dcmp = cb.localeCompare(ca);
      if (dcmp !== 0) return dcmp;

      const ta = safeStr(a?.title || "");
      const tb = safeStr(b?.title || "");
      const tcmp = ta.localeCompare(tb);
      if (tcmp !== 0) return tcmp;

      return safeStr(a?.id || "").localeCompare(safeStr(b?.id || ""));
    });
  }

  function mapDbRow(r) {
    const row = r || {};
    return {
      id: row.id,
      active: !!row.active,
      kind: safeStr(row.kind || "BANNER").toUpperCase(),
      target: safeStr(row.target || TARGET_DEFAULT),
      priority: Number(row.priority) || 0,
      badge: safeStr(row.badge || ""),
      title: safeStr(row.title || "Promo"),
      description: safeStr(row.description || ""),
      note: safeStr(row.note || ""),
      cta_label: safeStr(row.cta_label || "Conocer"),
      cta_href: safeStr(row.cta_href || "#"),
      media_img: safeStr(row.media_img || ""),
      dismiss_days: Math.max(1, Number(row.dismiss_days) || 7),
      start_at: safeStr(row.start_at || ""),
      end_at: safeStr(row.end_at || ""),
      created_at: safeStr(row.created_at || ""),
    };
  }

  function mapUiToDbPayload(ui) {
    const x = ui || {};
    return {
      active: !!x.active,
      kind: safeStr(x.kind || "BANNER").toUpperCase(),
      target: safeStr(x.target || TARGET_DEFAULT).toLowerCase(),
      priority: Number(x.priority) || 0,
      badge: safeStr(x.badge || ""),
      title: safeStr(x.title || "Promo"),
      description: safeStr(x.description || ""),
      note: safeStr(x.note || ""),
      cta_label: safeStr(x.cta_label || "Conocer"),
      cta_href: sanitizeHref(x.cta_href || "#"),
      media_img: safeStr(x.media_img || ""),
      dismiss_days: Math.max(1, Number(x.dismiss_days) || 7),
      start_at: cleanSpaces(x.start_at || "") || null,
      end_at: cleanSpaces(x.end_at || "") || null,
    };
  }

  // ---------------------------
  // CRUD Supabase
  // ---------------------------
  async function fetchPromos() {
    const { data, error } = await APP.supabase
      .from(TABLE)
      .select("*")
      .eq("target", TARGET_DEFAULT)
      .order("priority", { ascending: false })
      .order("created_at", { ascending: false })
      .order("title", { ascending: true });

    if (error) throw error;
    const arr = Array.isArray(data) ? data : [];
    return stableSort(arr.map(mapDbRow));
  }

  async function insertPromo(payloadDb) {
    const { data, error } = await APP.supabase.from(TABLE).insert(payloadDb).select("*").single();
    if (error) throw error;
    return mapDbRow(data);
  }

  async function updatePromo(id, payloadDb) {
    const { data, error } = await APP.supabase.from(TABLE).update(payloadDb).eq("id", id).select("*").single();
    if (error) throw error;
    return mapDbRow(data);
  }

  async function deletePromo(id) {
    const { error } = await APP.supabase.from(TABLE).delete().eq("id", id);
    if (error) throw error;
    return true;
  }

  // ---------------------------
  // State
  // ---------------------------
  const state = {
    didBind: false,
    didInit: false,
    busy: false,
    items: [],
  };

  function setBusy(on) {
    state.busy = !!on;
    try {
      if (btnNew) btnNew.disabled = !!on;
      if (btnRefresh) btnRefresh.disabled = !!on;
    } catch (_) {}
  }

  // ---------------------------
  // Render table
  // ---------------------------
  function renderTable() {
    const q = cleanSpaces($("#search")?.value || "").toLowerCase();
    const items = stableSort(state.items || []).filter((p) => {
      if (!q) return true;
      return (
        safeStr(p.title).toLowerCase().includes(q) ||
        safeStr(p.description).toLowerCase().includes(q) ||
        safeStr(p.badge).toLowerCase().includes(q) ||
        safeStr(p.kind).toLowerCase().includes(q)
      );
    });

    tbody.innerHTML = "";

    if (!items.length) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td colspan="5" style="opacity:.85; padding:16px;">
          No hay promos todavía. Usá <b>“Nueva promo”</b>.
        </td>`;
      tbody.appendChild(tr);
      return;
    }

    const frag = document.createDocumentFragment();

    items.forEach((p) => {
      const tr = document.createElement("tr");
      tr.dataset.id = safeStr(p.id || "");

      const kind = p.kind === "MODAL" ? "MODAL" : "BANNER";
      const active = p.active ? "ACTIVA" : "INACTIVA";
      const meta = `${kind} · ${active} · prio ${Number(p.priority) || 0}`;

      tr.innerHTML = `
        <td>${escapeHtml(kind)}</td>
        <td>
          <div style="font-weight:700;">${escapeHtml(p.title || "Promo")}</div>
          <div style="opacity:.8; font-size:.92rem;">${escapeHtml(meta)}</div>
        </td>
        <td style="max-width:380px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
          ${escapeHtml(p.description || "—")}
        </td>
        <td>${escapeHtml(fmtShortDate(p.created_at))}</td>
        <td style="display:flex; gap:8px; justify-content:flex-end;">
          <button class="btn btn--ghost" type="button" data-action="toggle">
            ${p.active ? "Pausar" : "Activar"}
          </button>
          <button class="btn btn--ghost" type="button" data-action="edit">Editar</button>
          <button class="btn" type="button" data-action="delete">Eliminar</button>
        </td>
      `;

      frag.appendChild(tr);
    });

    tbody.appendChild(frag);
  }

  // ---------------------------
  // Modal Editor (sin tocar HTML)
  // ---------------------------
  function ensureModal() {
    let m = $("#ecnPromoModal");
    if (m) return m;

    m = document.createElement("div");
    m.id = "ecnPromoModal";
    m.style.position = "fixed";
    m.style.inset = "0";
    m.style.background = "rgba(0,0,0,.65)";
    m.style.display = "none";
    m.style.alignItems = "center";
    m.style.justifyContent = "center";
    m.style.padding = "18px";
    m.style.zIndex = "9999";

    m.innerHTML = `
      <div style="max-width:820px; width:100%; background: rgba(20,20,20,.96); border:1px solid rgba(255,255,255,.10); border-radius:16px; overflow:hidden;">
        <div style="display:flex; justify-content:space-between; align-items:center; padding:12px 14px; border-bottom:1px solid rgba(255,255,255,.10);">
          <div>
            <p id="ecnPromoModalTitle" style="margin:0; font-weight:700;">Promo</p>
            <p style="margin:4px 0 0; opacity:.8; font-size:.92rem;">Crear / editar promo (banner o modal)</p>
          </div>
          <button id="ecnPromoClose" class="btn" type="button">Cerrar</button>
        </div>

        <form id="ecnPromoForm" style="padding:14px; display:grid; gap:12px;">
          <input type="hidden" id="ecnPromoId" />

          <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:12px;">
            <div class="field">
              <label class="label" for="ecnKind">Tipo</label>
              <select class="select" id="ecnKind">
                <option value="banner">BANNER</option>
                <option value="modal">MODAL</option>
              </select>
            </div>
            <div class="field">
              <label class="label" for="ecnActive">Estado</label>
              <select class="select" id="ecnActive">
                <option value="true">ACTIVA</option>
                <option value="false">INACTIVA</option>
              </select>
            </div>
            <div class="field">
              <label class="label" for="ecnPriority">Prioridad</label>
              <input class="input" id="ecnPriority" type="number" min="0" step="1" value="10" />
            </div>
          </div>

          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
            <div class="field">
              <label class="label" for="ecnBadge">Badge</label>
              <input class="input" id="ecnBadge" type="text" maxlength="20" placeholder="NUEVO" />
            </div>
            <div class="field">
              <label class="label" for="ecnTitle">Título</label>
              <input class="input" id="ecnTitle" type="text" maxlength="70" placeholder="Ej: Promo de enero" required />
            </div>
          </div>

          <div class="field">
            <label class="label" for="ecnDesc">Descripción</label>
            <textarea class="textarea" id="ecnDesc" rows="3" maxlength="${MAX_DESC}" placeholder="Texto corto (máx ${MAX_DESC})"></textarea>
            <div style="opacity:.8; font-size:.9rem; margin-top:6px;">Chars: <span id="ecnDescCount">0</span>/${MAX_DESC}</div>
          </div>

          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
            <div class="field">
              <label class="label" for="ecnCtaLabel">CTA label</label>
              <input class="input" id="ecnCtaLabel" type="text" maxlength="22" placeholder="Conocer" />
            </div>
            <div class="field">
              <label class="label" for="ecnCtaHref">CTA href</label>
              <input class="input" id="ecnCtaHref" type="text" maxlength="160" placeholder="https://... o #ancla" />
            </div>
          </div>

          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
            <div class="field">
              <label class="label" for="ecnMediaImg">Imagen (url)</label>
              <input class="input" id="ecnMediaImg" type="text" maxlength="240" placeholder="https://..." />
            </div>
            <div class="field">
              <label class="label" for="ecnDismiss">Dismiss days</label>
              <input class="input" id="ecnDismiss" type="number" min="1" step="1" value="7" />
            </div>
          </div>

          <div class="field">
            <label class="label" for="ecnNote">Nota interna</label>
            <input class="input" id="ecnNote" type="text" maxlength="120" placeholder="Opcional" />
          </div>

          <div id="ecnPromoPreview" style="border:1px solid rgba(255,255,255,.10); background: rgba(255,255,255,.05); border-radius:16px; padding:12px;"></div>

          <div style="display:flex; gap:10px; justify-content:flex-end;">
            <button class="btn" type="button" id="ecnPromoReset">Limpiar</button>
            <button class="btn primary" type="submit" id="ecnPromoSave">Guardar</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(m);

    const close = () => (m.style.display = "none");
    m.addEventListener("click", (e) => { if (e.target === m) close(); });
    m.querySelector("#ecnPromoClose")?.addEventListener("click", close);

    // live preview
    const form = m.querySelector("#ecnPromoForm");
    const idEl = m.querySelector("#ecnPromoId");
    const kindEl = m.querySelector("#ecnKind");
    const activeEl = m.querySelector("#ecnActive");
    const prioEl = m.querySelector("#ecnPriority");
    const badgeEl = m.querySelector("#ecnBadge");
    const titleEl = m.querySelector("#ecnTitle");
    const descEl = m.querySelector("#ecnDesc");
    const countEl = m.querySelector("#ecnDescCount");
    const ctaLabelEl = m.querySelector("#ecnCtaLabel");
    const ctaHrefEl = m.querySelector("#ecnCtaHref");
    const mediaEl = m.querySelector("#ecnMediaImg");
    const dismissEl = m.querySelector("#ecnDismiss");
    const noteEl = m.querySelector("#ecnNote");
    const previewEl = m.querySelector("#ecnPromoPreview");
    const resetBtn = m.querySelector("#ecnPromoReset");

    function renderPreview() {
      const kind = toKind(kindEl?.value);
      const active = activeEl?.value === "true";
      const title = safeStr(titleEl?.value || "Promo");
      const desc = safeStr(descEl?.value || "");
      const badge = safeStr(badgeEl?.value || "");
      const cta = safeStr(ctaLabelEl?.value || "Conocer");
      const href = sanitizeHref(ctaHrefEl?.value || "#");
      const media = safeStr(mediaEl?.value || "");
      const note = safeStr(noteEl?.value || "");

      if (countEl && descEl) countEl.textContent = String((descEl.value || "").length);

      if (!previewEl) return;
      previewEl.innerHTML = `
        <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center;">
          ${badge ? `<span class="badge">${escapeHtml(badge)}</span>` : ``}
          <span class="pill">${escapeHtml(kind)}</span>
          <span class="pill">${escapeHtml(active ? "ACTIVA" : "INACTIVA")}</span>
          <span class="pill">prio ${escapeHtml(prioEl?.value || "0")}</span>
        </div>
        <div style="margin-top:10px;">
          <div style="font-weight:700; margin-bottom:6px;">${escapeHtml(title)}</div>
          ${desc ? `<div style="opacity:.8; line-height:1.5;">${escapeHtml(desc)}</div>` : ``}
        </div>
        ${kind === "MODAL" ? `
          <div style="margin-top:10px; display:flex; gap:10px; flex-wrap:wrap; align-items:center;">
            <span class="pill">Imagen:</span>
            <span style="opacity:.8;">${media ? escapeHtml(media) : "(vacía)"}</span>
          </div>
          ${note ? `<div style="margin-top:8px; opacity:.7; font-size:12px;">${escapeHtml(note)}</div>` : ``}
        ` : ``}
        <div style="margin-top:12px; display:flex; gap:10px; flex-wrap:wrap; align-items:center;">
          <a class="btn primary" href="${escapeHtml(href)}" target="_blank" rel="noopener">${escapeHtml(cta)}</a>
          ${href === "#" ? `<span style="opacity:.7; font-size:12px;">(Link inválido o vacío)</span>` : ``}
        </div>
      `;
    }

    [kindEl, activeEl, prioEl, badgeEl, titleEl, descEl, ctaLabelEl, ctaHrefEl, mediaEl, dismissEl, noteEl].forEach((el) => {
      if (!el) return;
      el.addEventListener("input", renderPreview);
      el.addEventListener("change", renderPreview);
    });

    resetBtn?.addEventListener("click", () => {
      idEl.value = "";
      kindEl.value = "banner";
      activeEl.value = "true";
      prioEl.value = "10";
      badgeEl.value = "NUEVO";
      titleEl.value = "";
      descEl.value = "";
      ctaLabelEl.value = "Conocer";
      ctaHrefEl.value = "";
      mediaEl.value = "";
      dismissEl.value = "7";
      noteEl.value = "";
      renderPreview();
    });

    form?.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (state.busy) return;

      const ui = {
        id: cleanSpaces(idEl.value || ""),
        kind: toKind(kindEl.value),
        active: activeEl.value === "true",
        priority: Number(prioEl.value) || 0,
        badge: safeStr(badgeEl.value || ""),
        title: cleanSpaces(titleEl.value || ""),
        description: safeStr(descEl.value || ""),
        cta_label: safeStr(ctaLabelEl.value || "Conocer"),
        cta_href: sanitizeHref(ctaHrefEl.value || "#"),
        media_img: safeStr(mediaEl.value || ""),
        dismiss_days: Math.max(1, Number(dismissEl.value) || 7),
        note: safeStr(noteEl.value || ""),
        target: TARGET_DEFAULT,
        start_at: "",
        end_at: "",
      };

      if (!ui.title || ui.title.length < 2) {
        toast("Revisá", "Poné un título válido (mínimo 2 caracteres).");
        return;
      }

      setBusy(true);
      try {
        const s = await ensureSession();
        if (!s) return;

        const payloadDb = mapUiToDbPayload(ui);

        if (ui.id) {
          await updatePromo(ui.id, payloadDb);
          toast("Guardado", "Promo actualizada.", 1800);
        } else {
          const saved = await insertPromo(payloadDb);
          idEl.value = saved.id || "";
          toast("Guardado", "Promo creada.", 1800);
        }

        await refresh();
        m.style.display = "none";
      } catch (err) {
        console.error("[admin-promos] save error:", err);
        if (looksLikeRLSError(err)) toast("RLS", "Bloqueado. Faltan policies INSERT/UPDATE en promos.", 5200);
        else toast("Error", "No se pudo guardar la promo.", 4200);
      } finally {
        setBusy(false);
      }
    });

    // expose helpers on modal
    m._fill = (p) => {
      m.querySelector("#ecnPromoId").value = safeStr(p?.id || "");
      m.querySelector("#ecnKind").value = fromKind(p?.kind || "BANNER");
      m.querySelector("#ecnActive").value = String(!!p?.active);
      m.querySelector("#ecnPriority").value = String(Number(p?.priority) || 0);
      m.querySelector("#ecnBadge").value = safeStr(p?.badge || "");
      m.querySelector("#ecnTitle").value = safeStr(p?.title || "");
      m.querySelector("#ecnDesc").value = safeStr(p?.description || "");
      m.querySelector("#ecnCtaLabel").value = safeStr(p?.cta_label || "Conocer");
      m.querySelector("#ecnCtaHref").value = safeStr(p?.cta_href || "");
      m.querySelector("#ecnMediaImg").value = safeStr(p?.media_img || "");
      m.querySelector("#ecnDismiss").value = String(Number(p?.dismiss_days) || 7);
      m.querySelector("#ecnNote").value = safeStr(p?.note || "");
      // trigger preview
      const ev = new Event("input");
      m.querySelector("#ecnDesc")?.dispatchEvent(ev);
      m.querySelector("#ecnTitle")?.dispatchEvent(ev);
    };

    // initial preview
    try {
      const ev = new Event("input");
      m.querySelector("#ecnTitle")?.dispatchEvent(ev);
    } catch (_) {}

    return m;
  }

  function openNewModal() {
    const m = ensureModal();
    // reset default
    m.querySelector("#ecnPromoReset")?.click();
    m.style.display = "flex";
  }

  function openEditModal(p) {
    const m = ensureModal();
    m._fill?.(p);
    m.style.display = "flex";
  }

  // ---------------------------
  // Refresh
  // ---------------------------
  async function refresh() {
    if (state.busy) return;
    setBusy(true);

    try {
      const s = await ensureSession();
      if (!s) return;

      state.items = await fetchPromos();
      renderTable();
    } catch (err) {
      console.error("[admin-promos] fetch error:", err);
      if (looksLikeRLSError(err)) {
        toast("RLS BLOQUEANDO", "No hay permiso para leer promos. Hay que crear policy SELECT para admins.", 5200);
      } else {
        toast("Error", "No se pudo cargar promos. Revisá tabla/policies.", 5200);
      }
    } finally {
      setBusy(false);
    }
  }

  // ---------------------------
  // Table actions
  // ---------------------------
  async function onTableClick(e) {
    const btn = e.target && e.target.closest ? e.target.closest("[data-action]") : null;
    if (!btn) return;

    const tr = btn.closest("tr");
    const id = tr ? safeStr(tr.dataset.id || "") : "";
    if (!id) return;

    const p = (state.items || []).find((x) => safeStr(x.id) === id);
    if (!p) return;

    const action = safeStr(btn.dataset.action || "");

    if (action === "edit") {
      openEditModal(p);
      return;
    }

    if (action === "toggle") {
      setBusy(true);
      try {
        const s = await ensureSession();
        if (!s) return;

        const next = { ...p, active: !p.active };
        await updatePromo(p.id, mapUiToDbPayload(next));
        toast("Actualizado", next.active ? "Promo activada." : "Promo pausada.", 1800);
        await refresh();
      } catch (err) {
        console.error("[admin-promos] toggle error:", err);
        if (looksLikeRLSError(err)) toast("RLS", "Bloqueado. Falta policy UPDATE en promos.", 5200);
        else toast("Error", "No se pudo actualizar el estado.", 4200);
      } finally {
        setBusy(false);
      }
      return;
    }

    if (action === "delete") {
      const ok = window.confirm("¿Eliminar esta promo? Esta acción no se puede deshacer.");
      if (!ok) return;

      setBusy(true);
      try {
        const s = await ensureSession();
        if (!s) return;

        await deletePromo(id);
        toast("Eliminada", "La promo fue eliminada.", 1800);
        await refresh();
      } catch (err) {
        console.error("[admin-promos] delete error:", err);
        if (looksLikeRLSError(err)) toast("RLS", "Bloqueado. Falta policy DELETE en promos.", 5200);
        else toast("Error", "No se pudo eliminar la promo.", 4200);
      } finally {
        setBusy(false);
      }
    }
  }

  // ---------------------------
  // Realtime
  // ---------------------------
  function wireRealtime() {
    if (!ENABLE_REALTIME) return;

    try {
      if (realtimeChannel) {
        try { APP.supabase.removeChannel(realtimeChannel); } catch (_) {}
        realtimeChannel = null;
      }

      realtimeChannel = APP.supabase
        .channel("admin-promos-realtime")
        .on("postgres_changes", { event: "*", schema: "public", table: TABLE }, () => {
          clearTimeout(wireRealtime._t);
          wireRealtime._t = setTimeout(() => refresh(), REALTIME_DEBOUNCE_MS);
        })
        .subscribe();
    } catch (e) {
      console.warn("[admin-promos] Realtime no disponible:", e);
    }
  }

  // ---------------------------
  // Bind / Init on tab
  // ---------------------------
  function bindOnce() {
    if (state.didBind) return;
    state.didBind = true;

    btnRefresh?.addEventListener("click", refresh);
    btnNew?.addEventListener("click", openNewModal);
    tbody?.addEventListener("click", onTableClick);

    // búsqueda global
    $("#search")?.addEventListener("input", () => renderTable());
  }

  async function initIfNeeded() {
    bindOnce();
    if (state.didInit) return;
    state.didInit = true;
    await refresh();
    wireRealtime();
  }

  // Wake on tab
  window.addEventListener("admin:tab", (e) => {
    const tab = e?.detail?.tab;
    if (tab !== "promos") return;
    const hidden = $("#tab-promos")?.hidden;
    if (hidden) return;
    initIfNeeded();
  });

  // fallback: si ya está visible
  try {
    if ($("#tab-promos") && $("#tab-promos").hidden === false) initIfNeeded();
  } catch (_) {}

  // API debug
  window.ECN_ADMIN_PROMOS = {
    refresh,
    openNewModal,
  };
})();
