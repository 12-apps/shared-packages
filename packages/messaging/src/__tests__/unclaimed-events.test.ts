import { describe, expect, it } from "vitest";

import type { MessagingHooks } from "../core/ports";
import type { NormalizedEvent } from "../core/types";
import { CONTACT, NOW, OTHER_PHONE_NUMBER_ID, PHONE_NUMBER_ID, statusUpdate, textMessage } from "./fixtures";
import { TENANT, createHarness } from "./harness";

/**
 * FUT-285 contract — `hooks.onUnclaimedEvents(channel, events)`.
 *
 * The host's PLATFORM notification number lives on the same Meta app as the
 * numbers its tenants connect (owner, 2026-11-16), so its replies (SIM, SAIR)
 * and its delivery receipts already arrive on the one shared callback — and
 * on `main` they are thrown away: an account nobody connected resolves to
 * nobody and the event is dropped (`core/inbound.ts:31-32`, the loop at
 * `core/inbox.ts:76`).
 *
 * The contract: the events whose account NOBODY connected are handed to the
 * host, once per processed delivery, already signature-checked, persisted and
 * parsed. Never an event of a connected (or revoked) tenant number — a tenant's
 * traffic must not reach the host's platform path. A throwing hook settles the
 * delivery FAILED so the reconciliation sweep runs it again (the host's handler
 * is idempotent on the provider's message id); without the hook nothing changes.
 */

type UnclaimedHook = (channel: string, events: NormalizedEvent[]) => Promise<void> | void;

function recordingHook(fail: () => boolean = () => false): { hooks: MessagingHooks; calls: { channel: string; events: NormalizedEvent[] }[] } {
  const calls: { channel: string; events: NormalizedEvent[] }[] = [];
  const onUnclaimedEvents: UnclaimedHook = (channel, events) => {
    calls.push({ channel, events });
    if (fail()) throw new Error("platform inbound queue down");
  };
  return { calls, hooks: { onUnclaimedEvents } as MessagingHooks };
}

describe("onUnclaimedEvents", () => {
  it("hands a reply to a number nobody connected to the host, and still stores nothing", async () => {
    const { hooks, calls } = recordingHook();
    const h = createHarness({ hooks });
    await h.connect(); // a tenant on PHONE_NUMBER_ID; the platform number is OTHER_PHONE_NUMBER_ID

    const { outcomes } = await h.deliver(textMessage("SIM", { phoneNumberId: OTHER_PHONE_NUMBER_ID, id: "wamid.SIM" }));

    expect(outcomes[0]).toEqual({ kind: "processed", events: [{ kind: "dropped", reason: "unknown-account" }] });
    expect(calls).toEqual([
      {
        channel: "whatsapp",
        events: [
          expect.objectContaining({
            type: "message",
            accountId: OTHER_PHONE_NUMBER_ID,
            contactId: CONTACT,
            externalId: "wamid.SIM",
            content: { kind: "TEXT", text: "SIM" },
          }),
        ],
      },
    ]);
    expect(h.dump().conversations).toHaveLength(0);
    expect(h.dump().messages).toHaveLength(0);
    expect(h.dump().deliveries[0]).toMatchObject({ state: "PROCESSED" });
  });

  it("hands over delivery receipts of the unclaimed number", async () => {
    const { hooks, calls } = recordingHook();
    const h = createHarness({ hooks });
    await h.deliver(statusUpdate("wamid.PLATFORM-OUT", "delivered", NOW, OTHER_PHONE_NUMBER_ID));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.events).toEqual([
      expect.objectContaining({ type: "status", accountId: OTHER_PHONE_NUMBER_ID, externalId: "wamid.PLATFORM-OUT", status: "DELIVERED" }),
    ]);
  });

  it("never hands over an event of a connected tenant number", async () => {
    const { hooks, calls } = recordingHook();
    const h = createHarness({ hooks });
    await h.connect();
    await h.deliver(textMessage("SIM", { phoneNumberId: PHONE_NUMBER_ID }));
    expect(calls).toEqual([]);
    expect(h.dump().messages).toHaveLength(1);
  });

  it("never hands over an event of a REVOKED tenant number (it is a tenant's, not unclaimed)", async () => {
    const { hooks, calls } = recordingHook();
    const h = createHarness({ hooks });
    const connection = await h.connect();
    await h.engine.revoke(TENANT, connection.id, "disconnected by the tenant");
    await h.deliver(textMessage("SAIR", { phoneNumberId: PHONE_NUMBER_ID }));
    expect(calls).toEqual([]);
  });

  it("a redelivered body is processed once, so the host is told once", async () => {
    const { hooks, calls } = recordingHook();
    const h = createHarness({ hooks });
    const body = textMessage("SIM", { phoneNumberId: OTHER_PHONE_NUMBER_ID });
    await h.deliver(body);
    await h.deliver(body);
    expect(calls).toHaveLength(1);
  });

  it("a throwing hook settles the delivery FAILED, and the reconciliation sweep runs it again", async () => {
    let down = true;
    const { hooks, calls } = recordingHook(() => down);
    const h = createHarness({ hooks });
    await h.post(textMessage("SIM", { phoneNumberId: OTHER_PHONE_NUMBER_ID }));
    const [deliveryId] = h.queuedIds();
    h.queued.splice(0);
    if (!deliveryId) throw new Error("nothing queued");

    await expect(h.engine.processDelivery(deliveryId)).rejects.toThrow(/platform inbound queue down/);
    expect(h.dump().deliveries[0]).toMatchObject({ state: "FAILED" });

    down = false;
    h.clock.current = new Date(NOW.getTime() + 10 * 60 * 1000);
    await h.engine.reconcile();
    expect(calls).toHaveLength(2);
    expect(h.dump().deliveries[0]).toMatchObject({ state: "PROCESSED" });
  });

  it("without the hook, an unclaimed event is dropped exactly as before", async () => {
    const h = createHarness();
    const { outcomes } = await h.deliver(textMessage("SIM", { phoneNumberId: OTHER_PHONE_NUMBER_ID }));
    expect(outcomes[0]).toEqual({ kind: "processed", events: [{ kind: "dropped", reason: "unknown-account" }] });
    expect(h.dump().deliveries[0]).toMatchObject({ state: "PROCESSED" });
  });
});
