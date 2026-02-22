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

  const VERSION = "2026-02-22.media.clean.1";
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
    { value: "slide_img", label: "Home Slider · Imagen (slide_img)" },
    { value: "slide_video", label: "Home Slider · Video (slide_video)" },
    { value: "desktop_event", label: "Evento · Desktop (desktop_event)" },
    { value: "mobile_event", label: "Evento · Mobile (mobile_event)" },
    { value: "event_more", label: "Evento · Ver más (event_more)" },
  ];

  const MENU_SLOTS = [
    { value: "icon", label: "Menú · Icono (icon)" },
    { value: "image", label: "Menú · Imagen (image)" },
  ];

  // ---------------------------
  // DOM (solo se usa cuando el tab media existe)
  // ---------------------------
  function getDom() {
    const form = $("#mediaForm");
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
    selected: null,
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

  // ---------------------------
  // DB helpers
  // ---------------------------
  async function fetchAssetsLatest(sb, { folder, limit = 60 }) {
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

  async function upsertBinding(sb, { scope, scope_id, slot, media_id, note = null }) {
    const payload = { scope, scope_id, slot, media_id, note };
    const { error } = await sb.from(BINDINGS_TABLE).upsert(payload, { onConflict: "scope,scope_id,slot" });
    if (error) throw error;
  }

  async function fetchBindingsLatest(sb, { scope, scope_id }) {
    const { data, error } = await sb
      .from(VIEW_LATEST)
      .select("slot, public_url, path, media_id, binding_updated_at, media_updated_at")
      .eq("scope", scope)
      .eq("scope_id", String(scope_id))
      .order("slot", { ascending: true });

    if (error) throw error;
    return Array.isArray(data) ? data : [];
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

  // ---------------------------
  // Render list
  // ---------------------------
  function renderList(dom) {
    const { listEl, urlEl } = dom;
    if (!listEl) return;

    listEl.innerHTML = "";

    if (!S.assets.length) {
      const div = document.createElement("div");
      div.className = "empty";
      div.textContent = "No hay medios en esta carpeta. Subí uno o pegá una URL.";
      listEl.appendChild(div);
      return;
    }

    const frag = document.createDocumentFragment();
    S.assets.forEach((a) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "item";
      item.style.textAlign = "left";
      item.style.width = "100%";
      item.dataset.id = a.id;

      if (S.selected?.id && a.id === S.selected.id) item.classList.add("active");

      const url = clean(a.public_url || "");
      const name = clean(a.name || a.path || "Asset");
      const meta = clean(a.folder || "");

      item.innerHTML = `
        <div style="display:flex; gap:12px; align-items:center;">
          <div style="width:54px; height:40px; border-radius:12px; overflow:hidden; border:1px solid rgba(255,255,255,.10); background:rgba(0,0,0,.25); flex:0 0 auto;">
            ${url ? `<img src="${url}" alt="" style="width:100%; height:100%; object-fit:cover;">` : ""}
          </div>
          <div style="min-width:0;">
            <div style="font-weight:800; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${name}</div>
            <div style="opacity:.72; font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${meta}</div>
          </div>
        </div>
      `;

      item.addEventListener("click", () => {
        S.selected = a;
        if (urlEl) urlEl.value = clean(a.public_url || "");
        setPreview(dom, a);
        setNote(dom.noteEl, "Seleccionado. Podés copiar URL o asignar.");
        renderList(dom); // refresca active class sin recargar data
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

    const folder = clean(dom.folderEl?.value || "");
    if (!silent) setNote(dom.noteEl, "Cargando lista…");

    try {
      S.assets = await fetchAssetsLatest(sb, { folder, limit: 60 });
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
    setPreview(dom, created);
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

    rows.forEach((r) => {
      const row = document.createElement("div");
      row.className = "item";
      const u = clean(r.public_url || r.path || "");
      const updated = formatDate(r.binding_updated_at || r.media_updated_at);

      row.innerHTML = `
        <div style="display:flex; justify-content:space-between; gap:12px; align-items:center;">
          <div style="min-width:0;">
            <div style="font-weight:900; letter-spacing:.12em; text-transform:uppercase;">
              ${clean(r.slot)}
            </div>
            <div style="opacity:.75; font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
              ${u || "—"}
            </div>
            <div style="opacity:.55; font-size:12px;">
              actualizado: ${updated}
            </div>
          </div>
          <button class="btn sm" type="button" data-copy="${u}">Copiar</button>
        </div>
      `;

      row.querySelector("[data-copy]")?.addEventListener("click", () => {
        const text = clean(u);
        if (!text) return;
        navigator.clipboard.writeText(text).then(
          () => toast("Copiado", "URL copiada.", 1600),
          () => toast("Copiar", "No se pudo copiar.", 2600)
        );
      });

      dom.assignedList.appendChild(row);
    });
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

    try {
      const rows = await fetchBindingsLatest(sb, { scope, scope_id });
      renderAssigned(dom, rows);
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

    const ok = confirm("¿Eliminar este medio? Si está asignado en algún lado, va a dejar de verse.");
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

      S.selected = null;
      if (dom.urlEl) dom.urlEl.value = "";
      setPreview(dom, null);
      setNote(dom.noteEl, "Eliminado.");
      await refreshList(dom, { silent: true });
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

    // permitir pegar URL
    try { dom.urlEl.readOnly = false; } catch (_) {}

    applyAccept(dom);
    syncScopeUI(dom);

    dom.bucketEl.addEventListener("change", () => {
      applyAccept(dom);
      refreshList(dom, { silent: true });
    });

    dom.folderEl.addEventListener("change", () => refreshList(dom, { silent: true }));
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
        dom.urlEl.value = clean(asset.public_url || "");
        setPreview(dom, asset);
        setNote(dom.noteEl, "Subido. Ahora podés asignar.");
        await refreshList(dom, { silent: true });
      } catch (e2) {
        console.warn(e2);
        setNote(dom.noteEl, "Error al subir.");
        toast("Error", e2.message || String(e2), 4200);
      }
    });

    // Asignación
    dom.scopeTypeEl?.addEventListener("change", () => syncScopeUI(dom));
    dom.btnAssign?.addEventListener("click", () => assignNow(dom));
    dom.btnViewAssigned?.addEventListener("click", () => viewAssigned(dom));

    // carga selectors + lista
    await loadEventsAndMenu(dom);
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