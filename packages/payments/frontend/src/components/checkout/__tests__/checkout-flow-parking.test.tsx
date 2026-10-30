// @vitest-environment jsdom
/**
 * `<CheckoutFlow parkHostedOrders>` as a host mounts it: the prop reaches the
 * flow, and leaving it out keeps every existing checkout's behaviour.
 *
 * The slot holds a Pix this store's checkout raised. The host's checkout
 * resumes it on mount; a second mount with `parkHostedOrders={false}` (a pedido
 * paid again from its own page) shows its own list and leaves the entry alone.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { HOSTED_ORDER_STORAGE_KEY, rememberHostedOrder } from "../hosted-return";
import { onPageStore, orderFor, renderList, stubClient } from "./list-harness";
import { cleanup, screen, waitFor } from "./test-utils";

const PARKED = { ...orderFor("PIX"), orderId: "checkout-pix" };

beforeEach(() => {
  window.sessionStorage.clear();
  rememberHostedOrder(PARKED, { tenantSlug: "loja-1" });
});

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

describe("CheckoutFlow's parkHostedOrders", () => {
  it("with the prop left out, the checkout resumes the Pix it parked", async () => {
    renderList({ config: onPageStore({ methods: ["PIX"] }), client: stubClient() });

    expect(await screen.findByTestId("list-pix")).toBeTruthy();
  });

  it("with false, the mount shows its own list and leaves the parked Pix for the checkout", async () => {
    const before = window.sessionStorage.getItem(HOSTED_ORDER_STORAGE_KEY);
    renderList({ config: onPageStore({ methods: ["PIX"] }), client: stubClient(), parkHostedOrders: false });

    expect(await screen.findByRole("radio", { name: /Pix/ })).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId("list-pix")).toBeNull());
    expect(window.sessionStorage.getItem(HOSTED_ORDER_STORAGE_KEY)).toBe(before);
  });
});
