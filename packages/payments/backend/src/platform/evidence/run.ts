import { createHash } from 'node:crypto';

import type { OAuthConnectService } from '../../config/oauth';
import type { PaymentsGateway } from '../../core/gateway';
import type { StoredCharge } from '../../core/ports';
import type { CustomerInfo, MerchantRef, PaymentEnvironment } from '../../core/types';
import { pagbankApiBase } from '../../providers/pagbank-api-base';
import { fetchPagbankCardPublicKey } from '../../providers/pagbank-public-key';
import { recordTraffic, type RecordedOutcome } from './record';
import { errorDetail, isSuccess, lastStatus, pendingStep, stepOf, withStep } from './steps';
import type {
  BrowserCardResult,
  EvidenceOutcomeCopy,
  EvidenceRecord,
  EvidenceStep,
  HomologacaoEvidenceStore,
} from './types';

/**
 * The PAYMENT half of the evidence (FUT-3696): Pix and card orders raised for
 * the sandbox test seller through the host's REAL gateway, recorded as they
 * go over the wire.
 *
 * Through the gateway, not around it, because the scenario is "the flow
 * the host actually uses": the same payload builders, the same idempotency
 * keys, the same `capture: true`, the same charge rows the webhooks later
 * move. The seller's own OAuth token authenticates every order — the
 * platform's token is read only to PROVE it was not used (`connect.usage`).
 *
 * Two calls, because the card has to be encrypted in the browser between
 * them: {@link prepareEvidenceRun} consults the application, renews the
 * seller's token and mints the seller's public key; the browser encrypts the
 * official test cards with it; {@link completeEvidenceRun} raises the orders.
 *
 * Sandbox only: both calls refuse unless the seller's stored connection is a
 * SANDBOX one, and refusing is recorded as such rather than skipped silently.
 */

const PROVIDER = 'pagbank';

/** ≤ R$ 100,00: the sandbox simulator pays a Pix order seconds after creation. */
const PIX_CENTS = 1000;
const CARD_CENTS = 1500;
const PIX_POLLS = 8;
const PIX_POLL_MS = 3000;

export interface EvidenceRunDeps {
  /** The test seller — the merchant the Connect half authorized. */
  merchant: MerchantRef;
  store: HomologacaoEvidenceStore;
  copy: EvidenceOutcomeCopy;
  newId: () => string;
  gateway: Pick<PaymentsGateway, 'charge' | 'refreshCharge' | 'refund'>;
  oauth: Pick<OAuthConnectService, 'refresh'>;
  /** The seller's stored connection, or null when it never connected. */
  seller: () => Promise<{ environment: PaymentEnvironment; token: string | null } | null>;
  /** The platform's own account token — read ONLY to show it was not used. */
  platformToken: () => Promise<string | null>;
  /** The sandbox application consult (`GET /oauth2/application/{client_id}`). */
  consultApplication: () => Promise<unknown>;
  /** The buyer on the test orders — official sandbox test data only. */
  customer: CustomerInfo;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  /** Overrides for tests. */
  pixPolls?: number;
  pixPollMs?: number;
}

/** A short public fingerprint, so two tokens can be told apart without showing either. */
function fingerprint(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 12);
}

const clockOf = (deps: EvidenceRunDeps): (() => Date) => deps.now ?? (() => new Date());

/** The seller's connection, provided it is a sandbox one. */
async function sandboxSeller(deps: EvidenceRunDeps): Promise<{ token: string } | 'NOT_CONNECTED' | 'NOT_SANDBOX'> {
  const seller = await deps.seller();
  if (!seller?.token) return 'NOT_CONNECTED';
  if (seller.environment !== 'SANDBOX') return 'NOT_SANDBOX';
  return { token: seller.token };
}

async function applicationStep(deps: EvidenceRunDeps): Promise<EvidenceStep> {
  const consulted = await recordTraffic(() => deps.consultApplication());
  const ok = consulted.ok && isSuccess(lastStatus(consulted.calls));
  return stepOf('connect.application', ok ? 'EXECUTED' : 'FAILED', clockOf(deps)(), {
    calls: consulted.calls,
    observed: ok ? deps.copy.applicationConsulted : failureOf(deps.copy, consulted),
  });
}

