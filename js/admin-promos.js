/* ============================================================
   admin-promos.js ✅ PRO (Supabase CRUD REAL + Hardened) — v2
   - Lista + Editor (banner / modal)
   - CRUD real en Supabase: public.promos (RLS + Auth)
   - ✅ No depende de data.js (migrado full Supabase)
   - ✅ Toast unificado (window.toast -> APP.toast -> fallback)
   - ✅ Sanitiza CTA href (bloquea javascript:, data:, vbscript:, file:)
   - ✅ Orden estable: priority desc + created_at desc + title asc + id
   - ✅ Realtime (opcional) + refresh seguro con debounce
   - ✅ Manejo claro de RLS / sesión expirada
   - ✅ Respeta UI existente de admin.html (promoEmptyCta / newPromoBtnTop bridge)
   ============================================================ */
(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);

  // ------------------------------------------------------------
  // Guards
  // ------------------------------------------------------------
  if (!window.APP || !APP.supabase) {
    console.error("APP.supabase no existe. Revisá el orden: Supabase CDN -> supabaseClient.js -> admin-promos.js");
    return;
  }

  const listEl = $("#promosList");
  const emptyEl = $("#promoEmpty");
  const formEl = $("#promoForm");

  if (!listEl || !emptyEl || !formEl) return;

  // Fields
  const pType = $("#pType");
  const pActive = $("#pActive");
  const pPriority = $("#pPriority");
  const pBadge = $("#pBadge");
  const pTitle = $("#pTitle");
  const pDesc = $("#pDesc");
  const pDescCount = $("#pDescCount");
  const pCtaLabel = $("#pCtaLabel");
  const pCtaHref = $("#pCtaHref");
  const pMediaImg = $("#pMediaImg");
  const pDismissDays = $("#pDismissDays");
  const pNote = $("#pNote");
  const promoPreview = $("#promoPreview");

  const saveBtn = $("#savePromoBtn");
  const newBtn = $("#newPromoBtn");
  const delBtn = $("#deletePromoBtn");

  // Extra (top buttons / empty state cta)
  const emptyCtaBtn = $("#promoEmptyCta");
  const topNewBtn = $("#newPromoBtnTop");

  // ------------------------------------------------------------
  // Config tabla/columnas
  // ------------------------------------------------------------
  const TABLE = "promos";
  const TARGET_DEFAULT = "home";

  // Realtime (si molesta, ponelo en false)
  const ENABLE_REALTIME = true;
  const REALTIME_DEBOUNCE_MS = 250;

  // State
  let currentId = null;      // uuid en Supabase
  let currentRow = null;     // cache del row actual
  let lastList = [];         // cache lista
  let refreshing = false;
  let pendingRefresh = false;
  let sub = null;

  // ------------------------------------------------------------
  // Toast (unificado)
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

  function esc(s) {
    return safeStr(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function cleanSpaces(s) {
    return safeStr(s).replace(/\s+/g, " ").trim();
  }

  function toKind(v) {
    const t = safeStr(v).trim().toLowerCase();
    return t === "modal" ? "MODAL" : "BANNER";
  }

  function fromKind(k) {
    const v = safeStr(k).trim().toUpperCase();
    return v === "MODAL" ? "modal" : "banner";
  }

  function showForm() {
    emptyEl.hidden = true;
    formEl.hidden = false;
  }

  function showEmpty() {
    formEl.hidden = true;
    emptyEl.hidden = false;
    currentId = null;
    currentRow = null;
  }

  function setDescCount() {
    if (!pDescCount || !pDesc) return;
    pDescCount.textContent = String((pDesc.value || "").length);
  }

  // ✅ URL sanitizer (bloquea javascript:, data:, vbscript:, file:, etc.)
  function sanitizeHref(raw) {
    const s = safeStr(raw).trim();
    if (!s) return "#";
    if (s === "#") return "#";

    // anchors locales
    if (s.startsWith("#")) return s;

    // protocolos permitidos
    if (/^(mailto:|tel:)/i.test(s)) return s;
    if (/^https?:\/\//i.test(s)) return s;

    // permitir wa.me sin protocolo
    if (/^(wa\.me\/|www\.wa\.me\/)/i.test(s)) return "https://" + s;

    // bloquear protocolos peligrosos
    if (/^(javascript:|data:|vbscript:|file:)/i.test(s)) return "#";

    // dominios tipo "www.site.com" -> https
    if (/^[a-z0-9.-]+\.[a-z]{2,}([\/?#].*)?$/i.test(s)) return "https://" + s;

    return "#";
  }

  function stableSort(promos) {
    return promos.slice().sort((a, b) => {
      const pa = Number(a?.priority) || 0;
      const pb = Number(b?.priority) || 0;
      if (pb !== pa) return pb - pa;

      const ca = safeStr(a?.created_at || "");
      const cb = safeStr(b?.created_at || "");
      const dateCmp = cb.localeCompare(ca);
      if (dateCmp !== 0) return dateCmp;

      const ta = safeStr(a?.title || "");
      const tb = safeStr(b?.title || "");
      const tCmp = ta.localeCompare(tb);
      if (tCmp !== 0) return tCmp;

      return safeStr(a?.id || "").localeCompare(safeStr(b?.id || ""));
    });
  }

  function disableForm(disabled) {
    try {
      const els = formEl.querySelectorAll("input, textarea, select, button");
      els.forEach((el) => (el.disabled = !!disabled));
    } catch (_) {}
  }

  function isRLSError(err) {
    const m = safeStr(err?.message || err || "").toLowerCase();
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

  function mapDbToUiRow(r) {
    const row = r || {};
    return {
      id: row.id,
      active: !!row.active,
      kind: safeStr(row.kind || "BANNER").toUpperCase(),
      target: safeStr(row.target || TARGET_DEFAULT),
      priority: Number(row.priority) || 0,
      badge: safeStr(row.badge || ""),
      title: safeStr(row.title || "Promo"),
      desc: safeStr(row.description || row.desc || ""),
      note: safeStr(row.note || ""),
      ctaLabel: safeStr(row.cta_label || row.ctaLabel || "Conocer"),
      ctaHref: safeStr(row.cta_href || row.ctaHref || "#"),
      mediaImg: safeStr(row.media_img || row.mediaImg || ""),
      dismissDays: Math.max(1, Number(row.dismiss_days || row.dismissDays) || 7),
      startAt: safeStr(row.start_at || row.startAt || ""),
      endAt: safeStr(row.end_at || row.endAt || ""),
      created_at: safeStr(row.created_at || ""),
      updated_at: safeStr(row.updated_at || ""),
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
      description: safeStr(x.desc || ""),
      note: safeStr(x.note || ""),

      cta_label: safeStr(x.ctaLabel || "Conocer"),
      cta_href: sanitizeHref(x.ctaHref || "#"),
      media_img: safeStr(x.mediaImg || ""),

      dismiss_days: Math.max(1, Number(x.dismissDays) || 7),
      start_at: cleanSpaces(x.startAt || "") || null,
      end_at: cleanSpaces(x.endAt || "") || null,
    };
  }

  // ------------------------------------------------------------
  // Supabase: auth/session check (por si acaso)
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

  // ------------------------------------------------------------
  // Supabase: CRUD
  // ------------------------------------------------------------
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
    return stableSort(arr.map(mapDbToUiRow));
  }

  async function insertPromo(payloadDb) {
    const { data, error } = await APP.supabase
      .from(TABLE)
      .insert(payloadDb)
      .select("*")
      .single();
    if (error) throw error;
    return mapDbToUiRow(data);
  }

  async function updatePromo(id, payloadDb) {
    const { data, error } = await APP.supabase
      .from(TABLE)
      .update(payloadDb)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return mapDbToUiRow(data);
  }

  async function deletePromo(id) {
    const { error } = await APP.supabase.from(TABLE).delete().eq("id", id);
    if (error) throw error;
    return true;
  }

  // ------------------------------------------------------------
  // Render
  // ------------------------------------------------------------
  function renderList(promos) {
    const arr = stableSort(Array.isArray(promos) ? promos : []);

    if (!arr.length) {
      listEl.innerHTML = `<div class="galleryListEmpty">No hay promos todavía.</div>`;
      return;
    }

    listEl.innerHTML = arr
      .map((p) => {
        const id = safeStr(p?.id || "");
        const isActive = !!p.active;
        const kind = safeStr(p.kind || "BANNER").toUpperCase();
        const target = safeStr(p.target || TARGET_DEFAULT).toUpperCase();

        return `
          <div class="item" data-id="${esc(id)}" role="button" tabindex="0" aria-label="Promo ${esc(p.title)}">
            <div>
              <p class="itemTitle">${esc(p.title || "Promo")}</p>
              <p class="itemMeta">${esc(kind)} · ${isActive ? "ACTIVA" : "INACTIVA"} · ${esc(target)}</p>
            </div>

            <div class="pills">
              <button class="pill" type="button" data-act="toggle">
                ${isActive ? "PAUSAR" : "ON"}
              </button>
              <button class="pill" type="button" data-act="edit">EDITAR</button>
              <button class="pill danger" type="button" data-act="delete">ELIMINAR</button>
            </div>
          </div>
        `;
      })
      .join("");
  }

  function fillForm(p) {
    currentId = p?.id || null;
    currentRow = p || null;

    pType.value = fromKind(p?.kind);
    pActive.value = String(!!p?.active);
    pPriority.value = String(Number(p?.priority) || 0);
    pBadge.value = safeStr(p?.badge || "");
    pTitle.value = safeStr(p?.title || "");
    pDesc.value = safeStr(p?.desc || "");
    pCtaLabel.value = safeStr(p?.ctaLabel || "");
    pCtaHref.value = safeStr(p?.ctaHref || "");
    pMediaImg.value = safeStr(p?.mediaImg || "");
    pDismissDays.value = String(Number(p?.dismissDays) || 7);
    pNote.value = safeStr(p?.note || "");

    setDescCount();
    renderPreview();
    showForm();
  }

  function blankForm() {
    currentId = null;
    currentRow = null;

    pType.value = "banner";
    pActive.value = "true";
    pPriority.value = "10";
    pBadge.value = "NUEVO";
    pTitle.value = "";
    pDesc.value = "";
    pCtaLabel.value = "Conocer";
    pCtaHref.value = "";
    pMediaImg.value = "";
    pDismissDays.value = "7";
    pNote.value = "";

    setDescCount();
    renderPreview();
    showForm();
  }

  function findById(id) {
    return (lastList || []).find((x) => safeStr(x?.id) === safeStr(id)) || null;
  }

  function renderPreview() {
    if (!promoPreview) return;

    const kind = toKind(pType?.value);
    const title = safeStr(pTitle?.value || "Promo");
    const desc = safeStr(pDesc?.value || "");
    const badge = safeStr(pBadge?.value || "");
    const cta = safeStr(pCtaLabel?.value || "Conocer");
    const href = sanitizeHref(pCtaHref?.value || "#");
    const media = safeStr(pMediaImg?.value || "");
    const note = safeStr(pNote?.value || "");

    promoPreview.innerHTML = `
      <div style="
        border:1px solid rgba(255,255,255,.10);
        background: rgba(255,255,255,.05);
        border-radius: 16px;
        padding: 12px;
      ">
        <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
          ${badge ? `<span class="badge">${esc(badge)}</span>` : ``}
          <span class="pill">${esc(kind)}</span>
          <span class="pill">${esc(pActive?.value === "true" ? "ACTIVA" : "INACTIVA")}</span>
        </div>

        <div style="margin-top:10px;">
          <div style="font-weight:700; margin-bottom:6px;">${esc(title)}</div>
          ${desc ? `<div style="color: rgba(255,255,255,.75); line-height:1.5;">${esc(desc)}</div>` : ``}
        </div>

        ${kind === "MODAL" ? `
          <div style="margin-top:10px; display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
            <span class="pill">Imagen:</span>
            <span style="color: rgba(255,255,255,.72)">${media ? esc(media) : "(vacía)"}</span>
          </div>
          ${note ? `<div style="margin-top:8px; color: rgba(255,255,255,.62); font-size:12px;">${esc(note)}</div>` : ``}
        ` : ``}

        <div style="margin-top:12px; display:flex; gap:10px; flex-wrap:wrap;">
          <a class="btn primary" href="${esc(href)}" target="_blank" rel="noopener">${esc(cta)}</a>
          ${href === "#" ? `<span style="color: rgba(255,255,255,.62); font-size:12px;">(Link inválido o vacío)</span>` : ``}
        </div>
      </div>
    `;
  }

  function collectUi() {
    const title = cleanSpaces(pTitle?.value || "Promo");

    return {
      id: currentId || null,
      active: pActive?.value === "true",
      kind: toKind(pType?.value),
      target: TARGET_DEFAULT,
      priority: Number(pPriority?.value) || 0,

      badge: safeStr(pBadge?.value || ""),
      title: title || "Promo",
      desc: safeStr(pDesc?.value || ""),
      note: safeStr(pNote?.value || ""),

      ctaLabel: safeStr(pCtaLabel?.value || "Conocer"),
      ctaHref: sanitizeHref(pCtaHref?.value || "#"),
      mediaImg: safeStr(pMediaImg?.value || ""),

      dismissDays: Math.max(1, Number(pDismissDays?.value) || 7),

      startAt: "",
      endAt: "",
    };
  }

  function setBusy(on) {
    disableForm(!!on);
    try {
      if (saveBtn) saveBtn.textContent = on ? "Guardando…" : "Guardar";
    } catch (_) {}
  }

  // ------------------------------------------------------------
  // Refresh (safe)
  // ------------------------------------------------------------
  async function refreshList(opts) {
    const keepSelection = !!opts?.keepSelection;

    if (refreshing) {
      pendingRefresh = true;
      return;
    }

    refreshing = true;
    try {
      const s = await ensureSession();
      if (!s) return;

      const promos = await fetchPromos();
      lastList = promos;

      renderList(promos);

      if (keepSelection && currentId) {
        const updated = findById(currentId);
        if (updated) fillForm(updated);
      }
    } catch (e) {
      console.error(e);
      if (isRLSError(e)) toast("RLS", "Acceso bloqueado. Faltan policies SELECT en promos.", 4200);
      else toast("Error", "No se pudo cargar promos.", 3600);
    } finally {
      refreshing = false;
      if (pendingRefresh) {
        pendingRefresh = false;
        setTimeout(() => refreshList({ keepSelection }), 0);
      }
    }
  }

  // ------------------------------------------------------------
  // Realtime
  // ------------------------------------------------------------
  function wireRealtime() {
    if (!ENABLE_REALTIME) return;

    try {
      if (sub) {
        try { APP.supabase.removeChannel(sub); } catch (_) {}
        sub = null;
      }

      sub = APP.supabase
        .channel("admin-promos-realtime")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: TABLE },
          () => {
            clearTimeout(wireRealtime._t);
            wireRealtime._t = setTimeout(() => {
              refreshList({ keepSelection: true });
            }, REALTIME_DEBOUNCE_MS);
          }
        )
        .subscribe();
    } catch (e) {
      console.warn("Realtime no disponible:", e);
    }
  }

  // ------------------------------------------------------------
  // Wiring inputs -> preview
  // ------------------------------------------------------------
  [
    pType, pActive, pPriority, pBadge, pTitle, pDesc,
    pCtaLabel, pCtaHref, pMediaImg, pDismissDays, pNote
  ].forEach((el) => {
    if (!el) return;
    el.addEventListener("input", () => {
      if (el === pDesc) setDescCount();
      renderPreview();
    });
    el.addEventListener("change", () => {
      if (el === pDesc) setDescCount();
      renderPreview();
    });
  });

  // ------------------------------------------------------------
  // Actions: create/update
  // ------------------------------------------------------------
  formEl.addEventListener("submit", async (e) => {
    e.preventDefault();

    const ui = collectUi();

    if (!ui.title || ui.title.trim().length < 2) {
      toast("Revisá", "Poné un título válido (mínimo 2 caracteres).");
      return;
    }

    setBusy(true);
    try {
      const s = await ensureSession();
      if (!s) return;

      const payloadDb = mapUiToDbPayload(ui);

      let saved;
      if (currentId) saved = await updatePromo(currentId, payloadDb);
      else saved = await insertPromo(payloadDb);

      currentId = saved.id;
      currentRow = saved;

      toast("Guardado", "Promo guardada correctamente.", 2200);

      await refreshList({ keepSelection: true });

      const row = findById(currentId);
      if (row) fillForm(row);
    } catch (err) {
      console.error(err);
      if (isRLSError(err)) toast("RLS", "Bloqueado. Faltan policies INSERT/UPDATE en promos.", 4200);
      else toast("Error", "No se pudo guardar la promo. Revisá la tabla promos.", 3600);
    } finally {
      setBusy(false);
    }
  });

  // Nueva
  function actionNew() {
    blankForm();
  }
  newBtn?.addEventListener("click", actionNew);
  emptyCtaBtn?.addEventListener("click", actionNew);
  topNewBtn?.addEventListener("click", actionNew);

  // Eliminar desde editor
  delBtn?.addEventListener("click", async () => {
    if (!currentId) return;

    const ok = confirm("¿Eliminar esta promo? Esta acción no se puede deshacer.");
    if (!ok) return;

    setBusy(true);
    try {
      const s = await ensureSession();
      if (!s) return;

      await deletePromo(currentId);
      toast("Eliminada", "La promo fue eliminada.", 2200);

      currentId = null;
      currentRow = null;

      await refreshList({ keepSelection: false });
      showEmpty();
    } catch (err) {
      console.error(err);
      if (isRLSError(err)) toast("RLS", "Bloqueado. Falta policy DELETE en promos.", 4200);
      else toast("Error", "No se pudo eliminar la promo.", 3600);
    } finally {
      setBusy(false);
    }
  });

  // Clicks en lista (delegación)
  listEl.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-act]");
    const rowEl = e.target.closest(".item[data-id]");
    if (!rowEl) return;

    const id = rowEl.getAttribute("data-id");
    const promo = findById(id);
    if (!promo) return;

    const act = btn?.getAttribute("data-act");

    if (act === "edit" || !act) {
      fillForm(promo);
      return;
    }

    if (act === "toggle") {
      setBusy(true);
      try {
        const s = await ensureSession();
        if (!s) return;

        const next = { ...promo, active: !promo.active };
        const saved = await updatePromo(promo.id, mapUiToDbPayload(next));

        toast("Actualizado", saved.active ? "Promo activada." : "Promo pausada.", 2200);

        await refreshList({ keepSelection: true });

        if (currentId && safeStr(currentId) === safeStr(saved.id)) {
          const fresh = findById(saved.id);
          if (fresh) fillForm(fresh);
        }
      } catch (err) {
        console.error(err);
        if (isRLSError(err)) toast("RLS", "Bloqueado. Falta policy UPDATE en promos.", 4200);
        else toast("Error", "No se pudo actualizar el estado.", 3600);
      } finally {
        setBusy(false);
      }
      return;
    }

    if (act === "delete") {
      const ok = confirm("¿Eliminar esta promo? Esta acción no se puede deshacer.");
      if (!ok) return;

      setBusy(true);
      try {
        const s = await ensureSession();
        if (!s) return;

        await deletePromo(id);
        toast("Eliminada", "La promo fue eliminada.", 2200);

        if (currentId && safeStr(currentId) === safeStr(id)) {
          currentId = null;
          currentRow = null;
          showEmpty();
        }

        await refreshList({ keepSelection: true });
      } catch (err) {
        console.error(err);
        if (isRLSError(err)) toast("RLS", "Bloqueado. Falta policy DELETE en promos.", 4200);
        else toast("Error", "No se pudo eliminar la promo.", 3600);
      } finally {
        setBusy(false);
      }
      return;
    }
  });

  // Enter/Space accesibilidad en items
  listEl.addEventListener("keydown", (e) => {
    const rowEl = e.target.closest(".item[data-id]");
    if (!rowEl) return;
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    const id = rowEl.getAttribute("data-id");
    const promo = findById(id);
    if (promo) fillForm(promo);
  });

  // ------------------------------------------------------------
  // Init
  // ------------------------------------------------------------
  (async function init() {
    setDescCount();
    renderPreview();

    await refreshList({ keepSelection: false });
    showEmpty();

    wireRealtime();
  })();
})();
