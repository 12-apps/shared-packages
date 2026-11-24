import type { BrowserWalletFailure, BrowserWalletResult } from '@12-apps/payments-backend';

import { startApplePaySession, type ApplePayPaymentMethod, type ApplePaySessionClass } from '../checkout/apple-pay-button';
import type { HomologacaoEvidenceWalletsCopy } from './copy';

/**
 * An open Apple Pay sheet (FUT-5519): what it answered, and how to close it.
 * Apple's token is good for minutes and the sheet waits at most 30 s after the
 * person authorizes, so the evidence charges it while the sheet is open and
 * closes it with PagBank's real answer.
 */
export interface EvidenceAppleSheet {
  /** The authorized token, or why there is none; settles once. */
  result: Promise<BrowserWalletResult>;
  /** Close the sheet: `true` when PagBank charged it. A no-op after a failure. */
  complete: (paid: boolean) => void;
}

const failed = (failure: BrowserWalletFailure): BrowserWalletResult => ({
  type: 'APPLE_PAY',
  token: null,
  brand: null,
  last4: null,
  failure,
});

/** Four trailing digits, or null — the only part of the number a wallet shows. */
export function lastFour(text: string | undefined): string | null {
  return /(\d{4})\s*$/.exec(text ?? '')?.[1] ?? null;
}

function appleResult(token: string, method: ApplePayPaymentMethod | null): BrowserWalletResult {
  return { type: 'APPLE_PAY', token, brand: method?.network ?? null, last4: lastFour(method?.displayName) };
}

/** Start Apple's session — synchronously, inside the tap Safari requires — and hand back the open sheet. */
export function openAppleSheet(
  Session: ApplePaySessionClass,
  cents: number,
  input: { copy: HomologacaoEvidenceWalletsCopy; validate: (validationURL: string) => Promise<unknown> },
): EvidenceAppleSheet {
  const seen: { failure: BrowserWalletFailure | null; method: ApplePayPaymentMethod | null } = { failure: null, method: null };
  const { copy } = input;
  let sheet: ReturnType<typeof startApplePaySession>;
  try {
    sheet = startApplePaySession({
      Session,
      cents,
      copy: {
        orderTotal: copy.applePaySheetTotal,
        cannotStart: copy.applePayCannotStart,
        cannotComplete: copy.applePayCannotComplete,
        payAction: copy.applePayButton,
      },
      validateMerchant: (url) =>
        input.validate(url).catch((error: unknown) => {
          seen.failure = 'MERCHANT_VALIDATION_FAILED';
          throw error;
        }),
      onError: () => {
        seen.failure ??= 'TOKEN_ERROR';
      },
      onPaymentMethod: (method) => {
        seen.method = method;
      },
    });
  } catch {
    return { result: Promise.resolve(failed('TOKEN_ERROR')), complete: () => undefined };
  }
  const opened = sheet;
  // Only an authorized sheet waits to be closed, and it is closed once.
  let open = false;
  return {
    result: opened.answer.then((key) => {
      open = key !== null;
      return key === null ? failed(seen.failure ?? 'DISMISSED') : appleResult(key, seen.method);
    }),
    complete: (paid) => {
      if (!open) return;
      open = false;
      opened.complete(paid);
    },
  };
}
