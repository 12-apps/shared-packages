import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  APP_SECRET,
  CONTACT,
  NOW,
  OTHER_PHONE_NUMBER_ID,
  PHONE_NUMBER_ID,
  buttonReply,
  sign,
  statusUpdate,
  sticker,
  textMessage,
  userPreferenceStop,
  voiceNote,
} from "./fixtures";
import { OTHER_TENANT, TENANT, createHarness } from "./harness";

/**
 * The inbound pipeline end to end: the webhook route verifies and persists,
 * the processing job parses, resolves the tenant by the event's account, and
 * applies messages, receipts and opt-outs.
 */

const HOUR = 60 * 60 * 1000;
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

describe("the webhook edge", () => {
  it("refuses a bad signature with 401 and stores nothing", async () => {
    const h = createHarness();
    await h.connect();
    const body = textMessage("Oi");

    for (const signature of [sign(body, "another-secret"), null, "sha256=deadbeef", sign(`${body} `)]) {
      expect((await h.post(body, signature)).status).toBe(401);
    }
    expect(h.dump().deliveries).toHaveLength(0);
    expect(h.queued).toHaveLength(0);
  });

  it("persists a signed delivery raw, answers 200, and queues ONE processing job", async () => {
    const h = createHarness();
    const body = textMessage("Oi");
    const response = await h.post(body);

    expect(response).toEqual({ status: 200, body: { received: true, duplicate: false } });
    expect(h.dump().deliveries).toEqual([expect.objectContaining({ rawBody: body, state: "PENDING", attempts: 0 })]);
    expect(h.queued).toEqual([{ name: "messaging.process-delivery", payload: { deliveryId: h.dump().deliveries[0]!.id } }]);
    // Nothing was resolved at the edge: no connection exists, and the row is stored anyway.
    expect(h.dump().conversations).toHaveLength(0);
  });

  it("stores a replayed delivery once and creates one message", async () => {
    const h = createHarness();
    await h.connect();
    const body = textMessage("Quero pedir");

    await h.deliver(body);
    const replay = await h.deliver(body);

    expect(replay.response).toEqual({ status: 200, body: { received: true, duplicate: true } });
    expect(h.dump().deliveries).toHaveLength(1);
    expect(h.dump().messages).toHaveLength(1);
  });

  it("dedupes the same message delivered inside a different body", async () => {
    const h = createHarness();
    await h.connect();
    await h.deliver(textMessage("Oi", { id: "wamid.SAME" }));
    // Meta re-sends the event with a later envelope: other bytes, same wamid.
    const { outcomes } = await h.deliver(textMessage("Oi", { id: "wamid.SAME", at: at(1000) }));

    expect(h.dump().deliveries).toHaveLength(2);
    expect(h.dump().messages).toHaveLength(1);
    expect(outcomes[0]).toEqual({ kind: "processed", events: [{ kind: "duplicate" }] });
  });

  it("verifies the signature over the bytes as received, not over a decoded copy", async () => {
    const h = createHarness();
    await h.connect();
    // A raw 0xFF byte inside a JSON string is not UTF-8: decoding it first would change the bytes the HMAC covers.
    const head = new TextEncoder().encode('{"object":"whatsapp_business_account","entry":[],"note":"');
    const bytes = new Uint8Array([...head, 0xff, ...new TextEncoder().encode('"}')]);
    const signature = `sha256=${createHmac("sha256", APP_SECRET).update(bytes).digest("hex")}`;
    const post = (body: Uint8Array, header: string) =>
      h.route("POST").handle({
        actor: null,
        params: { channel: "whatsapp" },
        query: {},
        request: new Request("https://host.test/api/webhooks/messaging/whatsapp", {
          method: "POST",
          headers: { "x-hub-signature-256": header },
          body: new Blob([body.buffer as ArrayBuffer]),
        }),
      }) as Promise<{ status: number }>;

    expect((await post(bytes, signature)).status).toBe(200);
    // A signature over the decoded text is not the signature of the bytes.
    const decoded = new TextDecoder().decode(bytes);
    expect((await post(bytes, sign(decoded))).status).toBe(401);
  });

  it("answers 404 for a channel no adapter serves", async () => {
    const h = createHarness();
    expect((await h.post("{}", sign("{}"), "carrier-pigeon")).status).toBe(404);
  });

  it("answers the subscription handshake with the bare challenge, and refuses a wrong token", async () => {
    const h = createHarness();
    const handshake = (query: Record<string, string>) =>
      h.route("GET").handle({ actor: null, params: { channel: "whatsapp" }, query });

    const ok = await handshake({ "hub.mode": "subscribe", "hub.verify_token": "test-verify-token", "hub.challenge": "1158201444" });
    expect("response" in ok && (await ok.response.text())).toBe("1158201444");
    const refused = await handshake({ "hub.mode": "subscribe", "hub.verify_token": "guess", "hub.challenge": "1" });
    expect(refused).toEqual({ status: 403, body: { error: "forbidden" } });
  });
});

