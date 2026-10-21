# NxtSpace account flow + temporary dashboard

This patch is based on the current Kinde-enabled account page. It keeps `account.html` and `account.js` as a single-page flow with `#/login`, `#/register`, `#/dashboard`, and `#/verify` routes, and adds a full-page constellation background.

## Important note about the stylesheet

The original `style.css` was not included in the uploaded files. Keep your existing `style.css` in your website folder; **do not replace it** with `dashboard.css`. The account page loads `dashboard.css` immediately after `style.css` as a set of focused overrides. The constellation layer uses a canvas and follows your existing `--primary` and `--primary-2` CSS variables where available.

## Files to copy

Copy these files into the same folder as your current `account.html`:

- `account.html` — updated NxtSpace branding, temporary dashboard, and verification-pending view.
- `account.js` — authentication state, dashboard population, and optional Kinde role/permission/organization/group-claim display.
- `dashboard.css` — additional styles for the temporary dashboard and translucent constellation backdrop.
- `constellation-bg.js` — animated full-screen network background; respects reduced-motion preferences.
- `kinde-config.example.js` — configuration example only. Merge fields into your existing `kinde-config.js`; don't use the placeholder Client ID/domain in production. The revised code supports the new `window.NXTSPACE` name and falls back to the earlier `window.NXTECH` global.

Keep your existing `style.css` unchanged. Unmodified copies of `script.js` and `kinde-auth-pkce-js.umd.min.js` are included in the ZIP for convenience; you can keep using the copies already in your site folder if they match.

## Kinde plan role setup

A reasonable starter role-key naming scheme is:

- `nxtspace_free`
- `nxtspace_standard`
- `nxtspace_pro`

The dashboard maps those role keys to display names. If your roles use different keys, change the keys under `planRoleMap` in your real `kinde-config.js`. The page reads roles from an available Kinde role helper, a token claim, or the user-scoped `account_api/v1/roles` endpoint. It reads permissions and organization codes from the JavaScript SDK. A groups label appears only when a `groups` token custom claim is actually available; this browser SDK has no standard `getGroups()` method.

### Roles vs organizations vs groups

- **Roles/permissions:** best for deciding which features a user may access.
- **Organizations:** use for separate workspaces/teams that have their own members and access context—not merely as a synonym for each pricing tier.
- **Groups:** optional grouping information; displaying a group requires a claim or endpoint that your Kinde setup actually exposes.

The dashboard is a display-only preview. **Never protect paid content or sensitive endpoints only with front-end role checks.** A user can modify browser JavaScript. Enforce plan entitlement and authorization in a trusted backend before releasing paid content or accepting privileged actions.

## Verification behavior

After the Kinde authentication callback, the page syncs the signed-in user and routes to the dashboard. If Kinde explicitly returns `email_verified: false` in the ID-token claim, the dashboard is withheld and a verification-pending view is shown. If Kinde does not return that claim, the page does not guess; Kinde's configured authentication policy remains responsible for verification enforcement.

## Site branding and assets

The account page branding is updated to NxtSpace. Header/footer links still point at `index.html` and `research.html` as they did previously. Only the account page was supplied for editing, so include `dashboard.css` and `constellation-bg.js` on any other page where you also want the same full-screen constellation background.

## Deploy checklist

1. Back up your current account files.
2. Copy the patch files to the same directory as the existing account page.
3. Keep the current `style.css`, `script.js`, and Kinde SDK bundle.
4. Merge `planRoleMap` and `groupClaimName` into `kinde-config.js`, retaining your real Kinde Client ID, domain, redirect URL, and connection ID.
5. Create the role keys in Kinde, assign them to test users, and sign in with a test account.
6. Confirm callback and logout URLs still match the deployed `account.html` address in Kinde.
7. Test both light/dark themes, mobile layout, verified and unverified states, and logout.