async function refreshStep(deps: EvidenceRunDeps): Promise<EvidenceStep> {
  const refreshed = await recordTraffic(() => deps.oauth.refresh(deps.merchant, PROVIDER));
  const ok = refreshed.ok && refreshed.value.status === 'VERIFIED' && isSuccess(lastStatus(refreshed.calls));
  return stepOf('connect.refresh', ok ? 'EXECUTED' : 'FAILED', clockOf(deps)(), {
    calls: refreshed.calls,
    observed: ok ? deps.copy.refreshed : refreshed.ok ? deps.copy.refreshRejected : failureOf(deps.copy, refreshed),
  });
}

async function usageStep(deps: EvidenceRunDeps, sellerToken: string): Promise<EvidenceStep> {
  const platform = await deps.platformToken();
  const same = platform !== null && platform === sellerToken;
  return stepOf('connect.usage', same ? 'FAILED' : 'EXECUTED', clockOf(deps)(), {
    observed: same
      ? deps.copy.usageSameAsPlatform
      : deps.copy.usageSellerToken(fingerprint(sellerToken), platform ? fingerprint(platform) : null),
  });
}

function failureOf(copy: EvidenceOutcomeCopy, outcome: RecordedOutcome<unknown>): string {
  if (!outcome.ok) return copy.callError(errorDetail(outcome.error));
  const status = lastStatus(outcome.calls);
  return status === undefined ? copy.notAsExpected : copy.httpAnswered(status);
}

/**
 * Phase 1. Returns the seller's public key for the browser to encrypt with —
 * null when it could not be minted, in which case the card steps will record
 * why instead of running.
 */
export async function prepareEvidenceRun(
  deps: EvidenceRunDeps,
): Promise<{ runId: string; publicKey: string | null }> {
  const now = clockOf(deps)();
  const record: EvidenceRecord = {
    id: deps.newId(),
    provider: PROVIDER,
    kind: 'RUN',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    steps: [],
  };
  const seller = await sandboxSeller(deps);
  if (seller === 'NOT_CONNECTED' || seller === 'NOT_SANDBOX') {
    const why = seller === 'NOT_SANDBOX' ? deps.copy.notSandbox : deps.copy.usageNotConnected;
    record.steps = [stepOf('connect.usage', seller === 'NOT_SANDBOX' ? 'FAILED' : 'PENDING', now, { observed: why })];
    await deps.store.save(record);
    return { runId: record.id, publicKey: null };
  }

  record.steps.push(await applicationStep(deps));
  record.steps.push(await refreshStep(deps));
  // The token AFTER the renewal: a rotation replaced the one read above.
  const renewed = await sandboxSeller(deps);
  const token = typeof renewed === 'object' ? renewed.token : seller.token;
  record.steps.push(await usageStep(deps, token));

  const minted = await recordTraffic(() =>
    fetchPagbankCardPublicKey({ apiBase: pagbankApiBase('SANDBOX'), token }),
  );
  const publicKey = minted.ok ? minted.value : null;
  record.steps.push(
    stepOf('card.publicKey', publicKey ? 'EXECUTED' : 'FAILED', clockOf(deps)(), {
      calls: minted.calls,
      observed: publicKey ? deps.copy.publicKeyMinted : deps.copy.publicKeyMissing,
    }),
  );
  record.updatedAt = clockOf(deps)().toISOString();
  await deps.store.save(record);
  return { runId: record.id, publicKey };
}

