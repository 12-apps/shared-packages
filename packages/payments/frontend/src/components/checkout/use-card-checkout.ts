import { useEffect, useState } from "react";

import {
  NEW_CARD,
  detectBrand,
  onlyDigits,
  tokenizeForCheckout,
  tokenizerFor,
  validateCardNumber,
  validateCvv,
  validateExpiry,
  validateHolder,
  type CardBrand,
  type CardDetails,
  type CardFieldErrors,
  type CardTokenizationConfig,
  type CardToken,
  type SavedCard,
} from "../../card";
import { ok, type Result } from "../../result";

import {
  chargeCard,
  listSavedCards,
  refreshCardPublicKey,
} from "./client";
import { rememberHostedOrder } from "./hosted-return";
import type {
  BuyerInfo,
  CheckoutOrder,
  OrderStatus,
  SavedCardMeta,
} from "./types";
import { usePaymentPolling } from "./use-payment-polling";

const EMPTY_CARD: CardDetails = { number: "", holder: "", expiry: "", cvv: "" };

/**
 * Tokenize a new card in the ACTIVE provider's protocol (FUT-697), self-healing
 * a rotated public key (FUT-174): the card has already passed local validation,
 * so a real-key encryption failure most likely means the store's key rotated.
 * Refresh the store's key once and retry before surfacing the error;
 * `onKeyRefreshed` caches the new key for the session. The refresh is scoped to
 * the buyer's OWN `orderId` (the route derives the store from it server-side),
 * never a client-supplied store id — and only PagBank can mint a key on demand,
 * so the self-heal is gated on its scheme.
 */
async function tokenizeNewCard(
  card: CardDetails,
  config: CardTokenizationConfig,
  orderId: string,
  onKeyRefreshed: (key: string) => void,
): Promise<Result<CardToken>> {
  const first = await tokenizeForCheckout(card, config);
  if (first.ok || !config.publicKey) return first;
  if (config.provider === null || tokenizerFor(config.provider) !== "pagbank-sdk") return first;

  const refreshed = await refreshCardPublicKey({ orderId });
  if (refreshed.ok && refreshed.data.publicKey && refreshed.data.publicKey !== config.publicKey) {
    onKeyRefreshed(refreshed.data.publicKey);
    return tokenizeForCheckout(card, { ...config, publicKey: refreshed.data.publicKey });
  }
  return first;
}

/** Non-sensitive display metadata for saving a card (the PAN never leaves the form). */
function toCardMeta(card: CardDetails, token: CardToken): SavedCardMeta {
  const [mm = "", yy = ""] = card.expiry.split("/");
  return {
    brand: token.brand,
    last4: token.last4,
    expMonth: Number(mm),
    expYear: 2000 + Number(yy),
    holder: card.holder.trim(),
  };
}

/** The charge token for a new card (tokenize + self-heal), plus optional save-meta. */
async function resolveNewCardToken(
  card: CardDetails,
  config: CardTokenizationConfig,
  orderId: string,
  onKeyRefreshed: (key: string) => void,
  saveCard: boolean,
): Promise<Result<{ token: string; cardMeta?: SavedCardMeta }>> {
  const tokenized = await tokenizeNewCard(card, config, orderId, onKeyRefreshed);
  if (!tokenized.ok) return tokenized;
  return ok({
    token: tokenized.data.token,
    ...(saveCard ? { cardMeta: toCardMeta(card, tokenized.data) } : {}),
  });
}

/**
 * Saved-card list + current selection, loaded once on mount — scoped to the
 * current store (FUT-697), so only cards the store's active provider can
 * actually charge are offered. The slug arrives as an argument (the host's
 * routing owns it); absent, the list is unscoped, exactly as before FUT-697.
 */
