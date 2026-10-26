import { expect, type Page } from '@playwright/test';

import { paymentsWorld } from '../world.js';

/**
 * The wire carried the config read and nothing that writes (FUT-4028). A read
 * beside it is no payable: the list also reads the buyer's saved cards
 * (`GET /api/checkout/cards`), where the tabs read the config alone. Every
 * recorded line is a GET, however a host separates them (`,` or a new line).
 */
export async function expectOnlyReads(page: Page): Promise<void> {
  const paths = paymentsWorld().wire.paths(page);
  await expect(paths).toContainText('GET /api/checkout/config');
  await expect(paths).toHaveText(/^GET \S+(?:[,\s]+GET \S+)*$/);
}
