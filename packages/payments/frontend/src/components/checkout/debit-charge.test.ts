// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { authenticateDebit, type DebitAuthentication } from "./debit-charge";
import type { ThreeDSFailureReport } from "./list/types";
import type { CheckoutOrder } from "./types";

/** FUT-5806 — a failed debit 3DS reaches the host's report, with PagBank's answer and no card data. */
const COPY = { notSupported: "não suporta", refused: "recusado", failed: "falhou" } as DebitAuthentication["copy"];
const ADDRESS: DebitAuthentication["billingAddress"] = {
  street: "Rua A",
  number: "10",
  city: "São Paulo",
  regionCode: "SP",
  postalCode: "01452002",
};
const ORDER = { orderId: "o-1" } as CheckoutOrder;
const BUYER = { name: "Ana", email: "ana@example.com", phone: "11999998888" };
const SESSION = { ok: true as const, data: { session: "S", environment: "PRODUCTION" as const, amountCents: 100 } };

function run(onThreeDSFailure?: (failure: ThreeDSFailureReport) => void) {
  return authenticateDebit({
    client: { threeDSecureSession: vi.fn(async () => SESSION) } as never,
    order: ORDER,
    buyer: BUYER,
    encryptedCard: "enc",
    debit: { billingAddress: ADDRESS, copy: COPY, ...(onThreeDSFailure ? { onThreeDSFailure } : {}) },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("authenticateDebit reports a failed 3-D Secure", () => {
  it("hands the host PagBank's rejection and still answers the buyer's copy", async () => {
    const rejection = { detail: { httpStatus: 400, traceId: "t-1", errorMessages: [{ code: "40002", description: "invalid" }] } };
    vi.stubGlobal("PagSeguro", { encryptCard: vi.fn(), setUp: vi.fn(), authenticate3DS: () => Promise.reject(rejection) });
    const reports: ThreeDSFailureReport[] = [];

    const answer = await run((failure) => reports.push(failure));

    expect(answer).toEqual({ ok: false, error: "falhou" });
    expect(reports).toEqual([
      {
        surface: "checkout",
        failure: "ERROR",
        detail: { httpStatus: 400, traceId: "t-1", errorMessages: [{ code: "40002", description: "invalid" }] },
      },
    ]);
    expect(JSON.stringify(reports)).not.toContain("enc");
  });

  it("reports a refusal the SDK answered", async () => {
    vi.stubGlobal("PagSeguro", { encryptCard: vi.fn(), setUp: vi.fn(), authenticate3DS: async () => ({ status: "CHANGE_PAYMENT_METHOD" }) });
    const reports: ThreeDSFailureReport[] = [];

    expect(await run((failure) => reports.push(failure))).toEqual({ ok: false, error: "recusado" });
    expect(reports).toEqual([{ surface: "checkout", failure: "REFUSED", detail: { sdkStatus: "CHANGE_PAYMENT_METHOD" } }]);
  });

  it("never costs the buyer the answer when the host's report throws", async () => {
    vi.stubGlobal("PagSeguro", { encryptCard: vi.fn(), setUp: vi.fn(), authenticate3DS: async () => ({ status: "AUTH_NOT_SUPPORTED" }) });

    expect(
      await run(() => {
        throw new Error("tracker down");
      }),
    ).toEqual({ ok: false, error: "não suporta" });
  });

  it("reports nothing when the debit authenticated", async () => {
    vi.stubGlobal("PagSeguro", {
      encryptCard: vi.fn(),
      setUp: vi.fn(),
      authenticate3DS: async () => ({ status: "AUTH_FLOW_COMPLETED", id: "3DS_1", authenticationStatus: "AUTHENTICATED" }),
    });
    const report = vi.fn();

    expect(await run(report)).toEqual({ ok: true, data: "3DS_1" });
    expect(report).not.toHaveBeenCalled();
  });
});
