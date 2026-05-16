"use strict";

/**
 * admin-gallery.js — ECN PRO, BD aligned
 * - gallery_items.type real: cocteles | maridajes
 * - espera admin:ready y carga lazy al abrir tab gallery
 * - IDs: ecnGalleryId (no usa ecnPromoId)
 */
(function () {
  if (window.__ecnGalleryMounted === true) return;
  window.__ecnGalleryMounted = true;

  const VERSION = "2026-02-26.gallery.bd-aligned.1";
  const TABLE = "gallery_items";
  const BUCKET = "gallery";
  const FALLBACK_BUCKET = "media";

  const $ = (sel, root = document) => root.querySelector(sel);
  const safe = (v) => String(v ?? "");
  const clean = (v) => safe(v).replace(/\s+/g, " ").trim();

  const S = { didBoot: false, didBind: false, didLoadOnce: false, loading: false, editing: null, rows: [] };

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
    console.log("[gallery]", title, msg);
  }

  function parseTags(raw) {
    return clean(raw)
      .split(",")
      .map((x) => clean(x))
      .filter(Boolean);
  }

  function tagsToText(tags) {
    return Array.isArray(tags) ? tags.join(", ") : "";
  }

  function slugify(s) {
    return clean(s)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "gallery-item";
  }

  function dom() {
    return {
      panel: $("#tab-gallery"),
      tbody: $("#galleryTbody"),
      refreshBtn: $("#refreshGalleryBtn"),
      newBtn: $("#newGalleryBtn"),
      modal: $("#ecnGalleryModal"),
      closeBtn: $("#ecnGalleryClose"),
      form: $("#ecnGalleryForm"),
      id: $("#ecnGalleryId"),
      file: $("#ecnGalFile"),
      type: $("#ecnGalType"),
      tags: $("#ecnGalTags"),
      name: $("#ecnGalName"),
      previewImg: $("#ecnGalPreviewImg"),
      resetBtn: $("#ecnGalReset"),
    };
  }

  function openModal(row) {
    const d = dom();
    S.editing = row || null;
    if (!d.modal || !d.form) return;

    d.form.reset();
    if (d.id) d.id.value = row?.id || "";
    if (d.name) d.name.value = row?.name || "";
    if (d.type) d.type.value = row?.type || "cocteles";
    if (d.tags) d.tags.value = tagsToText(row?.tags || []);
    if (d.previewImg) d.previewImg.src = row?.image_url || "";

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
      d.tbody.innerHTML = `<tr><td colspan="5" style="opacity:.75; padding:14px;">No hay items de galería.</td></tr>`;
      return;
    }

    d.tbody.innerHTML = S.rows.map((r) => {
      const tags = Array.isArray(r.tags) && r.tags.length ? r.tags.join(", ") : "—";
      const url = r.image_url || "";
      return `
        <tr data-id="${escapeHtml(r.id)}">
          <td>${url ? `<img src="${escapeHtml(url)}" alt="" style="width:72px;height:52px;object-fit:cover;border-radius:10px;">` : "—"}</td>
          <td>${escapeHtml(r.name || "—")}</td>
          <td>${escapeHtml(r.type || "—")}</td>
          <td>${escapeHtml(tags)}</td>
          <td class="right">
            <div class="tableActions">
              <button class="btn sm" type="button" data-edit="${escapeHtml(r.id)}">Editar</button>
              <button class="btn sm" type="button" data-delete="${escapeHtml(r.id)}">Eliminar</button>
            </div>
          </td>
        </tr>`;
    }).join("");

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
      .select("id,type,name,tags,image_path,image_url,target,sort_order,created_at,updated_at")
      .order("sort_order", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });
    if (error) throw error;
    S.rows = Array.isArray(data) ? data : [];
  }

  async function refresh() {
    if (S.loading) return;
    S.loading = true;
    try {
      await fetchRows();
      render();
      S.didLoadOnce = true;
    } catch (e) {
      console.warn(e);
      toast("Galería", e.message || String(e), 5200);
    } finally {
      S.loading = false;
    }
  }

  async function uploadFile(file, type) {
    const sb = getSB();
    const ext = (file.name.match(/\.([a-z0-9]+)$/i)?.[1] || "jpg").toLowerCase();
    const base = slugify(file.name.replace(/\.[^.]+$/, ""));
    const path = `${type}/${base}-${Date.now()}.${ext}`;

    let bucket = BUCKET;
    let res = await sb.storage.from(bucket).upload(path, file, { cacheControl: "3600", upsert: false });
    if (res.error) {
      bucket = FALLBACK_BUCKET;
      res = await sb.storage.from(bucket).upload(`gallery-img/${path}`, file, { cacheControl: "3600", upsert: false });
      if (res.error) throw res.error;
      const publicUrl = sb.storage.from(bucket).getPublicUrl(`gallery-img/${path}`)?.data?.publicUrl || "";
      return { image_path: `gallery-img/${path}`, image_url: publicUrl };
    }

    const publicUrl = sb.storage.from(bucket).getPublicUrl(path)?.data?.publicUrl || "";
    return { image_path: path, image_url: publicUrl };
  }

  async function save(e) {
    e.preventDefault();
    const d = dom();
    const sb = getSB();
    if (!sb) return toast("Supabase", "No está listo.");

    const id = clean(d.id?.value || "");
    const type = clean(d.type?.value || "cocteles") || "cocteles";
    const tags = parseTags(d.tags?.value || "");
    const file = d.file?.files?.[0] || null;
    const current = id ? S.rows.find((x) => x.id === id) : null;

    let media = current ? { image_path: current.image_path, image_url: current.image_url } : { image_path: "", image_url: "" };
    if (file) media = await uploadFile(file, type);

    if (!media.image_path) {
      toast("Galería", "Seleccioná una imagen para crear el item.");
      return;
    }

    const fallbackName = file ? file.name.replace(/\.[^.]+$/, "") : current?.name || "Galería";
    const payload = {
      type,
      name: clean(d.name?.value || fallbackName) || fallbackName,
      tags,
      image_path: media.image_path,
      image_url: media.image_url || null,
      target: "home",
    };

    try {
      if (id) {
        const { error } = await sb.from(TABLE).update(payload).eq("id", id);
        if (error) throw error;
        toast("Galería", "Item actualizado.");
      } else {
        const { error } = await sb.from(TABLE).insert(payload);
        if (error) throw error;
        toast("Galería", "Item creado.");
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
    if (!confirm("¿Eliminar este item de galería?")) return;
    try {
      const { error } = await sb.from(TABLE).delete().eq("id", id);
      if (error) throw error;
      toast("Galería", "Item eliminado.");
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
    d.file?.addEventListener("change", () => {
      const f = d.file.files?.[0];
      if (!f || !d.previewImg) return;
      d.previewImg.src = URL.createObjectURL(f);
      if (d.name && !d.name.value) d.name.value = f.name.replace(/\.[^.]+$/, "");
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
    console.log("[admin-gallery] boot", { VERSION, TABLE });
    bindOnce();
    ensureLoaded(false);
  }

  function onTab(e) {
    if (e?.detail?.tab === "gallery") ensureLoaded(true);
  }

  if (window.APP && APP.__adminReady) boot();
  else {
    window.addEventListener("admin:ready", boot, { once: true });
    document.addEventListener("admin:ready", boot, { once: true });
  }
  window.addEventListener("admin:tab", onTab);
  document.addEventListener("admin:tab", onTab);
})();
