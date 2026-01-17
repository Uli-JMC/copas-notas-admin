/* ============================================================
   js/supabaseClient.js
   Cliente Supabase (ADMIN) ✅ FINAL
   - Usa ANON key (seguro con RLS + policies)
   - Storage separado del sitio público
   - Helpers claros para auth + admin check
============================================================ */
(function () {
  "use strict";

  // ------------------------------------------------------------
  // Config
  // ------------------------------------------------------------
  var SUPABASE_URL = "https://zthwbzaekdqrbpplvkmy.supabase.co";

  // ✅ ANON key (frontend, protegido por RLS)
  var SUPABASE_ANON_KEY = "sb_publishable_rYM5ObkmS_YZNkaWGu9HOw_Gr2TN1mu";

  // Storage independiente del sitio público
  var ADMIN_STORAGE_KEY = "ecn_admin_sb_auth";

  function hardFail(msg) {
    try {
      console.error("[supabaseClient][ADMIN]", msg);
    } catch (_) {}
  }

  // ------------------------------------------------------------
  // Guard: Supabase CDN
  // ------------------------------------------------------------
  // Requiere:
  // <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
  if (!window.supabase || !window.supabase.createClient) {
    hardFail("Supabase CDN no cargado. Agregá supabase-js@2 antes de supabaseClient.js");
    return;
  }

  // Evita doble inicialización
  if (window.APP && window.APP.supabase) return;

  window.APP = window.APP || {};

  // ------------------------------------------------------------
  // Client
  // ------------------------------------------------------------
  window.APP.supabase = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,

        // Admin panel NO procesa sesión desde URL
        detectSessionInUrl: false,

        // Storage separado
        storageKey: ADMIN_STORAGE_KEY,
      },
    }
  );

  // Alias corto
  window.APP.sb = window.APP.supabase;

  // Debug / diagnóstico
  window.APP.supabaseUrl = SUPABASE_URL;

  // ------------------------------------------------------------
  // Helpers (GENÉRICOS – sin lógica de negocio)
  // ------------------------------------------------------------

  // Devuelve session o null
  window.APP.getSession = async function () {
    try {
      var res = await window.APP.supabase.auth.getSession();
      return res && res.data ? res.data.session : null;
    } catch (_) {
      return null;
    }
  };

  // Devuelve user o null
  window.APP.getUser = async function () {
    try {
      var res = await window.APP.supabase.auth.getUser();
      return res && res.data ? res.data.user : null;
    } catch (_) {
      return null;
    }
  };

  // Requiere sesión válida (usado por guards)
  window.APP.requireSession = async function () {
    var session = await window.APP.getSession();
    if (!session || !session.user) return null;
    return session;
  };

  // ------------------------------------------------------------
  // Helper ADMIN (clave para todo el panel)
  // - Verifica contra tabla public.admins (user_id)
  // ------------------------------------------------------------
  window.APP.isAdmin = async function () {
    try {
      var user = await window.APP.getUser();
      if (!user) return false;

      var res = await window.APP.supabase
        .from("admins")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (res.error) return false;
      return !!res.data;
    } catch (_) {
      return false;
    }
  };
})();
