import type { AnyWebManifest } from "@12-apps/wiring";

import { createWebEmailAuth } from "../react/create-web-email-auth";
import { createEmailAuthSettingsScreen } from "../react/settings";

/**
 * The WEB runtime manifest — the surface factories and where each area's
 * routes and nav entries go.
 *
 * `areas` are SUGGESTIONS, projected by the host into whatever its own router
 * and sidebar want. The value is that they travel WITH the version: an area a
 * new release adds shows up in `assemble()`'s report rather than in a bug about
 * a page nobody mounted. The origin host learned that the expensive way —
 * report-builder 5.x shipped three working-copy endpoints its own client calls,
 * and the host never mounted them, so autosave 404'd with nothing red.
 *
 * Screen names are the KEYS of the built surface, so a host projecting a route
 * looks the component up rather than guessing at a name.
 *
 * Plain `satisfies`-checked values — see `./index` for why the contract package
 * stays a type-only devDependency; the inventory check against the shared
 * manifest runs in the test suite.
 */

/** The five sign-in screens, in the two areas that show them. */
export const authWebManifest = {
  name: "@12-apps/auth",
  surface: { create: createWebEmailAuth },
  areas: [
    {
      // The shopper's app. All five, because a buyer can arrive at any of them
      // from a mail link rather than from inside the app.
      // `client`, which is what `AreaContribution` documents ("`admin`,
      // `super-admin`, `client`, …"). This read `storefront` — one host's
      // name for its shopper-facing app — so a host projecting areas by the
      // contract's own ids matched nothing here and mounted no sign-in at all.
      area: "client",
      routes: [
        { path: "login", screen: "LoginPage" },
        { path: "signup", screen: "SignupPage" },
        { path: "forgot-password", screen: "ForgotPasswordScreen" },
        { path: "reset-password", screen: "ResetPasswordScreen" },
        { path: "verify-email", screen: "VerifyEmailScreen" },
      ],
    },
    {
      // The backoffice signs in and resets, but does not sign UP: an operator
      // account is granted, never self-served.
      area: "admin",
      routes: [
        { path: "login", screen: "LoginPage" },
        { path: "forgot-password", screen: "ForgotPasswordScreen" },
        { path: "reset-password", screen: "ResetPasswordScreen" },
      ],
    },
  ],
} as const satisfies AnyWebManifest;

/**
 * The operator console, and the one nav entry it needs.
 *
 * It sits in the PLATFORM block rather than under a tenant because sign-in
 * happens before a tenant is known.
 */
export const authPlatformWebManifest = {
  name: "@12-apps/auth-platform",
  surface: { create: createEmailAuthSettingsScreen },
  areas: [
    {
      area: "super-admin",
      routes: [{ path: "auth-settings", screen: "page" }],
      nav: [{ testId: "auth-settings", path: "auth-settings" }],
    },
  ],
} as const satisfies AnyWebManifest;
