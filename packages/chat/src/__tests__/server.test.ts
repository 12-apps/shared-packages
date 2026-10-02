import { describe, expect, it, vi } from "vitest";

import type { ChatThreadPayload, ChatWireMessage } from "../core/types";
import { ChatConfigError } from "../core/errors";
import { createApiChat, createChatReads, PT_BR_CHAT_SERVER_COPY } from "../server/index";
import type { ChatAccess, ChatResponse, ChatServerConfig } from "../server/context";
import { EN_US_CHAT_SERVER_COPY } from "../server/en-US";
import { configWith, ROLES, seat } from "./fixtures";

/**
 * The routes: who sees a thread is the host's `authorize`; everything after
 * that — the write window, the role's content rules, the rate limit, what
 * crosses the wire — is the package's, and is pinned here.
 */

type Config = ChatServerConfig<ChatAccess | null>;

/** A ticking clock, so messages and read markers order like real time. */
function ticking(start = Date.parse("2026-10-02T12:00:00.000Z")): () => Date {
  const tick = vi.fn<() => Date>();
  for (let step = 1; step <= 100; step += 1) tick.mockReturnValueOnce(new Date(start + step * 1000));
  return tick;
}

/** The `{ data }` a 2xx answers with. */
function dataOf<T>(response: ChatResponse): T {
  return (response.body as { data: T }).data;
}

function api(config: Config) {
  const { routes } = createApiChat(config);
  const call = (method: "GET" | "POST", path: string, actor: ChatAccess | null, body?: unknown, locale?: string) => {
    const route = routes.find((candidate) => candidate.method === method && candidate.path === path);
    if (!route) throw new Error(`no route ${method} ${path}`);
    return route.handle({ actor, params: {}, query: {}, body, locale });
  };
  return {
    read: (actor: ChatAccess | null, locale?: string) => call("GET", "/", actor, undefined, locale),
    send: (actor: ChatAccess | null, body: unknown, locale?: string) => call("POST", "/messages", actor, body, locale),
    markRead: (actor: ChatAccess | null, body: unknown = {}) => call("POST", "/read", actor, body),
  };
}

const client = seat();
const agent = seat({ role: "agent", authorId: "u-agent", readerId: "u-agent" });
const teamMember = (id: string) => seat({ role: "team", authorId: id, readerId: "team" });

describe("reading a thread", () => {
  it("answers 404 with the host's sentence when authorize finds no place for the caller", async () => {
    const { config } = configWith();
    const response = await api(config).read(null);
    expect(response).toEqual({ status: 404, body: { error: "not_found", message: EN_US_CHAT_SERVER_COPY.notFound } });
  });

  it("tells the caller what it may do, and reading never creates the thread", async () => {
    const { config, db } = configWith();
    const response = await api(config).read(agent);
    expect(response.status).toBe(200);
    const payload = dataOf<ChatThreadPayload>(response);
    expect(payload.thread).toEqual({
      me: { role: "agent", label: "Agent" },
      canWrite: true,
      freeText: true,
      maxLength: 160,
      quickReplies: ROLES.agent?.quickReplies,
    });
    expect(payload.messages).toEqual([]);
    expect(payload.unread).toBe(0);
    expect(db.threads).toHaveLength(0);
    expect(dataOf(await api(config).markRead(agent))).toEqual({ unread: 0 });
    expect(db.threads).toHaveLength(0);
    expect(db.markers).toHaveLength(0);
  });

  it("shows every author only by role label — no person id ever crosses the wire", async () => {
    const { config } = configWith({ clock: ticking() });
    const chat = api(config);
    await chat.send(client, { body: "Hello" });
    await chat.send(agent, { body: "Hi there" });
    const payload = dataOf<ChatThreadPayload>(await chat.read(client));
    expect(payload.messages.map((m) => [m.label, m.body, m.mine])).toEqual([
      ["Client", "Hello", true],
      ["Agent", "Hi there", false],
    ]);
    expect(JSON.stringify(payload)).not.toContain("u-agent");
    expect(JSON.stringify(payload)).not.toContain("u-client");
  });

  it("counts a shared role's messages as every member's own", async () => {
    const { config } = configWith({ clock: ticking() });
    const chat = api(config);
    await chat.send(teamMember("staff-1"), { body: "We are on it" });
    const payload = dataOf<ChatThreadPayload>(await chat.read(teamMember("staff-2")));
    expect(payload.messages[0]?.mine).toBe(true);
  });

  it("keeps a person's own messages theirs, not a successor's in the same role", async () => {
    const { config } = configWith({ clock: ticking() });
    const chat = api(config);
    await chat.send(agent, { body: "On the way" });
    const successor = seat({ role: "agent", authorId: "u-agent-2", readerId: "u-agent-2" });
    const payload = dataOf<ChatThreadPayload>(await chat.read(successor));
    expect(payload.messages[0]?.mine).toBe(false);
  });

  it("answers in the reader's language when the host passes a resolver", async () => {
    const { config } = configWith({
      copy: ({ locale }) => (locale === "pt-BR" ? PT_BR_CHAT_SERVER_COPY : EN_US_CHAT_SERVER_COPY),
    });
    const response = await api(config).read(null, "pt-BR");
    expect((response.body as { message: string }).message).toBe(PT_BR_CHAT_SERVER_COPY.notFound);
  });
});

