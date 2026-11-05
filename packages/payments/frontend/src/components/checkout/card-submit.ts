/**
 * The card charge's submit machine (FUT-58): validate → tokenize (self-heal) →
 * charge → poll for the async confirmation.
 *
 * The one list (`./list/charge-runners.tsx`) and the factory's card entry
 * (`./list/card-entry.tsx`) both run it; neither owns a copy. It holds no card
 * state of its own: the screen that draws the fields hands them in as
 * {@link CardFormState}.
 */
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

import {
  plainTaxId,
  type CardDetails,
  type CardFieldErrors,
  type CardTokenizationConfig,
} from "../../card";
import { err, ok, type Result } from "../../result";

import {
  resolveNewCardToken,
  type CardInstruments,
  type RefreshBrowserKey,
} from "./card-instruments";
import {
  CARD_DECLINED_CODE,
  cardRefusalOf,
  handOverToChallenge,
  refusalSentence,
  reportResolved,
  type CardRefusal,
  type ChallengeScope,
} from "./card-outcome";
import { useCardPublicKey } from "./card-sources";
import { useCheckoutClientApi } from "./client-context";
import { useCheckoutNavigate } from "./navigate-context";
import type { CardChainLink } from "./method-capability";
import type { BuyerInfo, ChargeCardInput, CheckoutOrder, OnCheckoutResolved, OrderStatus } from "./types";
import { authenticateDebit, type DebitAuthentication } from "./debit-charge";
import type { CheckoutClient } from "./transport";
import { usePaymentPolling } from "./use-payment-polling";
import type { CardCopy } from "../../card/copy";
import type { SettlingCopy } from "./screens-copy";
import { useCheckoutCopy } from "./copy-context";

/** What a card charge reports while it runs — the screen around it draws from this. */
export interface CardSubmit {
  submitting: boolean;
  submitted: boolean;
  error: string | null;
  /** The failure's machine code, when the server sent one — drives PRESENTATION. */
  errorCode: string | null;
  /**
   * The card was REFUSED (FUT-4401) — at once, or after the charge was
   * accepted — and {@link error} says why. The screen keeps the buyer on the
   * card form with it, rather than swapping to a status screen.
   */
  refusal: CardRefusal | null;
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
  /**
   * The order-scoped key refresh has not answered yet (`./card-sources.ts`): a
   * charge started now would tokenize a new card with no key. A screen that
   * starts the charge itself waits for this to clear.
   */
  keyPending: boolean;
  handlePay: () => Promise<void>;
}

/** The form inputs the submit handler reads — owned by the screen that draws the fields. */
interface CardFormState {
  card: CardDetails;
  usingNewCard: boolean;
  selection: string;
  saveCard: boolean;
  validate: () => CardFieldErrors;
  setFieldErrors: Dispatch<SetStateAction<CardFieldErrors>>;
  /** Charge the card as DEBIT, after its 3-D Secure (FUT-3754). */
  debit?: DebitAuthentication;
}

/**
 * The charge's body. A DEBIT card (FUT-3754) is 3-D Secure authenticated first
 * and charged with the head's own instrument only — the authentication is that
 * provider's — so no per-provider map, and nothing saved.
 */
async function chargeBodyOf(
  form: CardFormState,
  instruments: CardInstruments,
  ctx: { client: CheckoutClient; order: CheckoutOrder; buyer: BuyerInfo },
): Promise<Result<ChargeCardInput>> {
  const body: ChargeCardInput = {
    orderId: ctx.order.orderId,
    token: instruments.token,
    tokensByProvider: instruments.tokensByProvider,
    saveCard: form.usingNewCard && form.saveCard,
    cardMeta: instruments.cardMeta,
    taxId: plainTaxId(ctx.buyer.taxId),
  };
  if (!form.debit) return ok(body);
  const authenticated = await authenticateDebit({ ...ctx, encryptedCard: instruments.token, debit: form.debit });
  if (!authenticated.ok) return authenticated;
  return ok({ ...body, tokensByProvider: undefined, saveCard: false, funding: "DEBIT", authenticationId: authenticated.data });
}

