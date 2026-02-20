"use strict";

/**
 * admin-media.js — Entre Copas & Notas ✅ PRO (alineado a tu BD real)
 *
 * BD (public):
 *  - media_assets: id(uuid), folder(text NOT NULL), name(text NOT NULL), path(text NOT NULL),
 *                 public_url(text), mime(text), bytes(bigint), created_at, updated_at
 *  - media_bindings: scope, scope_id, slot, media_id, ... con UNIQUE(scope, scope_id, slot)
 *  - v_media_bindings_latest: VIEW de lectura para ver el “latest” por slot
 *  - events: para selector de eventos
 *  - menu_items: para selector de menú (si ya lo creaste)
 *
 * Storage:
 *  - bucket "media" (imágenes)
 *  - bucket "video" (videos)
 *
 * Convención PRO (sin tocar BD):
 *  - Imágenes: events-img / promos-img / menu-img / gallery-img / misc-img
 *  - Videos:   events-video / promos-video / misc-video
 *
 * IDs esperados (admin.html tab Medios):
 *  #mediaForm #mediaFile #mediaBucket #mediaFolder #mediaName #mediaTags (tags solo UI)
 *  #mediaUrl #mediaCopyBtn #mediaResetBtn #deleteMediaBtn
 *  #mediaPreviewEmpty #mediaPreview #mediaPreviewImg #mediaPreviewMeta
 *  #mediaRefreshBtn #mediaList #mediaNote
 *  Asignación:
 *   #mediaScopeType #mediaEventSelect #mediaMenuSelect #mediaSlotSelect
 *   #mediaAssignBtn #mediaViewAssignedBtn #mediaAssignedList
 */

