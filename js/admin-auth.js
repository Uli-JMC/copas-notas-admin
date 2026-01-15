"use strict";

/**
 * admin-auth.js (DEPURADO + HARDENED)
 * - Login/guard/logout (demo local)
 * - ✅ Usa ECN.LS.ADMIN_SESSION ("ecn_admin_session")
 * - Login page (admin-login.html): valida y redirige a ./admin.html
 * - Admin page (admin.html): bloquea acceso si no hay sesión
 * - Rutas relativas: funciona en server y en folder
 * - ✅ Sanitiza returnUrl (?r=) para evitar paths raros
 */

(function () {
  const $ = (sel) => document.querySelector(sel);

  // ------------------------------------------------------------
  // Utils
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
      <button class="close" aria-label="Cerrar">✕</button>
    `;
    toastsEl.appendChild(el);

    const kill = () => {
      el.style.opacity = "0";
      el.style.transform = "translateY(-6px)";
      setTimeout(() => el.remove(), 180);
    };

    el.querySelector(".close")?.addEventListener("click", kill);
    setTimeout(kill, timeoutMs);
  }

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (_) {
      return fallback;
    }
  }

  function writeJSON(key, val) {
    localStorage.setItem(key, JSON.stringify(val));
  }

  function sessionKey() {
    try {
      if (window.ECN && ECN.LS && ECN.LS.ADMIN_SESSION) return ECN.LS.ADMIN_SESSION;
    } catch (_) {}
    return "ecn_admin_session";
  }

  function isValidEmail(v) {
    const s = String(v || "").trim();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
  }

  function isLogged() {
    const s = readJSON(sessionKey(), null);
    return !!(s && s.ok);
  }

  function setLogged(ok) {
    if (ok) writeJSON(sessionKey(), { ok: true, at: new Date().toISOString() });
    else localStorage.removeItem(sessionKey());
  }

  // ------------------------------------------------------------
  // Page detection
  // ------------------------------------------------------------
  const isLoginPage = !!$("#loginForm"); // admin-login.html
  const isAdminPage = !!$("#appPanel") || !!$("#logoutBtn"); // admin.html

  // ------------------------------------------------------------
  // Paths (relativos)
  // ------------------------------------------------------------
  const LOGIN_URL = "./admin-login.html";
  const ADMIN_URL = "./admin.html";

  function go(url) {
    window.location.replace(url);
  }

  function getReturnUrl() {
    try {
      const u = new URL(window.location.href);
      const r = u.searchParams.get("r");
      return r ? String(r) : "";
    } catch (_) {
      return "";
    }
  }

  function sanitizeReturnFile(r) {
    // ✅ Solo permite archivos simples tipo "admin.html" o "algo-1.html"
    const s = String(r || "").trim();
    return /^[a-z0-9-]+\.html$/i.test(s) ? s : "";
  }

  // ------------------------------------------------------------
  // Guard (admin page)
  // ------------------------------------------------------------
  if (isAdminPage) {
    if (!isLogged()) {
      // opcional: guardar a dónde quería ir (por si luego agregás secciones)
      const back = encodeURIComponent(
        window.location.pathname.split("/").pop() || "admin.html"
      );
      go(`${LOGIN_URL}?r=${back}`);
      return;
    }

    $("#logoutBtn")?.addEventListener("click", () => {
      setLogged(false);
      toast("Sesión cerrada", "Volviendo al login…", 1200);
      setTimeout(() => go(LOGIN_URL), 450);
    });
  }

  // ------------------------------------------------------------
  // Login handler (login page)
  // ------------------------------------------------------------
  if (isLoginPage) {
    // si ya estaba logueado, lo mandamos al admin directo
    if (isLogged()) {
      go(ADMIN_URL);
      return;
    }

    const form = $("#loginForm");
    const emailEl = $("#adminEmail");
    const passEl = $("#adminPass");

    // Estos IDs no existen en tu HTML actual, así que quedan opcionales
    const errEmail = $("#errEmail");
    const errPass = $("#errPass");

    const show = (el, on) => {
      if (!el) return;
      el.hidden = !on;
    };

    form?.addEventListener("submit", (e) => {
      e.preventDefault();

      const email = String(emailEl?.value || "").trim();
      const pass = String(passEl?.value || "");

      const okEmail = isValidEmail(email);
      const okPass = pass.length >= 6;

      show(errEmail, !okEmail);
      show(errPass, !okPass);

      if (!okEmail || !okPass) {
        toast("Revisá los datos", "Verificá correo y contraseña.", 2600);
        return;
      }

      setLogged(true);
      toast("Acceso OK", "Entrando al panel…", 1200);

      // ✅ si venía con returnUrl (?r=admin.html), lo respetamos (sanitizado)
      const r = sanitizeReturnFile(getReturnUrl());
      const target = r ? `./${r.replace(/^\.?\//, "")}` : ADMIN_URL;

      setTimeout(() => go(target), 450);
    });
  }
})();
