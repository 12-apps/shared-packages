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

/** The browser answers a script's load: `error` or `load`. */
function answer(script: HTMLScriptElement, outcome: "error" | "load"): void {
  script.dispatchEvent(new Event(outcome));
}

afterEach(() => {
  vi.useRealTimers();
  for (const script of scripts()) script.remove();
  delete (window as { PagSeguro?: unknown }).PagSeguro;
});

describe("loading the PagBank SDK", () => {
  it("lets a timed-out script's late answer leave a newer load alone", async () => {
    vi.useFakeTimers();
    const first = ensurePagBankSdk(1_000);
    const stale = scripts()[0]!;
    vi.advanceTimersByTime(1_000);
    await expect(first).resolves.toBe(false);

    const second = ensurePagBankSdk(1_000);
    answer(stale, "error");
    const again = ensurePagBankSdk(1_000);

    expect(again).toBe(second);
    expect(scripts()).toHaveLength(1);
    answer(scripts()[0]!, "error");
    await expect(second).resolves.toBe(false);
  });

  it("counts a load that never answers as failed, and tries again next time", async () => {
    vi.useFakeTimers();
    const hung = ensurePagBankSdk(1_000);
    vi.advanceTimersByTime(1_000);
    await expect(hung).resolves.toBe(false);

    const retry = ensurePagBankSdk(1_000);
    expect(scripts()).toHaveLength(1);
    answer(scripts()[0]!, "error");
    await expect(retry).resolves.toBe(false);
  });

  it("tries the script again after a failed load", async () => {
    const first = ensurePagBankSdk();
    answer(scripts()[0]!, "error");
    await expect(first).resolves.toBe(false);
    expect(scripts()).toHaveLength(0);

    const second = ensurePagBankSdk();
    expect(scripts()).toHaveLength(1);
    (window as { PagSeguro?: unknown }).PagSeguro = { encryptCard: vi.fn() };
    answer(scripts()[0]!, "load");
    await expect(second).resolves.toBe(true);
  });
});
