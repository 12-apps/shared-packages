import { describe, expect, it, vi } from "vitest";

import { SupportLadderError } from "../errors";
import type { SupportLadderOptions } from "../support/ladder";
import { WITH_PERSON, createSupportLadder } from "../support/ladder";
import type { ToolDefinition } from "../types";
import { escalate, memoryState, tierClient } from "./support-helpers";

type Script = Parameters<typeof tierClient>[1];

/** A two-tier helpdesk: a small tier, a capable tier, a person. */
function helpdesk(small: Script, capable: Script, overrides: Partial<SupportLadderOptions> = {}) {
  const smallTier = tierClient("small-provider", small);
  const capableTier = tierClient("capable-provider", capable);
  const handOff = vi.fn();
  const state = memoryState();
  const ladder = createSupportLadder({
    automation: {
      greeting: () => "Hi! Reply 1 for opening hours, 2 for a password reset.",
      match: (message) => (message.trim() === "1" ? { reply: "We are open 9 to 5." } : null),
    },
    tiers: [
      { id: "small", client: smallTier.client, instructions: "Answer simple helpdesk questions." },
      { id: "capable", client: capableTier.client, instructions: [{ text: "Resolve hard helpdesk cases.", cache: true }] },
    ],
    person: { handOff },
    state,
    ...overrides,
  });
  return { ladder, small: smallTier.calls, capable: capableTier.calls, handOff, state };
}

const later = [{ role: "user" as const, text: "hello" }, { role: "assistant" as const, text: "Hi!", toolCalls: [] }];

const request = (message: string, transcript = later) => ({ conversationId: "c1", message, transcript, context: { locale: "en" }, scope: "tenant-a" });

function escalateTool(definitions: ToolDefinition[] | undefined) {
  return definitions?.find((tool) => tool.name === "escalate");
}

describe("createSupportLadder: automation", () => {
  it("greets the first contact with no model call", async () => {
    const desk = helpdesk([{ text: "never" }], [{ text: "never" }]);
    const result = await desk.ladder.handle(request("hey", []));
    expect(result).toEqual({ kind: "automation", source: "greeting", reply: "Hi! Reply 1 for opening hours, 2 for a password reset.", usage: [], escalations: [] });
    expect(desk.small).toHaveLength(0);
    expect(desk.state.levels.size).toBe(0);
  });

  it("answers a recognised option with no model call", async () => {
    const desk = helpdesk([{ text: "never" }], [{ text: "never" }]);
    const result = await desk.ladder.handle(request("1"));
    expect(result).toMatchObject({ kind: "automation", source: "match", reply: "We are open 9 to 5." });
    expect(desk.small).toHaveLength(0);
    expect(desk.capable).toHaveLength(0);
  });
});

