/**
 * FUT-595 / FUT-741 — what the buyer form asks for, and the one direction the
 * derivation is not allowed to get wrong.
 *
 * The interesting cases are ABSENCE cases, and they are two different things
 * that a live mount cannot tell apart for you:
 *
 *   - `customerSchema: []` — a chain that DECLARED it needs nothing. The
 *     server will not refuse the charge for a missing field, so asking for one
 *     is over-asking. Every real mount publishes this for an adapter with no
 *     declaration, which is why no story can stage the other case.
 *   - `customerSchema` ABSENT — a config from a host that predates the field.
 *     Nothing is known, and the honest reading is the rule the charge would
 *     have been made under: CPF, required. Reading it as "asks nothing" is the
 *     third FUT-740 critical one layer up — a form the buyer completes and a
 *     400 they meet afterwards.
 */
import { describe, expect, it } from "vitest";

import { buyerFieldsFor, fieldSatisfied } from "../buyer-fields";
import type { CheckoutChainLink } from "../types";

const link = (over: Partial<CheckoutChainLink> = {}): CheckoutChainLink => ({
  provider: "aurora",
  tokenization: "PUBLIC_KEY",
  publicKey: null,
  mockTokenization: true,
  methods: ["PIX", "CARD"],
  ...over,
});

describe("the degrade direction", () => {
  it("asks for the CPF when no chain was served at all", () => {
    expect(buyerFieldsFor(undefined, "CARD")).toEqual([
      { key: "taxId", type: "CPF", required: true },
    ]);
  });

  it("asks for the CPF when a chain entry declares NOTHING", () => {
    expect(buyerFieldsFor([link()], "CARD")).toEqual([
      { key: "taxId", type: "CPF", required: true },
    ]);
  });

  it("asks for nothing when a chain entry declares an EMPTY schema", () => {
    expect(buyerFieldsFor([link({ customerSchema: [] })], "CARD")).toEqual([]);
  });

  it("still folds the CPF in when only SOME entries declared", () => {
    // One entry whose requirements this browser cannot see makes the whole
    // answer uncertain. Over-asking costs one field; under-asking costs the
    // buyer a finished form and a refused charge.
    const fields = buyerFieldsFor(
      [link({ customerSchema: [{ key: "phone", type: "PHONE", required: true }] }), link()],
      "CARD",
    );
    expect(fields.map((field) => field.key).sort()).toEqual(["phone", "taxId"]);
  });
});

describe("the union across a chain", () => {
  it("takes the STRICTEST requiredness", () => {
    const fields = buyerFieldsFor(
      [
        link({ customerSchema: [{ key: "phone", type: "PHONE", required: false }] }),
        link({ provider: "boreal", customerSchema: [{ key: "phone", type: "PHONE", required: true }] }),
      ],
      "CARD",
    );
    expect(fields).toEqual([{ key: "phone", type: "PHONE", required: true }]);
  });

  it("takes the NARROWER type, because the form is filled once", () => {
    // A landline satisfies PHONE and strands the buyer on the entry that wants
    // a MOBILE — which is the double typing up-front collection exists to end.
    const fields = buyerFieldsFor(
      [
        link({ customerSchema: [{ key: "phone", type: "PHONE", required: true }] }),
        link({ provider: "boreal", customerSchema: [{ key: "phone", type: "MOBILE", required: true }] }),
      ],
      "CARD",
    );
    expect(fields).toEqual([{ key: "phone", type: "MOBILE", required: true }]);
  });

  it("narrows to the chosen METHOD, and unions across all of them when none is chosen", () => {
    const chain = [
      link({
        customerSchema: [
          { key: "taxId", type: "CPF", required: true, methods: ["PIX"] },
          { key: "phone", type: "MOBILE", required: true, methods: ["CARD"] },
        ],
      }),
    ];
    expect(buyerFieldsFor(chain, "PIX").map((field) => field.key)).toEqual(["taxId"]);
    expect(buyerFieldsFor(chain, "CARD").map((field) => field.key)).toEqual(["phone"]);
    // The Dados step opens before the picker: collect everything, once.
    expect(buyerFieldsFor(chain, null).map((field) => field.key).sort()).toEqual([
      "phone",
      "taxId",
    ]);
  });
});

describe("whether one field is satisfied", () => {
  it("lets an OPTIONAL field be blank but not malformed", () => {
    const optionalEmail = { key: "email", type: "EMAIL", required: false } as const;
    expect(fieldSatisfied(optionalEmail, "")).toBe(true);
    expect(fieldSatisfied(optionalEmail, "not-an-email")).toBe(false);
    expect(fieldSatisfied(optionalEmail, "ana@exemplo.com")).toBe(true);
  });

  it("checks the CPF's check digits, not its length", () => {
    const cpf = { key: "taxId", type: "CPF", required: true } as const;
    expect(fieldSatisfied(cpf, "111.111.111-11")).toBe(false);
    expect(fieldSatisfied(cpf, "529.982.247-25")).toBe(true);
    expect(fieldSatisfied(cpf, "")).toBe(false);
  });

  it("holds MOBILE to the narrower rule PHONE accepts", () => {
    const mobile = { key: "phone", type: "MOBILE", required: true } as const;
    const phone = { key: "phone", type: "PHONE", required: true } as const;
    expect(fieldSatisfied(phone, "1132654321")).toBe(true);
    expect(fieldSatisfied(mobile, "1132654321")).toBe(false);
    expect(fieldSatisfied(mobile, "11987654321")).toBe(true);
  });
});
