import { defineWebManifest } from "@12-apps/wiring/producer";

import { createWebEmailAuth } from "../react/create-web-email-auth";
import { createEmailAuthSettingsScreen } from "../react/settings";
import { authManifest, authPlatformManifest } from "./index";

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
 */

/** The five sign-in screens, in the two areas that show them. */
export const authWebManifest = defineWebManifest(authManifest, {
  name: "@12-apps/auth",
  surface: { create: createWebEmailAuth },
  areas: [
    {
      // The shopper's app. All five, because a buyer can arrive at any of them
      // from a mail link rather than from inside the app.
      area: "storefront",
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
});

/**
 * The operator console, and the one nav entry it needs.
 *
 * It sits in the PLATFORM block rather than under a tenant because sign-in
 * happens before a tenant is known.
 */
export const authPlatformWebManifest = defineWebManifest(authPlatformManifest, {
  name: "@12-apps/auth-platform",
  surface: { create: createEmailAuthSettingsScreen },
  areas: [
    {
      area: "super-admin",
      routes: [{ path: "auth-settings", screen: "page" }],
      nav: [{ testId: "auth-settings", path: "auth-settings" }],
    },
  ],
});
