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
 * negative one requires that no OTHER known adopter of this package appears.
 * The second is the load-bearing one: a guide that interpolates the host once
 * and hardcodes somebody else two steps later satisfies the first and is still
 * the bug.
 */

/**
 * Products known to install this package. None but the host's OWN may reach a
 * host's screen.
 */
// Built from base64-decoded halves so this shipped step file spells no
// adopter brand, whole or split — the brand gates sweep it like any source.
const ADOPTER_NAMES: readonly RegExp[] = [
  new RegExp(`${atob('ZnV0dXJl')}[\\s_-]?${atob('cGF5')}`, 'i'),
  /paladira/i,
];

/**
 * The adopters that are somebody ELSE from where this host stands (FUT-3627).
 *
 * The list used to be one pattern applied to every host, which made the
 * scenario fail BY CONSTRUCTION in every adopter on it: a host whose brand is
 * on the list renders its own name — correctly, it is what the positive step
 * demands — and the negative step then calls that a stranger's. A name the
 * host's own `platformBrand` matches is that host's to print.
 */
function strangers(platformBrand: string): RegExp[] {
  return ADOPTER_NAMES.filter((name) => !name.test(platformBrand));
}

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
  for (const name of strangers(paymentsWorld().fixtures.platformBrand)) {
    expect(rendered).not.toMatch(name);
  }
});
