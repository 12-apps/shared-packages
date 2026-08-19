import { createWebAuth } from '@12-apps/auth/react';
import { createEmailAuth } from '@12-apps/auth/react';
import { createEmailAuthScreens, PT_BR } from '@12-apps/auth/react/screens';
import {
  createEmailAuthSettingsClient,
  createEmailAuthSettingsScreen,
  PT_BR_SETTINGS,
} from '@12-apps/auth/react/settings';

/**
 * `@12-apps/auth`'s browser half, wired ONCE (12-25).
 *
 * Four factories, four config objects, and nothing else — which is the claim
 * the auth pages exist to check. An adopter's whole frontend integration is
 * this file:
 *
 *  - `createWebAuth` — the session, and the password sign-in that does not
 *    navigate;
 *  - `createEmailAuth` — the browser client for the eight endpoints
 *    `emailAuthRouter` mounts on the backend;
 *  - `createEmailAuthScreens` — the nine screens, bound to that client, this
 *    app's session and a copy pack;
 *  - `createEmailAuthSettingsScreen` — the operator console for the two
 *    platform switches.
 *
 * Module scope on purpose. Each factory is called once and its components are
 * imported ready-made, so no page below passes config and no component reads a
 * singleton the package could not see.
 *
 * ## The copy
 *
 * `PT_BR` and `PT_BR_SETTINGS` ship IN the package, and are still passed by
 * name here. That is the distinction their own files argue: a pack a host
 * chooses is not a default a host forgets. A harness supplying ~90 invented
 * strings would be proving that a host CAN write copy, which nobody doubted;
 * passing the shipped pack is what proves the shipped pack is complete.
 */

/** Where the backend mounted Auth.js. Must match `createApiAuth({ basePath })`. */
const AUTH_BASE = '/api/auth';

export const webAuth = createWebAuth({ basePath: AUTH_BASE });

export const emailAuth = createEmailAuth({ basePath: `${AUTH_BASE}/email` });

export const authScreens = createEmailAuthScreens({
  client: emailAuth,
  copy: PT_BR,
  // The SHELL's session hook, so a form signs somebody in through the same
  // session the rest of the app reads. A second one would sign them in and
  // leave every other page still showing them signed out.
  useSession: webAuth.useSession,
});

/**
 * The operator console. Its transport is separate from `emailAuth`'s because
 * the endpoint is: those two switches turn a sign-in method off for everybody,
 * so a real host gates them for platform staff at a path of their own.
 */
export const AuthSettingsScreen = createEmailAuthSettingsScreen({
  client: createEmailAuthSettingsClient({ basePath: '/api/platform/auth-settings' }),
  copy: PT_BR_SETTINGS,
  // The host's, because a date format is a locale decision the package refuses
  // to guess.
  formatWhen: (iso) => new Date(iso).toLocaleString('pt-BR'),
});

/**
 * Where each screen lives, as the hash routes this SPA uses.
 *
 * One table rather than seven literals: the backend builds its mail links
 * against the same three paths (`auth-host.ts`), and the e2e world names all
 * four. A path that is right in two of those and stale in the third fails as a
 * dead link, which is the exact class of bug these journeys exist to catch.
 */
export const AUTH_ROUTES = {
  login: '/#/auth-login',
  signup: '/#/auth-signup',
  forgotPassword: '/#/auth-forgot-password',
  resetPassword: '/#/auth-reset-password',
  verify: '/#/auth-verify',
  account: '/#/auth-account',
} as const;

/** Go to one of them. A plain assignment: the shell routes on `hashchange`. */
export function goTo(route: string): void {
  window.location.assign(route);
}

/**
 * The token a mail link carries.
 *
 * `location.search`, not the hash's own query. `buildTokenLink` puts the token
 * in the URL's query string, and this SPA's route is the FRAGMENT — so the link
 * arrives as `…/?token=abc#/auth-verify`. A host with real paths reads it from
 * wherever its router puts it; the package builds the same link either way.
 */
export function tokenFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get('token');
}
