import { expect, test } from '@playwright/test';

import { fillCard, openCase, openPage, payCard, reachPayment, VALID_CPF } from './helpers/checkout';

/**
 * The buyer's own journey, end to end, against a real mount (FUT-743).
 *
 * These are the paths a shopper actually walks — pay by PIX, pay by card,
 * change their mind — and the one thing that decides whether any of them work:
 * the bytes between the published client and the published backend. Both sides
 * of that seam are real here, and the wire probe on each page prints what
 * crossed, so a failure says WHICH field was wrong rather than "the checkout is
 * broken".
 *
 * FUT-740 shipped with all fifteen CI checks green and three criticals live in
 * exactly this gap. Two of them are asserted here directly: the FLAT `/charge`
 * body, and the CPF reaching the provider.
 */

test.describe('PIX', () => {
  test('the sole declared method is preselected and the QR is the provider payload', async ({
    page,
  }) => {
    await openPage(page, 'payments-checkout-pix');
    await openCase(page, 'awaiting');
    await reachPayment(page);

    // One declared method is not a choice: the tile is there and already taken.
    await expect(page.getByTestId('checkout-method-PIX')).toBeVisible();
    await expect(page.getByTestId('checkout-method-CARD')).toHaveCount(0);

    // The payload came from the provider and survived the host's own view — a
    // PIX create answers with the VIEW and nothing else, so a payload that did
    // not make that hop is a payment step with no code on it.
    await expect(page.getByTestId('pix-view')).toBeVisible();
    await expect(page.getByTestId('pix-qr')).toBeVisible();
    await expect(page.getByTestId('pix-code')).toContainText('BR.GOV.BCB.PIX');
  });

  test('the raise goes out on the paths the published client writes', async ({ page }) => {
    await openPage(page, 'payments-checkout-pix');
    await openCase(page, 'awaiting');
    await reachPayment(page);
    await expect(page.getByTestId('pix-view')).toBeVisible();

    // The config read is public and carries the store; the raise is a POST at
    // the base url itself. Both are the shipped paths, verbatim — the default
    // prefix is `/api/checkout` and re-deriving it breaks every open tab.
    await expect(page.getByTestId('wire-paths')).toContainText('GET /api/checkout/config');
    await expect(page.getByTestId('wire-paths')).toContainText('POST /api/checkout');
  });

  test('the poll settles the payable PAID and shows the receipt', async ({ page }) => {
    await openPage(page, 'payments-checkout-pix');
    await openCase(page, 'settles');
    await reachPayment(page);

    // `GET /status` asks the provider, the provider says paid, and the mount
    // applies it through the host's own settlement port.
    await expect(page.getByTestId('payment-paid')).toBeVisible();
    await expect(page.getByTestId('payment-receipt')).toBeVisible();
    await expect(page.getByTestId('payment-amount')).toHaveText('R$ 75,00');
  });
});

test.describe('card', () => {
  test('the FLAT charge body reaches the mount and the CPF reaches the provider', async ({
    page,
  }) => {
    await openPage(page, 'payments-checkout-card');
    await reachPayment(page);

    // A chain declaring CARD alone takes the buyer straight to the form.
    await expect(page.getByTestId('card-view')).toBeVisible();
    await fillCard(page);
    await payCard(page);

    await expect(page.getByTestId('payment-paid')).toBeVisible();

    // FUT-740's second critical, half one: the shipped client posts a FLAT
    // body. These read what the CLIENT sent, so they catch a client that stops
    // sending that shape — and nothing else.
    const keys = page.getByTestId('wire-charge-keys');
    await expect(keys).toContainText('orderId');
    await expect(keys).toContainText('token');
    await expect(keys).toContainText('taxId');
    await expect(page.getByTestId('wire-charge-body')).not.toContainText('"card"');

    // Half two, and the only line that fails when the MOUNT stops READING that
    // body: what the provider actually RECEIVED. The instrument is printed with
    // its kind, so a charge that lost it reads `(no-instrument)` here rather
    // than settling — which is precisely how a re-nesting of `checkout/draft.ts`
    // stayed green. FUT-740's third critical rides in the same line: the payable
    // has no column for a CPF, so it can only travel with the request that
    // raises one.
    await expect(page.getByTestId('provider-charges')).toContainText(
      `aurora:CARD:${VALID_CPF}:tok:`,
    );
    await expect(page.getByTestId('provider-charge-count')).toHaveText('1');
  });

  test('a single-entry chain sends no tokensByProvider', async ({ page }) => {
    await openPage(page, 'payments-checkout-card');
    await reachPayment(page);
    await fillCard(page);
    await payCard(page);

    await expect(page.getByTestId('payment-paid')).toBeVisible();
    // FUT-563's rule in its quiet direction: a genuinely single-provider store
    // sends exactly what it sent before there was a chain to read.
    await expect(page.getByTestId('wire-tokens-by-provider')).toHaveText('(absent)');
  });
});

test.describe('both methods', () => {
  test('switching method drops the order raised for the previous one', async ({ page }) => {
    await openPage(page, 'payments-checkout-both');
    await reachPayment(page);

    // Two real options, so nothing is preselected and no order exists yet.
    await expect(page.getByTestId('checkout-method-PIX')).toBeVisible();
    await expect(page.getByTestId('checkout-method-CARD')).toBeVisible();
    await expect(page.getByTestId('pix-view')).toHaveCount(0);
    await expect(page.getByTestId('card-view')).toHaveCount(0);

    await page.getByTestId('checkout-method-PIX').click();
    await expect(page.getByTestId('pix-view')).toBeVisible();

    await page.getByTestId('checkout-method-CARD').click();
    await expect(page.getByTestId('card-view')).toBeVisible();
    // The whole point: no stale QR behind the card form.
    await expect(page.getByTestId('pix-view')).toHaveCount(0);

    // Exactly one charge exists at the provider, and it is the abandoned PIX
    // one. Raising the card payable does NOT raise a card charge — the mount
    // answers a CARD create with the view alone and waits for the instrument,
    // which is what keeps a buyer who is still choosing from accumulating
    // charges at their bank.
    await expect(page.getByTestId('provider-charge-count')).toHaveText('1');
    await expect(page.getByTestId('provider-charges')).toContainText('aurora:PIX');
  });
});
