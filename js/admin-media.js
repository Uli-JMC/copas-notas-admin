"use strict";

/**
 * admin-media.js — Entre Copas & Notas ✅ PRO (schema-safe + on-demand)
 *
 * BD (public):
 *  - media_assets: id(uuid), folder(text NOT NULL), name(text NOT NULL), path(text NOT NULL),
 *                 public_url(text), mime(text), bytes(bigint), created_at, updated_at
 *  - media_bindings: scope, scope_id, slot, media_id, note ... con UNIQUE(scope, scope_id, slot)
 *  - v_media_bindings_latest: VIEW (latest por slot)
 *  - events: selector de eventos
 *  - menu_items: selector de menú (si existe)
 *
 * Storage:
 *  - bucket "media" (imágenes)
 *  - bucket "video" (videos)
 *
 * IDs esperados (admin.html tab Medios):
 *  #mediaForm #mediaFile #mediaBucket #mediaFolder #mediaName #mediaTags (tags solo UI)
 *  #mediaUrl #mediaCopyBtn #mediaResetBtn #deleteMediaBtn
 *  #mediaPreviewEmpty #mediaPreview #mediaPreviewImg #mediaPreviewMeta
 *  #mediaRefreshBtn #mediaList #mediaNote
 *  Asignación:
 *   #mediaScopeType #mediaEventSelect #mediaMenuSelect #mediaSlotSelect
 *   #mediaAssignBtn #mediaViewAssignedBtn #mediaAssignedList
 *
 * FIXES (2026-02-22):
 *  - Espera admin:ready para asegurar APP.supabase listo
 *  - On-demand: carga solo al entrar al tab media
 *  - Escucha admin:tab en window + document (compat con cualquier emisor)
 *  - Anti doble carga + throttle
 *  - Delete Storage: intenta en ambos buckets (media/video) (no dependemos del select actual)
 */

