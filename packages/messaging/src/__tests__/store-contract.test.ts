import { describe, expect, it, vi } from "vitest";

import { createMemoryMessagingStore } from "../core/memory-store";
import { createPrismaMessagingStore } from "../core/prisma-store";
import type { MessagingStore } from "../core/store";
import { MESSAGING_DEFAULTS } from "../core/ports";
import { NOW, PHONE_NUMBER_ID, statusUpdate, textMessage, voiceNote } from "./fixtures";
import { TENANT, TOKEN, createHarness } from "./harness";
import { migratedPglite, pgliteDb } from "./pglite-db";

/**
 * ONE contract, two stores: the in-memory one every other suite uses, and the
 * Prisma one on real Postgres with the shipped migration. The same pipeline
 * runs over both and must leave the same rows, so the memory double cannot
 * drift from what a host's database does — and every write meets the
 * migration's CHECKs and unique indexes.
 */

/* eslint-disable test-flakiness/no-database-operations, test-flakiness/no-test-isolation --
   Real Postgres is the subject. Each case boots its own in-memory PGlite
   inside the case, so nothing is shared between cases. */

vi.setConfig({ testTimeout: 60_000 });

const HOUR = 60 * 60 * 1000;
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

const STORES: [string, () => Promise<MessagingStore>][] = [
  ["memory", async () => createMemoryMessagingStore()],
  ["prisma on Postgres", async () => createPrismaMessagingStore(pgliteDb(await migratedPglite()))],
];

describe.each(STORES)("the %s store", (_name, makeStore) => {
  it("runs the pipeline: one inbox row per body, one message per wamid, receipts forward only", async () => {
    const h = createHarness({ store: await makeStore() });
    await h.connect();
    const body = textMessage("Oi", { id: "wamid.in" });
    await h.deliver(body);
    await h.deliver(body);
    await h.deliver(textMessage("Oi", { id: "wamid.in", at: at(1000) }));

    const conversation = (await h.store.findConversation(TENANT, "whatsapp", "5511987654321"))!;
    expect(conversation).toMatchObject({ state: "AGENT", lastInboundAt: at(0), hasText: true, summary: null });
    const sent = await h.engine.send({ tenantId: TENANT, conversationId: conversation.id, content: { kind: "TEXT", text: "Olá" }, author: { kind: "AGENT" } });
    await h.deliver(statusUpdate(sent.externalId!, "read", at(3000)));
    await h.deliver(statusUpdate(sent.externalId!, "sent", at(2000)));

    const messages = await h.store.listMessages(TENANT, conversation.id);
    expect(messages.map((row) => [row.direction, row.externalId, row.deliveryStatus])).toEqual([
      ["INBOUND", "wamid.in", "RECEIVED"],
      ["OUTBOUND", "wamid.OUT-1", "READ"],
    ]);
    expect(messages[1]).toMatchObject({ sentAt: at(2000), readAt: at(3000), deliveredAt: null });
    expect(await h.store.listRetryableDeliveries({ receivedBefore: at(HOUR), maxAttempts: 5, take: 10 })).toEqual([]);
  });

  it("never returns the sealed credential, and refuses an account held by another tenant", async () => {
    const h = createHarness({ store: await makeStore() });
    await h.connect("tenant-a");
    await expect(h.connect("tenant-b")).rejects.toMatchObject({ code: "ACCOUNT_TAKEN" });
    const listed = await h.engine.listConnections("tenant-a");
    expect(listed).toHaveLength(1);
    expect(listed[0]).not.toHaveProperty("credentialSealed");
    expect(JSON.stringify(listed)).not.toContain(TOKEN);
  });

  it("keeps the summary and deletes the text past the retention window, in one pass across tenants", async () => {
    const h = createHarness({ store: await makeStore() });
    await h.connect("tenant-a", "1001");
    await h.connect("tenant-b", "1002");
    await h.deliver(textMessage("a", { id: "wamid.a", phoneNumberId: "1001" }));
    await h.deliver(voiceNote(at(1000)).replace(/106540352242922/u, "1002"));
    const b = (await h.store.findConversation("tenant-b", "whatsapp", "5511987654321"))!;
    const [audio] = await h.store.listMessages("tenant-b", b.id);
    await h.engine.setTranscript("tenant-b", audio!.id, "transcribed");
    await h.engine.setSummary("tenant-b", b.id, { items: ["x"] });

    h.clock.current = at(13 * HOUR);
    expect(await h.engine.sweepRetention()).toEqual({ conversations: 2, messages: 2, deliveries: 2, more: false });
    expect(await h.engine.sweepRetention()).toEqual({ conversations: 0, messages: 0, deliveries: 0, more: false });
    expect((await h.store.listMessages("tenant-b", b.id))[0]).toMatchObject({ transcript: null, attachmentRef: "1234567890123456" });
    expect(await h.store.getConversation("tenant-b", b.id)).toMatchObject({ summary: { items: ["x"] }, hasText: false });
  });

  it("answers a lost race on a unique key with the existing row", async () => {
    const store = await makeStore();
    const connection = (await store.saveConnection({
      tenantId: TENANT,
      channel: "whatsapp",
      externalAccountId: "acct-1",
      externalParentId: null,
      displayAddress: "+55 11 3000-0000",
      credentialSealed: "sealed",
      connectedAt: NOW,
    }))!;
    const base = {
      tenantId: TENANT,
      channel: "whatsapp",
      contactId: "5511900000000",
      contactName: null,
      connectionId: connection.id,
      state: "AGENT" as const,
      lastInboundAt: null,
      lastMessageAt: null,
      hasText: false,
    };
    const first = await store.createConversation(base);
    expect((await store.createConversation(base)).id).toBe(first.id);
    const message = {
      conversationId: first.id,
      tenantId: TENANT,
      channel: "whatsapp",
      direction: "INBOUND" as const,
      kind: "TEXT" as const,
      body: "x",
      options: null,
      attachmentRef: null,
      externalId: "wamid.race",
      deliveryStatus: "RECEIVED" as const,
      authorKind: "CONTACT" as const,
      staffUserId: null,
      createdAt: NOW,
    };
    const inserted = await store.insertMessage(message);
    expect(await store.insertMessage(message)).toEqual({ created: false, message: inserted.message });
    expect(await store.recordDelivery({ channel: "whatsapp", bodyHash: "h", rawBody: "{}", receivedAt: NOW })).toMatchObject({ fresh: true });
    expect(await store.recordDelivery({ channel: "whatsapp", bodyHash: "h", rawBody: "{}", receivedAt: NOW })).toMatchObject({ fresh: false });
  });

  it("scopes every read and write to its tenant", async () => {
    const h = createHarness({ store: await makeStore() });
    await h.connect();
    await h.deliver(textMessage("Oi"));
    const conversation = (await h.store.findConversation(TENANT, "whatsapp", "5511987654321"))!;

    expect(await h.store.getConversation("tenant-b", conversation.id)).toBeNull();
    expect(await h.store.updateConversation("tenant-b", conversation.id, { state: "CLOSED" })).toBeNull();
    expect(await h.store.listMessages("tenant-b", conversation.id)).toEqual([]);
    expect(await h.engine.setSummary("tenant-b", conversation.id, { stolen: true })).toBeNull();
  });
});

