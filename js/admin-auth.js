"use strict";

/**
 * admin-auth.js ✅ PRO (Supabase Auth REAL + Admin Gate)
 *
 * Páginas:
 * - admin-login.html: form #loginForm (#adminEmail, #adminPass) -> login -> redirect a ./admin.html
 * - admin.html: requiere sesión + requiere ser ADMIN -> guard + logout (#logoutBtn)
 *
 * Seguridad:
 * - returnUrl (?r=) sanitizado (solo permite archivos *.html simples)
 * - Sin service role key en frontend
 * - Gate por tabla "admins" (whitelist) para bloquear acceso al panel
 *
 * Requisitos:
 * 1) https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2
 * 2) ./js/supabaseClient.js   (crea APP.supabase)
 * 3) ./js/admin-auth.js
 *
 * ⚙️ Necesitás una tabla: public.admins
 * Recomendado (simple):
 *   create table public.admins (
 *     user_id uuid primary key references auth.users(id) on delete cascade,
 *     email text,
 *     role text default 'admin',
 *     created_at timestamptz default now()
 *   );
 *
 * Y RLS:
 *   alter table public.admins enable row level security;
 *   create policy "admins can read own row"
 *     on public.admins for select
 *     to authenticated
 *     using (auth.uid() = user_id);
 *
 *   -- (opcional) si querés que solo ciertos usuarios puedan administrar admins,
 *   -- lo hacés con policies más avanzadas o desde SQL dashboard.
 */
