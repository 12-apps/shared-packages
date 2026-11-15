import { describe, expect, it } from "vitest";

import { assertDraftFits, computeAccessKey, isValidAccessKey } from "../context";
import { SALE } from "./fixtures";

/** The NFC-e of the fiscal service's own fixture, as its mapper (sped-nfe) keys it. */
const NFCE_KEY = "35261111222333000181650010000012011482139076";

/** A key under the 2026 alphanumeric CNPJ, computed the way the package keys its own documents. */
function alphanumericKey(): string {
  return computeAccessKey({
    sale: { ...SALE, issuer: { ...SALE.issuer, cnpj: "12ABC34501DE35" } },
    model: "NFCE",
    seriesKind: "ONLINE",
  });
}

describe("isValidAccessKey", () => {
  it("accepts a key whose check digit is right, numeric or with an alphanumeric CNPJ", () => {
    expect(isValidAccessKey(NFCE_KEY)).toBe(true);
    const key = alphanumericKey();
    expect(key.slice(6, 20)).toBe("12ABC34501DE35");
    expect(isValidAccessKey(key)).toBe(true);
  });

  it.each([
    ["a wrong check digit", `${NFCE_KEY.slice(0, 43)}7`],
    ["43 characters", NFCE_KEY.slice(0, 43)],
    ["45 characters", `${NFCE_KEY}0`],
    ["a lowercase CNPJ", alphanumericKey().toLowerCase()],
    ["a letter outside the CNPJ", `${NFCE_KEY.slice(0, 30)}A${NFCE_KEY.slice(31)}`],
    ["a letter in the CNPJ's check digits", `${NFCE_KEY.slice(0, 18)}A${NFCE_KEY.slice(19)}`],
    ["spaces", NFCE_KEY.replace(/(.{4})/g, "$1 ").trim()],
    ["nothing", ""],
  ])("refuses %s", (_why, key) => {
    expect(isValidAccessKey(key)).toBe(false);
  });
});

describe("assertDraftFits", () => {
  const quoted = [{ accessKey: NFCE_KEY }];

  it("passes a sale without the return fields, and a return on an NF-e that quotes its NFC-e", () => {
    expect(() => assertDraftFits(SALE, "NFCE")).not.toThrow();
    expect(() => assertDraftFits(SALE, "NFE")).not.toThrow();
    expect(() => assertDraftFits({ purpose: "RETURN", operation: "IN", referencedDocuments: quoted }, "NFE")).not.toThrow();
    expect(() => assertDraftFits({ purpose: "NORMAL", operation: "OUT", referencedDocuments: [] }, "NFCE")).not.toThrow();
  });

  it.each([
    ["a return on an NFC-e", { purpose: "RETURN", referencedDocuments: quoted }, "NFCE", "RETURN_ON_NFCE"],
    ["a return on an NFC-e, quoting nothing", { purpose: "RETURN" }, "NFCE", "RETURN_ON_NFCE"],
    ["a return quoting nothing", { purpose: "RETURN", operation: "IN" }, "NFE", "RETURN_NEEDS_REFERENCE"],
    ["a return quoting an empty list", { purpose: "RETURN", referencedDocuments: [] }, "NFE", "RETURN_NEEDS_REFERENCE"],
    ["an NFC-e of entry", { purpose: "NORMAL", operation: "IN" }, "NFCE", "INVALID_INPUT"],
    ["an NFC-e quoting a document (SEFAZ 708)", { purpose: "NORMAL", referencedDocuments: quoted }, "NFCE", "INVALID_INPUT"],
    ["a reference that is not a key", { purpose: "RETURN", referencedDocuments: [{ accessKey: "123" }] }, "NFE", "INVALID_INPUT"],
    [
      "501 references",
      { purpose: "NORMAL", referencedDocuments: Array.from({ length: 501 }, () => ({ accessKey: NFCE_KEY })) },
      "NFE",
      "INVALID_INPUT",
    ],
  ] as const)("refuses %s with its code", (_why, draft, model, code) => {
    expect(() => assertDraftFits(draft, model)).toThrow(expect.objectContaining({ code }));
  });
});
