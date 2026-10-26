import { expect } from '@playwright/test';

import {
  DECLINE_PAN,
  checkoutSurface,
  chooseListOption,
  fillCard,
  payCard,
  reachPayment,
  listPixCode,
  showListPixQr,
} from '../helpers/checkout.js';

import { expectNoWrites } from '../helpers/wire.js';
import { paymentsWorld } from '../world.js';

import { Then, When } from './fixtures.js';

/**
 * WHAT THE BUYER DOES, and what she is owed for it (FUT-743).
 *
 * The Thens are split between two kinds of assertion on purpose, and both kinds
 * matter:
 *
 *   - what is ON THE SCREEN — the QR, the receipt, the absence of a pay bar;
 *   - what actually CROSSED THE WIRE — the charge body's own keys, the CPF the
 *     provider received, how many instruments the chain carried.
 *
 * The second kind is the reason these journeys exist at all. FUT-740 passed
 * fifteen green checks with three criticals live, every one of them in the seam
 * between the published client and the published mount, and not one of them
 * visible to a test that only looked at a screen.
 *
 * Every step answers for BOTH checkouts a host may draw (FUT-4028): the ONE
 * list (`payment-list`, its rows `list-option-<METHOD>` and its bar
 * `list-pay`) and the older Dados step with Pix/Cartão tabs. A gesture finds
 * whichever is on the page; an absence is asserted for both shapes, so an
 * absence on one screen cannot pass for the other.
 */

// ---------------------------------------------------------------------------
// The buyer's own gestures
// ---------------------------------------------------------------------------

When('ela informa o CPF e segue para o pagamento', async ({ page }) => {
  await reachPayment(page);
});

When('ela escolhe pagar com cartão', async ({ page }) => {
  // Deliberately does NOT wait for the card form: a store may answer the card
  // choice with something other than a form, and that is a scenario of its own.
  if ((await checkoutSurface(page)) === 'list') await chooseListOption(page, 'CARD');
  else await page.getByTestId('checkout-method-CARD').click();
});

When('ela segue para o pagamento no provedor', async ({ page }) => {
  // The ONE action a hand-off store offers in place of the picker. There is
  // nothing to choose here: every method mints the same checkout link, so the
  // PIX-or-card question is binding on the provider's page and nowhere else.
  // On the list that action is the hand-off row (its one online row, so
  // already chosen) and the bar's "Ir para …".
  const tabs = page.getByTestId('checkout-handoff-start');
  const row = page.getByTestId('list-option-HAND_OFF');
  await expect(tabs.or(row).first()).toBeVisible();
  if (await tabs.isVisible()) {
    await tabs.click();
    return;
  }
  await chooseListOption(page, 'HAND_OFF');
  await page.getByTestId('list-pay').click();
});

When('ela paga com um cartão novo', async ({ page }) => {
  await fillCard(page);
  await payCard(page);
});

When('ela paga com um cartão recusado', async ({ page }) => {
  await fillCard(page, DECLINE_PAN);
  await payCard(page);
});

When('a loja gera o pagamento hospedado', async ({ page }) => {
  // The host raises the payable however it does — a button here, a real cart
  // elsewhere — and is responsible for waiting until the interstitial has
  // MOUNTED, not merely until the click landed. Parking the order is an effect
  // of that screen mounting, and a scenario that navigates away before it has
  // is testing a trip whose outbound leg never happened.
  await paymentsWorld().raiseHostedPayable(page);
});

When('ela volta da página do provedor', async ({ page }) => {
  // The way a hosted provider really sends her back: the host's own return
  // route, plus the markers the provider appends. The application was destroyed
  // in between, so only what was parked before leaving survives.
  await paymentsWorld().returnFromProvider(page);
});

// ---------------------------------------------------------------------------
// What she sees
// ---------------------------------------------------------------------------

Then('não lhe perguntam entre PIX e cartão', async ({ page }) => {
  // The picker is ABSENT, not merely narrowed to one tile. A one-option
  // "choice" at a store that hands the buyer over still says the answer decides
  // something, and it decides nothing until she is on the provider's own page.
  // On the list, the store's one online row is the hand-off, never a Pix or
  // a card row.
  await expect(page.getByTestId('checkout-method')).toHaveCount(0);
  await expect(page.getByTestId('checkout-method-PIX')).toHaveCount(0);
  await expect(page.getByTestId('checkout-method-CARD')).toHaveCount(0);
  await expect(page.getByTestId('list-option-PIX')).toHaveCount(0);
  await expect(page.locator('[data-testid^="list-option-CARD"]')).toHaveCount(0);
});

Then('só a opção PIX é oferecida', async ({ page }) => {
  // The tabs: one tile. The list: one online row, already raised by the time
  // this is read (see `reachPayment`), so its Pix face may stand in its place.
  await expect(
    page
      .getByTestId('checkout-method-PIX')
      .or(page.getByTestId('list-option-PIX'))
      .or(page.getByTestId('list-pix'))
      .first(),
  ).toBeVisible();
  await expect(page.getByTestId('checkout-method-CARD')).toHaveCount(0);
  await expect(page.locator('[data-testid^="list-option-CARD"]')).toHaveCount(0);
});

