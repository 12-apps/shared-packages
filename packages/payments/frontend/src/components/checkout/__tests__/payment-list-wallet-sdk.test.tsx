// @vitest-environment jsdom
/**
 * FUT-5372 — Apple Pay in the one list, in a browser that is not Safari.
 *
 * The host's `applePayQrCode` (the storefront's beta flag) turns on Apple's JS
 * SDK, whose sheet is a QR code scanned with an iPhone. Pinned:
 *
 *  - off (absent or false), the list is exactly what it was: no script is
 *    appended, and Apple Pay shows only where the browser has its own session;
 *  - on, the pinned script (with its integrity hash) is appended only when the
 *    store declares Apple Pay and the host validates the merchant, Apple's own
 *    `<apple-pay-button>` is drawn once it loads, and its press runs the same
 *    session, priced at the amount due, and the same charge;
 *  - a script that fails to load draws nothing, and Safari's own session never
 *    loads the script at all.
 *
 * The SDK is driven at the seam a browser provides it: the appended `<script>`
 * is found in `document.head`, the session class is installed on `window` the
 * way Apple's script installs it, and the script's `load` is fired.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

import { APPLE_PAY_SDK_INTEGRITY, APPLE_PAY_SDK_URL } from "../apple-pay-sdk";
import type { CreateOrderRequest, CreateOrderResult } from "../types";
import { installApple, orderFor, renderList, stubClient, uninstallWallets, walletStore } from "./list-harness";

const validate = () => vi.fn(async () => ({ merchantSession: "ok" }));

/** The Apple SDK script the list appended, if any. */
function sdkScript(): HTMLScriptElement | null {
  return document.head.querySelector<HTMLScriptElement>(`script[src="${APPLE_PAY_SDK_URL}"]`);
}

/** Apple's script arrives: it installs `ApplePaySession`, then the browser fires `load`. */
async function loadSdk(canPay = true) {
  await waitFor(() => expect(sdkScript()).not.toBeNull());
  const world = installApple(canPay);
  await act(async () => sdkScript()?.onload?.(new Event("load")));
  return world;
}

beforeEach(() => window.sessionStorage.clear());
afterEach(() => {
  uninstallWallets();
  for (const script of document.head.querySelectorAll(`script[src="${APPLE_PAY_SDK_URL}"]`)) script.remove();
  cleanup();
});

