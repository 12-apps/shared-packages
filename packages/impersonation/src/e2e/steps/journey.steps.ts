import { expect } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { impersonationWorld, type ImpersonationSubjectFixture } from '../world.js';

/**
 * The packaged journeys' step definitions.
 *
 * Every locator here is a test id THIS package's own components render, which is
 * what makes the scenarios portable: `impersonation-banner`,
 * `impersonation-confirm` and `impersonation-blocker` mean the same thing in any
 * app that mounts `createWebImpersonation`. Everything a host owns — where the
 * start affordance lives, how a preview is picked, what its sentences say —
 * arrives through the world port rather than being written down here.
 */
const { Given, When, Then } = createBdd();

const banner = 'impersonation-banner';

Given('I have no session in force', async ({ page }) => {
  await impersonationWorld().reset(page);
});

When('I open the start dialog for an ordinary user', async ({ page }) => {
  const world = impersonationWorld();
  await world.openStartDialog(page, world.fixtures.target);
  await expect(page.getByTestId('impersonation-dialog')).toBeVisible();
});

When('I open the start dialog for another platform account', async ({ page }) => {
  const world = impersonationWorld();
  const subject: ImpersonationSubjectFixture = world.fixtures.platformTarget;
  await world.openStartDialog(page, subject);
  await expect(page.getByTestId('impersonation-dialog')).toBeVisible();
});

Then('I cannot start the session yet', async ({ page }) => {
  await expect(page.getByTestId('impersonation-confirm')).toBeDisabled();
});

Then('I can start the session', async ({ page }) => {
  await expect(page.getByTestId('impersonation-confirm')).toBeEnabled();
});

Then('I am told to choose the tenant first', async ({ page }) => {
  await expect(page.getByTestId('impersonation-blocker')).toContainText(
    impersonationWorld().fixtures.copy.tenantMissing,
  );
});

Then('I am told how long the reason has to be', async ({ page }) => {
  await expect(page.getByTestId('impersonation-blocker')).toContainText(
    impersonationWorld().fixtures.copy.reasonTooShort,
  );
});

/**
 * The click targets the COMBOBOX, never the field wrapper the test id sits on.
 *
 * The packaged `Select` puts its test id on the form-control root, and the
 * tenant list is fetched when the dialog mounts — so the control renders
 * disabled until it arrives while the wrapper never is. A click on the wrapper
 * always "succeeds" while the disabled control underneath swallows it and the
 * menu never opens: a silent no-op the scenario only learns about when the
 * option it waits for never appears. Clicking the combobox makes Playwright's
 * own actionability wait for a real condition instead.
 */
When('I choose the tenant', async ({ page }) => {
  const { optionLabel } = impersonationWorld().fixtures.tenant;
  await page.getByTestId('impersonation-tenant').getByRole('combobox').click();
  await page.getByRole('option', { name: optionLabel }).click();
});

When('I write a reason that is too short', async ({ page }) => {
  await page
    .getByTestId('impersonation-reason')
    .fill(impersonationWorld().fixtures.shortReason);
});

When('I write a full reason', async ({ page }) => {
  await page
    .getByTestId('impersonation-reason')
    .fill(impersonationWorld().fixtures.validReason);
});

Then('the dialog says the session will be read-only', async ({ page }) => {
  await expect(page.getByTestId('impersonation-readonly-note')).toBeVisible();
});

When('I start the session', async ({ page }) => {
  await page.getByTestId('impersonation-confirm').click();
});

Then("the start is refused in the server's own words", async ({ page }) => {
  await expect(page.getByTestId('impersonation-error')).toContainText(
    impersonationWorld().fixtures.copy.platformTargetRefusal,
  );
});

Then('the dialog is still open', async ({ page }) => {
  await expect(page.getByTestId('impersonation-dialog')).toBeVisible();
});

Then('a session banner is showing', async ({ page }) => {
  await expect(page.getByTestId(banner)).toBeVisible();
});

Then('no session banner is showing', async ({ page }) => {
  // Wrapped in the auto-retrying assertion rather than a bare count check: the
  // bar comes down on the NEXT state read, which is a round trip away.
  await expect(page.getByTestId(banner)).toHaveCount(0);
});

Then('the banner names the person I am acting as', async ({ page }) => {
  await expect(page.getByTestId('impersonation-banner-title')).toContainText(
    impersonationWorld().fixtures.target.label,
  );
});

Then('the banner is counting down', async ({ page }) => {
  // A time REMAINING, not a fixed string: the chip's wording is the host's, so
  // what is asserted is that it carries a live `m:ss` and that it moves.
  const remaining = page.getByTestId('impersonation-banner-remaining');
  await expect(remaining).toContainText(/\d+:\d{2}/);
  const first = await remaining.textContent();
  await expect(remaining).not.toHaveText(first ?? '', { timeout: 5000 });
});

When('I open an ordinary screen', async ({ page }) => {
  await impersonationWorld().openGuardedScreen(page);
});

When('I preview the tenant as a role', async ({ page }) => {
  const world = impersonationWorld();
  await world.startRolePreview(page, world.fixtures.previewRole.name);
});

When('I preview the tenant as a member', async ({ page }) => {
  const world = impersonationWorld();
  await world.startMemberPreview(page, world.fixtures.previewMember.id);
});

Then('the banner names the role I am previewing', async ({ page }) => {
  await expect(page.getByTestId('impersonation-banner-title')).toContainText(
    impersonationWorld().fixtures.previewRole.label,
  );
});

Then('the banner names the member I am previewing', async ({ page }) => {
  await expect(page.getByTestId('impersonation-banner-title')).toContainText(
    impersonationWorld().fixtures.previewMember.label,
  );
});

Then('the banner says the session is read-only', async ({ page }) => {
  await expect(page.getByTestId('impersonation-banner-readonly')).toContainText(
    impersonationWorld().fixtures.copy.readOnly,
  );
});

Then('the banner does not say the session is read-only', async ({ page }) => {
  await expect(page.getByTestId('impersonation-banner-readonly')).toHaveCount(0);
});

When('I leave the session', async ({ page }) => {
  await page.getByTestId('impersonation-banner-exit').click();
});

/**
 * A slept tab, without sleeping.
 *
 * `visibilitychange` is the signal the countdown actually subscribes to, and
 * dispatching it is the only way to prove the recompute-from-the-clock rule
 * without waiting out a real suspend. The countdown re-derives from `expiresAt`
 * either way — which is exactly the property being asserted.
 */
When('the tab is hidden and shown again', async ({ page }) => {
  await page.evaluate(() => {
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
  });
});
