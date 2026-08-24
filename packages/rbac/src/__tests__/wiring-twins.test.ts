/**
 * The assignability proof for the twins this package declares locally.
 *
 * `./server/notifications` restates `@12-apps/wiring`'s `NotifyPort` and
 * `WireNotificationBlueprint` by hand rather than importing them, because
 * `@12-apps/wiring` is an OPTIONAL peer: a host installing rbac without
 * adopting the contract must still be able to typecheck `./server`, and a
 * shipped `.d.ts` referencing an uninstalled package breaks exactly that.
 *
 * The RFC's own name for the cost of that choice is "twin shapes are
 * unverified" — a restatement nothing compiles against the original, pinned by
 * a comment. This file is the other half of the trade: the contract is a
 * devDependency HERE, so if either shape moves, this stops compiling in this
 * repo instead of failing in a host's incident channel.
 */

import { describe, expect, it } from 'vitest';
import type {
  NotifyEvent,
  NotifyOutcome,
  NotifyPort,
  NotifyRecipient,
} from '@12-apps/wiring/ports';
import type {
  WireNotificationBlueprint,
  WireNotificationContent,
} from '@12-apps/wiring';

import {
  createTeamInvitedBlueprint,
  type RbacNotificationBlueprint,
  type RbacNotificationContent,
  type RbacNotifyEvent,
  type RbacNotifyOutcome,
  type RbacNotifyPort,
  type RbacNotifyRecipient,
  type TeamInvitedPayload,
} from '../server/notifications';
import { PT_BR_TEAM_INVITED_COPY } from '../server/pt-BR';

const blueprint = createTeamInvitedBlueprint(PT_BR_TEAM_INVITED_COPY);

/**
 * The direction that matters at runtime: a host feeds this package's blueprint
 * into its notifications mount beside its own generators. If this assignment
 * ever failed it would fail at every adoption site at once.
 */
const asWireBlueprint: WireNotificationBlueprint<TeamInvitedPayload> = blueprint;
const backToLocal: RbacNotificationBlueprint = asWireBlueprint;

/** The content twins, both ways. */
const content: RbacNotificationContent = blueprint.generate({
  tenantId: 't1',
  email: 'novo@example.com',
  status: 'added',
});
const asWireContent: WireNotificationContent = content;
const backToLocalContent: RbacNotificationContent = asWireContent;

/**
 * The port twins, both ways — this is what a host actually binds.
 *
 * A FUNCTION rather than module-scoped constants: the assignability is proven
 * by the annotations inside it (this file failing to compile IS the failure
 * these cases exist to catch), and the flakiness lane refuses shared mutable
 * state a case then calls into.
 */
function portTwins(): { wire: NotifyPort; local: RbacNotifyPort } {
  const port: RbacNotifyPort = {
    emit: () => Promise.resolve({ accepted: true }),
  };
  const wire: NotifyPort = port;
  const local: RbacNotifyPort = wire;
  return { wire, local };
}

/** And the value types the port carries. */
const recipient: RbacNotifyRecipient = { userId: 'u1' };
const asWireRecipient: NotifyRecipient = recipient;
const event: RbacNotifyEvent = { type: 'rbac.team.invited', recipient, payload: {} };
const asWireEvent: NotifyEvent = event;
const outcome: RbacNotifyOutcome = { accepted: false, reason: 'declined' };
const asWireOutcome: NotifyOutcome = outcome;

describe('the rbac twins against @12-apps/wiring', () => {
  it('keeps the blueprint shapes mutually assignable', () => {
    expect(asWireBlueprint.type).toBe('rbac.team.invited');
    expect(backToLocal.category).toBe('system');
  });

  it('keeps the content shapes mutually assignable', () => {
    expect(asWireContent.title).toBe(content.title);
    expect(backToLocalContent.body).toBe(content.body);
  });

  it('keeps the notify port and its event types mutually assignable', async () => {
    // The proof is that `portTwins()` COMPILES — it assigns a local port to
    // the wire type and back again. These calls only confirm the round-tripped
    // value still behaves like a port; built inline, because the flakiness
    // lane reads a binding a case then calls into as shared state.
    expect(await portTwins().wire.emit(asWireEvent)).toEqual({ accepted: true });
    expect(await portTwins().local.emit(event)).toEqual({ accepted: true });
    expect(asWireRecipient).toEqual({ userId: 'u1' });
    expect(asWireOutcome.reason).toBe('declined');
  });
});
