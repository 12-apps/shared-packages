import type { HarnessPage } from './registry';

import { AuthAccountPage } from './auth-account';
import { AuthForgotPasswordPage } from './auth-forgot-password';
import { AuthLoginPage } from './auth-login';
import { AuthResetPasswordPage } from './auth-reset-password';
import { AuthSettingsPage } from './auth-settings';
import { AuthSignupPage } from './auth-signup';
import { AuthVerifyPage } from './auth-verify';

/**
 * `@12-apps/auth`'s pages, as two exports the registry spreads in (12-25).
 *
 * They live here rather than inline for one boring reason: seven entries and
 * seven imports pushed `registry.ts` past the 400-line file cap. The registry
 * still names them — spreading `AUTH_PAGES` is one line there, and the promise
 * that adding a page is one edit in one file holds for every other package.
 *
 * @12-apps/auth is the exception the registry's own rule already carries for
 * payments: ONE page per package, unless the package's screens are aspects of
 * one thing. Here they genuinely are, and it needs six URLs regardless — a
 * confirmation mail has to land on one specific page and a reset mail on
 * another, so the six cannot collapse into one the way a checkout's flows can.
 */

/** Everything the six buyer-facing screens share. */
const AUTH_SCREEN = {
  pkg: '@12-apps/auth',
  group: 'storefront',
  parent: 'auth',
} as const;

/**
 * The six sign-in screens, under the nav's `auth` parent.
 *
 * Titles name only what VARIES; the parent row already says "Sign-in". Each is
 * a factory's component with the host passing a destination — see
 * `src/auth/surface.ts`, which is the WHOLE frontend integration.
 */
export const AUTH_PAGES: readonly HarnessPage[] = [
  { ...AUTH_SCREEN, slug: 'auth-login', title: 'Entrar', Component: AuthLoginPage },
  { ...AUTH_SCREEN, slug: 'auth-signup', title: 'Criar conta', Component: AuthSignupPage },
  {
    ...AUTH_SCREEN,
    slug: 'auth-forgot-password',
    title: 'Esqueci a senha',
    Component: AuthForgotPasswordPage,
  },
  {
    ...AUTH_SCREEN,
    slug: 'auth-reset-password',
    title: 'Nova senha',
    Component: AuthResetPasswordPage,
  },
  { ...AUTH_SCREEN, slug: 'auth-verify', title: 'Confirmar e-mail', Component: AuthVerifyPage },
  { ...AUTH_SCREEN, slug: 'auth-account', title: 'Minha conta', Component: AuthAccountPage },
];

/**
 * The OPERATOR half, and deliberately not under the `auth` parent above: those
 * six are a shopper's screens, this one turns a sign-in method off for
 * everybody.
 */
export const AUTH_SETTINGS_PAGE: HarnessPage = {
  slug: 'auth-settings',
  title: 'Login settings',
  pkg: '@12-apps/auth',
  group: 'backoffice',
  Component: AuthSettingsPage,
};
