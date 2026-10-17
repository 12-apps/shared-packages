/**
 * The run as pure data: which step is on screen after each answer, skip, back
 * and queue change, and the numbers the header and the end screen read.
 */
import { describe, expect, it } from "vitest";

import {
  backRun,
  currentOf,
  pinRun,
  positionOf,
  previousOf,
  progressOf,
  resolveRun,
  skipRun,
  startRun,
  summaryOf,
  syncRun,
} from "../sequence-model";

interface Item {
  key: string;
  kindLabel: string;
  note?: string;
}

const item = (key: string, note?: string): Item => ({ key, kindLabel: "Kind", note });
const A = item("a");
const B = item("b");
const C = item("c");
const D = item("d");

const keysAhead = (state: { ahead: Item[] }): string[] => state.ahead.map((entry) => entry.key);

describe("a fresh run", () => {
  it("starts on the first entry, at position 1 of the queue's length, 0% along", () => {
    const run = startRun<Item, string>([A, B, C]);
    expect(currentOf(run)).toBe(A);
    expect(positionOf(run)).toBe(1);
    expect(summaryOf(run)).toEqual({ resolved: 0, skipped: 0, total: 3 });
    expect(progressOf(run)).toBe(0);
    expect(previousOf(run)).toBeUndefined();
  });

  it("counts a repeated key once", () => {
    const run = startRun<Item, string>([A, B, A]);
    expect(keysAhead(run)).toEqual(["a", "b"]);
  });

  it("is already at the end over an empty queue, and complete", () => {
    const run = startRun<Item, string>([]);
    expect(currentOf(run)).toBeUndefined();
    expect(progressOf(run)).toBe(100);
    expect(summaryOf(run).total).toBe(0);
  });
});

describe("resolve and skip", () => {
  it("resolve moves to the next step and remembers the result", () => {
    const run = resolveRun(startRun<Item, string>([A, B, C]), "r-a");
    expect(currentOf(run)).toBe(B);
    expect(positionOf(run)).toBe(2);
    expect(previousOf(run)).toEqual({ item: A, outcome: "resolved", result: "r-a" });
    expect(summaryOf(run)).toEqual({ resolved: 1, skipped: 0, total: 3 });
    expect(progressOf(run)).toBe(33);
    expect(run.pinned).toBeUndefined();
  });

  it("skip moves on without a result and counts as skipped", () => {
    const run = skipRun(startRun<Item, string>([A, B]));
    expect(currentOf(run)).toBe(B);
    expect(previousOf(run)).toEqual({ item: A, outcome: "skipped" });
    expect(summaryOf(run)).toEqual({ resolved: 0, skipped: 1, total: 2 });
  });

  it("reaches the end after the last step, and never runs past it", () => {
    let run = startRun<Item, string>([A, B]);
    run = resolveRun(run, "1");
    run = skipRun(run);
    expect(currentOf(run)).toBeUndefined();
    expect(positionOf(run)).toBe(2);
    expect(progressOf(run)).toBe(100);
    expect(resolveRun(run, "extra")).toBe(run);
    expect(skipRun(run)).toBe(run);
    expect(summaryOf(run)).toEqual({ resolved: 1, skipped: 1, total: 2 });
  });
});

describe("back", () => {
  it("returns to the previous step, its answer gone from the count", () => {
    let run = startRun<Item, string>([A, B, C]);
    run = resolveRun(run, "r-a");
    run = backRun(run);
    expect(currentOf(run)).toBe(A);
    expect(positionOf(run)).toBe(1);
    expect(summaryOf(run)).toEqual({ resolved: 0, skipped: 0, total: 3 });
    expect(keysAhead(run)).toEqual(["a", "b", "c"]);
  });

  it("walks back through skipped and resolved steps alike, one at a time", () => {
    let run = startRun<Item, string>([A, B, C]);
    run = skipRun(run);
    run = resolveRun(run, "r-b");
    run = backRun(run);
    expect(currentOf(run)).toBe(B);
    run = backRun(run);
    expect(currentOf(run)).toBe(A);
    expect(previousOf(run)).toBeUndefined();
  });

  it("returns from the end screen to the last step", () => {
    let run = resolveRun(startRun<Item, string>([A]), "r-a");
    expect(currentOf(run)).toBeUndefined();
    run = backRun(run);
    expect(currentOf(run)).toBe(A);
  });

  it("is a no-op on the first step", () => {
    const run = startRun<Item, string>([A, B]);
    expect(backRun(run)).toBe(run);
  });
});

