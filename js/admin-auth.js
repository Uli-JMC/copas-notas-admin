"use strict";

/**
 * admin-auth.js ✅ PRO+READY+LOGOUT-ROBUST (Supabase Auth + Admin Gate + Ready Event)
 * - Logout SIEMPRE via delegación (no depende del timing del DOM)
 * - Diagnóstico: logs + verificación de session antes/después
 * - Dispara window event "admin:ready" cuando el gate pasa
 * - Marca APP.adminReady = true
 */
(function () {
  const $ = (sel) => document.querySelector(sel);

  const LOGIN_URL = "./admin-login.html";
  const ADMIN_URL = "./admin.html";

  // ------------------------------------------------------------
  // UI helpers
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

  function go(url) {
    window.location.replace(url);
  }

  function safeStr(x) {
    return String(x ?? "");
  }

  // ------------------------------------------------------------
  // Supabase guards
  // ------------------------------------------------------------
  function hasSupabase() {
    return !!(window.APP && window.APP.supabase && window.APP.supabase.auth);
  }

  function hardFail(msg) {
    console.error("[admin-auth]", msg);
    toast("Error", msg, 5200);
  }

  async function getSession() {
    try {
      const res = await window.APP.supabase.auth.getSession();
      return res?.data?.session || null;
    } catch (_) {
      return null;
    }
  }

  async function signIn(email, password) {
    const res = await window.APP.supabase.auth.signInWithPassword({ email, password });
    if (res?.error) throw res.error;
    return res?.data?.session || null;
  }

  async function signOut() {
    try {
      const res = await window.APP.supabase.auth.signOut();
      // supabase-js v2 devuelve { error } en algunas rutas
      if (res?.error) throw res.error;
      return true;
    } catch (err) {
      console.error("[admin-auth] signOut error:", err);
      return false;
    }
  }

  function mapAuthError(err) {
    const raw = safeStr(err?.message).toLowerCase();
    if (raw.includes("invalid login credentials")) return "Correo o contraseña incorrectos.";
    if (raw.includes("email not confirmed")) return "Tu correo no está confirmado todavía.";
    if (raw.includes("too many requests")) return "Demasiados intentos. Probá de nuevo en unos minutos.";
    if (raw.includes("network") || raw.includes("fetch")) return "Problema de conexión. Revisá tu internet e intentá de nuevo.";
    return "No se pudo iniciar sesión. Revisá tus datos e intentá otra vez.";
  }

  function looksLikeRLSError(err) {
    const m = safeStr(err?.message).toLowerCase();
    const code = safeStr(err?.code).toLowerCase();
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

  // ------------------------------------------------------------
  // Logout robusto (delegación)
  // ------------------------------------------------------------
  function wireLogoutDelegated() {
    if (window.__ECN_LOGOUT_WIRED__) return;
    window.__ECN_LOGOUT_WIRED__ = true;

    document.addEventListener(
      "click",
      async (e) => {
        const btn = e.target && e.target.closest ? e.target.closest("#logoutBtn") : null;
        if (!btn) return;

        e.preventDefault();
        e.stopPropagation();

        console.info("[admin-auth] 🔘 logout click capturado");

        // Deshabilitar botón mientras procesa
        btn.disabled = true;

        try {
          const before = await getSession();
          console.info("[admin-auth] session BEFORE logout:", !!before, before?.user?.email || "");

          const ok = await signOut();

          const after = await getSession();
          console.info("[admin-auth] signOut ok =", ok, "| session AFTER logout:", !!after);

          if (!ok) {
            toast("Logout", "No se pudo cerrar sesión. Revisá consola.", 4200);
            return;
          }

          toast("Sesión cerrada", "Volviendo al login…", 1100);
          setTimeout(() => go(LOGIN_URL), 450);
        } finally {
          setTimeout(() => {
            try {
              btn.disabled = false;
            } catch (_) {}
          }, 1200);
        }
      },
      true // capture = true (más robusto si hay overlays)
    );

    console.info("[admin-auth] ✅ Logout delegado cableado");
  }

  // ------------------------------------------------------------
  // READY event
  // ------------------------------------------------------------
  function fireReady() {
    try {
      window.APP = window.APP || {};
      window.APP.adminReady = true;
      window.dispatchEvent(new Event("admin:ready"));
      console.info("[admin-auth] ✅ admin:ready");
    } catch (_) {}
  }

  // ------------------------------------------------------------
  // Admin gate
  // ------------------------------------------------------------
  async function requireAdminOrKick(session) {
    const userId = session?.user?.id || "";
    const email = session?.user?.email || "";
    if (!userId) return false;

    console.info("[admin-auth] session OK:", { userId, email });

    if (typeof window.APP.isAdmin !== "function") {
      console.warn("[admin-auth] Falta APP.isAdmin() (revisá supabaseClient.js).");
      await signOut();
      toast("Config incompleta", "Falta configurar el gate de admin (APP.isAdmin).", 4200);
      setTimeout(() => go(LOGIN_URL), 650);
      return false;
    }

    let ok = false;
    try {
      ok = await window.APP.isAdmin();
    } catch (err) {
      console.error("[admin-auth] isAdmin() error:", err);

      if (looksLikeRLSError(err)) {
        toast("RLS / Policies", "No se pudo validar admin. Falta policy SELECT en tabla 'admins'.", 5200);
      } else {
        toast("Error", "Falló la validación de admin (isAdmin). Revisá consola.", 5200);
      }

      await signOut();
      setTimeout(() => go(LOGIN_URL), 650);
      return false;
    }

    console.info("[admin-auth] isAdmin =", ok);

    if (ok) {
      fireReady();
      return true;
    }

    await signOut();
    toast("Acceso denegado", "Tu cuenta no tiene permisos para entrar al panel.", 3800);
    setTimeout(() => go(LOGIN_URL), 650);
    return false;
  }

  // ------------------------------------------------------------
  // Page detection
  // ------------------------------------------------------------
  const isLoginPage = !!$("#loginForm");
  const isAdminPage = !!$("#appPanel") || !!$("#logoutBtn");

  async function guardAdminPage() {
    const session = await getSession();
    if (!session) {
      const back = encodeURIComponent((window.location.pathname.split("/").pop() || "admin.html").replace("?", ""));
      go(`${LOGIN_URL}?r=${back}`);
      return false;
    }
    return await requireAdminOrKick(session);
  }

  function wireAuthListener() {
    try {
      window.APP.supabase.auth.onAuthStateChange(async (event, session) => {
        if (isAdminPage && (event === "SIGNED_OUT" || event === "USER_DELETED")) {
          const back = encodeURIComponent(window.location.pathname.split("/").pop() || "admin.html");
          go(`${LOGIN_URL}?r=${back}`);
          return;
        }
        if (isAdminPage && (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") && session) {
          await requireAdminOrKick(session);
        }
      });
    } catch (_) {}
  }

  async function initLoginPage() {
    const existing = await getSession();
    if (existing) {
      const okAdmin = await requireAdminOrKick(existing);
      if (okAdmin) go(ADMIN_URL);
      return;
    }

    const form = $("#loginForm");
    const emailEl = $("#adminEmail");
    const passEl = $("#adminPass");
    const errEmail = $("#errEmail");
    const errPass = $("#errPass");
    const submitBtn = form ? form.querySelector('button[type="submit"]') : null;

    const show = (el, on) => {
      if (!el) return;
      el.hidden = !on;
    };

    function setInvalid(input, invalid) {
      if (!input) return;
      input.setAttribute("aria-invalid", invalid ? "true" : "false");
    }

    const isValidEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "").trim());

    form?.addEventListener("submit", async (e) => {
      e.preventDefault();

      const email = String(emailEl?.value || "").trim();
      const pass = String(passEl?.value || "");

      const okEmail = isValidEmail(email);
      const okPass = pass.length >= 6;

      show(errEmail, !okEmail);
      show(errPass, !okPass);
      setInvalid(emailEl, !okEmail);
      setInvalid(passEl, !okPass);

      if (!okEmail || !okPass) {
        toast("Revisá los datos", "Verificá correo y contraseña.", 2600);
        return;
      }

      if (submitBtn) submitBtn.disabled = true;

      try {
        const session = await signIn(email, pass);
        const okAdmin = await requireAdminOrKick(session);
        if (!okAdmin) return;

        toast("Acceso OK", "Entrando al panel…", 1100);
        setTimeout(() => go(ADMIN_URL), 450);
      } catch (err) {
        toast("Login falló", mapAuthError(err), 3200);
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  // ------------------------------------------------------------
  // Boot
  // ------------------------------------------------------------
  (async function boot() {
    // ✅ Logout primero (no depende de supabase)
    wireLogoutDelegated();

    if (!hasSupabase()) {
      hardFail("APP.supabase no existe. Revisá el orden: Supabase CDN → supabaseClient.js → admin-auth.js");
      return;
    }

    wireAuthListener();

    if (isAdminPage) {
      const ok = await guardAdminPage();
      if (!ok) return;
    }

    if (isLoginPage) {
      await initLoginPage();
    }
  })();
})();