(function () {
  // ---------------------------
  // Guard anti doble eval
  // ---------------------------
  if (window.__ecnMediaMounted === true) return;
  window.__ecnMediaMounted = true;

  const VERSION = "2026-05-16.media.ux-phase2.workflow.1.0";
  const $ = (sel, root = document) => root.querySelector(sel);

  if (!document.getElementById("appPanel")) return;

  // ---------------------------
  // Supabase + session
  // ---------------------------
  function getSB() {
    return window.APP && (APP.supabase || APP.sb) ? (APP.supabase || APP.sb) : null;
  }

  async function ensureSession(sb) {
    try {
      const res = await sb.auth.getSession();
      const s = res?.data?.session || null;
      if (!s) {
        toast("Sesión", "Tu sesión expiró. Volvé a iniciar sesión.", 4200);
        return null;
      }
      return s;
    } catch (_) {
      toast("Error", "No se pudo validar sesión con Supabase.", 3600);
      return null;
    }
  }

  // ---------------------------
  // Toast (unificado)
  // ---------------------------
  function toast(title, msg, ms = 3200) {
    try {
      if (window.APP && typeof APP.toast === "function") return APP.toast(title, msg, ms);
    } catch (_) {}
    try {
      if (typeof window.toast === "function") return window.toast(title, msg, ms);
    } catch (_) {}
    // fallback sin romper UX:
    try { console.log("[MEDIA]", title, msg); } catch (_) {}
    try { alert(`${title} — ${msg}`); } catch (_) {}
  }

  // ---------------------------
  // Utils
  // ---------------------------
  function escapeHtml(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  const clean = (s) => String(s ?? "").trim();
  const cleanSpaces = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
  const normFolder = (s) =>
    cleanSpaces(s)
      .toLowerCase()
      .replace(/[^a-z0-9/_-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^\/+|\/+$/g, "");

  function isHttpUrl(x) {
    return /^https?:\/\//i.test(String(x || ""));
  }

  function looksLikeMissingRelation(err) {
    const m = clean(err?.message || "").toLowerCase();
    return (m.includes("relation") && m.includes("does not exist")) || m.includes("does not exist");
  }

  // ---------------------------
  // DB config (schema-safe)
  // ---------------------------
  const ASSETS_TABLE = "media_assets";
  const BINDINGS_TABLE = "media_bindings";
  const VIEW_LATEST = "v_media_bindings_latest";
  const EVENTS_TABLE = "events";
  const MENU_TABLE = "menu_items";

  const BUCKETS = ["media", "video"];

  const ACCEPTS = {
    media: "image/*,.jpg,.jpeg,.png,.webp,.avif",
    video: "video/mp4,video/webm,.mp4,.webm",
  };

  // Slots
  const EVENT_SLOTS = [
    { value: "slide_img", label: "Home Slider · Imagen (slide_img)", help: "Imagen principal del slider público." },
    { value: "slide_video", label: "Home Slider · Video (slide_video)", help: "Video del slider público." },
    { value: "desktop_event", label: "Evento · Desktop (desktop_event)", help: "Banner grande para escritorio en la página del evento." },
    { value: "mobile_event", label: "Evento · Mobile (mobile_event)", help: "Banner vertical/adaptado para celular." },
    { value: "event_more", label: "Evento · Ver más (event_more)", help: "Imagen secundaria para la sección Ver más." },
  ];

  const MENU_SLOTS = [
    { value: "icon", label: "Menú · Icono (icon)", help: "Icono pequeño del ítem de menú." },
    { value: "image", label: "Menú · Imagen (image)", help: "Imagen principal del ítem de menú." },
  ];

  const SLOT_LABELS = Object.fromEntries([...EVENT_SLOTS, ...MENU_SLOTS].map((s) => [s.value, s.label]));
  const SLOT_HELP = Object.fromEntries([...EVENT_SLOTS, ...MENU_SLOTS].map((s) => [s.value, s.help || s.label]));

  function emitMediaChanged(detail) {
    const data = Object.assign({ source: "admin-media", version: VERSION }, detail || {});
    try { window.dispatchEvent(new CustomEvent("admin:media:changed", { detail: data })); } catch (_) {}
    try { document.dispatchEvent(new CustomEvent("admin:media:changed", { detail: data })); } catch (_) {}
  }

  function hydrateFormFromAsset(dom, asset) {
    if (!asset) return;
    const folder = clean(asset.folder || "");
    const name = clean(asset.name || "");
    const url = clean(asset.public_url || asset.path || "");
    const bucket = guessBucketFromAsset(asset);

    if (dom.mediaId) dom.mediaId.value = clean(asset.id || "");
    if (dom.folderEl && folder) dom.folderEl.value = folder;
    if (dom.nameEl && name) dom.nameEl.value = name;
    if (dom.urlEl) dom.urlEl.value = url;
    if (dom.bucketEl && bucket && dom.bucketEl.value !== bucket) {
      dom.bucketEl.value = bucket;
      applyAccept(dom);
    }
  }

  // ---------------------------
  // DOM (solo se usa cuando el tab media existe)
  // ---------------------------
  function getDom() {
    const form = $("#mediaForm");
    const mediaId = $("#mediaId");
    const fileEl = $("#mediaFile");
    const bucketEl = $("#mediaBucket");
    const folderEl = $("#mediaFolder");
    const nameEl = $("#mediaName");
    const tagsEl = $("#mediaTags"); // UI only

    const urlEl = $("#mediaUrl");
    const btnCopy = $("#mediaCopyBtn");
    const btnReset = $("#mediaResetBtn");
    const btnDelete = $("#deleteMediaBtn");
    const noteEl = $("#mediaNote");

    const previewEmpty = $("#mediaPreviewEmpty");
    const previewWrap = $("#mediaPreview");
    const previewImg = $("#mediaPreviewImg");
    const previewMeta = $("#mediaPreviewMeta");

    const btnRefresh = $("#mediaRefreshBtn");
    const listEl = $("#mediaList");

    const scopeTypeEl = $("#mediaScopeType");
    const scopeEventWrap = $("#mediaScopeEventWrap");
    const scopeMenuWrap = $("#mediaScopeMenuWrap");
    const eventSel = $("#mediaEventSelect");
    const menuSel = $("#mediaMenuSelect");
    const slotSel = $("#mediaSlotSelect");
    const btnAssign = $("#mediaAssignBtn");
    const btnViewAssigned = $("#mediaViewAssignedBtn");
    const assignedList = $("#mediaAssignedList");

    return {
      form,
      mediaId,
      fileEl,
      bucketEl,
      folderEl,
      nameEl,
      tagsEl,
      urlEl,
      btnCopy,
      btnReset,
      btnDelete,
      noteEl,
      previewEmpty,
      previewWrap,
      previewImg,
      previewMeta,
      btnRefresh,
      listEl,
      scopeTypeEl,
      scopeEventWrap,
      scopeMenuWrap,
      eventSel,
      menuSel,
      slotSel,
      btnAssign,
      btnViewAssigned,
      assignedList,
    };
  }

  // ---------------------------
  // State
  // ---------------------------
  const S = {
    didBoot: false,
    didBind: false,
    didLoadOnce: false,
    loading: false,
    lastLoadAt: 0,
    assets: [],
    folders: [],
    selected: null,
    assetFilter: "",
  };


  // ---------------------------
  // UX Fase 2: flujo Subir / Biblioteca / Asignar
  // ---------------------------
  function setMediaMode(mode) {
    const safeMode = ["upload", "library", "assign"].includes(mode) ? mode : "library";
    const panel = document.getElementById("tab-media");
    if (panel) panel.dataset.mediaMode = safeMode;

    document.querySelectorAll("[data-media-mode]").forEach((btn) => {
      const on = btn.dataset.mediaMode === safeMode;
      btn.classList.toggle("isActive", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
  }

  function bindMediaModeButtons() {
    document.querySelectorAll("[data-media-mode]").forEach((btn) => {
      if (btn.dataset.ecnModeWired === "1") return;
      btn.dataset.ecnModeWired = "1";
      btn.addEventListener("click", () => setMediaMode(btn.dataset.mediaMode || "library"));
    });
  }

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

  // ---------------------------
  // UI helpers
  // ---------------------------
  function setNote(noteEl, msg) {
    if (!noteEl) return;
    noteEl.textContent = clean(msg || "");
  }

  function setPreview(dom, asset) {
    const { previewEmpty, previewWrap, previewImg, previewMeta } = dom;

    if (!previewEmpty || !previewWrap) return;

    if (!asset) {
      previewEmpty.hidden = false;
      previewWrap.hidden = true;
      if (previewImg) previewImg.src = "";
      if (previewMeta) previewMeta.textContent = "";
      return;
    }

    previewEmpty.hidden = true;
    previewWrap.hidden = false;

    const url = clean(asset.public_url || "");
    if (previewImg) previewImg.src = url;

    if (previewMeta) {
      previewMeta.textContent = [
        `ID: ${asset.id || "—"}`,
        `Folder: ${asset.folder || "—"}`,
        `Name: ${asset.name || "—"}`,
        `URL: ${url || "—"}`,
      ].join(" · ");
    }
  }

  function getBucket(dom) {
    const b = clean(dom.bucketEl?.value || "media") || "media";
    return BUCKETS.includes(b) ? b : "media";
  }

  function applyAccept(dom) {
    const b = getBucket(dom);
    if (dom.fileEl) dom.fileEl.setAttribute("accept", ACCEPTS[b] || "image/*,video/*");

    const f = clean(dom.folderEl?.value || "");
    if (!f && dom.folderEl) dom.folderEl.value = b === "video" ? "events-video" : "events-img";
  }

  function guessBucketFromAsset(asset) {
    const mime = clean(asset?.mime || "").toLowerCase();
    const url = clean(asset?.public_url || "").toLowerCase();
    const path = clean(asset?.path || "").toLowerCase();

    if (mime.startsWith("video/") || url.includes("/object/public/video/") || /\.(mp4|webm|mov)(\?|$)/i.test(path)) return "video";
    return "media";
  }

  function getFolderValue(dom) {
    const raw = clean(dom.folderEl?.value || "");
    // vacío = todos los folders del bucket actual
    if (!raw || raw === "__all__") return "";
    return raw;
  }

  function buildFolderTools(dom) {
    if (!dom.folderEl || dom.folderEl.dataset.ecnFolderTools === "1") return;
    dom.folderEl.dataset.ecnFolderTools = "1";

    const datalist = document.createElement("datalist");
    datalist.id = "mediaFolderDatalist";
    document.body.appendChild(datalist);
    dom.folderEl.setAttribute("list", datalist.id);

    const tools = document.createElement("div");
    tools.className = "mediaFolderTools";
    tools.innerHTML = `
      <select class="input mediaFolderSelect" id="mediaFolderSelect" aria-label="Folders existentes">
        <option value="">Todos los folders del bucket</option>
      </select>
      <button class="btn btn--ghost sm mediaFolderRefresh" id="mediaFolderRefreshBtn" type="button">Actualizar folders</button>
    `;

    dom.folderEl.insertAdjacentElement("afterend", tools);

    const hint = document.createElement("div");
    hint.className = "mini mediaFolderHint";
    hint.textContent = "Podés elegir un folder existente, escribir uno nuevo y al subir se guardará para futuras selecciones.";
    tools.insertAdjacentElement("afterend", hint);

    const listWrap = dom.listEl?.closest(".card") || dom.listEl?.parentElement;
    if (listWrap && !document.getElementById("mediaAssetSearch")) {
      const searchWrap = document.createElement("div");
      searchWrap.className = "mediaAssetTools";
      searchWrap.innerHTML = `
        <input class="input mediaAssetSearch" id="mediaAssetSearch" type="search" placeholder="Buscar en medios subidos: nombre, folder o URL..." />
        <button class="btn btn--ghost sm" id="mediaShowAllAssetsBtn" type="button">Ver todos</button>
      `;
      dom.listEl.insertAdjacentElement("beforebegin", searchWrap);

      const search = searchWrap.querySelector("#mediaAssetSearch");
      search?.addEventListener("input", () => {
        S.assetFilter = clean(search.value || "").toLowerCase();
        renderList(dom);
      });

      searchWrap.querySelector("#mediaShowAllAssetsBtn")?.addEventListener("click", async () => {
        dom.folderEl.value = "";
        const select = document.getElementById("mediaFolderSelect");
        if (select) select.value = "";
        await refreshList(dom, { silent: false });
        setMediaMode("library");
      });
    }

    tools.querySelector("#mediaFolderSelect")?.addEventListener("change", async (e) => {
      dom.folderEl.value = clean(e.target.value || "");
      await refreshList(dom, { silent: true });
    });

    tools.querySelector("#mediaFolderRefreshBtn")?.addEventListener("click", async () => {
      await refreshFolders(dom);
      await refreshList(dom, { silent: false });
    });
  }

  function renderFolderOptions(dom) {
    const select = document.getElementById("mediaFolderSelect");
    const datalist = document.getElementById("mediaFolderDatalist");
    if (!select && !datalist) return;

    const current = clean(dom.folderEl?.value || "");
    const options = (S.folders || []).map((folder) => `<option value="${escapeHtml(folder)}">${escapeHtml(folder)}</option>`).join("");

    if (select) {
      select.innerHTML = `<option value="">Todos los folders del bucket</option>${options}`;
      select.value = S.folders.includes(current) ? current : "";
    }

    if (datalist) datalist.innerHTML = options;
  }

  // ---------------------------
  // DB helpers
  // ---------------------------
  async function fetchAssetsLatest(sb, { folder, limit = 120 }) {
    let q = sb
      .from(ASSETS_TABLE)
      .select("id, folder, name, path, public_url, mime, bytes, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);

    const f = clean(folder);
    if (f) q = q.eq("folder", f);

    const { data, error } = await q;
    if (error) throw error;
    return Array.isArray(data) ? data : [];
  }

  async function fetchAssetFolders(sb, bucket) {
    const { data, error } = await sb
      .from(ASSETS_TABLE)
      .select("folder, path, public_url, mime, created_at")
      .order("created_at", { ascending: false })
      .limit(1000);

    if (error) throw error;

    const targetBucket = clean(bucket || "media");
    const set = new Set();
    (Array.isArray(data) ? data : []).forEach((asset) => {
      if (guessBucketFromAsset(asset) !== targetBucket) return;
      const f = clean(asset.folder || "");
      if (f) set.add(f);
    });

    return Array.from(set).sort((a, b) => a.localeCompare(b, "es"));
  }

  async function insertAsset(sb, payload) {
    const safePayload = {
      folder: payload.folder,
      name: payload.name,
      path: payload.path,
      public_url: payload.public_url ?? null,
      mime: payload.mime ?? null,
      bytes: payload.bytes ?? null,
    };

    const { data, error } = await sb.from(ASSETS_TABLE).insert(safePayload).select("*").single();
    if (error) throw error;
    return data;
  }

  async function deleteAssetRow(sb, assetId) {
    const { data, error } = await sb
      .from(ASSETS_TABLE)
      .delete()
      .eq("id", assetId)
      .select("id, path, folder, public_url")
      .single();
    if (error) throw error;
    return data;
  }


  async function updateAssetRow(sb, assetId, payload) {
    const safePayload = {
      folder: payload.folder,
      name: payload.name,
      path: payload.path,
      public_url: payload.public_url ?? null,
      mime: payload.mime ?? null,
      bytes: payload.bytes ?? null,
    };
    const { data, error } = await sb
      .from(ASSETS_TABLE)
      .update(safePayload)
      .eq("id", assetId)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  }

  async function upsertBinding(sb, { scope, scope_id, slot, media_id, note = null }) {
    const payload = { scope, scope_id, slot, media_id, note };
    const { error } = await sb.from(BINDINGS_TABLE).upsert(payload, { onConflict: "scope,scope_id,slot" });
    if (error) throw error;
  }

  async function fetchBindingsLatest(sb, { scope, scope_id }) {
    const { data, error } = await sb
      .from(VIEW_LATEST)
      .select("slot, binding_id, public_url, path, media_id, folder, name, mime, bytes, binding_updated_at, media_updated_at")
      .eq("scope", scope)
      .eq("scope_id", String(scope_id))
      .order("slot", { ascending: true });

    if (error) throw error;
    return Array.isArray(data) ? data : [];
  }

  async function deleteBinding(sb, { scope, scope_id, slot }) {
    const { error } = await sb
      .from(BINDINGS_TABLE)
      .delete()
      .eq("scope", scope)
      .eq("scope_id", String(scope_id))
      .eq("slot", slot);
    if (error) throw error;
  }

  async function fetchEvents(sb) {
    const { data, error } = await sb
      .from(EVENTS_TABLE)
      .select("id, title, month_key, type, created_at")
      .order("created_at", { ascending: false })
      .limit(250);
    if (error) throw error;
    return Array.isArray(data) ? data : [];
  }

  async function fetchMenuItems(sb) {
    const { data, error } = await sb
      .from(MENU_TABLE)
      .select("id, label, href, menu_key, sort_order, active")
      .order("menu_key", { ascending: true })
      .order("sort_order", { ascending: true })
      .limit(500);
    if (error) throw error;
    return Array.isArray(data) ? data : [];
  }

  // ---------------------------
  // Storage helpers
  // ---------------------------
  function extFromFile(file) {
    const m = String(file?.name || "").match(/\.([a-z0-9]{1,10})$/i);
    return (m?.[1] || "").toLowerCase();
  }

  function safeNameBase(nameBase, filename) {
    const base = clean(nameBase) || String(filename || "").replace(/\.[^.]+$/, "");
    return normFolder(base) || "asset";
  }

  async function uploadToStorage(sb, file, bucket, folder, nameBase) {
    const ext = extFromFile(file) || (bucket === "video" ? "mp4" : "jpg");
    const safeName = safeNameBase(nameBase, file.name);
    const path = `${normFolder(folder || "misc")}/${safeName}-${Date.now()}.${ext}`;

    const { error } = await sb.storage.from(bucket).upload(path, file, { cacheControl: "3600", upsert: false });
    if (error) throw error;

    const pub = sb.storage.from(bucket).getPublicUrl(path)?.data?.publicUrl || "";
    return { bucket, path, public_url: pub };
  }


  async function replaceAssetFile(dom, asset, file) {
    const sb = getSB();
    if (!sb) throw new Error("APP.supabase no está listo.");
    const session = await ensureSession(sb);
    if (!session) return null;
    if (!asset?.id) throw new Error("Seleccioná un medio primero.");
    if (!file) throw new Error("Seleccioná el archivo de reemplazo.");

    const oldPath = clean(asset.path || "");
    const bucket = guessBucketFromAsset(asset) || getBucket(dom);
    const folder = normFolder(asset.folder || getFolderValue(dom) || (bucket === "video" ? "events-video" : "events-img"));
    const name = clean(asset.name || dom.nameEl?.value || file.name.replace(/\.[^.]+$/, "")) || "asset";

    const up = await uploadToStorage(sb, file, bucket, folder, name);
    const updated = await updateAssetRow(sb, asset.id, {
      folder,
      name,
      path: up.path,
      public_url: up.public_url || null,
      mime: clean(file.type || "") || null,
      bytes: file.size || null,
    });

    // Después de actualizar la fila, intentamos eliminar el archivo anterior del bucket.
    if (oldPath && oldPath !== up.path && !isHttpUrl(oldPath)) {
      await removeFromStorageAnyBucket(sb, oldPath).catch(() => {});
    }

    S.selected = updated;
    if (dom.urlEl) dom.urlEl.value = clean(updated.public_url || "");
    setPreview(dom, updated);
    await refreshFolders(dom);
    await refreshList(dom, { silent: true });
    emitMediaChanged({ action: "asset-updated", mediaId: updated?.id || asset.id });
    return updated;
  }

  // ✅ delete storage sin depender del bucket actual: intenta ambos buckets
  async function removeFromStorageAnyBucket(sb, path) {
    const p = clean(path);
    if (!p || isHttpUrl(p)) return;

    for (const bucket of BUCKETS) {
      try {
        const { error } = await sb.storage.from(bucket).remove([p]);
        if (!error) return true;
      } catch (_) {}
    }
    return false;
  }

  async function refreshFolders(dom) {
    const sb = getSB();
    if (!sb) return;
    try {
      S.folders = await fetchAssetFolders(sb, getBucket(dom));
      renderFolderOptions(dom);
    } catch (e) {
      console.warn(e);
      // No bloquea medios: si falla, el input manual sigue funcionando.
    }
  }


  function ensureMediaUpdateModal(dom) {
    let modal = document.getElementById("mediaUpdateModal");
    if (modal) return modal;

    modal = document.createElement("div");
    modal.className = "modal mediaUpdateModal";
    modal.id = "mediaUpdateModal";
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-label", "Actualizar medio");
    modal.innerHTML = `
      <div class="modalBackdrop" data-close="mediaUpdate"></div>
      <div class="modalCard modalCard--small mediaUpdateCard">
        <div class="modalHead">
          <div>
            <div class="kicker">ACTUALIZAR MEDIO</div>
            <div class="h3">Reemplazar archivo</div>
            <div class="mini">Mantiene el mismo registro y sus asignaciones. Solo cambia el archivo en Storage.</div>
          </div>
          <button class="btn btn--ghost" id="mediaUpdateClose" type="button" aria-label="Cerrar">✕</button>
        </div>
        <form class="form" id="mediaUpdateForm" novalidate>
          <div class="mediaUpdateCurrent" id="mediaUpdateCurrent"></div>
          <div class="field">
            <label class="label" for="mediaUpdateFile">Nuevo archivo</label>
            <input class="input" id="mediaUpdateFile" type="file" />
            <div class="mini">Se sube al mismo bucket/folder del medio seleccionado.</div>
          </div>
          <div class="formActions formActions--right">
            <button class="btn btn--ghost" id="mediaUpdateCancel" type="button">Cancelar</button>
            <button class="btn btn--primary" type="submit">Actualizar imagen</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(modal);

    const close = () => {
      modal.hidden = true;
      modal.setAttribute("aria-hidden", "true");
      const input = modal.querySelector("#mediaUpdateFile");
      if (input) input.value = "";
    };
    modal.querySelector("#mediaUpdateClose")?.addEventListener("click", close);
    modal.querySelector("#mediaUpdateCancel")?.addEventListener("click", close);
    modal.querySelector("[data-close='mediaUpdate']")?.addEventListener("click", close);

    modal.querySelector("#mediaUpdateForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = modal.querySelector("#mediaUpdateFile");
      const file = input?.files && input.files[0];
      if (!file) return toast("Archivo", "Seleccioná el nuevo archivo.", 2400);
      const asset = S.selected;
      if (!asset?.id) return toast("Medio", "Seleccioná un medio primero.", 2400);
      try {
        toast("Actualizando", "Subiendo reemplazo…", 1200);
        const updated = await replaceAssetFile(dom, asset, file);
        if (updated) {
          close();
          toast("Medio actualizado", "El archivo fue reemplazado y conserva sus asignaciones.", 2600);
          await viewAssigned(dom).catch(() => {});
        }
      } catch (err) {
        console.warn(err);
        toast("Error", err.message || String(err), 5200);
      }
    });

    return modal;
  }

  function openMediaUpdateModal(dom, asset) {
    if (!asset?.id) return toast("Actualizar", "Seleccioná un medio primero.", 2400);
    S.selected = asset;
    hydrateFormFromAsset(dom, asset);
    setPreview(dom, asset);

    const modal = ensureMediaUpdateModal(dom);
    const current = modal.querySelector("#mediaUpdateCurrent");
    const file = modal.querySelector("#mediaUpdateFile");
    if (file) file.setAttribute("accept", ACCEPTS[guessBucketFromAsset(asset)] || "image/*,video/*");
    if (current) {
      const u = clean(asset.public_url || asset.path || "");
      current.innerHTML = `
        <div class="mediaUpdatePreview">
          ${u && !/\.(mp4|webm|mov)(\?|$)/i.test(u) ? `<img src="${escapeHtml(u)}" alt="">` : `<span>Archivo seleccionado</span>`}
        </div>
        <div>
          <strong>${escapeHtml(clean(asset.name || "Medio"))}</strong>
          <p>${escapeHtml(clean(asset.folder || "—"))}</p>
          <small>${escapeHtml(u || "Sin URL")}</small>
        </div>
      `;
    }
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    setTimeout(() => file?.focus(), 0);
  }

  // ---------------------------
  // Render list
  // ---------------------------
  function renderList(dom) {
    const { listEl, urlEl } = dom;
    if (!listEl) return;

    listEl.innerHTML = "";

    const assets = (S.assets || []).filter((a) => {
      const q = clean(S.assetFilter || "").toLowerCase();
      if (!q) return true;
      const hay = `${a.name || ""} ${a.folder || ""} ${a.path || ""} ${a.public_url || ""} ${a.mime || ""}`.toLowerCase();
      return hay.includes(q);
    });

    if (!assets.length) {
      const div = document.createElement("div");
      div.className = "empty";
      div.textContent = getFolderValue(dom)
        ? "No hay medios en este folder. Cambiá el folder, elegí Ver todos o subí uno nuevo."
        : "No hay medios para mostrar en este bucket.";
      listEl.appendChild(div);
      return;
    }

    const frag = document.createDocumentFragment();
    assets.forEach((a) => {
      const item = document.createElement("article");
      item.className = "mediaAssetItem";
      item.tabIndex = 0;
      item.setAttribute("role", "button");
      item.setAttribute("aria-label", `Seleccionar ${clean(a.name || a.path || "medio")}`);
      item.dataset.id = a.id;

      if (S.selected?.id && a.id === S.selected.id) item.classList.add("active");

      const url = clean(a.public_url || "");
      const name = clean(a.name || a.path || "Asset");
      const meta = clean(a.folder || "");
      const isVideo = /video\//i.test(clean(a.mime || "")) || /\.(mp4|webm|mov)(\?|$)/i.test(url || clean(a.path || ""));

      item.innerHTML = `
        <div class="mediaAssetThumb" aria-hidden="true">
          ${url && !isVideo ? `<img src="${escapeHtml(url)}" alt="">` : `<span>${isVideo ? "▶" : "IMG"}</span>`}
        </div>
        <div class="mediaAssetBody">
          <strong>${escapeHtml(name)}</strong>
          <span>${escapeHtml(meta || "Sin folder")}</span>
          <small>${escapeHtml(clean(a.mime || ""))}</small>
        </div>
        <div class="mediaAssetActions">
          <button class="btn sm" type="button" data-use="1">Usar</button>
          <button class="btn sm" type="button" data-update="1">Actualizar</button>
          <button class="btn sm btn--danger" type="button" data-delete="1">Eliminar</button>
        </div>
      `;

      const selectAsset = () => {
        S.selected = a;
        hydrateFormFromAsset(dom, a);
        setPreview(dom, a);
        setNote(dom.noteEl, "Seleccionado. Podés asignarlo, actualizarlo o eliminarlo.");
        setMediaMode("assign");
        renderList(dom);
      };

      item.addEventListener("click", selectAsset);
      item.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          selectAsset();
        }
      });

      item.querySelector("[data-use]")?.addEventListener("click", (e) => {
        e.stopPropagation();
        selectAsset();
      });

      item.querySelector("[data-update]")?.addEventListener("click", (e) => {
        e.stopPropagation();
        S.selected = a;
        hydrateFormFromAsset(dom, a);
        setPreview(dom, a);
        openMediaUpdateModal(dom, a);
      });

      item.querySelector("[data-delete]")?.addEventListener("click", async (e) => {
        e.stopPropagation();
        S.selected = a;
        hydrateFormFromAsset(dom, a);
        setPreview(dom, a);
        await deleteSelected(dom);
      });

      frag.appendChild(item);
    });

    listEl.appendChild(frag);
  }

  const refreshList = withLock(async function (dom, opts) {
    const silent = !!opts?.silent;

    const sb = getSB();
    if (!sb) return toast("Supabase", "APP.supabase no está listo. Revisá el orden de scripts.", 4200);

    const session = await ensureSession(sb);
    if (!session) return;

    const folder = getFolderValue(dom);
    if (!silent) setNote(dom.noteEl, folder ? "Cargando lista del folder…" : "Cargando medios del bucket…");

    try {
      S.assets = (await fetchAssetsLatest(sb, { folder, limit: folder ? 120 : 250 }))
        .filter((asset) => guessBucketFromAsset(asset) === getBucket(dom));
      renderList(dom);
      setNote(dom.noteEl, "");
      S.didLoadOnce = true;
    } catch (e) {
      console.warn(e);
      setNote(dom.noteEl, "No se pudo cargar la lista.");
      toast("Error", e.message || String(e), 4200);
    }
  });

  // ---------------------------
  // URL -> asset (externo)
  // ---------------------------
  async function ensureAssetSelectedOrFromUrl(dom) {
    if (S.selected) return S.selected;

    const raw = clean(dom.urlEl?.value || "");
    if (!raw) return null;

    if (!isHttpUrl(raw)) {
      toast("URL", "Pegá una URL que empiece con http(s)://", 3200);
      return null;
    }

    const sb = getSB();
    if (!sb) throw new Error("APP.supabase no está listo.");
    const session = await ensureSession(sb);
    if (!session) return null;

    let folder = clean(dom.folderEl?.value || "");
    if (!folder) folder = "misc-img";
    folder = normFolder(folder);

    let name = clean(dom.nameEl?.value || "");
    if (!name) name = raw.split("/").pop()?.slice(0, 80) || "external";
    name = cleanSpaces(name);

    const created = await insertAsset(sb, {
      folder,
      name,
      path: raw,
      public_url: raw,
      mime: null,
      bytes: null,
    });

    S.selected = created;
    hydrateFormFromAsset(dom, created);
    setPreview(dom, created);
    emitMediaChanged({ action: "asset-created", mediaId: created.id });
    await refreshFolders(dom);
    await refreshList(dom, { silent: true });
    return created;
  }

  // ---------------------------
  // Asignación
  // ---------------------------
  function setSlotOptionsForScope(dom, scope) {
    if (!dom.slotSel) return;
    const arr = scope === "menu_item" ? MENU_SLOTS : EVENT_SLOTS;
    dom.slotSel.innerHTML = arr.map((s) => `<option value="${s.value}">${s.label}</option>`).join("");
  }

  function syncScopeUI(dom) {
    const scope = clean(dom.scopeTypeEl?.value || "event") || "event";
    if (dom.scopeEventWrap) dom.scopeEventWrap.hidden = scope !== "event";
    if (dom.scopeMenuWrap) dom.scopeMenuWrap.hidden = scope !== "menu_item";
    setSlotOptionsForScope(dom, scope);

    // defaults de folder por bucket si está vacío
    const b = getBucket(dom);
    const f = clean(dom.folderEl?.value || "");
    if (!f && dom.folderEl) dom.folderEl.value = b === "video" ? "events-video" : "events-img";
  }

  async function loadEventsAndMenu(dom) {
    const sb = getSB();
    if (!sb) return;

    // events
    if (dom.eventSel) {
      try {
        const events = await fetchEvents(sb);
        dom.eventSel.innerHTML =
          `<option value="">Seleccionar evento…</option>` +
          events
            .map((ev) => {
              const label = `${ev.title || "Evento"} · ${ev.month_key || ""} · ${ev.type || ""}`.trim();
              return `<option value="${ev.id}">${label}</option>`;
            })
            .join("");
      } catch (e) {
        console.warn(e);
        dom.eventSel.innerHTML = `<option value="">(No se pudieron cargar eventos)</option>`;
      }
    }

    // menu_items (si no existe, NO revienta todo)
    if (dom.menuSel) {
      try {
        const items = await fetchMenuItems(sb);
        dom.menuSel.innerHTML =
          `<option value="">Seleccionar ítem…</option>` +
          items
            .map((it) => {
              const label = `${it.menu_key || "menu"} · ${it.label || "Item"} → ${it.href || ""}`.trim();
              return `<option value="${it.id}">${label}</option>`;
            })
            .join("");
      } catch (e) {
        console.warn(e);
        if (looksLikeMissingRelation(e)) {
          dom.menuSel.innerHTML = `<option value="">(menu_items aún no existe)</option>`;
        } else {
          dom.menuSel.innerHTML = `<option value="">(No se pudo cargar menú)</option>`;
        }
      }
    }
  }

  function formatDate(ts) {
    if (!ts) return "—";
    try {
      const d = new Date(ts);
      return d.toLocaleString("es-CR", {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return String(ts);
    }
  }

  function setPreviewFromAssigned(dom, r) {
    const asset = {
      id: r.media_id,
      folder: r.folder || "",
      name: r.name || r.slot || "Asignado",
      path: r.path || "",
      public_url: r.public_url || r.path || "",
      mime: r.mime || "",
      bytes: r.bytes || null,
    };
    S.selected = asset;
    hydrateFormFromAsset(dom, asset);
    setPreview(dom, asset);
    setNote(dom.noteEl, `Vista previa: ${SLOT_LABELS[r.slot] || r.slot}.`);
    setMediaMode("assign");
    try { dom.previewWrap?.scrollIntoView({ behavior: "smooth", block: "nearest" }); } catch (_) {}
  }

  function renderAssigned(dom, rows) {
    if (!dom.assignedList) return;
    dom.assignedList.innerHTML = "";

    if (!rows.length) {
      const e = document.createElement("div");
      e.className = "empty";
      e.textContent = "No hay asignaciones todavía.";
      dom.assignedList.appendChild(e);
      return;
    }

    const frag = document.createDocumentFragment();
    rows.forEach((r) => {
      const row = document.createElement("article");
      row.className = "mediaAssignedItem";
      row.tabIndex = 0;
      row.setAttribute("role", "button");
      row.setAttribute("aria-label", `Ver preview de ${SLOT_LABELS[r.slot] || r.slot}`);
      row.dataset.slot = clean(r.slot || "");

      const u = clean(r.public_url || r.path || "");
      const updated = formatDate(r.binding_updated_at || r.media_updated_at);
      const slotLabel = SLOT_LABELS[r.slot] || clean(r.slot || "Slot");
      const slotHelp = SLOT_HELP[r.slot] || "Recurso asignado.";
      const filename = clean(r.name || (u.split("/").pop() || "Medio asignado"));
      const isVideo = /video\//i.test(clean(r.mime || "")) || /\.(mp4|webm|mov)$/i.test(u);

      row.innerHTML = `
        <div class="mediaAssignedThumb" aria-hidden="true">
          ${u && !isVideo ? `<img src="${u}" alt="">` : `<span>${isVideo ? "▶" : "IMG"}</span>`}
        </div>
        <div class="mediaAssignedBody">
          <div class="mediaAssignedTop">
            <strong>${escapeHtml(slotLabel)}</strong>
            <span>${escapeHtml(clean(r.slot || ""))}</span>
          </div>
          <p class="mediaAssignedHelp">${escapeHtml(slotHelp)}</p>
          <p class="mediaAssignedName">${escapeHtml(filename)}</p>
          <p class="mediaAssignedUrl">${escapeHtml(u || "—")}</p>
          <p class="mediaAssignedDate">Actualizado: ${escapeHtml(updated)}</p>
        </div>
        <div class="mediaAssignedActions">
          <button class="btn sm" type="button" data-preview="1">Preview</button>
          <button class="btn sm" type="button" data-copy="${escapeHtml(u)}">Copiar</button>
          <button class="btn sm btn--danger" type="button" data-remove="1">Quitar</button>
        </div>
      `;

      const preview = () => setPreviewFromAssigned(dom, r);
      row.addEventListener("click", preview);
      row.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          preview();
        }
      });

      row.querySelector("[data-preview]")?.addEventListener("click", (e) => {
        e.stopPropagation();
        preview();
      });

      row.querySelector("[data-copy]")?.addEventListener("click", (e) => {
        e.stopPropagation();
        const text = clean(u);
        if (!text) return;
        navigator.clipboard.writeText(text).then(
          () => toast("Copiado", "URL copiada.", 1600),
          () => toast("Copiar", "No se pudo copiar.", 2600)
        );
      });

      row.querySelector("[data-remove]")?.addEventListener("click", async (e) => {
        e.stopPropagation();
        await removeAssigned(dom, r);
      });

      frag.appendChild(row);
    });

    dom.assignedList.appendChild(frag);
  }

  function getScopeAndTarget(dom) {
    const scope = clean(dom.scopeTypeEl?.value || "event") || "event";
    const slot = clean(dom.slotSel?.value || "");

    let scope_id = "";
    if (scope === "menu_item") scope_id = clean(dom.menuSel?.value || "");
    else scope_id = clean(dom.eventSel?.value || "");

    return { scope, scope_id, slot };
  }

  async function viewAssigned(dom) {
    const { scope, scope_id } = getScopeAndTarget(dom);
    if (!scope_id) return toast("Asignación", "Seleccioná un destino.", 2600);

    const sb = getSB();
    if (!sb) return toast("Supabase", "No está listo.", 3200);
    const session = await ensureSession(sb);
    if (!session) return;

    setMediaMode("assign");

    try {
      const rows = await fetchBindingsLatest(sb, { scope, scope_id });
      renderAssigned(dom, rows);
    } catch (e) {
      console.warn(e);
      toast("Error", e.message || String(e), 4200);
    }
  }

  async function removeAssigned(dom, row) {
    const { scope, scope_id } = getScopeAndTarget(dom);
    const slot = clean(row?.slot || "");
    if (!scope_id || !slot) return toast("Asignación", "No pude identificar la asignación.", 2600);

    const ok = confirm(`¿Quitar la asignación ${SLOT_LABELS[slot] || slot}?

Esto NO elimina el archivo de Medios, solo lo desasigna de este destino.`);
    if (!ok) return;

    const sb = getSB();
    if (!sb) return toast("Supabase", "No está listo.", 3200);
    const session = await ensureSession(sb);
    if (!session) return;

    try {
      await deleteBinding(sb, { scope, scope_id, slot });
      emitMediaChanged({ action: "unassigned", scope, scope_id, eventId: scope === "event" ? scope_id : null, slot, mediaId: row.media_id || null });
      if (S.selected?.id && String(S.selected.id) === String(row.media_id)) {
        S.selected = null;
        if (dom.urlEl) dom.urlEl.value = "";
        setPreview(dom, null);
      }
      toast("Asignación", "Se quitó el slot. El archivo sigue disponible en Medios.", 2200);
      await viewAssigned(dom);
    } catch (e) {
      console.warn(e);
      toast("Error", e.message || String(e), 4200);
    }
  }

  async function assignNow(dom) {
    const { scope, scope_id, slot } = getScopeAndTarget(dom);
    if (!scope_id) return toast("Asignación", "Seleccioná un destino.", 2600);
    if (!slot) return toast("Slot", "Seleccioná un slot.", 2400);

    const sb = getSB();
    if (!sb) return toast("Supabase", "No está listo.", 3200);
    const session = await ensureSession(sb);
    if (!session) return;

    const asset = await ensureAssetSelectedOrFromUrl(dom);
    if (!asset) return toast("Medio", "Seleccioná un medio o pegá una URL.", 3000);

    try {
      await upsertBinding(sb, { scope, scope_id, slot, media_id: String(asset.id), note: null });
      emitMediaChanged({ action: "assigned", scope, scope_id, eventId: scope === "event" ? scope_id : null, slot, mediaId: String(asset.id) });
      toast("Asignado", "Listo. Se actualizó el slot.", 2200);
      await viewAssigned(dom);
    } catch (e) {
      console.warn(e);
      toast("Error", e.message || String(e), 4200);
    }
  }

  // ---------------------------
  // Delete
  // ---------------------------
  async function deleteSelected(dom) {
    const asset = S.selected;
    if (!asset?.id) return toast("Eliminar", "Seleccioná un medio primero.", 2400);

    const ok = confirm("¿Eliminar este medio de la biblioteca y del bucket?\n\nTambién se quitarán sus asignaciones porque media_bindings depende de este archivo. Esta acción no se puede deshacer.");
    if (!ok) return;

    const sb = getSB();
    if (!sb) return toast("Supabase", "No está listo.", 3200);
    const session = await ensureSession(sb);
    if (!session) return;

    try {
      const deleted = await deleteAssetRow(sb, asset.id);

      const p = clean(deleted.path || "");
      if (!isHttpUrl(p) && p) {
        // ✅ intenta borrar en ambos buckets
        await removeFromStorageAnyBucket(sb, p).catch(() => {});
      }

      const deletedId = deleted?.id || asset.id;
      S.selected = null;
      if (dom.mediaId) dom.mediaId.value = "";
      if (dom.urlEl) dom.urlEl.value = "";
      setPreview(dom, null);
      emitMediaChanged({ action: "asset-deleted", mediaId: deletedId });
      setNote(dom.noteEl, "Eliminado.");
      await refreshFolders(dom);
      await refreshList(dom, { silent: true });
      await viewAssigned(dom).catch(() => {});
    } catch (e) {
      console.warn(e);
      toast("Error", e.message || String(e), 4200);
    }
  }

  // ---------------------------
  // Bind (solo 1 vez)
  // ---------------------------
  async function bindOnce() {
    if (S.didBind) return;
    S.didBind = true;

    const dom = getDom();
    // si el HTML no está completo, salimos sin romper
    if (!dom.form || !dom.fileEl || !dom.bucketEl || !dom.folderEl || !dom.urlEl || !dom.listEl) return;

    bindMediaModeButtons();
    setMediaMode("library");

    // permitir pegar URL
    try { dom.urlEl.readOnly = false; } catch (_) {}

    buildFolderTools(dom);
    applyAccept(dom);
    syncScopeUI(dom);

    dom.bucketEl.addEventListener("change", async () => {
      applyAccept(dom);
      S.selected = null;
      if (dom.mediaId) dom.mediaId.value = "";
      if (dom.urlEl) dom.urlEl.value = "";
      setPreview(dom, null);
      await refreshFolders(dom);
      await refreshList(dom, { silent: true });
    });

    dom.folderEl.addEventListener("change", async () => {
      const select = document.getElementById("mediaFolderSelect");
      if (select) select.value = S.folders.includes(clean(dom.folderEl.value || "")) ? clean(dom.folderEl.value || "") : "";
      await refreshList(dom, { silent: true });
    });
    dom.btnRefresh?.addEventListener("click", () => refreshList(dom, { silent: false }));

    dom.btnCopy?.addEventListener("click", () => {
      const u = clean(dom.urlEl.value || "");
      if (!u) return toast("URL", "No hay URL para copiar.", 2200);
      navigator.clipboard.writeText(u).then(
        () => toast("Copiado", "URL copiada.", 1800),
        () => toast("Copiar", "No se pudo copiar.", 2600)
      );
    });

    dom.btnReset?.addEventListener("click", () => {
      S.selected = null;
      try { dom.fileEl.value = ""; } catch (_) {}
      if (dom.mediaId) dom.mediaId.value = "";
      dom.urlEl.value = "";
      if (dom.nameEl) dom.nameEl.value = "";
      if (dom.tagsEl) dom.tagsEl.value = "";
      setPreview(dom, null);
      setNote(dom.noteEl, "");
      if (dom.assignedList) dom.assignedList.innerHTML = "";
      renderList(dom);
    });

    dom.btnDelete?.addEventListener("click", () => deleteSelected(dom));

    // blur URL -> crea asset externo
    dom.urlEl.addEventListener("blur", async () => {
      const raw = clean(dom.urlEl.value || "");
      if (!raw) return;
      if (!isHttpUrl(raw)) return;
      try {
        await ensureAssetSelectedOrFromUrl(dom);
        setNote(dom.noteEl, "URL guardada como asset. Podés asignarla.");
      } catch (e) {
        console.warn(e);
        toast("Error", e.message || String(e), 4200);
      }
    });

    // submit upload
    dom.form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const sb = getSB();
      if (!sb) return toast("Supabase", "No está listo. Revisá scripts.", 3200);
      const session = await ensureSession(sb);
      if (!session) return;

      const file = dom.fileEl.files && dom.fileEl.files[0];
      if (!file) return toast("Archivo", "Seleccioná un archivo.", 2400);

      const bucket = getBucket(dom);

      let folder = clean(dom.folderEl.value || "");
      if (!folder) folder = bucket === "video" ? "events-video" : "events-img";
      folder = normFolder(folder);

      const nameBase = clean(dom.nameEl?.value || "");

      setNote(dom.noteEl, "Subiendo…");
      try {
        const up = await uploadToStorage(sb, file, bucket, folder, nameBase);

        const asset = await insertAsset(sb, {
          folder,
          name: clean(nameBase) || clean(file.name),
          path: up.path,
          public_url: up.public_url || null,
          mime: clean(file.type || "") || null,
          bytes: file.size || null,
        });

        S.selected = asset;
        hydrateFormFromAsset(dom, asset);
        setPreview(dom, asset);
        emitMediaChanged({ action: "asset-created", mediaId: asset.id });
        setNote(dom.noteEl, "Subido. Ahora podés asignar.");
        setMediaMode("assign");
        await refreshFolders(dom);
        await refreshList(dom, { silent: true });
      } catch (e2) {
        console.warn(e2);
        setNote(dom.noteEl, "Error al subir.");
        toast("Error", e2.message || String(e2), 4200);
      }
    });

    // Asignación
    dom.scopeTypeEl?.addEventListener("change", async () => {
      syncScopeUI(dom);
      if (dom.assignedList) dom.assignedList.innerHTML = "";
    });
    dom.eventSel?.addEventListener("change", () => {
      if (clean(dom.eventSel?.value || "")) viewAssigned(dom);
    });
    dom.menuSel?.addEventListener("change", () => {
      if (clean(dom.menuSel?.value || "")) viewAssigned(dom);
    });
    dom.btnAssign?.addEventListener("click", () => assignNow(dom));
    dom.btnViewAssigned?.addEventListener("click", () => viewAssigned(dom));

    // carga selectors + folders + lista
    await loadEventsAndMenu(dom);
    await refreshFolders(dom);
    await refreshList(dom, { silent: true });
  }

  // ---------------------------
  // ensureLoaded on-demand (throttle)
  // ---------------------------
  async function ensureLoaded(force) {
    const panel = document.getElementById("tab-media");
    if (!panel) return;

    const isHidden = !!panel.hidden;
    if (!force && isHidden) return;

    const now = Date.now();
    if (!force && now - S.lastLoadAt < 700) return;
    if (force && now - S.lastLoadAt < 250) return;
    S.lastLoadAt = now;

    await bindOnce();
  }

  // ---------------------------
  // Boot: esperar admin:ready
  // ---------------------------
  function boot() {
    if (S.didBoot) return;
    S.didBoot = true;

    console.log("[admin-media] boot", { VERSION });

    // si el tab ya está visible, cargá
    ensureLoaded(false);
  }

  // ✅ Esperar admin:ready
  if (window.APP && APP.__adminReady) boot();
  else window.addEventListener("admin:ready", boot, { once: true });

  // ✅ Tabs: escuchar en window + document
  function onAdminTab(e) {
    const t = e?.detail?.tab;
    if (t === "media") ensureLoaded(true);
  }
  window.addEventListener("admin:tab", onAdminTab);
  document.addEventListener("admin:tab", onAdminTab);
})();