/**
 * The card AWAITING wait, bounded in WALL TIME: 90 s (FUT-191, FUT-1144).
 *
 * It was 36 healthy polls, which is the same 90 s at the default 2500 ms
 * interval and an unbounded wait at any other — including the one that
 * mattered, where every poll is FAILING and the healthy count never moves.
 * PIX is bounded too since FUT-1170, but by the CHARGE's own expiry rather
 * than by a constant: a code the buyer can still scan is still worth watching,
 * and one that has died is not.
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
 * Where a submit ENDED, as the screen reads it — and the three ways to end one:
 * a failure that never became a charge, a refusal (FUT-4401), and a fresh press.
 *
 * Every ending leaves a message and gives the controls back: `submitting` and
 * `submitted` both fall, so nothing stays on a spinner over a sentence.
 */
function useSubmitEnding(settlingCopy: SettlingCopy) {
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<CardRefusal | null>(null);
  const fail = (message: string, code: string | null = null): void => {
    setError(message);
    setErrorCode(code);
    setSubmitted(false);
    setSubmitting(false);
  };
  // A refusal is said beside the card, worded by the reason the server sent.
  const refuse = (next: CardRefusal): void => {
    setRefusal(next);
    fail(refusalSentence(settlingCopy, next.decline), CARD_DECLINED_CODE);
  };
  const press = (): void => {
    setError(null);
    setErrorCode(null);
    setRefusal(null);
  };
  const state = { submitting, submitted, error, errorCode, refusal };
  return { state, setSubmitting, setSubmitted, fail, refuse, press };
}

/**
 * The submit state machine (FUT-58): validate → tokenize (self-heal) → charge →
 * poll for the async confirmation, bubbling the terminal status up via
 * {@link onResolved}. A refusal — at once or after acceptance — stays beside
 * the card (FUT-4401).
 */
export function useCardSubmit(
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
  // The active key: resolved by the checkout config, overridden by the
  // rotated-key self-heal for the rest of the session.
  const { publicKey, setPublicKey, keyPending } = useCardPublicKey(order.orderId, providerConfig);
  const client = useCheckoutClientApi();
  const navigate = useCheckoutNavigate();
  const { card: cardCopy, screens } = useCheckoutCopy();
  const ending = useSubmitEnding(screens.settling);
  const { setSubmitting, setSubmitted, fail, refuse } = ending;

  const { status, ...wait } = useCardWait(order.orderId, ending.state.submitted, pollIntervalMs);
  const latestRefuse = useRef(refuse);
  latestRefuse.current = refuse;
  useEffect(() => {
    // A refusal that arrived after the charge was accepted: the poll carries no
    // classification, and the server closed the order (`cardRefusalOf()`).
    if (status === "FAILED") latestRefuse.current(cardRefusalOf());
    else if (status && status !== "AWAITING_PAYMENT") onResolved(status);
  }, [status, onResolved]);

  const handlePay = async (): Promise<void> => {
    ending.press();
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
    const body = resolved.ok ? await chargeBodyOf(form, resolved.data, { client, order, buyer }) : err<ChargeCardInput>(resolved.error);
    if (!body.ok) return fail(body.error);
    const charged = await client.charge(body.data);
    // A transport/validation problem stays on the form. An UNRESOLVED charge is
    // not a decline: some provider may be holding the money, so the view must
    // not dress it as one (`./charge-states.tsx`) — hence the code.
    if (!charged.ok) return fail(charged.error, charged.code ?? null);
    // 3-D Secure (FUT-698): the buyer must finish on the provider's page.
    // `submitting` stays true on purpose — the tab is navigating away.
    if (charged.data.hostedCheckoutUrl) {
      return handOverToChallenge(order, charged.data.hostedCheckoutUrl, navigate, scope);
    }
    // A refusal stays beside the card, worded by the reason the server
    // classified (FUT-1145, FUT-4401); any other business outcome shows the
    // status screen; an accepted charge begins polling.
    if (charged.data.status === "FAILED") refuse(cardRefusalOf(charged.data));
    else if (charged.data.status !== "AWAITING_PAYMENT") reportResolved(charged.data, onResolved);
    else setSubmitted(true);
  };

  return { ...ending.state, ...wait, keyPending, handlePay };
}
