/**
 * FUT-3612 — opening the bank app: which phone this is, the URL per phone, and
 * telling an app that opened (the page lost the screen) from one that did not.
 */
import { describe, expect, it } from "vitest";

import { bankAppUrl, openBankApp, phoneOs } from "../list/bank-apps";

const nav = (userAgent: string, maxTouchPoints = 0) => ({ userAgent, maxTouchPoints });

describe("phoneOs", () => {
  it("reads Android, iPhone and an iPad asking for the desktop site; a computer is none", () => {
    expect(phoneOs(nav("Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/129"))).toBe("android");
    expect(phoneOs(nav("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)"))).toBe("ios");
    expect(phoneOs(nav("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5))).toBe("ios");
    expect(phoneOs(nav("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0))).toBeNull();
    expect(phoneOs(nav("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"))).toBeNull();
    expect(phoneOs(undefined)).toBeNull();
  });
});

describe("bankAppUrl", () => {
  it("names the package on Android and the scheme on iOS", () => {
    expect(bankAppUrl("nubank", "android")).toContain("package=com.nu.production");
    expect(bankAppUrl("nubank", "android").startsWith("intent://")).toBe(true);
    expect(bankAppUrl("nubank", "ios")).toBe("nuapp://");
  });

  it("opens a bank with no known scheme by its launcher, naming the Play Store package", () => {
    expect(bankAppUrl("itau", "android")).toBe("intent:#Intent;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;package=com.itau;end");
    expect(bankAppUrl("caixa", "android")).toContain("package=br.gov.caixa.CAIXA");
  });
});

/** A window and a document that record listeners, and a navigation that can hide the page. */
function fakePage(hideOnOpen: boolean) {
  const listeners = new Map<string, Set<() => void>>();
  const on = (type: string, fn: () => void) => {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type)!.add(fn);
  };
  const off = (type: string, fn: () => void) => listeners.get(type)?.delete(fn);
  const fire = (type: string) => listeners.get(type)?.forEach((fn) => fn());
  const doc = { visibilityState: "visible", addEventListener: on, removeEventListener: off };
  let href = "";
  const win = {
    addEventListener: on,
    removeEventListener: off,
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    location: {
      get href() {
        return href;
      },
      set href(next: string) {
        href = next;
        if (hideOnOpen) {
          doc.visibilityState = "hidden";
          fire("visibilitychange");
        }
      },
    },
  };
  return { win: win as unknown as Window, doc: doc as unknown as Document, href: () => href, listeners };
}

describe("openBankApp", () => {
  it("says opened when the page lost the screen, and navigated to the bank's URL", async () => {
    const page = fakePage(true);
    await expect(openBankApp("itau", "android", { win: page.win, doc: page.doc, waitMs: 5 })).resolves.toBe(true);
    expect(page.href()).toBe(bankAppUrl("itau", "android"));
  });

  it("says NOT opened when the page is still on screen after the wait, and leaves no listener behind", async () => {
    const page = fakePage(false);
    await expect(openBankApp("caixa", "ios", { win: page.win, doc: page.doc, waitMs: 5 })).resolves.toBe(false);
    for (const set of page.listeners.values()) expect(set.size).toBe(0);
  });
});