describe("sending", () => {
  it("stores the message, stamps the thread and answers it as the caller's own", async () => {
    const { config, db } = configWith();
    const response = await api(config).send(client, { body: "  Gate 12, block B  " });
    expect(response.status).toBe(201);
    const message = dataOf<{ message: ChatWireMessage }>(response).message;
    expect(message).toMatchObject({ role: "client", label: "Client", mine: true, body: "Gate 12, block B" });
    expect(db.messages[0]).toMatchObject({ authorId: "u-client", authorRole: "client", quickKey: null });
    expect(db.threads[0]?.lastMessageAt?.toISOString()).toBe("2026-10-02T12:00:00.000Z");
  });

  it("refuses a caller who may only read", async () => {
    const { config, db } = configWith();
    const response = await api(config).send(seat({ canWrite: false }), { body: "late" });
    expect(response).toEqual({ status: 403, body: { error: "closed", message: EN_US_CHAT_SERVER_COPY.closed } });
    expect(db.messages).toHaveLength(0);
  });

  it.each([
    ["Call me on 11 98765-4321"],
    ["ana@example.com"],
    ["example.com/me"],
    ["find me @ana.s"],
  ])("refuses contact information from a role that blocks it: %s", async (body) => {
    const { config, db } = configWith();
    const response = await api(config).send(agent, { body });
    expect(response).toEqual({ status: 422, body: { error: "contact_info", message: EN_US_CHAT_SERVER_COPY.contactInfo } });
    expect(db.messages).toHaveLength(0);
  });

  it("lets a role with no block send the same line", async () => {
    const { config } = configWith();
    expect((await api(config).send(client, { body: "Call me on 11 98765-4321" })).status).toBe(201);
  });

  it("sends a quick reply as the host's own words, past the content filter", async () => {
    const { config, db } = configWith();
    const response = await api(config).send(agent, { quickReply: "arrived" });
    expect(dataOf<{ message: ChatWireMessage }>(response).message.body).toBe("I have arrived.");
    expect(db.messages[0]?.quickKey).toBe("arrived");
  });

  it("refuses a quick reply the role does not offer", async () => {
    const { config } = configWith();
    const response = await api(config).send(client, { quickReply: "arrived" });
    expect(response.body).toEqual({ error: "unknown_quick_reply", message: EN_US_CHAT_SERVER_COPY.unknownQuickReply });
  });

  it("refuses free text from a quick-replies-only role", async () => {
    const roles = { ...ROLES, agent: { ...ROLES.agent!, freeText: false } };
    const { config } = configWith({ roles });
    const response = await api(config).send(agent, { body: "hello" });
    expect(response.body).toEqual({ error: "free_text_disabled", message: EN_US_CHAT_SERVER_COPY.freeTextDisabled });
  });

  it("refuses an empty, an over-long, and a malformed body", async () => {
    const { config } = configWith();
    const chat = api(config);
    expect((await chat.send(client, { body: "   " })).body).toEqual({ error: "empty", message: EN_US_CHAT_SERVER_COPY.empty });
    expect((await chat.send(agent, { body: "x".repeat(161) })).body).toEqual({
      error: "too_long",
      message: "A message can be up to 160 characters.",
    });
    expect((await chat.send(client, "just a string")).body).toEqual({
      error: "invalid_body",
      message: EN_US_CHAT_SERVER_COPY.invalidBody,
    });
    expect((await chat.send(client, { body: 42 })).status).toBe(422);
  });

  it("limits how fast one author may write, per thread", async () => {
    const { config } = configWith();
    const chat = api(config);
    for (let i = 0; i < 3; i += 1) expect((await chat.send(agent, { body: `msg ${i}` })).status).toBe(201);
    const response = await chat.send(agent, { body: "one more" });
    expect(response).toEqual({ status: 429, body: { error: "rate_limited", message: EN_US_CHAT_SERVER_COPY.rateLimited } });
    // Another thread is another budget.
    expect((await chat.send({ ...agent, threadKey: "job:2" }, { body: "elsewhere" })).status).toBe(201);
  });

  it("tells the host about the committed message, and a failing hook never fails the send", async () => {
    const onMessage = vi.fn().mockRejectedValue(new Error("push provider down"));
    const { config } = configWith({ onMessage });
    const response = await api(config).send(agent, { quickReply: "on-the-way" });
    expect(response.status).toBe(201);
    expect(onMessage).toHaveBeenCalledWith({
      tenantId: "t1",
      threadKey: "job:1",
      message: expect.objectContaining({ role: "agent", label: "Agent", authorId: "u-agent", body: "On my way." }),
    });
  });
});

