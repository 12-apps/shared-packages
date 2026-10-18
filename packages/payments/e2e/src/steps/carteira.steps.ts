import { expect, type Page } from '@playwright/test';

import { VALID_CPF, fillCard } from '../helpers/checkout.js';
import { paymentsWorld } from '../world.js';

import { Given, Then, When } from './fixtures.js';

/**
 * PAYING WITH A DIGITAL WALLET (FUT-471, FUT-472, FUT-3685).
 *
 * A wallet store opens on the ONE list (`paymentList`): the CPF asked once at
 * the top, then "PAGAMENTO RÁPIDO" — the wallet buttons — above the rows. The
 * wallet is not a fourth method: its press opens the sheet and raises a CARD
 * order behind it, and never changes the chosen row. A store that does NOT
 * declare a wallet may still be a tabs checkout, so the steps that assert an
 * absence look for both shapes of the button.
 *
 * The button element itself is rendered by the wallet's own script (brand
 * rules), inside the package's `google-pay-button` container — a host
 * satisfies the store shape by installing a `google.payments.api` stub before
 * the checkout loads, which the shipped button picks up without a network
 * request.
 */

/**
 * The list's top (the CPF and "PAGAMENTO RÁPIDO") is a chunk of its own
 * (FUT-3711): wait for it to land before asking what it shows — an absence
 * read while it loads proves nothing, and a field looked for then is missed.
 */
async function topSettled(page: Page): Promise<void> {
  await expect(page.getByTestId('list-top-loading')).toHaveCount(0);
}

Given('a compradora abre o checkout de uma loja com Google Pay', async ({ page }) => {
  await paymentsWorld().open(page, 'google-pay');
});

Given('a compradora abre o checkout de uma loja com Apple Pay', async ({ page }) => {
  await paymentsWorld().open(page, 'apple-pay');
});

/** The SAME store shape, on a device without Apple Pay (any non-Safari). */
Given(
  'a compradora abre o checkout da loja com Apple Pay num aparelho sem Apple Pay',
  async ({ page }) => {
    await paymentsWorld().open(page, 'apple-pay-unsupported');
  },
);

When('ela informa o CPF no topo do pagamento', async ({ page }) => {
  // Asked once, above the wallets — never a Dados step first (FUT-3685).
  await expect(page.getByTestId('payment-list')).toBeVisible();
  await topSettled(page);
  const cpf = page.getByTestId('list-buyer-taxId');
  if ((await cpf.count()) > 0) await cpf.fill(VALID_CPF);
});

When('ela paga com o Google Pay em pagamento rápido', async ({ page }) => {
  // Google's own button, drawn inside the package's mount point.
  await page.getByTestId('list-google-pay').getByRole('button').click();
});

When('ela paga com o Apple Pay em pagamento rápido', async ({ page }) => {
  await page.getByTestId('list-apple-pay').click();
});

When('ela paga com um cartão novo pela lista', async ({ page }) => {
  await page.getByTestId('list-option-CARD-radio').check();
  await fillCard(page);
  // "Pagar" turns into the five-second bar; nothing is sent until it fills.
  await page.getByTestId('list-pay').click();
  await expect(page.getByTestId('list-charge-bar')).toBeVisible();
});

Then('a carteira espera o CPF', async ({ page }) => {
  // Held, with the bar's own reason under the buttons — the sheet cannot ask for it.
  // Each button stays reachable, disabled and described by that reason.
  await expect(page.getByTestId('list-wallets-held')).toBeVisible();
  for (const button of await page.getByTestId('list-wallet-buttons').getByRole('button').all()) {
    await expect(button).toBeDisabled();
  }
});

Then('ela vê o botão do Google Pay em pagamento rápido', async ({ page }) => {
  await expect(page.getByTestId('list-wallets')).toBeVisible();
  await expect(page.getByTestId('list-google-pay')).toBeVisible();
  await expect(page.getByTestId('list-google-pay').getByRole('button')).toBeEnabled();
});

Then('ela vê o botão do Apple Pay em pagamento rápido', async ({ page }) => {
  await expect(page.getByTestId('list-wallets')).toBeVisible();
  await expect(page.getByTestId('list-apple-pay')).toBeEnabled();
});

Then('as formas de pagar continuam abaixo da carteira', async ({ page }) => {
  // The wallet is a shortcut above the rows, not a replacement for them.
  await expect(page.getByTestId('list-option-CARD')).toBeVisible();
});

Then('não há pagamento rápido na tela', async ({ page }) => {
  await topSettled(page);
  // No heading, no buttons, no divider — not an empty block.
  await expect(page.getByTestId('list-wallets')).toHaveCount(0);
});

Then('nenhum botão do Google Pay é mostrado', async ({ page }) => {
  await topSettled(page);
  await expect(page.getByTestId('google-pay-button')).toHaveCount(0);
  await expect(page.getByTestId('list-google-pay')).toHaveCount(0);
});

Then('nenhum botão do Apple Pay é mostrado', async ({ page }) => {
  await topSettled(page);
  await expect(page.getByTestId('apple-pay-button')).toHaveCount(0);
  await expect(page.getByTestId('list-apple-pay')).toHaveCount(0);
});

Then('a cobrança enviada ao provedor carrega a carteira do Google', async ({ page }) => {
  // What the PROVIDER received, not what the client recorded sending: hosts
  // tag a provider-charge line with `wallet:<TYPE>` when the charge's card
  // block carried a wallet instrument, the same way the card line carries
  // `tok:`. This is the line that fails if the mount stops reading the flat
  // wallet body — the sheet then produced a token the charge never carried.
  await expect(paymentsWorld().wire.providerCharges(page)).toContainText('wallet:GOOGLE_PAY');
});

Then('a cobrança enviada ao provedor carrega a carteira da Apple', async ({ page }) => {
  await expect(paymentsWorld().wire.providerCharges(page)).toContainText('wallet:APPLE_PAY');
});
