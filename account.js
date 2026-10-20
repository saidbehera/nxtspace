/* NxTech account SPA: log in, create account, dashboard.
   Sign-in itself happens on Kinde's hosted pages (Authorization Code + PKCE, no secrets in the browser).
   Routes (hash based): #/login  #/register  #/dashboard */
(() => {
  "use strict";

  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const cfg = (window.NXTECH && window.NXTECH.kinde) || {};

  const SITE = "NxTech Club";
  const TITLES = {
    loading: "One moment…",
    login: "Log in",
    register: "Create your account",
    dashboard: "Your dashboard",
    error: "Sign-in problem",
    setup: "Set up sign-in"
  };
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  /* ---------- configuration ---------- */
  const normaliseDomain = d => {
    d = String(d || "").trim().replace(/\/+$/, "");
    if (!d) return "";
    return /^https?:\/\//i.test(d) ? d : "https://" + d;
  };
  const clientId = String(cfg.clientId || "").trim();
  const domain = normaliseDomain(cfg.domain);
  // Connection ID lets Kinde skip its initial sign-in/sign-up chooser screens.
  // It is copied from Settings > Environment > Authentication in the Kinde dashboard.
  const emailConnectionId = String(cfg.emailConnectionId || "").trim();
  const onFile = location.protocol === "file:";
  const redirectUri = String(cfg.redirectUri || "").trim() || (onFile ? "" : location.origin + location.pathname);
  const configured = !!(clientId && domain && redirectUri && emailConnectionId) && !onFile;

  /* ---------- state ---------- */
  const views = $$("[data-view]");
  let kinde = null;
  let user = null;
  let authed = false;
  let failure = null;      // { message, detail }
  let welcome = null;      // "register" | "login" after coming back from Kinde

  /* ---------- helpers ---------- */
  const show = name => {
    views.forEach(v => { v.hidden = v.dataset.view !== name; });
    document.title = `${TITLES[name]} — ${SITE}`;
    $$("[data-seg]").forEach(a => {
      if (a.dataset.seg === name) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    const h = $(`[data-view="${name}"] h1`);
    if (h) h.focus({ preventScroll: true });
  };

  const go = route => {
    if (location.hash === "#/" + route) render();
    else location.hash = "#/" + route;
  };

  const currentRoute = () => {
    const m = location.hash.match(/^#\/(login|register|dashboard)\/?$/);
    return m ? m[1] : null;
  };

  const describeError = (code, description) => {
    const c = String(code || "").toLowerCase();
    if (c === "access_denied") return { message: "Sign-in was cancelled. You can try again whenever you're ready." };
    if (c === "err_code_exchange" || c === "err_state_parse") {
      return { message: "We couldn't finish signing you in. Please try again.", detail: description || code };
    }
    return { message: "Something went wrong while signing you in. Please try again.", detail: description || code };
  };

  const setFailure = (code, description) => {
    failure = describeError(code, description);
    console.error("[account] sign-in error:", code, description);
    render();
  };

  const syncAuth = async () => {
    authed = false;
    user = null;
    if (!kinde) return;
    authed = await kinde.isAuthenticated();
    if (!authed) return;
    try { user = (await kinde.getUserProfile()) || kinde.getUser(); }
    catch { try { user = kinde.getUser(); } catch { user = null; } }
  };

  const fillDashboard = () => {
    const email = (user && user.email) || "";
    const name = (user && user.given_name) || email.split("@")[0] || "member";
    $("#dashName").textContent = name;
    $("#dashEmail").textContent = email;
    $("#avatar").textContent = (name.trim()[0] || "?").toUpperCase();
    const note = $("#dashNote");
    if (welcome) {
      note.textContent = welcome === "register"
        ? "Account created. Welcome to NxTech Club!"
        : "Welcome back. You're signed in.";
      note.hidden = false;
    } else {
      note.hidden = true;
    }
  };

  const fillSetup = () => {
    const msg = $("#setupMsg"), steps = $("#setupSteps");
    if (onFile) {
      msg.textContent = "Sign-in can't run from a file on your computer. Serve this folder over http, then open the account page from that address.";
      steps.replaceChildren();
      const li = document.createElement("li");
      li.append("In this folder, run ");
      const code = document.createElement("code");
      code.textContent = "python3 -m http.server 5500";
      li.append(code, " and open ");
      const url = document.createElement("code");
      url.textContent = "http://127.0.0.1:5500/account.html";
      li.append(url, ".");
      steps.append(li);
      return;
    }
    msg.textContent = "Finish the Kinde setup below to use the NxTech login and registration screens as the starting point.";
    $("#setupUrl").textContent = redirectUri;
  };

  /* ---------- rendering ---------- */
  function render() {
    if (!configured) { fillSetup(); show("setup"); return; }
    if (failure) {
      $("#errorMsg").textContent = failure.message;
      const d = $("#errorDetail");
      d.textContent = failure.detail || "";
      d.hidden = !failure.detail;
      show("error");
      return;
    }
    if (!kinde) { show("loading"); return; }

    let route = currentRoute() || (authed ? "dashboard" : "login");
    if (route === "dashboard" && !authed) route = "login";
    if (authed && (route === "login" || route === "register")) route = "dashboard";
    if (location.hash !== "#/" + route) history.replaceState(null, "", location.pathname + location.search + "#/" + route);

    if (route === "dashboard") fillDashboard();
    show(route);
  }

  /* ---------- starting login / sign-up ---------- */
  const resetButtons = () => {
    $$("form[data-form] button[type=submit]").forEach(b => {
      b.disabled = false;
      if (b.dataset.label) b.textContent = b.dataset.label;
    });
  };

  const start = async (kind, form) => {
    const input = form.elements.email;
    const err = $(".err", form);
    const email = input.value.trim();
    err.textContent = "";
    if (!email || !EMAIL_RE.test(email)) {
      err.textContent = "Enter a valid email address.";
      input.focus();
      return;
    }
    if (!kinde) return;

    const btn = $("button[type=submit]", form);
    btn.dataset.label = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Taking you to secure sign-in…";

    const options = {
      app_state: { intent: kind },
      connectionId: emailConnectionId
    };
    if (email) options.loginHint = email;
    try {
      if (kind === "register") await kinde.register(options);
      else await kinde.login(options);
    } catch (e) {
      console.error(e);
      resetButtons();
      err.textContent = "We couldn't start sign-in. Please try again.";
    }
  };

  /* ---------- Kinde callbacks ---------- */
  const onRedirect = (_user, appState) => {
    const intent = appState && appState.intent;
    welcome = intent === "register" ? "register" : "login";
    // If this fires after start-up has finished, refresh and show the dashboard.
    if (kinde) syncAuth().then(() => go("dashboard"));
  };
  const onError = props => {
    const code = props && props.error;
    // A stale or expired session on page load isn't a sign-in failure: the visitor just sees the login page.
    if (code === "ERR_GET_USER_PROFILE") {
      console.warn("[account] couldn't restore the previous session:", props.errorDescription);
      return;
    }
    if (failure) return; // keep the first message, it's usually the clearest
    setFailure(code, props && props.errorDescription);
  };

  /* ---------- start-up ---------- */
  const cleanUrl = () => {
    const u = new URL(location.href);
    let changed = false;
    ["code", "state", "error", "error_description"].forEach(k => { if (u.searchParams.has(k)) { u.searchParams.delete(k); changed = true; } });
    if (changed) history.replaceState(null, "", u.pathname + (u.search || "") + u.hash);
  };

  const init = async () => {
    $$("form[data-form]").forEach(form => {
      form.addEventListener("submit", e => { e.preventDefault(); start(form.dataset.form, form); });
    });
    $("#logoutBtn").addEventListener("click", async function () {
      this.disabled = true;
      try { await kinde.logout(); } catch (e) { console.error(e); this.disabled = false; }
    });
    $("#retryBtn").addEventListener("click", () => {
      failure = null;
      if (kinde) go("login"); else location.reload();
    });
    window.addEventListener("hashchange", render);
    // Coming back with the browser's Back button from Kinde: undo the "redirecting" state.
    window.addEventListener("pageshow", e => { if (e.persisted) resetButtons(); });

    if (!configured) { render(); return; }
    show("loading");

    const qs = new URLSearchParams(location.search);
    if (qs.get("error")) failure = describeError(qs.get("error"), qs.get("error_description"));

    const factory = window.createKindeClient && (window.createKindeClient.default || window.createKindeClient);
    if (typeof factory !== "function") {
      failure = { message: "The sign-in library didn't load. Check your connection and reload the page." };
      render();
      return;
    }

    try {
      kinde = await factory({
        client_id: clientId,
        domain,
        redirect_uri: redirectUri,
        logout_uri: redirectUri,
        is_dangerously_use_local_storage: cfg.useLocalStorage === true,
        on_redirect_callback: onRedirect,
        on_error_callback: onError
      });
      await syncAuth();
    } catch (e) {
      console.error(e);
      kinde = null;
      failure = { message: "We couldn't reach the sign-in service. Please try again in a moment.", detail: String(e && e.message || e) };
    }
    cleanUrl();
    render();
  };

  init();
})();