/** The ids a stored charge gives the reader: the order and, once it exists, the charge. */
function idsOf(charge: StoredCharge | { providerChargeId: string }, reference?: string): Record<string, string> {
  const id = charge.providerChargeId;
  return {
    ...(id.startsWith('ORDE_') ? { order_id: id } : { charge_id: id }),
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
  const qr = Boolean(created.value.snapshot.pix?.qrText);
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

async function pixSteps(deps: EvidenceRunDeps, runId: string): Promise<EvidenceStep[]> {
  const clock = clockOf(deps);
  const created = await createPix(deps, runId);
  const orderId = created.orderId;
  if (!orderId) return [created.step, pendingStep('pix.consult', deps.copy), pendingStep('pix.paid', deps.copy)];

  const polled = await pollPix(deps, orderId);
  const ids = { order_id: orderId, ...(polled.chargeId !== orderId ? { charge_id: polled.chargeId } : {}) };
  const consult = stepOf('pix.consult', polled.status !== null ? 'EXECUTED' : 'FAILED', clock(), {
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
): Promise<{ step: EvidenceStep; charge: StoredCharge | null }> {
  const key = card.scenario === 'approved' ? 'card.approved' : 'card.declined';
  const expected = card.scenario === 'approved' ? 'PAID' : 'DECLINED';
  const reference = `homolog-${runId.slice(0, 8)}-card-${card.scenario}`;
  const notes = [`${card.brand} ${card.masked}`];
  if (!card.encrypted) {
    return { step: { ...pendingStep(key, deps.copy, deps.copy.encryptFailed(card.failure ? deps.copy.browserFailures[card.failure] : '')), notes }, charge: null };
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
  const status = raised.ok ? raised.value.snapshot.status : null;
  return {
    step: stepOf(key, status === expected ? 'EXECUTED' : 'FAILED', clockOf(deps)(), {
      calls: raised.calls,
      notes,
      ids: raised.ok ? idsOf(raised.value, reference) : { reference_id: reference },
      observed: status ? deps.copy.chargeStatus(status) : failureOf(deps.copy, raised),
    }),
    charge: raised.ok ? raised.value : null,
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

async function consultApproved(deps: EvidenceRunDeps, chargeId: string): Promise<EvidenceStep> {
  const consulted = await recordTraffic(() => deps.gateway.refreshCharge(deps.merchant, PROVIDER, chargeId));
  const paid = consulted.ok && consulted.value.status === 'PAID';
  return stepOf('card.approvedConsult', paid ? 'EXECUTED' : 'FAILED', clockOf(deps)(), {
    calls: consulted.calls,
    ids: { charge_id: chargeId },
    observed: consulted.ok ? deps.copy.chargeStatus(consulted.value.status) : failureOf(deps.copy, consulted),
  });
}

async function cancelApproved(deps: EvidenceRunDeps, chargeId: string): Promise<EvidenceStep> {
  const canceled = await recordTraffic(() => deps.gateway.refund(deps.merchant, PROVIDER, { providerChargeId: chargeId }));
  const done = canceled.ok && canceled.value.status === 'REFUNDED';
  return stepOf('card.cancel', done ? 'EXECUTED' : 'FAILED', clockOf(deps)(), {
    calls: canceled.calls,
    ids: { charge_id: chargeId },
    observed: canceled.ok ? deps.copy.canceled(canceled.value.status) : failureOf(deps.copy, canceled),
  });
}

async function cardSteps(deps: EvidenceRunDeps, runId: string, cards: readonly BrowserCardResult[]): Promise<EvidenceStep[]> {
  const scenario = async (which: BrowserCardResult['scenario']) => {
    const card = cards.find((candidate) => candidate.scenario === which);
    return card ? cardCharge(deps, runId, card) : null;
  };
  const approved = await scenario('approved');
  const approvedId = approved?.charge?.snapshot.status === 'PAID' ? approved.charge.providerChargeId : null;
  const consult = approvedId ? await consultApproved(deps, approvedId) : pendingStep('card.approvedConsult', deps.copy);
  const declined = await scenario('declined');
  const cancel = approvedId ? await cancelApproved(deps, approvedId) : pendingStep('card.cancel', deps.copy);
  return [
    encryptStep(deps, cards),
    approved?.step ?? pendingStep('card.approved', deps.copy),
    consult,
    declined?.step ?? pendingStep('card.declined', deps.copy),
    cancel,
  ];
}

/** Thrown when phase 2 names a run that is not the latest prepared one. */
export class EvidenceRunNotFoundError extends Error {
  constructor(runId: string) {
    super(`No open homologação evidence run ${runId}`);
    this.name = 'EvidenceRunNotFoundError';
  }
}

/** Phase 2: raise the Pix and card orders and record them into the run. */
export async function completeEvidenceRun(
  deps: EvidenceRunDeps,
  runId: string,
  cards: readonly BrowserCardResult[],
): Promise<EvidenceRecord> {
  const record = await deps.store.latest(PROVIDER, 'RUN');
  if (!record || record.id !== runId) throw new EvidenceRunNotFoundError(runId);

  let steps = record.steps;
  const seller = await sandboxSeller(deps);
  if (typeof seller === 'object') {
    for (const step of [...(await pixSteps(deps, runId)), ...(await cardSteps(deps, runId, cards))]) {
      steps = withStep(steps, step);
    }
  }
  return deps.store.save({ ...record, steps, updatedAt: clockOf(deps)().toISOString() });
}