describe("Apple Pay through Apple's SDK in the one list", () => {
  it("with the host's switch off, appends no script and offers no Apple Pay where the browser has no session", async () => {
    renderList({ config: walletStore(["APPLE_PAY"]), client: stubClient(), list: { totalCents: 2700 }, validateApplePayMerchant: validate() });
    await screen.findByTestId("payment-list");

    expect(sdkScript()).toBeNull();
    await waitFor(() => expect(screen.queryByTestId("list-wallets")).toBeNull());
  });

  it("with the switch explicitly false, behaves exactly as off", async () => {
    renderList({ config: walletStore(["APPLE_PAY"]), client: stubClient(), list: { totalCents: 2700 }, validateApplePayMerchant: validate(), applePayQrCode: false });
    await screen.findByTestId("payment-list");

    expect(sdkScript()).toBeNull();
    await waitFor(() => expect(screen.queryByTestId("list-wallets")).toBeNull());
  });

  it("with the switch on, loads Apple's pinned script with its integrity hash and draws Apple's own button", async () => {
    renderList({ config: walletStore(["APPLE_PAY"]), client: stubClient(), list: { totalCents: 2700 }, validateApplePayMerchant: validate(), applePayQrCode: true });
    await loadSdk();

    const script = sdkScript()!;
    expect(script.integrity).toBe(APPLE_PAY_SDK_INTEGRITY);
    expect(script.crossOrigin).toBe("anonymous");
    const mounted = await screen.findByTestId("list-apple-pay-sdk");
    expect(mounted.querySelector("apple-pay-button")?.getAttribute("aria-label")).toBe("Pagar com Apple Pay");
    await waitFor(() => expect(screen.queryByTestId("list-apple-pay")).toBeNull());
  });

  it("with the switch on, the SDK button's press begins the same session inside the tap and charges its key", async () => {
    const client = stubClient();
    client.chargeWallet.mockResolvedValue({ ok: true, data: { status: "PAID" } });
    const raise = vi.fn(async (input: CreateOrderRequest): Promise<CreateOrderResult> => ({ ok: true, data: orderFor(input.method, { amountDueCents: 2200 }) }));
    const port = validate();
    renderList({ config: walletStore(["APPLE_PAY"]), client, createOrder: raise, list: { totalCents: 2200, amountDueLabel: "R$ 22,00" }, validateApplePayMerchant: port, applePayQrCode: true });
    const { sessions } = await loadSdk();

    fireEvent.click((await screen.findByTestId("list-apple-pay-sdk")).querySelector("apple-pay-button")!);
    // No await between the press and these: a session begun outside the tap is refused.
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.begun).toBe(true);
    expect(sessions[0]?.request.total.amount).toBe("22.00");
    sessions[0]?.onvalidatemerchant?.({ validationURL: "https://apple-pay-gateway.apple.com/x" });
    await waitFor(() => expect(port).toHaveBeenCalledWith("https://apple-pay-gateway.apple.com/x"));
    await act(async () => sessions[0]?.onpaymentauthorized?.({ payment: { token: { paymentData: { data: "qr" } } } }));
    await waitFor(() => expect(client.chargeWallet).toHaveBeenCalledWith(expect.objectContaining({ wallet: { type: "APPLE_PAY", key: JSON.stringify({ data: "qr" }) } })));
    await waitFor(() => expect(sessions[0]?.completed).toEqual([0]));
  });

  it("with the switch on and a script that fails to load, draws no Apple Pay and nothing breaks", async () => {
    renderList({ config: walletStore(["APPLE_PAY"]), client: stubClient(), list: { totalCents: 2700 }, validateApplePayMerchant: validate(), applePayQrCode: true });
    await waitFor(() => expect(sdkScript()).not.toBeNull());
    await act(async () => sdkScript()?.onerror?.(new Event("error")));

    expect(screen.getByTestId("payment-list")).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId("list-wallets")).toBeNull());
  });

  it("with the switch on and an SDK that cannot pay on this device, draws no Apple Pay", async () => {
    renderList({ config: walletStore(["APPLE_PAY"]), client: stubClient(), list: { totalCents: 2700 }, validateApplePayMerchant: validate(), applePayQrCode: true });
    await loadSdk(false);

    await waitFor(() => expect(screen.queryByTestId("list-wallets")).toBeNull());
  });

  it("with the switch on in Safari, never loads the script and draws Safari's button as before", async () => {
    installApple();
    renderList({ config: walletStore(["APPLE_PAY"]), client: stubClient(), list: { totalCents: 2700 }, validateApplePayMerchant: validate(), applePayQrCode: true });

    expect(await screen.findByTestId("list-apple-pay")).toBeTruthy();
    expect(sdkScript()).toBeNull();
    await waitFor(() => expect(screen.queryByTestId("list-apple-pay-sdk")).toBeNull());
  });

  it("with the switch on, loads nothing for a store that does not declare Apple Pay or a host with no merchant validation", async () => {
    renderList({ config: walletStore(["GOOGLE_PAY"]), client: stubClient(), list: { totalCents: 2700 }, validateApplePayMerchant: validate(), applePayQrCode: true });
    await screen.findByTestId("payment-list");
    expect(sdkScript()).toBeNull();
    cleanup();

    renderList({ config: walletStore(["APPLE_PAY"]), client: stubClient(), list: { totalCents: 2700 }, applePayQrCode: true });
    await screen.findByTestId("payment-list");
    expect(sdkScript()).toBeNull();
  });
});