/** The deliveries a harness queued, as the job would be handed them. */
type Harness = ReturnType<typeof createHarness>;

/** A store whose Nth call to `operation` first runs `before`, to play the other worker that wins a race. */
function racing(store: MessagingStore, operation: "findConversation" | "updateConversation") {
  let before: (() => Promise<unknown>) | null = null;
  const wrapped = {
    ...store,
    [operation]: async (...args: never[]) => {
      const run = before;
      before = null;
      // `findConversation` reads first, THEN the other worker writes; `updateConversation` is preceded by it.
      const result = operation === "findConversation" ? await (store.findConversation as (...a: never[]) => Promise<unknown>)(...args) : null;
      if (run) await run();
      return operation === "findConversation" ? result : (store.updateConversation as (...a: never[]) => Promise<unknown>)(...args);
    },
  } as MessagingStore;
  return { store: wrapped, nextCallRaces: (run: () => Promise<unknown>) => (before = run) };
}

describe.each(STORES)("an opt-out on the %s store", (_name, makeStore) => {
  const idsOf = (h: Harness) => h.queuedIds();

  it("survives an older message processed after it, through the reconciliation sweep", async () => {
    const onInboundMessage = vi.fn();
    const h = createHarness({ store: await makeStore(), hooks: { onInboundMessage } });
    await h.connect();
    await h.post(textMessage("oi", { id: "wamid.oi", at: at(-5000) }));
    await h.post(textMessage("PARAR", { id: "wamid.stop", at: at(0) }));
    const stopJob = idsOf(h)[1]!;
    h.queued.splice(0);
    // PARAR runs first; "oi"'s job was lost with its worker and only the sweep finds it.
    await h.engine.processDelivery(stopJob);
    h.clock.current = at(5 * 60 * 1000);
    expect(await h.engine.reconcile()).toEqual({ retried: 1, failed: 0 });

    const conversation = (await h.store.findConversation(TENANT, "whatsapp", "5511987654321"))!;
    expect(conversation).toMatchObject({ state: "OPTED_OUT", optedOutAt: at(0) });
    expect(await h.store.listMessages(TENANT, conversation.id)).toHaveLength(2);
    expect(onInboundMessage).not.toHaveBeenCalled();
    await expect(
      h.engine.send({ tenantId: TENANT, conversationId: conversation.id, content: { kind: "TEXT", text: "Olá" }, author: { kind: "AGENT" } }),
    ).rejects.toMatchObject({ code: "OPTED_OUT" });

    // The contact writes again AFTER the opt-out: only then does it re-open.
    await h.deliver(textMessage("voltei", { id: "wamid.back", at: at(HOUR) }));
    expect(await h.store.getConversation(TENANT, conversation.id)).toMatchObject({ state: "AGENT", optedOutAt: at(0) });
    expect(onInboundMessage).toHaveBeenCalledTimes(1);
  });

  it("is not clobbered by a message that read the conversation before it landed", async () => {
    const onInboundMessage = vi.fn();
    const raced = racing(await makeStore(), "findConversation");
    const h = createHarness({ store: raced.store, hooks: { onInboundMessage } });
    await h.connect();
    await h.deliver(textMessage("hello", { id: "wamid.0", at: at(-60_000) }));
    await h.post(textMessage("PARAR", { id: "wamid.stop", at: at(0) }));
    await h.post(textMessage("oi", { id: "wamid.oi", at: at(-5000) }));
    const [stopJob, oiJob] = idsOf(h);
    h.queued.splice(0);
    onInboundMessage.mockClear();

    // "oi" reads AGENT; PARAR is processed in full; then "oi" writes.
    raced.nextCallRaces(() => h.engine.processDelivery(stopJob!));
    await h.engine.processDelivery(oiJob!);

    expect(await h.store.findConversation(TENANT, "whatsapp", "5511987654321")).toMatchObject({
      state: "OPTED_OUT",
      lastInboundAt: at(0),
      lastMessageAt: at(0),
    });
    expect(onInboundMessage).not.toHaveBeenCalled();
  });

  it("is not undone by a staff hand-off that read the state before it landed", async () => {
    const raced = racing(await makeStore(), "updateConversation");
    const h = createHarness({ store: raced.store });
    await h.connect();
    await h.deliver(textMessage("hello", { id: "wamid.0", at: at(-60_000) }));
    await h.post(textMessage("PARAR", { id: "wamid.stop", at: at(0) }));
    const stopJob = idsOf(h)[0]!;
    h.queued.splice(0);
    const conversation = (await h.store.findConversation(TENANT, "whatsapp", "5511987654321"))!;

    // The opt-out lands between the staff action starting and its write.
    raced.nextCallRaces(() => h.engine.processDelivery(stopJob));
    expect(await h.engine.setState(TENANT, conversation.id, "HUMAN")).toBeNull();
    expect(await h.store.getConversation(TENANT, conversation.id)).toMatchObject({ state: "OPTED_OUT" });
    expect(await h.engine.setState(TENANT, conversation.id, "CLOSED")).toBeNull();
  });

  it("lets a hand-off move a conversation that did not opt out", async () => {
    const h = createHarness({ store: await makeStore() });
    await h.connect();
    await h.deliver(textMessage("hello"));
    const conversation = (await h.store.findConversation(TENANT, "whatsapp", "5511987654321"))!;
    expect(await h.engine.setState(TENANT, conversation.id, "HUMAN")).toMatchObject({ state: "HUMAN" });
  });

  it("keeps the latest inbound time when two messages of one contact race", async () => {
    const raced = racing(await makeStore(), "findConversation");
    const h = createHarness({ store: raced.store });
    await h.connect();
    await h.deliver(textMessage("hello", { id: "wamid.0", at: at(-60_000) }));
    await h.post(textMessage("newer", { id: "wamid.newer", at: at(10_000) }));
    await h.post(textMessage("older", { id: "wamid.older", at: at(5000) }));
    const [newerJob, olderJob] = idsOf(h);
    h.queued.splice(0);

    raced.nextCallRaces(() => h.engine.processDelivery(newerJob!));
    await h.engine.processDelivery(olderJob!);

    expect(await h.store.findConversation(TENANT, "whatsapp", "5511987654321")).toMatchObject({
      lastInboundAt: at(10_000),
      lastMessageAt: at(10_000),
    });
  });
});

