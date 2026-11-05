/**
 * FUT-4399 — which devices are Apple ones, so that Google Pay is never
 * offered on them. Real user-agent strings, one per device.
 */
import { describe, expect, it } from "vitest";

import { isAppleDevice } from "../apple-device";

import { DEVICES } from "./device-fixtures";

describe("isAppleDevice", () => {
  it.each([
    ["iPhone Safari", "iphoneSafari"],
    ["iPhone Chrome (CriOS)", "iphoneChrome"],
    ["iPad Safari asking for the desktop site (Macintosh UA + touch)", "ipadOsDesktopUa"],
    ["iPad Chrome asking for the desktop site (Macintosh UA + touch)", "ipadOsChromeDesktopUa"],
    ["Mac Safari", "macSafari"],
  ] as const)("is true on %s", (_name, device) => {
    expect(isAppleDevice(DEVICES[device])).toBe(true);
  });

  it.each([
    ["Mac Chrome", "macChrome"],
    ["Mac Edge", "macEdge"],
    ["Mac Firefox", "macFirefox"],
    ["Android Chrome", "androidChrome"],
    ["Windows Chrome", "windowsChrome"],
  ] as const)("is false on %s", (_name, device) => {
    expect(isAppleDevice(DEVICES[device])).toBe(false);
  });

  it("reads an iOS Client Hint as Apple, and leaves macOS to the UA", () => {
    expect(isAppleDevice({ userAgent: "anything", userAgentData: { platform: "iOS" } })).toBe(true);
    // Chromium on a Mac says "macOS" too — only the UA tells it from Safari.
    expect(isAppleDevice({ userAgent: DEVICES.macChrome.userAgent, userAgentData: { platform: "macOS" } })).toBe(false);
    expect(isAppleDevice({ userAgent: DEVICES.macSafari.userAgent, userAgentData: { platform: "macOS" } })).toBe(true);
  });

  it("is false for an empty UA", () => {
    expect(isAppleDevice({ userAgent: "" })).toBe(false);
  });
});
