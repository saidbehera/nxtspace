/* NxtSpace flow: session check -> Kinde hosted auth -> email confirmation -> Didit -> Kinde self-serve billing portal. */
(() => {
  "use strict";

  const $ = (selector, context = document) => context.querySelector(selector);
  const $$ = (selector, context = document) => [...context.querySelectorAll(selector)];
  const cfg = (window.NXTSPACE && window.NXTSPACE.kinde) || (window.NXTECH && window.NXTECH.kinde) || {};
  const SITE = "NxtSpace";
  const TITLES = {
    loading: "Member access",
    "email-verify": "Verify your email",
    verify: "Verify your identity",
    error: "Access problem",
    setup: "Set up sign-in"
  };
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
  const logoutUri = String(cfg.logoutRedirectUri || "").trim() || (onFile ? "" : `${location.origin}/`);
  const configured = Boolean(clientId && domain && redirectUri && logoutUri && apiBaseUrl) && !onFile;
  const views = $$('[data-view]');

  let kinde = null;
  let user = null;
  let authed = false;
  let emailVerified = null;
  let onboarding = { verificationStatus: "Not Started", verifiedAt: null };
  let onboardingError = "";
  let diditMessage = "Start the verification process to continue.";
  let verificationPollingEnabled = false;
  let verificationPollTimer = null;
  let statusRequestRunning = false;
  let routingPromise = null;
  let portalRedirectStarted = false;
  let failure = null;

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

  const unwrapClaim = value => {
    if (value && typeof value === "object") {
      if (Object.prototype.hasOwnProperty.call(value, "value")) return value.value;
      if (Object.prototype.hasOwnProperty.call(value, "v")) return value.v;
    }
    return value;
  };

  const readStatusFromToken = async () => {
    const direct = getClaimValue("identity_verification_status", "access_token");
    if (typeof unwrapClaim(direct) === "string" && unwrapClaim(direct).trim()) return unwrapClaim(direct).trim();
    try {
      const token = await getAccessToken();
      const segment = token.split(".")[1];
      if (!segment) return "";
      const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
      const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
      const binary = window.atob(padded);
      const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
      const claims = JSON.parse(new TextDecoder().decode(bytes));
      const properties = claims.user_properties || claims.application_properties || {};
      const raw = claims.identity_verification_status ??
        properties.identity_verification_status ?? properties.kp_usr_identity_verification_status;
      const value = unwrapClaim(raw);
      return typeof value === "string" ? value.trim() : "";
    } catch { return ""; }
  };

  const getAccessToken = async () => {
    if (!kinde || typeof kinde.getAccessToken !== "function") {
      throw new Error("Your sign-in session could not provide an access token. Please sign in again.");
    }
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
      cache: "no-store",
      credentials: "omit"
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || `The NxtSpace service returned ${response.status}.`);
      error.status = response.status;
      throw error;
    }
    return data;
  };

  const show = name => {
    views.forEach(view => { view.hidden = view.dataset.view !== name; });
    document.title = `${TITLES[name] || SITE} — ${SITE}`;
    const heading = $(`[data-view="${name}"] h1`);
    if (heading) heading.focus({ preventScroll: true });
  };

  const setError = (message, detail = "", kind = "general") => {
    failure = { message, detail, kind };
    safeText("#errorMsg", message);
    const detailEl = $("#errorDetail");
    if (detailEl) {
      detailEl.textContent = detail;
      detailEl.hidden = !detail;
    }
    show("error");
  };

  const cleanAuthUrl = () => {
    const url = new URL(location.href);
    let changed = false;
    ["code", "state", "error", "error_description", "session_state"].forEach(key => {
      if (url.searchParams.has(key)) { url.searchParams.delete(key); changed = true; }
    });
    if (changed) history.replaceState(null, "", url.pathname + (url.search || "") + url.hash);
  };

  const syncAuth = async () => {
    authed = false;
    user = null;
    emailVerified = null;
    if (!kinde) return;
    authed = Boolean(await kinde.isAuthenticated());
    if (!authed) return;
    try { user = (await kinde.getUserProfile()) || kinde.getUser(); }
    catch { try { user = kinde.getUser(); } catch { user = null; } }
    const claim = getClaimValue("email_verified", "id_token");
    emailVerified = toBooleanOrNull(claim != null ? claim : user && user.email_verified);
  };

  const refreshVerificationStatus = async ({ showMessage = true } = {}) => {
    if (statusRequestRunning) return false;
    statusRequestRunning = true;
    try {
      const data = await apiRequest("/api/onboarding/status");
      onboarding = {
        verificationStatus: String(data.verificationStatus || "Not Started"),
        verifiedAt: data.verifiedAt || null
      };
      onboardingError = "";
      if (onboarding.verificationStatus === "Approved") {
        diditMessage = "Identity verification approved. Opening the self-service portal…";
      } else if (showMessage) {
        diditMessage = `Current verification status: ${onboarding.verificationStatus}.`;
      }
      return true;
    } catch (error) {
      onboardingError = error && error.message || "Could not contact the NxtSpace service.";
      // The token claim is useful as a display fallback but the backend still gates portal access.
      const tokenStatus = await readStatusFromToken();
      if (tokenStatus) onboarding.verificationStatus = tokenStatus;
      if (showMessage) diditMessage = tokenStatus
        ? `Showing the status in your current access token (${tokenStatus}). Refresh to check the latest result.`
        : `We couldn't check your verification status: ${onboardingError}`;
      return Boolean(tokenStatus);
    } finally {
      statusRequestRunning = false;
    }
  };

  const stopVerificationPolling = () => {
    if (verificationPollTimer !== null) window.clearInterval(verificationPollTimer);
    verificationPollTimer = null;
  };

  const startVerificationPolling = () => {
    if (!verificationPollingEnabled || verificationPollTimer !== null) return;
    verificationPollTimer = window.setInterval(async () => {
      if (!authed || document.visibilityState === "hidden") return;
      if (onboarding.verificationStatus === "Approved") {
        stopVerificationPolling();
        routeAfterAuth();
        return;
      }
      const refreshed = await refreshVerificationStatus({ showMessage: false });
      fillIdentityVerify();
      if (refreshed && onboarding.verificationStatus === "Approved") {
        stopVerificationPolling();
        await routeAfterAuth();
      }
    }, 8000);
  };

  const fillEmailVerify = () => safeText("#verifyEmailAddress", user && user.email || "");

  const fillIdentityVerify = () => {
    const status = onboarding.verificationStatus || "Not Started";
    safeText("#diditStatusLabel", status);
    const message = $("#diditVerifyMessage");
    if (message) {
      message.textContent = diditMessage || (onboardingError ? `Could not check status: ${onboardingError}` : "Start the secure Didit identity verification to continue.");
      message.classList.toggle("is-error", Boolean(onboardingError && status !== "Approved"));
    }
    const startButton = $("#startDiditVerification");
    if (startButton) {
      startButton.disabled = status === "Approved" || status === "In Review";
      startButton.textContent = status === "Declined" ? "Try identity verification again"
        : status === "Approved" ? "Identity verified"
        : status === "In Progress" || status === "Pending" ? "Continue verification"
        : status === "In Review" ? "Verification in review" : "Start identity verification";
    }
    const refreshButton = $("#refreshVerificationStatus");
    if (refreshButton) refreshButton.disabled = status === "Approved";
    const fallback = $("#diditFallbackLink");
    if (fallback && !fallback.dataset.sessionUrl) fallback.hidden = true;
  };

  const redirectToSelfServicePortal = async () => {
    if (portalRedirectStarted) return;
    portalRedirectStarted = true;
    stopVerificationPolling();
    show("loading");
    safeText("#loadingMessage", "Identity verified. Opening your secure self-service portal…");
    try {
      const data = await apiRequest("/api/self-service/portal", { method: "POST", body: {} });
      if (typeof data.url !== "string" || !data.url.trim()) throw new Error("Kinde did not return a self-service portal link.");
      const portalUrl = new URL(data.url);
      if (portalUrl.protocol !== "https:") throw new Error("Kinde returned an insecure portal link.");
      window.location.replace(portalUrl.toString());
    } catch (error) {
      portalRedirectStarted = false;
      setError(
        "Your identity is verified, but we couldn't open the self-service portal.",
        error && error.message || "Please try again.",
        "portal"
      );
    }
  };

  const routeAuthenticatedUser = async () => {
    if (!authed) {
      show("loading");
      safeText("#loadingMessage", "No active session. Redirecting to secure sign-in…");
      await new Promise(resolve => window.setTimeout(resolve, 650));
      if (kinde && !authed) await kinde.login({ app_state: { intent: "member-access" } });
      return;
    }
    if (emailVerified === false) {
      stopVerificationPolling();
      fillEmailVerify();
      show("email-verify");
      return;
    }

    await refreshVerificationStatus({ showMessage: true });
    if (onboarding.verificationStatus === "Approved") {
      await redirectToSelfServicePortal();
      return;
    }

    fillIdentityVerify();
    show("verify");
    verificationPollingEnabled = ["In Progress", "Pending", "In Review"].includes(onboarding.verificationStatus);
    if (verificationPollingEnabled) startVerificationPolling();
  };

  const routeAfterAuth = () => {
    if (routingPromise) return routingPromise;
    routingPromise = routeAuthenticatedUser().catch(error => {
      console.error("[account] session routing failed:", error);
      setError("We couldn't check your account session.", error && error.message || "Please try again.");
    }).finally(() => { routingPromise = null; });
    return routingPromise;
  };

  const startDiditVerification = async () => {
    const button = $("#startDiditVerification");
    const fallback = $("#diditFallbackLink");
    if (button) { button.disabled = true; button.textContent = "Preparing secure verification…"; }
    diditMessage = "Preparing your secure Didit verification session…";
    onboardingError = "";
    fillIdentityVerify();

    // Open inside the click event so popup blockers don't reject the verification tab.
    let popup = null;
    try { popup = window.open("about:blank", "_blank"); if (popup) popup.opener = null; } catch { popup = null; }
    try {
      const data = await apiRequest("/api/verification/session", { method: "POST", body: {} });
      const verificationUrl = data.verificationUrl || data.url;
      if (!verificationUrl || typeof verificationUrl !== "string") throw new Error("Didit did not return a verification link.");
      onboarding.verificationStatus = data.status || "In Progress";
      diditMessage = "Complete the steps in Didit. We'll check for the result automatically.";
      if (fallback) {
        fallback.href = verificationUrl;
        fallback.hidden = false;
        fallback.dataset.sessionUrl = verificationUrl;
      }
      verificationPollingEnabled = true;
      if (popup) {
        try { popup.location.href = verificationUrl; }
        catch { diditMessage += " If the new tab did not open, use the verification link below."; }
      } else {
        diditMessage += " Your browser blocked the new tab; use the link below to continue.";
      }
      fillIdentityVerify();
      startVerificationPolling();
    } catch (error) {
      if (popup && !popup.closed) popup.close();
      onboardingError = error && error.message || "Could not create a Didit session.";
      diditMessage = `Could not start identity verification: ${onboardingError}`;
    } finally {
      if (button) {
        button.disabled = ["Approved", "In Review"].includes(onboarding.verificationStatus);
        button.textContent = onboarding.verificationStatus === "Declined" ? "Try identity verification again"
          : ["In Progress", "Pending"].includes(onboarding.verificationStatus) ? "Continue verification"
          : onboarding.verificationStatus === "Approved" ? "Identity verified" : "Start identity verification";
      }
      fillIdentityVerify();
    }
  };

  const checkDiditStatus = async () => {
    const button = $("#refreshVerificationStatus");
    if (button) { button.disabled = true; button.textContent = "Checking…"; }
    try {
      await refreshVerificationStatus({ showMessage: true });
      if (onboarding.verificationStatus === "Approved") {
        diditMessage = "Identity verification approved. Opening the self-service portal…";
        await redirectToSelfServicePortal();
      } else {
        diditMessage = `Latest verification status: ${onboarding.verificationStatus}. If you just completed the check, allow a moment for Didit to send its result.`;
        fillIdentityVerify();
      }
    } finally {
      if (button) { button.disabled = onboarding.verificationStatus === "Approved"; button.textContent = "I've completed verification"; }
    }
  };

  const logout = async () => {
    stopVerificationPolling();
    try {
      if (kinde && typeof kinde.logout === "function") await kinde.logout();
      else window.location.assign(logoutUri || "/");
    } catch (error) {
      console.error("[account] logout failed:", error);
      setError("We couldn't sign you out.", error && error.message || "Please try again.");
    }
  };

  const onRedirect = () => {
    cleanAuthUrl();
    if (kinde) {
      syncAuth().then(routeAfterAuth).catch(error => {
        console.error("[account] could not restore the session after Kinde redirect:", error);
        setError("We couldn't finish sign-in.", error && error.message || "Please try again.");
      });
    }
  };

  const onError = props => {
    const code = props && props.error;
    const detail = props && props.errorDescription;
    if (code === "ERR_GET_USER_PROFILE") {
      console.warn("[account] Kinde profile is not available yet:", detail);
      return;
    }
    console.error("[account] Kinde sign-in error:", code, detail);
    setError(code === "access_denied" ? "Sign-in was cancelled." : "We couldn't finish signing you in.", detail || code || "Please retry.");
  };

  const fillSetup = () => {
    const msg = $("#setupMsg");
    const steps = $("#setupSteps");
    if (onFile) {
      msg.textContent = "Authentication can't run from a local file. Serve this folder over HTTP, then open the account page from that address.";
      if (steps) {
        steps.replaceChildren();
        const li = document.createElement("li");
        li.textContent = "Run python3 -m http.server 5500 in this folder and open http://127.0.0.1:5500/account.html.";
        steps.append(li);
      }
      return;
    }
    msg.textContent = "Connect Kinde and deploy the NxtSpace Vercel API before enabling member access.";
    safeText("#setupUrl", redirectUri);
  };

  const init = async () => {
    $("#startDiditVerification")?.addEventListener("click", startDiditVerification);
    $("#refreshVerificationStatus")?.addEventListener("click", checkDiditStatus);
    ["#verifyLogoutBtn", "#verifyIdentityLogoutBtn"].forEach(selector => $(selector)?.addEventListener("click", logout));
    $("#retryBtn")?.addEventListener("click", () => {
      const kind = failure && failure.kind;
      failure = null;
      if (kind === "portal" && authed) {
        portalRedirectStarted = false;
        routeAfterAuth();
      } else if (kinde) {
        show("loading");
        safeText("#loadingMessage", "Redirecting to secure sign-in…");
        kinde.login({ app_state: { intent: "member-access" } });
      } else {
        window.location.reload();
      }
    });
    window.addEventListener("pageshow", event => {
      if (event.persisted) routeAfterAuth();
    });

    if (!configured) {
      fillSetup();
      show("setup");
      return;
    }
    show("loading");
    const query = new URLSearchParams(location.search);
    if (query.get("error")) {
      const code = query.get("error");
      const description = query.get("error_description") || code;
      ["error", "error_description", "state", "code"].forEach(key => query.delete(key));
      history.replaceState(null, "", `${location.pathname}${query.toString() ? `?${query}` : ""}${location.hash}`);
      setError(code === "access_denied" ? "Sign-in was cancelled." : "Kinde returned an authentication error.", description);
      return;
    }
    const factory = window.createKindeClient && (window.createKindeClient.default || window.createKindeClient);
    if (typeof factory !== "function") {
      setError("The Kinde sign-in library didn't load.", "Check your connection and reload this page.");
      return;
    }

    try {
      kinde = await factory({
        client_id: clientId,
        domain,
        redirect_uri: redirectUri,
        logout_uri: logoutUri,
        is_dangerously_use_local_storage: cfg.useLocalStorage === true,
        on_redirect_callback: onRedirect,
        on_error_callback: onError
      });
      cleanAuthUrl();
      await syncAuth();
      if (!authed) {
        safeText("#loadingMessage", "No active session. Redirecting to secure sign-in…");
        await new Promise(resolve => window.setTimeout(resolve, 650));
        await kinde.login({ app_state: { intent: "member-access" } });
        return;
      }
      await routeAfterAuth();
    } catch (error) {
      console.error("[account] initialization failed:", error);
      setError("We couldn't reach the sign-in service.", error && error.message || "Please try again in a moment.");
    }
  };

  init();
})();
