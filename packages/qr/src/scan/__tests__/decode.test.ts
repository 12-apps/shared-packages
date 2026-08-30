/**
 * Which decoder gets picked, and why the probe is not just "does the
 * constructor exist".
 *
 * The failure this guards is quiet: a browser that ships `BarcodeDetector`
 * without QR support constructs fine and throws at DETECT time — one frame
 * later, inside the loop, where the only symptom is a camera that never finds
 * anything.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { createQrDecoder } from "../decode";

const FRAME = { data: new Uint8ClampedArray(4), width: 1, height: 1 } as ImageData;

function stubDetector(options: {
  formats?: string[];
  formatsThrow?: boolean;
  constructThrow?: boolean;
  found?: { rawValue: string }[];
}) {
  class FakeDetector {
    constructor() {
      if (options.constructThrow) throw new Error("unsupported format");
    }
    async detect() {
      return options.found ?? [];
    }
    static async getSupportedFormats() {
      if (options.formatsThrow) throw new Error("nope");
      return options.formats ?? [];
    }
  }
  vi.stubGlobal("BarcodeDetector", FakeDetector);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("createQrDecoder", () => {
  it("uses the platform detector when it actually does QR", async () => {
    stubDetector({ formats: ["qr_code", "ean_13"], found: [{ rawValue: "hello" }] });
    const decode = await createQrDecoder();
    await expect(decode(FRAME)).resolves.toBe("hello");
  });

  it("returns null rather than throwing when a frame holds no code", async () => {
    stubDetector({ formats: ["qr_code"], found: [] });
    const decode = await createQrDecoder();
    await expect(decode(FRAME)).resolves.toBeNull();
  });

  it("falls back when the API exists but does not list qr_code", async () => {
    // Constructing with an unsupported format throws at DETECT time, not at
    // construction — so the support list has to be read first.
    stubDetector({ formats: ["ean_13"] });
    const decode = await createQrDecoder();
    // jsQR on a 1x1 blank frame finds nothing, which is the point: we got a
    // working decoder rather than an exception.
    await expect(decode(FRAME)).resolves.toBeNull();
  });

  it("falls back when the support probe itself throws", async () => {
    stubDetector({ formatsThrow: true });
    const decode = await createQrDecoder();
    await expect(decode(FRAME)).resolves.toBeNull();
  });

  it("falls back when the constructor throws", async () => {
    stubDetector({ formats: ["qr_code"], constructThrow: true });
    const decode = await createQrDecoder();
    await expect(decode(FRAME)).resolves.toBeNull();
  });

  it("falls back where there is no platform detector at all (WebKit)", async () => {
    // On iOS Safari the "fallback" is not a fallback — it is the whole feature.
    vi.stubGlobal("BarcodeDetector", undefined);
    const decode = await createQrDecoder();
    await expect(decode(FRAME)).resolves.toBeNull();
  });
});
