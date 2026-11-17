import { describe, expect, it } from "vitest";

import { ChannelMediaFailure, type ChannelAdapter } from "../core/channel";
import { createMemoryMessagingStore } from "../core/memory-store";
import type { MessagingStore } from "../core/store";
import { DEFAULT_MEDIA_MAX_BYTES } from "../core/media";
import { textMessage, voiceNote } from "./fixtures";
import { OTHER_TENANT, TENANT, TOKEN, createHarness, type RecordedCall } from "./harness";

/**
 * The engine's media download: the message is the tenant's, an inbound audio
 * with a media id, its connection is connected, and its credential is opened
 * exactly as a send opens it — then the adapter downloads into memory. The
 * credential (the harness's TOKEN, a sentinel) never surfaces in an error.
 */

const MEDIA_ID = "1234567890123456"; // the voiceNote fixture's audio id
const MEDIA_URL = "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1234567890123456";
const AUDIO = new Uint8Array([79, 103, 103, 83, 0, 2]);

/** The Graph lookup, then the bytes. */
function mediaAnswer(lookup: { status: number; body: unknown } = { status: 200, body: { url: MEDIA_URL, mime_type: "audio/ogg; codecs=opus", file_size: AUDIO.length, id: MEDIA_ID } }) {
  return (call: RecordedCall) => (call.url.startsWith("https://graph.example.test/") ? lookup : { status: 200, body: AUDIO });
}

/** A harness with one stored voice note; returns its message id. */
async function withVoiceNote(options: Parameters<typeof createHarness>[0] = {}) {
  const harness = createHarness({ answer: mediaAnswer(), ...options });
  await harness.connect();
  await harness.deliver(voiceNote());
  const message = harness.dump().messages.find((row) => row.kind === "AUDIO")!;
  return { h: harness, message };
}

/** Every refusal, read in full: neither its message nor its stack carries the credential. */
async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    const text = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
    expect(text).not.toContain(TOKEN);
    if (error instanceof Error && error.cause !== undefined) expect(String(error.cause)).not.toContain(TOKEN);
    return error as Error & { code: string };
  }
  throw new Error("expected a refusal");
}

