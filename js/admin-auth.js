/* ============================================================
   js/admin-auth.js ✅ PRO+DIAGNOSTIC (ESTABLE)
   - Gate robusto (sesión + isAdmin)
   - Emite admin:ready UNA vez y re-emite para listeners tardíos
   - Logout SIEMPRE funciona + limpia storage
   - Expone APP.__ensureAdmin() para debug sin recargar
============================================================ */
(function () {
  "use strict";

  const VERSION = "2026-01-18.1";
  const log = (...a) => { try { console.log("[admin-auth]", ...a); } catch (_) {} };
  const warn = (...a) => { try { console.warn("[admin-auth]", ...a); } catch (_) {} };
  const error = (...a) => { try { console.error("[admin-auth]", ...a); } catch (_) {} };

  const qs = (s) => document.querySelector(s);

  function toast(t, m, ms) {
    try {
      if (window.APP && typeof APP.toast === "function") return APP.toast(t, m, ms);
      log("[toast]", t, m);
    } catch (_) {}
  }

  if (!window.APP || !APP.supabase) {
    error("APP.supabase no existe. Orden: supabase-js@2 -> supabaseClient.js -> admin-auth.js");
    return;
  }

  const body = document.body;
  const dataPage = (body && body.getAttribute("data-page")) || "";
  const loginForm = qs("#loginForm");
  const logoutBtn = qs("#logoutBtn");

  const isLogin =
    dataPage === "admin-login" ||
    !!loginForm ||
    /admin\s*login/i.test(document.title || "");

  const isAdminPage =
    dataPage === "admin" ||
    !!qs("#appPanel") ||
    /admin\s*\|/i.test(document.title || "");

  // -------------------------
  // Ready emitter (single-shot + replay)
  // -------------------------
  function emitReady(detail) {
    if (!window.APP) window.APP = {};

    // guarda el detalle para "replay"
    APP.__adminReadyDetail = detail || APP.__adminReadyDetail || {};
    APP.__adminReady = true;

    if (APP.__adminReadyFired) return;
    APP.__adminReadyFired = true;

    window.dispatchEvent(new CustomEvent("admin:ready", { detail: APP.__adminReadyDetail }));
    log("✅ admin:ready", APP.__adminReadyDetail);
  }

  // replay: si un módulo se suscribe tarde, puede pedir el replay
  window.addEventListener("admin:ready:replay", function () {
    if (APP.__adminReady) {
      window.dispatchEvent(new CustomEvent("admin:ready", { detail: APP.__adminReadyDetail || {} }));
      log("↩︎ replay admin:ready", APP.__adminReadyDetail);
    }
  });

  async function getSessionSafe() {
    try {
      if (typeof APP.getSession === "function") return await APP.getSession();
      const res = await APP.supabase.auth.getSession();
      return res?.data?.session || null;
    } catch (_) {
      return null;
    }
  }

  async function signOutHard() {
    try { await APP.supabase.auth.signOut({ scope: "local" }); } catch (_) {
      try { await APP.supabase.auth.signOut(); } catch (_) {}
    }
    try { localStorage.removeItem("ecn_admin_sb_auth"); } catch (_) {}
  }

  function goLogin() {
    try { location.replace("./admin-login.html"); }
    catch (_) { location.href = "./admin-login.html"; }
  }

  async function ensureAdminOrRedirect() {
    log("boot", { VERSION, isLogin, isAdminPage, dataPage, title: document.title });

    const session = await getSessionSafe();
    if (!session || !session.user) {
      warn("no session");
      if (isAdminPage) goLogin();
      return null;
    }

    let ok = false;
    try {
      ok = await APP.isAdmin();
    } catch (e) {
      ok = false;
      warn("isAdmin() threw:", e?.message || e);
    }

    if (!ok) {
      warn("NOT ADMIN - blocking", { uid: session.user.id, email: session.user.email });
      toast("Permisos", "Tu usuario NO está autorizado como admin.", 5000);
      await signOutHard();
      if (isAdminPage) goLogin();
      return null;
    }

    log("session OK", { userId: session.user.id, email: session.user.email });
    emitReady({ userId: session.user.id, email: session.user.email });
    return session;
  }

  // expone para debug sin recargar
  APP.__ensureAdmin = ensureAdminOrRedirect;

  async function doLogout() {
    try {
      toast("Sesión", "Cerrando sesión…", 1200);
      await signOutHard();
    } finally {
      goLogin();
    }
  }

  if (logoutBtn && !logoutBtn.dataset.wired) {
    logoutBtn.dataset.wired = "1";
    logoutBtn.addEventListener("click", doLogout);
    log("logout wired");
  }

  // Auth events (reduce “recargar para que funcione”)
  try {
    APP.supabase.auth.onAuthStateChange(function (event, session) {
      log("auth event:", event, !!session);
      if (event === "SIGNED_OUT") {
        APP.__adminReady = false;
        APP.__adminReadyFired = false;
        if (isAdminPage) goLogin();
      }
      if ((event === "SIGNED_IN" || event === "TOKEN_REFRESHED") && isAdminPage) {
        ensureAdminOrRedirect();
      }
    });
  } catch (_) {}

  // Login submit
  async function onLoginSubmit(e) {
    e.preventDefault();

    const email = (qs("#adminEmail")?.value || "").trim();
    const password = (qs("#adminPass")?.value || "");

    if (!email || !email.includes("@")) return toast("Validación", "Ingresá un correo válido.", 2400);
    if (!password || password.length < 6) return toast("Validación", "Contraseña mínima: 6 caracteres.", 2400);

    toast("Ingresando…", "Validando credenciales…", 1500);

    const res = await APP.supabase.auth.signInWithPassword({ email, password });
    if (res?.error) {
      toast("Error", res.error.message || "No se pudo iniciar sesión.", 5000);
      return;
    }

    const ok = await APP.isAdmin();
    if (!ok) {
      toast("Permisos", "Tu usuario no está autorizado como admin.", 6000);
      await signOutHard();
      return;
    }

    location.replace("./admin.html");
  }

  // Boot
  if (isLogin) {
    if (loginForm && !loginForm.dataset.wired) {
      loginForm.dataset.wired = "1";
      loginForm.addEventListener("submit", onLoginSubmit);
      log("login wired");
    }

    // si ya está logueado y es admin -> admin.html
    ensureAdminOrRedirect().then(function (s) {
      if (s) location.replace("./admin.html");
    });
    return;
  }

  if (isAdminPage) {
    ensureAdminOrRedirect();
  }
})();