function useSavedCards(tenantSlug: string | undefined): {
  savedCards: SavedCard[];
  selection: string;
  setSelection: (id: string) => void;
} {
  const [savedCards, setSavedCards] = useState<SavedCard[]>([]);
  const [selection, setSelection] = useState<string>(NEW_CARD);

  useEffect(() => {
    let active = true;
    void listSavedCards(tenantSlug).then((cards) => {
      if (!active) return;
      setSavedCards(cards);
      const first = cards[0];
      if (first) setSelection(first.id);
    });
    return () => {
      active = false;
    };
  }, [tenantSlug]);

  return { savedCards, selection, setSelection };
}

/**
 * The store's card public key for this order. The checkout config resolved the
 * initial key server-side (`GET /api/checkout/config`, FUT-697); the SPA
 * fetches through the order-scoped refresh route only when the ACTIVE provider
 * is PagBank — the sole provider that can mint a key on demand — and the
 * config arrived without one. A `null` key never means "mock": stub permission
 * travels separately as `mockTokenization`.
 */
function useCardPublicKey(
  orderId: string,
  config: CardTokenizationConfig,
): {
  publicKey: string | null;
  setPublicKey: (key: string) => void;
} {
  const [publicKey, setPublicKey] = useState<string | null>(config.publicKey);
  const refreshable =
    config.provider !== null && tokenizerFor(config.provider) === "pagbank-sdk";

  useEffect(() => {
    if (config.publicKey !== null || !refreshable) return undefined;
    let active = true;
    void refreshCardPublicKey({ orderId }).then((result) => {
      if (active && result.ok && result.data.publicKey) setPublicKey(result.data.publicKey);
    });
    return () => {
      active = false;
    };
  }, [orderId, config.publicKey, refreshable]);

  return { publicKey, setPublicKey };
}

/** Everything the card view renders — all checkout state + the submit handler. */
interface CardCheckout {
  savedCards: SavedCard[];
  selection: string;
  setSelection: (id: string) => void;
  usingNewCard: boolean;
  card: CardDetails;
  setCard: React.Dispatch<React.SetStateAction<CardDetails>>;
  fieldErrors: CardFieldErrors;
  setFieldErrors: React.Dispatch<React.SetStateAction<CardFieldErrors>>;
  brand: CardBrand;
  saveCard: boolean;
  setSaveCard: (checked: boolean) => void;
  error: string | null;
  submitting: boolean;
  submitted: boolean;
  pollError: string | null;
  /** The healthy-poll cap elapsed while still AWAITING (FUT-191 bounded wait). */
  pollTimedOut: boolean;
  handlePay: () => Promise<void>;
}

/** The form inputs the submit handler reads (owned by {@link useCardCheckout}). */
interface CardFormState {
  card: CardDetails;
  usingNewCard: boolean;
  selection: string;
  saveCard: boolean;
  validate: () => CardFieldErrors;
  setFieldErrors: React.Dispatch<React.SetStateAction<CardFieldErrors>>;
}

/** The submit slice of {@link useCardCheckout}. */
type CardSubmit = Pick<
  CardCheckout,
  "submitting" | "submitted" | "error" | "pollError" | "pollTimedOut" | "handlePay"
>;

/**
 * Healthy-poll cap for the card AWAITING wait: 36 polls ≈ 90 s at the 2500 ms
 * default interval (FUT-191). PIX passes no cap and keeps today's behavior.
 */
const CARD_AWAITING_POLL_CAP = 36;

/**
 * Hand the buyer to the provider's authentication page (FUT-698) — Stripe's
 * redirect-based 3-D Secure. Park the order and navigate, the same trip a
 * redirect provider's link takes (FUT-556): the return lands back on this
 * checkout route, where the hosted-resume machinery polls the parked order.
 */
function handOverToChallenge(order: CheckoutOrder, url: string): void {
  rememberHostedOrder(order);
  window.location.assign(url);
}

/**
 * The submit state machine (FUT-58): validate → tokenize (self-heal) → charge →
 * poll for the async confirmation, bubbling the terminal status up via
 * {@link onResolved}.
 */