describe("unread and read markers", () => {
  it("counts other roles' messages since the reader's marker, and the read route clears it", async () => {
    const { config } = configWith({ clock: ticking() });
    const chat = api(config);
    await chat.send(agent, { body: "Arriving" });
    await chat.send(client, { body: "Thanks" });
    await chat.send(agent, { quickReply: "arrived" });
    expect(dataOf<ChatThreadPayload>(await chat.read(client)).unread).toBe(2);
    expect(dataOf(await chat.markRead(client))).toEqual({ unread: 0 });
    expect(dataOf<ChatThreadPayload>(await chat.read(client)).unread).toBe(0);
    await chat.send(agent, { body: "Downstairs" });
    expect(dataOf<ChatThreadPayload>(await chat.read(client)).unread).toBe(1);
  });

  it("gives a host's list its unread badges in one call", async () => {
    const { config, db } = configWith({ clock: ticking() });
    const chat = api(config);
    await chat.send(agent, { body: "First" });
    await chat.send({ ...agent, threadKey: "job:2" }, { body: "Second" });
    await chat.markRead({ ...client, threadKey: "job:2" });
    const reads = createChatReads({ db: async () => db });
    const counts = await reads.unreadCounts({
      tenantId: "t1",
      threadKeys: ["job:1", "job:2", "job:3"],
      role: "client",
      readerId: "u-client",
    });
    expect(counts).toEqual({ "job:1": 1, "job:2": 0, "job:3": 0 });
    expect(await reads.unreadCounts({ tenantId: "t1", threadKeys: [], role: "client", readerId: "u-client" })).toEqual({});
  });
});

describe("assembly", () => {
  it.each([
    [{ db: undefined }, /db must be a function/],
    [{ authorize: undefined }, /authorize is required/],
    [{ roles: {} }, /at least one role/],
    [{ roles: { a: { ...ROLES.client!, label: " " } } }, /roles\.a\.label/],
    [{ roles: { a: { ...ROLES.client!, maxLength: 0 } } }, /maxLength/],
    [{ roles: { a: { ...ROLES.client!, blockContact: ["fax"] } } }, /blockContact/],
    [{ roles: { a: { ...ROLES.client!, freeText: false, quickReplies: [] } } }, /could never write/],
    [{ roles: { a: { ...ROLES.agent!, quickReplies: [{ key: "x", text: "a" }, { key: "x", text: "b" }] } } }, /repeats "x"/],
    [{ roles: { a: { ...ROLES.client!, rateLimit: { max: 0, windowMs: 1 } } } }, /rateLimit/],
    [{ copy: { ...EN_US_CHAT_SERVER_COPY, closed: "" } }, /missing: closed/],
    [{ historyLimit: 0 }, /historyLimit/],
  ])("refuses a miswired config at the call site (%#)", (overrides, message) => {
    const { config } = configWith();
    expect(() => createApiChat({ ...config, ...(overrides as Partial<Config>) })).toThrow(ChatConfigError);
    expect(() => createApiChat({ ...config, ...(overrides as Partial<Config>) })).toThrow(message);
  });

  it("fails loudly when authorize answers a role the config never declared", async () => {
    const { config } = configWith();
    await expect(api(config).read(seat({ role: "stranger" }))).rejects.toThrow(/roles does not declare/);
  });
});

