// @vitest-environment jsdom
/**
 * FUT-4399 — Google Pay is never offered on an Apple device, whether or not
 * the store offers Apple Pay; everywhere else it shows as before. The rule
 * lives in the capability, so it is driven through the one list, with pay.js
 * faked on the page (Google's real probe answers `true` on Apple devices too).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cleanup, screen, waitFor } from "@testing-library/react";

import { DEVICES } from "./device-fixtures";
import { installApple, installGoogle, renderList, stubClient, uninstallWallets, walletStore } from "./list-harness";

type Device = (typeof DEVICES)[keyof typeof DEVICES];

function useDevice(device: Device): void {
  Object.defineProperty(window.navigator, "userAgent", { value: device.userAgent, configurable: true });
  Object.defineProperty(window.navigator, "maxTouchPoints", { value: device.maxTouchPoints, configurable: true });
  const data = "userAgentData" in device ? device.userAgentData : undefined;
  Object.defineProperty(window.navigator, "userAgentData", { value: data, configurable: true });
}

beforeEach(() => window.sessionStorage.clear());
afterEach(() => {
  for (const key of ["userAgent", "maxTouchPoints", "userAgentData"]) delete (window.navigator as unknown as Record<string, unknown>)[key];
  uninstallWallets();
  cleanup();
});

const validate = () => vi.fn(async () => ({ merchantSession: "ok" }));
const render = (wallets: ("GOOGLE_PAY" | "APPLE_PAY")[]) =>
  renderList({ config: walletStore(wallets), client: stubClient(), list: { totalCents: 2700 }, validateApplePayMerchant: validate() });

describe("Google Pay by device", () => {
  it.each([
    ["Android Chrome", "androidChrome"],
    ["Mac Chrome", "macChrome"],
    ["Mac Firefox", "macFirefox"],
    ["Windows Chrome", "windowsChrome"],
    ["an Android tablet in desktop mode", "androidTabletDesktopMode"],
  ] as const)("shows on %s", async (_name, device) => {
    useDevice(DEVICES[device]);
    installGoogle();
    render(["GOOGLE_PAY"]);
    expect(await screen.findByTestId("list-google-pay")).toBeTruthy();
  });

  it.each([
    ["iPhone Safari", "iphoneSafari"],
    ["iPhone Chrome", "iphoneChrome"],
    ["iPad (desktop UA + touch)", "ipadOsDesktopUa"],
    ["Mac Safari", "macSafari"],
  ] as const)("never shows on %s, and pay.js is never asked", async (_name, device) => {
    useDevice(DEVICES[device]);
    const { createButton, isReadyToPay, constructed } = installGoogle();
    render(["GOOGLE_PAY"]);
    await screen.findByTestId("payment-list");
    await waitFor(() => expect(screen.queryByTestId("list-google-pay")).toBeNull());
    await waitFor(() => expect(screen.queryByTestId("list-wallets")).toBeNull());
    expect(constructed()).toBe(0);
    expect(isReadyToPay).not.toHaveBeenCalled();
    expect(createButton).not.toHaveBeenCalled();
  });

  it("leaves Apple Pay alone on an iPhone whose store offers both", async () => {
    useDevice(DEVICES.iphoneSafari);
    installGoogle();
    installApple();
    render(["GOOGLE_PAY", "APPLE_PAY"]);
    expect(await screen.findByRole("button", { name: "Pagar com Apple Pay" })).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId("list-google-pay")).toBeNull());
  });

  it("keeps both wallets on a Chrome that can pay with both", async () => {
    useDevice(DEVICES.macChrome);
    installGoogle();
    installApple();
    render(["GOOGLE_PAY", "APPLE_PAY"]);
    expect(await screen.findByTestId("list-google-pay")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pagar com Apple Pay" })).toBeTruthy();
  });
});

describe("Google Pay in PRODUCTION: only a buyer with a card in Google Pay (FUT-4399)", () => {
  const productionStore = () => {
    const store = walletStore(["GOOGLE_PAY"]);
    const head = store.chain?.[0];
    if (!head) throw new Error("the store has a chain head");
    return { ...store, chain: [{ ...head, googlePay: { gateway: "pagbank", gatewayMerchantId: "MID_1", environment: "PRODUCTION" as const, merchantInfo: { merchantId: "BCR2DN_1" } } }] };
  };
  const renderProduction = () => renderList({ config: productionStore(), client: stubClient(), list: { totalCents: 2700 } });

  it("never draws when Google answers ready but no card is present", async () => {
    useDevice(DEVICES.androidChrome);
    const { isReadyToPay } = installGoogle();
    isReadyToPay.mockResolvedValue({ result: true });
    renderProduction();
    await screen.findByTestId("payment-list");
    await waitFor(() => expect(isReadyToPay).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByTestId("list-google-pay")).toBeNull());
  });

  it("draws when a card is present, and the probe asked for one", async () => {
    useDevice(DEVICES.androidChrome);
    const { isReadyToPay } = installGoogle();
    isReadyToPay.mockResolvedValue({ result: true, paymentMethodPresent: true });
    renderProduction();
    expect(await screen.findByTestId("list-google-pay")).toBeTruthy();
    expect(isReadyToPay.mock.calls[0]?.[0]).toMatchObject({ existingPaymentMethodRequired: true });
  });
});
