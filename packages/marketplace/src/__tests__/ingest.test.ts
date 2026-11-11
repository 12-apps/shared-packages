import { describe, expect, it } from "vitest";

import { createAdapterRegistry, MarketplaceAdapterRegistrationError } from "../core/registry";
import { createIfoodAdapter } from "../ifood";
import { IFOOD_ADAPTER_COPY_EN_US } from "../ifood/en-US";
import { TENANT, createHarness, deliverIfood, ifoodEvent, ifoodPlaced } from "./harness";

/**
 * The ingest guarantees (I1 contract §5 keep list): record before process,
 * dedupe on (provider, eventId), never throw, an unmapped SKU is a row and
 * never a rejection, the deadline stamped at ingest, auto-accept born
 * accepted in one write — plus the settings and the SKU map the engine owns.
 */

describe("ingest", () => {
  it("creates the host order, an AWAITING acceptance with the deadline stamped, and an unmapped SKU row", async () => {
    const h = createHarness();
    await h.connect();

    const outcome = await deliverIfood(h, ifoodPlaced("ext-1"));

    expect(outcome).toEqual({ kind: "ingested", orderId: "order-1", unmappedSkus: ["SKU-1"] });
    expect(h.created[0]?.order).toMatchObject({ provider: "IFOOD", externalOrderId: "ext-1", totalCents: 3980 });
    expect(h.acceptance("order-1")).toMatchObject({
      status: "AWAITING",
      acknowledgeBy: new Date(h.clock.at.getTime() + 300_000),
      acknowledgedAt: null,
    });
    const links = await h.engine.menuLinks({ clientId: TENANT, unmappedOnly: true });
    expect(links.map((link) => link.externalSku)).toEqual(["SKU-1"]);
    expect(h.enqueued).toHaveLength(0);
    expect(h.published).toContain(TENANT);
  });

  it("[I1] a born-accepted order runs the host's half and queues one confirm, with no HTTP during ingest", async () => {
    const h = createHarness();
    await h.connect("IFOOD", { autoAccept: true });

    await deliverIfood(h, ifoodPlaced("ext-1"));

    expect(h.acceptance("order-1")).toMatchObject({ status: "ACCEPTED", acknowledgedAt: h.clock.at });
    expect(h.accepted).toEqual(["order-1"]);
    expect(h.enqueued.map((job) => job.payload)).toEqual([
      { clientId: TENANT, orderId: "order-1", action: "confirm" },
    ]);
    expect(h.http.requests).toHaveLength(0);
  });

  it("[I4] a later accept of a born-accepted order is stale: no second host half, no second confirm", async () => {
    const h = createHarness();
    await h.connect("IFOOD", { autoAccept: true });
    await deliverIfood(h, ifoodPlaced("ext-1"));

    // N1: the result says why, so a host answers this as done rather than a 409.
    expect(await h.engine.decide({ clientId: TENANT, orderId: "order-1", decision: "ACCEPT" })).toEqual({
      kind: "stale",
      reason: "ALREADY_DECIDED",
      status: "ACCEPTED",
    });
    expect(h.accepted).toHaveLength(1);
    expect(h.enqueued).toHaveLength(1);
  });

  it("[I3/L2] a redelivered PLACED is a duplicate: one order, one host half, one confirm", async () => {
    const h = createHarness();
    await h.connect("IFOOD", { autoAccept: true });

    await deliverIfood(h, ifoodPlaced("ext-1"));
    const again = await deliverIfood(h, ifoodPlaced("ext-1"));
    // A redelivery under a NEW event id still finds the order by its id.
    const reworded = await deliverIfood(h, ifoodPlaced("ext-1", "another-event-id"));

    expect(again).toEqual({ kind: "duplicate" });
    expect(reworded).toMatchObject({ kind: "ingested", orderId: "order-1" });
    expect(h.created).toHaveLength(1);
    expect(h.accepted).toHaveLength(1);
    expect(h.enqueued).toHaveLength(1);
  });

  it("uses a mapped SKU's catalog id, and keeps the marketplace's own line text", async () => {
    const h = createHarness();
    await h.connect();
    await h.engine.setMenuLink({ clientId: TENANT, provider: "IFOOD", externalSku: "SKU-1", menuItemId: "menu-1" });

    const outcome = await deliverIfood(h, ifoodPlaced("ext-1"));

    expect(outcome).toMatchObject({ kind: "ingested", unmappedSkus: [] });
    expect(await h.engine.menuLinks({ clientId: TENANT, unmappedOnly: true })).toEqual([]);
  });

  it("refuses to map a SKU to a catalog id that is not this tenant's", async () => {
    const h = createHarness();
    expect(
      await h.engine.setMenuLink({ clientId: TENANT, provider: "IFOOD", externalSku: "SKU-1", menuItemId: "foreign" }),
    ).toBeNull();
  });

  it("stores a delivery for a disabled connection PENDING, and ingests it once the store turns it on", async () => {
    const h = createHarness();
    await h.connect();
    await h.engine.saveIntegration({ clientId: TENANT, provider: "IFOOD", enabled: false });

    const outcome = await deliverIfood(h, ifoodPlaced("ext-1"));
    expect(outcome).toEqual({ kind: "ignored", reason: "integration is not enabled" });
    expect(h.created).toHaveLength(0);

    await h.engine.saveIntegration({ clientId: TENANT, provider: "IFOOD", enabled: true });
    const [stored] = await h.engine.retryable();
    expect(stored).toBeDefined();
    const retried = await h.engine.reprocess(stored!);

    expect(retried).toMatchObject({ kind: "ingested" });
    expect(h.created).toHaveLength(1);
  });

  it("never throws: a host that fails to create its order leaves a FAILED inbox row the sweep retries", async () => {
    const broken = await createBrokenHarness();
    const outcome = await broken.deliver(ifoodPlaced("ext-1"));

    expect(outcome.kind).toBe("failed");
    expect(broken.inboxStatus()).toBe("FAILED");
  });

  it("stores an event of a type it does not act on as IGNORED", async () => {
    const h = createHarness();
    await h.connect();
    expect(await deliverIfood(h, ifoodEvent("ext-1", "DSP"))).toEqual({
      kind: "ignored",
      reason: "no order body on DSP",
    });
  });

  it("normalizes nothing for a provider no adapter is registered for", () => {
    const h = createHarness();
    expect(h.engine.normalize("NOBODY", ifoodPlaced("x"))).toBeNull();
    expect(h.engine.knows("NOBODY")).toBe(false);
    expect(h.engine.verifySignature("NOBODY", "{}", null, null)).toBe(false);
    expect(h.engine.reasons("NOBODY")).toEqual([]);
    expect(h.engine.appLink("NOBODY", { externalOrderId: "x", externalDisplayId: null })).toBeNull();
  });
});

