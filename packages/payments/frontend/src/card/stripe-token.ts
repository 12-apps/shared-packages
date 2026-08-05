/**
 * Stripe browser-side card tokenization (FUT-698) — the `stripe-pm` scheme.
 *
 * The card is POSTed straight from the browser to Stripe's payment-methods
 * endpoint, authenticated with the store's PUBLISHABLE key, and only the
 * minted `pm_…` id comes back to us — the same PCI boundary the Stone path
 * reaches through Pagar.me's tokens endpoint, and the same wire call
 * Stripe.js itself makes under its iframe. Stripe.js is NOT loaded here on
 * purpose: its public API only tokenizes cards typed into its own Elements
 * iframe, and this checkout's card form is the shared {@link CardDetails}
 * form every provider uses (`fields.tsx`) — the admin's vault flow
 * (`apps/admin/.../stripe-sdk.ts`) keeps Elements where the UI was built
 * around it.
 *
 * The `pm_…` id is what `stripe-charges.ts` sends as `payment_method` when it
 * confirms the PaymentIntent server-side.
 */

import { err, ok, type Result } from "../result";

import type { CardDetails, CardToken } from "./types";

/** Stripe payment-methods endpoint — the publishable key authenticates. */
const STRIPE_PAYMENT_METHODS_URL = "https://api.stripe.com/v1/payment_methods";

/**
 * Mint a Stripe PaymentMethod for a checkout card.
 *
 * `card` has already passed local validation; `pan`, `brand` and `last4` are
 * derived by the caller so every scheme reports the same display metadata.
 * A refusal carries Stripe's own message verbatim — a rejected tokenization
 * is the provider's answer, and it must reach a human.
 */
export async function tokenizeWithStripe(
  card: CardDetails,
  pan: string,
  publicKey: string,
  brand: string,
  last4: string,
  /** Deadline for the round trip; an abort reads as "could not contact". */
  signal?: AbortSignal,
): Promise<Result<CardToken>> {
  const match = /^(\d{2})\/(\d{2})$/.exec(card.expiry.trim());
  if (!match) return err("Validade inválida ou expirada.");

  // Stripe's API speaks form-encoding, not JSON.
  const body = new URLSearchParams({
    type: "card",
    "card[number]": pan,
    "card[exp_month]": String(Number(match[1])),
    "card[exp_year]": `20${match[2]}`,
    "card[cvc]": card.cvv.trim(),
    "billing_details[name]": card.holder.trim(),
  });

  let response: Response;
  try {
    response = await fetch(STRIPE_PAYMENT_METHODS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Bearer ${publicKey}`,
      },
      body: body.toString(),
      signal,
    });
  } catch {
    return err("Não foi possível contatar o provedor do cartão. Verifique sua conexão.");
  }

  const parsed = (await response.json().catch(() => null)) as {
    id?: unknown;
    error?: { message?: unknown };
  } | null;
  if (!response.ok || typeof parsed?.id !== "string") {
    const reason =
      typeof parsed?.error?.message === "string" ? parsed.error.message : JSON.stringify(parsed);
    return err(
      `O provedor recusou os dados do cartão (HTTP ${response.status}). ` +
        `Resposta: ${String(reason).slice(0, 300)}`,
    );
  }
  return ok({ token: parsed.id, brand, last4 });
}