describe.each(STORES)("retention of the raw webhook bodies on the %s store", (_name, makeStore) => {
  it("leaves no raw body behind past the cutoff, and a redelivery is still a duplicate", async () => {
    const onInboundMessage = vi.fn();
    const store = await makeStore();
    const h = createHarness({ store, hooks: { onInboundMessage } });
    await h.connect();
    const text = "meu endereço é rua X 123";
    const body = textMessage(text, { id: "wamid.addr" });
    await h.post(body);
    await h.post(`{ not json ${text}`);
    const readable = h.queuedIds();
    await h.drain();

    // A delivery that failed its last attempt, and one that may still be retried.
    const exhausted = await store.recordDelivery({ channel: "whatsapp", bodyHash: "h-exhausted", rawBody: text, receivedAt: NOW });
    const retryable = await store.recordDelivery({ channel: "whatsapp", bodyHash: "h-retryable", rawBody: text, receivedAt: NOW });
    for (let attempt = 0; attempt < MESSAGING_DEFAULTS.maxDeliveryAttempts; attempt += 1) {
      await store.settleDelivery(exhausted.id, { state: "FAILED", error: `boom ${text}`, at: NOW });
    }
    await store.settleDelivery(retryable.id, { state: "FAILED", error: "boom", at: NOW });

    h.clock.current = at(12 * HOUR - 1);
    expect(await h.engine.sweepRetention()).toMatchObject({ deliveries: 0 });
    expect(await store.getDelivery(readable[0]!)).toMatchObject({ rawBody: body });

    h.clock.current = at(12 * HOUR + 1);
    expect(await h.engine.sweepRetention()).toMatchObject({ deliveries: 3, more: false });
    for (const id of [...readable, exhausted.id]) expect(await store.getDelivery(id)).toBeNull();
    // Only a delivery the sweep may still replay keeps its bytes, until it is processed or out of attempts.
    expect(await store.getDelivery(retryable.id)).toMatchObject({ state: "FAILED", rawBody: text });

    // The message row carries the dedupe: the same message again is stored nowhere and tells nobody.
    onInboundMessage.mockClear();
    const replay = await h.deliver(textMessage(text, { id: "wamid.addr", at: at(1000) }));
    expect(replay.outcomes[0]).toEqual({ kind: "processed", events: [{ kind: "duplicate" }] });
    expect(onInboundMessage).not.toHaveBeenCalled();
    const conversation = (await store.findConversation(TENANT, "whatsapp", "5511987654321"))!;
    expect(await store.listMessages(TENANT, conversation.id)).toHaveLength(1);
  });

  it("deletes in batches, oldest first, and says when more are due", async () => {
    const store = await makeStore();
    const h = createHarness({ store, retentionBatchSize: 2 });
    for (const [index, hash] of ["a", "b", "c"].entries()) {
      const row = await store.recordDelivery({ channel: "whatsapp", bodyHash: hash, rawBody: "{}", receivedAt: at(index) });
      await store.settleDelivery(row.id, { state: "PROCESSED", error: null, at: NOW });
    }
    h.clock.current = at(13 * HOUR);
    expect(await h.engine.sweepRetention()).toMatchObject({ deliveries: 2, more: true });
    expect(await h.engine.sweepRetention()).toMatchObject({ deliveries: 1, more: false });
  });
});

