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

/**
 * Fill a card form's own CPF (`buyer-cpf`) — the activation step's, which asks
 * it beside the card. The checkout's list asks it at its top instead
 * (`list-buyer-taxId`, see {@link reachPayment}).
 */
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

/** The checkout is the ONE list (FUT-4028): wait for it to be drawn. */
async function onTheList(page: Page): Promise<void> {
  await expect(page.getByTestId('payment-list')).toBeVisible();
}

/**
 * The list's top (the CPF and "PAGAMENTO RÁPIDO") is a chunk of its own
 * (FUT-3711): wait for it to land before reading or typing in it — a field
 * looked for while it loads is missed, and an absence read then proves nothing.
 */
export async function listTopSettled(page: Page): Promise<void> {
  await expect(page.getByTestId('list-top-loading')).toHaveCount(0);
}

/**
 * A row of the list, by its method: `list-option-PIX`, `list-option-CARD`,
 * `list-option-HAND_OFF`. A store whose list splits the card by funding draws
 * `list-option-CARD-CREDIT` and `list-option-CARD-DEBIT` instead, which these
 * helpers do not choose between.
 */
export type ListMethod = 'PIX' | 'CARD' | 'HAND_OFF';

/** Choose an online row of the list (a no-op when it is already the chosen one). */
export async function chooseListOption(page: Page, method: ListMethod): Promise<void> {
  await page.getByTestId(`list-option-${method}-radio`).check();
}

/** Pick the card row on a store that offers it, and wait for its form. */
export async function chooseCard(page: Page): Promise<void> {
  await onTheList(page);
  await chooseListOption(page, 'CARD');
  await expect(page.getByTestId('payment-list').getByTestId('card-number')).toBeVisible();
}

/**
 * Press the list's bar (`list-pay`) and wait for the charge to have started.
 *
 * The bar turns into the five-second charge bar: nothing is sent until it
 * fills, so whatever is asserted next waits for the outcome — give the expect
 * timeout room above those five seconds. Waited for rather than read at an
 * instant: on a retry after a refusal the bar's button comes back a moment
 * later.
 */
export async function payCard(page: Page): Promise<void> {
  const pay = page.getByTestId('list-pay');
  await expect(pay).toBeEnabled();
  await pay.click();
  await expect(page.getByTestId('list-charge-bar')).toBeVisible();
}

/** How long {@link showListPixQr} keeps trying the faces before it fails. */
const SHOW_QR_TIMEOUT_MS = 10_000;

/**
 * Show the list's Pix QR, the way the buyer would (FUT-4028).
 *
 * The list's Pix has two faces, and each draws its QR differently:
 *
 *  - BEFORE the code is copied it shows the code (`list-pix-code`) and the QR
 *    (`list-pix-qr`): beside the code on a wide screen, behind "Ver QR code"
 *    (`list-pix-toggle-qr`) on a narrow one;
 *  - AFTER it is copied (`pix-after-copy`) — at once with the host's bank
 *    flow (`pixBank`, FUT-3612), whose button generates AND copies — it says
 *    what to do in the bank app. On a narrow screen "Ver QR code"
 *    (`pix-show-qr`) brings the code and its QR back; on a wide one the QR
 *    already stands beside the steps ("Ainda falta pagar?").
 *
 * Whichever face is up, this taps what the buyer would tap, and then a QR has
 * to be on screen. Retried as a whole: the copy that turns one face into the
 * other may land while it looks.
 */
export async function showListPixQr(page: Page): Promise<void> {
  const qr = page.getByTestId('list-pix-qr');
  const afterCopy = page.getByTestId('pix-after-copy');
  await expect(async () => {
    if (await afterCopy.isVisible()) {
      const showQr = page.getByTestId('pix-show-qr');
      if (await showQr.isVisible()) await showQr.click();
      else {
        // The QR itself: the code's image (`role="img"`) and the SVG drawn in it.
        expect(await afterCopy.locator('[role="img"] > svg[viewBox]').isVisible()).toBe(true);
        return;
      }
    } else if (!(await qr.isVisible())) {
      const toggle = page.getByTestId('list-pix-toggle-qr');
      if (await toggle.isVisible()) await toggle.click();
    }
    expect(await qr.locator('svg[viewBox]').isVisible()).toBe(true);
  }).toPass({ timeout: SHOW_QR_TIMEOUT_MS });
}

/**
 * The copia-e-cola the list's Pix gave the buyer (FUT-4028): the code on its
 * face, or — on the after-copy face of a wide screen, which no longer draws
 * it — the code it put on her clipboard ("Código copiado"). Reading that one
 * needs the page to hold the `clipboard-read` permission, which a host grants
 * when its store uses the bank flow.
 */
export async function listPixCode(page: Page): Promise<string> {
  await showListPixQr(page);
  const code = page.getByTestId('list-pix-code');
  if (await code.isVisible()) return (await code.textContent()) ?? '';
  return page.evaluate(() => navigator.clipboard.readText());
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
 * Land on Pagamento — the ONE list (FUT-4028) — with what the buyer has to give
 * typed in.
 *
 * The CPF is asked once, at the top of Pagamento (`list-buyer-taxId`), and only
 * when the store needs one the buyer has not got on file: a chain whose
 * providers need no tax id — InfinitePay's hosted checkout is one — asks none
 * (FUT-3627). A store that takes Pix and nothing else online raises the Pix on
 * the bar's one tap, "Gerar Pix", so that tap is made here — the buyer has no
 * other gesture to make, and the scenario's next line is about the code.
 *
 * Whatever ELSE a row asks for is the host's to have filled in `open`: which
 * fields a provider requires is a fact about the store, not the buyer.
 */
export async function reachPayment(page: Page): Promise<void> {
  await onTheList(page);
  await listTopSettled(page);
  const cpf = page.getByTestId('list-buyer-taxId');
  if ((await cpf.count()) > 0) await cpf.fill(VALID_CPF);
  if (await listIsPixOnly(page)) {
    await chooseListOption(page, 'PIX');
    await page.getByTestId('list-pay').click();
  }
}