function useCardSubmit(
  order: CheckoutOrder,
  buyer: BuyerInfo,
  providerConfig: CardTokenizationConfig,
  onResolved: (status: OrderStatus) => void,
  pollIntervalMs: number,
  form: CardFormState,
): CardSubmit {
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The active key: resolved by the checkout config, overridden by the
  // rotated-key self-heal for the rest of the session.
  const { publicKey, setPublicKey } = useCardPublicKey(order.orderId, providerConfig);

  const { status, error: pollError, timedOut: pollTimedOut } = usePaymentPolling(order.orderId, {
    enabled: submitted,
    intervalMs: pollIntervalMs,
    maxHealthyPolls: CARD_AWAITING_POLL_CAP,
  });

  useEffect(() => {
    if (status && status !== "AWAITING_PAYMENT") onResolved(status);
  }, [status, onResolved]);

  async function resolveToken(): Promise<Result<{ token: string; cardMeta?: SavedCardMeta }>> {
    if (!form.usingNewCard) return ok({ token: form.selection }); // reuse saved card's token id
    return resolveNewCardToken(
      form.card,
      { ...providerConfig, publicKey },
      order.orderId,
      setPublicKey,
      form.saveCard,
    );
  }

  const handlePay = async (): Promise<void> => {
    setError(null);
    if (form.usingNewCard) {
      const errors = form.validate();
      form.setFieldErrors(errors);
      if (Object.values(errors).some(Boolean)) return; // block submit until valid
    }
    setSubmitting(true);

    const resolved = await resolveToken();
    if (!resolved.ok) {
      setError(resolved.error);
      setSubmitting(false);
      return;
    }

    const charged = await chargeCard({
      orderId: order.orderId,
      token: resolved.data.token,
      saveCard: form.usingNewCard && form.saveCard,
      cardMeta: resolved.data.cardMeta,
      taxId: buyer.taxId,
    });
    if (!charged.ok) {
      setError(charged.error); // transport/validation problem — stay on the form
      setSubmitting(false);
      return;
    }
    // 3-D Secure (FUT-698): the buyer must finish on the provider's page.
    // `submitting` stays true on purpose — the tab is navigating away.
    if (charged.data.hostedCheckoutUrl) {
      return handOverToChallenge(order, charged.data.hostedCheckoutUrl);
    }
    // A business outcome (e.g. declined → FAILED) shows the status screen;
    // an accepted charge begins polling for the async confirmation.
    if (charged.data.status !== "AWAITING_PAYMENT") onResolved(charged.data.status);
    else setSubmitted(true);
  };

  return { submitting, submitted, error, pollError, pollTimedOut, handlePay };
}

/**
 * All card-payment state + the async submit handler (FUT-58), extracted so the
 * card view stays presentational.
 */
export function useCardCheckout(
  order: CheckoutOrder,
  buyer: BuyerInfo,
  providerConfig: CardTokenizationConfig,
  onResolved: (status: OrderStatus) => void,
  pollIntervalMs: number,
  /** The store whose saved cards may be offered (host routing owns the slug). */
  tenantSlug?: string,
): CardCheckout {
  const { savedCards, selection, setSelection } = useSavedCards(tenantSlug);
  const [card, setCard] = useState<CardDetails>(EMPTY_CARD);
  const [fieldErrors, setFieldErrors] = useState<CardFieldErrors>({});
  const [saveCard, setSaveCard] = useState(false);

  const brand = detectBrand(onlyDigits(card.number));
  const usingNewCard = selection === NEW_CARD;

  const validate = (): CardFieldErrors => ({
    number: validateCardNumber(card.number),
    holder: validateHolder(card.holder),
    expiry: validateExpiry(card.expiry),
    cvv: validateCvv(card.cvv, brand),
  });

  const submit = useCardSubmit(order, buyer, providerConfig, onResolved, pollIntervalMs, {
    card,
    usingNewCard,
    selection,
    saveCard,
    validate,
    setFieldErrors,
  });

  return {
    savedCards,
    selection,
    setSelection,
    usingNewCard,
    card,
    setCard,
    fieldErrors,
    setFieldErrors,
    brand,
    saveCard,
    setSaveCard,
    ...submit,
  };
}