Then('ela vê o QR code do PIX', async ({ page }) => {
  // The tabs' `pix-view`, or the list's own Pix face (`list-pix`) — opened on
  // its QR the way the buyer opens it (see `showListPixQr`).
  const list = page.getByTestId('list-pix');
  await expect(page.getByTestId('pix-view').or(list).first()).toBeVisible();
  if (await list.isVisible()) await showListPixQr(page);
  else await expect(page.getByTestId('pix-qr')).toBeVisible();
});

Then('o código copia-e-cola veio do provedor', async ({ page }) => {
  // The Banco Central GUI, in either case: the specification spells it in
  // lowercase and many PSPs print it in capitals, and both are a real code.
  // On the list, see `listPixCode`: the after-copy face hands the code to the
  // clipboard rather than drawing it.
  const list = page.getByTestId('list-pix');
  await expect(page.getByTestId('pix-view').or(list).first()).toBeVisible();
  if (await list.isVisible()) {
    expect(await listPixCode(page)).toMatch(/br\.gov\.bcb\.pix/i);
    return;
  }
  await expect(page.getByTestId('pix-code')).toContainText(/br\.gov\.bcb\.pix/i);
});

Then('ela vê o formulário de cartão', async ({ page }) => {
  // The tabs' `card-view`, or the card row's own fields on the list.
  await expect(
    page.getByTestId('card-view').or(page.getByTestId('payment-list').getByTestId('card-number')).first(),
  ).toBeVisible();
});

Then('nenhum formulário de cartão é mostrado', async ({ page }) => {
  await expect(page.getByTestId('card-view')).toHaveCount(0);
  await expect(page.getByTestId('card-number')).toHaveCount(0);
});

Then('o pagamento é confirmado', async ({ page }) => {
  await expect(page.getByTestId('payment-paid')).toBeVisible();
});

Then('o recibo mostra o valor pago', async ({ page }) => {
  await expect(page.getByTestId('payment-receipt')).toBeVisible();
  await expect(page.getByTestId('payment-amount')).toHaveText('R$ 75,00');
});

Then('o pagamento falha', async ({ page }) => {
  // The tabs' failure screen, or the refusal the list shows inside the card row.
  await expect(page.getByTestId('payment-failed').or(page.getByTestId('card-error')).first()).toBeVisible();
});

Then('ela pode tentar novamente', async ({ page }) => {
  // The tabs' retry, or the list's bar back on "Pagar" beside the refusal.
  const retry = page.getByTestId('payment-retry').or(page.getByTestId('list-pay')).first();
  await expect(retry).toBeVisible();
  await expect(retry).toBeEnabled();
});

Then('ela é avisada de que o pagamento está sendo confirmado', async ({ page }) => {
  // Warning tone, not danger. Some provider may be holding her money.
  await expect(page.getByTestId('card-unresolved')).toBeVisible();
});

Then('não existe nenhum botão de pagar na tela', async ({ page }) => {
  // REMOVED, not disabled: a disabled control becomes live again on the next
  // render, and a live "Pagar R$ …" under "não pague de novo" is what a thumb
  // reaches for.
  await expect(page.getByTestId('card-pay-bar')).toHaveCount(0);
  await expect(page.getByTestId('card-pay')).toHaveCount(0);
  await expect(page.getByTestId('list-pay')).toHaveCount(0);
  await expect(page.getByTestId('list-charge-bar')).toHaveCount(0);
});

Then('não existe nenhum botão de tentar novamente na tela', async ({ page }) => {
  await expect(page.getByTestId('payment-retry')).toHaveCount(0);
  await expect(page.getByTestId('checkout-retry-payment')).toHaveCount(0);
  await expect(page.getByTestId('list-pay')).toHaveCount(0);
});

Then('o erro do cartão menciona o outro meio de pagamento', async ({ page }) => {
  await expect(page.getByTestId('card-error')).toContainText('cartão');
  await expect(page.getByTestId('card-error')).toContainText('PIX');
});

Then('a opção PIX continua na tela', async ({ page }) => {
  await expect(page.getByTestId('checkout-method-PIX').or(page.getByTestId('list-option-PIX')).first()).toBeVisible();
});

Then('ela é avisada de que a loja não cobra online', async ({ page }) => {
  await expect(page.getByTestId('checkout-payments-disabled')).toBeVisible();
});

Then('ela recebe a opção de chamar o garçom', async ({ page }) => {
  await expect(page.getByTestId('checkout-payments-remedy')).toBeVisible();
  await expect(page.getByTestId('checkout-payments-remedy-action')).toBeVisible();
});

Then('nenhuma forma de pagamento é oferecida', async ({ page }) => {
  await expect(page.getByTestId('checkout-method')).toHaveCount(0);
  await expect(page.locator('[data-testid^="list-option-"]')).toHaveCount(0);
  await expect(page.getByTestId('list-pay')).toHaveCount(0);
  await expect(page.getByTestId('card-view')).toHaveCount(0);
  await expect(page.getByTestId('pix-view')).toHaveCount(0);
});