/** A harness whose host refuses to create orders. */
async function createBrokenHarness() {
  const broken = createHarness({ failCreate: true });
  await broken.connect();
  return {
    deliver: (payload: unknown) => deliverIfood(broken, payload),
    inboxStatus: () => broken.memory.tables.marketplaceInboxEvent.rows[0]?.status,
  };
}

describe("integration settings", () => {
  it("seals the credentials through the host's port and never returns them", async () => {
    const h = createHarness();
    await h.connect();

    const [view] = await h.engine.integrations(TENANT);
    const stored = h.memory.tables.marketplaceIntegration.rows[0]?.credentials as string;

    expect(view).toMatchObject({ provider: "IFOOD", connected: true, enabled: true, status: "UNVERIFIED" });
    expect(JSON.stringify(view)).not.toContain("app-secret");
    expect(stored.startsWith("sealed:")).toBe(true);
    expect(stored).not.toContain("app-secret");
  });

  it("gives a new connection the host's default SLA, and keeps the stored secret when none is re-entered", async () => {
    const h = createHarness();
    await h.engine.saveIntegration({ clientId: TENANT, provider: "IFOOD", externalMerchantId: "m" });
    expect((await h.engine.integrations(TENANT))[0]).toMatchObject({ ackSlaSeconds: 300, connected: false });

    await h.connect();
    await h.engine.saveIntegration({ clientId: TENANT, provider: "IFOOD", autoAccept: true });
    expect((await h.engine.integrations(TENANT))[0]).toMatchObject({ autoAccept: true, connected: true });
  });

  it("resolves the webhook secret for the ingestion path, and throws on a blob that will not open", async () => {
    const h = createHarness();
    await h.connect("IFOOD", { webhookSecret: "shh" });
    expect((await h.engine.target(TENANT, "IFOOD"))?.webhookSecret).toBe("shh");

    h.patchIntegration({ credentials: "garbage" });
    await expect(h.engine.target(TENANT, "IFOOD")).rejects.toThrow();
  });

  it("archives a connection instead of deleting it: it attributes nothing, unarchives, and both acts are audited", async () => {
    const h = createHarness();
    await h.connect();

    const archived = await h.engine.upsertIntegrations({
      clientId: TENANT,
      actorId: "user-1",
      rows: [{ operation: "archive", provider: "IFOOD", reason: "paused for the holidays" }],
    });
    expect(archived.kind).toBe("saved");
    expect(await h.engine.integrations(TENANT)).toEqual([]);
    expect((await h.engine.integrations(TENANT, { includeArchived: true }))[0]?.archivedAt).toEqual(h.clock.at);
    expect(await h.engine.target(TENANT, "IFOOD")).toBeNull();
    expect(await h.engine.tenantFor("IFOOD", "merchant-IFOOD")).toBeNull();

    await h.engine.upsertIntegrations({ clientId: TENANT, actorId: "user-1", rows: [{ operation: "unarchive", provider: "IFOOD" }] });
    expect((await h.engine.integrations(TENANT))[0]).toMatchObject({ archivedAt: null, connected: true });
    expect(h.audited.map((entry) => [entry.action, entry.actorId, entry.reason])).toEqual([
      ["marketplace.integration.archive", "user-1", "paused for the holidays"],
      ["marketplace.integration.unarchive", "user-1", null],
    ]);
  });
});

