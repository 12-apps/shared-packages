import type { BrowserContext, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { defineAuthWorld, type SentAuthEmail } from '@12-apps/auth/e2e';

import { AUTH_OPERATOR_EMAIL } from '../../../../backend/src/auth-db';
import { HARNESS_BACKEND_ORIGIN } from '../../../../backend/src/port';

/**
 * THIS APP'S half of the packaged sign-in journeys (12-25).
 *
 * The scenarios and their steps ship inside `@12-apps/auth/e2e`; none of them
 * is copied here, and none of them knows what a harness page is. What is
 * host-specific is exactly what this file supplies: how an account comes to
 * exist, how the two platform switches are flipped, how you read what your
 * mailer sent, and where this app puts its four screens.
 *
 * That is the integration a real consumer performs too — a storefront would
 * seed a tenant's user where this POSTs to `/__harness`, and would route to
 * `/login` where this routes to `#/auth-login`. The features do not change.
 *
 * It lives in the `steps` glob on purpose: playwright-bdd imports every step
 * file before any scenario runs, so the `defineAuthWorld` call below lands in
 * every worker before the first Given executes.
 */

/**
 * The suite's controls answer on the BACKEND's origin.
 *
 * `page.request` shares the browser context's cookie jar, which is what
 * `signInAs` needs — a cookie set through it is a cookie the next `page.goto`
 * sends. It does NOT go through Vite's proxy, so these URLs are absolute where
 * the packaged steps' own `/api/...` calls are relative and proxied.
 */
const control = (path: string): string => `${HARNESS_BACKEND_ORIGIN}${path}`;

/** Flip one platform switch. Both go through the package's own endpoint. */
async function setSwitch(page: Page, patch: Record<string, boolean>): Promise<void> {
  // Signed in as the operator first: the settings endpoints are session-gated,
  // and a host that let an anonymous caller turn e-mail sign-in off for
  // everybody would be the bug those two routes exist to prevent.
  await page.request.post(control('/__harness/auth/sign-in-as'), {
    data: { email: AUTH_OPERATOR_EMAIL },
  });
  const response = await page.request.put('/api/platform/auth-settings', { data: patch });
  expect(response.ok(), `flipping ${Object.keys(patch)} failed: ${await response.text()}`).toBe(
    true,
  );
}

defineAuthWorld({
  seedUser: async (page, user) => {
    const response = await page.request.post(control('/__harness/auth/seed-user'), {
      data: { email: user.email, name: user.name, emailVerified: user.emailVerified },
    });
    expect(response.ok(), `seeding ${user.email} failed: ${await response.text()}`).toBe(true);
  },

  setEmailAuthEnabled: (page, enabled) => setSwitch(page, { enabled }),
  setRequireVerification: (page, required) => setSwitch(page, { requireEmailVerification: required }),

  /**
   * What the mailer actually sent, out of the table it wrote to.
   *
   * A REQUEST rather than a file read, which is why the port is async. The
   * harness's outbox is a Postgres table (`auth_sent_mail`) — a synchronous
   * signature would have forced it to be a file, and that is a constraint no
   * adopter's mailer should inherit from a test harness.
   */
  lastMail: async (email, subjectContains) => {
    const response = await fetch(
      control(`/__harness/auth/mail?email=${encodeURIComponent(email)}`),
    );
    const { messages } = (await response.json()) as { messages: SentAuthEmail[] };
    // Newest first out of the endpoint, so `find` IS "the last one sent".
    return messages.find(
      (message) => !subjectContains || message.subject.includes(subjectContains),
    );
  },

  /**
   * Take a session without a password.
   *
   * The two scenarios that need this open on an account that signed up with
   * Google and has never had one, so there is no password to sign in with and
   * this deployment has no OAuth provider to hand off to. The backend's
   * `resolveUserId` accepts a host cookie for exactly this — see
   * `HOST_SESSION_COOKIE` in `auth-host.ts` for why that is a stand-in rather
   * than a way around the subject.
   */
  signInAs: async (context: BrowserContext, email: string) => {
    const response = await context.request.post(control('/__harness/auth/sign-in-as'), {
      data: { email },
    });
    expect(response.ok(), `signing in as ${email} failed`).toBe(true);
  },

  /** Both cookies at once: the host's stand-in AND whatever Auth.js minted. */
  signOut: async (context: BrowserContext) => {
    await context.clearCookies();
  },

  paths: {
    login: '/#/auth-login',
    signup: '/#/auth-signup',
    forgotPassword: '/#/auth-forgot-password',
    account: '/#/auth-account',
  },

  /**
   * The subjects `PT_BR_MAIL` uses. The pack is the package's, but WHICH pack
   * this deployment renders with is the host's decision, so the fragments are
   * named here rather than assumed by the steps.
   */
  subjects: {
    verify: 'Confirme seu e-mail',
    reset: 'Redefinir sua senha',
    alreadyRegistered: 'Você já tem uma conta',
  },
});
