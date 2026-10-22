# NxtSpace: Kinde + Didit onboarding and temporary dashboard

This package implements this flow:

1. A visitor creates an account or signs in through Kinde.
2. The page checks the Kinde email-verification claim when available. If Kinde explicitly says the email is not verified, the user is shown the email-verification gate.
3. The signed-in user starts a Didit identity-verification session created by the backend.
4. Didit's signed webhook updates the user's Kinde custom properties. The browser never decides that a verification succeeded.
5. Once the backend reads `Approved`, the user may choose Free or open a configured Standard/Pro checkout page.
6. Free selection is stored as a Kinde user property. Paid plans are **not** marked active by this package; connect your payment provider's verified webhook before doing that.
7. The temporary dashboard displays account, verification, plan, role, permission, organization, and optional group-claim information.

The animated constellation layer is included as `constellation-bg.js` and is kept in this package.

## Package contents

- `account.html`, `account.js`: Kinde sign-in, onboarding gates, plan screen, temporary dashboard.
- `dashboard.css`: dashboard/constellation-related style overrides.
- `constellation-bg.js`: animated full-page network background; follows reduced-motion preferences.
- `kinde-config.example.js`: browser-safe configuration template. Copy/merge its fields into your real `kinde-config.js` and keep your actual Client ID, domain, and callback URLs.
- `style.css`, `script.js`, `kinde-auth-pkce-js.umd.min.js`: copies of the provided site assets for convenience. Check these against your live site before replacing them.
- `server.js`, `package.json`: Node.js onboarding API.
- `.env.example`: backend environment-variable template.

## Part A — configure Kinde

### 1. Frontend application

- Use your existing Kinde Front-end and mobile application (PKCE JavaScript app).
- Keep your actual Client ID and Kinde domain in `kinde-config.js`.
- Ensure `account.html`'s exact URL is in Allowed callback URLs and Allowed logout redirect URLs.
- Ensure the sign-in methods you want to offer are enabled in your Kinde application. The frontend does not require an email Connection ID. Depending on your Kinde authentication configuration, Kinde may still host the credential-entry step.
- Set `apiBaseUrl` to the public HTTPS origin of the deployed backend, with no trailing slash (example: `https://nxtspace-api.example.com`).

### 2. Create Kinde user properties

Create these custom user properties in Kinde before testing. Use String/Text for each property:

- `identity_verification_status`
- `identity_verification_session_id`
- `identity_verified_at`
- `membership_plan`
- `membership_plan_selected_at`

The backend stores the minimum verification metadata needed for the workflow: status, Didit session reference, verification timestamp, and the selected plan. It does not intentionally store verification images or identity-document contents.

### 3. Management API credentials

Create/configure a Kinde Machine-to-Machine application for the Management API. Grant only the user-property read/update scopes supported by your environment (the sample requests `read:user_properties update:user_properties`). Put its Client ID and Client Secret in the backend environment only. **Never put the M2M secret in `kinde-config.js` or browser code.**

Create plan roles if desired using these suggested role keys:

- `nxtspace_free`
- `nxtspace_standard`
- `nxtspace_pro`

The dashboard maps these role keys to display labels. This package stores the selected Free plan in a user property; it does not automatically create/assign Kinde roles. Add role assignment in a trusted backend if that is part of your entitlement design. Use roles/permissions to represent feature access, and reserve organizations for separate workspaces/teams. Groups are optional; the UI only displays a groups claim if you configure one in the token.

## Part B — configure Didit

1. In Didit, create/select the workflow your users must complete.
2. Obtain the API key and workflow ID.
3. Deploy this backend to a Node.js 20+ host that supports environment variables and HTTPS.
4. Set the backend variables from `.env.example` (explained below).
5. In Didit, configure the webhook destination URL as `https://YOUR_ONBOARDING_API_HOST/api/didit/webhook`. Subscribe to the `status.updated` event (and optionally the session-specific events handled by this sample).
6. Copy Didit's webhook destination shared secret to `DIDIT_WEBHOOK_SECRET`. The server checks the V2 signature and timestamp before writing to Kinde.
7. Configure the Didit workflow and run a test session. A successful return to the website alone does not count as approval; the signed webhook is authoritative.

