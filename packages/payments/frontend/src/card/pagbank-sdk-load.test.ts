// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { ensurePagBankSdk } from "./tokenize";

/**
 * FUT-5519: one failed load of PagBank's SDK used to be remembered, so every
 * card after it failed with "o SDK do PagBank não carregou" until the page
 * was reloaded. A failure is now tried afresh; only a success is kept, for
 * the module's life, so the case that ends in a success runs last.
 */

const scripts = (): HTMLScriptElement[] => [...document.head.querySelectorAll("script")];

afterEach(() => {
  vi.useRealTimers();
  for (const script of scripts()) script.remove();
  delete (window as { PagSeguro?: unknown }).PagSeguro;
});

describe("loading the PagBank SDK", () => {
  it("counts a load that never answers as failed, and tries again next time", async () => {
    vi.useFakeTimers();
    const hung = ensurePagBankSdk(1_000);
    vi.advanceTimersByTime(1_000);
    expect(await hung).toBe(false);

    const retry = ensurePagBankSdk(1_000);
    expect(scripts()).toHaveLength(1);
    scripts()[0]!.dispatchEvent(new Event("error"));
    expect(await retry).toBe(false);
  });
  it("tries the script again after a failed load", async () => {
    const first = ensurePagBankSdk();
    scripts()[0]!.dispatchEvent(new Event("error"));
    expect(await first).toBe(false);
    expect(scripts()).toHaveLength(0);

    const second = ensurePagBankSdk();
    expect(scripts()).toHaveLength(1);
    (window as { PagSeguro?: unknown }).PagSeguro = { encryptCard: vi.fn() };
    scripts()[0]!.dispatchEvent(new Event("load"));
    expect(await second).toBe(true);
  });

});