describe("reading order and history", () => {
  it("keeps one order for messages in the same millisecond, and the newest when it trims", async () => {
    const { config } = configWith({ historyLimit: 2 });
    const { read, send } = api(config);
    for (const body of ["one", "two", "three"]) await send(client, { body });
    expect(dataOf<ChatThreadPayload>(await read(client)).messages.map((m) => m.body)).toEqual(["two", "three"]);
  });

  it("falls back to the configured words when the resolver has none for the reader's locale", async () => {
    const { config } = configWith({
      copy: ({ locale }) => (locale === "xx" ? (undefined as never) : EN_US_CHAT_SERVER_COPY),
    });
    const response = await api(config).read(null, "xx");
    expect(response.body).toEqual({ error: "not_found", message: EN_US_CHAT_SERVER_COPY.notFound });
  });
});

describe("the first message of a thread", () => {
  it("survives losing the race to create the thread", async () => {
    const { config, db } = configWith();
    const upsert = db.chatThread.upsert.bind(db.chatThread);
    // Another request wins the insert between this one's check and its write.
    db.chatThread.upsert = vi.fn(async (args) => {
      await upsert(args);
      throw new Error("Unique constraint failed");
    });
    expect((await api(config).send(client, { body: "Hello" })).status).toBe(201);
    expect(db.threads).toHaveLength(1);
  });

  it("still fails when the thread is not there after all", async () => {
    const { config, db } = configWith();
    db.chatThread.upsert = vi.fn().mockRejectedValue(new Error("connection lost"));
    await expect(api(config).send(client, { body: "Hello" })).rejects.toThrow(/connection lost/);
  });
});

describe("what the read route marks", () => {
  const at = (seconds: number) => new Date(Date.parse("2026-10-02T12:00:00.000Z") + seconds * 1000).toISOString();

  it("marks up to the newest message the reader was shown, never one that arrived after", async () => {
    const { config } = configWith({ clock: ticking() });
    const { markRead, read, send } = api(config);
    await send(agent, { body: "Arriving" }); // t+1
    const shown = dataOf<ChatThreadPayload>(await read(client)).messages; // t+2
    await send(agent, { body: "Downstairs" }); // t+3, not yet on the reader's screen
    expect(dataOf(await markRead(client, { upTo: shown.at(-1)?.createdAt }))).toEqual({ unread: 1 });
  });

  it("never moves the marker backwards, and never past now", async () => {
    const { config, db } = configWith({ clock: ticking() });
    const { markRead, send } = api(config);
    await send(agent, { body: "Arriving" }); // t+1
    await markRead(client, { upTo: at(1) }); // t+2
    await markRead(client, { upTo: at(0) }); // a slow tab, older screen
    expect(db.markers[0]?.lastReadAt.toISOString()).toBe(at(1));
    await markRead(client, { upTo: at(3600) }); // t+4: clamped
    expect(db.markers[0]?.lastReadAt.toISOString()).toBe(at(4));
  });

  it.each([[{}], [{ upTo: "not a date" }], [{ upTo: 42 }], [null]])("reads a missing or broken upTo as now: %j", async (body) => {
    const { config, db } = configWith({ clock: ticking() });
    const { markRead, send } = api(config);
    await send(agent, { body: "Arriving" }); // t+1
    expect(dataOf(await markRead(client, body))).toEqual({ unread: 0 });
    expect(db.markers[0]?.lastReadAt.toISOString()).toBe(at(2));
  });

  it("moves one marker for a shared role, so every member reads as one", async () => {
    const { config } = configWith({ clock: ticking() });
    const { send, read, markRead } = api(config);
    const [first, second] = [teamMember("staff-1"), teamMember("staff-2")];
    await send(client, { body: "Where is it?" });
    expect(dataOf<ChatThreadPayload>(await read(second)).unread).toBe(1);
    await markRead(first);
    expect(dataOf<ChatThreadPayload>(await read(second)).unread).toBe(0);
  });

  it("never counts the reader's own role as unread in a host's list", async () => {
    const { config, db } = configWith({ clock: ticking() });
    await api(config).send(client, { body: "Hello" });
    const reads = createChatReads({ db: async () => db });
    expect(await reads.unreadCounts({ tenantId: "t1", threadKeys: ["job:1"], role: "client", readerId: "u-client" })).toEqual({
      "job:1": 0,
    });
  });
});

