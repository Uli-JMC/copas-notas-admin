"use strict";

/**
 * admin-media.js ✅ (Supabase Storage + media_items bridge) — v2026-02-18
 *
 * Objetivo:
 * - Subir archivos a Storage (bucket)
 * - Guardar la referencia en DB: media_items (source of truth)
 *
 * Soporta:
 * - target='event' con event_id + folder:
 *    - event_img_desktop
 *    - event_img_mobile
 *    - event_more_img
 *
 * Requiere:
 * - window.APP.supabase listo
 * - Tabla media_items con (target, event_id, folder, path, public_url, name)
 * - Unique / upsert por (event_id, folder) (como ya definiste)
 *
 * IDs esperados en tu HTML (si no existen, no rompe; solo algunas funciones no aparecerán):
 * - #mediaEventSelect (select con lista de eventos)  [opcional]
 * - #mediaFolderSelect (select de folder)            [opcional]
 * - #mediaFile (input type=file)                    [recomendado]
 * - #mediaUploadBtn (button)                        [opcional]
 * - #mediaList (contenedor lista)                   [recomendado]
 * - #mediaNote (texto de estado)                    [opcional]
 *
 * Si tu HTML usa otros IDs, decime cuáles y te lo adapto 1:1.
 */

(function () {
  const VERSION = "2026-02-18.1";

  // =========================
  // Config
  // =========================
  const STORAGE_BUCKET = "media"; // ⬅️ cambia si tu bucket se llama distinto
  const MEDIA_TABLE = "media_items";
  const EVENTS_TABLE = "events";

  const EVENT_FOLDERS = [
    { value: "event_img_desktop", label: "Evento · Imagen Desktop (hero)" },
    { value: "event_img_mobile", label: "Evento · Imagen Mobile (opcional)" },
    { value: "event_more_img", label: "Evento · “Ver más info” (modal)" },
  ];

  // =========================
  // DOM helpers
  // =========================
  const $ = (sel, root = document) => root.querySelector(sel);

  function escapeHtml(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function clean(s) {
    return String(s ?? "").trim();
  }

  function hasSB() {
    return !!(window.APP && APP.supabase);
  }

  function sb() {
    return APP.supabase;
  }

  function setNote(msg) {
    const el = $("#mediaNote");
    if (!el) return;
    el.textContent = String(msg || "");
  }

  function toast(title, msg, timeoutMs = 3200) {
    try {
      if (window.APP && typeof APP.toast === "function") return APP.toast(title, msg, timeoutMs);
    } catch (_) {}
    try {
      if (typeof window.toast === "function") return window.toast(title, msg, timeoutMs);
    } catch (_) {}

    // fallback mínimo
    console.log(`[toast] ${title}: ${msg}`);
  }

  function isRLSError(err) {
    const m = String(err?.message || "").toLowerCase();
    const code = String(err?.code || "").toLowerCase();
    return (
      code === "42501" ||
      m.includes("42501") ||
      m.includes("rls") ||
      m.includes("permission") ||
      m.includes("not allowed") ||
      m.includes("row level security") ||
      m.includes("violates row-level security") ||
      m.includes("new row violates row-level security")
    );
  }

  // =========================
  // State
  // =========================
  const state = {
    ready: false,
    events: [],
    eventId: "",
    folder: "event_img_desktop",
    busy: false,
    items: [], // media_items for selected event
  };

  function withLock(fn) {
    return async (...args) => {
      if (state.busy) return;
      state.busy = true;
      try {
        return await fn(...args);
      } finally {
        state.busy = false;
      }
    };
  }

  // =========================
  // Storage helpers
  // =========================
  function guessExt(filename) {
    const name = String(filename || "").trim();
    const i = name.lastIndexOf(".");
    if (i <= -1) return "";
    return name.slice(i + 1).toLowerCase();
  }

  function buildStoragePath({ target, folder, eventId, filename }) {
    // ruta estable (recomendado): target/event/<eventId>/<folder>/<timestamp>_<filename>
    const ts = Date.now();
    const safeName = String(filename || "file").replace(/[^\w.\-]+/g, "_");
    return `${target}/event/${eventId}/${folder}/${ts}_${safeName}`;
  }

  async function uploadToStorage(file, path) {
    const { data, error } = await sb().storage.from(STORAGE_BUCKET).upload(path, file, {
      upsert: true,
      cacheControl: "3600",
      contentType: file.type || undefined,
    });
    if (error) throw error;
    return data; // { path, ... }
  }

  function getPublicUrl(path) {
    const res = sb().storage.from(STORAGE_BUCKET).getPublicUrl(path);
    return res?.data?.publicUrl || "";
  }

  async function removeFromStorage(path) {
    // path dentro del bucket
    const { error } = await sb().storage.from(STORAGE_BUCKET).remove([path]);
    if (error) throw error;
  }

  // =========================
  // DB: events list
  // =========================
  async function fetchEvents() {
    const { data, error } = await sb()
      .from(EVENTS_TABLE)
      .select("id,title,month_key,type,created_at")
      .order("created_at", { ascending: false });

    if (error) throw error;
    return Array.isArray(data) ? data : [];
  }

  function renderEventSelect() {
    const sel = $("#mediaEventSelect");
    if (!sel) return;

    sel.innerHTML = "";

    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = "Seleccionar evento…";
    sel.appendChild(opt0);

    state.events.forEach((ev) => {
      const opt = document.createElement("option");
      opt.value = String(ev.id);
      opt.textContent = `${ev.title || "Evento"} • ${(ev.month_key || "—").toUpperCase()} • ${ev.type || "—"}`;
      sel.appendChild(opt);
    });

    if (state.eventId) sel.value = state.eventId;
  }

  // =========================
  // UI: folder select
  // =========================
  function renderFolderSelect() {
    const sel = $("#mediaFolderSelect");
    if (!sel) return;

    sel.innerHTML = "";
    EVENT_FOLDERS.forEach((f) => {
      const opt = document.createElement("option");
      opt.value = f.value;
      opt.textContent = f.label;
      sel.appendChild(opt);
    });

    sel.value = state.folder;
  }

  // =========================
  // DB: media_items (list/upsert/delete)
  // =========================
  async function fetchMediaItemsForEvent(eventId) {
    const eid = clean(eventId);
    if (!eid) return [];

    const { data, error } = await sb()
      .from(MEDIA_TABLE)
      .select("id,target,folder,name,path,public_url,created_at,updated_at,event_id")
      .eq("target", "event")
      .eq("event_id", eid)
      .order("updated_at", { ascending: false });

    if (error) throw error;
    return Array.isArray(data) ? data : [];
  }

  async function upsertMediaItem({ eventId, folder, path, publicUrl }) {
    const eid = clean(eventId);
    const f = clean(folder);
    const p = clean(path);
    const u = clean(publicUrl);

    if (!eid || !f || !p || !u) throw new Error("Faltan datos para upsert de media_items.");

    const payload = {
      target: "event",
      event_id: eid,
      folder: f,
      name: f,
      path: p,
      public_url: u,
    };

    // tu unique index está pensado para esto:
    // onConflict: "event_id,folder"
    const { data, error } = await sb()
      .from(MEDIA_TABLE)
      .upsert(payload, { onConflict: "event_id,folder" })
      .select("id,target,folder,name,path,public_url,created_at,updated_at,event_id")
      .single();

    if (error) throw error;
    return data;
  }

  async function deleteMediaItemLink({ eventId, folder }) {
    const eid = clean(eventId);
    const f = clean(folder);
    if (!eid || !f) return;

    const { error } = await sb()
      .from(MEDIA_TABLE)
      .delete()
      .eq("target", "event")
      .eq("event_id", eid)
      .eq("folder", f);

    if (error) throw error;
  }

  // =========================
  // Render list
  // =========================
  function renderMediaList() {
    const list = $("#mediaList");
    if (!list) return;

    if (!state.eventId) {
      list.innerHTML = `<div class="emptyMonth">Seleccioná un evento para ver su media.</div>`;
      return;
    }

    if (!state.items.length) {
      list.innerHTML = `<div class="emptyMonth">Sin media registrada para este evento.</div>`;
      return;
    }

    const byFolder = {};
    state.items.forEach((it) => {
      const f = clean(it.folder);
      byFolder[f] = it;
    });

    const rows = EVENT_FOLDERS.map((f) => {
      const it = byFolder[f.value];
      const url = clean(it?.public_url || "");
      const path = clean(it?.path || "");

      return `
        <div class="item" data-folder="${escapeHtml(f.value)}" style="gap:12px; align-items:flex-start;">
          <div style="flex:1 1 auto;">
            <p class="itemTitle">${escapeHtml(f.label)}</p>
            <p class="itemMeta" style="word-break:break-all;">
              ${url ? escapeHtml(url) : `<span style="opacity:.7;">(vacío)</span>`}
            </p>
            ${path ? `<p class="itemMeta" style="opacity:.75; word-break:break-all;">Path: ${escapeHtml(path)}</p>` : ``}
          </div>

          <div style="display:flex; gap:8px; flex:0 0 auto; align-items:center;">
            <button class="btn sm" type="button" data-act="copy" ${url ? "" : "disabled"}>Copiar URL</button>
            <button class="btn sm" type="button" data-act="open" ${url ? "" : "disabled"}>Abrir</button>
            <button class="btn sm danger" type="button" data-act="unlink" ${it ? "" : "disabled"}>Desvincular</button>
          </div>
        </div>
      `;
    }).join("");

    list.innerHTML = rows;

    // Bind actions
    list.querySelectorAll("button[data-act]").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        const b = e.currentTarget;
        const row = b.closest("[data-folder]");
        const folder = row?.getAttribute("data-folder") || "";
        const act = b.getAttribute("data-act") || "";

        const it = state.items.find((x) => clean(x.folder) === clean(folder));
        const url = clean(it?.public_url || "");
        const path = clean(it?.path || "");

        if (act === "copy") {
          if (!url) return;
          try {
            await navigator.clipboard.writeText(url);
            toast("Copiado", "URL copiada al portapapeles.", 1400);
          } catch (_) {
            toast("Copiar", "No se pudo copiar. Copiala manualmente.");
          }
        }

        if (act === "open") {
          if (!url) return;
          window.open(url, "_blank", "noopener,noreferrer");
        }

        if (act === "unlink") {
          if (!state.eventId || !folder) return;
          const ok = window.confirm(`Desvincular media:\n\n${folder}\n\nEsto borra la fila en media_items. (El archivo en Storage puede quedarse.)`);
          if (!ok) return;

          await unlinkFlow({ folder, path });
        }
      });
    });
  }

  // =========================
  // Load for selected event
  // =========================
  const loadSelectedEventMedia = withLock(async function () {
    if (!state.eventId) {
      state.items = [];
      renderMediaList();
      return;
    }

    try {
      setNote("Cargando media del evento…");
      const items = await fetchMediaItemsForEvent(state.eventId);
      state.items = items;
      renderMediaList();
      setNote("");
    } catch (err) {
      console.error(err);
      if (isRLSError(err)) {
        toast("RLS", "No se pudo leer media_items. Falta policy SELECT para admins.", 5200);
      } else {
        toast("Error", "No se pudo cargar media del evento. Revisá consola.", 5200);
      }
      setNote("No se pudo cargar media_items.");
    }
  });

  // =========================
  // Upload flow (Storage + media_items)
  // =========================
  const uploadFlow = withLock(async function () {
    if (!hasSB()) {
      toast("Supabase", "APP.supabase no está listo.");
      return;
    }

    const eid = clean(state.eventId || $("#mediaEventSelect")?.value);
    if (!eid) {
      toast("Falta evento", "Seleccioná un evento primero.");
      return;
    }

    const folderSel = $("#mediaFolderSelect");
    const folder = clean(folderSel?.value || state.folder || "event_img_desktop");

    const fileInput = $("#mediaFile");
    const file = fileInput?.files?.[0];
    if (!file) {
      toast("Falta archivo", "Seleccioná un archivo para subir.");
      return;
    }

    try {
      setNote("Subiendo archivo a Storage…");

      const path = buildStoragePath({
        target: "event",
        folder,
        eventId: eid,
        filename: file.name || `file.${guessExt(file.name) || "bin"}`,
      });

      await uploadToStorage(file, path);
      const publicUrl = getPublicUrl(path);

      setNote("Guardando referencia en media_items…");
      await upsertMediaItem({ eventId: eid, folder, path, publicUrl });

      toast("Listo", "Subido y guardado en media_items.", 1600);

      // reset input
      if (fileInput) fileInput.value = "";

      // refrescar
      state.eventId = eid;
      state.folder = folder;
      await loadSelectedEventMedia();

      setNote("");
    } catch (err) {
      console.error(err);
      if (isRLSError(err)) {
        toast("RLS", "Bloqueado por policies (Storage o media_items).", 5200);
      } else {
        toast("Error", String(err?.message || err || "Error al subir."), 5200);
      }
      setNote("Error al subir.");
    }
  });

  // =========================
  // Unlink flow (delete DB row + optional delete storage)
  // =========================
  const unlinkFlow = withLock(async function ({ folder, path }) {
    const eid = clean(state.eventId);
    const f = clean(folder);
    const p = clean(path);

    if (!eid || !f) return;

    try {
      setNote("Desvinculando…");
      await deleteMediaItemLink({ eventId: eid, folder: f });

      // Preguntar si quieres borrar el archivo del bucket
      if (p) {
        const remove = window.confirm("¿También querés borrar el archivo del Storage (bucket)?\n\nOK = borrar archivo\nCancelar = solo desvincular");
        if (remove) {
          try {
            await removeFromStorage(p);
          } catch (e) {
            console.warn("No se pudo borrar en Storage:", e);
            toast("Aviso", "Se desvinculó, pero no se pudo borrar del bucket.", 4200);
          }
        }
      }

      toast("Listo", "Media desvinculada.", 1400);
      await loadSelectedEventMedia();
      setNote("");
    } catch (err) {
      console.error(err);
      if (isRLSError(err)) {
        toast("RLS", "No se pudo eliminar en media_items. Falta policy DELETE.", 5200);
      } else {
        toast("Error", String(err?.message || err || "Error al desvincular."), 5200);
      }
      setNote("Error al desvincular.");
    }
  });

  // =========================
  // Wiring
  // =========================
  function bind() {
    // event select
    $("#mediaEventSelect")?.addEventListener("change", async (e) => {
      state.eventId = clean(e.target.value);
      await loadSelectedEventMedia();
    });

    // folder select
    $("#mediaFolderSelect")?.addEventListener("change", (e) => {
      state.folder = clean(e.target.value);
    });

    // upload btn
    $("#mediaUploadBtn")?.addEventListener("click", (e) => {
      e.preventDefault();
      uploadFlow();
    });

    // allow upload on file change (opcional)
    $("#mediaFile")?.addEventListener("change", () => {
      // no auto-upload por defecto (evita accidentes)
      // si querés auto-upload, descomentá:
      // uploadFlow();
    });
  }

  // =========================
  // Boot
  // =========================
  const boot = withLock(async function () {
    console.log("[admin-media.js] boot", { VERSION });

    if (!hasSB()) {
      setNote("Supabase no está listo. Cargá supabaseClient.js antes.");
      toast("Supabase", "APP.supabase no está listo.");
      return;
    }

    bind();
    renderFolderSelect();

    try {
      setNote("Cargando eventos…");
      state.events = await fetchEvents();
      renderEventSelect();
      setNote("");

      // Si ya hay seleccionado (por HTML), tomarlo y cargar
      const pre = clean($("#mediaEventSelect")?.value || "");
      if (pre) {
        state.eventId = pre;
        await loadSelectedEventMedia();
      } else {
        renderMediaList();
      }
    } catch (err) {
      console.error(err);
      if (isRLSError(err)) {
        toast("RLS", "No se pudieron leer eventos. Falta policy SELECT para admins en events.", 5200);
        setNote("RLS bloquea lectura de events.");
      } else {
        toast("Error", "No se pudieron cargar eventos. Revisá consola.", 5200);
        setNote("Error cargando eventos.");
      }
    }
  });

  // ejecuta cuando admin esté listo (si usás el evento), si no, igual intenta
  if (window.APP && APP.__adminReady) boot();
  else window.addEventListener("admin:ready", boot, { once: true });

})();
