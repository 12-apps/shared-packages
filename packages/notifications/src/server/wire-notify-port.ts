/**
 * `wireNotifyPort(api)` — the adapter that makes this package a host's
 * `NotifyPort`.
 *
 * The RFC's founding incident is a package with something to say and no way to
 * say it: `@12-apps/rbac`'s `invites.invite()` records a `TenantInvite` row,
 * returns `{ status: 'invited' }`, and nobody mails the invitee — not because
 * anyone chose silence, but because no package had any channel to ASK for a
 * notification. Every host that wanted one invented a bespoke callback at the
 * mount (`notifyDispatched: …`), so the seam existed N times and composed zero
 * times.
 *
 * `NotifyPort` is that channel, and this function is its one reference
 * implementation. A host mounts notifications as it always has, wraps the
 * result once, and hands the port to every adopted package through
 * `createWiringHost({ ports })`. A package that raises an event types against
 * `NotifyPort` for the cost of zero dependencies; a host that declines binds
 * nothing and the decline is written in the wiring report instead of being
 * invisible.
 *
 * ## The two recipient shapes are two different calls
 *
 * `NotifyPort` addresses either one user or everyone holding a permission,
 * which is exactly the `notify` / `notifyByPermission` split this package
 * already draws. The port keeps the distinction because collapsing it would
 * lose the property `notifyByPermission` exists for: "tell whoever can act on
 * this" must resolve the audience at emit time, against the host's live
 * authorization engine, not against a list some caller cached.
 *
 * ## Why it swallows every failure
 *
 * `NotifyPort.emit` NEVER throws — the `enqueueJob` doctrine, and the whole
 * reason the port is safe to hand a package that has no idea what a host's
 * notification pipeline is. A deferred side effect must not take down the
 * request that scheduled it: an invite whose mail fails is still an invite,
 * and a checkout whose receipt fails is still a paid order. Failure is an
 * OUTCOME here (`{ accepted: false, reason }`), which is a thing the wiring
 * report and the host's logger can both read, rather than an exception that
 * unwinds a caller who cannot do anything about it.
 *
 * That is also why the reasons are specific. Three failures are ordinary and
 * each means something different to whoever is reading:
 *
 * - **no generator** — the package emitted a type no host generator claims.
 *   That is a WIRING gap (the package declared a blueprint the host never
 *   registered), and it is the single most likely thing to be wrong the first
 *   time a package's event reaches a host.
 * - **unknown recipient** — the user id does not resolve. Ordinary in a
 *   tenant where the addressee was removed between the write and the emit.
 * - **no audience directory** — `notifyByPermission` needs the host's
 *   authorization engine and the host did not pass one. Loud in the reason,
 *   because the alternative is a money alert nobody gets.
 *
 * The call is deliberately made AFTER the caller's transaction commits, and
 * that rule is enforced where the host binds the port rather than here: this
 * function cannot see a transaction it was never given. `router.notify`
 * already announces after its own commit for the same read-your-own-hint
 * reason.
 */

import type { NotifyEvent, NotifyOutcome, NotifyPort } from '@12-apps/wiring/ports';

import { UnknownNotificationRecipientError, UnknownNotificationTypeError } from '../errors';
import type { ApiNotifications } from './create-api-notifications';

/** What this adapter needs of a mount — narrower than the whole api, on purpose. */
export type NotifyPortSource = Pick<ApiNotifications, 'notify' | 'notifyByPermission'>;

/** Every emit failure, rendered as a reason a human can act on. */
function reasonFor(error: unknown): string {
  if (error instanceof UnknownNotificationTypeError) {
    return `no generator is registered for this type — the host never bound the blueprint (${error.message})`;
  }
  if (error instanceof UnknownNotificationRecipientError) {
    return `the recipient does not resolve to a user (${error.message})`;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Adapt a mounted notifications api to the shared `NotifyPort`.
 *
 * ```ts
 * const notifications = createApiNotifications({ … });
 * const host = createWiringHost({
 *   name: 'web',
 *   kind: 'server',
 *   ports: { notify: wireNotifyPort(notifications) },
 * });
 * ```
 */
export function wireNotifyPort(api: NotifyPortSource): NotifyPort {
  return {
    async emit(event: NotifyEvent): Promise<NotifyOutcome> {
      try {
        if ('userId' in event.recipient) {
          await api.notify({
            type: event.type,
            recipient: { userId: event.recipient.userId },
            payload: event.payload,
          });
          return { accepted: true };
        }

        const { tenantId, permission } = event.recipient;
        const result = await api.notifyByPermission(tenantId, [permission], {
          type: event.type,
          payload: event.payload,
        });
        // Nobody holding the permission is not a FAILURE — the fan-out ran and
        // correctly reached zero people. Saying otherwise would have a host
        // treat "this tenant has no manager" as a broken pipeline. The count
        // is in the reason so the distinction survives into the log.
        return result.notified.length > 0
          ? { accepted: true }
          : {
              accepted: false,
              reason: `no user of tenant "${tenantId}" holds "${permission}" (${result.skipped.length} candidates skipped)`,
            };
      } catch (error) {
        return { accepted: false, reason: reasonFor(error) };
      }
    },
  };
}
