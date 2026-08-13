import type { NotificationEvent, NotificationLogger } from '../types';

import type { NotificationRouter } from './router';

/**
 * Permission-addressed notifications: "tell whoever can act on this", resolved
 * against the host's REAL authorization engine.
 *
 * Naming an audience by ROLE reads a coarse mirror column, so a tenant who
 * moved a capability onto a custom role — or granted it additively — gets a
 * notification list that disagrees with what the app actually authorizes. The
 * two answers drift silently, and the direction they drift in is "the person
 * who can fix it never hears about it".
 *
 * So this addresses by CAPABILITY: name the permissions the recipient must
 * hold, and the audience is derived from the same evaluation the guards use.
 *
 * ## What the package owns, and what the host answers
 *
 * The FOLD is the package's: the AND, the deduplication, the refusal of an
 * empty permission list, the per-recipient isolation, and the log line that
 * distinguishes "nobody holds it" from "everybody's dispatch failed". Those are
 * the parts that are the same in every host and that are easy to get subtly
 * wrong.
 *
 * The two QUERIES are the host's, through {@link NotificationAudienceDirectory}
 * — because an authorization engine is host machinery. In future-pay this
 * module could not live in a package at all: it needed `notify()` AND the RBAC
 * engine, and neither package could see the other. Inverting the dependency
 * (the host answers, the package asks) is what makes it portable.
 */

/**
 * The host's authorization engine, as this fan-out needs it.
 *
 * `listCandidates` must be BOUNDED to people who actually hold a role at the
 * tenant. future-pay's implementation requires a role grant, which is what
 * keeps a store's storefront BUYERS — who all carry a default membership — out
 * of a loop that resolves permissions one user at a time.
 *
 * `getPermissions` must be scoped to `tenantId`. Unioning a user's grants
 * across tenants — the obvious way to "simplify" it — notifies someone about a
 * store whose money they have no authority over, and no `where` clause upstream
 * can save it because that user is already a candidate.
 */
export interface NotificationAudienceDirectory {
  listCandidates(tenantId: string): Promise<readonly string[]>;
  getPermissions(
    userId: string,
    tenantId: string,
  ): Promise<ReadonlySet<string> | readonly string[]>;
}

/** One candidate that did not receive it, and why. */
export interface PermissionNotificationSkip {
  userId: string;
  reason: 'missing-permission' | 'dispatch-failed';
}

/**
 * What one fan-out actually did. Returned rather than logged-and-forgotten so a
 * caller (and a test) can assert on the OUTCOME — who was reached and who was
 * not — without reaching into transport mocks to infer it.
 */
export interface PermissionNotificationResult {
  /** User ids whose notification committed, in candidate order. */
  notified: string[];
  /** Candidates that did not receive it, with the reason. */
  skipped: PermissionNotificationSkip[];
}

/** What {@link reportOutcome} needs to describe one fan-out. */
interface OutcomeReport {
  type: string;
  clientId: string;
  permissions: readonly string[];
  candidateCount: number;
  result: PermissionNotificationResult;
}

/**
 * Log what the fan-out amounted to, keyed on WHY nobody was reached rather
 * than on the fact that nobody was.
 *
 * The distinction is the whole point: "this tenant has nobody holding the pair"
 * is a configuration fact and belongs at info, while "three people hold it and
 * every dispatch failed" is an outage in which nobody was told about missing
 * money. Both leave `notified` empty, so keying on that alone would file the
 * second under the first and make a dead transport look like an unconfigured
 * store.
 */
function reportOutcome(logger: NotificationLogger, report: OutcomeReport): void {
  const { type, clientId, permissions, candidateCount, result } = report;
  const failed = result.skipped.filter((skip) => skip.reason === 'dispatch-failed').length;
  if (failed > 0) {
    logger.error(
      `[notifications] ${type}: ${failed} of ${failed + result.notified.length} matching ` +
        `recipient(s) at client ${clientId} could not be reached; ` +
        `${result.notified.length} delivered`,
    );
    return;
  }
  if (result.notified.length > 0) return;
  // Quiet, and deliberately at info: "nobody at this tenant holds
  // `orders:refund` + `reports:financial:read`" is worth being able to look up
  // when someone asks why they heard nothing, but it is not a fault.
  logger.info(
    `[notifications] ${type}: no recipient at client ${clientId} holds ` +
      `[${permissions.join(', ')}] (${candidateCount} candidate(s) evaluated)`,
  );
}

