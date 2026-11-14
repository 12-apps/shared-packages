import { describe, expect, it, vi } from "vitest";

import { createMemoryMessagingStore } from "../core/memory-store";
import { createPrismaMessagingStore } from "../core/prisma-store";
import type { MessagingStore } from "../core/store";
import { NOW, statusUpdate, textMessage, voiceNote } from "./fixtures";
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
    expect(await h.engine.sweepRetention()).toEqual({ conversations: 2, messages: 2, more: false });
    expect(await h.engine.sweepRetention()).toEqual({ conversations: 0, messages: 0, more: false });
    expect((await h.store.listMessages("tenant-b", b.id))[0]).toMatchObject({ transcript: null, attachmentRef: "1234567890123456" });
    expect(await h.store.getConversation("tenant-b", b.id)).toMatchObject({ summary: { items: ["x"] }, hasText: false });
  });

  it("answers a lost race on a unique key with the existing row", async () => {
    const store = await makeStore();
    const base = {
      tenantId: TENANT,
      channel: "whatsapp",
      contactId: "5511900000000",
      contactName: null,
      connectionId: "c",
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

describe("the migration's CHECKs", () => {
  it("refuse an unknown state, and an inbound message with no channel id", async () => {
    const pg = await migratedPglite();
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
});
