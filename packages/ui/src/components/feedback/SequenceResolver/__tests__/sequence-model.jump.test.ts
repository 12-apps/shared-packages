/**
 * The run's jump (FUT-3825): opening at one problem, jumping to a category's
 * first unanswered problem, Back after a jump, and an answer with no inverse.
 */
import { describe, expect, it } from "vitest";

import {
  backRun,
  canReturn,
  currentOf,
  jumpRun,
  jumpTargetOf,
  previousOf,
  resolveRun,
  skipRun,
  startRun,
  summaryOf,
  syncRun,
} from "../sequence-model";

interface Item {
  key: string;
  kindLabel: string;
}

const item = (key: string): Item => ({ key, kindLabel: "Kind" });
const A = item("a");
const B = item("b");
const C = item("c");
const D = item("d");

const keysAhead = (state: { ahead: Item[] }): string[] => state.ahead.map((entry) => entry.key);

describe("startRun with an initial key", () => {
  it("opens at that entry and keeps the ones before it ahead, after it", () => {
    const run = startRun<Item, string>([A, B, C, D], "c");
    expect(currentOf(run)).toBe(C);
    expect(keysAhead(run)).toEqual(["c", "a", "b", "d"]);
    expect(run.visits).toEqual([]);
  });

  it("is a plain start for the first key, an unknown key or none", () => {
    expect(keysAhead(startRun<Item, string>([A, B], "a"))).toEqual(["a", "b"]);
    expect(keysAhead(startRun<Item, string>([A, B], "zzz"))).toEqual(["a", "b"]);
    expect(keysAhead(startRun<Item, string>([A, B]))).toEqual(["a", "b"]);
  });
});

describe("jumpRun", () => {
  it("passes over the step on screen and shows the target, the rest in run order", () => {
    const run = jumpRun(startRun<Item, string>([A, B, C, D]), "c");
    expect(currentOf(run)).toBe(C);
    expect(keysAhead(run)).toEqual(["c", "b", "d"]);
    expect(run.visits).toEqual([{ item: A, outcome: "skipped" }]);
    expect(summaryOf(run)).toEqual({ resolved: 0, skipped: 1, total: 4, alsoResolved: 0 });
  });

  it("Back from the target returns to the step it left, at once", () => {
    const jumped = jumpRun(startRun<Item, string>([A, B, C]), "c");
    const back = backRun(jumped, "a");
    expect(currentOf(back)).toBe(A);
    expect(previousOf(back)).toBeUndefined();
    expect(keysAhead(back)).toEqual(["a", "c", "b"]);
  });

  it("after an answer, a jump then Back returns to the left step, and Back again to the answered one", () => {
    const answered = resolveRun(startRun<Item, string>([A, B, C, D]), "r-a");
    const jumped = jumpRun(answered, "d");
    expect(run(jumped)).toEqual({ current: "d", visits: ["a:resolved", "b:skipped"] });
    const once = backRun(jumped, "b");
    expect(run(once)).toEqual({ current: "b", visits: ["a:resolved"] });
    const twice = backRun(once, "a");
    expect(run(twice)).toEqual({ current: "a", visits: [] });
  });

  it("takes a passed-over target back out of the history", () => {
    const skipped = skipRun(startRun<Item, string>([A, B, C]), "a");
    const jumped = jumpRun(skipped, "a");
    expect(run(jumped)).toEqual({ current: "a", visits: ["b:skipped"] });
    expect(keysAhead(jumped)).toEqual(["a", "c"]);
  });

  it("leaves the run alone for the step on screen, an answered key or an unknown one", () => {
    const start = startRun<Item, string>([A, B, C]);
    expect(jumpRun(start, "a")).toBe(start);
    const answered = resolveRun(start, "r-a");
    expect(jumpRun(answered, "a")).toBe(answered);
    expect(jumpRun(answered, "nope")).toBe(answered);
  });

  it("drops the left step's hold, so a refetch that lacks it does not bring it back ahead", () => {
    const backed = backRun(skipRun(startRun<Item, string>([A, B, C]), "a"), "a");
    expect(backed.held).toEqual(["a"]);
    const jumped = jumpRun(backed, "c");
    expect(jumped.held).toEqual([]);
    expect(keysAhead(syncRun(jumped, [B, C]))).toEqual(["c", "b"]);
  });
});

describe("jumpTargetOf", () => {
  it("is the first key still ahead, in run order", () => {
    const state = startRun<Item, string>([A, B, C, D]);
    expect(jumpTargetOf(state, ["d", "b"])).toBe("b");
  });

  it("falls back to a passed-over key, and never names an answered one", () => {
    const state = resolveRun(skipRun(startRun<Item, string>([A, B, C]), "a"), "r-b");
    expect(jumpTargetOf(state, ["a", "b"])).toBe("a");
    expect(jumpTargetOf(state, ["b"])).toBeUndefined();
    expect(jumpTargetOf(state, [])).toBeUndefined();
  });
});

describe("an answer with no inverse", () => {
  it("stops Back at it", () => {
    const final = resolveRun(startRun<Item, string>([A, B]), "r-a", A, 0, true);
    expect(previousOf(final)).toMatchObject({ outcome: "resolved", final: true });
    expect(canReturn(final)).toBe(false);
  });

  it("does not stop Back over an ordinary answer or a skip", () => {
    expect(canReturn(resolveRun(startRun<Item, string>([A, B]), "r-a"))).toBe(true);
    expect(canReturn(skipRun(startRun<Item, string>([A, B])))).toBe(true);
    expect(canReturn(startRun<Item, string>([A, B]))).toBe(false);
  });
});

function run(state: ReturnType<typeof startRun<Item, string>>): { current?: string; visits: string[] } {
  return {
    current: currentOf(state)?.key,
    visits: state.visits.map((visit) => `${visit.item.key}:${visit.outcome}`),
  };
}
