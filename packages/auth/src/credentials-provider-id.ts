/**
 * The credentials provider's id, and therefore its URL:
 * `POST {basePath}/callback/{id}`.
 *
 * It lives alone in this module because BOTH halves need it and only one of
 * them may pay for it. The backend's `credentials-provider.ts` imports
 * `@auth/core/providers/credentials`; a browser bundle that reached for the
 * constant there would drag the whole of `@auth/core` — and Preact's JSX types
 * with it — into a SPA that only ever needed a five-character string in a URL.
 *
 * Change it in one place and both ends move together, which is the property
 * that matters: they are two sides of one route, and a mismatch is a 404 that
 * reads as "sign-in is broken".
 */
export const CREDENTIALS_PROVIDER_ID = "credentials";