describe("createSupportLadder: model tiers", () => {
  it("lets the small tier answer, and records the tier it reached", async () => {
    const desk = helpdesk([{ text: "Use the reset link on the sign-in page." }], [{ text: "never" }]);
    const result = await desk.ladder.handle(request("How do I reset my password?"));
    expect(result).toMatchObject({ kind: "model", tier: "small", reply: "Use the reset link on the sign-in page.", escalations: [] });
    expect(desk.capable).toHaveLength(0);
    expect(desk.state.levels.get("c1")).toBe("small");
    expect(desk.small[0]?.request.messages.at(-1)).toEqual({ role: "user", text: "How do I reset my password?" });
  });

  it("escalates small to capable within the same call, on the same message", async () => {
    const desk = helpdesk([{ toolCalls: [escalate("next", "billing dispute")] }], [{ text: "I refunded the duplicate charge." }]);
    const result = await desk.ladder.handle(request("I was charged twice"));
    expect(result).toMatchObject({ kind: "model", tier: "capable", reply: "I refunded the duplicate charge." });
    expect(result.escalations).toEqual([{ from: "small", to: "capable", reason: "billing dispute" }]);
    expect(desk.capable[0]?.request.messages).toEqual([...later, { role: "user", text: "I was charged twice" }]);
    expect(desk.capable[0]?.request.system?.at(-1)?.text).toContain('"small" assistant');
    expect(desk.capable[0]?.request.system?.at(-1)?.text).toContain("billing dispute");
    expect(desk.small).toHaveLength(1);
    expect(desk.state.levels.get("c1")).toBe("capable");
  });

  it("escalates small straight to a person, with the reason and fromTier in the result and the handOff", async () => {
    const desk = helpdesk([{ toolCalls: [escalate("person", "asks for a human")] }], [{ text: "never" }]);
    const result = await desk.ladder.handle(request("Let me talk to someone"));
    expect(result).toMatchObject({ kind: "person", fromTier: "small", reason: "asks for a human", handedOff: true });
    expect(desk.capable).toHaveLength(0);
    expect(desk.handOff).toHaveBeenCalledTimes(1);
    expect(desk.handOff).toHaveBeenCalledWith({
      conversationId: "c1",
      conversation: [...later, { role: "user", text: "Let me talk to someone" }],
      reason: "asks for a human",
      fromTier: "small",
      scope: "tenant-a",
      context: { locale: "en" },
    });
    expect(desk.state.levels.get("c1")).toBe(WITH_PERSON);
  });

  it("lets the capable tier decide at once that only a person can handle it", async () => {
    const desk = helpdesk([{ toolCalls: [escalate("next", "legal question")] }], [{ toolCalls: [escalate("person", "needs a signed form")] }]);
    const result = await desk.ladder.handle(request("Can you change the contract?"));
    expect(result).toMatchObject({ kind: "person", fromTier: "capable", reason: "needs a signed form", handedOff: true });
    expect(result.escalations).toEqual([
      { from: "small", to: "capable", reason: "legal question" },
      { from: "capable", to: WITH_PERSON, reason: "needs a signed form" },
    ]);
    expect(desk.handOff).toHaveBeenCalledWith(expect.objectContaining({ fromTier: "capable", reason: "needs a signed form" }));
  });

  it("lets the capable tier answer, then escalate to a person on a later message", async () => {
    const desk = helpdesk(
      [{ toolCalls: [escalate("next", "account locked")] }],
      [{ text: "I unlocked it." }, { toolCalls: [escalate("person", "wants compensation")] }],
    );
    expect(await desk.ladder.handle(request("My account is locked"))).toMatchObject({ kind: "model", tier: "capable" });
    const second = await desk.ladder.handle(request("I want compensation"));
    expect(second).toMatchObject({ kind: "person", fromTier: "capable", reason: "wants compensation" });
    expect(desk.small).toHaveLength(1);
    expect(desk.capable).toHaveLength(2);
  });

  it("keeps a conversation at the tier it reached on the next message, skipping automation", async () => {
    const desk = helpdesk([{ text: "never" }], [{ text: "Still on it." }]);
    desk.state.levels.set("c1", "capable");
    const result = await desk.ladder.handle(request("1"));
    expect(result).toMatchObject({ kind: "model", tier: "capable", reply: "Still on it." });
    expect(desk.small).toHaveLength(0);
  });

  it("never calls a model, nor hands off again, once a person has the conversation", async () => {
    const desk = helpdesk([{ text: "never" }], [{ text: "never" }]);
    desk.state.levels.set("c1", WITH_PERSON);
    const result = await desk.ladder.handle(request("Are you there?"));
    expect(result).toEqual({ kind: "person", fromTier: null, reason: null, handedOff: false, usage: [], escalations: [] });
    expect(desk.small).toHaveLength(0);
    expect(desk.capable).toHaveLength(0);
    expect(desk.handOff).not.toHaveBeenCalled();
  });
});

describe("createSupportLadder: refusals and empty turns", () => {
  it("treats a refusal as escalation to the next tier, and to a person on the last", async () => {
    const desk = helpdesk([{ stopReason: "refusal" }], [{ stopReason: "refusal" }]);
    const result = await desk.ladder.handle(request("something odd"));
    expect(result).toMatchObject({ kind: "person", fromTier: "capable", reason: "refused" });
    expect(result.escalations).toEqual([
      { from: "small", to: "capable", reason: "refused" },
      { from: "capable", to: WITH_PERSON, reason: "refused" },
    ]);
  });

  it("escalates a turn with no words", async () => {
    const desk = helpdesk([{ text: "  " }], [{ text: "Here you go." }]);
    const result = await desk.ladder.handle(request("?"));
    expect(result).toMatchObject({ kind: "model", tier: "capable" });
    expect(result.escalations[0]?.reason).toBe("no_answer");
  });
});

