"use strict";

/**
 * admin-promos.js — ECN PRO, BD aligned
 * - promos.kind real: BANNER | MODAL
 * - espera admin:ready y carga lazy al abrir tab promos
 */
(function () {
  if (window.__ecnPromosMounted === true) return;
  window.__ecnPromosMounted = true;

  const VERSION = "2026-02-26.promos.bd-aligned.1";
  const TABLE = "promos";

  const $ = (sel, root = document) => root.querySelector(sel);
  const safe = (v) => String(v ?? "");
  const clean = (v) => safe(v).replace(/\s+/g, " ").trim();

  const S = { didBoot: false, didBind: false, didLoadOnce: false, loading: false, rows: [], editing: null };

  function getSB() { return window.APP && (APP.supabase || APP.sb) ? (APP.supabase || APP.sb) : null; }

  function escapeHtml(str) {
    return safe(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function toast(title, msg, ms = 3200) {
    try { if (window.APP && typeof APP.toast === "function") return APP.toast(title, msg, ms); } catch (_) {}
    try { if (typeof window.toast === "function") return window.toast(title, msg, ms); } catch (_) {}
    console.log("[promos]", title, msg);
  }

  function dom() {
    return {
      panel: $("#tab-promos"),
      tbody: $("#promosTbody"),
      note: $("#ecnNote"),
      refreshBtn: $("#refreshPromosBtn"),
      newBtn: $("#newPromoBtn"),
      modal: $("#ecnPromoModal"),
      closeBtn: $("#ecnPromoClose"),
      form: $("#ecnPromoForm"),
      id: $("#ecnPromoId"),
      title: $("#ecnTitle"),
      desc: $("#ecnDesc"),
      descCount: $("#ecnDescCount"),
      kind: $("#ecnKind"),
      priority: $("#ecnPriority"),
      active: $("#ecnActive"),
      badge: $("#ecnBadge"),
      mediaImg: $("#ecnMediaImg"),
      ctaLabel: $("#ecnCtaLabel"),
      ctaHref: $("#ecnCtaHref"),
      preview: $("#ecnPromoPreview"),
      resetBtn: $("#ecnPromoReset"),
    };
  }

  function setNote(msg) { const d = dom(); if (d.note) d.note.textContent = clean(msg || ""); }

  function parseIntSafe(v, def = 0) {
    const n = Number.parseInt(String(v ?? ""), 10);
    return Number.isFinite(n) ? n : def;
  }

  function setDescCount() {
    const d = dom();
    if (!d.desc || !d.descCount) return;
    d.descCount.textContent = `${safe(d.desc.value).length}/520`;
  }

  function renderPreviewFromForm() {
    const d = dom();
    if (!d.preview) return;
    const title = clean(d.title?.value || "Promoción");
    const desc = clean(d.desc?.value || "");
    const badge = clean(d.badge?.value || "");
    const img = clean(d.mediaImg?.value || "");
    const cta = clean(d.ctaLabel?.value || "");
    const kind = clean(d.kind?.value || "BANNER");

    d.preview.innerHTML = `
      <div style="border:1px solid rgba(255,255,255,.12); border-radius:16px; padding:14px; background:rgba(0,0,0,.18);">
        ${img ? `<img src="${escapeHtml(img)}" alt="" style="width:100%;max-height:180px;object-fit:cover;border-radius:12px;margin-bottom:10px;">` : ""}
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
          <span class="pill">${escapeHtml(kind)}</span>
          ${badge ? `<span class="pill">${escapeHtml(badge)}</span>` : ""}
        </div>
        <div style="font-weight:900; font-size:18px;">${escapeHtml(title)}</div>
        ${desc ? `<div style="opacity:.75; margin-top:6px;">${escapeHtml(desc)}</div>` : ""}
        ${cta ? `<div style="margin-top:10px;"><span class="btn sm">${escapeHtml(cta)}</span></div>` : ""}
      </div>
    `;
  }

  function openModal(row) {
    const d = dom();
    S.editing = row || null;
    if (!d.modal || !d.form) return;

    d.form.reset();
    if (d.id) d.id.value = row?.id || "";
    if (d.title) d.title.value = row?.title || "";
    if (d.desc) d.desc.value = row?.description || "";
    if (d.kind) d.kind.value = row?.kind || "BANNER";
    if (d.priority) d.priority.value = row?.priority ?? 0;
    if (d.active) d.active.value = row?.active === false ? "false" : "true";
    if (d.badge) d.badge.value = row?.badge || "";
    if (d.mediaImg) d.mediaImg.value = row?.media_img || "";
    if (d.ctaLabel) d.ctaLabel.value = row?.cta_label || "";
    if (d.ctaHref) d.ctaHref.value = row?.cta_href || "";
    setDescCount();
    renderPreviewFromForm();

    d.modal.hidden = false;
    d.modal.setAttribute("aria-hidden", "false");
  }

  function closeModal() {
    const d = dom();
    if (!d.modal) return;
    d.modal.hidden = true;
    d.modal.setAttribute("aria-hidden", "true");
    S.editing = null;
  }

  function render() {
    const d = dom();
    if (!d.tbody) return;

    if (!S.rows.length) {
      d.tbody.innerHTML = `<tr><td colspan="5" style="opacity:.75; padding:14px;">No hay promociones.</td></tr>`;
      return;
    }

    d.tbody.innerHTML = S.rows.map((r) => `
      <tr data-id="${escapeHtml(r.id)}">
        <td>
          <div style="font-weight:800;">${escapeHtml(r.title || "—")}</div>
          ${r.badge ? `<div style="opacity:.65;font-size:12px;">${escapeHtml(r.badge)}</div>` : ""}
        </td>
        <td>${escapeHtml(r.kind || "—")}</td>
        <td>${escapeHtml(r.priority ?? 0)}</td>
        <td>${r.active ? "Sí" : "No"}</td>
        <td class="right">
          <div class="tableActions">
            <button class="btn sm" type="button" data-edit="${escapeHtml(r.id)}">Editar</button>
            <button class="btn sm" type="button" data-delete="${escapeHtml(r.id)}">Eliminar</button>
          </div>
        </td>
      </tr>
    `).join("");

    d.tbody.querySelectorAll("[data-edit]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const row = S.rows.find((x) => x.id === btn.dataset.edit);
        if (row) openModal(row);
      });
    });

    d.tbody.querySelectorAll("[data-delete]").forEach((btn) => {
      btn.addEventListener("click", () => deleteRow(btn.dataset.delete));
    });
  }

  async function fetchRows() {
    const sb = getSB();
    if (!sb) throw new Error("APP.supabase no está listo.");
    const { data, error } = await sb
      .from(TABLE)
      .select("id,active,kind,target,priority,badge,title,description,note,cta_label,cta_href,media_img,dismiss_days,start_at,end_at,created_at,updated_at")
      .order("priority", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw error;
    S.rows = Array.isArray(data) ? data : [];
  }

  async function refresh() {
    if (S.loading) return;
    S.loading = true;
    setNote("Cargando promociones…");
    try {
      await fetchRows();
      render();
      setNote("");
      S.didLoadOnce = true;
    } catch (e) {
      console.warn(e);
      setNote("No se pudieron cargar las promociones.");
      toast("Promos", e.message || String(e), 5200);
    } finally {
      S.loading = false;
    }
  }

  function readPayload() {
    const d = dom();
    return {
      active: clean(d.active?.value || "true") === "true",
      kind: clean(d.kind?.value || "BANNER") || "BANNER",
      target: "home",
      priority: parseIntSafe(d.priority?.value, 0),
      badge: clean(d.badge?.value || "") || null,
      title: clean(d.title?.value || "") || "Promoción",
      description: clean(d.desc?.value || "") || null,
      cta_label: clean(d.ctaLabel?.value || "") || null,
      cta_href: clean(d.ctaHref?.value || "") || null,
      media_img: clean(d.mediaImg?.value || "") || null,
      dismiss_days: 7,
    };
  }

  async function save(e) {
    e.preventDefault();
    const d = dom();
    const sb = getSB();
    if (!sb) return toast("Supabase", "No está listo.");

    const id = clean(d.id?.value || "");
    const payload = readPayload();

    if (!["BANNER", "MODAL"].includes(payload.kind)) {
      toast("Promos", "El tipo debe ser BANNER o MODAL.");
      return;
    }

    try {
      if (id) {
        const { error } = await sb.from(TABLE).update(payload).eq("id", id);
        if (error) throw error;
        toast("Promos", "Promoción actualizada.");
      } else {
        const { error } = await sb.from(TABLE).insert(payload);
        if (error) throw error;
        toast("Promos", "Promoción creada.");
      }
      closeModal();
      await refresh();
    } catch (err) {
      console.warn(err);
      toast("Error", err.message || String(err), 5200);
    }
  }

  async function deleteRow(id) {
    const sb = getSB();
    if (!id || !sb) return;
    if (!confirm("¿Eliminar esta promoción?")) return;
    try {
      const { error } = await sb.from(TABLE).delete().eq("id", id);
      if (error) throw error;
      toast("Promos", "Promoción eliminada.");
      await refresh();
    } catch (err) {
      console.warn(err);
      toast("Error", err.message || String(err), 5200);
    }
  }

  function bindOnce() {
    if (S.didBind) return;
    S.didBind = true;
    const d = dom();
    if (!d.tbody) return;

    d.refreshBtn?.addEventListener("click", refresh);
    d.newBtn?.addEventListener("click", () => openModal(null));
    d.closeBtn?.addEventListener("click", closeModal);
    d.modal?.querySelector(".modalBackdrop")?.addEventListener("click", closeModal);
    d.form?.addEventListener("submit", save);
    d.resetBtn?.addEventListener("click", () => openModal(S.editing));

    [d.title, d.desc, d.kind, d.badge, d.mediaImg, d.ctaLabel].forEach((el) => {
      el?.addEventListener("input", () => { setDescCount(); renderPreviewFromForm(); });
      el?.addEventListener("change", () => { setDescCount(); renderPreviewFromForm(); });
    });
  }

  async function ensureLoaded(force) {
    bindOnce();
    const panel = dom().panel;
    if (!panel || panel.hidden) return;
    if (S.didLoadOnce && !force) return render();
    await refresh();
  }

  function boot() {
    if (S.didBoot) return;
    S.didBoot = true;
    console.log("[admin-promos] boot", { VERSION, TABLE });
    bindOnce();
    ensureLoaded(false);
  }

  function onTab(e) { if (e?.detail?.tab === "promos") ensureLoaded(true); }

  if (window.APP && APP.__adminReady) boot();
  else {
    window.addEventListener("admin:ready", boot, { once: true });
    document.addEventListener("admin:ready", boot, { once: true });
  }
  window.addEventListener("admin:tab", onTab);
  document.addEventListener("admin:tab", onTab);
})();
