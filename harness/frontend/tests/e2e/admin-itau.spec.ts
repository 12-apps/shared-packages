import { expect, test } from '@playwright/test';

import { openAdminCase, openProvider } from './helpers/admin';
import { openPage } from './helpers/checkout';

/**
 * Itau through the PUBLISHED settings screen: the one vendor whose production
 * connection is a client certificate and its private key, pasted as PEM.
 *
 * A single-line input folds a PEM's newlines away, and OpenSSL refuses what is
 * left — so the owner "pasted the whole file" and was told it was unreadable.
 * The two fields must be textareas. And like its siblings, the provider ships
 * a walkthrough, because the webhook has to be registered by hand.
 */

test('production asks for the certificate and its private key, as multi-line fields', async ({ page }) => {
  await openPage(page, 'payments-provider-settings');
  await openAdminCase(page, 'catalog');
  await openProvider(page, 'itau');
  await page.getByTestId('payments-environment-tabs').getByRole('tab').last().click();

  for (const key of ['certificate', 'privateKey']) {
    await expect(page.locator(`textarea#payments-credential-${key}`)).toBeVisible();
  }
  for (const key of ['clientId', 'clientSecret', 'pixKey']) {
    await expect(page.locator(`input#payments-credential-${key}`)).toBeVisible();
  }
});

test('the sandbox, which has no mTLS, does not ask for them', async ({ page }) => {
  await openPage(page, 'payments-provider-settings');
  await openAdminCase(page, 'catalog');
  await openProvider(page, 'itau');

  await expect(page.locator('input#payments-credential-clientId')).toBeVisible();
  await expect(page.locator('#payments-credential-certificate')).toHaveCount(0);
});

test('it ships a setup guide, like the providers beside it', async ({ page }) => {
  await openPage(page, 'payments-provider-settings');
  await openAdminCase(page, 'guides');
  await openProvider(page, 'itau');

  await expect(page.getByTestId('payments-setup-guide')).toBeVisible();
  await expect(page.locator('[data-testid^="payments-setup-section-"]')).toBeVisible();
});

test('on the narrowest phone, the guide portal button stays inside its step', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await openPage(page, 'payments-provider-settings');
  await openAdminCase(page, 'guides');
  await openProvider(page, 'itau');

  const button = page.getByRole('link', { name: /Abrir o portal do desenvolvedor/ });
  await expect(button).toBeVisible();
  // The step row is the button's parent: its label is the longest of any
  // guide's, and at 320px it used to run 47px past the step's border.
  const spill = await button.evaluate((element) => {
    const own = element.getBoundingClientRect();
    const row = (element.parentElement as HTMLElement).getBoundingClientRect();
    return Math.max(own.right - row.right, row.left - own.left);
  });
  expect(spill).toBeLessThanOrEqual(0.5);
});
