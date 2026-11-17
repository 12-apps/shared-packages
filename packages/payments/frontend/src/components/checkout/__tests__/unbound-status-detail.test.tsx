// @vitest-environment jsdom
/**
 * FUT-612 — a `<CheckoutFlow>` mounted by hand (no `createPaymentFlows`
 * provider above it) talks through the UNBOUND client, and option C reads the
 * money facts through `getStatusDetail`. Without it on the unbound client the
 * facts never reached the flow, and a short capture showed the decline.
 */
import { describe, expect, it, vi } from "vitest";

import { useCheckoutClientApi } from "../client-context";
import { PT_BR_CHECKOUT_COPY } from "../pt-BR";
import { CheckoutCopyProvider } from "../copy-context";
import { renderHook } from "./test-utils";

describe("the unbound checkout client", () => {
  it("reads /status with its money facts", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ data: "FAILED", shortfall: { totalCents: 2070, paidCents: 690, dueCents: 1380, paidMethod: "PIX", resolution: null } }),
    );
    const { result } = renderHook(() => useCheckoutClientApi(), {
      wrapper: ({ children }) => <CheckoutCopyProvider copy={PT_BR_CHECKOUT_COPY}>{children}</CheckoutCopyProvider>,
    });
    const detail = await result.current.getStatusDetail?.("o1");
    expect(detail).toEqual({
      ok: true,
      data: { status: "FAILED", shortfall: { totalCents: 2070, paidCents: 690, dueCents: 1380, paidMethod: "PIX", resolution: null } },
    });
    fetchSpy.mockRestore();
  });
});
