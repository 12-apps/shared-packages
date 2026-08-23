import { useEffect, useState } from "react";

import {
  NEW_CARD,
  detectBrand,
  onlyDigits,
  tokenizerFor,
  validateCardNumber,
  validateCvv,
  validateExpiry,
  validateHolder,
  type CardBrand,
  type CardDetails,
  type CardFieldErrors,
  type CardTokenizationConfig,
  type SavedCard,
} from "../../card";
import { ok, type Result } from "../../result";

import {
  resolveNewCardToken,
  type CardInstruments,
  type RefreshBrowserKey,
} from "./card-instruments";
import { useCheckoutClientApi } from "./client-context";
import { rememberHostedOrder } from "./hosted-return";
import { useCheckoutNavigate, type CheckoutNavigate } from "./navigate-context";
import type { CardChainLink } from "./method-capability";
import type { BuyerInfo, CheckoutOrder, OrderStatus } from "./types";
import { usePaymentPolling } from "./use-payment-polling";
import type { CardCopy } from "../../card/copy";
import { useCheckoutCopy } from "./copy-context";

const EMPTY_CARD: CardDetails = { number: "", holder: "", expiry: "", cvv: "" };

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
  const client = useCheckoutClientApi();

  useEffect(() => {
    let active = true;
    void client.listInstruments(tenantSlug).then((cards) => {
      if (!active) return;
      setSavedCards(cards);
      const first = cards[0];
      if (first) setSelection(first.id);
    });
    return () => {
      active = false;
    };
  }, [tenantSlug, client]);

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
  const client = useCheckoutClientApi();
  const refreshable =
    config.provider !== null && tokenizerFor(config.provider) === "pagbank-sdk";

  useEffect(() => {
    if (config.publicKey !== null || !refreshable) return undefined;
    let active = true;
    void client.refreshBrowserKey({ orderId }).then((result) => {
      if (active && result.ok && result.data.publicKey) setPublicKey(result.data.publicKey);
    });
    return () => {
      active = false;
    };
  }, [orderId, config.publicKey, refreshable, client]);

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
  /** The failure's machine code, when the server sent one — drives PRESENTATION. */
  errorCode: string | null;
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
  | "submitting"
  | "submitted"
  | "error"
  | "errorCode"
  | "pollError"
  | "pollTimedOut"
  | "handlePay"
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
function handOverToChallenge(
  order: CheckoutOrder,
  url: string,
  navigate: CheckoutNavigate,
): void {
  // PARK FIRST. The navigation may not come back to a live SPA at all, and a
  // return trip that finds nothing parked lands the buyer on a blank
  // confirmation after they have paid.
  rememberHostedOrder(order);
  navigate(url);
}

/** The buyer's card is invalid — block the submit and show which field. */
function blockedByForm(form: CardFormState): boolean {
  if (!form.usingNewCard) return false;
  const errors = form.validate();
  form.setFieldErrors(errors);
  return Object.values(errors).some(Boolean);
}

/**
 * What to charge with: a saved card's vault id, or fresh instruments minted for
 * every provider the walk may reach (FUT-563).
 *
 * A saved card is deliberately never chained — a vault token names a card in
 * whichever provider's vault holds it, which the server resolves; the
 * instruments minted this session say nothing about who that is.
 */
