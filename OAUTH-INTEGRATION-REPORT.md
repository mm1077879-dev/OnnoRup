# Google Identity Services Integration

Google sign-in uses Google Identity Services (GIS) ID-token credentials. The frontend receives Google's signed ID token through the GIS callback and sends only that credential to `POST /api/auth/google`. The server verifies it and issues the application's existing JWT. No Google access token is treated as an application login credential.

Facebook sign-in remains a separate, unchanged integration.

## Configuration

- `GOOGLE_CLIENT_ID` is required in the backend runtime environment. It is returned by `GET /api/auth/oauth-status` for GIS initialization and is also the required token audience on the server. A Client ID is public; never put a Client Secret in frontend code or a `VITE_*` variable.
- This GIS ID-token flow does not use `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`, or an application OAuth callback route. Those values are not required for Google sign-in in this implementation.
- In Google Cloud Console, configure the OAuth client as a **Web application** and add each exact website origin under **Authorized JavaScript origins**. For local development, use the actual origin serving the app (commonly `http://localhost:3000`). For deployment, use the configured production origin, including its scheme and any non-default port.
- **Authorized redirect URIs** are not required for this GIS credential flow. Do not register the website root as a redirect URI to make this flow work.
- No production domain is inferred here. Add the actual deployed website origin to the Google Cloud Console and set `GOOGLE_CLIENT_ID` in that deployment's backend environment.

## Authentication and account handling

1. The auth modal loads GIS and renders Google's interactive sign-in button. Clicking it returns an ID-token credential through the GIS callback; sign-in does not depend on the One Tap prompt.
2. GIS returns an ID-token credential to the frontend callback; there is no app-owned OAuth popup polling, hash parsing, or callback-page redirect.
3. The backend verifies the token signature, issuer, expiration, audience, required identity claims, and verified email using Google's `google-auth-library`.
4. An existing account with the same Google subject is authenticated. A matching verified email can be linked to an unlinked existing account without changing its password or role. If that email is linked to a different Google subject, authentication is rejected.
5. A first-time identity is persisted as a customer account. The backend then returns the normal application JWT and user profile, and the existing authentication session flow restores cart and wishlist state.

The established email/password login, registration, and JWT session storage remain unchanged.

## Operational checks

- `GET /api/auth/oauth-status` reports whether `GOOGLE_CLIENT_ID` is configured.
- The browser origin must exactly match an authorized JavaScript origin in Google Cloud Console.
- `POST /api/auth/google` accepts only an ID-token `credential`; access-token-only requests are rejected.
- A production deployment also requires the existing persistent database configuration and `JWT_SECRET`. Live sign-in must be exercised with the deployment's actual Google Cloud Console client; a build alone does not verify Google Console settings or external authentication.
