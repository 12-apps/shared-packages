import type { JSX, ReactNode } from 'react';

import { createWebAuth } from '@12-apps/auth/react';
import { PT_BR, PT_BR_PAGES } from '@12-apps/auth/react';
import type { createWebEmailAuth } from '@12-apps/auth/react';
import { createEmailAuthSettingsClient, PT_BR_SETTINGS } from '@12-apps/auth/react';
import { authManifest, authPlatformManifest } from '@12-apps/auth/manifest';
import { authPlatformWebManifest, authWebManifest } from '@12-apps/auth/manifest/web';

import { webWiringHost } from '../wiring-web';

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
 *  - `createWebAuthSettings` — the operator console for the two platform
 *    switches, as the record its area row names.
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

/**
 * This SPA's link, for the footers the packaged PAGES render.
 *
 * The one thing a package genuinely cannot own: which router a host uses. This
 * one routes on the hash, so an `<a href>` IS the router.
 */
function HashLink({
  to,
  children,
  ...rest
}: {
  to: string;
  children: ReactNode;
  'data-testid'?: string;
  style?: Record<string, string | number>;
}): JSX.Element {
  return (
    <a href={to.startsWith('#') ? to : `#${to}`} {...rest}>
      {children}
    </a>
  );
}

/**
 * The browser half, adopted through `@12-apps/wiring/consumer`.
 *
 * `createWebEmailAuth` replaces the three-factory composition this file used to
 * perform by hand, and the package added it for exactly that reason: the recipe
 * — build the transport, hand it to the screens, hand THOSE to the pages — is a
 * thing hosts get subtly wrong, and forgetting `useSession` renders two sign-in
 * forms that cannot sign anybody in with nothing red until somebody tries.
 *
 * The manifest also carries the AREAS: the five sign-in screens across the two
 * areas that show them, and the backoffice's three — which deliberately exclude
 * sign-UP, because an operator account is granted rather than self-served. A
 * direct factory call collects none of that.
 */
const { surface: authSurface } = webWiringHost.adoptWeb({
  manifest: authManifest,
  web: authWebManifest,
  // The world this package DECLARES, and this host really runs it:
  // playwright.config.ts compiles its journeys under this root. The manifest
  // says why the declaration exists — the first host adoption re-derived the
  // whole mail-sink world by hand without discovering `./e2e` existed.
  e2e: { featuresRoot: '.features-gen' },
  bindings: {
    surface: {
      config: {
        basePath: `${AUTH_BASE}/email`,
        copy: PT_BR,
        pages: PT_BR_PAGES,
        // The SHELL's session hook, so a form signs somebody in through the
        // same session the rest of the app reads. A second one would sign them
        // in and leave every other page still showing them signed out.
        useSession: webAuth.useSession,
        Link: HashLink,
        routes: { login: AUTH_ROUTES.login, signup: AUTH_ROUTES.signup },
      },
    },
  },
});

export const authScreens = authSurface as ReturnType<typeof createWebEmailAuth>;
export const emailAuth = authScreens.client;

/**
 * The operator console. Its transport is separate from `emailAuth`'s because
 * the endpoint is: those two switches turn a sign-in method off for everybody,
 * so a real host gates them for platform staff at a path of their own.
 */
const { surface: settingsSurface } = webWiringHost.adoptWeb({
  manifest: authPlatformManifest,
  web: authPlatformWebManifest,
  bindings: {
    surface: {
      config: {
        client: createEmailAuthSettingsClient({ basePath: '/api/platform/auth-settings' }),
        copy: PT_BR_SETTINGS,
        // The host's, because a date format is a locale decision the package
        // refuses to guess.
        formatWhen: (iso: string) => new Date(iso).toLocaleString('pt-BR'),
      },
    },
  },
});

/**
 * The console, looked up BY THE NAME its area row carries.
 *
 * `authPlatformWebManifest` suggests `{ path: 'auth-settings', screen: 'page' }`,
 * and a screen name is a key of the built surface — so this is the lookup the
 * manifest's own row describes, rather than a cast that happens to agree with
 * it. It used to cast the surface back to the component's own type while the
 * surface WAS the component, which is exactly how the mismatch stayed
 * invisible: the one adopter never asked the manifest what it said.
 */
export const AuthSettingsScreen = settingsSurface.page;


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