describe.each(STORES)("connecting on the %s store", (_name, makeStore) => {
  it("clears the sealed credential on revoke, and seals a new one on re-connect", async () => {
    const h = createHarness({ store: await makeStore() });
    const connection = await h.connect();
    expect(await h.store.getConnection(TENANT, connection.id)).toMatchObject({ credentialSealed: expect.stringMatching(/^sealed:/u) });

    await h.engine.revoke(TENANT, connection.id, "disconnected");
    expect(await h.store.getConnection(TENANT, connection.id)).toMatchObject({ status: "REVOKED", credentialSealed: null });

    await h.connect();
    expect(await h.store.getConnection(TENANT, connection.id)).toMatchObject({ status: "CONNECTED", credentialSealed: expect.stringMatching(/^sealed:/u) });
  });

  it("lets only one of two tenants connecting the same account at once win, the other gets ACCOUNT_TAKEN", async () => {
    const h = createHarness({ store: await makeStore() });
    const results = await Promise.allSettled([h.connect("tenant-a"), h.connect("tenant-b")]);
    expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    const lost = results.find((result): result is PromiseRejectedResult => result.status === "rejected")!;
    expect(lost.reason).toMatchObject({ code: "ACCOUNT_TAKEN" });
    expect(await h.engine.listConnections("tenant-a")).toHaveLength(results[0]!.status === "fulfilled" ? 1 : 0);
  });

  it("lets another tenant take over an account only once it is revoked", async () => {
    const h = createHarness({ store: await makeStore() });
    const connection = await h.connect("tenant-a");
    await expect(h.connect("tenant-b")).rejects.toMatchObject({ code: "ACCOUNT_TAKEN" });
    await h.engine.revoke("tenant-a", connection.id);
    await expect(h.connect("tenant-b")).resolves.toMatchObject({ tenantId: "tenant-b", status: "CONNECTED" });
  });
});

