# NxTech Club — Kinde custom sign-in entry screen

This patch keeps the existing NxTech Club login/register UI and passes Kinde's email `connectionId` so Kinde can skip its initial sign-in/sign-up chooser screen.

## Important limitation

Kinde's JavaScript SDK uses a redirect-based OAuth flow. This setup does **not** make password/OTP/MFA authentication fully inline inside `account.html`: Kinde still hosts secure verification steps. Kinde does not support direct username/password login through this SDK without redirecting.

## Install

1. Back up your current `account.html` and `account.js`.
2. Replace those two files with the versions in this folder. Keep your existing `style.css` and site assets; they were not included in the uploaded files.
3. Open your existing `kinde-config.js` and merge in the `emailConnectionId` field shown in `kinde-config.example.js`. Keep your real existing Client ID, domain and redirect URI values—do not paste the example placeholders into production.
4. In the Kinde dashboard, open your application details and enable **Use your own sign-up and sign-in screens** under **Authentication experience**, then save.
5. Go to **Settings → Environment → Authentication**, open the email authentication method you use, copy its **Connection ID**, and put that exact value in `emailConnectionId`.
6. Add the full `account.html` URL to both **Allowed callback URLs** and **Allowed logout redirect URLs** in Kinde.
7. Serve the site over HTTPS in production (or localhost for development); opening `account.html` directly as a `file://` URL will not work.

## If you want the address bar to show your domain during verification

Configure a Kinde custom domain and use that domain as `domain` in `kinde-config.js`. You can also customize the remaining Kinde-hosted verification screens with Kinde's page design/custom UI settings. The browser will still navigate through an authorization flow; a custom domain changes the visible hostname/branding, not the underlying redirect-based security model.

## What changed in the code

- `account.js` now reads `NXTECH.kinde.emailConnectionId` and passes it as `connectionId` to both `login()` and `register()`.
- Email is required on the NxTech form and passed as `loginHint`, matching Kinde's custom email-auth flow.
- The setup screen explains the required connection ID and Kinde custom-auth setting.
- No password is collected by the NxTech form, and no client secret is added to the browser.
