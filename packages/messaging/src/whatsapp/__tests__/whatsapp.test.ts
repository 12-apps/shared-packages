import { describe, expect, it } from "vitest";

import {
  APP_SECRET,
  CONTACT,
  NOW,
  PHONE_NUMBER_ID,
  WABA_ID,
  buttonReply,
  listReply,
  sign,
  statusUpdate,
  textMessage,
  userPreferenceStop,
  voiceNote,
} from "../../__tests__/fixtures";
import {
  GraphError,
  exchangeSignupCode,
  isOptOutText,
  parseWhatsAppPayload,
  parseWhatsAppStatuses,
  readSignupAccounts,
  subscribeAppToWaba,
  verifyMetaSignature,
  verifyMetaSubscription,
  type FetchPort,
  type GraphConfig,
} from "..";

/** A Graph API double: records each call, answers from a script keyed by path. */
function scriptedGraph(script: Record<string, { status: number; body: unknown }>) {
  const calls: { url: string; method: string; headers: Record<string, string> }[] = [];
  const fetch: FetchPort = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers });
    const path = new URL(url).pathname.replace("/v23.0/", "");
    const answer = script[path] ?? { status: 404, body: { error: { message: "unscripted", code: 803 } } };
    return { status: answer.status, text: async () => JSON.stringify(answer.body) };
  };
  const graph: GraphConfig = { fetch, baseUrl: "https://graph.example.test/", apiVersion: "v23.0" };
  return { graph, calls };
}

describe("the signature check", () => {
  const body = textMessage("Oi");

  it("accepts the HMAC-SHA256 of the raw body with the app secret, in either hex case", () => {
    expect(verifyMetaSignature(body, sign(body), APP_SECRET)).toBe(true);
    expect(verifyMetaSignature(body, sign(body).toUpperCase().replace("SHA256=", "sha256="), APP_SECRET)).toBe(true);
  });

  it("fails closed on every other input", () => {
    const valid = sign(body);
    expect(verifyMetaSignature(`${body}\n`, valid, APP_SECRET)).toBe(false);
    expect(verifyMetaSignature(JSON.stringify(JSON.parse(body)), sign(body, "x"), APP_SECRET)).toBe(false);
    expect(verifyMetaSignature(body, valid, "")).toBe(false);
    expect(verifyMetaSignature(body, null, APP_SECRET)).toBe(false);
    expect(verifyMetaSignature(body, undefined, APP_SECRET)).toBe(false);
    expect(verifyMetaSignature(body, valid.replace("sha256=", "sha1="), APP_SECRET)).toBe(false);
    expect(verifyMetaSignature(body, valid.slice(0, -2), APP_SECRET)).toBe(false);
    expect(verifyMetaSignature(body, `${valid}00`, APP_SECRET)).toBe(false);
    expect(verifyMetaSignature(body, "sha256=" + "z".repeat(64), APP_SECRET)).toBe(false);
  });
});

describe("the subscription handshake", () => {
  const query = { "hub.mode": "subscribe", "hub.verify_token": "token", "hub.challenge": "42" };

  it("echoes the challenge for the configured token", () => {
    expect(verifyMetaSubscription(query, "token")).toEqual({ ok: true, challenge: "42" });
  });

  it("refuses a wrong token, another mode, a missing challenge, and an unconfigured token", () => {
    expect(verifyMetaSubscription({ ...query, "hub.verify_token": "tokem" }, "token")).toEqual({ ok: false });
    expect(verifyMetaSubscription({ ...query, "hub.mode": "unsubscribe" }, "token")).toEqual({ ok: false });
    expect(verifyMetaSubscription({ ...query, "hub.challenge": undefined }, "token")).toEqual({ ok: false });
    expect(verifyMetaSubscription(query, "")).toEqual({ ok: false });
  });
});

describe("the payload parser", () => {
  const parse = (raw: string) => parseWhatsAppPayload(JSON.parse(raw) as unknown);

  it("reads a text message with its account, sender, name, id and time", () => {
    expect(parse(textMessage("Oi", { id: "wamid.1" }))).toEqual([
      {
        type: "message",
        accountId: PHONE_NUMBER_ID,
        contactId: CONTACT,
        contactName: "Ana Souza",
        externalId: "wamid.1",
        sentAt: NOW,
        content: { kind: "TEXT", text: "Oi" },
        optOut: false,
      },
    ]);
  });

  it("reads button and list replies, and an audio's media id", () => {
    expect(parse(buttonReply("yes", "Sim"))[0]).toMatchObject({ content: { kind: "INTERACTIVE", replyId: "yes", title: "Sim" } });
    expect(parse(listReply("row-2", "Retirada"))[0]).toMatchObject({ content: { kind: "INTERACTIVE", replyId: "row-2", title: "Retirada" } });
    expect(parse(voiceNote())[0]).toMatchObject({
      content: { kind: "AUDIO", mediaId: "1234567890123456", mimeType: "audio/ogg; codecs=opus" },
    });
  });

  it("flags an opt-out keyword, typed or tapped", () => {
    expect(parse(textMessage("Párar"))[0]).toMatchObject({ optOut: true });
    expect(parse(buttonReply("stop", "STOP"))[0]).toMatchObject({ optOut: true });
    expect(parseWhatsAppPayload(JSON.parse(textMessage("BASTA")) as unknown, { optOutKeywords: ["basta"] })[0]).toMatchObject({ optOut: true });
  });

  it("reads statuses with their error, and Meta's opt-out signal", () => {
    expect(parse(statusUpdate("wamid.X", "delivered"))).toEqual([
      { type: "status", accountId: PHONE_NUMBER_ID, externalId: "wamid.X", status: "DELIVERED", at: NOW, contactId: CONTACT, error: null },
    ]);
    expect(parse(statusUpdate("wamid.X", "failed"))[0]).toMatchObject({ status: "FAILED", error: "131047: Re-engagement message" });
    expect(parse(userPreferenceStop())).toEqual([{ type: "opt_out", accountId: PHONE_NUMBER_ID, contactId: CONTACT, at: NOW }]);
  });

  it("skips what it cannot key on, and anything that is not a WhatsApp business payload", () => {
    const broken = JSON.parse(textMessage("Oi")) as { entry: { changes: { value: { messages: Record<string, unknown>[] } }[] }[] };
    delete broken.entry[0]!.changes[0]!.value.messages[0]!.timestamp;
    expect(parseWhatsAppPayload(broken)).toEqual([]);
    expect(parseWhatsAppPayload({ object: "page", entry: [] })).toEqual([]);
    expect(parseWhatsAppPayload(null)).toEqual([]);
    expect(parse(statusUpdate("wamid.X", "deleted" as "sent"))).toEqual([]);
  });

  it("offers the receipts on their own, for a host that sends some other way", () => {
    const payload = JSON.parse(statusUpdate("wamid.Y", "read")) as unknown;
    expect(parseWhatsAppStatuses(payload)).toEqual([expect.objectContaining({ externalId: "wamid.Y", status: "READ" })]);
    expect(parseWhatsAppStatuses(JSON.parse(textMessage("Oi")) as unknown)).toEqual([]);
  });
});

