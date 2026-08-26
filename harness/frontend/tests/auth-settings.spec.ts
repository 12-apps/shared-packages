import { expect, test } from '@playwright/test';

import { AUTH_OPERATOR_EMAIL } from '../../backend/src/auth-db';
import { HARNESS_BACKEND_ORIGIN } from '../../backend/src/port';

/**
 * The platform sign-in console renders — the assertion whose absence let a
 * manifest point at nothing (FUT-930).
 *
 * `authPlatformWebManifest` suggests one route, `{ path: 'auth-settings',
 * screen: 'page' }`, and the wiring contract's rule is that a screen name is a
 * KEY of the built surface. Its `surface.create` was
 * `createEmailAuthSettingsScreen`, which returns the component DIRECTLY — so
 * `surface['page']` was `undefined`, and a host projecting the area generically
 * would mount nothing and render a blank page with nothing in any log.
 *
 * It survived because this host cast the surface back to a component and never
 * asked the manifest what its own row said, and because no spec ever visited
 * the page. Both halves are fixed: `surface.page` is the lookup now, and this
 * is the case that would have gone red.
 *
 * What the two switches DO is the package's own unit coverage. Asserted here is
 * only what a unit test cannot see: that the published tarball's manifest, its
 * surface and this host's adoption still compose into a screen.
 */
test('the console the platform manifest names is a real screen', async ({ page }) => {
  // The two endpoints behind this screen are session-gated on the SERVER — a
  // host that let an anonymous caller turn e-mail sign-in off for everybody
  // would be the bug those routes exist to prevent. Anonymous, the screen still
  // MOUNTS and shows its load error, so this spec would pass on a defect the
  // operator would see; signing in first is what makes it assert the screen.
  /* eslint-disable-next-line test-flakiness/no-unmocked-network --
     the unmocked network IS the subject, as in audit-log.spec.ts beside this
     file: a mocked session would prove the screen renders against a stub, and
     what this case is for is that the PUBLISHED tarball composes with this
     host's adoption against the real backend. */
  const signIn = await page.request.post(
    `${HARNESS_BACKEND_ORIGIN}/__harness/auth/sign-in-as`,
    { data: { email: AUTH_OPERATOR_EMAIL } },
  );
  expect(signIn.ok(), `signing in as the operator failed: ${await signIn.text()}`).toBe(true);

  await page.goto('#/auth-settings');

  await expect(page.getByTestId('harness-page')).toHaveAttribute('data-page', 'auth-settings');

  // The method switch, rendered by the component the area row resolves to. An
  // `undefined` screen leaves the page shell with an empty body, so this
  // locator is the whole difference between the two outcomes.
  await expect(page.getByTestId('toggle-email-password')).toBeVisible();
});
