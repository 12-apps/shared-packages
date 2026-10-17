import { createHash } from 'node:crypto';

import type { OAuthConnectService } from '../../config/oauth';
import type { ProviderConfigStore } from '../../config/types';
import type { MerchantRef } from '../../core/types';
import { redactUrl } from '../../core/traffic-recorder';
import { recordTraffic } from './record';
import { errorDetail, pendingStep, stepOf, withStep } from './steps';
import type { EvidenceOutcomeCopy, EvidenceRecord, EvidenceStep, HomologacaoEvidenceStore } from './types';

/**
 * The CONNECT half of the evidence (FUT-3696): a sandbox TEST SELLER
 * authorizing the application, recorded as it happens.
 *
 * It is the real flow, not a re-enactment: `begin` builds the authorize URL
 * with the same `OAuthConnectService` every store uses, a person logs in as
 * the seller and approves the consent on PagBank's own screen, and `complete`
 * runs the same code exchange — inside a recording, so the request and the
 * answer are kept with every token, code and secret removed as they are
 * written down.
 *
 * Sandbox only by construction: both calls pin `environment: 'SANDBOX'`, so
 * this flow cannot produce a production grant whatever the host passes.
 */

const PROVIDER = 'pagbank';

export interface SellerConnectDeps {
  oauth: Pick<OAuthConnectService, 'begin' | 'complete'>;
  /** The seller's connection row — see {@link enableSeller}. */
  config: Pick<ProviderConfigStore, 'save'>;
  /**
   * Where PagBank must deliver the seller's webhooks, stamped on its row: a
   * PLATFORM merchant has no store slug for the host's resolver to address.
   */
  webhookUrl?: string;
  /** The test seller — a merchant no real store can write to. */
  merchant: MerchantRef;
  store: HomologacaoEvidenceStore;
  copy: EvidenceOutcomeCopy;
  newId: () => string;
  now?: () => Date;
}

/**
 * The CONNECT record a flow writes to, named by a one-way digest of its state:
 * two operators (or two tabs) connecting at once each complete their OWN
 * record, never whichever happens to be the latest.
 */
function recordIdOf(state: string): string {
  return `connect-${createHash('sha256').update(state).digest('hex').slice(0, 32)}`;
}

/** Step 1: the authorize URL to send the operator to, and an open record. */
export async function beginSellerConnect(
  deps: SellerConnectDeps,
  ctx: { state: string; redirectUri: string },
): Promise<{ url: string }> {
  const now = (deps.now ?? (() => new Date()))();
  const { url } = await deps.oauth.begin(deps.merchant, PROVIDER, {
    state: ctx.state,
    redirectUri: ctx.redirectUri,
    environment: 'SANDBOX',
  });
  const record: EvidenceRecord = {
    id: recordIdOf(ctx.state),
    provider: PROVIDER,
    kind: 'CONNECT',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    steps: [
      {
        ...pendingStep('connect.authorize', deps.copy, deps.copy.awaitingConsent(redactUrl(url))),
        notes: [`GET ${redactUrl(url)}`],
      },
    ],
  };
  await deps.store.save(record);
  return { url };
}

/**
 * Put the seller's fresh connection in rotation, so the evidence run's orders
 * can be raised through the gateway at all.
 *
 * A real store's row is never enabled this way — only a proven activation
 * charge may do that (FUT-463), because a buyer would otherwise be routed to
 * a provider nobody has seen charge. Neither reason applies here: the seller
 * is a PLATFORM merchant no storefront resolves to, so no buyer can reach it,
 * and its connection is a sandbox one by construction. Its charges ARE the
 * proof the activation gate exists to demand.
 */
async function enableSeller(
  deps: SellerConnectDeps,
  connection: Awaited<ReturnType<OAuthConnectService['complete']>>,
): Promise<void> {
  const environments = deps.webhookUrl
    ? {
        ...connection.environments,
        SANDBOX: { ...connection.environments.SANDBOX, notificationUrl: deps.webhookUrl },
      }
    : connection.environments;
  await deps.config.save(deps.merchant, { ...connection, environments, enabled: true, priority: 0 });
}

