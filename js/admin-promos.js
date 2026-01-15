/* ============================================================
   admin-promos.js ✅ PRO (Local-first)
   - Lista + Editor (banner / modal)
   - Usa ECN Promos API desde data.js:
     ECN.getPromosRaw(), ECN.upsertPromo(), ECN.deletePromo()
   ============================================================ */
(function () {
  "use strict";

  // ------------------------------------------------------------
  // Guards
  // ------------------------------------------------------------
  if (!window.ECN) return;

  const $ = (sel) => document.querySelector(sel);

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

  // State
  let currentId = null;

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
  }

  function setDescCount() {
    if (!pDescCount || !pDesc) return;
    pDescCount.textContent = String((pDesc.value || "").length);
  }

  function readPromos() {
    const arr = ECN.getPromosRaw ? ECN.getPromosRaw() : [];
    return Array.isArray(arr) ? arr : [];
  }

  function sortPromos(promos) {
    return promos.slice().sort((a, b) => (Number(b.priority) || 0) - (Number(a.priority) || 0));
  }

  function renderList() {
    const promos = sortPromos(readPromos());

    if (!promos.length) {
      listEl.innerHTML = `<div class="galleryListEmpty">No hay promos todavía.</div>`;
      return;
    }

    listEl.innerHTML = promos
      .map((p) => {
        const isActive = !!p.active;
        const kind = safeStr(p.kind || "BANNER").toUpperCase();
        const target = safeStr(p.target || "home").toUpperCase();

        return `
          <div class="item" data-id="${esc(p.id)}" role="button" tabindex="0" aria-label="Promo ${esc(p.title)}">
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
    const promos = readPromos();
    return promos.find((x) => safeStr(x?.id) === safeStr(id)) || null;
  }

  function renderPreview() {
    if (!promoPreview) return;

    const kind = toKind(pType.value);
    const title = safeStr(pTitle.value || "Promo");
    const desc = safeStr(pDesc.value || "");
    const badge = safeStr(pBadge.value || "");
    const cta = safeStr(pCtaLabel.value || "Conocer");
    const href = safeStr(pCtaHref.value || "#");
    const media = safeStr(pMediaImg.value || "");
    const note = safeStr(pNote.value || "");

    // Preview simple (no depende de CSS extra)
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
          <span class="pill">${esc(pActive.value === "true" ? "ACTIVA" : "INACTIVA")}</span>
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
        </div>
      </div>
    `;
  }

  function collectPayload() {
    return {
      id: currentId || "", // si está vacío, data.js genera desde title
      active: pActive.value === "true",
      kind: toKind(pType.value),
      target: "home",
      priority: Number(pPriority.value) || 0,

      badge: safeStr(pBadge.value || ""),
      title: safeStr(pTitle.value || "Promo"),
      desc: safeStr(pDesc.value || ""),
      note: safeStr(pNote.value || ""),

      ctaLabel: safeStr(pCtaLabel.value || "Conocer"),
      ctaHref: safeStr(pCtaHref.value || "#"),
      mediaImg: safeStr(pMediaImg.value || ""),

      dismissDays: Math.max(1, Number(pDismissDays.value) || 7),
      // startAt/endAt quedan para después si querés
      startAt: "",
      endAt: "",
    };
  }

  // ------------------------------------------------------------
  // Events
  // ------------------------------------------------------------
  // Tip: cuando el usuario escribe, actualizamos preview
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

  // Submit = Guardar
  formEl.addEventListener("submit", (e) => {
    e.preventDefault();

    const payload = collectPayload();
    const saved = ECN.upsertPromo(payload);

    // Re-render + re-open editor con id final (por si se generó)
    renderList();
    fillForm(saved);

    // Nota: home lee promos automáticamente desde localStorage
    if (window.APP && typeof APP.toast === "function") {
      APP.toast("Guardado", "Promo guardada correctamente.");
    }
  });

  // Nueva
  newBtn?.addEventListener("click", () => {
    blankForm();
  });

  // Eliminar desde editor
  delBtn?.addEventListener("click", () => {
    if (!currentId) return;
    const ok = confirm("¿Eliminar esta promo?");
    if (!ok) return;

    ECN.deletePromo(currentId);
    renderList();
    showEmpty();
  });

  // Clicks en lista (delegación)
  listEl.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-act]");
    const row = e.target.closest(".item[data-id]");
    if (!row) return;

    const id = row.getAttribute("data-id");
    const promo = findById(id);
    if (!promo) return;

    const act = btn?.getAttribute("data-act");

    if (act === "edit" || !act) {
      fillForm(promo);
      return;
    }

    if (act === "toggle") {
      promo.active = !promo.active;
      const saved = ECN.upsertPromo(promo);
      renderList();
      // si estás editando esa misma promo, refresca el form
      if (currentId && safeStr(currentId) === safeStr(saved.id)) fillForm(saved);
      return;
    }

    if (act === "delete") {
      const ok = confirm("¿Eliminar esta promo?");
      if (!ok) return;
      ECN.deletePromo(id);
      renderList();
      if (currentId && safeStr(currentId) === safeStr(id)) showEmpty();
      return;
    }
  });

  // Enter/Space para accesibilidad en items
  listEl.addEventListener("keydown", (e) => {
    const row = e.target.closest(".item[data-id]");
    if (!row) return;
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    const id = row.getAttribute("data-id");
    const promo = findById(id);
    if (promo) fillForm(promo);
  });

  // ------------------------------------------------------------
  // Init
  // ------------------------------------------------------------
  renderList();
  showEmpty();
})();
