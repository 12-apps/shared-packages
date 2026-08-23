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

/** Fill the Dados step's CPF. */
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

/** Pick the card tile on a store that offers both, and wait for the form. */
export async function chooseCard(page: Page): Promise<void> {
  await page.getByTestId('checkout-method-CARD').click();
  await expect(page.getByTestId('card-view')).toBeVisible();
}

/** Press the pay bar and wait for the submit to have actually left. */
export async function payCard(page: Page): Promise<void> {
  await page.getByTestId('card-pay').click();
}

/** Walk the Dados step and land on Pagamento. */
export async function reachPayment(page: Page): Promise<void> {
  await fillCpf(page);
  await page.getByTestId('checkout-continue').click();
}