(function () {
  const $ = (sel) => document.querySelector(sel);

  // ------------------------------------------------------------
  // Config
  // ------------------------------------------------------------
  const LOGIN_URL = "./admin-login.html";
  const ADMIN_URL = "./admin.html";

  // Tabla whitelist de admins (ajustable)
  const ADMINS_TABLE = "admins";

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
    el.querySelector(".close")?.addEventListener("click", kill);
    setTimeout(kill, timeoutMs);
  }

  function go(url) {
    window.location.replace(url);
  }

  function isValidEmail(v) {
    const s = String(v || "").trim();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
  }

  // ------------------------------------------------------------
  // Return URL safety
  // ------------------------------------------------------------
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
    // Solo permite "admin.html" o "algo-1.html"
    const s = String(r || "").trim();
    return /^[a-z0-9-]+\.html$/i.test(s) ? s : "";
  }

  // ------------------------------------------------------------
  // Supabase helpers
  // ------------------------------------------------------------
  function hasSupabase() {
    return !!(window.APP && window.APP.supabase && window.APP.supabase.auth);
  }

  function hardFail(msg) {
    try {
      console.error("[admin-auth]", msg);
    } catch (_) { }
    toast("Error", msg, 3600);
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
      await window.APP.supabase.auth.signOut();
    } catch (_) { }
  }

  function mapAuthError(err) {
    const raw = String(err?.message || "").toLowerCase();

    if (raw.includes("invalid login credentials")) return "Correo o contraseña incorrectos.";
    if (raw.includes("email not confirmed")) return "Tu correo no está confirmado todavía.";
    if (raw.includes("too many requests")) return "Demasiados intentos. Probá de nuevo en unos minutos.";
    if (raw.includes("network") || raw.includes("fetch")) return "Problema de conexión. Revisá tu internet e intentá de nuevo.";

    return "No se pudo iniciar sesión. Revisá tus datos e intentá otra vez.";
  }

  // ------------------------------------------------------------
  // Admin Gate (whitelist)
  // ------------------------------------------------------------
  async function isAdminUser(userId) {
    // IMPORTANTE: esto depende de RLS en public.admins
    // Policy recomendada: auth.uid() = user_id (select)
    try {
      const { data, error } = await window.APP.supabase
        .from(ADMINS_TABLE)
        .select("user_id")
        .eq("user_id", userId)
        .maybeSingle();

      if (error) {
        // Si hay error por RLS mal configurada, lo mostramos como acceso denegado pero avisamos en consola
        console.warn("[admin-auth] admins table check error:", error);
        return false;
      }
      return !!(data && String(data.user_id) === String(userId));
    } catch (e) {
      console.warn("[admin-auth] admins gate exception:", e);
      return false;
    }
  }

  async function requireAdminOrKick(session) {
    const userId = session?.user?.id || "";
    if (!userId) return false;

    const ok = await isAdminUser(userId);
    if (ok) return true;

    // Si no es admin, cerramos sesión para evitar quedarse “medio logueado” en el panel
    await signOut();
    toast("Acceso denegado", "Tu cuenta no tiene permisos para entrar al panel.", 3600);
    setTimeout(() => go(LOGIN_URL), 650);
    return false;
  }

  // ------------------------------------------------------------
  // Page detection
  // ------------------------------------------------------------
  const isLoginPage = !!$("#loginForm"); // admin-login.html
  const isAdminPage = !!$("#appPanel") || !!$("#logoutBtn"); // admin.html

  // ------------------------------------------------------------
  // Guard (admin.html)
  // ------------------------------------------------------------
  async function guardAdminPage() {
    const session = await getSession();
    if (!session) {
      const back = encodeURIComponent(window.location.pathname.split("/").pop() || "admin.html");
      go(`${LOGIN_URL}?r=${back}`);
      return false;
    }

    // ✅ Gate real: solo admins
    const okAdmin = await requireAdminOrKick(session);
    if (!okAdmin) return false;

    return true;
  }

  // ------------------------------------------------------------
  // Logout (admin.html)
  // ------------------------------------------------------------
  function wireLogout() {
    const btn = $("#logoutBtn");
    if (!btn) return;

    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        await signOut();
        toast("Sesión cerrada", "Volviendo al login…", 1200);
        setTimeout(() => go(LOGIN_URL), 450);
      } finally {
        // si por alguna razón no redirige
        setTimeout(() => (btn.disabled = false), 1200);
      }
    });
  }

  // ------------------------------------------------------------
  // Login (admin-login.html)
  // ------------------------------------------------------------
  async function initLoginPage() {
    // Si ya hay sesión válida, igual verificamos admin gate
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

        // ✅ Gate real: si no es admin, no entra
        const okAdmin = await requireAdminOrKick(session);
        if (!okAdmin) return;

        toast("Acceso OK", "Entrando al panel…", 1100);

        const r = sanitizeReturnFile(getReturnUrl());
        const target = r ? `./${r.replace(/^\.?\//, "")}` : ADMIN_URL;

        setTimeout(() => go(target), 450);
      } catch (err) {
        toast("Login falló", mapAuthError(err), 3200);
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  // ------------------------------------------------------------
  // Auth state listener
  // ------------------------------------------------------------
  function wireAuthListener() {
    try {
      window.APP.supabase.auth.onAuthStateChange(async (event, session) => {
        // Si estás en admin y te quedaste sin sesión -> login
        if (isAdminPage && (event === "SIGNED_OUT" || event === "USER_DELETED")) {
          const back = encodeURIComponent(window.location.pathname.split("/").pop() || "admin.html");
          go(`${LOGIN_URL}?r=${back}`);
          return;
        }

        // Si estás en admin y cambia sesión (refresh/sign-in), revalida admin gate
        if (isAdminPage && (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") && session) {
          await requireAdminOrKick(session);
        }
      });
    } catch (_) { }
  }

  // ------------------------------------------------------------
  // Boot
  // ------------------------------------------------------------
  (async function boot() {
    if (!hasSupabase()) {
      hardFail("APP.supabase no existe. Revisá el orden: Supabase CDN → supabaseClient.js → admin-auth.js");
      return;
    }

    wireAuthListener();

    if (isAdminPage) {
      const ok = await guardAdminPage();
      if (!ok) return;
      wireLogout();
    }

    if (isLoginPage) {
      await initLoginPage();
    }
  })();
})();