The server uses Didit's v3 session endpoint (`POST /v3/session/`) and ties the session to the signed-in Kinde user through `vendor_data`.

## Part C — deploy the backend

Requirements: Node.js 20 or later.

1. Copy `.env.example` to `.env` for local testing, or add the same variables in your hosting provider's secret/environment settings.
2. Fill in:
   - `KINDE_DOMAIN`: your Kinde domain, without a trailing slash.
   - `KINDE_M2M_CLIENT_ID` and `KINDE_M2M_CLIENT_SECRET`: server-only M2M credentials.
   - `DIDIT_API_BASE_URL`: normally `https://verification.didit.me`.
   - `DIDIT_API_KEY`, `DIDIT_WORKFLOW_ID`, `DIDIT_WEBHOOK_SECRET`: Didit values.
   - `APP_ORIGINS`: comma-separated exact website origins, e.g. `https://yourname.github.io,https://your-custom-domain.example`. Do not include paths.
3. Run `npm install`, then `npm start`.
4. Confirm `https://YOUR_ONBOARDING_API_HOST/health` returns JSON with `"ok": true`.
5. Set `apiBaseUrl` in the browser-side `kinde-config.js` to that backend origin. This must be public HTTPS in production.

A suitable host must accept inbound Didit webhook requests. A static-only host such as GitHub Pages cannot run `server.js`; host the frontend and backend separately if you use GitHub Pages.

## Part D — configure the browser app

Merge fields from `kinde-config.example.js` into the existing `kinde-config.js`, keeping your real values:

```js
window.NXTSPACE = {
  kinde: {
    clientId: "YOUR_REAL_KINDE_CLIENT_ID",
    domain: "https://YOUR_SUBDOMAIN.kinde.com",
    redirectUri: "https://YOUR_SITE/account.html",
    apiBaseUrl: "https://YOUR_ONBOARDING_API_HOST",
    useLocalStorage: false,
    planRoleMap: {
      "nxtspace_free": "Free",
      "nxtspace_standard": "Standard",
      "nxtspace_pro": "Pro"
    },
    groupClaimName: "groups",
    planCheckoutUrls: { standard: "", pro: "" }
  }
};
```

Do not deploy placeholder values. If using the older `window.NXTECH.kinde` wrapper, the code supports that wrapper too, but the renamed brand/config shown above is preferred.

## Part E — configure paid checkout

Set `planCheckoutUrls.standard` and `planCheckoutUrls.pro` to the HTTPS checkout pages you actually use. Leave them blank while checkout is not ready. This sample only opens the checkout URL; it does not verify payment or activate paid access. Implement a payment-provider webhook on the backend before storing/assigning paid membership.

## Test checklist

- Sign up with a test email and verify the email step behaves according to your Kinde application configuration.
- Complete Didit and confirm the webhook is received with a valid signature.
- Verify the six Kinde properties are created/updated for the correct user.
- Confirm an unapproved user cannot select Free by calling the server endpoint directly.
- Confirm an approved user can select Free and the dashboard shows that choice.
- Test declined, pending, in-review, and approved Didit statuses.
- Test mobile layout, theme toggle, logout, and reduced-motion preference.
- Make sure paid content is protected by backend authorization. Frontend role labels are display-only and can be altered in the browser.

## Notes / limitations

- Didit webhook events may take a short time to arrive. The page polls the trusted status API while the user is on the verification screen.
- Kinde claim exposure depends on your application/tenant configuration. If `email_verified` is not returned, this code does not guess its value; configure Kinde to enforce email verification as appropriate.
- Groups are not a standard SDK method here. To display groups, add a `groups` custom claim or change `groupClaimName` to your configured claim.
- This is a temporary onboarding/dashboard foundation, not a complete billing system.
