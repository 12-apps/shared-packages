import type { OAuthConnectService } from '../../config/oauth';
import type { PaymentsGateway } from '../../core/gateway';
import type { CustomerInfo, MerchantRef, PaymentEnvironment, ThreeDSecureSession } from '../../core/types';
import { pagbankApiBase } from '../../providers/pagbank-api-base';
import { fetchPagbankCardPublicKey } from '../../providers/pagbank-public-key';
import { pixSteps, cardSteps } from './orders';
import { DEBIT_ORDER_KEYS, debitSteps, threeDSSessionStep } from './orders-debit';
import { WALLET_ORDER_KEYS, walletSectionSteps, walletsConfig } from './orders-wallet';
import { PAGBANK_SANDBOX_DEBIT_TEST, type DebitTestData } from './sandbox-buyer';
import { recordTraffic, tokenFingerprint } from './record';
import { answered, clockOf, failureOf, isSuccess, lastStatus, pendingStep, stepOf, withStep } from './steps';
import type {
  BrowserCardResult,
  BrowserWalletResult,
  EvidenceOutcomeCopy,
  EvidenceRecord,
  EvidenceRunSection,
  EvidenceStep,
  EvidenceStepKey,
  EvidenceWalletsConfig,
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
 * seller's token and mints the seller's public key and the debit card's 3DS
 * session; the browser encrypts the official test cards with the key and
 * authenticates the 3DS test card with the session; {@link completeEvidenceRun}
 * raises the orders.
 *
 * Sandbox only: both calls refuse unless the seller's stored connection is a
 * SANDBOX one, and refusing is recorded as such rather than skipped silently.
 */

const PROVIDER = 'pagbank';


export interface EvidenceRunDeps {
  /** The test seller — the merchant the Connect half authorized. */
  merchant: MerchantRef;
  store: HomologacaoEvidenceStore;
  copy: EvidenceOutcomeCopy;
  newId: () => string;
  gateway: Pick<PaymentsGateway, 'charge' | 'refreshCharge' | 'refund'>;
  oauth: Pick<OAuthConnectService, 'refresh'>;
  /**
   * The seller's stored connection, or null when it never connected. Its
   * PagBank `accountId` is what Google Pay's sheet mints the token against.
   */
  seller: () => Promise<{ environment: PaymentEnvironment; token: string | null; accountId?: string | null } | null>;
  /** The platform's own account token — read ONLY to show it was not used. */
  platformToken: () => Promise<string | null>;
  /** The sandbox application consult (`GET /oauth2/application/{client_id}`). */
  consultApplication: () => Promise<{
    application: unknown;
    error: string | null;
    redirectUriMismatch: boolean | null;
  }>;
  /** The buyer on the test orders — official sandbox test data only. */
  customer: CustomerInfo;
  /**
   * Whether the host has an Apple Pay identity (FUT-3755) — for the platform
   * identity, whether `platformApplePayIdentity(process.env)` is non-null.
   * Absent means not configured: the Apple Pay section then stays PENDING,
   * waiting for the Apple Developer account.
   */
  applePayConfigured?: () => boolean | Promise<boolean>;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  /** Overrides for tests. */
  pixPolls?: number;
  pixPollMs?: number;
}


/** The seller's connection, provided it is a sandbox one. */
async function sandboxSeller(
  deps: EvidenceRunDeps,
): Promise<{ token: string; accountId: string | null } | 'NOT_CONNECTED' | 'NOT_SANDBOX'> {
  const seller = await deps.seller();
  if (!seller?.token) return 'NOT_CONNECTED';
  if (seller.environment !== 'SANDBOX') return 'NOT_SANDBOX';
  return { token: seller.token, accountId: seller.accountId ?? null };
}


type ConsultStatus = Awaited<ReturnType<EvidenceRunDeps['consultApplication']>>;

/** What a consult answer says, in the copy's words — or null when it passes. */
function consultProblem(copy: EvidenceOutcomeCopy, status: ConsultStatus): string | null {
  if (status.error) return copy.callError(status.error);
  if (status.application === null) return copy.notAsExpected;
  return status.redirectUriMismatch === false ? null : copy.applicationRedirectMismatch;
}

/** The consult passes only on an application that is there, parsed, and ours. */
async function applicationStep(deps: EvidenceRunDeps): Promise<EvidenceStep> {
  const consulted = await recordTraffic(() => deps.consultApplication());
  const problem = consulted.ok ? consultProblem(deps.copy, consulted.value) : failureOf(deps.copy, consulted);
  const ok = problem === null && answered(consulted.calls);
  return stepOf('connect.application', ok ? 'EXECUTED' : 'FAILED', clockOf(deps)(), {
    calls: consulted.calls,
    observed: ok ? deps.copy.applicationConsulted : (problem ?? failureOf(deps.copy, consulted)),
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

/** Every step whose calls must have been authenticated by the seller. */
const SELLER_CALL_KEYS: ReadonlySet<EvidenceStepKey> = new Set<EvidenceStepKey>([
  'card.publicKey',
  'debit.session',
  'pix.create',
  'pix.consult',
  'card.approved',
  'card.approvedConsult',
  'card.declined',
  'card.cancel',
  'debit.approved',
  'debit.consult',
  'debit.cancel',
  ...WALLET_ORDER_KEYS.filter((key) => !key.endsWith('.token')),
]);

/** The seller calls phase 1 made — minted before the orders, so not order calls. */
const PREPARE_KEYS: ReadonlySet<EvidenceStepKey> = new Set<EvidenceStepKey>(['card.publicKey', 'debit.session']);

/** The phase-2 scenarios — a run raises them once. */
const ORDER_KEYS: readonly EvidenceStepKey[] = [
  'pix.create',
  'pix.consult',
  'pix.paid',
  'card.encrypt',
  'card.approved',
  'card.approvedConsult',
  'card.declined',
  'card.cancel',
  ...DEBIT_ORDER_KEYS,
  ...WALLET_ORDER_KEYS,
];

/**
 * `connect.usage`, PROVEN from what went over the wire: the fingerprint of the
 * bearer token each order call carried (recorded beside the redaction). The
 * orders must all carry the seller's current token, and nothing may carry the
 * platform's — the claim is about the calls made, not about two stored strings.
 */
async function usageStep(deps: EvidenceRunDeps, steps: readonly EvidenceStep[], sellerToken: string): Promise<EvidenceStep> {
  const calls = steps.filter((step) => SELLER_CALL_KEYS.has(step.key)).flatMap((step) => step.calls);
  const prints = calls.map((call) => call.bearerFingerprint).filter((print): print is string => Boolean(print));
  if (prints.length === 0) return pendingStep('connect.usage', deps.copy);
  const seller = tokenFingerprint(sellerToken);
  const platformToken = await deps.platformToken();
  const platform = platformToken ? tokenFingerprint(platformToken) : null;
  const orderPrints = steps
    .filter((step) => !PREPARE_KEYS.has(step.key) && SELLER_CALL_KEYS.has(step.key))
    .flatMap((step) => step.calls.map((call) => call.bearerFingerprint));
  const proven = seller !== platform && !prints.includes(platform ?? '') && orderPrints.every((print) => print === seller);
  return stepOf('connect.usage', proven ? 'EXECUTED' : 'FAILED', clockOf(deps)(), {
    observed: proven ? deps.copy.usageSellerToken(prints.length, seller, platform) : deps.copy.usageOtherToken,
  });
}


/** What phase 1 hands the browser. */
export interface PreparedEvidenceRun {
  runId: string;
  /** The seller's public key the test cards are encrypted with. */
  publicKey: string | null;
  /** The session PagBank's 3DS SDK is set up with to authenticate the debit card. */
  threeDSSession: ThreeDSecureSession | null;
  /** The buyer, address and amount the debit card is authenticated with. */
  debitTest: DebitTestData;
  /** What each wallet's sheet needs (FUT-3755) — Google Pay null without a sandbox seller account. */
  wallets: EvidenceWalletsConfig;
}

/** A phase 1 that stopped before minting anything for the browser. */
function unminted(record: EvidenceRecord): Omit<PreparedEvidenceRun, 'wallets'> {
  return { runId: record.id, publicKey: null, threeDSSession: null, debitTest: PAGBANK_SANDBOX_DEBIT_TEST };
}

/**
 * Phase 1. Returns the seller's public key for the browser to encrypt with and
 * the 3DS session it authenticates the debit card with — each null when it
 * could not be minted, in which case the card and debit steps will record why
 * instead of running.
 */
export async function prepareEvidenceRun(deps: EvidenceRunDeps): Promise<PreparedEvidenceRun> {
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
    return { ...unminted(record), wallets: await walletsConfig(deps, null) };
  }

  record.steps.push(await applicationStep(deps));
  record.steps.push(await refreshStep(deps));
  // The token AFTER the renewal: a rotation replaced the one read above.
  const renewed = await sandboxSeller(deps);
  const token = typeof renewed === 'object' ? renewed.token : seller.token;
  // A seller "authorized" with the platform's own token proves nothing, and no
  // order may be raised with it: the run stops here, saying so.
  if (token === (await deps.platformToken())) {
    record.steps.push(stepOf('connect.usage', 'FAILED', clockOf(deps)(), { observed: deps.copy.usageSameAsPlatform }));
    await deps.store.save(record);
    return { ...unminted(record), wallets: await walletsConfig(deps, seller.accountId) };
  }

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
  const threeDS = await threeDSSessionStep(deps, token);
  record.steps.push(threeDS.step);
  record.updatedAt = clockOf(deps)().toISOString();
  await deps.store.save(record);
  return {
    runId: record.id,
    publicKey,
    threeDSSession: threeDS.session,
    debitTest: PAGBANK_SANDBOX_DEBIT_TEST,
    wallets: await walletsConfig(deps, seller.accountId),
  };
}

/**
 * Thrown when phase 2 names a run that is not the latest prepared one, or one
 * whose orders were already raised. A second phase 2 on the same run would
 * replay idempotent creates that make no call, and overwrite the recording
 * that did — so a run raises its orders exactly once.
 */
export class EvidenceRunNotFoundError extends Error {
  constructor(runId: string) {
    super(`No open homologation evidence run ${runId}`);
    this.name = 'EvidenceRunNotFoundError';
  }
}

/** The latest run, provided it is this one and its orders were never raised. */
function openRun(record: EvidenceRecord | null, runId: string): EvidenceRecord {
  if (!record || record.id !== runId) throw new EvidenceRunNotFoundError(runId);
  if (record.steps.some((step) => ORDER_KEYS.includes(step.key))) throw new EvidenceRunNotFoundError(runId);
  return record;
}

/** Why phase 2 may not raise orders for this run, or null when it may. */
function blockedBecause(
  deps: EvidenceRunDeps,
  record: EvidenceRecord,
  seller: Awaited<ReturnType<typeof sandboxSeller>>,
): string | null {
  if (seller === 'NOT_SANDBOX') return deps.copy.notSandbox;
  if (seller === 'NOT_CONNECTED') return deps.copy.usageNotConnected;
  return record.steps.find((step) => step.key === 'connect.usage' && step.status === 'FAILED')?.observed ?? null;
}

/**
 * Phase 2: raise the Pix, card, debit and wallet orders once, record them,
 * then prove whose token they used. `wallets` is what each wallet's sheet gave
 * the browser (FUT-3755); absent, both wallet sections stay PENDING.
 * `onSection` is told each part as it starts, so a host can show the
 * operator where a run of several minutes is.
 */
export async function completeEvidenceRun(
  deps: EvidenceRunDeps,
  runId: string,
  cards: readonly BrowserCardResult[],
  wallets: readonly BrowserWalletResult[] = [],
  onSection: (section: EvidenceRunSection) => void = () => undefined,
): Promise<EvidenceRecord> {
  const record = openRun(await deps.store.latest(PROVIDER, 'RUN'), runId);

  let steps = record.steps;
  const seller = await sandboxSeller(deps);
  const blocked = blockedBecause(deps, record, seller);
  if (blocked !== null || typeof seller !== 'object') {
    // Recorded with the reason, so the file says WHY nothing was raised.
    for (const key of ORDER_KEYS) steps = withStep(steps, pendingStep(key, deps.copy, blocked ?? deps.copy.notRun));
  } else {
    onSection('PIX');
    const pix = await pixSteps(deps, runId);
    onSection('CARD');
    const card = await cardSteps(deps, runId, cards);
    onSection('DEBIT');
    const debit = await debitSteps(deps, runId, cards);
    const raised = [...pix, ...card, ...debit, ...(await walletSectionSteps(deps, runId, wallets, onSection))];
    for (const step of raised) {
      steps = withStep(steps, step);
    }
    steps = withStep(steps, await usageStep(deps, steps, seller.token));
  }
  return deps.store.save({ ...record, steps, updatedAt: clockOf(deps)().toISOString() });
}
