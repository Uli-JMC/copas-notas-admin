"use strict";

/**
 * admin-gallery.js ✅ PRO (Supabase Storage + DB)
 * - Admin sube fotos para la galería (Storage + tabla)
 * - Guarda metadata en Supabase (public.gallery_items)
 * - Guarda archivo en Supabase Storage (bucket: gallery)
 *
 * Campos UI (admin.html):
 * - #tab-gallery
 * - #galleryForm, #galType, #galFile, #galName, #galTags, #galResetBtn
 * - #galleryList, #galPreview
 * - Preview IDs dentro de #galPreview:
 *    #galPreviewImg, #galPreviewTitle, #galPreviewMeta, #galPreviewTags
 *
 * Integra con admin.js:
 * - expone window.ECN_ADMIN_GALLERY = { init, render }
 *
 * Requisitos:
 * - Supabase CDN + supabaseClient.js + admin-auth.js (sesión válida)
 *
 * Supabase esperado:
 * 1) Bucket Storage: "gallery" (public o privado con signed urls)
 * 2) Tabla public.gallery_items (si no existe, el módulo entra en modo "pendiente")
 *
 * Sugerencia tabla:
 *   create table public.gallery_items (
 *     id uuid primary key default gen_random_uuid(),
 *     type text not null check (type in ('cocteles','maridajes')),
 *     name text not null,
 *     tags text[] not null default '{}',
 *     image_path text not null,
 *     image_url text null,
 *     target text not null default 'home',
 *     created_at timestamptz default now(),
 *     updated_at timestamptz default now()
 *   );
 */
