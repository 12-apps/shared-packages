import { expect, test } from '@playwright/test';

/**
 * The assertion future-pay is currently failing on, made where it can be seen.
 *
 * Its admin settings page renders an EMPTY provider list against these same two
 * published packages, and nothing in either repo's CI covers the pairing: this
 * repo tests each package against its workspace siblings, and future-pay finds
 * out at e2e time. A card missing here means the published adapters and the
 * published settings page no longer compose — the exact defect, one repo earlier.
 */
const PROVIDERS = ['pagbank', 'stone', 'infinitepay', 'stripe'] as const;

test('the published adapters render as cards in the published settings page', async ({ page }) => {
  await page.goto('#/payments-provider-settings');

  // The shell renders a page per published surface; addressing it by slug means
  // this spec does not move when the nav grows.
  await expect(page.getByTestId('harness-page')).toHaveAttribute('data-page', 'payments-provider-settings');

  await expect(page.getByTestId('payments-provider-settings')).toBeVisible();

  for (const provider of PROVIDERS) {
    await expect(page.getByTestId(`payments-provider-card-${provider}`)).toBeVisible();
  }
});