describe("createSupportLadder: usage and the escalate tool", () => {
  it("reports each tier's usage separately, and meters each turn live", async () => {
    const onUsage = vi.fn();
    const desk = helpdesk([{ toolCalls: [escalate("next", "hard")] }], [{ text: "done" }], { onUsage });
    const result = await desk.ladder.handle(request("hard one"));
    expect(result.usage).toEqual([
      { tier: "small", turns: 1, usage: { inputTokens: 10, cacheCreationTokens: 1, cacheReadTokens: 100, outputTokens: 5 } },
      { tier: "capable", turns: 1, usage: { inputTokens: 10, cacheCreationTokens: 1, cacheReadTokens: 100, outputTokens: 5 } },
    ]);
    expect(onUsage.mock.calls.map(([tier, , turn]) => [tier, turn])).toEqual([["small", 1], ["capable", 1]]);
  });

  it('offers "next" on every tier but the last', async () => {
    const desk = helpdesk([{ toolCalls: [escalate("next", "x")] }], [{ text: "ok" }]);
    await desk.ladder.handle(request("hi"));
    const enumOf = (tool: ToolDefinition | undefined) => (tool?.inputSchema.properties as { to: { enum: string[] } }).to.enum;
    expect(enumOf(escalateTool(desk.small[0]?.request.tools))).toEqual(["next", "person"]);
    expect(enumOf(escalateTool(desk.capable[0]?.request.tools))).toEqual(["person"]);
  });

  it('answers "next" from the last tier with an error the model can recover from', async () => {
    const desk = helpdesk([{ toolCalls: [escalate("next", "x")] }], [{ toolCalls: [escalate("next", "again")] }, { text: "Fine, here it is." }]);
    const result = await desk.ladder.handle(request("hi"));
    expect(result).toMatchObject({ kind: "model", tier: "capable", reply: "Fine, here it is." });
    expect(desk.capable[1]?.request.messages.at(-1)).toMatchObject({ role: "tool", results: [{ name: "escalate", isError: true }] });
    expect(desk.handOff).not.toHaveBeenCalled();
  });
});

describe("createSupportLadder: refused configurations", () => {
  const base = { person: { handOff: () => undefined }, state: memoryState() };
  const tier = (id: string) => ({ id, client: tierClient(`p-${id}`, [{ text: "x" }]).client, instructions: "x" });

  it("refuses an empty tier list", () => {
    expect(() => createSupportLadder({ ...base, tiers: [] })).toThrow(expect.objectContaining({ code: "empty_tiers" }));
  });

  it("refuses a tier listed twice, which would escalate to itself or backwards", () => {
    expect(() => createSupportLadder({ ...base, tiers: [tier("a"), tier("b"), tier("a")] })).toThrow(SupportLadderError);
    expect(() => createSupportLadder({ ...base, tiers: [tier("a"), tier("a")] })).toThrow(expect.objectContaining({ code: "escalation_loop" }));
  });

  it("refuses a tier named like the person's level", () => {
    expect(() => createSupportLadder({ ...base, tiers: [tier(WITH_PERSON)] })).toThrow(expect.objectContaining({ code: "reserved_tier" }));
  });

  it("refuses a level from the state port that is no tier", async () => {
    const state = memoryState([["c1", "gone"]]);
    const ladder = createSupportLadder({ ...base, state, tiers: [tier("a")] });
    await expect(ladder.handle(request("hi"))).rejects.toMatchObject({ code: "unknown_tier" });
  });

  it("accepts client options in place of a client", () => {
    expect(() =>
      createSupportLadder({ ...base, tiers: [{ id: "a", client: { provider: "anthropic", credentials: { kind: "apiKey", apiKey: "k" } }, instructions: "x" }] }),
    ).not.toThrow();
  });
});
