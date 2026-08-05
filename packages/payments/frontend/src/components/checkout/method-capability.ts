/**
 * What the store's active provider lets THIS browser do (FUT-697/698) — the
 * capability reads the Pagamento step derives its picker and card path from.
 * Every rule here fails OPEN for the UI and CLOSED for the money: a missing
 * config renders everything, and the tokenizer/server still refuse a charge
 * they cannot honour.
 */
import { useEffect } from "react";

import { tokenizerFor, type CardTokenizationConfig } from "../../card";

import type { CheckoutProviderConfig, PaymentMethod } from "./types";

/**
 * Whether the ACTIVE provider gives this browser a card path (FUT-697):
 * a scheme {@link tokenizerFor} knows, with a key (or PagBank's on-demand
 * refresh); a hosted page (`REDIRECT` — the provider's own site takes the
 * card); or server-granted stub mode. `null` config (still loading / fetch
 * blip) fails OPEN for the UI — the tokenizer itself still fails CLOSED.
 */
export function cardPathAvailable(config: CheckoutProviderConfig | null): boolean {
  if (!config) return true;
  if (config.mockTokenization) return true;
  if (config.tokenization === "REDIRECT") return true;
  const scheme = config.provider ? tokenizerFor(config.provider) : null;
  if (!scheme) return false;
  return config.publicKey !== null || scheme === "pagbank-sdk";
}

/**
 * The tokenization slice the card view consumes. A missing config degrades
 * to the legacy PagBank path — per-order key refresh, NO mock permission — so
 * a transient config failure never blocks a healthy PagBank store and never
 * mints a fake token anywhere.
 */
export function cardTokenization(config: CheckoutProviderConfig | null): CardTokenizationConfig {
  if (config) return config;
  return { provider: "pagbank", publicKey: null, mockTokenization: false };
}

/**
 * The methods the picker may offer, from the chain's declared capabilities
 * (FUT-698). `null` config — still loading, or a fetch blip — fails OPEN like
 * {@link cardPathAvailable}: the picker renders everything and the server
 * still refuses the charge closed. Narrowed to the methods this checkout can
 * actually drive (PIX and CARD; BOLETO is declared by some adapters but has
 * no buyer UI yet), so a capability the UI cannot honour is never offered.
 */
export function offeredMethods(config: CheckoutProviderConfig | null): PaymentMethod[] | null {
  if (!config?.methods) return null;
  return config.methods.filter(
    (method): method is PaymentMethod => method === "PIX" || method === "CARD",
  );
}

/**
 * When the card path is unavailable, PIX is the only choice left — choose it
 * (FUT-697 review): a one-option radiogroup that still demands a tap is a
 * click that buys the buyer nothing.
 */
export function usePreselectSoleMethod(
  cardUnavailable: boolean,
  method: PaymentMethod | null,
  onMethodChange: (method: PaymentMethod) => void,
): void {
  useEffect(() => {
    if (cardUnavailable && method === null) onMethodChange("PIX");
  }, [cardUnavailable, method, onMethodChange]);
}
