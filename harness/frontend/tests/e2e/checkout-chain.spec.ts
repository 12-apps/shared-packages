import { expect, test } from '@playwright/test';

import { chooseCard, fillCard, openCase, openPage, payCard, reachPayment } from './helpers/checkout';

/**
 * Card failover, asserted on the wire (FUT-743 / FUT-563).
 *
 * A card instrument is bound to whoever minted it, so a charge can only fail
 * over onto a provider the BROWSER also tokenized for. That makes the chain a
 * frontend concern, and it makes one rule load bearing:
 *
 *   `tokensByProvider` is sent iff the SERVER-PUBLISHED CHAIN has more than one
 *   entry — never iff more than one instrument happened to mint.
 *
 * These two tests fail in opposite directions, which is the only way to hold a
 * rule like that: one breaks if the chain is filtered, the other breaks if the
 * map is counted instead of the chain.
 */

test('two mintable entries: one instrument each, head skipped, tail settles', async ({ page }) => {
  await openPage(page, 'payments-checkout-chain-failover');
  await openCase(page, 'two-mintable');
  await reachPayment(page);

  await expect(page.getByTestId('card-view')).toBeVisible();
  await fillCard(page);
  await payCard(page);

  await expect(page.getByTestId('payment-paid')).toBeVisible();

  // ONE INSTRUMENT PER PUBLISHED ENTRY. Any factory-level filtering, sorting or
  // de-duplication of `providerConfig.chain` shows up here as a missing key.
  await expect(page.getByTestId('wire-tokens-by-provider')).toHaveText('aurora,boreal');

  // The head was asked and proved it charged nothing (ECONNREFUSED), so the
  // walk advanced; the tail settled. Both providers were reached with the card
  // the buyer typed ONCE — nothing was re-entered between them.
  const charges = page.getByTestId('provider-charges');
  await expect(charges).toContainText('boreal:CARD');
  await expect(charges).toContainText('aurora:CARD');
  await expect(page.getByTestId('provider-charge-count')).toHaveText('2');
});

test('REDIRECT head, mintable tail: the form is shown and the map is still sent', async ({
  page,
}) => {
  await openPage(page, 'payments-checkout-chain-failover');
  await openCase(page, 'redirect-head');
  await reachPayment(page);

  // Somebody in the chain tokenizes, so the buyer gets OUR form rather than a
  // handover — asking the head alone would have sent them to a provider page
  // and the configured failover could never happen.
  await chooseCard(page);
  await fillCard(page);
  await payCard(page);

  // Exactly one instrument minted (the REDIRECT head needs none), and the map
  // is STILL SENT because the published chain has two entries. Count the map
  // instead and it disappears: the server then reads the bare token as the
  // HEAD's and refuses every other entry as holding someone else's instrument
  // — including the one that needed none.
  await expect(page.getByTestId('wire-tokens-by-provider')).toHaveText('aurora');
});
