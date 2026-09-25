import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * `printHtml`, against a stand-in `BrowserWindow`.
 *
 * `electron` cannot be imported outside an Electron runtime, so the module is
 * replaced by a window that records what it was asked. The fake operating
 * system answers by DEVICE: {@link REFUSING} refuses with a reason,
 * {@link SILENT} refuses with none, anything else prints. A document equal to
 * {@link UNLOADABLE} fails to load.
 */

const REFUSING = "refusing-printer";
const SILENT = "silently-refusing-printer";
const UNLOADABLE = "<unloadable>";

const printer = vi.hoisted(() => ({
  loadError: new Error("ERR_INVALID_URL"),
  windows: [] as {
    options: unknown;
    loaded: string | null;
    printed: Record<string, unknown> | null;
    destroyed: boolean;
  }[],
}));

vi.mock("electron", () => ({
  BrowserWindow: class {
    private readonly record: (typeof printer.windows)[number];

    constructor(options: unknown) {
      this.record = { options, loaded: null, printed: null, destroyed: false };
      printer.windows.push(this.record);
    }

    loadURL(url: string): Promise<void> {
      this.record.loaded = url;
      return url.endsWith(encodeURIComponent("<unloadable>"))
        ? Promise.reject(printer.loadError)
        : Promise.resolve();
    }

    get webContents(): {
      print: (options: Record<string, unknown>, done: (ok: boolean, why: string) => void) => void;
    } {
      return {
        print: (options, done) => {
          this.record.printed = options;
          if (options.deviceName === "refusing-printer") done(false, "Print job canceled");
          else if (options.deviceName === "silently-refusing-printer") done(false, "");
          else done(true, "");
        },
      };
    }

    isDestroyed(): boolean {
      return this.record.destroyed;
    }

    destroy(): void {
      this.record.destroyed = true;
    }
  },
}));

const { printHtml, PrintRefusedError } = await import("../index");

afterEach(() => {
  printer.windows.length = 0;
});

describe("printHtml", () => {
  it("prints silently to the named device, from an offscreen window it then destroys", async () => {
    await printHtml({ html: "<p>hi</p>", deviceName: "EPSON TM-T20" });

    const [window] = printer.windows;
    expect(window?.loaded).toBe("data:text/html;charset=utf-8,%3Cp%3Ehi%3C%2Fp%3E");
    expect(window?.printed).toMatchObject({ silent: true, deviceName: "EPSON TM-T20" });
    expect(window?.options).toMatchObject({
      show: false,
      webPreferences: { offscreen: true, javascript: false },
    });
    expect(window?.destroyed).toBe(true);
  });

  it("leaves the device to the system when none is named", async () => {
    await printHtml({ html: "<p>hi</p>", deviceName: null });

    expect(printer.windows[0]?.printed).not.toHaveProperty("deviceName");
  });

  it("rejects with a structured refusal carrying the system's reason", async () => {
    const refused = printHtml({ html: "<p>hi</p>", deviceName: REFUSING });

    await expect(refused).rejects.toBeInstanceOf(PrintRefusedError);
    await expect(refused).rejects.toMatchObject({
      reason: "Print job canceled",
      message: "Print job canceled",
    });
    expect(printer.windows[0]?.destroyed).toBe(true);
  });

  it("gives a refusal with no reason a null reason and a code, never a sentence", async () => {
    await expect(printHtml({ html: "<p>hi</p>", deviceName: SILENT })).rejects.toMatchObject({
      name: "PrintRefusedError",
      reason: null,
      message: "print_refused",
    });
  });

  it("passes a load failure through untouched", async () => {
    await expect(printHtml({ html: UNLOADABLE, deviceName: null })).rejects.toBe(printer.loadError);
    expect(printer.windows[0]?.printed).toBeNull();
    expect(printer.windows[0]?.destroyed).toBe(true);
  });
});
