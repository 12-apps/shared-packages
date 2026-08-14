import { expect } from '@playwright/test';

import { paymentsWorld } from '../world.js';

import { Given, Then, When } from './fixtures.js';

/**
 * A DEAD OAUTH GRANT, AND THE WAY BACK (FUT-683, packaged by FUT-760).
 *
 * The merchant admin's side of the one money-path state a store cannot reach
 * on purpose: the provider refused to renew, so the connection is out of
 * rotation while the owner never switched it off.
 *
 * These steps read two vocabularies, like the activation ones:
 *
 *   - the package's OWN screens, whose test ids mean the same in any host —
 *     `payments-expiry-warning`, `payments-connect-success`, and the reconnect
 *     banner the connection panel renders;
 *   - the host's PROBE of its own stored row — `admin-status-<provider>`,
 *     `admin-enabled-<provider>`, `admin-rotation` — which is how a scenario
 *     asserts that `enabled` and the rotation genuinely disagree rather than
 *     trusting a screen to say so.
 *
 * The provider is `fixtures.oauthProvider`, never a name written here: which
 * row is dead belongs to the host's invented cast.
 */

Given('a autorização da loja com o provedor foi recusada', async ({ page }) => {
  await paymentsWorld().open(page, 'reconnect-required');
});

Then('a conexão aparece como precisando reconectar', async ({ page }) => {
  const provider = paymentsWorld().fixtures.oauthProvider;
  await expect(page.getByTestId(`admin-status-${provider}`)).toHaveText('RECONNECT_REQUIRED');
});

/**
 * The disagreement IS the state. `enabled` true and the rotation empty at the
 * same time is what stops a host from "fixing" this by asking the owner to
 * switch a live store back on.
 */
Then('ela continua ligada, mas fora da rotação', async ({ page }) => {
  const provider = paymentsWorld().fixtures.oauthProvider;
  await expect(page.getByTestId(`admin-enabled-${provider}`)).toHaveText('true');
  await expect(page.getByTestId('admin-rotation')).toHaveText('(none)');
});

When('o lojista abre a conexão do provedor', async ({ page }) => {
  const provider = paymentsWorld().fixtures.oauthProvider;
  await page.getByTestId(`payments-provider-card-${provider}`).click();
  await expect(page.getByTestId('payments-provider-back')).toBeVisible();
});

Then('ele lê que a autorização expirou ou foi revogada', async ({ page }) => {
  // The package's own banner copy — quoted because it is what the owner reads.
  await expect(page.getByText('A autorização expirou ou foi revogada.')).toBeVisible();
});

Then('ele vê desde quando', async ({ page }) => {
  await expect(page.getByTestId('payments-expiry-warning')).toBeVisible();
  await expect(page.getByTestId('payments-expiry-warning')).toContainText('A autorização expirou em');
});

When('ele reconecta e autoriza de novo', async ({ page }) => {
  await page.getByRole('button', { name: 'Reconectar' }).click();
  await page.getByTestId('admin-oauth-authorize').click();
  await expect(page.getByTestId('payments-connect-success')).toBeVisible();
});

Then('a conexão volta a estar verificada', async ({ page }) => {
  const provider = paymentsWorld().fixtures.oauthProvider;
  await expect(page.getByTestId(`admin-status-${provider}`)).toHaveText('VERIFIED');
});

/**
 * The whole point of the ticket: rotation returns on the authorize alone. If a
 * host ever has to toggle the switch to finish this, the store spent that gap
 * silently not selling.
 */
Then('a loja volta para a rotação sem ninguém ter mexido no botão', async ({ page }) => {
  const provider = paymentsWorld().fixtures.oauthProvider;
  await expect(page.getByTestId('admin-rotation')).toHaveText(provider);
  await expect(page.getByTestId(`admin-enabled-${provider}`)).toHaveText('true');
});

Then('o aviso de autorização expirada some', async ({ page }) => {
  await expect(page.getByText('A autorização expirou ou foi revogada.')).toBeHidden();
  await expect(page.getByTestId('payments-expiry-warning')).toBeHidden();
});
