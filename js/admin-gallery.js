"use strict";

/**
 * admin-gallery.js ✅ PRO (DOM REAL) — 2026-02-18 PATCH (depurado)
 * ✅ Sin recargar:
 * - Espera admin:ready (admin-auth.js) o APP.__adminReady
 * - Carga SOLO al abrir tab "gallery" vía evento admin:tab
 * - Bind/Load protegidos (sin duplicados + throttle)
 *
 * Requiere:
 * - #appPanel
 * - #tab-gallery, #galleryTbody, #newGalleryBtn, #refreshGalleryBtn
 * - #search (filtro local)
 */

(function () {
  // ---------------------------
  // Helpers DOM
  // ---------------------------
  const $ = (sel, root = document) => root.querySelector(sel);

  // Guard: solo corre dentro del admin real
  if (!$("#appPanel")) return;

  const panel = $("#tab-gallery");
  const tbody = $("#galleryTbody");
  const btnNew = $("#newGalleryBtn");
  const btnRefresh = $("#refreshGalleryBtn");

  // Guard: si no existe el tab, salimos
  if (!panel || !tbody) return;

  // ---------------------------
  // Config
  // ---------------------------
  const VERSION = "2026-02-18.gallery.depured.1";
  const TABLE = "gallery_items";
  const BUCKET = "gallery";
  const TARGET_DEFAULT = "home";
  const MAX_MB = 6;
  const MAX_BYTES = MAX_MB * 1024 * 1024;

  // ---------------------------
  // Toast (usa el del sistema si existe)
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
      m.includes("violates row-level security") ||
      m.includes("new row violates row-level security")
    );
  }

  function fmtShortDate(iso) {
    try {
      const d = new Date(safeStr(iso));
      if (isNaN(d.getTime())) return "—";
      return d
        .toLocaleDateString("es-CR", { day: "2-digit", month: "short", year: "numeric" })
        .replace(".", "");
    } catch (_) {
      return "—";
    }
  }

  function humanKB(bytes) {
    const b = Number(bytes || 0);
    if (!Number.isFinite(b) || b <= 0) return "—";
    const kb = b / 1024;
    if (kb < 1024) return `${Math.round(kb)} KB`;
    const mb = kb / 1024;
    return `${mb.toFixed(1)} MB`;
  }

  function normType(v) {
    const t = safeStr(v).toLowerCase();
    return t === "cocteles" ? "cocteles" : "maridajes";
  }

  function normTags(input) {
    const raw = safeStr(input).replaceAll("\n", " ").replaceAll("\r", " ").trim();
    if (!raw) return [];
    const parts = raw
      .split(/[,; ]+/g)
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => (t.startsWith("#") ? t : `#${t}`))
      .map((t) => t.replace(/#+/g, "#"));
    return Array.from(new Set(parts)).slice(0, 12);
  }

  function extFromMime(mime) {
    const m = safeStr(mime).toLowerCase();
    if (m.includes("png")) return "png";
    if (m.includes("webp")) return "webp";
    if (m.includes("gif")) return "gif";
    return "jpg";
  }

  function slugify(s) {
    return cleanSpaces(s)
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9\-]/g, "")
      .replace(/\-+/g, "-")
      .replace(/^\-|\-$/g, "");
  }

  // ---------------------------
  // Supabase helpers (APP.supabase OR APP.sb)
  // ---------------------------
  function getSB() {
    if (!window.APP) return null;
    return window.APP.supabase || window.APP.sb || null;
  }

  async function ensureSession() {
    const sb = getSB();
    if (!sb) {
      toast(
        "Supabase",
        "APP.supabase no existe. Orden: Supabase CDN → supabaseClient.js → admin-auth.js → admin-gallery.js",
        5200
      );
      return null;
    }

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

  function publicUrlFromPath(path) {
    const sb = getSB();
    const p = cleanSpaces(path);
    if (!sb || !p) return "";
    try {
      const res = sb.storage.from(BUCKET).getPublicUrl(p);
      return res?.data?.publicUrl || "";
    } catch (_) {
      return "";
    }
  }

  // ---------------------------
  // State
  // ---------------------------
  const state = {
    didBind: false,
    didBoot: false,
    didLoadOnce: false,
    busy: false,
    items: [],
    lastLoadAt: 0, // throttle
  };

  function setBusy(on) {
    state.busy = !!on;
    try {
      if (btnNew) btnNew.disabled = !!on;
      if (btnRefresh) btnRefresh.disabled = !!on;
    } catch (_) {}
  }

  // ---------------------------
  // DB ops
  // ---------------------------
  function mapDbRow(r) {
    const row = r || {};
    const image_path = safeStr(row.image_path || "");
    const image_url = safeStr(row.image_url || "") || (image_path ? publicUrlFromPath(image_path) : "");
    return {
      id: row.id,
      type: normType(row.type),
      name: safeStr(row.name || "Foto"),
      tags: Array.isArray(row.tags) ? row.tags.map((t) => safeStr(t)).slice(0, 12) : [],
      image_path,
      image_url,
      target: safeStr(row.target || TARGET_DEFAULT),
      created_at: safeStr(row.created_at || ""),
    };
  }

  async function fetchItems() {
    const sb = getSB();
    if (!sb) throw new Error("APP.supabase no existe.");

    const { data, error } = await sb
      .from(TABLE)
      .select("*")
      .eq("target", TARGET_DEFAULT)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return Array.isArray(data) ? data.map(mapDbRow) : [];
  }

  async function insertDbRow(payload) {
    const sb = getSB();
    if (!sb) throw new Error("APP.supabase no existe.");

    const { data, error } = await sb.from(TABLE).insert(payload).select("*").single();
    if (error) throw error;
    return mapDbRow(data);
  }

  async function deleteDbRow(id) {
    const sb = getSB();
    if (!sb) throw new Error("APP.supabase no existe.");

    const { data, error } = await sb.from(TABLE).delete().eq("id", id).select("id,image_path").single();
    if (error) throw error;
    return data || null;
  }

  async function uploadToStorage(file, path) {
    const sb = getSB();
    if (!sb) throw new Error("APP.supabase no existe.");

    const { error } = await sb.storage.from(BUCKET).upload(path, file, {
      cacheControl: "3600",
      upsert: false,
    });
    if (error) throw error;
    return true;
  }

  async function deleteStorageObject(path) {
    const sb = getSB();
    if (!sb) throw new Error("APP.supabase no existe.");

    const p = cleanSpaces(path);
    if (!p) return;
    const { error } = await sb.storage.from(BUCKET).remove([p]);
    if (error) throw error;
  }

  // ---------------------------
  // Render (table)
  // ---------------------------
  function renderTable() {
    const q = cleanSpaces($("#search")?.value || "").toLowerCase();

    const items = (state.items || []).filter((it) => {
      if (!q) return true;
      return (
        safeStr(it.name).toLowerCase().includes(q) ||
        safeStr(it.type).toLowerCase().includes(q) ||
        (Array.isArray(it.tags) ? it.tags.join(" ").toLowerCase() : "").includes(q)
      );
    });

    tbody.innerHTML = "";

    if (!items.length) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td colspan="6" style="opacity:.85; padding:16px;">
          ${state.didLoadOnce ? "No hay ítems en la galería. Usá <b>“Nuevo ítem”</b>." : "Cargando…"}
        </td>`;
      tbody.appendChild(tr);
      return;
    }

    const frag = document.createDocumentFragment();

    items.forEach((it) => {
      const tr = document.createElement("tr");
      tr.dataset.id = safeStr(it.id || "");

      const imgUrl = it.image_url || "";
      const tags = Array.isArray(it.tags) ? it.tags.slice(0, 6).join(" ") : "";
      const typeLabel = it.type === "cocteles" ? "Cocteles" : "Maridajes";

      tr.innerHTML = `
        <td>${escapeHtml(typeLabel)}</td>
        <td>${escapeHtml(it.name || "—")}</td>
        <td style="max-width:260px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
          ${escapeHtml(tags || "#sin-tags")}
        </td>
        <td>
          ${imgUrl ? `<a class="btn btn--ghost" href="${escapeHtml(imgUrl)}" target="_blank" rel="noopener">Ver</a>` : "—"}
        </td>
        <td>${escapeHtml(fmtShortDate(it.created_at))}</td>
        <td style="display:flex; gap:8px; justify-content:flex-end;">
          <button class="btn btn--ghost" type="button" data-action="copy">Copiar tags</button>
          <button class="btn" type="button" data-action="delete">Eliminar</button>
        </td>
      `;

      frag.appendChild(tr);
    });

    tbody.appendChild(frag);
  }

  // ---------------------------
  // Refresh
  // ---------------------------
  async function refresh(opts) {
    const silent = !!opts?.silent;

    if (state.busy) return;
    setBusy(true);

    try {
      const s = await ensureSession();
      if (!s) return;

      state.items = await fetchItems();
      state.didLoadOnce = true;

      if (!silent) toast("Galería", "Actualizada.", 1200);
      renderTable();
    } catch (err) {
      console.error("[admin-gallery] fetch error:", err);
      state.items = [];
      state.didLoadOnce = true;
      renderTable();

      if (looksLikeRLSError(err)) {
        toast("RLS BLOQUEANDO", "No hay permiso para leer gallery_items. Policy SELECT para admins.", 5200);
      } else {
        toast("Error", "No se pudo cargar la galería. Revisá tabla/policies.", 5200);
      }
    } finally {
      setBusy(false);
    }
  }

  // ---------------------------
  // Modal Nuevo (depurado)
  // ---------------------------
  function lockBodyScroll(on) {
    const body = document.body;
    if (!body) return;

    if (on) {
      if (!body.dataset._prevOverflow) body.dataset._prevOverflow = body.style.overflow || "";
      body.style.overflow = "hidden";
    } else {
      body.style.overflow = body.dataset._prevOverflow || "";
      delete body.dataset._prevOverflow;
    }
  }

  function ensureModal() {
    let m = $("#ecnGalleryModal");
    if (m) return m;

    m = document.createElement("div");
    m.id = "ecnGalleryModal";

    m.style.position = "fixed";
    m.style.inset = "0";
    m.style.background = "rgba(0,0,0,.65)";
    m.style.display = "none";
    m.style.padding = "18px";
    m.style.zIndex = "9999";

    m.style.alignItems = "flex-start";
    m.style.justifyContent = "center";
    m.style.overflowY = "auto";
    m.style.overflowX = "hidden";
    m.style.webkitOverflowScrolling = "touch";

    m.innerHTML = `
      <div id="ecnGalleryCard" style="
        max-width:720px; width:100%;
        margin: 18px auto;
        background: rgba(20,20,20,.96);
        border:1px solid rgba(255,255,255,.10);
        border-radius:16px;
        max-height: calc(100vh - 36px);
        overflow: auto;
        box-shadow: 0 18px 60px rgba(0,0,0,.55);
      ">
        <div style="display:flex; justify-content:space-between; align-items:center; padding:12px 14px; border-bottom:1px solid rgba(255,255,255,.10);">
          <div>
            <p style="margin:0; font-weight:700;">Nuevo ítem</p>
            <p style="margin:4px 0 0; opacity:.8; font-size:.92rem;">Sube una imagen y guardala en galería</p>
          </div>
          <button id="ecnGalleryClose" class="btn" type="button">Cerrar</button>
        </div>

        <form id="ecnGalleryForm" style="
          padding:14px;
          display:grid;
          gap:12px;
          max-height: calc(100vh - 170px);
          overflow:auto;
          -webkit-overflow-scrolling: touch;
        ">
          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
            <div class="field">
              <label class="label" for="ecnGalType">Tipo</label>
              <select class="select" id="ecnGalType" required>
                <option value="maridajes">Maridajes</option>
                <option value="cocteles">Cocteles</option>
              </select>
            </div>
            <div class="field">
              <label class="label" for="ecnGalName">Nombre</label>
              <input class="input" id="ecnGalName" type="text" maxlength="60" placeholder="Ej: Negroni clásico" required />
            </div>
          </div>

          <div class="field">
            <label class="label" for="ecnGalTags">Tags (separados por espacio o coma)</label>
            <input class="input" id="ecnGalTags" type="text" maxlength="140" placeholder="#amargo #citrico #aperitivo" />
          </div>

          <div class="field">
            <label class="label" for="ecnGalFile">Imagen (JPG/PNG/WebP)</label>
            <input class="input" id="ecnGalFile" type="file" accept="image/*" required />
            <div style="opacity:.8; font-size:.9rem; margin-top:6px;">Máximo ~${MAX_MB}MB</div>
          </div>

          <div id="ecnGalPreview" style="
            display:none;
            border:1px solid rgba(255,255,255,.10);
            border-radius:12px;
            overflow:hidden;
            background: rgba(0,0,0,.25);
          ">
            <img id="ecnGalPreviewImg" alt="Preview" style="
              width:100%;
              height: min(46vh, 360px);
              object-fit: contain;
              display:block;
              background: rgba(0,0,0,.18);
            " />
          </div>

          <div style="
            display:flex;
            gap:10px;
            justify-content:flex-end;
            position: sticky;
            bottom: 0;
            padding-top: 10px;
            padding-bottom: 10px;
            background: rgba(20,20,20,.96);
            border-top: 1px solid rgba(255,255,255,.08);
          ">
            <button class="btn" type="button" id="ecnGalReset">Limpiar</button>
            <button class="btn primary" type="submit" id="ecnGalSubmit">Subir</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(m);

    const file = m.querySelector("#ecnGalFile");
    const prevBox = m.querySelector("#ecnGalPreview");
    const prevImg = m.querySelector("#ecnGalPreviewImg");
    let prevUrl = "";

    const resetModal = () => {
      const form = m.querySelector("#ecnGalleryForm");
      form?.reset();

      if (file) file.value = "";

      if (prevUrl) {
        try { URL.revokeObjectURL(prevUrl); } catch (_) {}
      }
      prevUrl = "";

      if (prevBox) prevBox.style.display = "none";
      if (prevImg) prevImg.src = "";
    };

    // ✅ ESC listener: se agrega al abrir y se quita al cerrar
    let escHandler = null;

    const close = () => {
      resetModal();
      m.style.display = "none";
      lockBodyScroll(false);

      if (escHandler) {
        window.removeEventListener("keydown", escHandler);
        escHandler = null;
      }
    };

    m.addEventListener("click", (e) => {
      if (e.target === m) close();
    });

    m.querySelector("#ecnGalleryClose")?.addEventListener("click", close);

    file?.addEventListener("change", () => {
      const f = file.files ? file.files[0] : null;
      if (!f) {
        if (prevUrl) try { URL.revokeObjectURL(prevUrl); } catch (_) {}
        prevUrl = "";
        if (prevBox) prevBox.style.display = "none";
        if (prevImg) prevImg.src = "";
        return;
      }
      if (!/^image\//.test(f.type)) {
        toast("Archivo inválido", "Seleccioná una imagen (JPG/PNG/WebP).");
        file.value = "";
        return;
      }
      if (Number(f.size || 0) > MAX_BYTES) {
        toast("Muy pesada", `La imagen pesa ${humanKB(f.size)}. Usá una menor a ~${MAX_MB}MB.`);
        file.value = "";
        return;
      }
      if (prevUrl) try { URL.revokeObjectURL(prevUrl); } catch (_) {}
      prevUrl = URL.createObjectURL(f);
      if (prevImg) prevImg.src = prevUrl;
      if (prevBox) prevBox.style.display = "block";
    });

    m.querySelector("#ecnGalReset")?.addEventListener("click", () => resetModal());

    m.querySelector("#ecnGalleryForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (state.busy) return;

      const type = normType(m.querySelector("#ecnGalType")?.value || "maridajes");
      const name = cleanSpaces(m.querySelector("#ecnGalName")?.value || "");
      const tags = normTags(m.querySelector("#ecnGalTags")?.value || "");
      const f = file && file.files ? file.files[0] : null;

      if (!name) return toast("Falta nombre", "Poné un nombre para identificar la foto.");
      if (!f) return toast("Falta imagen", "Seleccioná una imagen antes de subir.");

      setBusy(true);
      try {
        const s = await ensureSession();
        if (!s) return;

        const yyyyMm = new Date().toISOString().slice(0, 7);
        const ext = extFromMime(f.type);
        const base = slugify(name) || "foto";
        const path = `${type}/${yyyyMm}/${base}_${Date.now()}.${ext}`;

        await uploadToStorage(f, path);

        const publicUrl = publicUrlFromPath(path);
        const payload = {
          type,
          name,
          tags,
          image_path: path,
          image_url: publicUrl || null,
          target: TARGET_DEFAULT,
        };

        await insertDbRow(payload);

        toast("Listo", "Se agregó el ítem a la galería.", 2000);
        close();
        await refresh({ silent: true });
      } catch (err) {
        console.error("[admin-gallery] upload/insert error:", err);
        if (looksLikeRLSError(err)) {
          toast("RLS", "Bloqueado. Falta policy INSERT en gallery_items y/o policies de Storage.", 5200);
        } else {
          toast("Error", "No se pudo subir. Revisá bucket/policies/RLS.", 5200);
        }
      } finally {
        setBusy(false);
      }
    });

    // Exponer control interno
    m._ecnClose = close;
    m._ecnReset = resetModal;

    // Hook para “open”
    m._ecnOpen = () => {
      // reset siempre antes de mostrar
      try { resetModal(); } catch (_) {}

      lockBodyScroll(true);
      m.style.display = "flex";
      m.scrollTop = 0;

      // add ESC
      if (!escHandler) {
        escHandler = (e) => {
          if (e.key === "Escape" && m.style.display !== "none") close();
        };
        window.addEventListener("keydown", escHandler);
      }

      try {
        m.querySelector("#ecnGalleryCard")?.scrollIntoView({ block: "start" });
      } catch (_) {}
    };

    return m;
  }

  function openNewModal() {
    const m = ensureModal();
    m._ecnOpen?.();
  }

  // ---------------------------
  // Actions (table)
  // ---------------------------
  async function onTableClick(e) {
    const btn = e.target && e.target.closest ? e.target.closest("[data-action]") : null;
    if (!btn) return;

    const tr = btn.closest("tr");
    const id = tr ? safeStr(tr.dataset.id || "") : "";
    if (!id) return;

    const it = (state.items || []).find((x) => safeStr(x.id) === id);
    if (!it) return;

    const action = safeStr(btn.dataset.action || "");

    if (action === "copy") {
      const text = Array.isArray(it.tags) && it.tags.length ? it.tags.join(" ") : "";
      if (!text) return toast("Sin tags", "Este ítem no tiene tags para copiar.");
      navigator.clipboard?.writeText(text).then(
        () => toast("Copiado", "Tags copiados al portapapeles."),
        () => toast("Copiar", "No pude acceder al portapapeles.")
      );
      return;
    }

    if (action === "delete") {
      const ok = window.confirm(`Eliminar este ítem?\n\n${it.name || "Sin nombre"}\n\n(Se borra de Supabase)`);
      if (!ok) return;

      setBusy(true);
      try {
        const s = await ensureSession();
        if (!s) return;

        const deleted = await deleteDbRow(it.id);
        const p = deleted?.image_path || it.image_path;

        if (p) {
          try {
            await deleteStorageObject(p);
          } catch (e2) {
            console.warn("[admin-gallery] storage delete fail:", e2);
          }
        }

        toast("Eliminado", "Se eliminó correctamente.", 1800);
        await refresh({ silent: true });
      } catch (err) {
        console.error("[admin-gallery] delete error:", err);
        if (looksLikeRLSError(err)) {
          toast("RLS", "Bloqueado. Falta policy DELETE en gallery_items y/o Storage.", 5200);
        } else {
          toast("Error", "No se pudo eliminar. Revisá policies.", 5200);
        }
      } finally {
        setBusy(false);
      }
    }
  }

  // ---------------------------
  // Bind / Load
  // ---------------------------
  function bindOnce() {
    if (state.didBind) return;
    state.didBind = true;

    btnRefresh?.addEventListener("click", () => refresh({ silent: false }));
    btnNew?.addEventListener("click", openNewModal);

    tbody?.addEventListener("click", onTableClick);

    $("#search")?.addEventListener("input", () => renderTable());
  }

  async function ensureLoaded(force) {
    bindOnce();

    const isHidden = !!$("#tab-gallery")?.hidden;
    if (!force && isHidden) return;

    const now = Date.now();
    if (!force && now - state.lastLoadAt < 600) return;
    if (force && now - state.lastLoadAt < 250) return;
    state.lastLoadAt = now;

    if (state.didLoadOnce && !force) {
      renderTable();
      return;
    }

    await refresh({ silent: true });
  }

  // ---------------------------
  // Boot: esperar admin:ready
  // ---------------------------
  function boot() {
    if (state.didBoot) return;
    state.didBoot = true;

    console.log("[admin-gallery] boot", { VERSION, TABLE, BUCKET });

    const wake = () => {
      bindOnce();

      window.addEventListener("admin:tab", (e) => {
        const t = e?.detail?.tab;
        if (t === "gallery") ensureLoaded(true);
      });

      try {
        if ($("#tab-gallery") && $("#tab-gallery").hidden === false) ensureLoaded(true);
      } catch (_) {}
    };

    if (window.APP && APP.__adminReady) wake();
    else window.addEventListener("admin:ready", wake, { once: true });
  }

  boot();

  // API debug
  window.ECN_ADMIN_GALLERY = {
    refresh: () => refresh({ silent: false }),
    openNewModal,
    ensureLoaded: () => ensureLoaded(true),
  };
})();
