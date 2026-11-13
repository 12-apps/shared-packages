import { describe, expect, it } from "vitest";

import { MAX_FAILURES, transition } from "../machine";
import { aDocument, lookedUp, sidecarError } from "./fixtures";

/** The machine's half of the review's round-1 findings: what a number owes, and when a person is called. */

const AT = "2026-11-20T15:31:00.000Z";

describe("the number a document owes", () => {
  it("B2 keeps an unknown outcome through a later answer that says nothing about the first send", () => {
    const unknown = transition(aDocument({ status: "SUBMITTED", accessKey: "K" }), { kind: "RETRY", error: sidecarError("RETRYABLE", { outcomeUnknown: true }) }, AT);
    const later = transition(unknown.document, { kind: "RETRY", error: sidecarError("CONTINGENCY", { outcomeUnknown: false }) }, AT);
    expect(later.document.outcomeUnknown).toBe(true);
    expect(transition(later.document, { kind: "REPLACE", replacedById: "doc-2" }, AT).document.numberVoid).toBe("LOOKUP_FIRST");
    expect(transition(later.document, { kind: "REJECT", error: sidecarError("REJECTED", { code: "704" }) }, AT).document.numberVoid).toBe("LOOKUP_FIRST");
  });

  it("B1 keeps the protocol a lookup answers, which the owed cancel quotes", () => {
    const replaced = aDocument({ status: "REPLACED", numberVoid: "LOOKUP_FIRST", accessKey: "K", replacedById: "doc-2" });
    const { document } = transition(replaced, { kind: "LOOKUP", answer: { ...lookedUp("AUTHORIZED"), protocol: "135260000000009" } }, AT);
    expect(document).toMatchObject({ numberVoid: "CANCEL", protocol: "135260000000009", outcomeUnknown: false });
  });

  it("B8 settles a number a lookup finds denied (the denial spent it)", () => {
    const replaced = aDocument({ status: "REPLACED", numberVoid: "LOOKUP_FIRST", accessKey: "K", replacedById: "doc-2" });
    expect(transition(replaced, { kind: "LOOKUP", answer: lookedUp("DENIED") }, AT).document.numberVoid).toBe("DENIED");
  });

  it("B5 never voids a rejected contingency NFC-e: the buyer holds its DANFE", () => {
    const offline = aDocument({ status: "CONTINGENCY", seriesKind: "CONTINGENCY", accessKey: "K" });
    const { document } = transition(offline, { kind: "REJECT", error: sidecarError("REJECTED", { code: "225" }) }, AT);
    expect(document).toMatchObject({ status: "REJECTED", statusCode: "225", numberVoid: null });
    expect(() => transition(document, { kind: "INUTILIZE", answer: {} as never, eventXmlKey: null }, AT)).toThrow(/not owed an inutilization/);
  });
});

describe("a person's attention", () => {
  it("comes at once for a refusal, and after MAX_FAILURES failures in a row otherwise", () => {
    const refused = transition(aDocument({ status: "REJECTED", numberVoid: "INUTILIZE" }), {
      kind: "DEFER",
      reason: "the inutilization failed",
      error: sidecarError("REJECTED", { code: "241" }),
      attention: true,
    }, AT);
    expect(refused.document).toMatchObject({ attention: true, statusCode: "241", failures: 1 });

    const retries = Array.from({ length: MAX_FAILURES }, () => sidecarError("RETRYABLE"));
    const exhausted = retries.reduce((current, error) => {
      expect(current.attention).toBe(false);
      return transition(current, { kind: "RETRY", error }, AT).document;
    }, aDocument({ status: "SUBMITTED" }));
    expect(exhausted).toMatchObject({ attention: true, failures: MAX_FAILURES });
    const released = transition(exhausted, { kind: "RELEASE" }, AT).document;
    expect(released).toMatchObject({ attention: false, failures: 0 });
    expect(() => transition(released, { kind: "RELEASE" }, AT)).toThrow(/not waiting for a person/);
  });
});
