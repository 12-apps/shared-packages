import { describe, expect, it } from "vitest";

import { MESSAGING_DEFAULTS } from "../core/ports";
import { NOW, textMessage, voiceNote } from "./fixtures";
import { TENANT, createHarness } from "./harness";

/**
 * The retention sweep: 12 h after a conversation's LAST message its text is
 * deleted; the conversation, its state and its structured summary stay.
 */

const HOUR = 60 * 60 * 1000;
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

describe("the retention sweep", () => {
  it("defaults to twelve hours", () => {
    expect(MESSAGING_DEFAULTS.retentionMs).toBe(12 * HOUR);
  });

  it("deletes only text past 12 h after the conversation's last message, and keeps the summary", async () => {
    const h = createHarness();
    await h.connect();
    await h.deliver(textMessage("quero uma pizza", { id: "wamid.1" }));
    await h.deliver(voiceNote(at(1000)));
    const conversation = h.dump().conversations[0]!;
    const audio = h.dump().messages.find((row) => row.kind === "AUDIO")!;
    await h.engine.setTranscript(TENANT, audio.id, "sem cebola");
    await h.engine.setSummary(TENANT, conversation.id, { items: ["pizza"], mode: "pickup" });

    // 12 h after the last message, to the millisecond: not yet.
    h.clock.current = at(1000 + 12 * HOUR);
    expect(await h.engine.sweepRetention()).toEqual({ conversations: 0, messages: 0, deliveries: 2, more: false });

    h.clock.current = at(1000 + 12 * HOUR + 1);
    expect(await h.engine.sweepRetention()).toEqual({ conversations: 1, messages: 2, deliveries: 0, more: false });

    expect(h.dump().messages.map(({ body, transcript, options }) => ({ body, transcript, options }))).toEqual([
      { body: null, transcript: null, options: null },
      { body: null, transcript: null, options: null },
    ]);
    expect(h.dump().conversations[0]).toMatchObject({
      id: conversation.id,
      state: "AGENT",
      hasText: false,
      summary: { items: ["pizza"], mode: "pickup" },
      summaryUpdatedAt: NOW,
      lastInboundAt: at(1000),
    });
    // Ids, kinds and receipts outlive the text.
    expect(h.dump().messages.map((row) => row.externalId)).toEqual(["wamid.1", "wamid.HBgNNTUxMTk4NzY1NDMyMRUCABIYFkFVRElPLU5PVEUA"]);
  });

  it("leaves a conversation alone while it is still talking", async () => {
    const h = createHarness();
    await h.connect();
    await h.deliver(textMessage("first", { id: "wamid.1" }));
    await h.deliver(textMessage("eleven hours later", { id: "wamid.2", at: at(11 * HOUR) }));

    h.clock.current = at(13 * HOUR);
    expect(await h.engine.sweepRetention()).toMatchObject({ conversations: 0 });
    expect(h.dump().messages.map((row) => row.body)).toEqual(["first", "eleven hours later"]);
  });

  it("takes a batch across tenants, oldest first, and says when more are due", async () => {
    const h = createHarness({ retentionBatchSize: 2 });
    await h.connect("tenant-a", "1001");
    await h.connect("tenant-b", "1002");
    await h.connect("tenant-c", "1003");
    await h.deliver(textMessage("newest", { id: "wamid.a", phoneNumberId: "1002", at: at(2 * HOUR) }));
    await h.deliver(textMessage("oldest", { id: "wamid.b", phoneNumberId: "1001", at: at(0) }));
    await h.deliver(textMessage("middle", { id: "wamid.c", phoneNumberId: "1003", at: at(HOUR) }));

    h.clock.current = at(20 * HOUR);
    expect(await h.engine.sweepRetention()).toEqual({ conversations: 2, messages: 2, deliveries: 2, more: true });
    expect(h.dump().messages.map((row) => row.body)).toEqual(["newest", null, null]);
    expect(await h.engine.sweepRetention()).toEqual({ conversations: 1, messages: 1, deliveries: 1, more: false });
    expect(await h.engine.sweepRetention()).toEqual({ conversations: 0, messages: 0, deliveries: 0, more: false });
  });
});