describe("downloading a voice note's media", () => {
  it("returns the bytes, the type and the size, through the connection's opened credential", async () => {
    const { h, message } = await withVoiceNote();
    const media = await h.engine.downloadMedia(TENANT, message.id);

    expect(media).toEqual({ bytes: AUDIO, mimeType: "audio/ogg; codecs=opus", size: AUDIO.length });
    expect(h.calls.map((call) => call.url)).toEqual([`https://graph.example.test/v23.0/${MEDIA_ID}`, MEDIA_URL]);
    expect(h.calls.every((call) => call.headers.authorization === `Bearer ${TOKEN}`)).toBe(true);
    // Nothing was stored: the message row is as the pipeline left it.
    expect(h.dump().messages.find((row) => row.id === message.id)).toEqual(message);
  });

  it("caps at the default, or at the size the caller asks for", async () => {
    const { h, message } = await withVoiceNote();
    expect(DEFAULT_MEDIA_MAX_BYTES).toBe(16 * 1024 * 1024);
    const error = await refusal(h.engine.downloadMedia(TENANT, message.id, { maxBytes: 3 }));
    expect(error).toMatchObject({ name: "MessagingMediaError", code: "TOO_LARGE" });
    expect(h.calls).toHaveLength(1);
  });

  it("does not find another tenant's message, and calls nobody", async () => {
    const { h, message } = await withVoiceNote();
    expect(await refusal(h.engine.downloadMedia(OTHER_TENANT, message.id))).toMatchObject({ code: "NOT_FOUND" });
    expect(await refusal(h.engine.downloadMedia(TENANT, "no-such-message"))).toMatchObject({ code: "NOT_FOUND" });
    expect(h.calls).toHaveLength(0);
  });

  it("refuses a message with no media: a text, or an outbound message", async () => {
    const h = createHarness({ answer: mediaAnswer() });
    await h.connect();
    await h.deliver(textMessage("Oi"));
    const text = h.dump().messages[0]!;
    expect(await refusal(h.engine.downloadMedia(TENANT, text.id))).toMatchObject({ code: "NO_MEDIA" });

    const answer = mediaAnswer();
    const sending = createHarness({ answer: (call) => (call.method === "POST" ? { status: 200, body: { messages: [{ id: "wamid.OUT" }] } } : answer(call)) });
    await sending.connect();
    await sending.deliver(textMessage("Oi"));
    const sent = await sending.engine.send({ tenantId: TENANT, conversationId: sending.dump().conversations[0]!.id, content: { kind: "TEXT", text: "Olá" }, author: { kind: "AGENT" } });
    expect(await refusal(sending.engine.downloadMedia(TENANT, sent.id))).toMatchObject({ code: "NO_MEDIA" });
    expect(h.calls).toHaveLength(0);
    expect(sending.calls.map((call) => call.method)).toEqual(["POST"]);
  });

  it("refuses a download through a revoked connection, before any call", async () => {
    const { h, message } = await withVoiceNote();
    const [connection] = await h.engine.listConnections(TENANT);
    await h.engine.revoke(TENANT, connection!.id);

    expect(await refusal(h.engine.downloadMedia(TENANT, message.id))).toMatchObject({ code: "NOT_CONNECTED" });
    expect(h.calls).toHaveLength(0);
  });

  it("refuses a download through an adapter with no media download", async () => {
    const withoutMedia = (adapter: ChannelAdapter): ChannelAdapter => {
      const rest: ChannelAdapter = { ...adapter };
      delete rest.fetchMedia;
      return rest;
    };
    const { h, message } = await withVoiceNote({ adapter: withoutMedia });

    expect(await refusal(h.engine.downloadMedia(TENANT, message.id))).toMatchObject({ name: "MessagingMediaError", code: "UNSUPPORTED" });
    expect(h.calls).toHaveLength(0);
  });

  it("reports the channel's refusal with its code, scrubbing the credential even when the channel echoes it", async () => {
    const echoed = { status: 400, body: { error: { code: 190, message: `Malformed access token ${TOKEN}` } } };
    const { h, message } = await withVoiceNote({ answer: mediaAnswer(echoed) });
    const error = await refusal(h.engine.downloadMedia(TENANT, message.id));

    expect(error).toMatchObject({ name: "MessagingMediaError", code: "CHANNEL_FAILED" });
    expect(error.message).toContain("190");
    expect(error.message).toContain("[credential]");
  });

  it("refuses a media URL off Meta's hosts without handing the credential to it", async () => {
    const offHost = { status: 200, body: { url: "https://evil.example.test/a.ogg", file_size: 6 } };
    const { h, message } = await withVoiceNote({ answer: mediaAnswer(offHost) });
    const error = await refusal(h.engine.downloadMedia(TENANT, message.id));

    expect(error).toMatchObject({ code: "CHANNEL_FAILED" });
    expect(error.message).toContain("MEDIA_HOST_REFUSED");
    expect(h.calls.map((call) => call.url)).toEqual([`https://graph.example.test/v23.0/${MEDIA_ID}`]);
  });

  it("refuses a cap or a deadline that would not bound the download, before reading anything", async () => {
    const { h, message } = await withVoiceNote();
    for (const options of [{ maxBytes: NaN }, { maxBytes: Infinity }, { maxBytes: 0 }, { maxBytes: -5 }, { timeoutMs: Infinity }, { timeoutMs: 0.5 }]) {
      expect(await refusal(h.engine.downloadMedia(TENANT, message.id, options))).toMatchObject({ name: "MessagingMediaError", code: "BAD_OPTIONS" });
    }
    expect(h.calls).toHaveLength(0);
  });

  it("reports an adapter's deadline as TIMEOUT, and hands the adapter the deadline asked for", async () => {
    const seen: (number | undefined)[] = [];
    const timingOut = (adapter: ChannelAdapter): ChannelAdapter => ({
      ...adapter,
      fetchMedia: async (input) => {
        seen.push(input.timeoutMs);
        throw new ChannelMediaFailure("TIMEOUT", "the media download did not finish within 7 ms");
      },
    });
    const { h, message } = await withVoiceNote({ adapter: timingOut });

    expect(await refusal(h.engine.downloadMedia(TENANT, message.id, { timeoutMs: 7 }))).toMatchObject({ code: "TIMEOUT" });
    expect(await refusal(h.engine.downloadMedia(TENANT, message.id))).toMatchObject({ code: "TIMEOUT" });
    expect(seen).toEqual([7, 30_000]);
  });

  it("refuses a download on a store that cannot read a message by id", async () => {
    const store: MessagingStore = { ...createMemoryMessagingStore() };
    delete store.getMessage;
    const h = createHarness({ store, answer: mediaAnswer() });
    await h.connect();
    await h.deliver(voiceNote());
    const conversation = (await h.store.findConversation(TENANT, "whatsapp", "5511987654321"))!;
    const [message] = await h.store.listMessages(TENANT, conversation.id);

    expect(await refusal(h.engine.downloadMedia(TENANT, message!.id))).toMatchObject({ code: "UNSUPPORTED" });
    expect(h.calls).toHaveLength(0);
  });
});
