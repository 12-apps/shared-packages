import type { PathRules } from '../core/paths';
import { READ_METHODS } from '../core/paths';
import { impersonationPermitsWrites } from '../core/write-rules';
import type { ImpersonationState } from '../core/types';

import type {
  ImpersonationMessages,
} from './context';
import type {
  PreviewEntitlementPort,
} from './ports';

/**
 * MUTATION BLOCKING for an impersonated request — the half an RBAC engine
 * deliberately cannot do.
 *
 * Everything up to here answers WHOSE rights a question is decided by. This
 * answers whether the answer may CHANGE anything, and the two are genuinely
 * different axes: an operator resolved as the tenant's owner legitimately HOLDS
 * every permission that owner holds — the reason they must not use them is that
 * the owner never asked them to, not that the grant is missing. No permission
 * set can express "you hold this but may not exercise it right now", so this
 * cannot live in an RBAC engine and must not be modelled as a narrower ceiling;
 * a ceiling that removed a permission would also hide the screen it gates, and
 * seeing the screen is the entire point of impersonating.
 *
 * TWO SURFACES OUTRANK THE PER-KIND RULE, and both are refused for every kind
 * with `allowWrites` included, because neither is a permission question: the
 * money paths (money never moves under an impersonation, and since the verb lies
 * there, not on a GET either) and the account paths (nobody writes to the
 * person's own account, whose artifacts would OUTLIVE the time box).
 *
 * THIS MODULE ALSO CARRIES THE ONE LIVE GATE, which is not a write question and
 * is here anyway. A host calls {@link ImpersonationGuard.assertAllowed} at the
 * top of EVERY request, read or write — that is the only per-request hook a
 * preview passes through, so it is the only place a session whose entitlement
 * has since been revoked can be stopped.
 */

/**
 * Which rule refused the request. Distinct codes, not one, because they mean
 * different things to whoever is looking at the screen: the first is lifted by
 * starting the session with writes enabled, the next two by nothing at all, and
 * the last only by leaving. A client that had to tell "ask for writes next time"
 * apart from "this can never be written here" by matching on prose would get it
 * wrong the first time a sentence was reworded.
 */
export type ImpersonationWriteRefusal =
  | 'IMPERSONATION_READ_ONLY'
  | 'IMPERSONATION_TRANSACTION_BLOCKED'
  | 'IMPERSONATION_ACCOUNT_BLOCKED'
  | 'IMPERSONATION_REVOKED';

/**
 * A request refused because an impersonation is in force.
 *
 * A plain `Error` subclass so a host can map it EXPLICITLY rather than sweeping
 * it into a generic 400. The message is the host's own copy and leaks no id, so
 * a host may forward it verbatim.
 */
export class ImpersonationRefusedError extends Error {
  readonly code: ImpersonationWriteRefusal;
  /** The status a host should answer with. */
  readonly status = 403;

  constructor(code: ImpersonationWriteRefusal, message: string) {
    super(message);
    this.name = 'ImpersonationRefusedError';
    this.code = code;
    Object.setPrototypeOf(this, ImpersonationRefusedError.prototype);
  }
}

/** What {@link ImpersonationGuard.assertAllowed} is told about a request. */
export interface GuardedRequest {
  /** `URL.pathname` — not the full URL, and not a route pattern. */
  pathname: string;
  /** The HTTP verb, upper-cased. */
  method: string;
  /**
   * The impersonation in force, or `null`.
   *
   * The host resolves it — through {@link ImpersonationGuard.readState} plus
   * whatever else its own actor resolution needs — rather than this module
   * decoding the cookie a second time. A second decode is a second
   * implementation of every refusal, and one that could allow a write on a
   * session the host's guards do not honour.
   */
  impersonation: ImpersonationState | null;
}

export interface ImpersonationGuard {
  /**
   * Refuse this request if the impersonation in force does not permit it.
   *
   * Call it at the top of every request, BEFORE schema validation, so a blocked
   * route answers the same 403 whatever the body looks like (an invalid payload
   * must not be distinguishable from a valid one here) and so no handler side
   * effect can precede the check.
   *
   * Throws {@link ImpersonationRefusedError}.
   */
  assertAllowed(request: GuardedRequest): Promise<void>;
  /** The verdict alone, for a host that wants to answer it its own way. */
  refusalFor(request: GuardedRequest): Promise<ImpersonationWriteRefusal | null>;
}

