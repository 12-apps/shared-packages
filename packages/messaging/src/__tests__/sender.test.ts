import { describe, expect, it } from "vitest";

import { MessagingSendError } from "../core/errors";
import { CONTACT, NOW, PHONE_NUMBER_ID, textMessage } from "./fixtures";
import { TENANT, TOKEN, createHarness, type RecordedCall } from "./harness";

/**
 * The sender: refusals first (opted out, window closed, not connected), then
 * the outbound row BEFORE the channel call, then the channel's id or its
 * failure on that row.
 */

const DAY = 24 * 60 * 60 * 1000;
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

async function conversationOf(h: ReturnType<typeof createHarness>, first = "Oi") {
  await h.connect();
  await h.deliver(textMessage(first));
  return h.dump().conversations[0]!;
}

const text = (conversationId: string, body = "Olá!") => ({
  tenantId: TENANT,
  conversationId,
  content: { kind: "TEXT" as const, text: body },
  author: { kind: "AGENT" as const },
});

describe("the send policy", () => {
  it("allows a free-form send at 24 h - 1 s after the last inbound and refuses one at 24 h + 1 s", async () => {
    const h = createHarness();
    const conversation = await conversationOf(h);

    h.clock.current = at(DAY - 1000);
    await expect(h.engine.send(text(conversation.id))).resolves.toMatchObject({ deliveryStatus: "ACCEPTED" });

    h.clock.current = at(DAY + 1000);
    await expect(h.engine.send(text(conversation.id))).rejects.toMatchObject({ name: "MessagingSendError", code: "WINDOW_CLOSED" });
    // The refused send recorded nothing and called nobody.
    expect(h.dump().messages.filter((row) => row.direction === "OUTBOUND")).toHaveLength(1);
    expect(h.calls).toHaveLength(1);
  });

  it("refuses a send to an opted-out conversation, recording nothing", async () => {
    const h = createHarness();
    const conversation = await conversationOf(h, "PARAR");

    await expect(h.engine.send(text(conversation.id))).rejects.toMatchObject({ code: "OPTED_OUT" });
    expect(h.dump().messages.filter((row) => row.direction === "OUTBOUND")).toHaveLength(0);
    expect(h.calls).toHaveLength(0);
  });

  it("refuses a send through a revoked connection, and an unknown or foreign conversation", async () => {
    const h = createHarness();
    const conversation = await conversationOf(h);

    await expect(h.engine.send({ ...text(conversation.id), tenantId: "tenant-b" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await h.engine.revoke(TENANT, conversation.connectionId);
    await expect(h.engine.send(text(conversation.id))).rejects.toMatchObject({ code: "NOT_CONNECTED" });
    expect(h.calls).toHaveLength(0);
  });
});

describe("an accepted send", () => {
  it("records the row PENDING before calling the channel, then stores the channel's id", async () => {
    const seenDuringCall: unknown[][] = [];
    const h = createHarness({
      answer: () => {
        seenDuringCall.push(h.dump().messages.filter((row) => row.direction === "OUTBOUND").map((row) => row.deliveryStatus));
        return { status: 200, body: { messaging_product: "whatsapp", contacts: [{ input: CONTACT, wa_id: CONTACT }], messages: [{ id: "wamid.ACCEPTED" }] } };
      },
    });
    const conversation = await conversationOf(h);
    const sent = await h.engine.send(text(conversation.id, "Temos sim!"));

    expect(seenDuringCall).toEqual([["PENDING"]]);
    expect(sent).toMatchObject({ direction: "OUTBOUND", authorKind: "AGENT", body: "Temos sim!", externalId: "wamid.ACCEPTED", deliveryStatus: "ACCEPTED" });
  });

  it("calls the Graph API with the opened token in a header, from the connection's number, to the contact", async () => {
    const h = createHarness();
    const conversation = await conversationOf(h);
    await h.engine.send({
      tenantId: TENANT,
      conversationId: conversation.id,
      content: { kind: "BUTTONS", text: "Confirma?", buttons: [{ id: "yes", title: "Sim" }, { id: "no", title: "Não" }] },
      author: { kind: "STAFF", staffUserId: "user-7" },
    });
    const [call] = h.calls as [RecordedCall];

    expect(call.url).toBe(`https://graph.example.test/v23.0/${PHONE_NUMBER_ID}/messages`);
    expect(call.url).not.toContain(TOKEN);
    expect(call.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(call.body).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: CONTACT,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: "Confirma?" },
        action: { buttons: [{ type: "reply", reply: { id: "yes", title: "Sim" } }, { type: "reply", reply: { id: "no", title: "Não" } }] },
      },
    });
    expect(h.dump().messages.at(-1)).toMatchObject({ kind: "INTERACTIVE", authorKind: "STAFF", staffUserId: "user-7", options: expect.stringContaining("\"yes\"") });
  });

  it("marks the row FAILED with the channel's error when the channel refuses, and throws", async () => {
    const h = createHarness({
      answer: () => ({ status: 400, body: { error: { message: "(#131030) Recipient phone number not in allowed list", type: "OAuthException", code: 131030 } } }),
    });
    const conversation = await conversationOf(h);
    const failure = await h.engine.send(text(conversation.id)).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(MessagingSendError);
    expect(failure).toMatchObject({ code: "CHANNEL_FAILED" });
    const row = h.dump().messages.find((candidate) => candidate.id === (failure as MessagingSendError).messageId);
    expect(row).toMatchObject({ deliveryStatus: "FAILED", failedAt: NOW, externalId: null, error: expect.stringContaining("131030") });
    expect(row?.error).not.toContain(TOKEN);
  });
});

describe("connections", () => {
  it("seal the credential and never return it", async () => {
    const h = createHarness();
    const view = await h.connect();

    expect(view).not.toHaveProperty("credentialSealed");
    expect(JSON.stringify(view)).not.toContain(TOKEN);
    expect(JSON.stringify(await h.engine.listConnections(TENANT))).not.toContain(TOKEN);
    expect(h.dump().connections[0]!.credentialSealed).not.toContain(TOKEN);
  });

  it("let a revoked number be connected by another tenant, and refuse one still held", async () => {
    const h = createHarness();
    const first = await h.connect("tenant-a");
    await expect(h.connect("tenant-b")).rejects.toMatchObject({ code: "ACCOUNT_TAKEN" });
    await h.engine.markError("tenant-a", first.id, "token rejected");
    await expect(h.connect("tenant-b")).rejects.toMatchObject({ code: "ACCOUNT_TAKEN" });
    await h.engine.revoke("tenant-a", first.id);
    await expect(h.connect("tenant-b")).resolves.toMatchObject({ tenantId: "tenant-b", status: "CONNECTED" });
  });
});
