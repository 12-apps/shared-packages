import type { PaymentEnvironment, ProviderName } from '../core/types';
import type { PaymentsHttpHandlers, PaymentsRequestContext } from './handlers';

/**
 * The CANONICAL LAYOUT of the payments HTTP surface — ADOPTING.md §2 as data
 * (FUT-559). One row per `PaymentsHttpHandlers` handler: the segment pattern
 * that means it, and the exact call its signature wants. `mountPayments`
 * (./router.ts) matches requests against these rows; keeping the table in its
 * own module keeps both files inside the complexity budget and the data
 * separable from the dispatch machinery.
 */

/** The verbs the payments surface answers on. */
export type PaymentsRouteMethod = 'GET' | 'POST' | 'PUT';

/** The built-in intents — one per `PaymentsHttpHandlers` handler. */
export type PaymentsIntentKind =
  | 'getClientConfig'
  | 'createCharge'
  | 'getCharge'
  | 'handleWebhook'
  | 'getSettings'
  | 'setPriorities'
  | 'setFailoverPolicy'
  | 'getSetupGuide'
  | 'saveCredentials'
  | 'setEnabled'
  | 'verify'
  | 'beginOAuth'
  | 'completeOAuth'
  | 'disconnectOAuth'
  | 'beginVault'
  | 'completeVault'
  | 'forgetVault';

/** Host route params, passed through the mount context verbatim. */
export type PaymentsRouteParams = Readonly<
  Record<string, string | readonly string[] | undefined>
>;

/**
 * What a request MEANS, decided before anything runs. `requireAuth` receives
 * exactly this, so a host can gate on the operation (e.g. bill a quota only on
 * `setEnabled`) rather than re-parsing the URL.
 */
export interface PaymentsRouteIntent {
  /** A {@link PaymentsIntentKind}, or an extension's own kind. */
  kind: string;
  method: PaymentsRouteMethod;
  /** The `:provider` capture, when the matched pattern has one. */
  provider?: ProviderName;
  /** The `:chargeId` capture (`getCharge`). */
  providerChargeId?: string;
  /** The full matched segment list, mount prefix included. */
  segments: readonly string[];
  /** The host's route params (tenant slug etc.), exactly as handed in. */
  params: PaymentsRouteParams;
}

/** One row of the canonical table: pattern → the handler call it means. */
export interface BuiltInRoute {
  kind: PaymentsIntentKind;
  method: PaymentsRouteMethod;
  pattern: readonly string[];
  dispatch: (
    http: PaymentsHttpHandlers,
    request: Request,
    ctx: PaymentsRequestContext,
    intent: PaymentsRouteIntent,
  ) => Promise<Response>;
}

/**
 * `?environment=` on `verify`, read leniently: an unrecognised value falls
 * back to the active environment rather than answering 400 — the same answer
 * the surface gave before the parameter existed.
 */
function requestedEnvironment(request: Request): PaymentEnvironment | undefined {
  const value = new URL(request.url).searchParams.get('environment');
  return value === 'SANDBOX' || value === 'PRODUCTION' ? value : undefined;
}

