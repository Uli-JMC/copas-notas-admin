/* ============================================================
   js/supabaseClient.js
   Cliente Supabase (ADMIN) ✅ PRO
============================================================ */
(function () {
  "use strict";

  var SUPABASE_URL = "https://zthwbzaekdqrbpplvkmy.supabase.co";
  var SUPABASE_ANON_KEY = "sb_publishable_rYM5ObkmS_YZNkaWGu9HOw_Gr2TN1mu";

  var ADMIN_STORAGE_KEY = "ecn_admin_sb_auth";

  function hardFail(msg) {
    try { console.error("[supabaseClient][ADMIN]", msg); } catch (_) {}
  }

  if (!window.supabase || !window.supabase.createClient) {
    hardFail("Supabase CDN no cargado. Cargá supabase-js@2 antes de supabaseClient.js");
    return;
  }

  if (window.APP && window.APP.supabase) return;

  window.APP = window.APP || {};

  window.APP.supabase = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: ADMIN_STORAGE_KEY,
      },
    }
  );

  window.APP.sb = window.APP.supabase;
  window.APP.supabaseUrl = SUPABASE_URL;

  // ---------- helpers ----------
  window.APP.getSession = async function () {
    try {
      var res = await window.APP.supabase.auth.getSession();
      return res && res.data ? res.data.session : null;
    } catch (_) { return null; }
  };

  window.APP.getUser = async function () {
    try {
      var res = await window.APP.supabase.auth.getUser();
      return res && res.data ? res.data.user : null;
    } catch (_) { return null; }
  };

  window.APP.requireSession = async function () {
    var s = await window.APP.getSession();
    if (!s || !s.user) return null;
    return s;
  };

  // --- Gate admin: tabla public.admins (user_id)
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

  // Toast unificado para todo el admin
  window.APP.toast = function (title, msg, timeoutMs) {
    timeoutMs = timeoutMs || 3200;
    var host = document.querySelector("#toasts");
    if (!host) return;

    function esc(s) {
      return String(s ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    }

    var el = document.createElement("div");
    el.className = "toast";
    el.innerHTML = `
      <div>
        <p class="tTitle">${esc(title)}</p>
        <p class="tMsg">${esc(msg)}</p>
      </div>
      <button class="close" type="button" aria-label="Cerrar">✕</button>
    `;
    host.appendChild(el);

    var kill = function () {
      el.style.opacity = "0";
      el.style.transform = "translateY(-6px)";
      setTimeout(function () { try { el.remove(); } catch (_) {} }, 180);
    };

    el.querySelector(".close")?.addEventListener("click", kill);
    setTimeout(kill, timeoutMs);
  };
})();
