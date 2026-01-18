/* ============================================================
   js/supabaseClient.js
   Cliente Supabase (ADMIN) ✅ PRO+DIAG 2026-01
   - Usa publishable/anon key (frontend) + RLS + policies
   - Storage separado del sitio público (evita choque de sesión)
   - Helpers claros para auth + admin gate (public.admins)
   - Dispara evento "supabase:ready" cuando está listo
============================================================ */
(function () {
  "use strict";

  // ------------------------------------------------------------
  // Config
  // ------------------------------------------------------------
  var SUPABASE_URL = "https://zthwbzaekdqrbpplvkmy.supabase.co";

  // ✅ Publishable/Anon key (frontend, protegido por RLS)
  var SUPABASE_ANON_KEY = "sb_publishable_rYM5ObkmS_YZNkaWGu9HOw_Gr2TN1mu";

  // Storage independiente del sitio público
  var ADMIN_STORAGE_KEY = "ecn_admin_sb_auth";

  function log() {
    try {
      console.log.apply(console, arguments);
    } catch (_) {}
  }

  function warn() {
    try {
      console.warn.apply(console, arguments);
    } catch (_) {}
  }

  function err() {
    try {
      console.error.apply(console, arguments);
    } catch (_) {}
  }

  function hardFail(msg) {
    err("[supabaseClient][ADMIN]", msg);
  }

  // ------------------------------------------------------------
  // Guard: Supabase CDN
  // ------------------------------------------------------------
  if (!window.supabase || !window.supabase.createClient) {
    hardFail("Supabase CDN no cargado. Agregá supabase-js@2 antes de supabaseClient.js");
    return;
  }

  // Evita doble inicialización
  window.APP = window.APP || {};
  if (window.APP.supabase) return;

  // ------------------------------------------------------------
  // Client
  // ------------------------------------------------------------
  window.APP.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,

      // Admin panel NO procesa sesión desde URL (evita “tokens raros”)
      detectSessionInUrl: false,

      // Storage separado
      storageKey: ADMIN_STORAGE_KEY,
    },
  });

  // Alias corto
  window.APP.sb = window.APP.supabase;

  // Debug / diagnóstico
  window.APP.supabaseUrl = SUPABASE_URL;

  // ✅ Ready flag + event (útil para módulos que quieran esperar)
  window.APP.sbReady = true;
  try {
    window.dispatchEvent(new Event("supabase:ready"));
  } catch (_) {}

  // ------------------------------------------------------------
  // Helpers (GENÉRICOS)
  // ------------------------------------------------------------
  window.APP.getSession = async function () {
    try {
      var res = await window.APP.supabase.auth.getSession();
      return res && res.data ? res.data.session : null;
    } catch (e) {
      warn("[supabaseClient][ADMIN] getSession() failed:", e);
      return null;
    }
  };

  window.APP.getUser = async function () {
    try {
      var res = await window.APP.supabase.auth.getUser();
      return res && res.data ? res.data.user : null;
    } catch (e) {
      warn("[supabaseClient][ADMIN] getUser() failed:", e);
      return null;
    }
  };

  window.APP.requireSession = async function () {
    var session = await window.APP.getSession();
    if (!session || !session.user) return null;
    return session;
  };

  // ------------------------------------------------------------
  // ADMIN GATE (tabla public.admins)
  // public.admins: (user_id uuid PK)
  // ------------------------------------------------------------
  function looksLikeRLSError(e) {
    var m = String((e && e.message) || "").toLowerCase();
    var code = String((e && e.code) || "").toLowerCase();
    return (
      code === "42501" ||
      m.includes("42501") ||
      m.includes("rls") ||
      m.includes("permission") ||
      m.includes("not allowed") ||
      m.includes("row level security") ||
      m.includes("violates row-level security")
    );
  }

  window.APP.isAdmin = async function () {
    // 1) session/user
    var user = await window.APP.getUser();
    if (!user || !user.id) {
      log("[supabaseClient][ADMIN] isAdmin(): no user session");
      return false;
    }

    // 2) check row in admins
    try {
      var res = await window.APP.supabase
        .from("admins")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (res && res.error) {
        // 🔥 Diagnóstico real (muy útil cuando falta policy SELECT)
        if (looksLikeRLSError(res.error)) {
          warn(
            "[supabaseClient][ADMIN] isAdmin(): RLS bloquea SELECT en 'admins'. Necesitás policy SELECT para authenticated."
          );
        } else {
          warn("[supabaseClient][ADMIN] isAdmin(): error:", res.error);
        }
        return false;
      }

      return !!(res && res.data);
    } catch (e) {
      warn("[supabaseClient][ADMIN] isAdmin() exception:", e);
      return false;
    }
  };

  // ------------------------------------------------------------
  // (Opcional) Helper rápido para debug en consola
  // ------------------------------------------------------------
  window.APP.diag = async function () {
    var s = await window.APP.getSession();
    var u = await window.APP.getUser();
    var a = await window.APP.isAdmin();
    return {
      supabaseUrl: window.APP.supabaseUrl,
      hasClient: !!window.APP.supabase,
      hasSession: !!s,
      userId: u ? u.id : null,
      email: u ? u.email : null,
      isAdmin: a,
      storageKey: ADMIN_STORAGE_KEY,
    };
  };
})();