interface GuardParts {
  rules: PathRules;
  messages: ImpersonationMessages;
  previewEntitlement?: PreviewEntitlementPort;
  onError?(message: string, error: unknown): void;
}

const REFUSAL_MESSAGE_KEYS: Record<
  ImpersonationWriteRefusal,
  keyof ImpersonationMessages
> = {
  IMPERSONATION_READ_ONLY: 'readOnly',
  IMPERSONATION_TRANSACTION_BLOCKED: 'transactionBlocked',
  IMPERSONATION_ACCOUNT_BLOCKED: 'accountBlocked',
  IMPERSONATION_REVOKED: 'revoked',
};

/**
 * DOES THIS PREVIEW STILL HAVE PERMISSION TO EXIST — asked on every request, not
 * only at the mint.
 *
 * SCOPE: PREVIEWS ONLY. An operator session is not gated on a tenant's plan or
 * on a tenant's switch — it is platform authority over a tenant that has
 * consented to nothing, and making it depend on the tenant's own settings would
 * let a tenant turn off the support access they may be on the phone asking for.
 * Its live-authority problem is a different one (is the operator still an
 * operator?) and belongs to the host's actor resolution.
 *
 * FAILS OPEN ON AN UNEXPECTED ERROR, deliberately — see
 * {@link PreviewEntitlementPort.isDenial}.
 */
async function previewRevoked(
  parts: GuardParts,
  impersonation: ImpersonationState,
): Promise<boolean> {
  const gate = parts.previewEntitlement;
  if (!gate || impersonation.kind !== 'preview') return false;
  try {
    await gate.require(impersonation.tenantId);
    return false;
  } catch (error) {
    if (gate.isDenial(error)) return true;
    parts.onError?.(
      'could not re-check the preview entitlement; letting the session stand',
      error,
    );
    return false;
  }
}

/**
 * THE ORDER OF THESE BRANCHES IS THE FEATURE.
 *
 * The session routes first, because a session that cannot be stopped is worse
 * than any write it might make (and because the START must reach a handler that
 * can WRITE ITS REFUSAL DOWN). The live gate next, since a revoked preview must
 * not be allowed to read either, and it must be asked AFTER the exit so the way
 * out is never the request that fails. `transacts` third — the only check that
 * reads the method as data rather than trusting it, and the one whose verdict
 * should be reported when a path is somehow both. `mutatesAccount` fourth, ahead
 * of the read shortcut rather than after it, so that rule keeps BOTH halves of
 * itself in one place ("writes refused, reads allowed") instead of depending on
 * a line above it for the half it does not say. The read shortcut fifth, now
 * that we know this path settles nothing on a read. The per-kind rule last —
 * which is exactly what the two surfaces above it outrank, since `allowWrites`
 * must never reach them.
 */
async function verdict(
  parts: GuardParts,
  request: GuardedRequest,
): Promise<ImpersonationWriteRefusal | null> {
  const { impersonation, pathname, method } = request;
  if (!impersonation) return null;
  if (parts.rules.managesSession(pathname, method)) return null;
  if (await previewRevoked(parts, impersonation)) return 'IMPERSONATION_REVOKED';
  if (parts.rules.transacts(pathname, method)) return 'IMPERSONATION_TRANSACTION_BLOCKED';
  if (parts.rules.mutatesAccount(pathname, method)) return 'IMPERSONATION_ACCOUNT_BLOCKED';
  if (READ_METHODS.has(method)) return null;
  if (impersonationPermitsWrites(impersonation)) return null;
  return 'IMPERSONATION_READ_ONLY';
}

export function createImpersonationGuard(parts: GuardParts): ImpersonationGuard {
  const refusalFor = (request: GuardedRequest): Promise<ImpersonationWriteRefusal | null> =>
    verdict(parts, request);

  return {
    refusalFor,
    async assertAllowed(request) {
      const refusal = await refusalFor(request);
      if (!refusal) return;
      throw new ImpersonationRefusedError(
        refusal,
        parts.messages[REFUSAL_MESSAGE_KEYS[refusal]],
      );
    },
  };
}