describe("the content rules and the people who probe them", () => {
  it("catches a number split across the author's own messages", async () => {
    const { config, db } = configWith({ clock: ticking(), roles: { ...ROLES, agent: { ...ROLES.agent!, rateLimit: { max: 10, windowMs: 60_000 } } } });
    const { send } = api(config);
    expect((await send(agent, { body: "98765" })).status).toBe(201);
    const refused = await send(agent, { body: "4321" });
    expect(refused.body).toEqual({ error: "contact_info", message: EN_US_CHAT_SERVER_COPY.contactInfo });
    expect(db.messages).toHaveLength(1);
  });

  it("spends a rate slot on every refused attempt, and tells the host who keeps trying", async () => {
    const onRefused = vi.fn();
    const { config } = configWith({ onRefused });
    const { send } = api(config);
    for (let i = 0; i < 3; i += 1) expect((await send(agent, { body: `ana${i}@example.com` })).status).toBe(422);
    expect((await send(agent, { body: "On my way" })).status).toBe(429);
    await vi.waitFor(() => expect(onRefused).toHaveBeenCalledTimes(3));
    expect(onRefused).toHaveBeenCalledWith({
      tenantId: "t1",
      threadKey: "job:1",
      role: "agent",
      authorId: "u-agent",
      code: "contact_info",
      kinds: expect.arrayContaining(["email"]),
    });
  });

  it("does not let ids that contain the old separator share a budget", async () => {
    const { config } = configWith();
    const { send } = api(config);
    const first = { ...agent, tenantId: "a|b", threadKey: "c" };
    const second = { ...agent, tenantId: "a", threadKey: "b|c" };
    for (let i = 0; i < 3; i += 1) expect((await send(first, { body: `msg ${i}` })).status).toBe(201);
    expect((await send(second, { body: "mine" })).status).toBe(201);
  });

  it("reads a null quick reply as absent, and an invisible-only body as empty", async () => {
    const { config } = configWith();
    const { send } = api(config);
    expect((await send(client, { body: "hi", quickReply: null })).status).toBe(201);
    expect((await send(client, { body: "​‍⁠" })).body).toEqual({ error: "empty", message: EN_US_CHAT_SERVER_COPY.empty });
  });
});

describe("the host's hooks", () => {
  it("answers the send without waiting for onMessage, and passes the quick reply key", async () => {
    const onMessage = vi.fn(() => new Promise<void>(() => undefined));
    const { config } = configWith({ onMessage });
    const response = await api(config).send(agent, { quickReply: "arrived" });
    expect(response.status).toBe(201);
    expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ message: expect.objectContaining({ quickKey: "arrived" }) }));
  });

  it("reports a failing hook to onError, naming it", async () => {
    const failure = new Error("push provider down");
    const onError = vi.fn();
    const { config } = configWith({ onMessage: vi.fn().mockRejectedValue(failure), onError });
    expect((await api(config).send(client, { body: "Hello" })).status).toBe(201);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(failure, { hook: "onMessage" }));
  });

  it.each([
    [{ onMessage: "notify" }, /onMessage must be a function/],
    [{ onRefused: 1 }, /onRefused must be a function/],
    [{ onError: {} }, /onError must be a function/],
    [{ contactLookback: { messages: 0, windowMs: 1 } }, /contactLookback/],
  ])("refuses a hook or lookback that could never run (%#)", (overrides, message) => {
    const { config } = configWith();
    expect(() => createApiChat({ ...config, ...(overrides as unknown as Partial<Config>) })).toThrow(message);
  });
});