export type NotifyByPermission = <TPayload>(
  clientId: string,
  permissions: readonly string[],
  event: Omit<NotificationEvent<TPayload>, 'recipient'>,
) => Promise<PermissionNotificationResult>;

/**
 * Send one notification to every user of `clientId` holding ALL of
 * `permissions` (AND, not OR).
 *
 * AND is the semantics that makes an addressed notification openable: pair the
 * permission that HANDLES the thing with the permission that gates the SURFACE
 * it links to, and every addressee is, by construction, someone the surface's
 * own guard will serve. OR would happily notify someone into a 403.
 *
 * Contract:
 *   - `permissions` must be non-empty. An empty list is a PROGRAMMING ERROR and
 *     throws: "holds every permission in []" is vacuously true for everyone, so
 *     the quiet reading of an empty list is "fan out to the entire tenant" —
 *     the one outcome a caller can never have meant. It is the only throw here.
 *   - TENANT-SCOPED, unconditionally. Permissions are evaluated at `clientId`
 *     and the inbox row is written with that same tenant.
 *   - Recipients are DEDUPLICATED: candidates are a set, and holding the
 *     permissions through two roles is one notification.
 *   - Zero matching users is a NORMAL outcome — logged, never thrown.
 *   - Recipients are ISOLATED: `notify` throws on an unknown recipient or an
 *     unregistered type, so each dispatch gets its own try/catch and one bad
 *     recipient cannot cost the others their notification.
 *
 * Cost: one `getPermissions` per candidate, run sequentially. That is only
 * affordable because the candidate set is bounded (see the directory docs).
 * Callers run this fire-and-forget, off whatever path produced the event.
 */
export function createNotifyByPermission(deps: {
  router: NotificationRouter;
  directory: NotificationAudienceDirectory;
  logger: NotificationLogger;
}): NotifyByPermission {
  /**
   * One recipient's dispatch, isolated. Resolves `true` when the notification
   * committed and `false` when it did not — the failure is contained here so
   * the loop can carry on, which is the whole point of per-recipient isolation.
   *
   * The log names the USER ID and never an address: an e-mail in a log is PII.
   */
  async function dispatchOne<TPayload>(
    clientId: string,
    userId: string,
    event: Omit<NotificationEvent<TPayload>, 'recipient'>,
  ): Promise<boolean> {
    try {
      await deps.router.notify<TPayload>({ ...event, recipient: { userId, clientId } });
      return true;
    } catch (error) {
      deps.logger.error(
        `[notifications] ${event.type} dispatch failed for user ${userId} at client ${clientId}:`,
        error,
      );
      return false;
    }
  }

  return async function notifyByPermission(clientId, permissions, event) {
    if (permissions.length === 0) {
      throw new Error(
        'notifyByPermission(): `permissions` must be non-empty — ' +
          'an empty list matches every user of the tenant.',
      );
    }
    const candidates = [...new Set(await deps.directory.listCandidates(clientId))];
    const result: PermissionNotificationResult = { notified: [], skipped: [] };

    for (const userId of candidates) {
      const granted = await deps.directory.getPermissions(userId, clientId);
      const held = granted instanceof Set ? granted : new Set(granted);
      // THE AND. `held` folds every role the user has at this tenant, so this
      // one line is the whole authorization question — and a single-element
      // list needs no special case.
      if (!permissions.every((permission) => held.has(permission))) {
        result.skipped.push({ userId, reason: 'missing-permission' });
        continue;
      }
      if (await dispatchOne(clientId, userId, event)) result.notified.push(userId);
      else result.skipped.push({ userId, reason: 'dispatch-failed' });
    }

    reportOutcome(deps.logger, {
      type: event.type,
      clientId,
      permissions,
      candidateCount: candidates.length,
      result,
    });
    return result;
  };
}
