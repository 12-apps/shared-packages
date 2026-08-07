/**
 * The PII scrub (FUT-719).
 *
 * The storefront IS the checkout screen, so the payer's name, e-mail, CPF and
 * card fields sit in React state and in the DOM within reach of any automatic
 * breadcrumb. This suite is therefore split evenly between what must be
 * redacted and what must SURVIVE — a scrub that eats the order id is a scrub
 * that leaves every event undiagnosable, which is its own kind of failure.
 */
import { describe, expect, it } from "vitest";

import { REDACTED, scrub, scrubUrl } from "../scrub";

describe("scrub", () => {
  it("redacts a realistic checkout payload at any depth", () => {
    const event = {
      contexts: {
        state: {
          order: {
            buyer: {
              name: "Maria Silva",
              email: "maria@example.com",
              taxId: "12345678901",
              phone: "+5511999998888",
            },
            card: { number: "4111111111111111", cvv: "123", holderName: "MARIA SILVA" },
          },
        },
      },
    };

    const clean = JSON.stringify(scrub(event));

    expect(clean).not.toContain("Maria Silva");
    expect(clean).not.toContain("maria@example.com");
    expect(clean).not.toContain("12345678901");
    expect(clean).not.toContain("4111111111111111");
    expect(clean).not.toContain("+5511999998888");
    expect(clean).toContain(REDACTED);
  });

  it("matches a key regardless of casing or separators", () => {
    // `tax_id`, `taxId` and `TaxID` are one field wearing three spellings; a
    // set keyed on the literal string would catch only whichever the last
    // provider happened to use.
    const clean = scrub({ tax_id: "1", TaxID: "2", taxId: "3" }) as Record<string, unknown>;
    expect(Object.values(clean)).toEqual([REDACTED, REDACTED, REDACTED]);
  });

  it("KEEPS the ids that make an event diagnosable", () => {
    // The server's note is the argument: a CPF is eleven digits, and so are
    // plenty of ids worth keeping — which is why this redacts by key and never
    // by value shape.
    const clean = scrub({
      orderId: "ORDE_12345678901",
      chargeId: "CHAR_9988776655",
      amount: 1290,
      status: "DECLINED",
      tenantSlug: "acme",
    }) as Record<string, unknown>;

    expect(clean).toEqual({
      orderId: "ORDE_12345678901",
      chargeId: "CHAR_9988776655",
      amount: 1290,
      status: "DECLINED",
      tenantSlug: "acme",
    });
  });

  it("walks into arrays", () => {
    const clean = scrub({ items: [{ email: "a@b.c", sku: "X1" }] }) as {
      items: Record<string, unknown>[];
    };
    expect(clean.items[0]).toEqual({ email: REDACTED, sku: "X1" });
  });

  it("survives a self-referencing object", () => {
    // A React error carries the fiber tree, which points back at itself. A
    // reporter that stack-overflows while preparing a report turns one broken
    // page into a broken tab — strictly worse than not reporting.
    const cyclic: Record<string, unknown> = { email: "a@b.c" };
    cyclic.self = cyclic;

    const clean = scrub(cyclic) as Record<string, unknown>;
    expect(clean.email).toBe(REDACTED);
    expect(clean.self).toBe("[circular]");
  });

  it("leaves primitives alone", () => {
    expect(scrub("plain")).toBe("plain");
    expect(scrub(42)).toBe(42);
    expect(scrub(null)).toBe(null);
  });
});

describe("scrubUrl", () => {
  it("keeps the path and drops the query string", () => {
    // The path is what makes an event triageable ("every /checkout crashed").
    // The query string is where a token, a `?next=` e-mail and one-time codes
    // end up.
    expect(scrubUrl("https://acme.com/checkout?token=abc123&email=a@b.c")).toBe(
      "https://acme.com/checkout",
    );
  });

  it("drops the fragment too", () => {
    expect(scrubUrl("https://acme.com/pedido#cpf=12345678901")).toBe(
      "https://acme.com/pedido",
    );
  });

  it("handles a relative URL", () => {
    expect(scrubUrl("/acme/menu?q=pizza")).toBe("/acme/menu");
  });

  it("never throws, whatever it is handed", () => {
    // The contract is total: a breadcrumb is never worth throwing over, and
    // this runs inside `beforeSend` where a throw would lose the whole event.
    // Resolving against a base means almost nothing is rejected outright —
    // junk comes back as a harmless path rather than an exception, which is
    // the same guarantee by a different route.
    for (const input of ["::::", "", "not a url", "//", "javascript:alert(1)"]) {
      expect(() => scrubUrl(input)).not.toThrow();
      expect(scrubUrl(input)).not.toContain("?");
    }
  });
});