(function () {
  const $ = (sel, root = document) => root.querySelector(sel);

  // Solo corre en admin.html
  if (!document.getElementById("appPanel")) return;

  if (!window.APP || !APP.supabase) {
    console.error("APP.supabase no existe. Revisá el orden: Supabase CDN -> supabaseClient.js -> admin-gallery.js");
    return;
  }

  const panel = document.getElementById("tab-gallery");
  if (!panel) return;

  // Elements
  const listEl = $("#galleryList", panel);

  const formEl = $("#galleryForm", panel);
  const typeSel = $("#galType", panel);
  const fileInp = $("#galFile", panel);
  const nameInp = $("#galName", panel);
  const tagsInp = $("#galTags", panel);
  const resetBtn = $("#galResetBtn", panel);

  const previewBox = $("#galPreview", panel);
  const prevImg = previewBox ? $("#galPreviewImg", previewBox) : null;
  const prevTitle = previewBox ? $("#galPreviewTitle", previewBox) : null;
  const prevMeta = previewBox ? $("#galPreviewMeta", previewBox) : null;
  const prevTags = previewBox ? $("#galPreviewTags", previewBox) : null;

  // ------------------------------------------------------------
  // Config
  // ------------------------------------------------------------
  const TABLE = "gallery_items";
  const BUCKET = "gallery";
  const TARGET_DEFAULT = "home";

  // Realtime (opcional)
  const ENABLE_REALTIME = true;
  const REALTIME_DEBOUNCE_MS = 250;

  // Signed URLs fallback (si bucket privado)
  const SIGNED_URL_TTL = 60 * 20; // 20 min

  // Subida: límites recomendados
  const MAX_MB = 6.0;
  const MAX_BYTES = MAX_MB * 1024 * 1024;

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

    const toastsEl = document.getElementById("toasts");
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
  // Utils
  // ------------------------------------------------------------
  function safeStr(x) {
    return String(x ?? "");
  }

  function cleanSpaces(s) {
    return String(s ?? "").replace(/\s+/g, " ").trim();
  }

  function clampStr(s, max) {
    const v = cleanSpaces(s);
    if (!v) return "";
    return v.length > max ? v.slice(0, max) : v;
  }

  function normType(v) {
    return String(v) === "cocteles" ? "cocteles" : "maridajes";
  }

  function normTags(input) {
    const raw = String(input || "")
      .replaceAll("\n", " ")
      .replaceAll("\r", " ")
      .trim();
    if (!raw) return [];

    const parts = raw
      .split(/[,; ]+/g)
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => (t.startsWith("#") ? t : `#${t}`))
      .map((t) => t.replace(/#+/g, "#"));

    return Array.from(new Set(parts)).slice(0, 12);
  }

  function nowISO() {
    return new Date().toISOString();
  }

  function fmtShortDate(iso) {
    try {
      const d = new Date(String(iso));
      if (isNaN(d.getTime())) return "—";
      return d
        .toLocaleDateString("es-CR", { day: "2-digit", month: "short", year: "numeric" })
        .replace(".", "");
    } catch (_) {
      return "—";
    }
  }

  function extFromMime(mime) {
    const m = String(mime || "").toLowerCase();
    if (m.includes("png")) return "png";
    if (m.includes("webp")) return "webp";
    if (m.includes("gif")) return "gif";
    return "jpg";
  }

  function humanKB(bytes) {
    const kb = bytes / 1024;
    if (kb < 1024) return `${Math.round(kb)} KB`;
    const mb = kb / 1024;
    return `${mb.toFixed(1)} MB`;
  }

  function esc(s) {
    return safeStr(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function slugify(s) {
    return cleanSpaces(s)
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9\-]/g, "")
      .replace(/\-+/g, "-")
      .replace(/^\-|\-$/g, "");
  }

  function isMissingTable(err) {
    const m = safeStr(err?.message || "").toLowerCase();
    return (m.includes("relation") && m.includes("does not exist")) || m.includes("does not exist");
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
      m.includes("new row violates row-level security")
    );
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
    } catch (e) {
      toast("Error", "No se pudo validar sesión con Supabase.", 3200);
      return null;
    }
  }

  // ------------------------------------------------------------
  // State
  // ------------------------------------------------------------
  let state = {
    items: [],
    selectedFile: null,
    selectedPreviewUrl: "",
    selectedBytes: 0,
    didBind: false,
    refreshing: false,
    pendingRefresh: false,
    tableReady: true,
    storageReady: true,
  };

  let realtimeChannel = null;

  function setBusy(on) {
    try {
      const els = formEl ? formEl.querySelectorAll("input, textarea, select, button") : [];
      els.forEach((el) => (el.disabled = !!on));
    } catch (_) {}
    try {
      const submitBtn = formEl ? formEl.querySelector('button[type="submit"]') : null;
      if (submitBtn) submitBtn.textContent = on ? "Subiendo…" : "Subir";
    } catch (_) {}
  }

  function renderEmptyMessage(title, msg) {
    if (!listEl) return;
    listEl.innerHTML = `
      <div class="item" style="cursor:default;">
        <div>
          <p class="itemTitle">${esc(title)}</p>
          <p class="itemMeta">${esc(msg)}</p>
        </div>
      </div>
    `;
  }

  // ------------------------------------------------------------
  // Supabase: fetch + CRUD
  // ------------------------------------------------------------
  function mapDbRow(r) {
    const row = r || {};
    return {
      id: row.id,
      type: normType(row.type),
      name: safeStr(row.name || "Foto"),
      tags: Array.isArray(row.tags) ? row.tags.map((t) => safeStr(t)).slice(0, 12) : [],
      image_path: safeStr(row.image_path || ""),
      image_url: safeStr(row.image_url || ""),
      target: safeStr(row.target || TARGET_DEFAULT),
      created_at: safeStr(row.created_at || ""),
      updated_at: safeStr(row.updated_at || ""),
      _signedUrl: "" // cache local
    };
  }

  function stableSort(arr) {
    return (arr || []).slice().sort((a, b) => {
      const ca = safeStr(a?.created_at || "");
      const cb = safeStr(b?.created_at || "");
      const dcmp = cb.localeCompare(ca);
      if (dcmp !== 0) return dcmp;
      const na = safeStr(a?.name || "");
      const nb = safeStr(b?.name || "");
      const ncmp = na.localeCompare(nb);
      if (ncmp !== 0) return ncmp;
      return safeStr(a?.id || "").localeCompare(safeStr(b?.id || ""));
    });
  }

  function publicUrlFromPath(path) {
    const p = safeStr(path).trim();
    if (!p) return "";
    try {
      const res = APP.supabase.storage.from(BUCKET).getPublicUrl(p);
      return res?.data?.publicUrl || "";
    } catch (_) {
      return "";
    }
  }

  async function signedUrlFromPath(path) {
    const p = safeStr(path).trim();
    if (!p) return "";
    try {
      const { data, error } = await APP.supabase.storage.from(BUCKET).createSignedUrl(p, SIGNED_URL_TTL);
      if (error) throw error;
      return data?.signedUrl || "";
    } catch (_) {
      return "";
    }
  }

  async function fetchItems() {
    const { data, error } = await APP.supabase
      .from(TABLE)
      .select("*")
      .eq("target", TARGET_DEFAULT)
      .order("created_at", { ascending: false })
      .order("name", { ascending: true });

    if (error) throw error;

    const rows = Array.isArray(data) ? data.map(mapDbRow) : [];
    // si no viene image_url, lo calculamos del storage
    rows.forEach((it) => {
      if (!it.image_url && it.image_path) it.image_url = publicUrlFromPath(it.image_path);
    });

    return stableSort(rows);
  }

  async function insertDbRow(payload) {
    const { data, error } = await APP.supabase.from(TABLE).insert(payload).select("*").single();
    if (error) throw error;
    return mapDbRow(data);
  }

  async function deleteDbRow(id) {
    // pedimos image_path por si hay que borrar storage
    const { data, error } = await APP.supabase
      .from(TABLE)
      .delete()
      .eq("id", id)
      .select("id,image_path")
      .single();
    if (error) throw error;
    return data || null;
  }

  async function deleteStorageObject(path) {
    const p = safeStr(path).trim();
    if (!p) return;
    const { error } = await APP.supabase.storage.from(BUCKET).remove([p]);
    if (error) throw error;
  }

  async function uploadToStorage(file, path) {
    const { error } = await APP.supabase.storage.from(BUCKET).upload(path, file, {
      cacheControl: "3600",
      upsert: false,
    });
    if (error) throw error;
    return true;
  }

  // ------------------------------------------------------------
  // Refresh (safe)
  // ------------------------------------------------------------
  async function refreshList() {
    if (state.refreshing) {
      state.pendingRefresh = true;
      return;
    }
    state.refreshing = true;

    try {
      const s = await ensureSession();
      if (!s) return;

      // Si tabla no existe, mostramos mensaje “pendiente”
      const items = await fetchItems();
      state.items = items;
      state.tableReady = true;

      renderList();
    } catch (e) {
      console.error(e);

      if (isMissingTable(e)) {
        state.tableReady = false;
        renderEmptyMessage(
          "Galería pendiente",
          "No existe la tabla public.gallery_items en tu Supabase. Creala (o decime si querés que usemos promos como galería)."
        );
        toast("BD", "Falta crear public.gallery_items (la galería aún no está conectada).", 4200);
      } else if (isRLSError(e)) {
        renderEmptyMessage(
          "Bloqueado por RLS",
          "Supabase está conectado, pero RLS/policies no permiten leer gallery_items."
        );
        toast("RLS", "Acceso bloqueado. Falta policy SELECT para gallery_items.", 4200);
      } else {
        renderEmptyMessage("Error", "No se pudo cargar la galería. Revisá consola / policies.");
        toast("Error", "No se pudo cargar la galería. Revisá RLS/policies.", 3600);
      }
    } finally {
      state.refreshing = false;
      if (state.pendingRefresh) {
        state.pendingRefresh = false;
        setTimeout(refreshList, 0);
      }
    }
  }

  // ------------------------------------------------------------
  // Preview
  // ------------------------------------------------------------
  function resetPreview() {
    state.selectedFile = null;
    state.selectedBytes = 0;

    if (state.selectedPreviewUrl) {
      try {
        URL.revokeObjectURL(state.selectedPreviewUrl);
      } catch (_) {}
      state.selectedPreviewUrl = "";
    }

    if (prevImg) {
      prevImg.src = "";
      prevImg.style.display = "none";
    }
    if (prevTitle) prevTitle.textContent = "Sin imagen seleccionada";
    if (prevMeta) prevMeta.textContent = "Seleccioná una foto para previsualizar.";
    if (prevTags) prevTags.innerHTML = "";
  }

  function renderPreview() {
    if (!previewBox) return;

    const name = clampStr(nameInp ? nameInp.value : "", 70) || "(sin nombre)";
    const tags = normTags(tagsInp ? tagsInp.value : "");
    const type = normType(typeSel ? typeSel.value : "maridajes");

    if (prevTitle) prevTitle.textContent = name;

    const meta = [
      type === "cocteles" ? "Cocteles" : "Maridajes",
      state.selectedBytes ? humanKB(state.selectedBytes) : "—",
      fmtShortDate(nowISO()),
    ].join(" · ");

    if (prevMeta) prevMeta.textContent = meta;

    if (prevTags) {
      prevTags.innerHTML = tags.length
        ? tags.map((t) => `<span class="pill">${escapeHtml(t)}</span>`).join("")
        : `<span class="pill">#sin-tags</span>`;
    }

    if (prevImg) {
      if (state.selectedPreviewUrl) {
        prevImg.src = state.selectedPreviewUrl;
        prevImg.alt = name;
        prevImg.style.display = "block";
      } else {
        prevImg.src = "";
        prevImg.style.display = "none";
      }
    }
  }

  // ------------------------------------------------------------
  // Modal simple para “Ver”
  // ------------------------------------------------------------
  function ensureModal() {
    let m = document.getElementById("ecnGalModal");
    if (m) return m;

    m = document.createElement("div");
    m.id = "ecnGalModal";
    m.style.position = "fixed";
    m.style.inset = "0";
    m.style.background = "rgba(0,0,0,.65)";
    m.style.display = "none";
    m.style.alignItems = "center";
    m.style.justifyContent = "center";
    m.style.padding = "20px";
    m.style.zIndex = "9999";

    m.innerHTML = `
      <div style="max-width:920px; width:100%; background: rgba(20,20,20,.96); border:1px solid rgba(255,255,255,.10); border-radius:16px; overflow:hidden;">
        <div style="display:flex; justify-content:space-between; align-items:center; padding:12px 14px; border-bottom:1px solid rgba(255,255,255,.10);">
          <div>
            <p id="ecnGalModalTitle" style="margin:0; font-weight:700;">Foto</p>
            <p id="ecnGalModalMeta" style="margin:4px 0 0; opacity:.8; font-size:.92rem;"></p>
          </div>
          <button id="ecnGalModalClose" class="btn" type="button">Cerrar</button>
        </div>
        <div style="padding:14px;">
          <img id="ecnGalModalImg" alt="Foto" style="width:100%; height:auto; border-radius:12px; border:1px solid rgba(255,255,255,.10);" />
          <div id="ecnGalModalTags" class="pills" style="margin-top:12px; display:flex; flex-wrap:wrap; gap:8px;"></div>
        </div>
      </div>
    `;

    document.body.appendChild(m);

    const close = () => (m.style.display = "none");
    m.addEventListener("click", (e) => {
      if (e.target === m) close();
    });
    m.querySelector("#ecnGalModalClose")?.addEventListener("click", close);

    return m;
  }

  async function resolveViewUrl(it) {
    // 1) image_url si existe
    if (it.image_url) return it.image_url;

    // 2) public url
    const pub = publicUrlFromPath(it.image_path);
    if (pub) return pub;

    // 3) signed url fallback
    const signed = await signedUrlFromPath(it.image_path);
    return signed || "";
  }

  async function openModal(it) {
    const m = ensureModal();
    const title = m.querySelector("#ecnGalModalTitle");
    const meta = m.querySelector("#ecnGalModalMeta");
    const img = m.querySelector("#ecnGalModalImg");
    const tags = m.querySelector("#ecnGalModalTags");

    const typeLabel = it.type === "cocteles" ? "Cocteles" : "Maridajes";
    const when = fmtShortDate(it.created_at);

    if (title) title.textContent = it.name || "Foto";
    if (meta) meta.textContent = `${typeLabel} • ${when} • ${(it.tags || []).length} tag(s)`;

    if (tags) {
      tags.innerHTML =
        it.tags && it.tags.length
          ? it.tags.map((t) => `<span class="pill">${escapeHtml(t)}</span>`).join("")
          : `<span class="pill">#sin-tags</span>`;
    }

    if (img) {
      img.src = "";
      const url = await resolveViewUrl(it);
      img.src = url || "";
    }

    m.style.display = "flex";
  }

  // ------------------------------------------------------------
  // List render (con filtro por búsqueda global)
  // ------------------------------------------------------------
  function getQuery() {
    const search = document.getElementById("search");
    return cleanSpaces(search ? search.value : "").toLowerCase();
  }

  function filterItems(items) {
    const q = getQuery();
    if (!q) return items;

    return items.filter((it) => {
      const hay =
        (it.name || "").toLowerCase().includes(q) ||
        (it.type || "").toLowerCase().includes(q) ||
        (Array.isArray(it.tags) ? it.tags.join(" ").toLowerCase() : "").includes(q);

      return hay;
    });
  }

  async function getThumbUrl(it) {
    // cache
    if (it._thumbUrl) return it._thumbUrl;

    // prefer image_url
    if (it.image_url) {
      it._thumbUrl = it.image_url;
      return it._thumbUrl;
    }

    // public
    const pub = publicUrlFromPath(it.image_path);
    if (pub) {
      it._thumbUrl = pub;
      return it._thumbUrl;
    }

    // signed fallback
    const signed = await signedUrlFromPath(it.image_path);
    it._thumbUrl = signed || "";
    return it._thumbUrl;
  }

  async function renderList() {
    if (!listEl) return;

    if (!state.tableReady) {
      renderEmptyMessage(
        "Galería pendiente",
        "No existe public.gallery_items en Supabase. Creala para habilitar este módulo."
      );
      return;
    }

    const items = filterItems(stableSort(state.items));
    listEl.innerHTML = "";

    if (!items.length) {
      renderEmptyMessage("Sin fotos", "Subí una imagen para empezar.");
      return;
    }

    // Render rápido: primero estructura, luego resolvemos thumbs async
    const frag = document.createDocumentFragment();

    items.forEach((it) => {
      const row = document.createElement("div");
      row.className = "item";
      row.dataset.id = String(it.id || "");

      const typeLabel = it.type === "cocteles" ? "Cocteles" : "Maridajes";
      const meta = `${typeLabel} • ${fmtShortDate(it.created_at)} • ${(it.tags || []).length} tag(s)`;
      const tags = Array.isArray(it.tags) ? it.tags.slice(0, 6) : [];

      row.innerHTML = `
        <div style="display:flex; gap:12px; align-items:flex-start; width:100%;">
          <img data-thumb="1" src="" alt="${esc(it.name || "Foto")}"
               style="width:70px;height:70px;object-fit:cover;border-radius:0;border:1px solid rgba(255,255,255,.10);flex:0 0 auto;background:rgba(255,255,255,.06);" loading="lazy">
          <div style="flex:1 1 auto;">
            <p class="itemTitle">${esc(it.name || "Sin nombre")}</p>
            <p class="itemMeta">${esc(meta)}</p>
            <div class="pills" style="margin-top:8px;">
              ${
                tags.length
                  ? tags.map((x) => `<span class="pill">${esc(x)}</span>`).join("")
                  : `<span class="pill">#sin-tags</span>`
              }
            </div>
          </div>
          <div class="pills" style="justify-content:flex-end; flex:0 0 auto;">
            <button class="btn" type="button" data-action="view">Ver</button>
            <button class="btn" type="button" data-action="copy">Copiar tags</button>
            <button class="btn" type="button" data-action="delete">Eliminar</button>
          </div>
        </div>
      `;

      frag.appendChild(row);
    });

    listEl.appendChild(frag);

    // Resolver thumbs async (sin bloquear UI)
    try {
      const rows = Array.from(listEl.querySelectorAll(".item"));
      for (const row of rows) {
        const id = String(row.dataset.id || "");
        const it = (state.items || []).find((x) => String(x.id) === id);
        if (!it) continue;

        const img = row.querySelector('img[data-thumb="1"]');
        if (!img) continue;

        const url = await getThumbUrl(it);
        if (url) img.src = url;
      }
    } catch (_) {}
  }

  // ------------------------------------------------------------
  // File change
  // ------------------------------------------------------------
  function onFileChange() {
    const f = fileInp && fileInp.files ? fileInp.files[0] : null;
    if (!f) {
      resetPreview();
      return;
    }

    if (!/^image\//.test(f.type)) {
      toast("Archivo inválido", "Seleccioná una imagen (JPG/PNG/WebP).");
      fileInp.value = "";
      resetPreview();
      return;
    }

    if (f.size > MAX_BYTES) {
      toast("Muy pesada", `La imagen pesa ${humanKB(f.size)}. Usá una menor a ~${MAX_MB}MB.`);
      fileInp.value = "";
      resetPreview();
      return;
    }

    try {
      if (state.selectedPreviewUrl) URL.revokeObjectURL(state.selectedPreviewUrl);
    } catch (_) {}

    state.selectedFile = f;
    state.selectedBytes = f.size;
    state.selectedPreviewUrl = URL.createObjectURL(f);

    // Autonombre si está vacío
    if (nameInp && !cleanSpaces(nameInp.value)) {
      const base = f.name.replace(/\.[a-z0-9]+$/i, "");
      nameInp.value = base;
    }

    renderPreview();
  }

  // ------------------------------------------------------------
  // Submit (upload + insert)
  // ------------------------------------------------------------
  async function onSubmit(e) {
    e.preventDefault();

    if (!state.tableReady) {
      toast("BD", "Primero hay que crear public.gallery_items para habilitar la galería.");
      return;
    }

    if (!state.selectedFile) {
      toast("Falta imagen", "Seleccioná una foto antes de subir.");
      return;
    }

    const type = normType(typeSel ? typeSel.value : "maridajes");
    const name = clampStr(nameInp ? nameInp.value : "", 60);
    const tags = normTags(tagsInp ? tagsInp.value : "");

    if (!name) {
      toast("Falta nombre", "Poné un nombre para identificar la foto.");
      return;
    }

    setBusy(true);

    try {
      const s = await ensureSession();
      if (!s) return;

      const f = state.selectedFile;

      const yyyyMm = nowISO().slice(0, 7);
      const ext = extFromMime(f.type);
      const base = slugify(name) || "foto";
      const path = `${type}/${yyyyMm}/${base}_${Date.now()}.${ext}`;

      // 1) Upload a Storage
      await uploadToStorage(f, path);

      // 2) URL pública si aplica; si no, se verá por signedUrl
      const publicUrl = publicUrlFromPath(path);

      // 3) Insert DB
      const payload = {
        type,
        name,
        tags,
        image_path: path,
        image_url: publicUrl || null,
        target: TARGET_DEFAULT,
      };

      await insertDbRow(payload);

      toast("Listo", "La foto se agregó a la galería.", 2200);

      // Refresh lista
      await refreshList();

      // limpiar form
      try {
        formEl?.reset();
      } catch (_) {}
      resetPreview();
    } catch (err) {
      console.error(err);

      if (isRLSError(err)) {
        toast("RLS", "Bloqueado. Faltan policies de INSERT/SELECT para gallery_items o storage.", 4200);
      } else {
        toast("Error", "No se pudo subir la imagen. Revisá bucket/policies/RLS.", 3600);
      }
    } finally {
      setBusy(false);
    }
  }

  // ------------------------------------------------------------
  // Reset
  // ------------------------------------------------------------
  function onReset() {
    try {
      formEl?.reset();
    } catch (_) {}
    resetPreview();
    toast("Limpiado", "Formulario y preview reiniciados.");
  }

  // ------------------------------------------------------------
  // List actions
  // ------------------------------------------------------------
  async function onListClick(e) {
    const btn = e.target && e.target.closest ? e.target.closest("[data-action]") : null;
    if (!btn) return;

    const row = btn.closest(".item");
    if (!row) return;

    const id = String(row.dataset.id || "");
    const action = String(btn.dataset.action || "");

    const it = (state.items || []).find((x) => String(x.id) === id);
    if (!it) return;

    if (action === "delete") {
      const ok = confirm(`Eliminar esta foto?\n\n${it.name || "Sin nombre"}\n\n(Se borra de Supabase)`);
      if (!ok) return;

      setBusy(true);
      try {
        const s = await ensureSession();
        if (!s) return;

        let deleted = null;

        // Intento 1: borrar DB y obtener image_path
        try {
          deleted = await deleteDbRow(it.id);
        } catch (e1) {
          console.warn("DB delete fail:", e1);
          // si falla DB por RLS pero el usuario quiere borrar, no seguimos con storage
          if (isRLSError(e1)) throw e1;
        }

        // Intento 2: borrar Storage si tenemos path
        const p = deleted?.image_path || it.image_path;
        if (p) {
          try {
            await deleteStorageObject(p);
          } catch (e2) {
            console.warn("Storage delete fail:", e2);
          }
        }

        toast("Eliminada", "Se eliminó la foto.", 2200);
        await refreshList();
      } catch (err) {
        console.error(err);
        if (isRLSError(err)) {
          toast("RLS", "Bloqueado. Falta policy DELETE en gallery_items (y/o storage).", 4200);
        } else {
          toast("Error", "No se pudo eliminar. Revisá policies.", 3600);
        }
      } finally {
        setBusy(false);
      }
      return;
    }

    if (action === "copy") {
      const text = Array.isArray(it.tags) && it.tags.length ? it.tags.join(" ") : "";
      if (!text) {
        toast("Sin tags", "Esta foto no tiene tags para copiar.");
        return;
      }
      navigator.clipboard?.writeText(text).then(
        () => toast("Copiado", "Tags copiados al portapapeles."),
        () => toast("Copiar", "No pude acceder al portapapeles.")
      );
      return;
    }

    if (action === "view") {
      openModal(it);
      return;
    }
  }

  // ------------------------------------------------------------
  // Realtime
  // ------------------------------------------------------------
  function wireRealtime() {
    if (!ENABLE_REALTIME) return;

    try {
      if (realtimeChannel) {
        try {
          APP.supabase.removeChannel(realtimeChannel);
        } catch (_) {}
        realtimeChannel = null;
      }

      realtimeChannel = APP.supabase
        .channel("admin-gallery-realtime")
        .on("postgres_changes", { event: "*", schema: "public", table: TABLE }, () => {
          clearTimeout(wireRealtime._t);
          wireRealtime._t = setTimeout(() => refreshList(), REALTIME_DEBOUNCE_MS);
        })
        .subscribe();
    } catch (e) {
      console.warn("Realtime no disponible:", e);
    }
  }

  // ------------------------------------------------------------
  // Bind
  // ------------------------------------------------------------
  function bindOnce() {
    if (state.didBind) return;
    state.didBind = true;

    fileInp?.addEventListener("change", onFileChange);
    nameInp?.addEventListener("input", renderPreview);
    tagsInp?.addEventListener("input", renderPreview);
    typeSel?.addEventListener("change", renderPreview);

    formEl?.addEventListener("submit", onSubmit);
    resetBtn?.addEventListener("click", onReset);
    listEl?.addEventListener("click", onListClick);

    // Re-render cuando cambia búsqueda global
    document.getElementById("search")?.addEventListener("input", () => {
      renderList();
    });
  }

  // ------------------------------------------------------------
  // API pública
  // ------------------------------------------------------------
  function init() {
    bindOnce();
    resetPreview();
    refreshList();
    wireRealtime();
  }

  function render() {
    refreshList();
    renderPreview();
  }

  // Auto-init
  init();

  window.ECN_ADMIN_GALLERY = { init, render };
})();
