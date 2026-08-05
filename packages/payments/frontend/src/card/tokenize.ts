/**
 * Browser-side card tokenization — the PCI boundary.
 *
 * The PAN is validated locally, then encrypted **in the browser** by the
 * PagBank SDK with the store's public key, so the raw {@link CardDetails} never
 * leaves the page; only the encrypted blob is sent to the server. The SDK
 * script is injected lazily the first time a real key is used.
 *
 * Two doors, and the naming is the safety mechanism:
 *
 *   - {@link tokenizeCard} REQUIRES a real public key and fails without one.
 *   - {@link tokenizeForCheckout} may fall back to a fake token, but ONLY when
 *     the server granted stub mode (`mockTokenization`, FUT-697) — a dev/e2e
 *     affordance, and one that must never be reached by anything deciding
 *     whether a store is allowed to take money.
 *
 * That distinction is the whole reason this moved out of the storefront: the
 * provider-activation check (FUT-463) proves a store can charge by charging it.
 * Handed the mock, a store with no public key would "pass" without a single
 * request reaching PagBank and be switched live — the exact false positive the
 * check exists to catch.
 */

import { err, ok, type Result } from "../result";

import { detectBrand, onlyDigits } from "./format";
import { tokenizeWithStripe } from "./stripe-token";
import type { CardDetails, CardToken } from "./types";

/** Test PAN that always declines (mirrors common sandbox decline cards). */
const DECLINE_PAN = "4000000000000002";

/** PagBank browser SDK — encrypts the card with the public key, client-side. */
const PAGBANK_SDK_URL =
  "https://assets.pagseguro.com.br/checkout-sdk-js/rc/dist/browser/pagseguro.min.js";

/**
 * PagBank browser SDK surface. It encrypts the card with the RSA public key
 * entirely client-side, so the PAN never leaves the browser — only the
 * resulting blob is sent to our server.
 */
interface PagBankEncryptResult {
  encryptedCard?: string;
  hasErrors: boolean;
  errors?: unknown[];
}
declare global {
  interface Window {
    PagSeguro?: {
      encryptCard(params: {
        publicKey: string;
        holder: string;
        number: string;
        expMonth: string;
        expYear: string;
        securityCode: string;
      }): PagBankEncryptResult;
    };
  }
}

/**
 * Inject the PagBank SDK script once and resolve when it is usable. Resolves
 * `false` (never rejects) when the script fails or times out — the caller
 * surfaces a friendly retry message.
 */
