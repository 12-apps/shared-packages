import { describe, expect, it, vi } from "vitest";

import type { ModelClient } from "../client";
import { WITH_PERSON, createSupportLadder } from "../support/ladder";
import type { ToolCall } from "../types";
import { turnResult } from "./fake-adapter";
import { memoryState } from "./support-helpers";

/** A promise the test resolves when it chooses, so the interleaving is explicit, not timed. */
function gate() {
  const handle: { open: () => void } = { open: () => undefined };
  const opened = new Promise<void>((resolve) => {
    handle.open = resolve;
  });
  return { opened, open: () => handle.open() };
}

/**
 * Escalates to a person at once on the message "person"; answers anything
 * else once `answers` opens. `asked` records every answer it was asked for.
 */
function client(answers: Promise<void> = Promise.resolve(), asked: string[] = []): ModelClient {
  return {
    provider: "p",
    model: "m",
    capabilities: ["chat"],
    supports: () => true,
    chat: async (request) => {
      const last = request.messages.at(-1);
      if (last?.role === "tool") return turnResult({ text: "" }, 0);
      const text = last && "text" in last ? last.text : "";
      if (text === "person") {
        const call: ToolCall = { id: "e", name: "escalate", input: { to: "person", reason: "asked" } };
        return turnResult({ toolCalls: [call] }, 0);
      }
      asked.push(text);
      await answers;
      return turnResult({ text: "answer" }, 0);
    },
  };
}

const base = { conversationId: "c1", transcript: [{ role: "user" as const, text: "hi" }], context: null, scope: "a" };

describe("support ladder: two messages of one conversation in flight", () => {
  it("a slow answer never pulls the conversation back down from the person", async () => {
    const state = memoryState([["c1", "small"]]);
    const handOff = vi.fn();
    const answers = gate();
    const subject = createSupportLadder({ tiers: [{ id: "small", client: client(answers.opened), instructions: "x" }], person: { handOff }, state });
    const slow = subject.handle({ ...base, message: "slow question" });
    const fast = await subject.handle({ ...base, message: "person" });
    answers.open();
    const late = await slow;
    expect(handOff).toHaveBeenCalledTimes(1);
    expect(state.levels.get("c1")).toBe(WITH_PERSON);
    expect(fast).toMatchObject({ kind: "person", handedOff: true });
    // The slow call finished after a person took over: no model reply is delivered.
    expect(late).toMatchObject({ kind: "person", handedOff: false, fromTier: null });
    expect(late.usage).toEqual([expect.objectContaining({ tier: "small", turns: 1 })]);
  });

  it("two concurrent escalations hand the conversation off once", async () => {
    const state = memoryState([["c1", "small"]]);
    const handing = gate();
    const handOff = vi.fn(() => handing.opened);
    const subject = createSupportLadder({ tiers: [{ id: "small", client: client(), instructions: "x" }], person: { handOff }, state });
    const both = Promise.all([subject.handle({ ...base, message: "person" }), subject.handle({ ...base, message: "person" })]);
    await vi.waitFor(() => expect(handOff).toHaveBeenCalled());
    handing.open();
    const results = await both;
    expect(handOff).toHaveBeenCalledTimes(1);
    expect(results.map((result) => result.kind === "person" && result.handedOff).sort()).toEqual([false, true]);
  });

  it("a tier answer never lowers a level another call raised", async () => {
    const state = memoryState([["c1", "small"]]);
    const answers = gate();
    const asked: string[] = [];
    const subject = createSupportLadder({
      tiers: [
        { id: "small", client: client(answers.opened, asked), instructions: "x" },
        { id: "capable", client: client(), instructions: "y" },
      ],
      person: { handOff: vi.fn() },
      state,
    });
    const slow = subject.handle({ ...base, message: "slow question" });
    await vi.waitFor(() => expect(asked).toEqual(["slow question"]));
    expect(await state.raise("c1", "small", "capable")).toBe(true);
    answers.open();
    await expect(slow).resolves.toMatchObject({ kind: "model", tier: "small", reply: "answer" });
    expect(state.levels.get("c1")).toBe("capable");
  });
});

describe("support ladder: the state port's atomic raise", () => {
  it("the in-memory port lets exactly one of many concurrent raises from the same level win", async () => {
    const state = memoryState([["c1", "small"]]);
    const outcomes = await Promise.all(Array.from({ length: 20 }, () => Promise.resolve().then(() => state.raise("c1", "small", WITH_PERSON))));
    expect(outcomes.filter(Boolean)).toHaveLength(1);
    expect(state.levels.get("c1")).toBe(WITH_PERSON);
  });

  it("a raise from a stale level changes nothing", async () => {
    const state = memoryState([["c1", "capable"]]);
    expect(await state.raise("c1", "small", WITH_PERSON)).toBe(false);
    expect(await state.raise("c1", null, "small")).toBe(false);
    expect(state.levels.get("c1")).toBe("capable");
    expect(await state.raise("c2", null, "small")).toBe(true);
  });

  it("re-reads and retries a raise that lost, and hands off once over a port whose reads lag", async () => {
    const real = memoryState([["c1", "small"]]);
    // The first four reads (each call's start, and each call's first raise) are stale.
    const get = vi.fn((id: string) => real.get(id));
    get.mockImplementationOnce(() => "small").mockImplementationOnce(() => "small").mockImplementationOnce(() => "small").mockImplementationOnce(() => "small");
    const raise = vi.fn((id: string, from: string | null, to: string) => real.raise(id, from, to));
    const handOff = vi.fn();
    const subject = createSupportLadder({ tiers: [{ id: "small", client: client(), instructions: "x" }], person: { handOff }, state: { get, raise } });
    await Promise.all([subject.handle({ ...base, message: "person" }), subject.handle({ ...base, message: "person" })]);
    expect(handOff).toHaveBeenCalledTimes(1);
    expect(raise.mock.results.map((result) => result.value)).toEqual([true, false]);
    expect(real.levels.get("c1")).toBe(WITH_PERSON);
  });

  it("refuses a port that keeps moving the level (state_conflict) rather than looping", async () => {
    const state = { get: () => "small", raise: () => false };
    const subject = createSupportLadder({ tiers: [{ id: "small", client: client(), instructions: "x" }], person: { handOff: vi.fn() }, state });
    await expect(subject.handle({ ...base, message: "person" })).rejects.toMatchObject({ code: "state_conflict" });
  });
});
