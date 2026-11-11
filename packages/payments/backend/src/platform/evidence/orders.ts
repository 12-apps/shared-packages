import type { CardDetails } from '../../core/card-details';
import type { StoredCharge } from '../../core/ports';
import {
  afterRefusal,
  firstClaim,
  isNothingToRefund,
  pg1Schedule,
  REFUND_ATTEMPT_DEADLINE_MS,
  refundRefusalOf,
  type RefundRefusal,
} from '../../core/refund-retry';
import { reasonOfFailedCalls, reasonOfStatus } from './failure-reason';
import { recordTraffic, type RecordedOutcome } from './record';
import { answered, clockOf, errorDetail, failureOf, pendingStep, stepOf } from './steps';
import type { BrowserCardResult, EvidenceStep, EvidenceStepKey } from './types';
import { amountsOf, environmentOf } from './environment';
import type { EvidenceRunDeps } from './run';

/**
 * The orders of an evidence run (FUT-3696): the Pix and card scenarios, raised
 * through the host's gateway for the test seller and recorded call by call.
 * Split from `run.ts`, which owns the phases; this owns what each order step
 * counts as evidence — a recorded 2xx answer is always part of the bar. The
 * debit section (`orders-debit.ts`) and the wallet sections (`orders-wallet.ts`)
 * raise their orders through the same helpers.
 */

const PROVIDER = 'pagbank';

/**
 * The amounts come from `evidenceAmounts` (sandbox: ≤ R$ 100,00, which the
 * simulator pays seconds after creation; production: R$ 1,00).
 */
const PIX_POLLS = 8;
const PIX_POLL_MS = 3000;

/** The order id PagBank answered with, read from the recorded calls (FUT-3722). */
function orderIdOf(calls: readonly { responseBody?: unknown }[]): string | null {
  for (const call of calls) {
    const id = (call.responseBody as { id?: unknown } | undefined)?.id;
    if (typeof id === 'string' && id.startsWith('ORDE_')) return id;
  }
  return null;
}

/**
 * The ids a stored charge gives the reader: the order and, once it exists, the
 * charge — both when both are known, so a card scenario correlates with the
 * order PagBank created for it (FUT-3722).
 */
export function idsOf(
  charge: StoredCharge | { providerChargeId: string },
  reference?: string,
  orderId?: string | null,
): Record<string, string> {
  const id = charge.providerChargeId;
  return {
    ...(id.startsWith('ORDE_') ? { order_id: id } : { ...(orderId ? { order_id: orderId } : {}), charge_id: id }),
    ...(reference ? { reference_id: reference } : {}),
  };
}

/** The created Pix: its step, the stored row's id the polls read through, and the order PagBank named. */
interface CreatedPix {
  step: EvidenceStep;
  ids: { chargeId: string; orderId: string } | null;
}

async function createPix(deps: EvidenceRunDeps, runId: string): Promise<CreatedPix> {
  const reference = `homolog-${runId.slice(0, 8)}-pix`;
  const created = await recordTraffic(() =>
    deps.gateway.charge(
      deps.merchant,
      {
        reference,
        idempotencyKey: reference,
        amount: { amountCents: amountsOf(deps).pix, currency: 'BRL' },
        method: 'PIX',
        customer: deps.customer ?? {},
      },
      { provider: PROVIDER },
    ),
  );
  if (!created.ok) {
    return {
      ids: null,
      step: stepOf('pix.create', 'FAILED', clockOf(deps)(), {
        calls: created.calls,
        ids: { reference_id: reference },
        observed: failureOf(deps.copy, created),
        reason: reasonOfFailedCalls(created.calls),
      }),
    };
  }
  // The charge form (FUT-3928) keys the row by the WAITING charge; the order
  // is what PagBank's own logs name, so the evidence names it too.
  const chargeId = created.value.providerChargeId;
  const orderId = created.value.snapshot.settlementHints?.orderId ?? chargeId;
  // A stored charge handed back WITHOUT a call (an idempotent replay) proves
  // nothing about this run, so a recorded 2xx is part of the bar.
  const qr = Boolean(created.value.snapshot.pix?.qrText) && answered(created.calls);
  return {
    ids: { chargeId, orderId },
    step: stepOf('pix.create', qr ? 'EXECUTED' : 'FAILED', clockOf(deps)(), {
      calls: created.calls,
      ids: idsOf(created.value, reference, orderId),
      observed: qr ? deps.copy.qrCreated(orderId) : deps.copy.qrMissing,
    }),
  };
}