let sdkLoad: Promise<boolean> | null = null;
function ensurePagBankSdk(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (window.PagSeguro?.encryptCard) return Promise.resolve(true);
  sdkLoad ??= new Promise<boolean>((resolve) => {
    const script = document.createElement("script");
    script.src = PAGBANK_SDK_URL;
    script.async = true;
    script.onload = () => resolve(Boolean(window.PagSeguro?.encryptCard));
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
  return sdkLoad;
}

/** Local card-field validation. Returns an error message, or `null` when valid. */
function validateCardInput(card: CardDetails): string | null {
  if (!passesLuhn(onlyDigits(card.number))) return "Número de cartão inválido.";
  if (card.holder.trim().length < 2) return "Informe o nome impresso no cartão.";
  if (!expiryIsFuture(card.expiry)) return "Validade inválida ou expirada.";
  if (!/^\d{3,4}$/.test(card.cvv.trim())) return "CVV inválido.";
  return null;
}

/**
 * Encrypt the (already-validated) card with the PagBank browser SDK, so the raw
 * PAN never leaves the page — only the resulting token is returned.
 */
function encryptWithSdk(
  card: CardDetails,
  pan: string,
  publicKey: string,
  brand: string,
  last4: string,
): Result<CardToken> {
  if (typeof window === "undefined" || !window.PagSeguro?.encryptCard) {
    return err("Não foi possível carregar o meio de pagamento. Recarregue a página.");
  }
  const match = /^(\d{2})\/(\d{2})$/.exec(card.expiry.trim());
  if (!match) return err("Validade inválida ou expirada.");
  const encrypted = window.PagSeguro.encryptCard({
    publicKey,
    holder: card.holder.trim(),
    number: pan,
    expMonth: match[1]!,
    expYear: `20${match[2]!}`,
    securityCode: card.cvv.trim(),
  });
  if (encrypted.hasErrors || !encrypted.encryptedCard) {
    return err("Não foi possível processar o cartão. Verifique os dados e tente novamente.");
  }
  return ok({ token: encrypted.encryptedCard, brand, last4 });
}

/**
 * Which browser-side scheme mints the token.
 *
 * `tokenization: 'PUBLIC_KEY'` does NOT disambiguate this — PagBank and Stone
 * both report it while speaking entirely different protocols: PagBank encrypts
 * locally with an injected SDK, Pagar.me (Stone's payments technology) posts
 * the card to its own tokens endpoint and hands back an id, and Stripe mints a
 * PaymentMethod at its own endpoint with the publishable key (FUT-698). Keyed
 * by provider because the protocol is the provider's, not the capability's.
 */
export type CardTokenizer = "pagbank-sdk" | "pagarme-token" | "stripe-pm";

export function tokenizerFor(provider: string): CardTokenizer | null {
  if (provider === "pagbank") return "pagbank-sdk";
  if (provider === "stone") return "pagarme-token";
  if (provider === "stripe") return "stripe-pm";
  // InfinitePay (REDIRECT) has no in-browser card path — its own page takes
  // the card. Null so the caller can SAY so, rather than mint a token with the
  // wrong scheme and report the provider's rejection as if the card were bad.
  return null;
}

/** Pagar.me v5 tokens endpoint — the public key rides as `appId`. */
const PAGARME_TOKENS_URL = "https://api.pagar.me/core/v5/tokens";

/**
 * Mint a Pagar.me card token, for Stone.
 *
 * The PAN is posted straight to Pagar.me from the browser and never touches our
 * server — the same PCI boundary the PagBank SDK gives us by encrypting
 * locally, reached a different way. Only the returned id comes back to us, and
 * that id is what `stone-orders.ts` sends as `card_token`.
 */
async function tokenizeWithPagarme(
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

  let response: Response;
  try {
    response = await fetch(`${PAGARME_TOKENS_URL}?appId=${encodeURIComponent(publicKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        type: "card",
        card: {
          number: pan,
          holder_name: card.holder.trim(),
          exp_month: Number(match[1]),
          exp_year: Number(`20${match[2]}`),
          cvv: card.cvv.trim(),
        },
      }),
    });
  } catch {
    return err("Não foi possível contatar o provedor do cartão. Verifique sua conexão.");
  }

  const body = (await response.json().catch(() => null)) as { id?: unknown } | null;
  if (!response.ok || typeof body?.id !== "string") {
    // Carried verbatim: a rejected tokenization is the provider's answer, and
    // the whole point of the activation screen is that it reaches a human.
    return err(
      `O provedor recusou os dados do cartão (HTTP ${response.status}). ` +
        `Resposta: ${JSON.stringify(body).slice(0, 300)}`,
    );
  }
  return ok({ token: body.id, brand, last4 });
}

/**
 * Tokenize a card with the store's PagBank public key.
 *
 * A missing key is an ERROR here, never a fallback: without one there is no
 * encryption, so there is nothing a provider could accept or refuse.
 */
export async function tokenizeCard(
  card: CardDetails,
  publicKey: string | null | undefined,
  tokenizer: CardTokenizer = "pagbank-sdk",
  /**
   * Bounds the network schemes (Pagar.me / Stripe). The PagBank one encrypts
   * locally and has no request to abort.
   */
  signal?: AbortSignal,
): Promise<Result<CardToken>> {
  const validationError = validateCardInput(card);
  if (validationError) return err(validationError);

  if (!publicKey) {
    return err(
      "A chave pública do cartão não está disponível para esta loja. " +
        "Reconecte o provedor e tente novamente.",
    );
  }

  const pan = onlyDigits(card.number);
  const brand = detectBrand(pan);
  const last4 = pan.slice(-4);

  if (tokenizer === "pagarme-token") {
    return tokenizeWithPagarme(card, pan, publicKey, brand, last4, signal);
  }
  if (tokenizer === "stripe-pm") {
    return tokenizeWithStripe(card, pan, publicKey, brand, last4, signal);
  }

  if (!(await ensurePagBankSdk())) {
    return err("Não foi possível carregar o meio de pagamento. Recarregue a página.");
  }
  return encryptWithSdk(card, pan, publicKey, brand, last4);
}

/**
 * What the buyer checkout knows about the store's active provider — the
 * buyer-safe triple `GET /api/checkout/config` answers (FUT-697), which is the
 * ONLY sanctioned source for `mockTokenization`.
 */
export interface CardTokenizationConfig {
  /** Active provider's name, or `null` when the store has none connected. */
  provider: string | null;
  /** The provider's PUBLIC browser key, when it has one. */
  publicKey: string | null;
  /**
   * Server-granted stub-mode permission. `true` only when the store's
   * connection runs the deterministic stub (local dev / e2e / demo tenants).
   * A mock token may be minted under NO other condition — minting one against
   * a real provider was the FUT-697 bug: a fake `tok_…` entered a real charge
   * and the provider's rejection read as though the buyer's card were bad.
   */
  mockTokenization: boolean;
}

/** The clear bail (FUT-697): said BEFORE any charge, naming the remedy. */
const CARD_PATH_UNAVAILABLE =
  "O pagamento com cartão está indisponível nesta loja no momento. Recarregue a página e tente de novo, escolha outro método de pagamento ou combine diretamente com a loja.";

/**
 * Tokenize for the buyer checkout, speaking the ACTIVE provider's protocol.
 *
 * - Provider with a browser scheme and a key ⇒ real tokenization, with the
 *   scheme {@link tokenizerFor} names (PagBank encrypts via SDK, Stone posts
 *   to Pagar.me, Stripe mints a PaymentMethod with the publishable key —
 *   PagBank and Stone advertise the same `PUBLIC_KEY` while speaking different
 *   protocols, so the choice is by provider, never by capability).
 * - Stub-mode store ⇒ a mock token that encodes the decline scenario, so the
 *   full order→charge→confirm path runs with no credentials (dev / e2e).
 * - Anything else ⇒ a clear bail. Never a fake token into a real charge.
 *
 * Only the buyer checkout may use this. Anything that GRANTS something on a
 * successful charge must call {@link tokenizeCard} instead — a mock token
 * cannot prove a real account works.
 */
export async function tokenizeForCheckout(
  card: CardDetails,
  config: CardTokenizationConfig,
  /**
   * Optional deadline for a provider that mints over the network. The chain
   * path passes one so a backup acquirer nobody can reach cannot hold the
   * buyer's Pagar button (FUT-563).
   */
  signal?: AbortSignal,
): Promise<Result<CardToken>> {
  const scheme = config.provider ? tokenizerFor(config.provider) : null;
  if (scheme && config.publicKey) return tokenizeCard(card, config.publicKey, scheme, signal);

  if (!config.mockTokenization) return err(CARD_PATH_UNAVAILABLE);

  const validationError = validateCardInput(card);
  if (validationError) return err(validationError);

  const pan = onlyDigits(card.number);
  const token = pan === DECLINE_PAN ? mintToken("tok_declined") : mintToken("tok");
  return ok({ token, brand: detectBrand(pan), last4: pan.slice(-4) });
}

// ---------------------------------------------------------------------------
// Local card helpers (used only by tokenization — the PAN stays in this file)
// ---------------------------------------------------------------------------

/** Luhn checksum — rejects obviously invalid card numbers before tokenizing. */
function passesLuhn(pan: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = pan.length - 1; i >= 0; i -= 1) {
    let digit = Number(pan[i]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return pan.length >= 13 && sum % 10 === 0;
}

function expiryIsFuture(expiry: string): boolean {
  const match = /^(\d{2})\/(\d{2})$/.exec(expiry.trim());
  if (!match) return false;
  const month = Number(match[1]);
  const year = 2000 + Number(match[2]);
  if (month < 1 || month > 12) return false;
  const now = new Date();
  const endOfMonth = new Date(year, month, 0, 23, 59, 59);
  return endOfMonth.getTime() >= now.getTime();
}

let tokenCounter = 0;
/** Opaque client-side token id (stands in for the SDK's encrypted card token). */
function mintToken(prefix: string): string {
  tokenCounter += 1;
  return `${prefix}_${Date.now().toString(36)}${tokenCounter.toString(36)}`;
}
