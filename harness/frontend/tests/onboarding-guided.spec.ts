import { expect, test } from '@playwright/test';

/**
 * The guided flow across BOTH published halves (12-23).
 *
 * What this spec is for is the seam, not the stepper. `@12-apps/onboarding` shipped
 * the React half and a repository helper; the two progress endpoints and the store
 * that talks to them were the host's, in every host, retyped each time — so a
 * `PATCH { op: 'save' }` on one side and a `POST { status }` on the other could
 * both be green in their own suites and never have spoken. Here the browser drives
 * `createOnboardingApiStore` against the real `createApiOnboarding` mount over a
 * real Postgres, so a mismatch between them fails.
 *
 * Every assertion is against the RE-READ row, not the live React state: "the step
 * was persisted" and "the step is in a useState" look identical on screen, and the
 * difference is the entire reason the server half exists.
 */

const PAGE = '#/onboarding-guided';

test.beforeEach(async ({ page }) => {
  /* eslint-disable-next-line test-flakiness/no-unmocked-network --
     the unmocked network IS the subject: this case proves the published halves
     agree over a real socket. Same rationale as entitlements-plan.spec.ts. */
  const reset = await page.request.post('/__harness/reset');
  expect(reset.status()).toBe(204);
  await page.goto(PAGE);
  await expect(page.getByTestId('onboarding-guided-page')).toBeVisible();
});

test('a first visit lands on the hero, with nothing persisted', async ({ page }) => {
  await expect(page.getByTestId('probe-status')).toHaveText('not_started');
  // `null`, not a row: the package answers the absence rather than minting one on
  // a read, so a first paint never depends on a write.
  await expect(page.getByTestId('probe-persisted')).toHaveText('null');
});

test('starting the flow persists the step, and a reload resumes there', async ({ page }) => {
  await page.getByRole('button', { name: 'Começar' }).click();
  await expect(page.getByTestId('step-choose-host')).toBeVisible();

  await page.getByTestId('probe-reread').click();
  await expect(page.getByTestId('probe-persisted')).toContainText('"step":"choose-host"');
  await expect(page.getByTestId('probe-persisted')).toContainText('"status":"in_progress"');

  // The resume point survives the tab: the provider is bootstrapped from the
  // server read, so the flow reopens where it stopped.
  await page.reload();
  await expect(page.getByTestId('step-choose-host')).toBeVisible();
  await expect(page.getByTestId('probe-step')).toHaveText('choose-host');
});

test('advancing merges the per-feature data server-side', async ({ page }) => {
  await page.getByRole('button', { name: 'Começar' }).click();
  await page.getByTestId('choose-claude').click();
  await expect(page.getByTestId('step-confirm')).toBeVisible();

  await page.getByTestId('probe-reread').click();
  const persisted = page.getByTestId('probe-persisted');
  await expect(persisted).toContainText('"step":"confirm"');
  // The payload from the PREVIOUS step is still there — the merge is the
  // repository's, and it happened over the wire rather than in the tab.
  await expect(persisted).toContainText('"selectedHost":"claude"');
});

test('completing stamps completedAt and shows the configured summary', async ({ page }) => {
  await page.getByRole('button', { name: 'Começar' }).click();
  await page.getByTestId('choose-claude').click();
  await page.getByTestId('finish').click();

  await expect(page.getByTestId('configured-summary')).toBeVisible();
  await page.getByTestId('probe-reread').click();
  const persisted = page.getByTestId('probe-persisted');
  await expect(persisted).toContainText('"status":"completed"');
  // The package stamps the timestamp; a host that had to do it would get it
  // wrong on the second save.
  await expect(persisted).not.toContainText('"completedAt":null');
});

test('going back moves the persisted step back, not just the screen', async ({ page }) => {
  await page.getByRole('button', { name: 'Começar' }).click();
  await page.getByTestId('choose-claude').click();
  await page.getByTestId('go-back').click();

  await expect(page.getByTestId('step-choose-host')).toBeVisible();
  await page.getByTestId('probe-reread').click();
  await expect(page.getByTestId('probe-persisted')).toContainText('"step":"choose-host"');
});

test('the dev reset wipes the row and returns to a clean first run', async ({ page }) => {
  await page.getByRole('button', { name: 'Começar' }).click();
  await expect(page.getByTestId('step-choose-host')).toBeVisible();

  await page.getByTestId('onboarding-guided-dev-reset').click();
  await expect(page.getByTestId('probe-status')).toHaveText('not_started');

  await page.getByTestId('probe-reread').click();
  // Really gone, not merely reading as not_started: a reset that left the row
  // would resume the moment anything wrote again.
  await expect(page.getByTestId('probe-persisted')).toHaveText('null');
});
