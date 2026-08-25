import { expect, type Page } from '@playwright/test';
import { defineDiscountsWorld } from '@12-apps/discounts/e2e';

/**
 * THIS APP'S half of the packaged promotions journeys.
 *
 * The scenarios and their steps ship inside `@12-apps/discounts`; none of them
 * is copied here, and none of them knows what a harness page is. What is
 * host-specific is exactly what this file supplies: which URL the promotions
 * screen lives at, how to get back to a known state, and how a percentage reads
 * once this host has formatted it.
 *
 * That is the integration a real consumer performs too — an admin app routes to
 * `/{tenantSlug}/discounts` where this routes to `#/discounts`. The features do
 * not change.
 *
 * It lives in the `steps` glob on purpose: playwright-bdd imports every step
 * file before any scenario runs, so the `defineDiscountsWorld` call below lands
 * in every worker before the first Given executes.
 */

const PAGE_URL = '#/discounts';

defineDiscountsWorld({
  /**
   * These journeys WRITE — they compose, rename and delete promotions — so the
   * reset is the load-bearing half rather than hygiene: a scenario that renamed
   * a promotion would otherwise hand the next one a catalog it did not expect.
   */
  signInAsManager: async (page: Page) => {
    const response = await page.request.post('/__harness/reset');
    expect(response.status()).toBe(204);
  },

  openDiscountsScreen: async (page: Page) => {
    await page.goto(PAGE_URL);
    await expect(page.getByTestId('discounts-grid')).toBeVisible();
  },

  fixtures: {
    /**
     * Minted fresh per call: the promotions table carries a per-tenant unique
     * index on the name, so a constant would collide with itself on the second
     * scenario and on every re-run against the same database.
     */
    newName: (prefix: string) => `${prefix} ${Date.now()}`,
    percent: '15',
    /**
     * How this host renders that rate once saved. Stated here because
     * formatting is the host's — `createWebDiscounts` takes a locale and a
     * currency, so the same 15 reads differently in two adopters.
     */
    percentInGrid: '15%',
  },
});