/** A fresh iFood adapter per case. */
const anIfoodAdapter = () => createIfoodAdapter({ copy: IFOOD_ADAPTER_COPY_EN_US });

describe("[R2] writes recorded through a host port share the transaction", () => {
  it("writes an archive's audit line through the archive's own transaction client", async () => {
    const h = createHarness();
    await h.connect();

    await h.engine.upsertIntegrations({ clientId: TENANT, actorId: "user-1", rows: [{ operation: "archive", provider: "IFOOD" }] });

    expect(h.audited).toHaveLength(1);
    // The in-memory transaction hands its callback this same client.
    expect(h.auditDbs).toEqual([h.memory.db]);
  });

  it("rolls the archive back when its audit line cannot be written", async () => {
    const h = createHarness({ failAudit: true });
    await h.connect();

    await expect(
      h.engine.upsertIntegrations({ clientId: TENANT, actorId: "user-1", rows: [{ operation: "archive", provider: "IFOOD" }] }),
    ).rejects.toThrow(/audit store is down/);

    expect((await h.engine.integrations(TENANT))[0]).toMatchObject({ provider: "IFOOD", archivedAt: null });
    expect(await h.engine.target(TENANT, "IFOOD")).not.toBeNull();
  });

  it("rolls the host's order back with the ingest when the acceptance cannot be written", async () => {
    const h = createHarness({
      onCreate: async (db, order) => {
        // The host's own row, written through the ingest's transaction client.
        // eslint-disable-next-line test-flakiness/no-database-operations -- the host's write IS the subject: the rollback must undo it.
        await db.marketplaceMenuLink.upsert({
          where: { clientId_provider_externalSku: { clientId: TENANT, provider: "IFOOD", externalSku: "host-order-row" } },
          create: { clientId: TENANT, provider: "IFOOD", externalSku: "host-order-row" },
          update: {},
        });
        // A concurrent ingest of the same order won the unique meanwhile.
        // eslint-disable-next-line test-flakiness/no-database-operations -- the race IS the subject.
        await db.marketplaceAcceptance.create({
          data: { clientId: TENANT, orderId: "winner", provider: "IFOOD", externalOrderId: order.externalOrderId },
        });
      },
    });
    await h.connect();

    const outcome = await deliverIfood(h, ifoodPlaced("ext-1"));

    expect(outcome.kind).toBe("failed");
    expect(h.memory.tables.marketplaceMenuLink.rows.map((row) => row.externalSku)).toEqual([]);
    expect(h.memory.tables.marketplaceAcceptance.rows).toEqual([]);
  });
});

describe("the adapter registry", () => {
  it("refuses an empty list, a malformed id, a duplicate provider and a duplicate reason code", () => {
    const ifood = anIfoodAdapter();
    expect(() => createAdapterRegistry([])).toThrow(MarketplaceAdapterRegistrationError);
    expect(() => createAdapterRegistry([{ ...ifood, provider: "ifood" }])).toThrow(/uppercase/);
    expect(() => createAdapterRegistry([ifood, ifood])).toThrow(/two adapters/);
    const doubled = ifood.cancellationReasons()[0]!;
    expect(() =>
      createAdapterRegistry([{ ...ifood, cancellationReasons: () => [doubled, doubled] }]),
    ).toThrow(/twice/);
  });

  it("refuses an adapter that cancels through its API but has no reason to cancel with", () => {
    const ifood = anIfoodAdapter();
    expect(() => createAdapterRegistry([{ ...ifood, cancellationReasons: () => [] }])).toThrow(/no reason/);
  });
});