(function () {
  const VERSION = "2026-02-20.media.pro.schema-safe.1";
  const $ = (sel, root = document) => root.querySelector(sel);

  if (!$("#appPanel")) return;

  // -------- Supabase --------
  function getSB() {
    return window.APP && (APP.supabase || APP.sb) ? (APP.supabase || APP.sb) : null;
  }

  function toast(title, msg, ms = 3200) {
    try {
      if (window.APP && typeof APP.toast === "function") return APP.toast(title, msg, ms);
    } catch (_) {}
    alert(`${title} — ${msg}`);
  }

  const clean = (s) => String(s ?? "").trim();
  const cleanSpaces = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
  const normFolder = (s) =>
    cleanSpaces(s)
      .toLowerCase()
      .replace(/[^a-z0-9/_-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^\/+|\/+$/g, "");

  // -------- DB config --------
  const ASSETS_TABLE = "media_assets";
  const BINDINGS_TABLE = "media_bindings";
  const VIEW_LATEST = "v_media_bindings_latest";
  const EVENTS_TABLE = "events";
  const MENU_TABLE = "menu_items";

  // Storage buckets reales
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

  // -------- DOM --------
  const form = $("#mediaForm");
  const fileEl = $("#mediaFile");
  const bucketEl = $("#mediaBucket");
  const folderEl = $("#mediaFolder");
  const nameEl = $("#mediaName");
  const tagsEl = $("#mediaTags"); // UI only (no se guarda en DB)

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

  // Asignación
  const scopeTypeEl = $("#mediaScopeType");
  const scopeEventWrap = $("#mediaScopeEventWrap");
  const scopeMenuWrap = $("#mediaScopeMenuWrap");
  const eventSel = $("#mediaEventSelect");
  const menuSel = $("#mediaMenuSelect");
  const slotSel = $("#mediaSlotSelect");
  const btnAssign = $("#mediaAssignBtn");
  const btnViewAssigned = $("#mediaViewAssignedBtn");
  const assignedList = $("#mediaAssignedList");

  if (!form || !fileEl || !bucketEl || !folderEl || !urlEl || !listEl) return;

  // Permitir pegar URL
  try {
    urlEl.readOnly = false;
  } catch (_) {}

  // -------- Estado --------
  const state = {
    didBind: false,
    assets: [],
    selected: null, // asset seleccionado
  };

  function setNote(msg) {
    if (noteEl) noteEl.textContent = clean(msg || "");
  }

  function setPreview(asset) {
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

  function getBucket() {
    const b = clean(bucketEl.value || "media") || "media";
    return BUCKETS.includes(b) ? b : "media";
  }

  function applyAccept() {
    const b = getBucket();
    fileEl.setAttribute("accept", ACCEPTS[b] || "image/*,video/*");

    // Hint PRO: si está vacío, sugerimos folder según bucket
    const f = clean(folderEl.value || "");
    if (!f) {
      folderEl.value = b === "video" ? "events-video" : "events-img";
    }
  }

  // -------- DB helpers (schema-safe) --------
  async function fetchAssetsLatest({ folder, limit = 50 }) {
    const sb = getSB();
    if (!sb) throw new Error("APP.supabase no está listo.");

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

  async function insertAsset(payload) {
    // ✅ SOLO columnas existentes en tu tabla
    const sb = getSB();
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

  async function deleteAssetRow(assetId) {
    const sb = getSB();
    const { data, error } = await sb
      .from(ASSETS_TABLE)
      .delete()
      .eq("id", assetId)
      .select("id, path, folder, public_url")
      .single();
    if (error) throw error;
    return data;
  }

  async function upsertBinding({ scope, scope_id, slot, media_id, note = null }) {
    const sb = getSB();
    const payload = { scope, scope_id, slot, media_id, note };
    const { error } = await sb.from(BINDINGS_TABLE).upsert(payload, { onConflict: "scope,scope_id,slot" });
    if (error) throw error;
  }

  async function fetchBindingsLatest({ scope, scope_id }) {
    const sb = getSB();
    const { data, error } = await sb
      .from(VIEW_LATEST)
      .select("slot, public_url, path, media_id, updated_at")
      .eq("scope", scope)
      .eq("scope_id", String(scope_id))
      .order("slot", { ascending: true });

    if (error) throw error;
    return Array.isArray(data) ? data : [];
  }

  async function fetchEvents() {
    const sb = getSB();
    const { data, error } = await sb
      .from(EVENTS_TABLE)
      .select("id, title, month_key, type, created_at")
      .order("created_at", { ascending: false })
      .limit(250);
    if (error) throw error;
    return Array.isArray(data) ? data : [];
  }

  async function fetchMenuItems() {
    const sb = getSB();
    const { data, error } = await sb
      .from(MENU_TABLE)
      .select("id, label, href, menu_key, sort_order, active")
      .order("menu_key", { ascending: true })
      .order("sort_order", { ascending: true })
      .limit(500);
    if (error) throw error;
    return Array.isArray(data) ? data : [];
  }

  // -------- Storage helpers --------
  function extFromFile(file) {
    const m = String(file?.name || "").match(/\.([a-z0-9]{1,10})$/i);
    return (m?.[1] || "").toLowerCase();
  }

  function safeNameBase(nameBase, filename) {
    const base = clean(nameBase) || String(filename || "").replace(/\.[^.]+$/, "");
    return normFolder(base) || "asset";
  }

  async function uploadToStorage(file, bucket, folder, nameBase) {
    const sb = getSB();
    if (!sb) throw new Error("Supabase no listo.");

    const ext = extFromFile(file) || (bucket === "video" ? "mp4" : "jpg");
    const safeName = safeNameBase(nameBase, file.name);
    const path = `${normFolder(folder || "misc")}/${safeName}-${Date.now()}.${ext}`;

    const { error } = await sb.storage.from(bucket).upload(path, file, { cacheControl: "3600", upsert: false });
    if (error) throw error;

    const pub = sb.storage.from(bucket).getPublicUrl(path)?.data?.publicUrl || "";
    return { bucket, path, public_url: pub };
  }

  async function removeFromStorage(bucket, path) {
    const sb = getSB();
    const p = clean(path);
    if (!p) return;
    const { error } = await sb.storage.from(bucket).remove([p]);
    if (error) throw error;
  }

  // -------- List render --------
  function renderList() {
    listEl.innerHTML = "";

    if (!state.assets.length) {
      const div = document.createElement("div");
      div.className = "empty";
      div.textContent = "No hay medios en esta carpeta. Subí uno o pegá una URL.";
      listEl.appendChild(div);
      return;
    }

    const frag = document.createDocumentFragment();
    state.assets.forEach((a) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "item";
      item.style.textAlign = "left";
      item.style.width = "100%";
      item.dataset.id = a.id;

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
        state.selected = a;
        urlEl.value = clean(a.public_url || "");
        setPreview(a);
        setNote("Seleccionado. Podés copiar URL o asignar.");
      });

      frag.appendChild(item);
    });

    listEl.appendChild(frag);
  }

  async function refreshList() {
    const folder = clean(folderEl.value || "");
    setNote("Cargando lista…");
    try {
      state.assets = await fetchAssetsLatest({ folder, limit: 60 });
      renderList();
      setNote("");
    } catch (e) {
      console.warn(e);
      setNote("No se pudo cargar la lista.");
      toast("Error", e.message || String(e));
    }
  }

  // -------- URL -> asset --------
  async function ensureAssetSelectedOrFromUrl() {
    if (state.selected) return state.selected;

    const raw = clean(urlEl.value || "");
    if (!raw) return null;

    if (!/^https?:\/\//i.test(raw)) {
      toast("URL", "Pegá una URL que empiece con http(s)://", 3200);
      return null;
    }

    let folder = clean(folderEl.value || "");
    if (!folder) folder = "misc-img";
    folder = normFolder(folder);

    let name = clean(nameEl?.value || "");
    if (!name) name = raw.split("/").pop()?.slice(0, 80) || "external";
    name = cleanSpaces(name);

    // ✅ Insert schema-safe
    const created = await insertAsset({
      folder,
      name,
      path: raw,
      public_url: raw,
      mime: null,
      bytes: null,
    });

    state.selected = created;
    setPreview(created);
    await refreshList();
    return created;
  }

  // -------- Asignación --------
  function setSlotOptionsForScope(scope) {
    if (!slotSel) return;
    const opts = (scope === "menu_item" ? MENU_SLOTS : EVENT_SLOTS)
      .map((s) => `<option value="${s.value}">${s.label}</option>`)
      .join("");
    slotSel.innerHTML = opts;
  }

  function syncScopeUI() {
    if (!scopeTypeEl) return;
    const scope = clean(scopeTypeEl.value || "event") || "event";
    if (scopeEventWrap) scopeEventWrap.hidden = scope !== "event";
    if (scopeMenuWrap) scopeMenuWrap.hidden = scope !== "menu_item";
    setSlotOptionsForScope(scope);

    // Hint folder pro
    const b = getBucket();
    const f = clean(folderEl.value || "");
    if (!f) folderEl.value = b === "video" ? "events-video" : "events-img";
  }

  async function loadEventsAndMenu() {
    if (eventSel) {
      const events = await fetchEvents().catch(() => []);
      eventSel.innerHTML =
        `<option value="">Seleccionar evento…</option>` +
        events
          .map((ev) => {
            const label = `${ev.title || "Evento"} · ${ev.month_key || ""} · ${ev.type || ""}`.trim();
            return `<option value="${ev.id}">${label}</option>`;
          })
          .join("");
    }

    if (menuSel) {
      const items = await fetchMenuItems().catch(() => []);
      menuSel.innerHTML =
        `<option value="">Seleccionar ítem…</option>` +
        items
          .map((it) => {
            const label = `${it.menu_key || "menu"} · ${it.label || "Item"} → ${it.href || ""}`.trim();
            return `<option value="${it.id}">${label}</option>`;
          })
          .join("");
    }
  }

  function renderAssigned(rows) {
    if (!assignedList) return;
    assignedList.innerHTML = "";

    if (!rows.length) {
      const e = document.createElement("div");
      e.className = "empty";
      e.textContent = "No hay asignaciones todavía.";
      assignedList.appendChild(e);
      return;
    }

    rows.forEach((r) => {
      const row = document.createElement("div");
      row.className = "item";
      const u = clean(r.public_url || r.path || "");
      row.innerHTML = `
        <div style="display:flex; justify-content:space-between; gap:12px;">
          <div style="min-width:0;">
            <div style="font-weight:900; letter-spacing:.12em; text-transform:uppercase;">${clean(r.slot)}</div>
            <div style="opacity:.75; font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${u || "—"}</div>
          </div>
          <button class="btn sm" type="button" data-copy="${u}">Copiar</button>
        </div>
      `;
      row.querySelector("[data-copy]")?.addEventListener("click", () => {
        const text = clean(u);
        if (!text) return;
        navigator.clipboard.writeText(text).then(
          () => toast("Copiado", "URL copiada.", 1800),
          () => toast("Copiar", "No se pudo copiar.", 2600)
        );
      });
      assignedList.appendChild(row);
    });
  }

  function getScopeAndTarget() {
    const scope = clean(scopeTypeEl?.value || "event") || "event";
    const slot = clean(slotSel?.value || "");

    let scope_id = "";
    if (scope === "menu_item") scope_id = clean(menuSel?.value || "");
    else scope_id = clean(eventSel?.value || "");

    return { scope, scope_id, slot };
  }

  async function viewAssigned() {
    const { scope, scope_id } = getScopeAndTarget();
    if (!scope_id) return toast("Asignación", "Seleccioná un destino.", 2600);

    try {
      const rows = await fetchBindingsLatest({ scope, scope_id });
      renderAssigned(rows);
    } catch (e) {
      console.warn(e);
      toast("Error", e.message || String(e));
    }
  }

  async function assignNow() {
    const { scope, scope_id, slot } = getScopeAndTarget();
    if (!scope_id) return toast("Asignación", "Seleccioná un destino.", 2600);
    if (!slot) return toast("Slot", "Seleccioná un slot.", 2400);

    const asset = await ensureAssetSelectedOrFromUrl();
    if (!asset) return toast("Medio", "Seleccioná un medio o pegá una URL.", 3000);

    try {
      await upsertBinding({ scope, scope_id, slot, media_id: String(asset.id), note: null });
      toast("Asignado", "Listo. Se actualizó el slot.", 2200);
      await viewAssigned();
    } catch (e) {
      console.warn(e);
      toast("Error", e.message || String(e));
    }
  }

  // -------- Delete --------
  async function deleteSelected() {
    const asset = state.selected;
    if (!asset?.id) return toast("Eliminar", "Seleccioná un medio primero.", 2400);

    const ok = confirm("¿Eliminar este medio? Si está asignado en algún lado, va a dejar de verse.");
    if (!ok) return;

    try {
      const deleted = await deleteAssetRow(asset.id);

      // Si path es URL externa, no tocamos storage
      const p = clean(deleted.path || "");
      const isExternal = /^https?:\/\//i.test(p);

      if (!isExternal && p) {
        // Como NO guardamos bucket en DB, usamos el bucket seleccionado.
        // Por eso es PRO usar folders distintos (events-img vs events-video) y seleccionar bucket correcto al borrar.
        const bucket = getBucket();
        await removeFromStorage(bucket, p).catch(() => {});
      }

      state.selected = null;
      urlEl.value = "";
      setPreview(null);
      setNote("Eliminado.");
      await refreshList();
    } catch (e) {
      console.warn(e);
      toast("Error", e.message || String(e));
    }
  }

  // -------- Bind --------
  async function bindOnce() {
    if (state.didBind) return;
    state.didBind = true;

    applyAccept();

    bucketEl.addEventListener("change", () => {
      applyAccept();
      refreshList();
    });

    folderEl.addEventListener("change", refreshList);
    btnRefresh?.addEventListener("click", refreshList);

    btnCopy?.addEventListener("click", () => {
      const u = clean(urlEl.value || "");
      if (!u) return toast("URL", "No hay URL para copiar.", 2200);
      navigator.clipboard.writeText(u).then(
        () => toast("Copiado", "URL copiada.", 1800),
        () => toast("Copiar", "No se pudo copiar.", 2600)
      );
    });

    btnReset?.addEventListener("click", () => {
      state.selected = null;
      try { fileEl.value = ""; } catch (_) {}
      urlEl.value = "";
      if (nameEl) nameEl.value = "";
      if (tagsEl) tagsEl.value = "";
      setPreview(null);
      setNote("");
      if (assignedList) assignedList.innerHTML = "";
    });

    btnDelete?.addEventListener("click", deleteSelected);

    // blur URL -> crea asset externo
    urlEl.addEventListener("blur", async () => {
      const raw = clean(urlEl.value || "");
      if (!raw) return;
      if (!/^https?:\/\//i.test(raw)) return;
      try {
        await ensureAssetSelectedOrFromUrl();
        setNote("URL guardada como asset. Podés asignarla.");
      } catch (e) {
        console.warn(e);
        toast("Error", e.message || String(e));
      }
    });

    // submit upload
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const sb = getSB();
      if (!sb) return toast("Supabase", "No está listo. Revisá scripts.", 3200);

      const file = fileEl.files && fileEl.files[0];
      if (!file) return toast("Archivo", "Seleccioná un archivo.", 2400);

      const bucket = getBucket();

      let folder = clean(folderEl.value || "");
      if (!folder) folder = bucket === "video" ? "events-video" : "events-img";
      folder = normFolder(folder);

      const nameBase = clean(nameEl?.value || "");

      setNote("Subiendo…");
      try {
        const up = await uploadToStorage(file, bucket, folder, nameBase);

        // ✅ Insert schema-safe (sin tags/bucket)
        const asset = await insertAsset({
          folder,
          name: clean(nameBase) || clean(file.name),
          path: up.path,
          public_url: up.public_url || null,
          mime: clean(file.type || "") || null,
          bytes: file.size || null,
        });

        state.selected = asset;
        urlEl.value = clean(asset.public_url || "");
        setPreview(asset);
        setNote("Subido. Ahora podés asignar.");
        await refreshList();
      } catch (e2) {
        console.warn(e2);
        setNote("Error al subir.");
        toast("Error", e2.message || String(e2));
      }
    });

    // Asignación
    if (scopeTypeEl) scopeTypeEl.addEventListener("change", syncScopeUI);
    btnAssign?.addEventListener("click", assignNow);
    btnViewAssigned?.addEventListener("click", viewAssigned);

    syncScopeUI();
    await loadEventsAndMenu();
    await refreshList();
  }

  // Boot: solo cuando se abre tab Medios
  document.addEventListener("admin:tab", (e) => {
    if (e?.detail?.tab === "media") bindOnce();
  });

  // Si ya está visible al cargar
  setTimeout(() => {
    const panel = document.getElementById("tab-media");
    if (panel && panel.hidden === false) bindOnce();
  }, 0);
})();