import { describe, expect, it } from "vitest";

import { threeDSOutcomeOf, threeDSRequestOf, type ThreeDSInput } from "./three-ds";

/** FUT-3754 — PagBank's `authenticate3DS`, as this package shapes it and reads it back. */
const INPUT: ThreeDSInput = {
  session: "S",
  environment: "SANDBOX",
  encryptedCard: "enc",
  amountCents: 2701,
  customer: { name: " Ana Teste ", email: "ana@example.com", phone: "(11) 99999-8888" },
  billingAddress: { street: "Rua A", number: "10", city: "São Paulo", regionCode: "SP", postalCode: "01452-002" },
};

describe("threeDSRequestOf", () => {
  it("asks for a one-installment DEBIT_CARD with the encrypted card, a MOBILE phone and a Brazilian address", () => {
    expect(threeDSRequestOf(INPUT)).toEqual({
      data: {
        customer: {
          name: "Ana Teste",
          email: "ana@example.com",
          phones: [{ country: "55", area: "11", number: "999998888", type: "MOBILE" }],
        },
        paymentMethod: { type: "DEBIT_CARD", installments: 1, card: { encrypted: "enc" } },
        amount: { value: 2701, currency: "BRL" },
        billingAddress: { street: "Rua A", number: "10", city: "São Paulo", regionCode: "SP", postalCode: "01452002", country: "BRA" },
        dataOnly: false,
      },
    });
  });

  it("reads a phone with the country code", () => {
    expect(threeDSRequestOf({ ...INPUT, customer: { ...INPUT.customer, phone: "+55 11 99999-8888" } })?.data.customer.phones[0]?.area).toBe("11");
  });

  it("answers null for a phone it cannot split — PagBank requires one MOBILE", () => {
    expect(threeDSRequestOf({ ...INPUT, customer: { ...INPUT.customer, phone: "123" } })).toBeNull();
  });
});

describe("threeDSOutcomeOf", () => {
  it("charges a completed flow, authenticated or not", () => {
    expect(threeDSOutcomeOf({ status: "AUTH_FLOW_COMPLETED", authenticationStatus: "AUTHENTICATED", id: "3DS_1" })).toEqual({
      ok: true,
      authenticationId: "3DS_1",
      authenticated: true,
    });
    expect(threeDSOutcomeOf({ status: "AUTH_FLOW_COMPLETED", authenticationStatus: "NOT_AUTHENTICATED", id: "3DS_2" })).toMatchObject({
      ok: true,
      authenticated: false,
    });
  });

  it("refuses a debit the card cannot do, and one PagBank refused", () => {
    expect(threeDSOutcomeOf({ status: "AUTH_NOT_SUPPORTED" })).toEqual({ ok: false, failure: "NOT_SUPPORTED" });
    expect(threeDSOutcomeOf({ status: "CHANGE_PAYMENT_METHOD" })).toEqual({ ok: false, failure: "REFUSED" });
  });

  it("never charges a completed flow with no id", () => {
    expect(threeDSOutcomeOf({ status: "AUTH_FLOW_COMPLETED" })).toEqual({ ok: false, failure: "ERROR" });
  });
});
