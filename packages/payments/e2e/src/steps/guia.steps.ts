import { expect } from '@playwright/test';

import { paymentsWorld } from '../world.js';

import { Given, Then } from './fixtures.js';

/**
 * THE WALKTHROUGH SPEAKS IN THE HOST'S NAME (FUT-760/761).
 *
 * Two shipped guides addressed the platform by name mid-instruction and
 * carried ONE adopter's brand while doing it, so every other adopter rendered
 * a stranger's product name on its own settings screen. `brandName` on
 * `SetupGuideContext` is the seam; these steps are the journey-level proof
 * that the seam is actually the source of the word on screen.
 *
 * Neither step names a brand. The positive one asks the host what it calls
 * itself (`fixtures.platformBrand`) and requires exactly that to appear; the
 * negative one requires that no KNOWN adopter of this package appears at all.
 * The second is the load-bearing one: a guide that interpolates the host once
 * and hardcodes somebody else two steps later satisfies the first and is still
 * the bug.
 */

/** Products known to install this package. None may reach a host's screen. */
const ADOPTER_NAMES = /future[\s_-]?pay|paladira/i;

/** The packaged guide surface — the same test id in every host. */
const GUIDE = 'payments-setup-guide';

Given('o lojista abre o passo a passo de um provedor com guia', async ({ page }) => {
  await paymentsWorld().open(page, 'setup-guide');
  await expect(page.getByTestId(GUIDE)).toBeVisible();
});

Then('o passo a passo trata a plataforma pelo nome que o anfitrião deu', async ({ page }) => {
  await expect(page.getByTestId(GUIDE)).toContainText(paymentsWorld().fixtures.platformBrand);
});

Then('a tela não cita nenhum outro produto que instale este pacote', async ({ page }) => {
  const rendered = await page.getByTestId(GUIDE).innerText();
  expect(rendered).not.toMatch(ADOPTER_NAMES);
});
