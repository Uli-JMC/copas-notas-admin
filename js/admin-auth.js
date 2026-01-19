"use strict";

/**
 * admin-auth.js ✅ ESTABLE (Login + Gate + Logout + admin:ready)
 *
 * Reglas:
 * - En admin-login.html: maneja login (signInWithPassword) + valida admin
 * - En admin.html: protege la ruta (require session + isAdmin), wire logout
 * - Emite "admin:ready" cuando el admin está OK (para que módulos arranquen)
 *
 * Requiere:
 * - Supabase CDN
 * - ./js/supabaseClient.js (window.APP.supabase + helpers)
 */

(function () {
  const VERSION = "2026-01-19.auth.1";

  const $ = (sel, root = document) => root.querySelector(sel);

  const loginPanel = $("#loginPanel");
  const appPanel = $("#appPanel");

  // Si no estamos en login ni en admin, no corremos.
  if (!loginPanel && !appPanel) return;

  // -----------------------------
  // Helpers
  // -----------------------------
  function log(...a) { try { console.log("[admin-auth]", ...a); } catch (_) {} }
  function warn(...a) { try { console.warn("[admin-auth]", ...a); } catch (_) {} }
  function err(...a) { try { console.error("[admin-auth]", ...a); } catch (_) {} }

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
    const host = $("#toasts");
    if (!host) return;

    const el = document.createElement("div");
    el.className = "toast";
    el.innerHTML = `
      <div>
        <p class="tTitle">${escapeHtml(title)}</p>
        <p class="tMsg">${escapeHtml(msg)}</p>
      </div>
      <button class="close" aria-label="Cerrar" type="button">✕</button>
    `;
    host.appendChild(el);

    const kill = () => {
      el.style.opacity = "0";
      el.style.transform = "translateY(-6px)";
      setTimeout(() => { try { el.remove(); } catch (_) {} }, 180);
    };

    el.querySelector(".close")?.addEventListener("click", kill, { once: true });
    setTimeout(kill, timeoutMs);
  }

  function ensureSupabase() {
    if (!window.APP || !APP.supabase) {
      err("APP.supabase no existe. Orden requerido: Supabase CDN -> supabaseClient.js -> admin-auth.js");
      toast("Error", "No se cargó Supabase. Revisá el orden de scripts.", 4200);
      return false;
    }
    return true;
  }

  function toLogin() {
    // relativo: estable en Netlify dentro de la carpeta admin
    window.location.href = "./admin-login.html";
  }

  function toAdmin() {
    window.location.href = "./admin.html";
  }

  async function safeSignOut() {
    try { await APP.supabase.auth.signOut(); } catch (_) {}
  }

  async function getUserSafe() {
    try {
      const r = await APP.supabase.auth.getUser();
      return r?.data?.user || null;
    } catch (_) {
      return null;
    }
  }

  async function getSessionSafe() {
    try {
      const r = await APP.supabase.auth.getSession();
      return r?.data?.session || null;
    } catch (_) {
      return null;
    }
  }

function emitAdminReady(user) {
  try {
    if (APP.__adminReady === true) return; // ✅ evita doble disparo
    APP.__adminReady = true;

    const detail = {
      userId: user?.id || null,
      email: user?.email || null,
      version: VERSION,
    };

    window.dispatchEvent(new CustomEvent("admin:ready", { detail }));
  } catch (_) {}
}


  // -----------------------------
  // Gate de admin.html (proteger panel)
  // -----------------------------
  async function guardAdminPage() {
    if (!appPanel) return;

    if (!ensureSupabase()) return;

    const session = await getSessionSafe();
    if (!session || !session.user) {
      // No sesión => login
      toLogin();
      return;
    }

    // Validar rol admin (tabla public.admins)
    let ok = false;
    try {
      ok = await APP.isAdmin();
    } catch (_) {
      ok = false;
    }

    if (!ok) {
      await safeSignOut();
      toast("Acceso denegado", "Tu cuenta no tiene permisos de administrador.", 4200);
      // Pequeño delay para que el toast se vea si hay redirección inmediata
      setTimeout(toLogin, 250);
      return;
    }

    // Admin OK => habilitar panel
    emitAdminReady(session.user);
  }

  // -----------------------------
  // Login en admin-login.html
  // -----------------------------
  async function bootLoginPage() {
    if (!loginPanel) return;
    if (!ensureSupabase()) return;

    const form = $("#loginForm");
    const emailEl = $("#adminEmail");
    const passEl = $("#adminPass");
    if (!form || !emailEl || !passEl) return;

    // Si ya hay sesión válida y es admin => mandar al panel
    const s = await getSessionSafe();
    if (s?.user) {
      const isAdmin = await APP.isAdmin().catch(() => false);
      if (isAdmin) {
        toAdmin();
        return;
      } else {
        await safeSignOut();
      }
    }

    function setFieldError(input, msgEl, on) {
      try {
        input.setAttribute("aria-invalid", on ? "true" : "false");
        if (msgEl) msgEl.hidden = !on;
      } catch (_) {}
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const email = String(emailEl.value || "").trim();
      const password = String(passEl.value || "");

      const errEmail = $("#errEmail");
      const errPass = $("#errPass");

      const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      const passOk = password.length >= 6;

      setFieldError(emailEl, errEmail, !emailOk);
      setFieldError(passEl, errPass, !passOk);

      if (!emailOk || !passOk) {
        toast("Revisá tus datos", "Verificá correo y contraseña.", 3200);
        return;
      }

      // Intento de login
      try {
        const { data, error } = await APP.supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) {
          toast("No se pudo entrar", error.message || "Credenciales inválidas.", 4200);
          return;
        }

        const user = data?.user || (await getUserSafe());
        if (!user) {
          toast("Error", "No se pudo obtener el usuario. Intentá de nuevo.", 4200);
          return;
        }

        // Validar admin por tabla admins
        const ok = await APP.isAdmin().catch(() => false);
        if (!ok) {
          await safeSignOut();
          toast("Acceso denegado", "Tu cuenta no es admin. Pedí acceso.", 4200);
          return;
        }

        toast("Listo", "Bienvenido al panel.", 1600);
        setTimeout(toAdmin, 250);
      } catch (ex) {
        err(ex);
        toast("Error", "Ocurrió un error al iniciar sesión.", 4200);
      }
    });
  }

  // -----------------------------
  // Logout en admin.html
  // -----------------------------
  function wireLogout() {
    if (!appPanel) return;
    const btn = $("#logoutBtn");
    if (!btn) return;

    if (btn.dataset.wired === "1") return;
    btn.dataset.wired = "1";

    btn.addEventListener("click", async () => {
      try {
        await safeSignOut();
      } finally {
        toLogin();
      }
    });
  }

  // -----------------------------
  // Auth state listener (anti-bugs)
  // -----------------------------
  function wireAuthListener() {
    if (!ensureSupabase()) return;

    // Evitar doble wire si re-ejecuta por cache/hmr
    if (window.__ecnAdminAuthWired === true) return;
    window.__ecnAdminAuthWired = true;

    try {
      APP.supabase.auth.onAuthStateChange(async (event) => {
        // Si se desloguea desde otra pestaña, sacar del panel
        if (event === "SIGNED_OUT" && appPanel) {
          toLogin();
        }
      });
    } catch (_) {}
  }

  // -----------------------------
  // BOOT
  // -----------------------------
  log("boot", { VERSION, page: appPanel ? "admin" : "login" });

  wireAuthListener();
  wireLogout();
  bootLoginPage();
  guardAdminPage();
})();
