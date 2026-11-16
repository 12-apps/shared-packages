import { describe, expect, it } from "vitest";

import { isWindowsStoreApp } from "../store-mode";

describe("isWindowsStoreApp", () => {
  it("is true only when Electron flags the process as a Store install", () => {
    expect(isWindowsStoreApp({ windowsStore: true })).toBe(true);
  });

  it("is false for an .exe, macOS or Linux, where the flag is unset", () => {
    expect(isWindowsStoreApp({})).toBe(false);
    expect(isWindowsStoreApp({ windowsStore: false })).toBe(false);
  });

  it("reads the real process by default, which is no Store install here", () => {
    expect(isWindowsStoreApp()).toBe(false);
  });
});
