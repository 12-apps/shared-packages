import { Box } from "@mui/material";
import { useEffect, useRef, useState, type JSX } from "react";

import type { CheckoutOrder } from "./types";

/**
 * The Google-branded pay button (FUT-471), per Google's four-step web guide —
 * and ONLY the four steps. This component owns token ACQUISITION: load
 * `pay.js`, construct a `PaymentsClient`, gate rendering on `isReadyToPay`,
 * render the button Google's brand rules require via `createButton`, and turn
 * `loadPaymentData` into the wallet key
 * (`paymentData.paymentMethodData.tokenizationData.token`). What happens to
 * the key — the charge, the polling, the outcome — belongs to the pane above
 * (`wallet-pane.tsx`), so this file never talks to the wire.
 *
 * The `tokenizationSpecification` is `{ type: 'PAYMENT_GATEWAY', gateway,
 * gatewayMerchantId }`, both parameters published by the store's chain head
 * (`googlePayConfig`) — no vendor name is spelled here.
 */

/** The slice of Google's `PaymentsClient` this button drives. */
export interface GooglePaymentsClient {
  isReadyToPay(request: Record<string, unknown>): Promise<{ result: boolean }>;
  createButton(options: {
    onClick: () => void;
    buttonSizeMode?: string;
    buttonLocale?: string;
  }): HTMLElement;
  loadPaymentData(request: Record<string, unknown>): Promise<GooglePaymentData>;
}

/** The one path of the payment data this checkout reads. */
export interface GooglePaymentData {
  paymentMethodData: { tokenizationData: { token: string } };
}

/** The `google.payments.api` namespace, as far as this button needs it. */
export interface GooglePayApi {
  PaymentsClient: new (options: { environment: "TEST" | "PRODUCTION" }) => GooglePaymentsClient;
}

/** What the store's chain head published for the tokenizationSpecification. */
export interface GooglePayGatewayParams {
  gateway: string;
  gatewayMerchantId: string;
}

/** Google's script, loaded once per page. */
const PAY_JS_URL = "https://pay.google.com/gp/p/js/pay.js";

/**
 * Card networks offered to Google: the intersection of Google's
 * `allowedCardNetworks` enum and what PagBank's card acquiring processes.
 * A network the gateway would refuse must not be offered on the sheet.
 */
const ALLOWED_CARD_NETWORKS = ["AMEX", "ELO", "MASTERCARD", "VISA"];

/** Both auth methods of Google's guide: tokenized device cards and PAN_ONLY. */
const ALLOWED_AUTH_METHODS = ["PAN_ONLY", "CRYPTOGRAM_3DS"];

/** The `google.payments.api` global, when a script (or a harness) installed it. */
function installedApi(): GooglePayApi | null {
  if (typeof window === "undefined") return null;
  const scope = window as unknown as { google?: { payments?: { api?: GooglePayApi } } };
  return scope.google?.payments?.api ?? null;
}

/** The in-flight (or settled) pay.js load — one script tag per page, ever. */
const loader: { pending: Promise<GooglePayApi | null> | null } = { pending: null };

/**
 * Step 1 of the guide: load `pay.js` and hand back the API namespace. Answers
 * `null` — never throws — when the script cannot load: an offline CDN must
 * degrade to "no button", not to a crashed checkout. A pre-installed global
 * (another button on the page, or an e2e harness) is used without a network
 * request.
 */
function loadGooglePayApi(): Promise<GooglePayApi | null> {
  const installed = installedApi();
  if (installed) return Promise.resolve(installed);
  if (typeof document === "undefined") return Promise.resolve(null);
  loader.pending ??= new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = PAY_JS_URL;
    script.async = true;
    script.onload = () => resolve(installedApi());
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  });
  return loader.pending;
}

/** Step 2's probe: may this browser/device pay at all? */
function isReadyToPayRequest(): Record<string, unknown> {
  return {
    apiVersion: 2,
    apiVersionMinor: 0,
    allowedPaymentMethods: [
      {
        type: "CARD",
        parameters: {
          allowedAuthMethods: ALLOWED_AUTH_METHODS,
          allowedCardNetworks: ALLOWED_CARD_NETWORKS,
        },
      },
    ],
  };
}

