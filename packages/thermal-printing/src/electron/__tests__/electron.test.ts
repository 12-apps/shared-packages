import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * `printHtml`, against a stand-in `BrowserWindow`.
 *
 * `electron` cannot be imported outside an Electron runtime, so the module is
 * replaced by a window that records what it was asked. The fake operating
 * system answers by DEVICE: {@link REFUSING} refuses with a reason,
 * {@link SILENT} refuses with none, anything else prints. A document equal to
 * {@link UNLOADABLE} fails to load.
 *
 * The fake renderer lays a document out at the size it declares with
 * {@link sized} (72 x 90 mm when it declares none), and a document marked
 * {@link DEBUGGED} is opened with a debugger somebody else already attached.
 */

const REFUSING = "refusing-printer";
const SILENT = "silently-refusing-printer";
const UNLOADABLE = "<unloadable>";
const DEBUGGED = "<!--debugged-->";

/** A document the fake renderer lays out `widthMm` x `heightMm`. */
const sized = (widthMm: number, heightMm: number): string => `<!--body:${widthMm}x${heightMm}--><p>hi</p>`;

const printer = vi.hoisted(() => ({
  loadError: new Error("ERR_INVALID_URL"),
  windows: [] as {
    options: unknown;
    loaded: string | null;
    printed: Record<string, unknown> | null;
    destroyed: boolean;
    attached: string[];
    detached: number;
  }[],
}));

vi.mock("electron", () => ({
  BrowserWindow: class {
    private readonly record: (typeof printer.windows)[number];

    constructor(options: unknown) {
      this.record = { options, loaded: null, printed: null, destroyed: false, attached: [], detached: 0 };
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
      debugger: unknown;
    } {
      return {
        debugger: {
          isAttached: () => this.document().includes("<!--debugged-->"),
          attach: (version: string) => this.record.attached.push(version),
          detach: () => (this.record.detached += 1),
          sendCommand: (method: string) =>
            Promise.resolve(
              method === "DOM.getBoxModel" ? { model: this.bodyPx() } : { root: { nodeId: 1 }, nodeId: 2 },
            ),
        },
        print: (options, done) => {
          this.record.printed = options;
          if (options.deviceName === "refusing-printer") done(false, "Print job canceled");
          else if (options.deviceName === "silently-refusing-printer") done(false, "");
          else done(true, "");
        },
      };
    }

    private document(): string {
      return decodeURIComponent(this.record.loaded ?? "");
    }

    /** The declared body, in CSS pixels (96 per inch), as a box model reports it. */
    private bodyPx(): { width: number; height: number } {
      const [, width = "72", height = "90"] = /<!--body:([\d.]+)x([\d.]+)-->/.exec(this.document()) ?? [];
      return { width: (Number(width) * 96) / 25.4, height: (Number(height) * 96) / 25.4 };
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

  it("lays the ticket out on the roll, never on Electron's A4 default (FUT-3009)", async () => {
    // A 72 mm body (as layout rounds it), 90 mm tall: the 80 mm roll, 90 mm of
    // ticket plus the tail.
    await printHtml({ html: sized(71.97, 90), deviceName: "Bematech MP-4200 HS" });

    expect(printer.windows[0]?.printed).toMatchObject({
      pageSize: { width: 80_000, height: 100_000 },
      margins: { marginType: "printableArea" },
      scaleFactor: 100,
      landscape: false,
    });
  });

  it("prints a 48 mm body on the 58 mm roll", async () => {
    await printHtml({ html: sized(48, 120), deviceName: null });

    expect(printer.windows[0]?.printed).toMatchObject({ pageSize: { width: 58_000, height: 130_000 } });
  });

  it("takes the roll the caller names over the one the body suggests", async () => {
    await printHtml({ html: sized(48, 120), deviceName: null, paperWidthMm: 80 });

    expect(printer.windows[0]?.printed).toMatchObject({ pageSize: { width: 80_000 } });
  });

  it("renders at zoom 1, so nothing but the page decides the size on paper", async () => {
    await printHtml({ html: "<p>hi</p>", deviceName: null });

    expect(printer.windows[0]?.options).toMatchObject({ webPreferences: { zoomFactor: 1 } });
  });

  it("detaches the debugger it attached to measure, and leaves somebody else's", async () => {
    await printHtml({ html: "<p>hi</p>", deviceName: null });
    await printHtml({ html: `${DEBUGGED}<p>hi</p>`, deviceName: null });

    const [own, theirs] = printer.windows;
    expect(own).toMatchObject({ attached: ["1.3"], detached: 1 });
    expect(theirs).toMatchObject({ attached: [], detached: 0 });
  });
});
