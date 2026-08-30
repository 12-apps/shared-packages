/**
 * Turning a camera frame into the text a QR carries.
 *
 * Two implementations, because there is no one way that works:
 *
 * - **`BarcodeDetector`**, the platform's own. Chrome and Edge have it,
 *   including on Android, which is most of this storefront's traffic. It
 *   decodes on a background thread with the OS's own detector, so it is both
 *   faster and cheaper than anything shipped in JS.
 * - **`jsqr`**, lazily imported, for everyone else. WebKit has never shipped
 *   the Shape Detection API and Firefox has not either, so on **iOS Safari the
 *   fallback is not a fallback — it is the whole feature**, and on some
 *   markets that is most of the traffic.
 *
 * The import is deferred to the moment the fallback is actually chosen, so the
 * majority who never need jsQR never download it, and nobody pays for it just
 * by opening a page that happens to offer scanning.
 */

/** The one shape both decoders are wrapped into. `null` means "no code here". */
export type QrDecoder = (frame: ImageData) => Promise<string | null>;

/**
 * `BarcodeDetector` as much of it as this file uses.
 *
 * Hand-declared because TypeScript's DOM lib does not carry the Shape
 * Detection API. Narrow on purpose — the alternative is `any`, which the repo
 * does not allow and which would hide the day the shape changes.
 */
interface DetectedBarcode {
  rawValue: string;
}

interface BarcodeDetectorLike {
  detect(source: ImageData): Promise<DetectedBarcode[]>;
}

interface BarcodeDetectorCtor {
  new (init: { formats: string[] }): BarcodeDetectorLike;
  getSupportedFormats(): Promise<string[]>;
}

function nativeCtor(): BarcodeDetectorCtor | undefined {
  return (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
}

/**
 * The native detector, if it is there AND actually does QR.
 *
 * The constructor existing is not the same as the format being supported —
 * some builds ship the API with a subset of formats — and constructing it with
 * an unsupported format throws at detect time rather than at construction. So
 * the support list is read first, and anything unexpected falls through to
 * jsQR rather than leaving the user with a camera that never finds anything.
 */
async function nativeDecoder(): Promise<QrDecoder | null> {
  const Ctor = nativeCtor();
  if (!Ctor) return null;
  try {
    const formats = await Ctor.getSupportedFormats();
    if (!formats.includes("qr_code")) return null;
    const detector = new Ctor({ formats: ["qr_code"] });
    return async (frame) => {
      const found = await detector.detect(frame);
      return found[0]?.rawValue ?? null;
    };
  } catch {
    return null;
  }
}

/** The JS decoder, downloaded only once somebody without the native one scans. */
async function fallbackDecoder(): Promise<QrDecoder> {
  const { default: jsQR } = await import("jsqr");
  return async (frame) => {
    // `dontInvert`: a printed code is dark-on-light, and asking jsQR to also
    // try the inverse doubles the work on every frame that finds nothing —
    // which, while somebody is still aiming, is all of them.
    const found = jsQR(frame.data, frame.width, frame.height, { inversionAttempts: "dontInvert" });
    return found?.data ?? null;
  };
}

/**
 * Pick a decoder for this browser.
 *
 * Called once per scanning session rather than per frame: the native support
 * probe is async, and doing it inside the loop would put a promise between the
 * camera and every frame it produces.
 */
export async function createQrDecoder(): Promise<QrDecoder> {
  return (await nativeDecoder()) ?? (await fallbackDecoder());
}
