// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { tokenizeForCheckout, tokenizerFor } from "./tokenize";
import type { CardDetails } from "./types";

/** A Luhn-valid Visa test PAN (the mock path validates before minting). */
const VALID_CARD: CardDetails = {
  number: "4111 1111 1111 1111",
  holder: "Ana Compradora",
  expiry: "12/39",
  cvv: "123",
};

/** The always-declines test PAN the mock encodes as `tok_declined…`. */
const DECLINE_CARD: CardDetails = { ...VALID_CARD, number: "4000 0000 0000 0002" };

describe("tokenizeForCheckout — the mock gate (FUT-697)", () => {
  it("NEVER mints a mock token without server-granted stub permission", async () => {
    // The exact production shape of the bug: a Stone/Stripe store resolved to
    // a null PagBank key, and the old fallback minted a fake `tok_…` that
    // entered a real charge. With no `mockTokenization` grant, the answer is
    // a clear bail BEFORE any money moves.
    const result = await tokenizeForCheckout(VALID_CARD, {
      provider: "stripe",
      publicKey: null,
      mockTokenization: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("indisponível");
  });

  it("bails clearly for a provider with no browser scheme, even WITH a key", async () => {
    const result = await tokenizeForCheckout(VALID_CARD, {
      provider: "infinitepay",
      publicKey: "pk_live_123",
      mockTokenization: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("indisponível");
  });

  it("bails clearly when the store has no provider at all", async () => {
    const result = await tokenizeForCheckout(VALID_CARD, {
      provider: null,
      publicKey: null,
      mockTokenization: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("indisponível");
  });

  it("mints the mock token under stub permission (dev / e2e path)", async () => {
    const result = await tokenizeForCheckout(VALID_CARD, {
      provider: "pagbank",
      publicKey: null,
      mockTokenization: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.token).toMatch(/^tok/);
      expect(result.data.token).not.toMatch(/^tok_declined/);
      expect(result.data.last4).toBe("1111");
    }
  });

  it("encodes the decline scenario in the mock token", async () => {
    const result = await tokenizeForCheckout(DECLINE_CARD, {
      provider: "pagbank",
      publicKey: null,
      mockTokenization: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.token).toMatch(/^tok_declined/);
  });

  it("still validates the card before minting a mock", async () => {
    const result = await tokenizeForCheckout(
      { ...VALID_CARD, number: "1234" },
      { provider: "pagbank", publicKey: null, mockTokenization: true },
    );
    expect(result.ok).toBe(false);
  });

  it("routes a keyed PagBank store to the REAL tokenizer — a key beats stub permission", async () => {
    // Stub the SDK so `ensurePagBankSdk` short-circuits (no script injection in
    // the test env). The encrypted blob coming back — never a `tok_…` mock —
    // is the proof that a present key routes to REAL tokenization even when
    // stub permission was granted.
    const pagSeguro = {
      encryptCard: () => ({ hasErrors: false, encryptedCard: "enc-blob-123" }),
    };
    (window as typeof window & { PagSeguro?: typeof pagSeguro }).PagSeguro = pagSeguro;
    try {
      const result = await tokenizeForCheckout(VALID_CARD, {
        provider: "pagbank",
        publicKey: "PUB-KEY",
        mockTokenization: true, // even with stub permission, a key means REAL tokenization
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.token).toBe("enc-blob-123");
        expect(result.data.token).not.toMatch(/^tok/);
      }
    } finally {
      delete (window as typeof window & { PagSeguro?: typeof pagSeguro }).PagSeguro;
    }
  });
});

describe("tokenizerFor — scheme is chosen by provider, never by capability", () => {
  it("names each implemented provider's own scheme", () => {
    expect(tokenizerFor("pagbank")).toBe("pagbank-sdk");
    expect(tokenizerFor("stone")).toBe("pagarme-token");
    expect(tokenizerFor("stripe")).toBe("stripe-pm");
  });

  it("answers null for providers with no browser card path", () => {
    expect(tokenizerFor("infinitepay")).toBeNull();
    expect(tokenizerFor("unknown-vendor")).toBeNull();
  });
});

describe("tokenizeForCheckout — the stripe-pm scheme (FUT-698)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Stub fetch once and capture the single call the tokenizer makes. */
  function stubStripe(status: number, body: unknown): { url?: string; init?: RequestInit }[] {
    const calls: { url?: string; init?: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        return new Response(JSON.stringify(body), { status });
      }),
    );
    return calls;
  }

  it("mints a PaymentMethod at Stripe with the publishable key — the PAN never reaches us", async () => {
    const calls = stubStripe(200, { id: "pm_123", card: { brand: "visa", last4: "1111" } });

    const result = await tokenizeForCheckout(VALID_CARD, {
      provider: "stripe",
      publicKey: "pk_test_1",
      mockTokenization: false,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.token).toBe("pm_123");
      expect(result.data.last4).toBe("1111");
    }
    expect(calls[0]?.url).toBe("https://api.stripe.com/v1/payment_methods");
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer pk_test_1");
    const form = new URLSearchParams(String(calls[0]?.init?.body));
    expect(form.get("type")).toBe("card");
    expect(form.get("card[number]")).toBe("4111111111111111");
    expect(form.get("card[exp_month]")).toBe("12");
    expect(form.get("card[exp_year]")).toBe("2039");
  });

  it("carries Stripe's refusal verbatim — the provider's answer must reach a human", async () => {
    stubStripe(402, { error: { message: "Your card number is incorrect." } });

    const result = await tokenizeForCheckout(VALID_CARD, {
      provider: "stripe",
      publicKey: "pk_test_1",
      mockTokenization: false,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("HTTP 402");
      expect(result.error).toContain("Your card number is incorrect.");
    }
  });

  it("a keyed Stripe store routes to the REAL tokenizer — a key beats stub permission", async () => {
    stubStripe(200, { id: "pm_real" });

    const result = await tokenizeForCheckout(VALID_CARD, {
      provider: "stripe",
      publicKey: "pk_test_1",
      mockTokenization: true, // even with stub permission, a key means REAL tokenization
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.token).toBe("pm_real");
  });
});
