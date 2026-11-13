import { describe, expect, it } from "vitest";

import { OUTBOUND_GIVE_UP_MS, OUTBOUND_STALE_MS } from "../core/outbound-sweep";
import { TENANT, createHarness, deliverIfood, ifoodPlaced, scriptedHttp, type Harness } from "./harness";

/**
 * [B1] The outbound sweep: every call a row still owes is re-queued once it is
 * older than the job's own retry span, under a key of its own, and an ancient
 * request is given up as FAILED rather than left PENDING forever.
 */

async function ingest(h: Harness, externalId = "ext-1"): Promise<string> {
  const outcome = await deliverIfood(h, ifoodPlaced(externalId));
  if (outcome.kind !== "ingested") throw new Error(outcome.kind);
  return outcome.orderId;
}

const later = (h: Harness, ms: number) => {
  h.clock.at = new Date(h.clock.at.getTime() + ms);
};

describe("the outbound sweep", () => {
  it("re-queues a refusal whose job the queue refused, under its own dedupe key, once older than the retry span", async () => {
    // A window longer than the retry span, so the re-queue is what this case sees (iFood's own 5 minutes would end it first).
    const h = createHarness({ queueDown: true, cancellationWindowMs: 60 * 60_000 });
    await h.connect();
    const orderId = await ingest(h);
    await h.engine.decide({ clientId: TENANT, orderId, decision: "REJECT", reasonCode: "503" });
    expect(h.logged.some((line) => line.message.includes("outbound sweep will re-queue"))).toBe(true);

    expect(await h.engine.sweepOutbound()).toEqual({ requeued: 0, givenUp: 0, timedOut: 0, catalogueRequeued: 0 });
    expect(h.enqueued).toHaveLength(1);

    later(h, OUTBOUND_STALE_MS + 1);
    await h.engine.sweepOutbound();

    const [original, swept] = h.enqueued;
    expect(swept?.payload).toEqual({ clientId: TENANT, orderId, action: "requestCancellation" });
    expect(swept?.dedupeKey).not.toBe(original?.dedupeKey);
    expect(swept?.dedupeKey).toContain(":sweep:");
  });

  it("re-queues an accept that was never confirmed, and leaves a confirmed one alone", async () => {
    const http = scriptedHttp((request) =>
      request.url.endsWith("/token") ? { status: 200, body: JSON.stringify({ accessToken: "t" }) } : { status: 202, body: "" },
    );
    const h = createHarness({ http });
    await h.connect();
    const unconfirmed = await ingest(h, "ext-1");
    const confirmed = await ingest(h, "ext-2");
    await h.engine.decideMany({
      clientId: TENANT,
      decisions: [
        { orderId: unconfirmed, decision: "ACCEPT" },
        { orderId: confirmed, decision: "ACCEPT" },
      ],
    });
    await h.engine.runOutbound({ clientId: TENANT, orderId: confirmed, action: "confirm" }, { attempt: 1, maxAttempts: 3 });
    later(h, OUTBOUND_STALE_MS + 1);

    const result = await h.engine.sweepOutbound();

    expect(result.requeued).toBe(1);
    expect(h.enqueued.at(-1)?.payload).toEqual({ clientId: TENANT, orderId: unconfirmed, action: "confirm" });
  });

  it("gives an ancient PENDING request up as FAILED, and never confirms an ancient accept", async () => {
    // A window longer than the give-up, so the give-up is what this case sees.
    const h = createHarness({ queueDown: true, cancellationWindowMs: 2 * OUTBOUND_GIVE_UP_MS });
    await h.connect();
    const refused = await ingest(h, "ext-1");
    const accepted = await ingest(h, "ext-2");
    await h.engine.decide({ clientId: TENANT, orderId: refused, decision: "REJECT" });
    await h.engine.decide({ clientId: TENANT, orderId: accepted, decision: "ACCEPT" });
    const queuedBefore = h.enqueued.length;
    later(h, OUTBOUND_GIVE_UP_MS + 1);

    expect(await h.engine.sweepOutbound()).toEqual({ requeued: 0, givenUp: 1, timedOut: 0, catalogueRequeued: 0 });
    expect(h.acceptance(refused)?.cancellationStatus).toBe("FAILED");
    expect(h.acceptance(refused)?.cancellationFailureReason).toBe("TIMEOUT");
    expect(h.enqueued).toHaveLength(queuedBefore);
  });

  it("is bound as the marketplace.outbound-sweep job", async () => {
    const { MARKETPLACE_JOBS } = await import("../server/jobs");
    expect(MARKETPLACE_JOBS.blueprints["outbound-sweep"]).toMatchObject({
      schedule: { pattern: "*/5 * * * *" },
      lease: { ttlMs: 5 * 60_000 },
    });
  });
});
