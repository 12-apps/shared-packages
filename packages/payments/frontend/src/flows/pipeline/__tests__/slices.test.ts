// @vitest-environment jsdom
/**
 * SLICE PARKING (FUT-1240).
 *
 * A step declares its scrap of state; the engine owns the storage. Two
 * properties are worth pinning: the key is scoped to the STORE, and nothing
 * that came back out of storage is believed without the step's own parser.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { clearSlices, initialSlices, readSlice, sliceKey, writeSlice } from "../slices";
import { parseDadosSlice } from "../steps/buyer-steps";
import type { AnyCheckoutStep } from "../types";

import { ctxOf } from "./fixtures";

/** A step whose slice survives a reload, with a parser that checks the shape. */
const PARKED_STEP: AnyCheckoutStep = {
  id: "dados",
  phase: "details",
  applies: () => true,
  complete: () => false,
  slice: {
    initial: () => ({ opened: false, done: false }),
    persist: "session",
    parse: (raw) => parseDadosSlice(raw),
  },
  render: () => null,
};

/** The same step, but its state belongs to this visit only. */
const EPHEMERAL_STEP: AnyCheckoutStep = {
  ...PARKED_STEP,
  id: "volatile",
  slice: { initial: () => ({ opened: false, done: false }), persist: "none" },
};

/** A step that persists but never said how to read one back. */
const UNPARSED_STEP: AnyCheckoutStep = {
  ...PARKED_STEP,
  id: "unparsed",
  slice: { initial: () => ({ opened: false, done: true }), persist: "session" },
};

beforeEach(() => window.sessionStorage.clear());
afterEach(() => window.sessionStorage.clear());

describe("where a slice lives", () => {
  it("is scoped to the store, always", () => {
    expect(sliceKey("loja-1", "dados")).toBe("payments.checkout.loja-1.dados");
    // A host with no slug is the single-tenant case, and the only place there
    // is no other store to confuse it with.
    expect(sliceKey(undefined, "dados")).toBe("payments.checkout.-.dados");
  });

  it("keeps two stores' answers apart in one tab", () => {
    writeSlice(PARKED_STEP, "loja-a", { opened: true, done: true });
    writeSlice(PARKED_STEP, "loja-b", { opened: false, done: false });
    expect(readSlice(PARKED_STEP, "loja-a")).toEqual({ opened: true, done: true });
    expect(readSlice(PARKED_STEP, "loja-b")).toEqual({ opened: false, done: false });
  });

  it("parks nothing for a step whose state is this visit's only", () => {
    writeSlice(EPHEMERAL_STEP, "loja-1", { opened: true, done: true });
    expect(window.sessionStorage.getItem(sliceKey("loja-1", "volatile"))).toBeNull();
  });
});

describe("nothing out of storage is believed on its word", () => {
  it("refuses a value the step's own parser rejects", () => {
    window.sessionStorage.setItem(sliceKey("loja-1", "dados"), JSON.stringify({ opened: "yes" }));
    expect(readSlice(PARKED_STEP, "loja-1")).toBeNull();
  });

  it("refuses a value that is not even JSON", () => {
    window.sessionStorage.setItem(sliceKey("loja-1", "dados"), "{oops");
    expect(readSlice(PARKED_STEP, "loja-1")).toBeNull();
  });

  it("refuses everything for a step that declared no parser", () => {
    // The engine cannot check a shape it has not been told, and a half-written
    // value reaching a step as its state is the whole of what this rule stops.
    window.sessionStorage.setItem(sliceKey("loja-1", "unparsed"), JSON.stringify({ opened: true }));
    expect(readSlice(UNPARSED_STEP, "loja-1")).toBeNull();
  });
});

describe("what a fresh mount starts from", () => {
  it("rehydrates what it can and builds the rest", () => {
    writeSlice(PARKED_STEP, "loja-1", { opened: true, done: true });
    const slices = initialSlices([PARKED_STEP, EPHEMERAL_STEP], ctxOf());
    expect(slices["dados"]).toEqual({ opened: true, done: true });
    expect(slices["volatile"]).toEqual({ opened: false, done: false });
  });

  it("drops every parked slice when the checkout ends", () => {
    writeSlice(PARKED_STEP, "loja-1", { opened: true, done: true });
    clearSlices([PARKED_STEP, EPHEMERAL_STEP], "loja-1");
    // A finished walk parked is the next purchase skipping the steps it needs.
    expect(readSlice(PARKED_STEP, "loja-1")).toBeNull();
  });
});