async function resolveInstruments(input: {
  form: CardFormState;
  orderId: string;
  config: CardTokenizationConfig;
  onKeyRefreshed: (key: string) => void;
  providerChain: readonly CardChainLink[];
  /** The bound key-refresh call (FUT-741) — the self-heal must hit OUR mount. */
  refreshKey: RefreshBrowserKey;
  /** The words a failed mint reports with — the host's (FUT-760). */
  copy: CardCopy;
}): Promise<Result<CardInstruments>> {
  const { form } = input;
  if (!form.usingNewCard) return ok({ token: form.selection });
  return resolveNewCardToken(
    form.card,
    input.config,
    input.orderId,
    input.onKeyRefreshed,
    form.saveCard,
    input.providerChain,
    input.copy,
    input.refreshKey,
  );
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
  providerChain: readonly CardChainLink[],
): CardSubmit {
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  // The active key: resolved by the checkout config, overridden by the
  // rotated-key self-heal for the rest of the session.
  const { publicKey, setPublicKey } = useCardPublicKey(order.orderId, providerConfig);
  const client = useCheckoutClientApi();
  const navigate = useCheckoutNavigate();
  const cardCopy = useCheckoutCopy().card;

  const { status, error: pollError, timedOut: pollTimedOut } = usePaymentPolling(order.orderId, {
    enabled: submitted,
    intervalMs: pollIntervalMs,
    maxHealthyPolls: CARD_AWAITING_POLL_CAP,
  });

  useEffect(() => {
    if (status && status !== "AWAITING_PAYMENT") onResolved(status);
  }, [status, onResolved]);

  const handlePay = async (): Promise<void> => {
    setError(null);
    setErrorCode(null);
    if (blockedByForm(form)) return;
    setSubmitting(true);

    const resolved = await resolveInstruments({
      form,
      orderId: order.orderId,
      config: { ...providerConfig, publicKey },
      onKeyRefreshed: setPublicKey,
      providerChain,
      refreshKey: client.refreshBrowserKey,
      copy: cardCopy,
    });
    if (!resolved.ok) {
      setError(resolved.error);
      setSubmitting(false);
      return;
    }

    const charged = await client.charge({
      orderId: order.orderId,
      token: resolved.data.token,
      tokensByProvider: resolved.data.tokensByProvider,
      saveCard: form.usingNewCard && form.saveCard,
      cardMeta: resolved.data.cardMeta,
      taxId: buyer.taxId,
    });
    if (!charged.ok) {
      setError(charged.error); // transport/validation problem — stay on the form
      // An UNRESOLVED charge is not a decline: some provider may be holding the
      // money, so the view must not dress it as one (`card-view.tsx`).
      setErrorCode(charged.code ?? null);
      setSubmitting(false);
      return;
    }
    // 3-D Secure (FUT-698): the buyer must finish on the provider's page.
    // `submitting` stays true on purpose — the tab is navigating away.
    if (charged.data.hostedCheckoutUrl) {
      return handOverToChallenge(order, charged.data.hostedCheckoutUrl, navigate);
    }
    // A business outcome (e.g. declined → FAILED) shows the status screen;
    // an accepted charge begins polling for the async confirmation.
    if (charged.data.status !== "AWAITING_PAYMENT") onResolved(charged.data.status);
    else setSubmitted(true);
  };

  return { submitting, submitted, error, errorCode, pollError, pollTimedOut, handlePay };
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
  /**
   * The merchant's ordered provider chain (FUT-563) — one instrument is minted
   * per entry so a card charge can fail over. Omitted ⇒ the head alone.
   */
  providerChain: readonly CardChainLink[] = [],
): CardCheckout {
  const { savedCards, selection, setSelection } = useSavedCards(tenantSlug);
  const [card, setCard] = useState<CardDetails>(EMPTY_CARD);
  const [fieldErrors, setFieldErrors] = useState<CardFieldErrors>({});
  const [saveCard, setSaveCard] = useState(false);

  const brand = detectBrand(onlyDigits(card.number));
  const usingNewCard = selection === NEW_CARD;

  const cardCopy = useCheckoutCopy().card;
  const fieldCopy = cardCopy.fields;
  const validate = (): CardFieldErrors => ({
    number: validateCardNumber(card.number, fieldCopy),
    holder: validateHolder(card.holder, fieldCopy),
    expiry: validateExpiry(card.expiry, fieldCopy),
    cvv: validateCvv(card.cvv, fieldCopy, brand),
  });

  const submit = useCardSubmit(
    order,
    buyer,
    providerConfig,
    onResolved,
    pollIntervalMs,
    { card, usingNewCard, selection, saveCard, validate, setFieldErrors },
    providerChain,
  );

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
