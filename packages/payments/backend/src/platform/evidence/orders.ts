import type { StoredCharge } from '../../core/ports';
import { recordTraffic } from './record';
import { answered, clockOf, errorDetail, failureOf, pendingStep, stepOf } from './steps';
import type { BrowserCardResult, EvidenceStep } from './types';
import type { EvidenceRunDeps } from './run';

/**
 * The orders of an evidence run (FUT-3696): the Pix and card scenarios, raised
 * through the host's gateway for the test seller and recorded call by call.
 * Split from `run.ts`, which owns the phases; this owns what each order step
 * counts as evidence — a recorded 2xx answer is always part of the bar.
 */

const PROVIDER = 'pagbank';

/** ≤ R$ 100,00: the sandbox simulator pays a Pix order seconds after creation. */
const PIX_CENTS = 1000;
const CARD_CENTS = 1500;
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
function idsOf(
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

async function createPix(deps: EvidenceRunDeps, runId: string): Promise<{ step: EvidenceStep; orderId: string | null }> {
  const reference = `homolog-${runId.slice(0, 8)}-pix`;
  const created = await recordTraffic(() =>
    deps.gateway.charge(
      deps.merchant,
      {
        reference,
        idempotencyKey: reference,
        amount: { amountCents: PIX_CENTS, currency: 'BRL' },
        method: 'PIX',
        customer: deps.customer,
      },
      { provider: PROVIDER },
    ),
  );
  if (!created.ok) {
    return {
      orderId: null,
      step: stepOf('pix.create', 'FAILED', clockOf(deps)(), {
        calls: created.calls,
        ids: { reference_id: reference },
        observed: failureOf(deps.copy, created),
      }),
    };
  }
  const orderId = created.value.providerChargeId;
  // A stored charge handed back WITHOUT a call (an idempotent replay) proves
  // nothing about this run, so a recorded 2xx is part of the bar.
  const qr = Boolean(created.value.snapshot.pix?.qrText) && answered(created.calls);
  return {
    orderId,
    step: stepOf('pix.create', qr ? 'EXECUTED' : 'FAILED', clockOf(deps)(), {
      calls: created.calls,
      ids: idsOf(created.value, reference),
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
async function pollPix(deps: EvidenceRunDeps, orderId: string): Promise<PixPolls> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const result: PixPolls = { calls: [], status: null, chargeId: orderId, lastError: null, made: 0 };
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

export async function pixSteps(deps: EvidenceRunDeps, runId: string): Promise<EvidenceStep[]> {
  const clock = clockOf(deps);
  const created = await createPix(deps, runId);
  const orderId = created.orderId;
  if (!orderId) return [created.step, pendingStep('pix.consult', deps.copy), pendingStep('pix.paid', deps.copy)];

  const polled = await pollPix(deps, orderId);
  const ids = { order_id: orderId, ...(polled.chargeId !== orderId ? { charge_id: polled.chargeId } : {}) };
  const consult = stepOf('pix.consult', polled.status !== null && answered(polled.calls) ? 'EXECUTED' : 'FAILED', clock(), {
    // The first and the last poll: the move from "waiting" to "paid" is the
    // evidence, and the polls in between are the same call again.
    calls: polled.calls.length > 2 ? [polled.calls[0]!, polled.calls.at(-1)!] : polled.calls,
    ids,
    observed:
      polled.status !== null
        ? deps.copy.consultStatus(polled.status, polled.made)
        : deps.copy.callError(errorDetail(polled.lastError)),
  });
  const waited = Math.round(((deps.pixPolls ?? PIX_POLLS) * (deps.pixPollMs ?? PIX_POLL_MS)) / 1000);
  const paid =
    polled.status === 'PAID'
      ? stepOf('pix.paid', 'EXECUTED', clock(), { ids, observed: deps.copy.paid })
      : pendingStep('pix.paid', deps.copy, deps.copy.notPaidYet(waited));
  return [created.step, consult, paid];
}

async function cardCharge(
  deps: EvidenceRunDeps,
  runId: string,
  card: BrowserCardResult,
): Promise<{ step: EvidenceStep; charge: StoredCharge | null; orderId: string | null }> {
  const key = card.scenario === 'approved' ? 'card.approved' : 'card.declined';
  const expected = card.scenario === 'approved' ? 'PAID' : 'DECLINED';
  const reference = `homolog-${runId.slice(0, 8)}-card-${card.scenario}`;
  const notes = [`${card.brand} ${card.masked}`];
  if (!card.encrypted) {
    const why = deps.copy.encryptFailed(card.failure ? deps.copy.browserFailures[card.failure] : '');
    return { step: { ...pendingStep(key, deps.copy, why), notes }, charge: null, orderId: null };
  }
  const encrypted = card.encrypted;
  const raised = await recordTraffic(() =>
    deps.gateway.charge(
      deps.merchant,
      {
        reference,
        idempotencyKey: reference,
        amount: { amountCents: CARD_CENTS, currency: 'BRL' },
        method: 'CARD',
        customer: deps.customer,
        card: { token: encrypted, installments: 1 },
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
      }),
      charge: null,
      orderId: orderIdOf(raised.calls),
    };
  }
  const status = raised.value.snapshot.status;
  const orderId = orderIdOf(raised.calls);
  return {
    step: stepOf(key, status === expected && answered(raised.calls) ? 'EXECUTED' : 'FAILED', clockOf(deps)(), {
      calls: raised.calls,
      notes,
      ids: idsOf(raised.value, reference, orderId),
      observed: deps.copy.chargeStatus(status),
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
async function consultApproved(deps: EvidenceRunDeps, chargeId: string, orderId: string | null): Promise<EvidenceStep> {
  const consult = () => recordTraffic(() => deps.gateway.refreshCharge(deps.merchant, PROVIDER, chargeId));
  const first = await consult();
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const consulted = serverError(first) ? await sleep(deps.pixPollMs ?? PIX_POLL_MS).then(consult) : first;
  const calls = consulted === first ? first.calls : [...first.calls, ...consulted.calls];
  const paid = consulted.ok && consulted.value.status === 'PAID' && answered(consulted.calls);
  return stepOf('card.approvedConsult', paid ? 'EXECUTED' : 'FAILED', clockOf(deps)(), {
    calls,
    ids: idsOf({ providerChargeId: chargeId }, undefined, orderId),
    observed: consulted.ok ? deps.copy.chargeStatus(consulted.value.status) : failureOf(deps.copy, consulted),
  });
}

/**
 * The pauses before each retried cancel while PagBank says it cannot refund
 * yet: exponential, capped, three minutes in all. The fourth evidence run
 * (FUT-3722) got 40008 on four attempts spread over nine seconds, so the
 * sandbox needs minutes, not seconds, after a capture.
 */
const CANCEL_BACKOFF_MS = [5_000, 10_000, 20_000, 40_000, 60_000, 45_000];

/**
 * PagBank's "not yet": `40008 refund_temporarily_unavailable` ("Transaction is
 * not found"), answered by the sandbox to a cancel sent seconds after the
 * charge was captured (the third evidence run, FUT-3722).
 */
function refundNotYet(outcome: { ok: boolean; calls: readonly { responseBody?: unknown }[] }): boolean {
  if (outcome.ok) return false;
  const body = outcome.calls.at(-1)?.responseBody as { error_messages?: { code?: unknown }[] } | undefined;
  return body?.error_messages?.some((message) => String(message.code) === '40008') ?? false;
}

/**
 * Cancel the approved charge, retried with backoff while PagBank answers
 * that it cannot refund it yet. Every attempt stays in the evidence; only the
 * last one decides.
 */
async function cancelUntilAnswered(deps: EvidenceRunDeps, chargeId: string) {
  const cancel = () => recordTraffic(() => deps.gateway.refund(deps.merchant, PROVIDER, { providerChargeId: chargeId }));
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let canceled = await cancel();
  const calls = [...canceled.calls];
  for (const pause of CANCEL_BACKOFF_MS) {
    if (!refundNotYet(canceled)) break;
    await sleep(pause);
    canceled = await cancel();
    calls.push(...canceled.calls);
  }
  return { canceled, calls };
}

async function cancelApproved(deps: EvidenceRunDeps, chargeId: string, orderId: string | null): Promise<EvidenceStep> {
  const { canceled, calls } = await cancelUntilAnswered(deps, chargeId);
  const done = canceled.ok && canceled.value.status === 'REFUNDED' && answered(canceled.calls);
  // PagBank's own word for the charge (CANCELED), which is what the scenario
  // expects — not this package's normalized refund status.
  const said = (canceled.calls.at(-1)?.responseBody as { status?: unknown } | undefined)?.status;
  return stepOf('card.cancel', done ? 'EXECUTED' : 'FAILED', clockOf(deps)(), {
    calls,
    ids: idsOf({ providerChargeId: chargeId }, undefined, orderId),
    observed: canceled.ok ? deps.copy.canceled(typeof said === 'string' ? said : canceled.value.status) : failureOf(deps.copy, canceled),
  });
}

/** The PAID approved charge's id and its order, or nulls when it was not approved. */
function approvedRefs(approved: Awaited<ReturnType<typeof cardCharge>> | null): { chargeId: string | null; orderId: string | null } {
  const paid = approved?.charge?.snapshot.status === 'PAID';
  return { chargeId: paid ? approved!.charge!.providerChargeId : null, orderId: approved?.orderId ?? null };
}

export async function cardSteps(deps: EvidenceRunDeps, runId: string, cards: readonly BrowserCardResult[]): Promise<EvidenceStep[]> {
  const scenario = async (which: BrowserCardResult['scenario']) => {
    const card = cards.find((candidate) => candidate.scenario === which);
    return card ? cardCharge(deps, runId, card) : null;
  };
  // The encryption happened in the browser BEFORE any order: stamp it first.
  const encrypt = encryptStep(deps, cards);
  const approved = await scenario('approved');
  const { chargeId, orderId } = approvedRefs(approved);
  const consult = chargeId ? await consultApproved(deps, chargeId, orderId) : pendingStep('card.approvedConsult', deps.copy);
  const declined = await scenario('declined');
  const cancel = chargeId ? await cancelApproved(deps, chargeId, orderId) : pendingStep('card.cancel', deps.copy);
  return [
    encrypt,
    approved?.step ?? pendingStep('card.approved', deps.copy),
    consult,
    declined?.step ?? pendingStep('card.declined', deps.copy),
    cancel,
  ];
}
