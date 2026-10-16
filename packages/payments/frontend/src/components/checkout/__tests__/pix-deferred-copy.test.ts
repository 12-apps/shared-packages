// @vitest-environment jsdom
/**
 * FUT-3612 — the clipboard opened inside the tap for a Pix code the server has
 * not answered yet: the promise-of-text `ClipboardItem` where the browser has
 * one, the plain write where it has not, refuses it, or throws building it — and
 * `false`, never a throw, when there is no text or no clipboard at all.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { deferredCopy } from "../pix-parts";

afterEach(() => vi.unstubAllGlobals());

function clipboard(over: Partial<{ write: unknown; writeText: unknown }>) {
  const writeText = vi.fn(async () => undefined);
  vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText, ...over } });
  return writeText;
}

describe("deferredCopy", () => {
  it("writes the text through ClipboardItem when the browser has one", async () => {
    const write = vi.fn(async (items: { getType: (type: string) => Promise<Blob> }[]) => {
      await items[0]!.getType("text/plain");
    });
    vi.stubGlobal("ClipboardItem", class {
      constructor(private readonly data: Record<string, Promise<Blob>>) {}
      getType(type: string) { return this.data[type]!; }
    });
    const writeText = clipboard({ write });
    const copy = deferredCopy();
    copy.resolve("000201-code");
    await expect(copy.done).resolves.toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
    expect(writeText).not.toHaveBeenCalled();
  });

  it("falls back to the plain write when ClipboardItem cannot be built in the tap", async () => {
    vi.stubGlobal("ClipboardItem", class {
      constructor() { throw new TypeError("no promises here"); }
    });
    const writeText = clipboard({ write: vi.fn() });
    const copy = deferredCopy();
    copy.resolve("000201-code");
    await expect(copy.done).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("000201-code");
  });

  it("falls back to the plain write when the browser refuses the item", async () => {
    vi.stubGlobal("ClipboardItem", class {
      constructor(readonly data: unknown) {}
    });
    const writeText = clipboard({ write: vi.fn(async () => { throw new Error("NotAllowedError"); }) });
    const copy = deferredCopy();
    copy.resolve("000201-code");
    await expect(copy.done).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("000201-code");
  });

  it("uses the plain write where there is no ClipboardItem", async () => {
    vi.stubGlobal("ClipboardItem", undefined);
    const writeText = clipboard({});
    const copy = deferredCopy();
    copy.resolve("000201-code");
    await expect(copy.done).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("000201-code");
  });

  it("answers false, without writing, when the raise brought no code", async () => {
    vi.stubGlobal("ClipboardItem", undefined);
    const writeText = clipboard({});
    const copy = deferredCopy();
    copy.fail();
    await expect(copy.done).resolves.toBe(false);
    expect(writeText).not.toHaveBeenCalled();
  });

  it("answers false when the plain write is refused too", async () => {
    vi.stubGlobal("ClipboardItem", undefined);
    clipboard({ writeText: vi.fn(async () => { throw new Error("denied"); }) });
    const copy = deferredCopy();
    copy.resolve("000201-code");
    await expect(copy.done).resolves.toBe(false);
  });
});
