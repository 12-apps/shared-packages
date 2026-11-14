import { describe, expect, it, vi } from "vitest";

import { createAdapterRegistry } from "../adapter";
import { createModelClient } from "../client";
import { RefusalError } from "../errors";
import { ensureNotRefused, runToolLoop } from "../loop";
import type { Usage } from "../types";
import { scriptedAdapter, turnResult } from "./fake-adapter";
import { sampleRequest } from "./helpers";

function setup(script: Parameters<typeof scriptedAdapter>[0]) {
  const { adapter, calls } = scriptedAdapter(script);
  const client = createModelClient({ provider: "fake", credentials: { kind: "apiKey", apiKey: "k" }, registry: createAdapterRegistry([adapter]) });
  return { client, calls };
}

const call = (id: string) => ({ id, name: "search_menu", input: { query: id, limit: null } });

describe("runToolLoop", () => {
  it("runs tools until the model stops calling them, reporting every turn's usage", async () => {
    const { client, calls } = setup([{ toolCalls: [call("a"), call("b")] }, { toolCalls: [call("c")] }, { text: "done" }]);
    const seen: Array<[Usage, number]> = [];
    const search = vi.fn((input: unknown) => `found ${(input as { query: string }).query}`);
    const result = await runToolLoop({
      client,
      request: sampleRequest({ messages: [{ role: "user", text: "go" }] }),
      executors: { search_menu: search },
      onUsage: (usage, turn) => {
        seen.push([usage, turn]);
      },
    });
    expect(result.status).toBe("completed");
    expect(result.turns).toBe(3);
    expect(result.final.text).toBe("done");
    expect(search).toHaveBeenCalledTimes(3);
    expect(seen.map(([, turn]) => turn)).toEqual([1, 2, 3]);
    expect(seen.map(([usage]) => usage.inputTokens)).toEqual([10, 20, 30]);
    expect(result.usage).toEqual({ inputTokens: 60, cacheCreationTokens: 3, cacheReadTokens: 300, outputTokens: 15 });
    // The second call saw the first turn and both its tool results.
    expect(calls[1]?.request.messages.slice(1)).toEqual([
      { role: "assistant", text: "", toolCalls: [call("a"), call("b")] },
      {
        role: "tool",
        results: [
          { callId: "a", name: "search_menu", output: "found a" },
          { callId: "b", name: "search_menu", output: "found b" },
        ],
      },
    ]);
  });

  it("stops at maxTurns without running the last turn's tools", async () => {
    const { client, calls } = setup([{ toolCalls: [call("x")] }]);
    const search = vi.fn(() => "ok");
    const onUsage = vi.fn();
    const result = await runToolLoop({ client, request: sampleRequest(), executors: { search_menu: search }, maxTurns: 2, onUsage });
    expect(result.status).toBe("max_turns");
    expect(result.turns).toBe(2);
    expect(calls).toHaveLength(2);
    expect(search).toHaveBeenCalledTimes(1);
    expect(onUsage).toHaveBeenCalledTimes(2);
    expect(result.messages.at(-1)).toMatchObject({ role: "assistant" });
  });

  it("stops on a refusal with a typed result, after metering the refused turn", async () => {
    const { client } = setup([{ toolCalls: [call("a")] }, { stopReason: "refusal" }]);
    const onUsage = vi.fn();
    const result = await runToolLoop({ client, request: sampleRequest(), executors: { search_menu: () => "ok" }, onUsage });
    expect(result.status).toBe("refused");
    expect(result.refusal).toEqual({ category: "test", explanation: "declined" });
    expect(onUsage).toHaveBeenCalledTimes(2);
  });

  it("answers an unknown tool and a throwing executor with error results", async () => {
    const { client, calls } = setup([{ toolCalls: [call("a"), { id: "z", name: "nope", input: {} }] }, { text: "sorry" }]);
    await runToolLoop({
      client,
      request: sampleRequest({ messages: [{ role: "user", text: "go" }] }),
      executors: {
        search_menu: () => {
          throw new Error("catalog offline");
        },
      },
    });
    expect(calls[1]?.request.messages.at(-1)).toEqual({
      role: "tool",
      results: [
        { callId: "a", name: "search_menu", output: "catalog offline", isError: true },
        { callId: "z", name: "nope", output: "This tool does not exist.", isError: true },
      ],
    });
  });

  it("reports a max_tokens stop", async () => {
    const { client } = setup([{ text: "cut", stopReason: "max_tokens" }]);
    expect((await runToolLoop({ client, request: sampleRequest(), executors: {} })).status).toBe("max_tokens");
  });

  it("refuses a maxTurns below one", async () => {
    const { client } = setup([{ text: "x" }]);
    await expect(runToolLoop({ client, request: sampleRequest(), executors: {}, maxTurns: 0 })).rejects.toThrow(TypeError);
  });
});

describe("ensureNotRefused", () => {
  it("throws a RefusalError carrying the refusal, and passes anything else through", () => {
    expect(() => ensureNotRefused(turnResult({ stopReason: "refusal" }, 0))).toThrow(RefusalError);
    const fine = turnResult({ text: "ok" }, 0);
    expect(ensureNotRefused(fine)).toBe(fine);
  });
});
