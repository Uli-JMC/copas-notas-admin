/* js/supabaseClient.js
   Cliente Supabase (ADMIN) ✅ PRO
   - Usa ANON key (segura solo con RLS + policies)
   - Sin lógica de negocio
   - Helpers mínimos para auth/diagnóstico
*/
(function () {
  "use strict";

  // ------------------------------------------------------------
  // Config
  // ------------------------------------------------------------
  var SUPABASE_URL = "https://zthwbzaekdqrbpplvkmy.supabase.co";

  // ✅ ANON key (frontend + RLS)
  var SUPABASE_ANON_KEY = "sb_publishable_rYM5ObkmS_YZNkaWGu9HOw_Gr2TN1mu";

  // Para evitar mezclar sesiones con el sitio público:
  // (si luego querés compartir sesión, lo podés igualar)
  var ADMIN_STORAGE_KEY = "ecn_admin_sb_auth";

  function hardFail(msg) {
    try {
      console.error("[supabaseClient][ADMIN]", msg);
    } catch (_) {}
  }

  // Requiere que el CDN de supabase-js esté cargado antes:
  // <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
  if (!window.supabase || !window.supabase.createClient) {
    hardFail("Supabase CDN no cargado. Agregá supabase-js@2 antes de supabaseClient.js");
    return;
  }

  // Evita doble inicialización si se incluye 2 veces
  if (window.APP && window.APP.supabase) return;

  window.APP = window.APP || {};

  // ------------------------------------------------------------
  // Client
  // ------------------------------------------------------------
  window.APP.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,

      // Admin panel normalmente NO necesita procesar sesión desde la URL.
      // Si luego implementás magic links / OAuth callback en admin, lo activamos.
      detectSessionInUrl: false,

      // Storage separado (evita conflictos con el public)
      storageKey: ADMIN_STORAGE_KEY
    }
  });

  // Alias opcional corto
  window.APP.sb = window.APP.supabase;

  // Debug mínimo
  window.APP.supabaseUrl = SUPABASE_URL;

  // ------------------------------------------------------------
  // Helpers (no negocio)
  // ------------------------------------------------------------
  window.APP.getSession = async function () {
    try {
      var res = await window.APP.supabase.auth.getSession();
      return res && res.data ? res.data.session : null;
    } catch (_) {
      return null;
    }
  };

  window.APP.getUser = async function () {
    try {
      var res = await window.APP.supabase.auth.getUser();
      return res && res.data ? res.data.user : null;
    } catch (_) {
      return null;
    }
  };

  // Útil para guards (admin-auth.js puede usarlo)
  window.APP.requireSession = async function () {
    var session = await window.APP.getSession();
    if (!session) return null;
    // session.user debería existir si hay sesión válida
    return session;
  };
})();
