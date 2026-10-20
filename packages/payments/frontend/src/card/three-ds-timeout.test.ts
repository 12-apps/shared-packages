// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { authenticatePagBankDebit, type ThreeDSInput } from "./three-ds";

/** FUT-3755 — the homologation run gives up on a hung SDK instead of hanging with it. */
const INPUT: ThreeDSInput = {
  session: "S",
  environment: "SANDBOX",
  encryptedCard: "enc",
  amountCents: 2701,
  customer: { name: "Ana Teste", email: "ana@example.com", phone: "11999998888" },
  billingAddress: { street: "Rua A", number: "10", city: "Sao Paulo", regionCode: "SP", postalCode: "01452002" },
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("authenticatePagBankDebit with a timeout", () => {
  it("answers ERROR once the timeout passes with no answer from the SDK", async () => {
    vi.stubGlobal("PagSeguro", { encryptCard: vi.fn(), setUp: vi.fn(), authenticate3DS: () => new Promise(() => {}) });
    vi.useFakeTimers();
    const pending = authenticatePagBankDebit({ ...INPUT, timeoutMs: 1_000 });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await pending).toEqual({ ok: false, failure: "ERROR" });
  });

  it("still answers the SDK's outcome when it arrives in time", async () => {
    const authenticate3DS = vi.fn(async () => ({ status: "AUTH_FLOW_COMPLETED" as const, id: "3DS_1", authenticationStatus: "AUTHENTICATED" as const }));
    vi.stubGlobal("PagSeguro", { encryptCard: vi.fn(), setUp: vi.fn(), authenticate3DS });
    expect(await authenticatePagBankDebit({ ...INPUT, timeoutMs: 1_000 })).toEqual({
      ok: true,
      authenticationId: "3DS_1",
      authenticated: true,
    });
  });
});
