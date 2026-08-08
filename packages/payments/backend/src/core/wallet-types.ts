/**
 * Digital-wallet descriptors (FUT-471 / FUT-472) — their own module for the
 * same reason as `settlement-hints.ts` and `connect-types.ts` (the size gate
 * on `core/types.ts`), and re-exported from there so every adapter and host
 * keeps importing from `core/types`, the one door.
 */

/**
 * The digital wallets a charge can carry. A closed union like
 * `PaymentMethodKind`, and for the same reason: adapters declare which they
 * support via capabilities, hosts and the checkout switch on it, and growing
 * it is additive.
 */
export type WalletType = 'GOOGLE_PAY' | 'APPLE_PAY';

/**
 * A wallet-minted card instrument — ONE shape for both wallets, because the
 * provider wire is one shape: PagBank's Orders API takes
 * `payment_method.card.wallet: { type, key }` for Google Pay and Apple Pay
 * alike, and a second per-wallet field would fork every layer between the
 * browser and the adapter for no wire difference.
 *
 * `key` is whatever the wallet handed the browser, VERBATIM:
 *   GOOGLE_PAY  `paymentData.paymentMethodData.tokenizationData.token`
 *   APPLE_PAY   Apple's `token.paymentData`, serialized (`JSON.stringify`)
 *
 * Like every other instrument it is provider-bound: a Google Pay token is
 * minted against one gateway's `gatewayMerchantId` and an Apple Pay payload
 * against one merchant certificate, so the walk treats it exactly like a
 * one-time card token — usable on the chain head that described itself to the
 * browser, never handed to a different provider (`core/card-instrument.ts`).
 */
export interface WalletInstrument {
  type: WalletType;
  /** The wallet's payment token, verbatim. Never logged, never persisted. */
  key: string;
}

/**
 * What the BROWSER needs to run Google Pay's tokenization for one provider
 * (FUT-471) — the `PAYMENT_GATEWAY` tokenizationSpecification of Google's own
 * four-step guide: `{ type: 'PAYMENT_GATEWAY', gateway, gatewayMerchantId }`.
 *
 * Client-safe by construction (both values are baked into every integrating
 * page Google indexes), and declared by the ADAPTER because both are provider
 * facts: `gateway` is the processor's id in Google's registry ('pagbank'), and
 * `gatewayMerchantId` is the merchant's id AT that processor, which arrives
 * with the credentials. `gatewayMerchantId` is null until the merchant's
 * connection carries one — the button must not render for that store, because
 * a token minted against a missing merchant id charges nobody.
 */
export interface GooglePayClientConfig {
  gateway: string;
  gatewayMerchantId: string | null;
}

/**
 * The answer to Apple Pay's CSR request (FUT-472, step 1 of the certificate
 * round-trip): the provider mints a certificate signing request the merchant
 * submits in the Apple Developer portal.
 *
 * `csr` is the PEM block when one could be recognized in the response, else
 * `null` — the provider's response schema is NOT published, so the operation
 * parses defensively and always retains `raw` for the operator who has to
 * finish the enrolment by hand when recognition fails.
 */
export interface ApplePayCsr {
  csr: string | null;
  raw: unknown;
}

/**
 * The answer to submitting Apple's `.cer` back to the provider (step 3):
 * `activated` is the HTTP outcome (the response schema is unpublished, so a
 * 2xx is the only activation signal there is), `raw` whatever body came back.
 */
export interface ApplePayActivation {
  activated: boolean;
  raw: unknown;
}
