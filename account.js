/* NxtSpace account SPA: authentication, temporary member dashboard, and Kinde access metadata.
   The browser only displays access metadata. Protected data/actions must be verified on a trusted backend. */
(() => {
  "use strict";

  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const cfg = (window.NXTSPACE && window.NXTSPACE.kinde) || (window.NXTECH && window.NXTECH.kinde) || {}; // NXTECH is retained for legacy config compatibility.

  const SITE = "NxtSpace";
  const TITLES = {
    loading: "One moment…",
    login: "Log in",
    register: "Create your account",
    dashboard: "Member dashboard",
    verify: "Verify your email",
    error: "Sign-in problem",
    setup: "Set up sign-in"
  };
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const DEFAULT_PLAN_ROLE_MAP = {
    nxtspace_free: "Free",
    nxtspace_standard: "Standard",
    nxtspace_pro: "Pro"
  };

  /* ---------- configuration ---------- */
  const normaliseDomain = d => {
    d = String(d || "").trim().replace(/\/+$/, "");
    if (!d) return "";
    return /^https?:\/\//i.test(d) ? d : "https://" + d;
  };
  const clientId = String(cfg.clientId || "").trim();
  const domain = normaliseDomain(cfg.domain);
  const emailConnectionId = String(cfg.emailConnectionId || "").trim();
  const onFile = location.protocol === "file:";
  const redirectUri = String(cfg.redirectUri || "").trim() || (onFile ? "" : location.origin + location.pathname);
  const configured = !!(clientId && domain && redirectUri && emailConnectionId) && !onFile;
  const planRoleMap = cfg.planRoleMap && typeof cfg.planRoleMap === "object" ? cfg.planRoleMap : DEFAULT_PLAN_ROLE_MAP;
  const groupClaimName = String(cfg.groupClaimName || "groups").trim() || "groups";

  /* ---------- state ---------- */
  const views = $$('[data-view]');
  let kinde = null;
  let user = null;
  let authed = false;
  let failure = null;
  let welcome = null;
  let emailVerified = null; // true/false when Kinde returns the claim; null when unavailable
  let accessMeta = { roles: [], permissions: [], orgCodes: [], orgCode: "", groups: [] };

  /* ---------- utility helpers ---------- */
  const safeText = (selector, value, root = document) => {
    const el = $(selector, root);
    if (el) el.textContent = value == null ? "" : String(value);
    return el;
  };

  const getClaimValue = (claimName, tokenKey = "id_token") => {
    try {
      const result = kinde && typeof kinde.getClaim === "function" ? kinde.getClaim(claimName, tokenKey) : null;
      if (result && typeof result === "object" && Object.prototype.hasOwnProperty.call(result, "value")) return result.value;
      return result == null ? undefined : result;
    } catch {
      return undefined;
    }
  };

  const toBooleanOrNull = value => {
    if (value === true || value === 1 || String(value).toLowerCase() === "true") return true;
    if (value === false || value === 0 || String(value).toLowerCase() === "false") return false;
    return null;
  };

  const asList = value => {
    if (Array.isArray(value)) return value;
    if (value == null || value === "") return [];
    if (typeof value === "string") return value.split(/[;,]/).map(v => v.trim()).filter(Boolean);
    return [value];
  };

  const keyForRole = role => {
    if (typeof role === "string") return role.trim();
    if (!role || typeof role !== "object") return "";
    return String(role.key || role.name || role.id || "").trim();
  };

  const displayRole = role => {
    if (role && typeof role === "object") return String(role.name || role.key || role.id || "").trim();
    return String(role || "").trim();
  };

  const normaliseOrgCodes = raw => {
    if (Array.isArray(raw)) return raw.map(x => typeof x === "string" ? x : String(x && (x.orgCode || x.code) || "")).filter(Boolean);
    if (raw && Array.isArray(raw.orgCodes)) return raw.orgCodes.map(String).filter(Boolean);
    return [];
  };

  const readRolesFromAccountApi = async () => {
    if (!kinde || typeof kinde.getAccessToken !== "function") return [];
    const token = await kinde.getAccessToken();
    if (!token) return [];
    const issuer = getClaimValue("iss", "access_token");
    const base = normaliseDomain(issuer || domain);
    if (!base) return [];
    const response = await fetch(`${base}/account_api/v1/roles`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
    });
    if (!response.ok) throw new Error(`Kinde roles endpoint returned ${response.status}`);
    const data = await response.json();
    return Array.isArray(data.roles) ? data.roles : [];
  };

  const loadAccessMeta = async () => {
    accessMeta = { roles: [], permissions: [], orgCodes: [], orgCode: "", groups: [] };
    if (!kinde || !authed) return;

    // Roles may be surfaced as token claims or through Kinde's user-scoped Account API.
    let rawRoles = getClaimValue("roles", "id_token") ?? getClaimValue("roles", "access_token");
    let roles = asList(rawRoles);
    if (!roles.length) {
      try {
        // Accommodate SDK versions that expose getRoles directly, without requiring it.
        if (typeof kinde.getRoles === "function") {
          const result = await kinde.getRoles();
          roles = asList(result && result.roles ? result.roles : result);
        } else {
          roles = await readRolesFromAccountApi();
        }
      } catch (err) {
        console.info("[account] Kinde role metadata isn't available yet:", err && err.message || err);
      }
    }

    let permissions = [];
    try {
      if (typeof kinde.getPermissions === "function") {
        const result = kinde.getPermissions();
        permissions = asList(result && result.permissions ? result.permissions : result);
      } else {
        permissions = asList(getClaimValue("permissions", "access_token"));
      }
    } catch {
      permissions = asList(getClaimValue("permissions", "access_token"));
    }

    let organizations = [];
    try {
      organizations = normaliseOrgCodes(typeof kinde.getUserOrganizations === "function" ? kinde.getUserOrganizations() : getClaimValue("org_codes", "id_token"));
    } catch {
      organizations = normaliseOrgCodes(getClaimValue("org_codes", "id_token"));
    }

    let organization = "";
    try {
      const current = typeof kinde.getOrganization === "function" ? kinde.getOrganization() : null;
      organization = String(current && (current.orgCode || current.code) || getClaimValue("org_code", "access_token") || "");
    } catch {
      organization = String(getClaimValue("org_code", "access_token") || "");
    }

    // Kinde does not expose a standard getGroups() helper in this SDK. If configured,
    // a groups custom claim can be read from the ID or access token.
    let groupRaw = getClaimValue(groupClaimName, "id_token");
    if (groupRaw == null) groupRaw = getClaimValue(groupClaimName, "access_token");

    accessMeta = {
      roles,
      permissions,
      orgCodes: organizations,
      orgCode: organization,
      groups: asList(groupRaw)
    };
  };

  const show = name => {
    views.forEach(v => { v.hidden = v.dataset.view !== name; });
    document.title = `${TITLES[name] || SITE} — ${SITE}`;
    $$('[data-seg]').forEach(a => {
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
    const match = location.hash.match(/^#\/(login|register|dashboard|verify)\/?$/);
    return match ? match[1] : null;
  };

  const describeError = (code, description) => {
    const codeLower = String(code || "").toLowerCase();
    if (codeLower === "access_denied") return { message: "Sign-in was cancelled. You can try again whenever you're ready." };
    if (codeLower === "err_code_exchange" || codeLower === "err_state_parse") {
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
    emailVerified = null;
    accessMeta = { roles: [], permissions: [], orgCodes: [], orgCode: "", groups: [] };
    if (!kinde) return;
    authed = await kinde.isAuthenticated();
    if (!authed) return;

    try { user = (await kinde.getUserProfile()) || kinde.getUser(); }
    catch { try { user = kinde.getUser(); } catch { user = null; } }

    const claim = getClaimValue("email_verified", "id_token");
    emailVerified = toBooleanOrNull(claim != null ? claim : user && user.email_verified);
    await loadAccessMeta();
  };

  const tagList = (selector, items, emptyText, displayFn = displayRole) => {
    const container = $(selector);
    if (!container) return;
    container.replaceChildren();
    const visible = (items || []).map(displayFn).filter(Boolean);
    if (!visible.length) {
      const span = document.createElement("span");
      span.className = "nxt-muted-chip";
      span.textContent = emptyText;
      container.append(span);
      return;
    }
    visible.slice(0, 8).forEach(label => {
      const span = document.createElement("span");
      span.className = "nxt-chip";
      span.textContent = label;
      container.append(span);
    });
    if (visible.length > 8) {
      const span = document.createElement("span");
      span.className = "nxt-muted-chip";
      span.textContent = `+${visible.length - 8} more`;
      container.append(span);
    }
  };

  const getPlanName = roles => {
    const keys = (roles || []).map(keyForRole).filter(Boolean).map(x => x.toLowerCase());
    const mapping = Object.entries(planRoleMap);
    const match = mapping.find(([roleKey]) => keys.includes(String(roleKey).toLowerCase()));
    return match ? String(match[1]) : "";
  };

  const fillDashboard = () => {
    const email = String(user && user.email || "");
    const name = String(user && (user.given_name || user.name) || email.split("@")[0] || "member");
    safeText("#dashName", name);
    safeText("#dashEmail", email);
    safeText("#avatar", (name.trim()[0] || "?").toUpperCase());
    safeText("#dashOrganization", accessMeta.orgCode || "Personal workspace");
    safeText("#dashOrgDetail", accessMeta.orgCodes.length
      ? `${accessMeta.orgCodes.length} organization${accessMeta.orgCodes.length === 1 ? "" : "s"} available to your account.`
      : "No organization membership is assigned yet.");

    const verified = emailVerified === true;
    const verificationText = verified ? "Email verified" : emailVerified === false ? "Verification pending" : "Signed in";
    const verificationPill = $("#dashVerificationPill");
    if (verificationPill) {
      verificationPill.textContent = verificationText;
      verificationPill.classList.toggle("is-verified", verified);
      verificationPill.classList.toggle("is-pending", emailVerified === false);
    }
    safeText("#dashAccountStatus", verificationText);
    safeText("#dashVerificationDetail", verified
      ? "Kinde confirms this email address is verified."
      : emailVerified === false
        ? "Verify your email before using member features."
        : "Your NxtSpace sign-in session is active.");

    const planName = getPlanName(accessMeta.roles);
    safeText("#dashPlan", planName || "Not assigned");
    safeText("#dashPlanDetail", planName
      ? `Matched from your Kinde role mapping (${accessMeta.roles.map(keyForRole).filter(Boolean).join(", ")}).`
      : "Create/assign a role and map its exact role key in kinde-config.js.");
    safeText("#dashPlanHero", planName ? `${planName} plan detected` : "Plan setup pending");

    tagList("#dashRoles", accessMeta.roles, "No roles returned");
    tagList("#dashPermissions", accessMeta.permissions, "No permissions returned", item => typeof item === "string" ? item : String(item && (item.key || item.name) || ""));
    tagList("#dashGroups", accessMeta.groups, "No groups claim detected", item => typeof item === "string" ? item : String(item && (item.name || item.key || item.id) || ""));

    const note = $("#dashNote");
    if (note) {
      if (welcome) {
        note.textContent = welcome === "register"
          ? (verified ? "Your email is verified and your NxtSpace account is ready. Welcome!" : "Welcome to NxtSpace! Your account session is ready.")
          : "Welcome back. You're signed in to NxtSpace.";
        note.hidden = false;
      } else {
        note.hidden = true;
      }
    }
  };

  const fillVerify = () => {
    safeText("#verifyEmailAddress", user && user.email || "");
  };

  const fillSetup = () => {
    const msg = $("#setupMsg"), steps = $("#setupSteps");
    if (onFile) {
      msg.textContent = "Sign-in can't run from a file on your computer. Serve this folder over HTTP, then open the account page from that address.";
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
    msg.textContent = "Finish connecting Kinde to use the NxtSpace login and registration screens.";
    safeText("#setupUrl", redirectUri);
  };

  /* ---------- route rendering ---------- */
  function render() {
    if (!configured) { fillSetup(); show("setup"); return; }
    if (failure) {
      safeText("#errorMsg", failure.message);
      const detail = $("#errorDetail");
      if (detail) {
        detail.textContent = failure.detail || "";
        detail.hidden = !failure.detail;
      }
      show("error");
      return;
    }
    if (!kinde) { show("loading"); return; }

    let route = currentRoute() || (authed ? "dashboard" : "login");
    if (!authed && (route === "dashboard" || route === "verify")) route = "login";
    if (authed && emailVerified === false) route = "verify";
    else if (authed && (route === "login" || route === "register" || route === "verify")) route = "dashboard";

    if (location.hash !== "#/" + route) history.replaceState(null, "", location.pathname + location.search + "#/" + route);
    if (route === "dashboard") fillDashboard();
    if (route === "verify") fillVerify();
    show(route);
  }

  /* ---------- sign-in and sign-up ---------- */
  const resetButtons = () => {
    $$('form[data-form] button[type="submit"]').forEach(button => {
      button.disabled = false;
      if (button.dataset.label) button.textContent = button.dataset.label;
    });
  };

  const start = async (kind, form) => {
    const input = form.elements.email;
    const error = $(".err", form);
    const email = input.value.trim();
    error.textContent = "";
    if (!email || !EMAIL_RE.test(email)) {
      error.textContent = "Enter a valid email address.";
      input.focus();
      return;
    }
    if (!kinde) return;

    const button = $('button[type="submit"]', form);
    button.dataset.label = button.textContent;
    button.disabled = true;
    button.textContent = "Opening secure sign-in…";

    const options = {
      app_state: { intent: kind },
      connectionId: emailConnectionId,
      loginHint: email
    };
    try {
      if (kind === "register") await kinde.register(options);
      else await kinde.login(options);
    } catch (err) {
      console.error(err);
      resetButtons();
      error.textContent = "We couldn't start sign-in. Please check your connection and try again.";
    }
  };

  /* ---------- Kinde callbacks ---------- */
  const onRedirect = (_user, appState) => {
    const intent = appState && appState.intent;
    welcome = intent === "register" ? "register" : "login";
    if (kinde) syncAuth().then(() => go(emailVerified === false ? "verify" : "dashboard")).catch(err => {
      console.error("[account] could not refresh session after Kinde redirect:", err);
      render();
    });
  };

  const onError = props => {
    const code = props && props.error;
    if (code === "ERR_GET_USER_PROFILE") {
      console.warn("[account] couldn't restore the previous session:", props.errorDescription);
      return;
    }
    if (failure) return;
    setFailure(code, props && props.errorDescription);
  };

  /* ---------- startup ---------- */
  const cleanUrl = () => {
    const url = new URL(location.href);
    let changed = false;
    ["code", "state", "error", "error_description"].forEach(key => {
      if (url.searchParams.has(key)) { url.searchParams.delete(key); changed = true; }
    });
    if (changed) history.replaceState(null, "", url.pathname + (url.search || "") + url.hash);
  };

  const init = async () => {
    $$('form[data-form]').forEach(form => {
      form.addEventListener("submit", event => { event.preventDefault(); start(form.dataset.form, form); });
    });

    const logout = async button => {
      if (button) button.disabled = true;
      try {
        if (kinde) await kinde.logout();
        else location.href = `${redirectUri}#/login`;
      } catch (err) {
        console.error(err);
        if (button) button.disabled = false;
      }
    };

    $("#logoutBtn")?.addEventListener("click", function () { logout(this); });
    $("#verifyLogoutBtn")?.addEventListener("click", function () { logout(this); });
    $("#retryBtn")?.addEventListener("click", () => {
      failure = null;
      if (kinde) go("login"); else location.reload();
    });

    window.addEventListener("hashchange", render);
    window.addEventListener("pageshow", event => { if (event.persisted) resetButtons(); });

    if (!configured) { render(); return; }
    show("loading");

    const query = new URLSearchParams(location.search);
    if (query.get("error")) failure = describeError(query.get("error"), query.get("error_description"));

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
    } catch (err) {
      console.error(err);
      kinde = null;
      failure = { message: "We couldn't reach the sign-in service. Please try again in a moment.", detail: String(err && err.message || err) };
    }
    cleanUrl();
    render();
  };

  init();
})();