/** Step 4's request: the same card method, now carrying gateway + price. */
function paymentDataRequest(
  params: GooglePayGatewayParams,
  order: CheckoutOrder,
): Record<string, unknown> {
  return {
    apiVersion: 2,
    apiVersionMinor: 0,
    allowedPaymentMethods: [
      {
        type: "CARD",
        parameters: {
          allowedAuthMethods: ALLOWED_AUTH_METHODS,
          allowedCardNetworks: ALLOWED_CARD_NETWORKS,
        },
        tokenizationSpecification: {
          type: "PAYMENT_GATEWAY",
          parameters: {
            gateway: params.gateway,
            gatewayMerchantId: params.gatewayMerchantId,
          },
        },
      },
    ],
    transactionInfo: {
      totalPriceStatus: "FINAL",
      // Integer cents to Google's decimal string — the one money conversion
      // in this file, from the server-authoritative order total.
      totalPrice: (order.totalCents / 100).toFixed(2),
      currencyCode: "BRL",
      countryCode: "BR",
    },
  };
}

/** The buyer closed the sheet — a choice, not a failure to report. */
function sheetDismissed(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { statusCode?: unknown }).statusCode === "CANCELED"
  );
}

/**
 * Resolve the client and ask `isReadyToPay` — the gate that decides whether
 * the button exists at all. `api` is injectable for tests and harnesses;
 * `undefined` means "load pay.js".
 */
function useGooglePayClient(
  api: GooglePayApi | null | undefined,
  environment: "TEST" | "PRODUCTION",
): GooglePaymentsClient | null {
  const [client, setClient] = useState<GooglePaymentsClient | null>(null);
  useEffect(() => {
    const alive = { current: true };
    void (api === undefined ? loadGooglePayApi() : Promise.resolve(api)).then((resolved) => {
      if (!alive.current || !resolved) return;
      const paymentsClient = new resolved.PaymentsClient({ environment });
      paymentsClient
        .isReadyToPay(isReadyToPayRequest())
        .then((answer) => {
          if (alive.current && answer.result) setClient(paymentsClient);
        })
        .catch(() => undefined);
    });
    return () => {
      alive.current = false;
    };
  }, [api, environment]);
  return client;
}

export interface GooglePayButtonProps {
  order: CheckoutOrder;
  /** The chain head's published gateway parameters (`googlePayConfig`). */
  params: GooglePayGatewayParams;
  /** The sheet resolved — charge this key. */
  onKey: (key: string) => void;
  /** The sheet failed for a reason worth telling the buyer (not a dismissal). */
  onError: (message: string) => void;
  /**
   * Google's environment. Defaults to TEST — production requires the external
   * Google Pay registration (see the ticket), and TEST tokens exercise the
   * whole path against PagBank's sandbox with fictitious instruments.
   */
  environment?: "TEST" | "PRODUCTION";
  /** Injectable API namespace for tests/harnesses; omit to load pay.js. */
  api?: GooglePayApi | null;
}

/**
 * Renders NOTHING until `isReadyToPay` says this browser can pay — per the
 * guide, the buyer must never see a Google Pay button that cannot work. The
 * button element itself comes from `createButton` (brand rules); this
 * component only gives it a mount point.
 */
export function GooglePayButton({
  order,
  params,
  onKey,
  onError,
  environment = "TEST",
  api,
}: GooglePayButtonProps): JSX.Element | null {
  const client = useGooglePayClient(api, environment);
  const container = useRef<HTMLDivElement | null>(null);
  // The latest handlers/order, so the Google-rendered button — mounted once —
  // never closes over a stale charge target.
  const current = useRef({ order, params, onKey, onError });
  current.current = { order, params, onKey, onError };

  useEffect(() => {
    const mount = container.current;
    if (!client || !mount) return undefined;
    const button = client.createButton({
      onClick: () => {
        const { order: forOrder, params: forParams, onKey: emit, onError: fail } = current.current;
        client
          .loadPaymentData(paymentDataRequest(forParams, forOrder))
          .then((data) => emit(data.paymentMethodData.tokenizationData.token))
          .catch((error: unknown) => {
            if (sheetDismissed(error)) return;
            fail("Não foi possível concluir o pagamento com o Google Pay. Tente novamente ou pague com cartão.");
          });
      },
      buttonSizeMode: "fill",
      buttonLocale: "pt",
    });
    mount.replaceChildren(button);
    return () => {
      mount.replaceChildren();
    };
  }, [client]);

  if (!client) return null;
  return (
    <Box
      ref={container}
      data-testid="google-pay-button"
      sx={{ minHeight: 40, "& > *": { width: "100%" } }}
    />
  );
}