describe("processing", () => {
  it("drops a delivery for an account nobody connected: processed, nothing created", async () => {
    const h = createHarness();
    await h.connect();
    const { response, outcomes } = await h.deliver(textMessage("Oi", { phoneNumberId: OTHER_PHONE_NUMBER_ID }));

    expect(response.status).toBe(200);
    expect(outcomes[0]).toEqual({ kind: "processed", events: [{ kind: "dropped", reason: "unknown-account" }] });
    expect(h.dump().deliveries[0]).toMatchObject({ state: "PROCESSED", attempts: 1 });
    expect(h.dump().conversations).toHaveLength(0);
    expect(h.dump().messages).toHaveLength(0);
  });

  it("drops a delivery for a revoked connection", async () => {
    const h = createHarness();
    const connection = await h.connect();
    await h.engine.revoke(TENANT, connection.id, "disconnected by the tenant");
    const { outcomes } = await h.deliver(textMessage("Oi"));

    expect(outcomes[0]).toEqual({ kind: "processed", events: [{ kind: "dropped", reason: "not-connected" }] });
    expect(h.dump().conversations).toHaveLength(0);
  });

  it("opens a conversation in AGENT, stores the message, and tells the host once", async () => {
    const onInboundMessage = vi.fn();
    const h = createHarness({ hooks: { onInboundMessage } });
    const connection = await h.connect();
    await h.deliver(textMessage("Oi, tem pizza?"));
    await h.deliver(textMessage("Oi, tem pizza?"));

    const [conversation] = h.dump().conversations;
    expect(conversation).toMatchObject({
      tenantId: TENANT,
      channel: "whatsapp",
      contactId: CONTACT,
      contactName: "Ana Souza",
      connectionId: connection.id,
      state: "AGENT",
      lastInboundAt: NOW,
      lastMessageAt: NOW,
      hasText: true,
    });
    expect(h.dump().messages).toEqual([
      expect.objectContaining({ direction: "INBOUND", kind: "TEXT", body: "Oi, tem pizza?", authorKind: "CONTACT", deliveryStatus: "RECEIVED" }),
    ]);
    expect(onInboundMessage).toHaveBeenCalledTimes(1);
    expect(onInboundMessage.mock.calls[0]![0]).toMatchObject({ conversation: { id: conversation!.id }, message: { body: "Oi, tem pizza?" } });
  });

  it("stores an interactive reply's title and id, an audio's media id, and any other type as OTHER", async () => {
    const h = createHarness();
    await h.connect();
    await h.deliver(buttonReply("confirm-yes", "Sim"));
    await h.deliver(voiceNote(at(1000)));
    await h.deliver(sticker(at(2000)));

    expect(h.dump().messages.map(({ kind, body, attachmentRef }) => ({ kind, body, attachmentRef }))).toEqual([
      { kind: "INTERACTIVE", body: "Sim", attachmentRef: "confirm-yes" },
      { kind: "AUDIO", body: null, attachmentRef: "1234567890123456" },
      { kind: "OTHER", body: null, attachmentRef: null },
    ]);
  });

  it("keeps the latest inbound time when deliveries arrive out of order", async () => {
    const h = createHarness();
    await h.connect();
    await h.deliver(textMessage("second", { id: "wamid.2", at: at(HOUR) }));
    await h.deliver(textMessage("first", { id: "wamid.1", at: NOW }));

    expect(h.dump().conversations[0]).toMatchObject({ lastInboundAt: at(HOUR), lastMessageAt: at(HOUR) });
  });

  it("never lets a number connected to one tenant deliver into another", async () => {
    const h = createHarness();
    await h.connect(OTHER_TENANT, OTHER_PHONE_NUMBER_ID);
    await h.connect(TENANT, PHONE_NUMBER_ID);
    await h.deliver(textMessage("Oi"));

    expect(h.dump().conversations.map((row) => row.tenantId)).toEqual([TENANT]);
    await expect(h.connect(OTHER_TENANT, PHONE_NUMBER_ID)).rejects.toMatchObject({ code: "ACCOUNT_TAKEN" });
  });

  it("settles an unreadable body PROCESSED with its reason, without retrying it", async () => {
    const h = createHarness();
    const body = "not json";
    expect((await h.post(body)).status).toBe(200);
    const [outcome] = await h.drain();

    expect(outcome).toMatchObject({ kind: "unreadable" });
    expect(h.dump().deliveries[0]).toMatchObject({ state: "PROCESSED", error: expect.stringMatching(/^unreadable/) });
  });

  it("re-runs a delivery a failed job left behind, through the reconciliation sweep", async () => {
    let fail = true;
    const h = createHarness();
    await h.connect();
    const original = h.store.insertMessage.bind(h.store);
    h.store.insertMessage = async (input) => {
      if (fail) throw new Error("database went away");
      return original(input);
    };
    await h.post(textMessage("Oi"));
    await expect(h.drain()).rejects.toThrow("database went away");
    expect(h.dump().deliveries[0]).toMatchObject({ state: "FAILED", attempts: 1 });

    fail = false;
    h.clock.current = at(5 * 60 * 1000);
    expect(await h.engine.reconcile()).toEqual({ retried: 1, failed: 0 });
    expect(h.dump().deliveries[0]).toMatchObject({ state: "PROCESSED", attempts: 2 });
    expect(h.dump().messages).toHaveLength(1);
  });
});