interface PixPolls {
  calls: EvidenceStep['calls'];
  status: string | null;
  chargeId: string;
  lastError: unknown;
  made: number;
}

/** Consult the order until the simulator has paid it, or the polls run out. */
export async function pollPix(deps: EvidenceRunDeps, storedId: string): Promise<PixPolls> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const result: PixPolls = { calls: [], status: null, chargeId: storedId, lastError: null, made: 0 };
  while (result.made < (deps.pixPolls ?? PIX_POLLS) && result.status !== 'PAID') {
    if (result.made > 0) await sleep(deps.pixPollMs ?? PIX_POLL_MS);
    result.made += 1;
    const polled = await recordTraffic(() => deps.gateway.refreshCharge(deps.merchant, PROVIDER, result.chargeId));
    result.calls.push(...polled.calls);
    if (!polled.ok) {
      result.lastError = polled.error;
      continue;
    }
    result.status = polled.value.status;
    result.chargeId = polled.value.providerChargeId;
  }
  return result;
}

/**
 * The `pix.consult` step a set of polls makes, and the ids it names. The
 * first and the last poll are kept: the move from "waiting" to "paid" is the
 * evidence, and the polls in between are the same call again.
 */
export function pixConsultStep(
  deps: EvidenceRunDeps,
  polled: PixPolls,
  orderId: string,
): { step: EvidenceStep; ids: Record<string, string> } {
  const ids = { order_id: orderId, ...(polled.chargeId !== orderId ? { charge_id: polled.chargeId } : {}) };
  const step = stepOf('pix.consult', polled.status !== null && answered(polled.calls) ? 'EXECUTED' : 'FAILED', clockOf(deps)(), {
    calls: polled.calls.length > 2 ? [polled.calls[0]!, polled.calls.at(-1)!] : polled.calls,
    ids,
    observed:
      polled.status !== null
        ? deps.copy.consultStatus(polled.status, polled.made)
        : deps.copy.callError(errorDetail(polled.lastError)),
  });
  return { step, ids };
}

/** Phase 2's Pix steps in production: the QR, then three steps waiting on a person. */
function awaitingPixSteps(deps: EvidenceRunDeps, create: EvidenceStep, created: boolean): EvidenceStep[] {
  // A person pays it: nothing to poll yet. `pixConfirmSteps` completes it.
  const waiting = created ? deps.copy.pixAwaitingPayment : undefined;
  return [
    create,
    pendingStep('pix.consult', deps.copy, waiting),
    pendingStep('pix.paid', deps.copy, waiting),
    pendingStep('pix.refund', deps.copy, waiting),
  ];
}

export async function pixSteps(deps: EvidenceRunDeps, runId: string): Promise<EvidenceStep[]> {
  const clock = clockOf(deps);
  const created = await createPix(deps, runId);
  if (environmentOf(deps) === 'PRODUCTION') return awaitingPixSteps(deps, created.step, created.ids !== null);
  if (!created.ids) return [created.step, pendingStep('pix.consult', deps.copy), pendingStep('pix.paid', deps.copy)];
  const { chargeId, orderId } = created.ids;

  const polled = await pollPix(deps, chargeId);
  const { step: consult, ids } = pixConsultStep(deps, polled, orderId);
  const waited = Math.round(((deps.pixPolls ?? PIX_POLLS) * (deps.pixPollMs ?? PIX_POLL_MS)) / 1000);
  const paid =
    polled.status === 'PAID'
      ? stepOf('pix.paid', 'EXECUTED', clock(), { ids, observed: deps.copy.paid })
      : pendingStep('pix.paid', deps.copy, deps.copy.notPaidYet(waited));
  return [created.step, consult, paid];
}

/** One card order a scenario raises: which step it is, and what PagBank must answer. */
interface CardOrder {
  key: EvidenceStepKey;
  /** The charge status the scenario expects (PAID, DECLINED). */
  expected: string;
  reference: string;
  amountCents: number;
  card: CardDetails;
  notes: string[];
}

interface RaisedCardOrder {
  step: EvidenceStep;
  charge: StoredCharge | null;
  orderId: string | null;
}

/** Why the browser sent no card blob, in the copy's words. */
export function encryptFailure(deps: EvidenceRunDeps, card: BrowserCardResult): string {
  return deps.copy.encryptFailed(card.failure ? deps.copy.browserFailures[card.failure] : '');
}