Then('ela vê a tela de transferência para o provedor', async ({ page }) => {
  await expect(page.getByTestId('checkout-hosted-handoff')).toBeVisible();
});

Then('existe um link visível para a página do provedor', async ({ page }) => {
  // A REAL anchor, not a second scripted navigation: when the scripted one was
  // blocked, another one will be too.
  const link = page.getByTestId('checkout-hosted-link');
  await expect(link).toBeVisible();
  // `toHaveAttribute` with a STRING demands the whole value; the host only
  // knows a fragment of the URL its provider mints, so this stays a substring
  // match — escaped, because the fragment is a hostname and its dots must not
  // become wildcards.
  await expect(link).toHaveAttribute(
    'href',
    new RegExp(paymentsWorld().fixtures.hostedUrlFragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  );
});

Then('o pagamento volta confirmado', async ({ page }) => {
  await expect(paymentsWorld().hostedReturnStatus(page)).toHaveText('PAID');
});

// ---------------------------------------------------------------------------
// What actually crossed
// ---------------------------------------------------------------------------

Then('nenhum pedido chegou a ser criado', async ({ page }) => {
  // Nothing but reads went out: a store that cannot charge must not have a
  // payable brought into existence. Whether the config was read is not the
  // claim — a host may draw this screen from what it already knows.
  await expectNoWrites(page);
});

Then('a cobrança enviada ao provedor carrega o cartão e o CPF dela', async ({ page }) => {
  // What the PROVIDER received, not what the client recorded sending. The wire
  // facts below are written on the way OUT of the published client, so they can
  // only fail if the CLIENT changes; this line is the one that fails if the
  // MOUNT stops reading the flat body — the instrument then reads
  // `(no-instrument)` and the charge was never payable at all.
  const { fixtures, wire } = paymentsWorld();
  await expect(wire.providerCharges(page)).toContainText(
    `${fixtures.headProvider}:CARD:${fixtures.taxId}:tok:`,
  );
});

Then('o corpo da cobrança é o formato plano que o cliente publicado envia', async ({ page }) => {
  const { wire } = paymentsWorld();
  const keys = wire.chargeKeys(page);
  await expect(keys).toContainText('orderId');
  await expect(keys).toContainText('token');
  await expect(keys).toContainText('taxId');
  await expect(wire.chargeBody(page)).not.toContainText('"card"');
});

Then('nenhum tokensByProvider é enviado', async ({ page }) => {
  await expect(paymentsWorld().wire.tokensByProvider(page)).toHaveText('(absent)');
});

Then('um instrumento foi gerado para cada provedor da cadeia', async ({ page }) => {
  const { fixtures, wire } = paymentsWorld();
  // A SET of instruments, in whatever order the client minted them (FUT-3627):
  // a real checkout mints the chain concurrently, so the map's key order is
  // the order the mints finished in — `stone,pagbank` on one run, the reverse
  // on the next — and no reader of the map depends on it.
  const expected = [fixtures.headProvider, fixtures.tailProvider].sort().join(',');
  await expect
    .poll(async () => ((await wire.tokensByProvider(page).textContent()) ?? '').split(',').sort().join(','))
    .toBe(expected);
});

Then('os dois provedores receberam a cobrança', async ({ page }) => {
  const { fixtures, wire } = paymentsWorld();
  await expect(wire.providerChargeCount(page)).toHaveText('2');
  await expect(wire.providerCharges(page)).toContainText(`${fixtures.tailProvider}:CARD`);
  await expect(wire.providerCharges(page)).toContainText(`${fixtures.headProvider}:CARD`);
});

Then('o mapa de instrumentos traz só o provedor que gera token', async ({ page }) => {
  // Sent even though exactly one instrument minted, because the PUBLISHED chain
  // has two entries. Counting the map instead drops it, and the server then
  // reads the bare token as the head's and refuses the entry that needed none.
  await expect(paymentsWorld().wire.tokensByProvider(page)).toHaveText(
    paymentsWorld().fixtures.headProvider,
  );
});

Then('a loja registrou para onde ela seria levada', async ({ page }) => {
  const { fixtures, wire } = paymentsWorld();
  await expect(wire.navigated(page)).toContainText(fixtures.hostedUrlFragment);
});

Then('o pedido foi guardado antes da navegação', async ({ page }) => {
  // Reading storage is the only way to see "BEFORE". The navigation may tear
  // the application down at any point after it starts, so a write that happens
  // afterwards never happens at all.
  // The literal, not an import: this package deliberately does not depend on
  // `@12-apps/payments-frontend` — it is a portable corpus a host runs against
  // whatever it mounted. So the key is asserted the way an outside observer
  // sees it, which is also what makes it a real contract test. It is exported
  // as `HOSTED_ORDER_STORAGE_KEY` there, and the two must move together.
  const parked = await page.evaluate(() =>
    window.sessionStorage.getItem('payments.checkout.hostedOrder'),
  );
  expect(parked).toContain(paymentsWorld().fixtures.payableRef);
});