describe("the Prisma store's conditional writes", () => {
  const input = (tenantId: string) => ({
    tenantId,
    channel: "whatsapp",
    externalAccountId: PHONE_NUMBER_ID,
    externalParentId: null,
    displayAddress: "+55",
    credentialSealed: "sealed:x",
    connectedAt: NOW,
  });

  it("never overwrites an account a rival took while the takeover was still deciding", async () => {
    const db = pgliteDb(await migratedPglite());
    const store = createPrismaMessagingStore(db);
    const first = (await store.saveConnection(input("tenant-a")))!;
    await store.setConnectionStatus("tenant-a", first.id, { status: "REVOKED", statusReason: null, revokedAt: NOW, credentialSealed: null });
    // tenant-c reads the row REVOKED ...
    const snapshot = await store.findConnectionByAccount("whatsapp", PHONE_NUMBER_ID);
    const stale = createPrismaMessagingStore({
      ...db,
      messagingConnection: { ...db.messagingConnection, findUnique: async () => snapshot },
    });
    // ... but tenant-b connects first: tenant-c's write is conditional on the row still being REVOKED.
    expect(await store.saveConnection(input("tenant-b"))).toMatchObject({ tenantId: "tenant-b" });
    expect(await stale.saveConnection(input("tenant-c"))).toBeNull();
    expect(await store.findConnectionByAccount("whatsapp", PHONE_NUMBER_ID)).toMatchObject({ tenantId: "tenant-b", status: "CONNECTED" });
  });
});

describe("the migration's CHECKs", () => {
  it("refuse an unknown state, and an inbound message with no channel id", async () => {
    const pg = await migratedPglite();
    await pg.exec(
      "INSERT INTO messaging_connections (id, tenant_id, channel, external_account_id, display_address, updated_at) VALUES ('k', 't', 'whatsapp', 'a', '+55', now())",
    );
    await pg.exec(
      "INSERT INTO messaging_conversations (id, tenant_id, channel, contact_id, connection_id, updated_at) VALUES ('c1', 't', 'whatsapp', '55', 'k', now())",
    );
    await expect(pg.exec("UPDATE messaging_conversations SET state = 'PAUSED' WHERE id = 'c1'")).rejects.toThrow(/state_check/u);
    await expect(
      pg.exec(
        "INSERT INTO messaging_messages (id, conversation_id, tenant_id, channel, direction, kind, delivery_status, author_kind) VALUES ('m1', 'c1', 't', 'whatsapp', 'INBOUND', 'TEXT', 'RECEIVED', 'CONTACT')",
      ),
    ).rejects.toThrow(/inbound_check/u);
    await expect(
      pg.exec(
        "INSERT INTO messaging_messages (id, conversation_id, tenant_id, channel, direction, kind, delivery_status, author_kind, staff_user_id) VALUES ('m2', 'c1', 't', 'whatsapp', 'OUTBOUND', 'TEXT', 'PENDING', 'AGENT', 'u1')",
      ),
    ).rejects.toThrow(/staff_author_check/u);
  });

  it("refuse a conversation whose connection does not exist, and a channel that is not a key", async () => {
    const pg = await migratedPglite();
    await expect(
      pg.exec("INSERT INTO messaging_conversations (id, tenant_id, channel, contact_id, connection_id, updated_at) VALUES ('c1', 't', 'whatsapp', '55', 'nope', now())"),
    ).rejects.toThrow(/connection_id_fkey/u);
    await pg.exec(
      "INSERT INTO messaging_connections (id, tenant_id, channel, external_account_id, display_address, updated_at) VALUES ('k', 't', 'whatsapp', 'a', '+55', now())",
    );
    await expect(
      pg.exec("INSERT INTO messaging_conversations (id, tenant_id, channel, contact_id, connection_id, updated_at) VALUES ('c1', 't', 'WhatsApp!', '55', 'k', now())"),
    ).rejects.toThrow(/channel_check/u);
    await expect(
      pg.exec("INSERT INTO messaging_inbox_deliveries (id, channel, body_hash, raw_body, received_at) VALUES ('d1', 'Bad Channel', 'h', '{}', now())"),
    ).rejects.toThrow(/channel_check/u);
  });
});