async function cardCharge(deps: EvidenceRunDeps, runId: string, card: BrowserCardResult): Promise<RaisedCardOrder> {
  const key = card.scenario === 'approved' ? 'card.approved' : 'card.declined';
  const notes = [`${card.brand} ${card.masked}`];
  if (!card.encrypted) {
    return { step: { ...pendingStep(key, deps.copy, encryptFailure(deps, card)), notes }, charge: null, orderId: null };
  }
  return raiseCardOrder(deps, {
    key,
    expected: card.scenario === 'approved' ? 'PAID' : 'DECLINED',
    reference: `homolog-${runId.slice(0, 8)}-card-${card.scenario}`,
    amountCents: amountsOf(deps).card,
    card: { token: card.encrypted, installments: 1 },
    notes,
  });
}

/** Raise one card order through the gateway, recorded; EXECUTED only on the expected status. */
export async function raiseCardOrder(deps: EvidenceRunDeps, order: CardOrder): Promise<RaisedCardOrder> {
  const { key, expected, reference, notes } = order;
  const raised = await recordTraffic(() =>
    deps.gateway.charge(
      deps.merchant,
      {
        reference,
        idempotencyKey: reference,
        amount: { amountCents: order.amountCents, currency: 'BRL' },
        method: 'CARD',
        customer: deps.customer ?? {},
        card: order.card,
      },
      { provider: PROVIDER },
    ),
  );
  if (!raised.ok) {
    return {
      step: stepOf(key, 'FAILED', clockOf(deps)(), {
        calls: raised.calls,
        notes,
        ids: { reference_id: reference },
        observed: failureOf(deps.copy, raised),
        reason: reasonOfFailedCalls(raised.calls),
      }),
      charge: null,
      orderId: orderIdOf(raised.calls),
    };
  }
  const status = raised.value.snapshot.status;
  const orderId = orderIdOf(raised.calls);
  const executed = status === expected && answered(raised.calls);
  return {
    step: stepOf(key, executed ? 'EXECUTED' : 'FAILED', clockOf(deps)(), {
      calls: raised.calls,
      notes,
      ids: idsOf(raised.value, reference, orderId),
      observed: deps.copy.chargeStatus(status),
      reason: executed ? undefined : reasonOfStatus(status, expected),
    }),
    charge: raised.value,
    orderId,
  };
}

function encryptStep(deps: EvidenceRunDeps, cards: readonly BrowserCardResult[]): EvidenceStep {
  const described = cards.map((card) => `${card.brand} ${card.masked}`).join('; ');
  if (cards.length > 0 && cards.every((card) => card.encrypted)) {
    return stepOf('card.encrypt', 'EXECUTED', clockOf(deps)(), {
      observed: deps.copy.encrypted(described),
      notes: [described],
    });
  }
  const reasons = new Set(cards.flatMap((card) => (card.failure ? [deps.copy.browserFailures[card.failure]] : [])));
  return pendingStep('card.encrypt', deps.copy, deps.copy.encryptFailed([...reasons].join('; ')));
}

/** A read PagBank answered 5xx: its own outage, worth one more try (FUT-3722). */
function serverError(outcome: { ok: boolean; calls: readonly { status?: number }[] }): boolean {
  const status = outcome.calls.at(-1)?.status;
  return !outcome.ok && typeof status === 'number' && status >= 500;
}

/**
 * Consult the approved charge — a read, so a PagBank 5xx is retried ONCE after
 * a pause (the sandbox answered 503 on a run). Both attempts stay in the
 * evidence; only the last one decides.
 */
export async function consultCharge(
  deps: EvidenceRunDeps,
  key: 'card.approvedConsult' | 'debit.consult' | 'gpay.consult' | 'apay.consult',
  chargeId: string,
  orderId: string | null,
): Promise<EvidenceStep> {
  const consult = () => recordTraffic(() => deps.gateway.refreshCharge(deps.merchant, PROVIDER, chargeId));
  const first = await consult();
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const consulted = serverError(first) ? await sleep(deps.pixPollMs ?? PIX_POLL_MS).then(consult) : first;
  const calls = consulted === first ? first.calls : [...first.calls, ...consulted.calls];
  const paid = consulted.ok && consulted.value.status === 'PAID' && answered(consulted.calls);
  return stepOf(key, paid ? 'EXECUTED' : 'FAILED', clockOf(deps)(), {
    calls,
    ids: idsOf({ providerChargeId: chargeId }, undefined, orderId),
    observed: consulted.ok ? deps.copy.chargeStatus(consulted.value.status) : failureOf(deps.copy, consulted),
  });
}

