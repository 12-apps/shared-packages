import { expect } from '@playwright/test';

import { openCase, openPage } from '../helpers/checkout';

import { Given } from './fixtures';

/**
 * WHICH STORE a scenario is set in (FUT-743).
 *
 * Every one of these is a fact about the MERCHANT — what it connected, what
 * that provider does, whether it charges online at all — and none of them is a
 * fact about the buyer. They are separate from the buyer's own steps for that
 * reason: the same journey is worth telling in several stores, and a Given that
 * mixed the two would have to be rewritten per store.
 *
 * Each maps to a case on a harness page, and each case is a real
 * `createPaymentFlowsBE` mount with a locally declared provider chain. Nothing
 * here stubs a screen.
 */

Given('a compradora abre o checkout da loja {string}', async ({ page, journey }, slug: string) => {
  journey.open(slug);
  await openPage(page, slug);
});

Given('a loja ainda não recebeu o pagamento', async ({ page }) => {
  await openCase(page, 'awaiting');
});

Given('a loja confirma o pagamento na primeira consulta', async ({ page }) => {
  await openCase(page, 'settles');
});

Given('o provedor da loja recusa o cartão', async ({ page }) => {
  await openCase(page, 'declined');
});

/** Nothing can prove whether the money moved, and the provider answers no probe. */
Given('o provedor da loja não responde de forma conclusiva', async ({ page }) => {
  await openCase(page, 'unresolved');
});

/** Provably nothing left the building — the walk may advance, and finds nobody. */
Given('o provedor da loja está fora do ar', async ({ page }) => {
  await openCase(page, 'unavailable');
});

Given('a loja não tem provedor nenhum conectado', async ({ page }) => {
  await openCase(page, 'empty-chain');
});

Given('a loja não tem provedor nenhum e oferece chamar o garçom', async ({ page }) => {
  await openCase(page, 'empty-chain-remedy');
});

/**
 * The chain is live and the config read succeeds. Only the application knows
 * this store has switched online payments off, so only the application can say.
 */
Given('a loja tem provedor mas desligou os pagamentos online', async ({ page }) => {
  await openCase(page, 'host-veto');
  await expect(page.getByTestId('wire-paths')).toHaveText('GET /api/checkout/config');
});

Given('a loja tem dois provedores que geram token no navegador', async ({ page }) => {
  await openCase(page, 'two-mintable');
});

Given(
  'a loja tem um provedor de página externa seguido de um que gera token',
  async ({ page }) => {
    await openCase(page, 'redirect-head');
  },
);
