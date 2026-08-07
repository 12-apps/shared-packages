import { expect } from '@playwright/test';

import { paymentsWorld } from '../world.js';

import { Given } from './fixtures.js';

/**
 * WHICH STORE a scenario is set in (FUT-743, packaged by FUT-561).
 *
 * Every one of these is a fact about the MERCHANT — what it connected, what
 * that provider does, whether it charges online at all — and none of them is a
 * fact about the buyer. They are separate from the buyer's own steps for that
 * reason: the same journey is worth telling in several stores, and a Given that
 * mixed the two would have to be rewritten per store.
 *
 * None of them knows how a store is BUILT. Each names a shape and hands it to
 * the host's `PaymentsWorld.open`, which is the only part that differs between
 * an in-page harness and a real app seeding a tenant. That is what lets these
 * ship with the library instead of being copied into every consumer.
 */

Given('a compradora abre o checkout da loja de PIX', async ({ page }) => {
  await paymentsWorld().open(page, 'pix-only');
});

Given('a compradora abre o checkout da loja de cartão', async ({ page }) => {
  await paymentsWorld().open(page, 'card');
});

Given('a compradora abre o checkout de uma loja que aceita os dois', async ({ page }) => {
  await paymentsWorld().open(page, 'both-methods');
});

Given('a compradora abre o checkout de uma loja de página externa', async ({ page }) => {
  await paymentsWorld().open(page, 'hosted');
});

Given('a loja ainda não recebeu o pagamento', async ({ page }) => {
  await paymentsWorld().open(page, 'awaiting');
});

Given('a loja confirma o pagamento na primeira consulta', async ({ page }) => {
  await paymentsWorld().open(page, 'settles');
});

Given('o provedor da loja recusa o cartão', async ({ page }) => {
  await paymentsWorld().open(page, 'declined');
});

/** Nothing can prove whether the money moved, and the provider answers no probe. */
Given('o provedor da loja não responde de forma conclusiva', async ({ page }) => {
  await paymentsWorld().open(page, 'unresolved');
});

/** Provably nothing left the building — the walk may advance, and finds nobody. */
Given('o provedor da loja está fora do ar', async ({ page }) => {
  await paymentsWorld().open(page, 'unavailable');
});

Given('a loja não tem provedor nenhum conectado', async ({ page }) => {
  await paymentsWorld().open(page, 'no-provider');
});

Given('a loja não tem provedor nenhum e oferece chamar o garçom', async ({ page }) => {
  await paymentsWorld().open(page, 'no-provider-remedy');
});

/**
 * The chain is live and the config read succeeds. Only the application knows
 * this store has switched online payments off, so only the application can say.
 */
Given('a loja tem provedor mas desligou os pagamentos online', async ({ page }) => {
  const world = paymentsWorld();
  await world.open(page, 'payments-off');
  await expect(world.wire.paths(page)).toHaveText('GET /api/checkout/config');
});

Given('a loja tem dois provedores que geram token no navegador', async ({ page }) => {
  await paymentsWorld().open(page, 'two-mintable');
});

Given(
  'a loja tem um provedor de página externa seguido de um que gera token',
  async ({ page }) => {
    await paymentsWorld().open(page, 'redirect-head');
  },
);