/** What a card cancel's answer comes to: done (cancelled, or nothing left), or the refusal; and its observed line. */
function cancelOutcome(
  deps: EvidenceRunDeps,
  canceled: RecordedOutcome<{ status: string }>,
): { done: boolean; refusal: RefundRefusal | null; observed: string } {
  if (!canceled.ok) {
    if (isNothingToRefund(canceled.error)) return { done: true, refusal: null, observed: deps.copy.canceled('REFUNDED') };
    return { done: false, refusal: refundRefusalOf(canceled.error), observed: failureOf(deps.copy, canceled) };
  }
  const done = canceled.value.status === 'REFUNDED' && answered(canceled.calls);
  // PagBank's own word for the charge (CANCELED), which is what the scenario
  // expects — not this package's normalized refund status.
  const said = (canceled.calls.at(-1)?.responseBody as { status?: unknown } | undefined)?.status;
  return { done, refusal: done ? null : 'UNKNOWN', observed: deps.copy.canceled(typeof said === 'string' ? said : canceled.value.status) };
}

/**
 * Cancel the approved charge ONCE (FUT-4740). PagBank answers a cancel sent
 * seconds after a capture with 40008 "not yet"; that used to be retried here,
 * inside the run request, for three minutes. Now the step keeps the refund's
 * retry state (attempt 1, the next due at +5 min) and the evidence sweep sends
 * attempts 2 and 3, as it does for the production Pix (FUT-4360).
 */
export async function cancelCharge(
  deps: EvidenceRunDeps,
  key: 'card.cancel' | 'debit.cancel' | 'gpay.cancel' | 'apay.cancel',
  chargeId: string,
  orderId: string | null,
): Promise<EvidenceStep> {
  // This caller owns the retry (the sweep) and reports a give-up once, so the gateway stays quiet for it.
  const signal = AbortSignal.timeout(deps.refundAttemptMs ?? REFUND_ATTEMPT_DEADLINE_MS);
  const canceled = await recordTraffic(() =>
    deps.gateway.refund(deps.merchant, PROVIDER, { providerChargeId: chargeId, retriedByCaller: true, signal }),
  );
  const { done, refusal, observed } = cancelOutcome(deps, canceled);
  const now = clockOf(deps)();
  const refund = refusal === null ? null : afterRefusal({ ...firstClaim(now, null), reported: false }, refusal, now, pg1Schedule);
  return stepOf(key, done ? 'EXECUTED' : 'FAILED', now, {
    calls: canceled.calls,
    ids: idsOf({ providerChargeId: chargeId }, undefined, orderId),
    observed,
    ...(refund ? { refund } : {}),
  });
}

/** The PAID charge's id and its order, or nulls when it was not paid. */
export function paidRefs(approved: RaisedCardOrder | null): { chargeId: string | null; orderId: string | null } {
  const paid = approved?.charge?.snapshot.status === 'PAID';
  return { chargeId: paid ? approved!.charge!.providerChargeId : null, orderId: approved?.orderId ?? null };
}

export async function cardSteps(deps: EvidenceRunDeps, runId: string, cards: readonly BrowserCardResult[]): Promise<EvidenceStep[]> {
  const scenario = async (which: 'approved' | 'declined') => {
    const card = cards.find((candidate) => candidate.scenario === which);
    return card ? cardCharge(deps, runId, card) : null;
  };
  // The encryption happened in the browser BEFORE any order: stamp it first.
  // The debit card has its own section (and its own 3DS step), so 4.2 is
  // about the two credit cards only.
  const encrypt = encryptStep(deps, cards.filter((card) => card.scenario !== 'debit'));
  const approved = await scenario('approved');
  const { chargeId, orderId } = paidRefs(approved);
  const consult = chargeId
    ? await consultCharge(deps, 'card.approvedConsult', chargeId, orderId)
    : pendingStep('card.approvedConsult', deps.copy);
  // Production has no card that declines on demand: no declined order is
  // raised there, and its file does not list the step (`evidenceStepKeys`).
  const declined = environmentOf(deps) === 'PRODUCTION' ? null : await scenario('declined');
  const cancel = chargeId ? await cancelCharge(deps, 'card.cancel', chargeId, orderId) : pendingStep('card.cancel', deps.copy);
  return [
    encrypt,
    approved?.step ?? pendingStep('card.approved', deps.copy),
    consult,
    declined?.step ?? pendingStep('card.declined', deps.copy),
    cancel,
  ];
}
