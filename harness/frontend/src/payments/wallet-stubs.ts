/**
 * The two wallet APIs a harness browser cannot have (FUT-471, FUT-472) —
 * Google's `pay.js` and Safari's `ApplePaySession` — as deterministic stubs a
 * page installs before the checkout looks for them. Shared by the Google Pay,
 * Apple Pay and one-list pages, so the three agree on what a wallet does.
 *
 * Nothing here is the package's: a real host loads Google's script and runs in
 * Safari. The buttons drawn here only stand in for the ones Google and Apple
 * draw (a black pill), so a screenshot reads like the real page.
 */

/** The token the stubbed Google sheet answers with — asserted nowhere by value. */
const SHEET_TOKEN = 'gp_harness_token';

/** The slice of `google.payments.api` the shipped button drives. */
interface StubPaymentDataRequest {
  transactionInfo?: { totalPrice?: string };
}

/** The look of the stand-in Google button: Google's black "pay" pill. */
function styleLikeGoogle(button: HTMLButtonElement, radius: number | undefined): void {
  button.style.cssText = [
    'width:100%',
    'height:100%',
    'min-height:44px',
    `border-radius:${radius ?? 4}px`,
    'border:0',
    'background:#000',
    'color:#fff',
    'font:600 15px system-ui, sans-serif',
    'cursor:pointer',
  ].join(';');
}

/**
 * A deterministic `PaymentsClient`: ready to pay, renders a plain button (the
 * real one is drawn by Google's script, which is the one thing stubbed here),
 * and answers `loadPaymentData` with a fixed token in Google's shape.
 */
export class StubPaymentsClient {
  isReadyToPay(): Promise<{ result: boolean }> {
    return Promise.resolve({ result: true });
  }

  createButton({ onClick, buttonRadius }: { onClick: () => void; buttonRadius?: number }): HTMLElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Pagar com Google Pay';
    styleLikeGoogle(button, buttonRadius);
    button.addEventListener('click', onClick);
    return button;
  }

  loadPaymentData(request: StubPaymentDataRequest): Promise<{
    paymentMethodData: { tokenizationData: { token: string } };
  }> {
    // The request's own total rides into the token so a spec COULD pin that
    // the sheet was asked for the server-authoritative price.
    const price = request.transactionInfo?.totalPrice ?? '?';
    return Promise.resolve({
      paymentMethodData: { tokenizationData: { token: `${SHEET_TOKEN}_${price}` } },
    });
  }
}

/** Install the Google stub on `window`, as a page that loaded pay.js in its <head> would look. */
export function installGooglePayStub(): void {
  (window as unknown as { google?: unknown }).google = {
    payments: { api: { PaymentsClient: StubPaymentsClient } },
  };
}

/** The payment-request slice the Apple stub inspects. */
interface StubPaymentRequest {
  supportedNetworks?: readonly string[];
}

/**
 * A deterministic `ApplePaySession`: validates the merchant as soon as the
 * sheet opens, then authorizes with a fixed `token.paymentData` — the same
 * order Safari drives, synchronously so no scenario ever waits on a timer.
 */
export class StubApplePaySession {
  static readonly STATUS_SUCCESS = 0;
  static readonly STATUS_FAILURE = 1;
  static canMakePayments(): boolean {
    return true;
  }

  onvalidatemerchant: ((event: { validationURL: string }) => void) | null = null;
  onpaymentauthorized:
    | ((event: { payment: { token: { paymentData: unknown } } }) => void)
    | null = null;
  oncancel: (() => void) | null = null;

  private readonly request: StubPaymentRequest;

  constructor(_version: number, request: StubPaymentRequest) {
    this.request = request;
  }

  begin(): void {
    this.onvalidatemerchant?.({ validationURL: 'https://apple.example/validate' });
  }

  abort(): void {
    // Nothing to tear down — the stub keeps no timers.
  }

  completeMerchantValidation(): void {
    this.onpaymentauthorized?.({
      payment: {
        token: {
          // The networks the sheet was asked for, echoed into the opaque
          // payload so a spec could pin the Visa/Mastercard-only constraint.
          paymentData: { stub: true, networks: this.request.supportedNetworks ?? [] },
        },
      },
    });
  }

  completePayment(): void {
    // The checkout's own polling reports the outcome; nothing to record here.
  }
}

/** Install the Apple stub on `window` — call it before any child can feature-detect. */
export function installApplePayStub(): void {
  (window as { ApplePaySession?: unknown }).ApplePaySession = StubApplePaySession;
}

/** The host half of Apple Pay: merchant validation answered like a real server would. */
export const validateHarnessApplePayMerchant = async (): Promise<unknown> => ({
  merchantSession: 'harness',
});
