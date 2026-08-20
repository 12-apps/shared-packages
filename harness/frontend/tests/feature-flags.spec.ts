import { expect, test } from '@playwright/test';

/**
 * `@12-apps/feature-flags` mounted the way a host mounts it (FUT-884): the
 * wiring consumer's web half builds the management screen once at module
 * scope (`src/pages/feature-flags.tsx`), its api client is a plain
 * same-origin `fetch` through the Vite proxy, and every click below crosses a
 * real socket into the packed tarball's own route handlers — the seam between
 * the two published halves, where neither side's unit tests look.
 *
 * The catalog and every person are the HOST's (`feature-flags-host.ts` /
 * `feature-flags-db.ts`); the chrome is the package's pt-BR default copy. The
 * whole cohort lifecycle runs here: enroll by email, the explicit opt-out
 * (`enabled: false` survives a default-on rollout, which is why pausing is
 * not revoking), revoke, and the denial for a person the directory does not
 * know.
 */

test.beforeEach(async ({ request }) => {
  // The grants store is in-memory per backend process, so a mid-spec retry
  // could otherwise find Clara already enrolled. Best-effort revoke keeps the
  // spec deterministic; 404 just means the slate was already clean.
  /* eslint-disable-next-line test-flakiness/no-unmocked-network --
     the unmocked network IS the subject (same rationale as audit-log.spec.ts
     beside this file). */
  await request.delete('/api/platform/feature-flags/delivery-beta/grants/u-clara');
});

test('the operator runs a beta cohort end-to-end', async ({ page }) => {
  await page.goto('#/feature-flags');
  await expect(page.getByTestId('page-feature-flags')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Recursos beta' })).toBeVisible();

  // The host catalog, with Ana's seeded grant tallied.
  await expect(page.getByTestId('ff-flag-delivery-beta')).toContainText('1 de 1 ativos');
  await expect(page.getByTestId('ff-flag-novo-dashboard')).toBeVisible();

  // Open the delivery beta: the seeded grant resolves to a PERSON through the
  // host directory — email on screen, not an opaque id.
  await page.getByTestId('ff-flag-delivery-beta').click();
  await expect(page.getByTestId('ff-grant-u-ana')).toContainText('ana@harness.dev');

  // Enroll Clara by email.
  await page.getByTestId('ff-add-email').fill('clara@harness.dev');
  await page.getByTestId('ff-add-note').fill('convite da operação');
  await page.getByTestId('ff-add-submit').click();
  await expect(page.getByTestId('ff-grant-u-clara')).toBeVisible();
  await expect(page.getByTestId('ff-grant-u-clara')).toContainText('root@harness.dev');
  await expect(page.getByTestId('ff-flag-delivery-beta')).toContainText('2 de 2 ativos');

  // Pause her — the explicit opt-out, not a revocation.
  await page.getByTestId('ff-toggle-u-clara').click();
  await expect(page.getByTestId('ff-grant-u-clara')).toContainText('Desativado');
  await expect(page.getByTestId('ff-flag-delivery-beta')).toContainText('1 de 2 ativos');

  // And out of the beta entirely.
  await page.getByTestId('ff-revoke-u-clara').click();
  await expect(page.getByTestId('ff-grant-u-clara')).toHaveCount(0);
  await expect(page.getByTestId('ff-flag-delivery-beta')).toContainText('1 de 1 ativos');

  // A person the directory does not know is refused with the package's own
  // words — the api client surfaces the server's pt-BR message, not a code.
  await page.getByTestId('ff-add-email').fill('quem@harness.dev');
  await page.getByTestId('ff-add-submit').click();
  await expect(page.getByTestId('ff-error')).toContainText('Nenhum usuário com este e-mail.');
});