describe("receipts", () => {
  async function sent(h: ReturnType<typeof createHarness>) {
    await h.connect();
    await h.deliver(textMessage("Oi"));
    const conversation = h.dump().conversations[0]!;
    return h.engine.send({ tenantId: TENANT, conversationId: conversation.id, content: { kind: "TEXT", text: "Olá!" }, author: { kind: "AGENT" } });
  }

  it("move the outbound row forward and stamp each receipt once", async () => {
    const h = createHarness();
    const message = await sent(h);
    expect(message).toMatchObject({ deliveryStatus: "ACCEPTED", externalId: "wamid.OUT-1" });

    await h.deliver(statusUpdate("wamid.OUT-1", "sent", at(1000)));
    await h.deliver(statusUpdate("wamid.OUT-1", "read", at(3000)));
    // Late and out of order: a delivered after the read, and the read again.
    await h.deliver(statusUpdate("wamid.OUT-1", "delivered", at(2000)));
    await h.deliver(statusUpdate("wamid.OUT-1", "read", at(9000)));

    expect(h.dump().messages.find((row) => row.id === message.id)).toMatchObject({
      deliveryStatus: "READ",
      sentAt: at(1000),
      deliveredAt: at(2000),
      readAt: at(3000),
    });
  });

  it("record a failure with the channel's error", async () => {
    const h = createHarness();
    const message = await sent(h);
    await h.deliver(statusUpdate("wamid.OUT-1", "failed", at(1000)));

    expect(h.dump().messages.find((row) => row.id === message.id)).toMatchObject({
      deliveryStatus: "FAILED",
      failedAt: at(1000),
      error: "131047: Re-engagement message",
    });
  });

  it("settle a receipt that found no message FAILED, and apply it once the sender stored its id", async () => {
    const h = createHarness();
    await h.connect();
    const { outcomes } = await h.deliver(statusUpdate("wamid.OUT-1", "read", at(3000)));
    expect(outcomes[0]).toEqual({ kind: "processed", events: [{ kind: "receipt", applied: false }] });
    expect(h.dump().deliveries[0]).toMatchObject({ state: "FAILED", attempts: 1, error: expect.stringMatching(/not stored yet/u) });

    // The sender's own write of the channel id lands; the sweep re-runs the receipt.
    await h.deliver(textMessage("Oi"));
    const conversation = h.dump().conversations[0]!;
    const message = await h.engine.send({ tenantId: TENANT, conversationId: conversation.id, content: { kind: "TEXT", text: "Olá!" }, author: { kind: "AGENT" } });
    expect(message.externalId).toBe("wamid.OUT-1");
    h.clock.current = at(5 * 60 * 1000);
    expect(await h.engine.reconcile()).toEqual({ retried: 1, failed: 0 });
    expect(h.dump().deliveries[0]).toMatchObject({ state: "PROCESSED", attempts: 2, error: null });
    expect(h.dump().messages.find((row) => row.id === message.id)).toMatchObject({ deliveryStatus: "READ", readAt: at(3000) });
  });
});

