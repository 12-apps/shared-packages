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
import { handOverToChallenge, reportResolved, type ChallengeScope } from "./card-outcome";
import { useCheckoutClientApi } from "./client-context";
import { useCheckoutNavigate } from "./navigate-context";
import type { CardChainLink } from "./method-capability";
import { useOneClickArmed, useOneClickPay } from "./one-click";
import type { BuyerInfo, CheckoutOrder, OnCheckoutResolved, OrderStatus } from "./types";
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
function useSavedCards(
  tenantSlug: string | undefined,
  /**
   * The buyer is here because a card was REFUSED (FUT-1145), so the saved card
   * this would otherwise preselect is the one that just failed. The list is
   * still offered — another saved card may well work — but nothing is chosen
   * for them, which puts the form in front of a buyer whose only untried
   * instrument is a new one.
   */
  freshInstrument: boolean,
): {
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
      if (first && !freshInstrument) setSelection(first.id);
    });
    return () => {
      active = false;
    };
  }, [tenantSlug, client, freshInstrument]);

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
export interface CardCheckout {
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
  /**
   * The last status poll failed. TRANSIENT (FUT-1144): the wait carries on at a
   * backed-off cadence and this clears on the next success, so the view shows
   * it as "still trying" beside {@link pollCheckAgain} rather than as an end.
   */
  pollError: string | null;
  /** The bounded AWAITING wait elapsed (FUT-191, now wall-clock — FUT-1144). */
  pollTimedOut: boolean;
  /** Ask now and restart the wait — the buyer's "verificar de novo". */
  pollCheckAgain: () => void;
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
  | "pollCheckAgain"
  | "handlePay"
>;

/**
 * The card AWAITING wait, bounded in WALL TIME: 90 s (FUT-191, FUT-1144).
 *
 * It was 36 healthy polls, which is the same 90 s at the default 2500 ms
 * interval and an unbounded wait at any other — including the one that
 * mattered, where every poll is FAILING and the healthy count never moves.
 * PIX passes no bound at all and keeps today's behavior: its charge expires
 * server-side and comes back as a terminal EXPIRED.
 */
const CARD_AWAITING_WAIT_MS = 90_000;

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
 * The card's status wait, named the way the view reads it.
 *
 * Its own function so `useCardSubmit` stays inside the size gate, and so the
 * one decision here — this wait is bounded in WALL TIME — sits beside the
 * constant that states it rather than inside a submit machine.
 */
function useCardWait(
  orderId: string,
  submitted: boolean,
  intervalMs: number,
): {
  status: OrderStatus | null;
  pollError: string | null;
  pollTimedOut: boolean;
  pollCheckAgain: () => void;
} {
  const { status, error, timedOut, checkAgain } = usePaymentPolling(orderId, {
    enabled: submitted,
    intervalMs,
    maxWaitMs: CARD_AWAITING_WAIT_MS,
  });
  return { status, pollError: error, pollTimedOut: timedOut, pollCheckAgain: checkAgain };
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
  onResolved: OnCheckoutResolved,
  pollIntervalMs: number,
  form: CardFormState,
  providerChain: readonly CardChainLink[],
  /** WHOSE store and WHICH basket this charge is for — parked with a 3DS
   *  hand-off, which is otherwise resumable over any basket anywhere. */
  scope: ChallengeScope,
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

  const { status, ...wait } = useCardWait(order.orderId, submitted, pollIntervalMs);

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
      return handOverToChallenge(order, charged.data.hostedCheckoutUrl, navigate, scope);
    }
    // A business outcome shows the status screen, carrying the refusal the
    // server classified (FUT-1145); an accepted charge begins polling.
    if (charged.data.status !== "AWAITING_PAYMENT") reportResolved(charged.data, onResolved);
    else setSubmitted(true);
  };

  return { submitting, submitted, error, errorCode, ...wait, handlePay };
}

/**
 * All card-payment state + the async submit handler (FUT-58), extracted so the
 * card view stays presentational.
 */
export function useCardCheckout(
  order: CheckoutOrder,
  buyer: BuyerInfo,
  providerConfig: CardTokenizationConfig,
  onResolved: OnCheckoutResolved,
  pollIntervalMs: number,
  /** The store whose saved cards may be offered (host routing owns the slug). */
  tenantSlug?: string,
  /**
   * The merchant's ordered provider chain (FUT-563) — one instrument is minted
   * per entry so a card charge can fail over. Omitted ⇒ the head alone.
   */
  providerChain: readonly CardChainLink[] = [],
  /** Do not preselect a saved card — the last one was refused (FUT-1145). */
  freshInstrument = false,
  /** WHOSE store and WHICH basket, for the 3-D Secure hand-off's parked order. */
  scope: ChallengeScope = {},
): CardCheckout {
  const { savedCards, selection, setSelection } = useSavedCards(tenantSlug, freshInstrument);
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
    scope,
  );
  // The tap a one-click buyer already made (`./one-click.tsx`). Nothing about
  // the charge differs — this only presses the button, and only while a SAVED
  // card is the selection, which is a state the picker reaches exactly when the
  // instrument list came back with something. A buyer with no saved card is
  // left on the form, which is the ordinary step 2.
  const ready = !usingNewCard && !submit.submitting && !submit.submitted && submit.error === null;
  useOneClickPay({ armed: useOneClickArmed(), ready, pay: submit.handlePay });

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
