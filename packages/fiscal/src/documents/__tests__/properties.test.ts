import { describe, expect, it } from "vitest";

import { FiscalDocumentError } from "../errors";
import { DOCUMENT_TRANSITIONS, type DocumentInput, transition } from "../machine";
import type { FiscalDocument, FiscalDocumentStatus } from "../types";
import { AUTHORIZED, CANCELLED, DENIED, INUTILIZED, SIGNED, aDocument, lookedUp, sidecarError } from "./fixtures";

/**
 * Random transition sequences. Every draw is a pure hash of (seed, draw
 * number), the engine suite's generator, so a failure names the seed that
 * reproduces it and CI draws the same sequences every run.
 */
function draw(seed: number, index: number): number {
  let t = (Math.imul(seed, 0x9e3779b1) + Math.imul(index + 1, 0x6d2b79f5)) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const INPUTS: readonly DocumentInput[] = [
  { kind: "SUBMIT" },
  { kind: "AUTHORIZE", answer: AUTHORIZED, xmlKey: "x" },
  { kind: "DENY", answer: DENIED, xmlKey: "x" },
  { kind: "REJECT", error: sidecarError("REJECTED") },
  { kind: "REJECT", error: sidecarError("INVALID") },
  { kind: "RETRY", error: sidecarError("RETRYABLE", { outcomeUnknown: true }) },
  { kind: "RETRY", error: sidecarError("CONTINGENCY") },
  { kind: "SIGN_OFFLINE", answer: SIGNED, contingency: { since: "2026-11-20T12:30:00-03:00", reason: "SEFAZ fora do ar no momento" }, xmlKey: "x" },
  { kind: "REPLACE", replacedById: "doc-2" },
  { kind: "CANCEL", answer: CANCELLED, reason: "pedido cancelado pelo cliente", eventXmlKey: null },
  { kind: "LOOKUP", answer: lookedUp("NOT_FOUND") },
  { kind: "LOOKUP", answer: lookedUp("AUTHORIZED") },
  { kind: "LOOKUP", answer: lookedUp("CANCELLED") },
  { kind: "INUTILIZE", answer: INUTILIZED, eventXmlKey: null },
  { kind: "LOOKUP", answer: lookedUp("DENIED") },
  { kind: "DEFER", reason: "settlement failed", error: sidecarError("REJECTED", { code: "241" }), attention: true },
  { kind: "DEFER", reason: "unanswered", error: null, attention: false },
  { kind: "RELEASE" },
  { kind: "WARN" },
  { kind: "RESIGN", answer: SIGNED, sale: aDocument().sale, totals: aDocument().totals, buyerTaxId: null, xmlKey: "x" },
];

const AT = "2026-11-20T15:31:00.000Z";
const SEEDS = Array.from({ length: 300 }, (_, i) => i + 1);

interface Walk {
  readonly contingency: boolean;
  readonly visited: FiscalDocumentStatus[];
  readonly accepted: Array<{ from: FiscalDocumentStatus; to: FiscalDocumentStatus; kind: DocumentInput["kind"] }>;
}

/** The 40 steps of every walk, numbered from 1. */
const STEPS = Array.from({ length: 40 }, (_, index) => index + 1);

function walk(seed: number): Walk {
  const start = draw(seed, 0) < 0.5 ? aDocument() : aDocument({ seriesKind: "CONTINGENCY" });
  const visited: FiscalDocumentStatus[] = [start.status];
  const accepted: Walk["accepted"] = [];
  /** One step of the walk: the document it leaves, the one it was handed when the input is refused. */
  const stepFrom = (document: FiscalDocument, step: number): FiscalDocument => {
    const input = INPUTS[Math.floor(draw(seed, step) * INPUTS.length)]!;
    const before = JSON.stringify(document);
    try {
      const result = transition(document, input, AT);
      expect(result.event.fromStatus).toBe(document.status);
      expect(result.event.toStatus).toBe(result.document.status);
      accepted.push({ from: document.status, to: result.document.status, kind: input.kind });
      visited.push(result.document.status);
      return result.document;
    } catch (error) {
      expect(error, `seed ${seed} step ${step}`).toBeInstanceOf(FiscalDocumentError);
      expect((error as FiscalDocumentError).code).toBe("TRANSITION_REFUSED");
      expect(JSON.stringify(document), `seed ${seed}: a refusal changed the document`).toBe(before);
      return document;
    }
  };
  STEPS.reduce(stepFrom, start);
  return { contingency: start.seriesKind === "CONTINGENCY", visited, accepted };
}

const WALKS = SEEDS.map((seed) => ({ seed, ...walk(seed) }));
const statesVisited = (walks: readonly Walk[]) => walks.flatMap((w) => w.visited);

describe("random transition sequences", () => {
  it("accept an input only from a state its row lists", () => {
    for (const { seed, accepted } of WALKS) {
      for (const step of accepted) {
        expect(DOCUMENT_TRANSITIONS[step.kind], `seed ${seed}`).toContain(step.from);
      }
    }
  });

  it("enter CANCELLED only from AUTHORIZED, and never leave it", () => {
    for (const { seed, accepted } of WALKS) {
      for (const step of accepted) {
        if (step.to === "CANCELLED") expect(["AUTHORIZED", "CANCELLED"], `seed ${seed}`).toContain(step.from);
        if (step.from === "CANCELLED") expect(step.to, `seed ${seed}`).toBe("CANCELLED");
      }
    }
  });

  it("never step to AUTHORIZED from REJECTED, DENIED, REPLACED or CANCELLED", () => {
    for (const { seed, accepted } of WALKS) {
      for (const step of accepted) {
        if (step.to === "AUTHORIZED") expect(["SUBMITTED", "CONTINGENCY", "AUTHORIZED"], `seed ${seed}`).toContain(step.from);
      }
    }
  });

  it("keep DENIED, REPLACED and CANCELLED final; REJECTED leaves only for CONTINGENCY (resend) or SUBMITTED (found SEFAZ's)", () => {
    for (const { seed, accepted, contingency } of WALKS) {
      for (const step of accepted) {
        if (["DENIED", "REPLACED", "CANCELLED"].includes(step.from)) expect(step.to, `seed ${seed}`).toBe(step.from);
        if (step.from === "REJECTED" && step.to !== "REJECTED") {
          // A contingency NFC-e resent after correction, or an online number a lookup found SEFAZ's (back to SUBMITTED).
          const expected = contingency ? [true, "RESIGN", "CONTINGENCY"] : [false, "LOOKUP", "SUBMITTED"];
          expect([contingency, step.kind, step.to], `seed ${seed}`).toEqual(expected);
        }
      }
    }
  });

  it("cover every state across the seeds", () => {
    const seen = new Set(statesVisited(WALKS));
    expect([...seen].sort()).toEqual(
      ["AUTHORIZED", "CANCELLED", "CONTINGENCY", "DENIED", "PENDING", "REJECTED", "REPLACED", "SUBMITTED"],
    );
  });
});
