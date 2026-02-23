"use strict";

/**
 * admin-auth.js — Entre Copas & Notas ✅ PRO (2026-02-22)
 * - Controla gate de autenticación para /admin.html
 * - Muestra/Oculta: #authGate y #appPanel (ambos existen en tu admin.html)
 * - Expone APP.__adminReady y dispara "admin:ready" (window + document)
 * - Logout con #logoutBtn
 *
 * Requisitos:
 * - CDN supabase-js@2
 * - ./js/supabaseClient.js debe crear window.APP.supabase (o APP.sb)
 */

(function () {
  const VERSION = "2026-02-22.auth.gate.pro.1";
  const $ = (sel, root = document) => root.querySelector(sel);

  const isAdminPage =
    document.body?.dataset?.page === "admin" || /admin\.html(\?|#|$)/i.test(location.pathname);

  // Si no es admin, no hacemos gate (ej: login.html)
  if (!isAdminPage) return;

  const authGate = $("#authGate");
  const appPanel = $("#appPanel");
  const logoutBtn = $("#logoutBtn");

  function getSB() {
    if (!window.APP) return null;
    return window.APP.supabase || window.APP.sb || null;
  }

  function dispatchAdminReady() {
    const ev = new CustomEvent("admin:ready", { detail: { ok: true, version: VERSION } });
    try { window.dispatchEvent(ev); } catch (_) {}
    try { document.dispatchEvent(new CustomEvent("admin:ready", { detail: { ok: true, version: VERSION } })); } catch (_) {}
  }

  function showGate() {
    if (authGate) authGate.hidden = false;
    if (appPanel) appPanel.hidden = true;
  }

  function showApp() {
    if (authGate) authGate.hidden = true;
    if (appPanel) appPanel.hidden = false;
  }

  async function ensureSession() {
    const sb = getSB();
    if (!sb) return null;
    try {
      const res = await sb.auth.getSession();
      return res?.data?.session || null;
    } catch (_) {
      return null;
    }
  }

  async function logout() {
    const sb = getSB();
    if (!sb) return;
    try {
      await sb.auth.signOut();
    } catch (_) {}
    // Deja gate visible por si el usuario queda en admin.html
    showGate();
    // Opcional: redirigir a login
    // location.href = "./login.html";
  }

  async function boot() {
    console.log("[admin-auth] boot", { VERSION });

    // estado inicial: todo oculto si existe gate/app
    // (tu HTML los trae con hidden)
    showGate();

    const sb = getSB();
    if (!sb) {
      // Si falta supabase client, no podemos continuar
      // Dejamos gate visible
      console.warn("[admin-auth] APP.supabase no existe. Revisa orden de scripts.");
      return;
    }

    const session = await ensureSession();
    if (!session) {
      showGate();
      // Si querés redirigir automático:
      // location.href = "./login.html";
      return;
    }

    // Sesión OK
    showApp();

    // “admin listo” para módulos (dates/regs/gallery/promos)
    window.APP = window.APP || {};
    window.APP.__adminReady = true;
    dispatchAdminReady();

    // Logout
    if (logoutBtn) logoutBtn.addEventListener("click", logout);

    // Si la sesión cambia (logout desde otro tab)
    try {
      sb.auth.onAuthStateChange((_event, newSession) => {
        if (!newSession) showGate();
      });
    } catch (_) {}
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();