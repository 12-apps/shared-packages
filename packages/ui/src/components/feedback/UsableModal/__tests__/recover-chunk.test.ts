/**
 * The loader that survives a deploy: one retry, then one reload onto the
 * current build per tab, then nothing at all — never an error for the host's
 * boundary.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { recoverChunk } from "../recover-chunk";

const Surface = (): null => null;

function reloadSpy(): ReturnType<typeof vi.fn> {
  const reload = vi.fn();
  vi.stubGlobal("location", { ...window.location, reload });
  return reload;
}

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("recoverChunk", () => {
  it("passes a chunk that loads straight through", async () => {
    const load = vi.fn(async () => ({ default: Surface }));

    await expect(recoverChunk(load)()).resolves.toEqual({ default: Surface });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("retries once before anything else", async () => {
    const load = vi
      .fn<() => Promise<{ default: typeof Surface }>>()
      .mockRejectedValueOnce(new Error("Failed to fetch dynamically imported module"))
      .mockResolvedValueOnce({ default: Surface });

    await expect(recoverChunk(load)()).resolves.toEqual({ default: Surface });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("reloads the page once when the chunk is gone", async () => {
    const reload = reloadSpy();
    const load = vi.fn(async () => {
      throw new Error("Failed to fetch dynamically imported module");
    });

    void recoverChunk(load)();
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(window.sessionStorage.getItem("12-apps-ui:usable-modal-chunk-reload")).toBe("1");
  });

  it("renders nothing, with no second reload, when it already reloaded in this tab", async () => {
    const reload = reloadSpy();
    window.sessionStorage.setItem("12-apps-ui:usable-modal-chunk-reload", "1");
    const load = vi.fn(async () => {
      throw new Error("Failed to fetch dynamically imported module");
    });

    const module = await recoverChunk(load)();

    expect(reload).not.toHaveBeenCalled();
    expect((module.default as () => null)()).toBeNull();
  });
});