describe("a queue that changes under the run", () => {
  it("drops steps ahead that were resolved elsewhere (siblings answered together), so N shrinks", () => {
    let run = startRun<Item, string>([A, B, C, D]);
    run = resolveRun(run, "limits for a and its siblings");
    run = syncRun(run, [A, D]);
    expect(currentOf(run)).toBe(D);
    expect(summaryOf(run)).toEqual({ resolved: 1, skipped: 0, total: 2 });
    expect(positionOf(run)).toBe(2);
  });

  it("keeps the answered step in history when a refetch drops it from the queue", () => {
    let run = startRun<Item, string>([A, B, C]);
    run = resolveRun(run, "r-a");
    run = syncRun(run, [B, C]);
    expect(currentOf(run)).toBe(B);
    expect(positionOf(run)).toBe(2);
    expect(summaryOf(run).total).toBe(3);
    run = backRun(run);
    expect(currentOf(run)).toBe(A);
  });

  it("drops the step on screen too when it was resolved elsewhere", () => {
    let run = startRun<Item, string>([A, B, C]);
    run = syncRun(run, [B, C]);
    expect(currentOf(run)).toBe(B);
  });

  it("keeps a PINNED step (its answer is being written) even when the refetch lands first", () => {
    let run = pinRun(startRun<Item, string>([A, B, C]), "a");
    run = syncRun(run, [B, C]);
    expect(currentOf(run)).toBe(A);
    run = resolveRun(run, "r-a", A);
    expect(currentOf(run)).toBe(B);
    expect(run.pinned).toBeUndefined();
    run = syncRun(run, [C]);
    expect(currentOf(run)).toBe(C);
  });

  it("ignores a second answer for the same item (a double call)", () => {
    let run = startRun<Item, string>([A, B, C]);
    run = resolveRun(run, "r-a", A);
    const again = resolveRun(run, "r-a twice", A);
    expect(again).toBe(run);
    expect(currentOf(again)).toBe(B);
  });

  it("ignores a skip begun on a step that has moved on", () => {
    let run = startRun<Item, string>([A, B, C]);
    run = skipRun(run, "a");
    expect(skipRun(run, "a")).toBe(run);
    expect(currentOf(skipRun(run, "b"))).toBe(C);
  });

  it("holds the step Back returned to while the host's refetch has not put it back yet", () => {
    let run = startRun<Item, string>([A, B, C]);
    run = resolveRun(run, "r-a");
    run = syncRun(run, [B, C]);
    run = backRun(run);
    run = syncRun(run, [B, C]);
    expect(currentOf(run)).toBe(A);
    run = syncRun(run, [C, B, A]);
    expect(keysAhead(run)).toEqual(["a", "b", "c"]);
  });

  it("appends entries it has not seen, in queue order, after the ones ahead", () => {
    let run = startRun<Item, string>([A, B]);
    run = syncRun(run, [C, A, B, D]);
    expect(keysAhead(run)).toEqual(["a", "b", "c", "d"]);
  });

  it("does not re-add an entry already visited", () => {
    let run = startRun<Item, string>([A, B]);
    run = skipRun(run);
    run = syncRun(run, [A, B]);
    expect(keysAhead(run)).toEqual(["b"]);
    expect(summaryOf(run).total).toBe(2);
  });

  it("refreshes the entries kept with the queue's newer data", () => {
    let run = startRun<Item, string>([A, B]);
    const freshB = item("b", "newer");
    run = syncRun(run, [A, freshB]);
    run = skipRun(run);
    expect(currentOf(run)).toBe(freshB);
  });

  it("reaches the end when everything ahead was resolved elsewhere", () => {
    let run = startRun<Item, string>([A, B, C]);
    run = resolveRun(run, "r-a");
    run = syncRun(run, []);
    expect(currentOf(run)).toBeUndefined();
    expect(progressOf(run)).toBe(100);
    expect(summaryOf(run)).toEqual({ resolved: 1, skipped: 0, total: 1 });
  });
});