/** Checkout on top, settings below, the credential lifecycle under providers. */
export const LIBRARY_ROUTES: readonly BuiltInRoute[] = [
  {
    kind: 'getClientConfig',
    method: 'GET',
    pattern: ['config'],
    dispatch: (http, _request, ctx) => http.getClientConfig(ctx),
  },
  {
    kind: 'createCharge',
    method: 'POST',
    pattern: ['charges'],
    dispatch: (http, request, ctx) => http.createCharge(request, ctx),
  },
  {
    kind: 'getCharge',
    method: 'GET',
    pattern: ['charges', ':provider', ':chargeId'],
    dispatch: (http, _request, ctx, intent) =>
      http.getCharge(ctx, intent.provider ?? '', intent.providerChargeId ?? ''),
  },
  {
    kind: 'handleWebhook',
    method: 'POST',
    pattern: ['webhooks', ':provider'],
    dispatch: (http, request, ctx, intent) =>
      http.handleWebhook(request, ctx, intent.provider ?? ''),
  },
  {
    // Vault sits with the money surface: it is the merchant's stored
    // instrument, not a credential-settings concern. No DELETE in
    // `PaymentsRouteMethod`, so detaching is an explicit action segment —
    // the same shape as the OAuth `disconnect` route.
    kind: 'beginVault',
    method: 'POST',
    pattern: ['vault', 'begin'],
    dispatch: (http, _request, ctx) => http.beginVault(ctx),
  },
  {
    kind: 'completeVault',
    method: 'POST',
    pattern: ['vault', 'complete'],
    dispatch: (http, request, ctx) => http.completeVault(request, ctx),
  },
  {
    kind: 'forgetVault',
    method: 'POST',
    pattern: ['vault', ':provider', 'forget'],
    dispatch: (http, _request, ctx, intent) => http.forgetVault(ctx, intent.provider ?? ''),
  },
  {
    kind: 'getSettings',
    method: 'GET',
    pattern: ['settings'],
    dispatch: (http, _request, ctx) => http.getSettings(ctx),
  },
  {
    kind: 'setPriorities',
    method: 'PUT',
    pattern: ['settings', 'priorities'],
    dispatch: (http, request, ctx) => http.setPriorities(request, ctx),
  },
  {
    kind: 'setFailoverPolicy',
    method: 'PUT',
    pattern: ['settings', 'failover-policy'],
    dispatch: (http, request, ctx) => http.setFailoverPolicy(request, ctx),
  },
  {
    kind: 'getSetupGuide',
    method: 'GET',
    pattern: ['settings', 'guides', ':provider'],
    dispatch: (http, _request, ctx, intent) =>
      http.getSetupGuide(ctx, intent.provider ?? ''),
  },
  {
    kind: 'saveCredentials',
    method: 'PUT',
    pattern: ['settings', 'providers', ':provider'],
    dispatch: (http, request, ctx, intent) =>
      http.saveCredentials(request, ctx, intent.provider ?? ''),
  },
  {
    kind: 'setEnabled',
    method: 'PUT',
    pattern: ['settings', 'providers', ':provider', 'enabled'],
    dispatch: (http, request, ctx, intent) =>
      http.setEnabled(request, ctx, intent.provider ?? ''),
  },
  {
    kind: 'verify',
    method: 'POST',
    pattern: ['settings', 'providers', ':provider', 'verify'],
    dispatch: (http, request, ctx, intent) =>
      http.verify(ctx, intent.provider ?? '', requestedEnvironment(request)),
  },
  {
    kind: 'beginOAuth',
    method: 'POST',
    pattern: ['settings', 'providers', ':provider', 'oauth', 'begin'],
    dispatch: (http, request, ctx, intent) =>
      http.beginOAuth(request, ctx, intent.provider ?? ''),
  },
  {
    kind: 'completeOAuth',
    method: 'POST',
    pattern: ['settings', 'providers', ':provider', 'oauth', 'complete'],
    dispatch: (http, request, ctx, intent) =>
      http.completeOAuth(request, ctx, intent.provider ?? ''),
  },
  {
    kind: 'disconnectOAuth',
    method: 'POST',
    pattern: ['settings', 'providers', ':provider', 'oauth', 'disconnect'],
    dispatch: (http, _request, ctx, intent) =>
      http.disconnectOAuth(ctx, intent.provider ?? ''),
  },
];

/**
 * Match one pattern against the segments. `:name` captures any single
 * NON-EMPTY segment (an empty segment — `//` in the path — never matched the
 * per-file routes either); a literal must match exactly.
 */
export function matchPattern(
  pattern: readonly string[],
  segments: readonly string[],
): Readonly<Record<string, string>> | null {
  if (pattern.length !== segments.length) return null;
  const captures: Record<string, string> = {};
  for (let index = 0; index < pattern.length; index += 1) {
    const part = pattern[index] ?? '';
    const segment = segments[index] ?? '';
    if (part.startsWith(':')) {
      if (segment === '') return null;
      captures[part.slice(1)] = segment;
      continue;
    }
    if (part !== segment) return null;
  }
  return captures;
}