describe("the opt-out keywords", () => {
  it.each(["PARAR", "parar", "Párar", "  Stop ", "sair", "CANCELAR", "PARAR.", "Parar!", "🛑 parar"])("%j sets the conversation OPTED_OUT", async (word) => {
    const onInboundMessage = vi.fn();
    const typed = createHarness({ hooks: { onInboundMessage } });
    await typed.connect();
    await typed.deliver(textMessage(word));

    expect(typed.dump().conversations[0]).toMatchObject({ state: "OPTED_OUT" });
    expect(typed.dump().messages).toHaveLength(1);
    expect(onInboundMessage).not.toHaveBeenCalled();
  });

  it.each(["parar de enviar", "pare", "não quero parar"])("%j does not", async (text) => {
    const typed = createHarness();
    await typed.connect();
    await typed.deliver(textMessage(text));
    expect(typed.dump().conversations[0]).toMatchObject({ state: "AGENT" });
  });

});

describe("the opt-out signal and re-opening", () => {
  it("takes Meta's own opt-out signal, opening a conversation if none exists", async () => {
    const signalled = createHarness();
    await signalled.connect();
    await signalled.deliver(userPreferenceStop());
    expect(signalled.dump().conversations).toEqual([expect.objectContaining({ contactId: CONTACT, state: "OPTED_OUT", lastInboundAt: null })]);
  });

  it("re-opens on the contact's next message, into AGENT by default", async () => {
    const plain = createHarness();
    await plain.connect();
    await plain.deliver(textMessage("PARAR", { id: "wamid.stop" }));
    await plain.deliver(textMessage("voltei", { id: "wamid.back", at: at(HOUR) }));
    expect(plain.dump().conversations[0]).toMatchObject({ state: "AGENT", lastInboundAt: at(HOUR) });
  });

  it("re-opens into the state the host's hook chooses", async () => {
    const reopenState = vi.fn(() => "HUMAN" as const);
    const hooked = createHarness({ hooks: { reopenState } });
    await hooked.connect();
    await hooked.deliver(textMessage("PARAR", { id: "wamid.stop" }));
    await hooked.deliver(textMessage("voltei", { id: "wamid.back", at: at(HOUR) }));
    expect(hooked.dump().conversations[0]).toMatchObject({ state: "HUMAN" });
    expect(reopenState).toHaveBeenCalledTimes(1);
  });

  it("reads an OPTED_OUT answer from the hook as the default, never as a way to stay opted out", async () => {
    const reopenState = vi.fn(() => "OPTED_OUT" as never);
    const h = createHarness({ hooks: { reopenState } });
    await h.connect();
    await h.deliver(textMessage("PARAR", { id: "wamid.stop" }));
    await h.deliver(textMessage("voltei", { id: "wamid.back", at: at(HOUR) }));
    expect(h.dump().conversations[0]).toMatchObject({ state: "AGENT" });
  });

  it("hands a throwing onInboundMessage's error to the logger's meta", async () => {
    const error = vi.fn();
    const failure = new Error("agent queue down");
    const h = createHarness({
      hooks: { onInboundMessage: () => Promise.reject(failure) },
      logger: { info: () => undefined, warn: () => undefined, error },
    });
    await h.connect();
    await h.deliver(textMessage("Oi"));
    expect(error).toHaveBeenCalledWith(expect.stringContaining("agent queue down"), { error: failure });
  });

  it("cannot be undone by a staff state change", async () => {
    const h = createHarness();
    await h.connect();
    await h.deliver(textMessage("STOP"));
    const conversation = h.dump().conversations[0]!;
    expect(await h.engine.setState(TENANT, conversation.id, "HUMAN")).toBeNull();
    expect(h.dump().conversations[0]).toMatchObject({ state: "OPTED_OUT" });
  });
});