/** What the provider's redirect carried, as the host's callback read it. */
export interface SellerCallback {
  /** The full callback URL as received — redacted before it is kept. */
  callbackUrl: string;
  code: string | null;
  error: string | null;
  /** Whether the echoed `state` matched the one this flow minted. */
  stateMatched: boolean;
  /** The echoed state — it names the record its `begin` opened. */
  state: string | null;
  redirectUri: string;
}

function authorizeStep(copy: EvidenceOutcomeCopy, callback: SellerCallback, now: Date, notes: string[]): EvidenceStep {
  const refused = callback.error !== null;
  const observed = refused
    ? copy.consentRefused(callback.error ?? '')
    : callback.code
      ? copy.consentGiven
      : copy.callError('code');
  return stepOf('connect.authorize', !refused && callback.code ? 'EXECUTED' : 'FAILED', now, { notes, observed });
}

function callbackStep(copy: EvidenceOutcomeCopy, callback: SellerCallback, now: Date): EvidenceStep {
  return stepOf('connect.callback', callback.code && callback.stateMatched ? 'EXECUTED' : 'FAILED', now, {
    notes: [`GET ${redactUrl(callback.callbackUrl)}`],
    observed: callback.stateMatched ? copy.callbackReceived(true) : copy.callbackStateMismatch,
  });
}

/** The code exchange, recorded — PENDING when the callback did not earn one. */
async function exchangeStep(
  deps: SellerConnectDeps,
  callback: SellerCallback,
  clock: () => Date,
): Promise<{ step: EvidenceStep; ok: boolean }> {
  const code = callback.code;
  if (!code || !callback.stateMatched) return { step: pendingStep('connect.exchange', deps.copy), ok: false };
  const exchanged = await recordTraffic(() =>
    deps.oauth.complete(deps.merchant, PROVIDER, { code, redirectUri: callback.redirectUri, environment: 'SANDBOX' }),
  );
  if (!exchanged.ok) {
    return {
      ok: false,
      step: stepOf('connect.exchange', 'FAILED', clock(), {
        calls: exchanged.calls,
        observed: deps.copy.callError(errorDetail(exchanged.error)),
      }),
    };
  }
  // The exchange happened at PagBank whatever happens next, so it is recorded
  // as executed; a row that could not be enabled is the note beside it, and
  // the seller is not usable until it reconnects.
  const enabled = await enableSeller(deps, exchanged.value).then(
    () => null,
    (error: unknown) => deps.copy.enableFailed(errorDetail(error)),
  );
  const accountId = exchanged.value.environments.SANDBOX?.accountId ?? null;
  return {
    ok: enabled === null,
    step: stepOf('connect.exchange', 'EXECUTED', clock(), {
      calls: exchanged.calls,
      notes: enabled ? [enabled] : [],
      ids: accountId ? { account_id: accountId } : {},
      observed: deps.copy.exchangeStored(accountId),
    }),
  };
}

/**
 * Step 2: record the callback and run the code exchange. `ok` is whether the
 * seller is now connected; every outcome — refusal, mismatch, a failed
 * exchange — is written down as what it was.
 */
export async function completeSellerConnect(
  deps: SellerConnectDeps,
  callback: SellerCallback,
): Promise<{ ok: boolean; record: EvidenceRecord }> {
  const clock = deps.now ?? (() => new Date());
  const now = clock();
  const id = callback.state ? recordIdOf(callback.state) : deps.newId();
  const latest = await deps.store.latest(PROVIDER, 'CONNECT');
  const record: EvidenceRecord = (latest?.id === id ? latest : null) ?? {
    id,
    provider: PROVIDER,
    kind: 'CONNECT',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    steps: [],
  };
  const begun = record.steps.find((step) => step.key === 'connect.authorize');
  const exchange = await exchangeStep(deps, callback, clock);
  let steps = withStep(record.steps, authorizeStep(deps.copy, callback, now, begun?.notes ?? []));
  steps = withStep(steps, callbackStep(deps.copy, callback, now));
  steps = withStep(steps, exchange.step);
  const saved = await deps.store.save({ ...record, steps, updatedAt: clock().toISOString() });
  return { ok: exchange.ok, record: saved };
}