describe("the opt-out keywords", () => {
  it.each([
    ["PARAR", true],
    ["parar", true],
    ["Párar", true],
    ["  sair\n", true],
    ["Stop", true],
    ["cancelar", true],
    ["parar de enviar", false],
    ["PARAR!", false],
    ["", false],
    ["quero cancelar", false],
  ])("%j is an opt-out: %s", (text, expected) => {
    expect(isOptOutText(text)).toBe(expected);
  });
});

describe("Embedded Signup", () => {
  const app = { appId: "app-1", appSecret: APP_SECRET };

  it("exchanges the code for a business token", async () => {
    const { graph, calls } = scriptedGraph({
      "oauth/access_token": { status: 200, body: { access_token: "EAAG-new", token_type: "bearer" } },
    });
    await expect(exchangeSignupCode(graph, { ...app, code: "AQB-code" })).resolves.toEqual({ accessToken: "EAAG-new" });

    const url = new URL(calls[0]!.url);
    expect(url.origin + url.pathname).toBe("https://graph.example.test/v23.0/oauth/access_token");
    expect(Object.fromEntries(url.searchParams)).toEqual({ client_id: "app-1", client_secret: APP_SECRET, code: "AQB-code" });
  });

  it("throws Meta's error code when the exchange is refused, and when no token comes back", async () => {
    const refused = scriptedGraph({
      "oauth/access_token": { status: 400, body: { error: { message: "This authorization code has expired.", code: 100 } } },
    });
    await expect(exchangeSignupCode(refused.graph, { ...app, code: "old" })).rejects.toMatchObject({ name: "GraphError", code: "100", status: 400 });
    const empty = scriptedGraph({ "oauth/access_token": { status: 200, body: {} } });
    await expect(exchangeSignupCode(empty.graph, { ...app, code: "x" })).rejects.toBeInstanceOf(GraphError);
  });

  it("reads the granted WABA and its phone numbers, and subscribes the app to it", async () => {
    const meta = scriptedGraph({
      debug_token: {
        status: 200,
        body: {
          data: {
            app_id: "app-1",
            granular_scopes: [
              { scope: "business_management", target_ids: ["biz-1"] },
              { scope: "whatsapp_business_management", target_ids: [WABA_ID] },
              { scope: "whatsapp_business_messaging", target_ids: [WABA_ID] },
            ],
          },
        },
      },
      [`${WABA_ID}/phone_numbers`]: {
        status: 200,
        body: { data: [{ id: PHONE_NUMBER_ID, display_phone_number: "+55 11 3000-0000", verified_name: "Ana Doces" }] },
      },
      [`${WABA_ID}/subscribed_apps`]: { status: 200, body: { success: true } },
    });

    await expect(readSignupAccounts(meta.graph, { ...app, accessToken: "EAAG-new" })).resolves.toEqual([
      { wabaId: WABA_ID, phoneNumbers: [{ id: PHONE_NUMBER_ID, displayPhoneNumber: "+55 11 3000-0000", verifiedName: "Ana Doces" }] },
    ]);
    await expect(subscribeAppToWaba(meta.graph, { wabaId: WABA_ID, accessToken: "EAAG-new" })).resolves.toBeUndefined();

    expect(meta.calls.map((call) => `${call.method} ${new URL(call.url).pathname}`)).toEqual([
      "GET /v23.0/debug_token",
      `GET /v23.0/${WABA_ID}/phone_numbers`,
      `POST /v23.0/${WABA_ID}/subscribed_apps`,
    ]);
    expect(meta.calls[0]!.headers.authorization).toBe(`Bearer app-1|${APP_SECRET}`);
    expect(meta.calls[1]!.headers.authorization).toBe("Bearer EAAG-new");
    for (const call of meta.calls.slice(1)) expect(call.url).not.toContain("EAAG-new");
  });
});
