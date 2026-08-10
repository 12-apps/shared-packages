import { expect, test } from '@playwright/test';

import { DECLINE_PAN, fillCard, fillCpf, openPage } from './helpers/checkout';
import { enabledToggle, openAdminCase, openProvider } from './helpers/admin';

/**
 * The activation charge's HARNESS-OWNED facts (FUT-689) — what the packaged
 * journey cannot assert portably: that a decline and its retry reached the
 * provider under DIFFERENT references (the FUT-679 per-attempt rule — a
 * constant reference replayed the first refusal onto every retry), and that
 * the refund actually hit the adapter. The journey in
 * `activating-a-provider.feature` owns the owner-visible half.
 */

/** `provider:status:reference:token` — the activation probe's line shape. */
function referenceOf(line: string): string {
  return line.split(':')[2] ?? '';
}

test.describe('provider activation — the demo admin surface', () => {
  test('a decline then a retry are two charges with their own references, and the cent comes back', async ({
    page,
  }) => {
    await openPage(page, 'payments-provider-activation');
    await openAdminCase(page, 'unproven');
    await openProvider(page, 'aurora');

    // The refused card first — the reason is named, nothing is enabled.
    await fillCard(page, DECLINE_PAN);
    await fillCpf(page);
    await page.getByTestId('activation-pay').click();
    await expect(page.getByTestId('activation-error')).toContainText('CARD_DECLINED');
    await expect(enabledToggle(page)).not.toBeChecked();

    // The retry, with a good card: paid, refunded, switch on.
    await fillCard(page);
    await page.getByTestId('activation-pay').click();
    await expect(page.getByTestId('activation-result')).toBeVisible();
    await expect(page.getByTestId('activation-refunded')).toContainText('estornado');
    await expect(enabledToggle(page)).toBeChecked();

    // TWO charges, each under its own reference — the retry was a fresh
    // charge at the provider, not the first attempt replayed.
    await expect(page.getByTestId('provider-charge-count')).toHaveText('2');
    const raw = (await page.getByTestId('provider-charges').textContent()) ?? '';
    const references = raw.split(',').map(referenceOf);
    expect(references).toHaveLength(2);
    expect(references[0]).not.toBe(references[1]);
    // And the cent came back through the adapter's own refund seam.
    await expect(page.getByTestId('activation-refunds')).not.toHaveText('(none)');
  });

  test('a raw enable without proof is refused by the server, not just by the screen', async ({
    page,
  }) => {
    await openPage(page, 'payments-provider-activation');
    await openAdminCase(page, 'unproven');
    await openProvider(page, 'aurora');

    await expect(enabledToggle(page)).toBeDisabled();
    await page.getByTestId('activation-enable-attempt').click();
    await expect(page.getByTestId('activation-enable-refusal')).toContainText(
      '409 UnprovenProviderError',
    );
  });
});
