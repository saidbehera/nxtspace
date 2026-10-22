/* NxtSpace account flow: Kinde sign-in -> email confirmation -> Didit identity verification -> plan selection -> dashboard.
   Verification decisions are read from the trusted API; browser state alone never grants protected access. */
(() => {
  "use strict";

  const $ = (selector, context = document) => context.querySelector(selector);
  const $$ = (selector, context = document) => [...context.querySelectorAll(selector)];
  const cfg = (window.NXTSPACE && window.NXTSPACE.kinde) || (window.NXTECH && window.NXTECH.kinde) || {};
  const SITE = "NxtSpace";
  const TITLES = {
    loading: "One moment…", login: "Log in", register: "Create your account",
    "email-verify": "Verify your email", verify: "Verify your identity",
    plans: "Choose your plan", dashboard: "Member dashboard",
    error: "Sign-in problem", setup: "Set up sign-in"
  };
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const DEFAULT_PLAN_ROLE_MAP = { nxtspace_free: "Free", nxtspace_standard: "Standard", nxtspace_pro: "Pro" };
  const normaliseDomain = value => {
    const text = String(value || "").trim().replace(/\/+$/, "");
    if (!text) return "";
    return /^https?:\/\//i.test(text) ? text : `https://${text}`;
  };

  const clientId = String(cfg.clientId || "").trim();
  const domain = normaliseDomain(cfg.domain);
  const apiBaseUrl = normaliseDomain(cfg.apiBaseUrl);
  const onFile = location.protocol === "file:";
  const redirectUri = String(cfg.redirectUri || "").trim() || (onFile ? "" : `${location.origin}${location.pathname}`);
  const configured = Boolean(clientId && domain && redirectUri && apiBaseUrl) && !onFile;
  const planRoleMap = cfg.planRoleMap && typeof cfg.planRoleMap === "object" ? cfg.planRoleMap : DEFAULT_PLAN_ROLE_MAP;
  const groupClaimName = String(cfg.groupClaimName || "groups").trim() || "groups";
  const checkoutUrls = cfg.planCheckoutUrls && typeof cfg.planCheckoutUrls === "object" ? cfg.planCheckoutUrls : {};

  const views = $$('[data-view]');
  let kinde = null;
  let user = null;
  let authed = false;
  let failure = null;
  let welcome = null;
  let emailVerified = null;
  let accessMeta = { roles: [], permissions: [], orgCodes: [], orgCode: "", groups: [] };
  let onboarding = { verificationStatus: "Not Started", verifiedAt: null, membershipPlan: "", membershipPlanSelectedAt: null };
  let onboardingError = "";
  let diditMessage = "Start the verification process to continue.";
  let verificationPollingEnabled = false;
  let verificationPollTimer = null;
  let statusRequestRunning = false;

  const safeText = (selector, value, root = document) => {
    const element = $(selector, root);
    if (element) element.textContent = value == null ? "" : String(value);
    return element;
  };
  const getClaimValue = (claimName, tokenKey = "id_token") => {
    try {
      const result = kinde && typeof kinde.getClaim === "function" ? kinde.getClaim(claimName, tokenKey) : null;
      if (result && typeof result === "object" && Object.prototype.hasOwnProperty.call(result, "value")) return result.value;
      return result == null ? undefined : result;
    } catch { return undefined; }
  };
  const toBooleanOrNull = value => {
    if (value === true || value === 1 || String(value).toLowerCase() === "true") return true;
    if (value === false || value === 0 || String(value).toLowerCase() === "false") return false;
    return null;
  };
  const asList = value => {
    if (Array.isArray(value)) return value;
    if (value == null || value === "") return [];
    if (typeof value === "string") return value.split(/[;,]/).map(item => item.trim()).filter(Boolean);
    return [value];
  };
  const keyForRole = role => {
    if (typeof role === "string") return role.trim();
    if (!role || typeof role !== "object") return "";
    return String(role.key || role.name || role.id || "").trim();
  };
  const displayRole = role => role && typeof role === "object"
    ? String(role.name || role.key || role.id || "").trim() : String(role || "").trim();
  const normaliseOrgCodes = raw => {
    if (Array.isArray(raw)) return raw.map(item => typeof item === "string" ? item : String(item && (item.orgCode || item.code) || "")).filter(Boolean);
    if (raw && Array.isArray(raw.orgCodes)) return raw.orgCodes.map(String).filter(Boolean);
    return [];
  };

  const getAccessToken = async () => {
    if (!kinde || typeof kinde.getAccessToken !== "function") throw new Error("Your sign-in session could not provide an access token. Please sign in again.");
    const token = await kinde.getAccessToken();
    if (!token) throw new Error("Your sign-in session has expired. Please sign in again.");
    return token;
  };
  const apiRequest = async (path, options = {}) => {
    const token = await getAccessToken();
    const response = await fetch(`${apiBaseUrl}${path}`, {
      method: options.method || "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(options.body !== undefined ? { "Content-Type": "application/json" } : {})
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      cache: "no-store"
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `The onboarding service returned ${response.status}.`);
    return data;
  };

  const readRolesFromAccountApi = async () => {
    const token = await getAccessToken();
    const issuer = getClaimValue("iss", "access_token");
    const base = normaliseDomain(issuer || domain);
    const response = await fetch(`${base}/account_api/v1/roles`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, cache: "no-store"
    });
    if (!response.ok) throw new Error(`Kinde roles endpoint returned ${response.status}`);
    const data = await response.json();
    return Array.isArray(data.roles) ? data.roles : [];
  };
  const loadAccessMeta = async () => {
    accessMeta = { roles: [], permissions: [], orgCodes: [], orgCode: "", groups: [] };
    if (!kinde || !authed) return;
    let roles = asList(getClaimValue("roles", "id_token") ?? getClaimValue("roles", "access_token"));
    if (!roles.length) {
      try {
        if (typeof kinde.getRoles === "function") {
          const result = await kinde.getRoles();
          roles = asList(result && result.roles ? result.roles : result);
        } else roles = await readRolesFromAccountApi();
      } catch (error) { console.info("[account] Kinde role metadata isn't available yet:", error && error.message || error); }
    }
    let permissions = [];
    try {
      if (typeof kinde.getPermissions === "function") {
        const result = kinde.getPermissions();
        permissions = asList(result && result.permissions ? result.permissions : result);
      } else permissions = asList(getClaimValue("permissions", "access_token"));
    } catch { permissions = asList(getClaimValue("permissions", "access_token")); }

    let organizations = [];
    try { organizations = normaliseOrgCodes(typeof kinde.getUserOrganizations === "function" ? kinde.getUserOrganizations() : getClaimValue("org_codes", "id_token")); }
    catch { organizations = normaliseOrgCodes(getClaimValue("org_codes", "id_token")); }
    let organization = "";
    try {
      const current = typeof kinde.getOrganization === "function" ? kinde.getOrganization() : null;
      organization = String(current && (current.orgCode || current.code) || getClaimValue("org_code", "access_token") || "");
    } catch { organization = String(getClaimValue("org_code", "access_token") || ""); }
    let groupRaw = getClaimValue(groupClaimName, "id_token");
    if (groupRaw == null) groupRaw = getClaimValue(groupClaimName, "access_token");
    accessMeta = { roles, permissions, orgCodes: organizations, orgCode: organization, groups: asList(groupRaw) };
  };

  const refreshOnboardingStatus = async ({ showMessage = true } = {}) => {
    if (statusRequestRunning) return false;
    statusRequestRunning = true;
    try {
      const data = await apiRequest("/api/onboarding/status");
      onboarding = {
        verificationStatus: String(data.verificationStatus || "Not Started"),
        verifiedAt: data.verifiedAt || null,
        membershipPlan: String(data.membershipPlan || "").toLowerCase(),
        membershipPlanSelectedAt: data.membershipPlanSelectedAt || null
      };
      onboardingError = "";
      if (data.verificationStatus === "Approved") diditMessage = "Identity verification approved. Choose your membership plan to continue.";
      return true;
    } catch (error) {
      onboardingError = error && error.message || "Could not contact the onboarding service.";
      if (showMessage) diditMessage = `We couldn't check your verification status: ${onboardingError}`;
      return false;
    } finally { statusRequestRunning = false; }
  };

  const stopVerificationPolling = () => {
    if (verificationPollTimer !== null) window.clearInterval(verificationPollTimer);
    verificationPollTimer = null;
  };
  const startVerificationPolling = () => {
    if (!verificationPollingEnabled || verificationPollTimer !== null) return;
    verificationPollTimer = window.setInterval(async () => {
      if (!authed || currentRoute() !== "verify") { stopVerificationPolling(); return; }
      const refreshed = await refreshOnboardingStatus({ showMessage: false });
      if (refreshed && onboarding.verificationStatus === "Approved") {
        stopVerificationPolling();
        diditMessage = "Identity verification approved. Loading your plan options…";
        go(requiredRoute());
      }
    }, 8000);
  };

  const show = name => {
    views.forEach(view => { view.hidden = view.dataset.view !== name; });
    document.title = `${TITLES[name] || SITE} — ${SITE}`;
    $$('[data-seg]').forEach(link => {
      if (link.dataset.seg === name) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    if (name !== "verify") stopVerificationPolling();
    const heading = $(`[data-view="${name}"] h1`);
    if (heading) heading.focus({ preventScroll: true });
  };
  const go = route => {
    if (location.hash === `#/${route}`) render();
    else location.hash = `#/${route}`;
  };
  const currentRoute = () => {
    const match = location.hash.match(/^#\/(login|register|email-verify|verify|plans|dashboard)\/?$/);
    return match ? match[1] : null;
  };
  const requiredRoute = () => {
    if (!authed) return currentRoute() === "register" ? "register" : "login";
    if (emailVerified === false) return "email-verify";
    if (onboarding.verificationStatus !== "Approved") return "verify";
    if (!onboarding.membershipPlan) return "plans";
    return "dashboard";
  };
  const describeError = (code, description) => {
    const lower = String(code || "").toLowerCase();
    if (lower === "access_denied") return { message: "Sign-in was cancelled. You can try again whenever you're ready." };
    if (lower === "err_code_exchange" || lower === "err_state_parse") return { message: "We couldn't finish signing you in. Please try again.", detail: description || code };
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
    const values = (items || []).map(displayFn).filter(Boolean);
    if (!values.length) {
      const span = document.createElement("span");
      span.className = "nxt-muted-chip";
      span.textContent = emptyText;
      container.append(span);
      return;
    }
    values.slice(0, 8).forEach(label => {
      const span = document.createElement("span"); span.className = "nxt-chip"; span.textContent = label; container.append(span);
    });
    if (values.length > 8) {
      const span = document.createElement("span"); span.className = "nxt-muted-chip"; span.textContent = `+${values.length - 8} more`; container.append(span);
    }
  };
  const getPlanName = roles => {
    const keys = (roles || []).map(keyForRole).filter(Boolean).map(value => value.toLowerCase());
    const match = Object.entries(planRoleMap).find(([key]) => keys.includes(String(key).toLowerCase()));
    return match ? String(match[1]) : "";
  };
  const selectedPlanName = () => {
    const selected = onboarding.membershipPlan;
    if (selected) return ({ free: "Free", standard: "Standard", pro: "Pro" })[selected] || selected.charAt(0).toUpperCase() + selected.slice(1);
    return getPlanName(accessMeta.roles);
  };

  const fillDashboard = () => {
    const email = String(user && user.email || "");
    const name = String(user && (user.given_name || user.name) || email.split("@")[0] || "member");
    safeText("#dashName", name); safeText("#dashEmail", email); safeText("#avatar", (name.trim()[0] || "?").toUpperCase());
    safeText("#dashOrganization", accessMeta.orgCode || "Personal workspace");
    safeText("#dashOrgDetail", accessMeta.orgCodes.length ? `${accessMeta.orgCodes.length} organization${accessMeta.orgCodes.length === 1 ? "" : "s"} available to your account.` : "No organization membership is assigned yet.");

    const emailOK = emailVerified === true;
    const identityOK = onboarding.verificationStatus === "Approved";
    const verificationText = identityOK ? "Identity verified" : `Identity ${onboarding.verificationStatus.toLowerCase()}`;
    const pill = $("#dashVerificationPill");
    if (pill) {
      pill.textContent = emailOK ? `Email + identity verified` : verificationText;
      pill.classList.toggle("is-verified", identityOK);
      pill.classList.toggle("is-pending", !identityOK);
    }
    safeText("#dashAccountStatus", emailOK ? "Email + identity verified" : verificationText);
    safeText("#dashVerificationDetail", identityOK
      ? `Didit approved this verification${onboarding.verifiedAt ? ` on ${new Date(onboarding.verifiedAt).toLocaleDateString()}` : ""}.`
      : `Current Didit status: ${onboarding.verificationStatus}.`);

    const planName = selectedPlanName();
    safeText("#dashPlan", planName || "Not assigned");
    safeText("#dashPlanDetail", onboarding.membershipPlan
      ? `Your selected membership is ${planName}.`
      : planName ? `Mapped from your Kinde role (${accessMeta.roles.map(keyForRole).filter(Boolean).join(", ")}).` : "A membership plan has not been selected.");
    safeText("#dashPlanHero", planName ? `${planName} plan` : "Plan setup pending");
    tagList("#dashRoles", accessMeta.roles, "No roles returned");
    tagList("#dashPermissions", accessMeta.permissions, "No permissions returned", item => typeof item === "string" ? item : String(item && (item.key || item.name) || ""));
    tagList("#dashGroups", accessMeta.groups, "No groups claim detected", item => typeof item === "string" ? item : String(item && (item.name || item.key || item.id) || ""));
    const note = $("#dashNote");
    if (note) {
      if (welcome) {
        note.textContent = welcome === "register" ? "Welcome to NxtSpace. Identity verification is complete and your plan is selected." : "Welcome back. You're signed in to NxtSpace.";
        note.hidden = false;
      } else note.hidden = true;
    }
  };
  const fillEmailVerify = () => safeText("#verifyEmailAddress", user && user.email || "");
  const fillIdentityVerify = () => {
    const status = onboarding.verificationStatus || "Not Started";
    safeText("#diditStatusLabel", status);
    const msg = $("#diditVerifyMessage");
    if (msg) {
      msg.textContent = diditMessage || (onboardingError ? `Could not check status: ${onboardingError}` : "Start the secure Didit identity verification to continue.");
      msg.classList.toggle("is-error", Boolean(onboardingError && status !== "Approved"));
    }
    const startButton = $("#startDiditVerification");
    if (startButton) {
      startButton.disabled = status === "Approved";
      startButton.textContent = status === "Declined" ? "Try identity verification again" : status === "Approved" ? "Identity verified" : status === "Pending" || status === "In Review" ? "Continue verification" : "Start identity verification";
    }
    if (status === "Pending" || status === "In Review") verificationPollingEnabled = true;
    const fallback = $("#diditFallbackLink");
    if (fallback && !fallback.dataset.sessionUrl) fallback.hidden = true;
  };
  const fillPlans = () => {
    safeText("#plansVerificationNotice", `Identity verification approved${onboarding.verifiedAt ? ` on ${new Date(onboarding.verifiedAt).toLocaleDateString()}` : ""}.`);
    safeText("#plansMessage", "");
    const msg = $("#plansMessage"); if (msg) msg.hidden = true;
  };
  const fillSetup = () => {
    const msg = $("#setupMsg"), steps = $("#setupSteps");
    if (onFile) {
      msg.textContent = "Authentication can't run from a local file. Serve this folder over HTTP, then open the account page from that address.";
      steps.replaceChildren();
      const li = document.createElement("li"); li.append("Run ");
      const code = document.createElement("code"); code.textContent = "python3 -m http.server 5500"; li.append(code, " in this folder and open ");
      const url = document.createElement("code"); url.textContent = "http://127.0.0.1:5500/account.html"; li.append(url, "."); steps.append(li); return;
    }
    msg.textContent = "Connect Kinde and deploy the NxtSpace onboarding API before enabling registration.";
    safeText("#setupUrl", redirectUri);
  };

  function render() {
    if (!configured) { fillSetup(); show("setup"); return; }
    if (failure) {
      safeText("#errorMsg", failure.message);
      const detail = $("#errorDetail");
      if (detail) { detail.textContent = failure.detail || ""; detail.hidden = !failure.detail; }
      show("error"); return;
    }
    if (!kinde) { show("loading"); return; }
    const route = requiredRoute();
    if (location.hash !== `#/${route}`) history.replaceState(null, "", `${location.pathname}${location.search}#/${route}`);
    if (route === "dashboard") fillDashboard();
    if (route === "email-verify") fillEmailVerify();
    if (route === "verify") { fillIdentityVerify(); startVerificationPolling(); }
    if (route === "plans") fillPlans();
    show(route);
    if (route === "verify" && verificationPollingEnabled) startVerificationPolling();
  }

  const resetButtons = () => {
    $$('form[data-form] button[type="submit"]').forEach(button => {
      button.disabled = false;
      if (button.dataset.label) button.textContent = button.dataset.label;
    });
  };
  const start = async (kind, form) => {
    const input = form.elements.email; const error = $(".err", form); const email = input.value.trim();
    error.textContent = "";
    if (!email || !EMAIL_RE.test(email)) { error.textContent = "Enter a valid email address."; input.focus(); return; }
    if (!kinde) return;
    const button = $('button[type="submit"]', form); button.dataset.label = button.textContent; button.disabled = true; button.textContent = "Opening secure sign-in…";
    const options = { app_state: { intent: kind }, loginHint: email };
    try { if (kind === "register") await kinde.register(options); else await kinde.login(options); }
    catch (errorObject) {
      console.error(errorObject); resetButtons(); error.textContent = "We couldn't start sign-in. Please check your connection and try again.";
    }
  };

  const startDiditVerification = async () => {
    const button = $("#startDiditVerification"); const fallback = $("#diditFallbackLink");
    if (button) { button.disabled = true; button.textContent = "Preparing secure verification…"; }
    diditMessage = "Preparing your secure Didit verification session…"; onboardingError = ""; fillIdentityVerify();
    // Open synchronously in the user gesture to avoid popup blockers during the API request.
    let popup = null;
    try { popup = window.open("about:blank", "_blank"); if (popup) popup.opener = null; } catch { popup = null; }
    try {
      const data = await apiRequest("/api/verification/session", { method: "POST", body: {} });
      if (data.alreadyVerified) {
        onboarding.verificationStatus = data.verificationStatus || "Approved";
        await refreshOnboardingStatus({ showMessage: true });
        verificationPollingEnabled = false; go(requiredRoute()); return;
      }
      if (!data.url || typeof data.url !== "string") throw new Error("Didit did not return a verification link.");
      onboarding.verificationStatus = data.status || "Pending";
      diditMessage = "Complete the verification steps in Didit, then return here. We’ll update this page when Didit confirms the result.";
      if (fallback) { fallback.href = data.url; fallback.hidden = false; fallback.dataset.sessionUrl = data.url; }
      verificationPollingEnabled = true;
      if (popup) {
        try { popup.location.href = data.url; }
        catch { diditMessage += " If the new tab did not open, use the verification link below."; }
      } else {
        diditMessage += " Your browser blocked the new tab; use the link below to continue.";
      }
      startVerificationPolling();
    } catch (error) {
      if (popup && !popup.closed) popup.close();
      onboardingError = error && error.message || "Could not create a Didit session.";
      diditMessage = `Could not start identity verification: ${onboardingError}`;
    } finally {
      if (button) { button.disabled = onboarding.verificationStatus === "Approved"; button.textContent = onboarding.verificationStatus === "Declined" ? "Try identity verification again" : onboarding.verificationStatus === "Pending" || onboarding.verificationStatus === "In Review" ? "Continue verification" : onboarding.verificationStatus === "Approved" ? "Identity verified" : "Start identity verification"; }
      fillIdentityVerify();
    }
  };
  const checkDiditStatus = async () => {
    const button = $("#refreshVerificationStatus"); if (button) { button.disabled = true; button.textContent = "Checking…"; }
    const success = await refreshOnboardingStatus({ showMessage: true });
    if (success && onboarding.verificationStatus === "Approved") {
      diditMessage = "Identity verification approved. Choose your plan to continue.";
      verificationPollingEnabled = false; stopVerificationPolling(); go(requiredRoute());
    } else {
      if (success) diditMessage = `Latest Didit status: ${onboarding.verificationStatus}. If you just completed the check, allow a moment for Didit to send its verification result.`;
      fillIdentityVerify();
    }
    if (button) { button.disabled = false; button.textContent = "I've completed verification"; }
  };
  const showPlansMessage = message => {
    const element = $("#plansMessage");
    if (!element) return;
    element.textContent = message; element.hidden = !message;
  };
  const continueFree = async button => {
    if (button) { button.disabled = true; button.textContent = "Saving your choice…"; }
    showPlansMessage("");
    try {
      const data = await apiRequest("/api/plans/free", { method: "POST", body: {} });
      onboarding.membershipPlan = String(data.membershipPlan || "free").toLowerCase();
      onboarding.membershipPlanSelectedAt = data.membershipPlanSelectedAt || null;
      welcome = welcome || "register";
      await loadAccessMeta();
      go(requiredRoute());
    } catch (error) { showPlansMessage(error && error.message || "Could not select the Free plan. Please retry."); }
    finally { if (button) { button.disabled = false; button.textContent = "Continue with Free"; } }
  };
  const purchasePlan = tier => {
    const url = String(checkoutUrls[tier] || "").trim();
    if (!url) { showPlansMessage(`Checkout for ${tier === "standard" ? "Standard" : "Pro"} is not connected yet. Add planCheckoutUrls.${tier} to kinde-config.js after setting up your checkout page.`); return; }
    try {
      const parsed = new URL(url, location.origin);
      const isLocalHost = ["localhost", "127.0.0.1"].includes(parsed.hostname);
      if (parsed.protocol !== "https:" && !(isLocalHost && parsed.protocol === "http:")) throw new Error("The checkout URL must use HTTPS.");
      const opened = window.open(parsed.href, "_blank", "noopener,noreferrer");
      if (!opened) showPlansMessage("Your browser blocked the checkout tab. Allow pop-ups for NxtSpace and try again.");
      else showPlansMessage("Finish checkout in the new tab. Your paid membership will activate after the payment provider confirms the payment.");
    } catch (error) { showPlansMessage(error.message || "That checkout URL is invalid."); }
  };

  const onRedirect = (_user, appState) => {
    const intent = appState && appState.intent; welcome = intent === "register" ? "register" : "login";
    if (kinde) {
      syncAuth().then(async () => { if (authed && emailVerified !== false) await refreshOnboardingStatus(); render(); })
        .catch(error => { console.error("[account] could not refresh session after Kinde redirect:", error); render(); });
    }
  };
  const onError = props => {
    const code = props && props.error;
    if (code === "ERR_GET_USER_PROFILE") { console.warn("[account] couldn't restore the previous session:", props.errorDescription); return; }
    if (!failure) setFailure(code, props && props.errorDescription);
  };
  const cleanUrl = () => {
    const url = new URL(location.href); let changed = false;
    ["code", "state", "error", "error_description"].forEach(key => { if (url.searchParams.has(key)) { url.searchParams.delete(key); changed = true; } });
    if (changed) history.replaceState(null, "", url.pathname + (url.search || "") + url.hash);
  };

  const init = async () => {
    $$('form[data-form]').forEach(form => form.addEventListener("submit", event => { event.preventDefault(); start(form.dataset.form, form); }));
    const logout = async button => {
      if (button) button.disabled = true;
      try { if (kinde) await kinde.logout(); else location.href = `${redirectUri}#/login`; }
      catch (error) { console.error(error); if (button) button.disabled = false; }
    };
    ["#logoutBtn", "#verifyLogoutBtn", "#verifyIdentityLogoutBtn", "#plansLogoutBtn"].forEach(selector => $(selector)?.addEventListener("click", function () { logout(this); }));
    $("#retryBtn")?.addEventListener("click", () => { failure = null; if (kinde) go("login"); else location.reload(); });
    $("#startDiditVerification")?.addEventListener("click", startDiditVerification);
    $("#refreshVerificationStatus")?.addEventListener("click", checkDiditStatus);
    $("#continueFreeBtn")?.addEventListener("click", function () { continueFree(this); });
    $("#purchaseStandardBtn")?.addEventListener("click", () => purchasePlan("standard"));
    $("#purchaseProBtn")?.addEventListener("click", () => purchasePlan("pro"));
    window.addEventListener("hashchange", render);
    window.addEventListener("pageshow", event => { if (event.persisted) resetButtons(); });

    if (!configured) { render(); return; }
    show("loading");
    const query = new URLSearchParams(location.search);
    if (query.get("error")) failure = describeError(query.get("error"), query.get("error_description"));
    const factory = window.createKindeClient && (window.createKindeClient.default || window.createKindeClient);
    if (typeof factory !== "function") {
      failure = { message: "The sign-in library didn't load. Check your connection and reload this page." }; render(); return;
    }
    try {
      kinde = await factory({
        client_id: clientId, domain, redirect_uri: redirectUri, logout_uri: redirectUri,
        is_dangerously_use_local_storage: cfg.useLocalStorage === true,
        on_redirect_callback: onRedirect, on_error_callback: onError
      });
      await syncAuth();
      if (authed && emailVerified !== false) await refreshOnboardingStatus({ showMessage: true });
    } catch (error) {
      console.error(error); kinde = null;
      failure = { message: "We couldn't reach the sign-in service. Please try again in a moment.", detail: String(error && error.message || error) };
    }
    cleanUrl(); render();
  };
  init();
})();
