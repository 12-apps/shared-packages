import { expect, type Page } from '@playwright/test';

/**
 * The three or four gestures every checkout spec repeats (FUT-743, packaged by
 * FUT-561).
 *
 * Deliberately thin. Anything that DECIDES something — which method, which
 * store, what the wire should say — stays in the spec, so a spec still reads as
 * the thing it asserts. What lives here is only the typing.
 *
 * Every one of these drives a test id the PAYMENTS PACKAGE itself renders, so
 * they mean the same thing in any app that mounts the checkout — which is why
 * they ship rather than being reimplemented per consumer. Opening a page and
 * choosing a store do NOT live here: those are the host's, and they are the
 * whole of `PaymentsWorld`.
 */

/** A CPF that passes the real check-digit rule, which is what the form runs. */
export const VALID_CPF = '529.982.247-25';

/** A PAN that passes Luhn. Under stub mode it mints a fake token locally. */
export const GOOD_PAN = '4111 1111 1111 1111';

/** The sandbox PAN that always declines, honoured by the shipped tokenizer. */
export const DECLINE_PAN = '4000 0000 0000 0002';

/** The expiry {@link fillCard} types — two-digit, as a card is embossed. */
const CARD_EXPIRY_TYPED = '12/31';

/**
 * How a saved-card list restates {@link CARD_EXPIRY_TYPED}: the same date,
 * with the year in full.
 *
 * Exported so a step can assert the DIGITS a screen shows without asserting
 * the host's word for them (FUT-760) — "Validade", "Vence em" and "Expires"
 * are all the same fact, and only one of them is any given host's.
 */
export const CARD_EXPIRY_SHOWN = '12/2031';

/** Fill the Dados step's CPF (the tabs' checkout; the list asks it as `list-buyer-taxId`). */
export async function fillCpf(page: Page, cpf: string = VALID_CPF): Promise<void> {
  await page.getByTestId('buyer-cpf').fill(cpf);
}

/** Fill the card form the store's chain gave the buyer. */
export async function fillCard(page: Page, pan: string = GOOD_PAN): Promise<void> {
  await page.getByTestId('card-number').fill(pan);
  await page.getByTestId('card-holder').fill('ANA COMPRADORA');
  await page.getByTestId('card-expiry').fill(CARD_EXPIRY_TYPED);
  await page.getByTestId('card-cvv').fill('123');
}

/**
 * Which checkout the page drew (FUT-4028): the ONE list (`payment-list`), or
 * the older Dados step and Pix/Cartão tabs. Waits for whichever arrives first.
 *
 * Every buyer gesture below answers for both, so a host can move a store from
 * the tabs to the list without its journeys changing — the scenarios say what
 * the buyer does, never which screen she does it on.
 */
export type CheckoutSurface = 'list' | 'tabs';

/** {@link CheckoutSurface}: which of the two the page drew. */
export async function checkoutSurface(page: Page): Promise<CheckoutSurface> {
  const list = page.getByTestId('payment-list');
  const tabs = page
    .getByTestId('checkout-continue')
    .or(page.getByTestId('checkout-method'))
    .or(page.getByTestId('buyer-cpf'));
  await expect(list.or(tabs).first()).toBeVisible();
  return (await list.isVisible()) ? 'list' : 'tabs';
}

/**
 * The list's top (the CPF and "PAGAMENTO RÁPIDO") is a chunk of its own
 * (FUT-3711): wait for it to land before reading or typing in it — a field
 * looked for while it loads is missed, and an absence read then proves nothing.
 */
export async function listTopSettled(page: Page): Promise<void> {
  await expect(page.getByTestId('list-top-loading')).toHaveCount(0);
}

/** A row of the list, by its method: `list-option-PIX`, `list-option-CARD`, `list-option-HAND_OFF`. */
export type ListMethod = 'PIX' | 'CARD' | 'HAND_OFF';

/** Choose an online row of the list (a no-op when it is already the chosen one). */
export async function chooseListOption(page: Page, method: ListMethod): Promise<void> {
  await page.getByTestId(`list-option-${method}-radio`).check();
}

/** Pick the card on a store that offers it, and wait for the form — a tile on the tabs, a row on the list. */
export async function chooseCard(page: Page): Promise<void> {
  if ((await checkoutSurface(page)) === 'list') {
    await chooseListOption(page, 'CARD');
    await expect(page.getByTestId('payment-list').getByTestId('card-number')).toBeVisible();
    return;
  }
  await page.getByTestId('checkout-method-CARD').click();
  await expect(page.getByTestId('card-view')).toBeVisible();
}

/**
 * Press pay and wait for the submit to have actually started.
 *
 * On the tabs that is the card form's own `card-pay`. On the list it is the
 * bar's `list-pay`, which turns into the five-second charge bar: nothing is
 * sent until it fills, so whatever is asserted next waits for the outcome.
 */
export async function payCard(page: Page): Promise<void> {
  const listPay = page.getByTestId('list-pay');
  if (await listPay.isVisible()) {
    await listPay.click();
    await expect(page.getByTestId('list-charge-bar')).toBeVisible();
    return;
  }
  await page.getByTestId('card-pay').click();
}

/** Whether the list offers Pix and nothing else online — no card row, no hand-off. */
async function listIsPixOnly(page: Page): Promise<boolean> {
  const list = page.getByTestId('payment-list');
  const pix = await list.getByTestId('list-option-PIX').count();
  const others = await list
    .locator('[data-testid^="list-option-CARD"], [data-testid^="list-option-HAND_OFF"]')
    .count();
  return pix > 0 && others === 0;
}

/**
 * Land on Pagamento, with what the buyer has to give typed in.
 *
 * ON THE TABS: walk the Dados step. The CPF is typed only when the form ASKS
 * for it (FUT-3627). The Dados step renders the fields the store's chain
 * declares, and a chain whose providers need no tax id — InfinitePay's hosted
 * checkout is one — renders no `buyer-cpf` at all. Demanding it made every
 * hand-off journey unreachable in a real host; only the harness, whose hosted
 * store declared a CPF it did not need, could walk past it.
 *
 * ON THE LIST (FUT-4028): there is no Dados step. The CPF is asked once, at the
 * top of Pagamento (`list-buyer-taxId`), and only when the store needs one the
 * buyer has not got on file. A store that takes Pix and nothing else online is
 * the one place the tabs did something by themselves: they raised the Pix the
 * moment its tab mounted. The list raises it on its one tap, "Gerar Pix", so
 * that tap is made here — the buyer has no other gesture to make, and the
 * scenario's next line is about the code.
 *
 * Whatever ELSE the form asks for is the host's to have filled in `open`:
 * which fields a provider requires is a fact about the store, not the buyer.
 */
export async function reachPayment(page: Page): Promise<void> {
  if ((await checkoutSurface(page)) === 'list') {
    await listTopSettled(page);
    const cpf = page.getByTestId('list-buyer-taxId');
    if ((await cpf.count()) > 0) await cpf.fill(VALID_CPF);
    if (await listIsPixOnly(page)) {
      await chooseListOption(page, 'PIX');
      await page.getByTestId('list-pay').click();
    }
    return;
  }
  const proceed = page.getByTestId('checkout-continue');
  await expect(proceed).toBeVisible();
  if ((await page.getByTestId('buyer-cpf').count()) > 0) await fillCpf(page);
  await proceed.click();
}
