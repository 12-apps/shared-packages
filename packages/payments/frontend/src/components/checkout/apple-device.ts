/**
 * Whether this device is an Apple one (FUT-4399): iOS, iPadOS (which reports
 * itself as a Mac), or Safari on macOS. On those the buyer pays with Apple
 * Pay, and a Google Pay button is noise at best — Google's `isReadyToPay`
 * answers `true` there anyway (it works in Safari and in every iOS browser),
 * so the device is the only gate that can say no.
 *
 * Pure: it reads the `Navigator` slice it is handed, so every device is a
 * unit test. Chrome, Firefox and Edge on macOS are NOT Apple devices for this
 * purpose — Google Pay is a first-class wallet in them.
 */

/** The slice of `Navigator` this decision reads. */
export interface DeviceSignals {
  userAgent: string;
  maxTouchPoints?: number;
  userAgentData?: { platform?: string };
}

const IOS_UA = /\b(iPhone|iPad|iPod)\b/;
const MAC_UA = /\bMacintosh\b/;
/** Engines that are not Safari, though their UA says "Safari" too. */
const NOT_SAFARI_UA = /\b(Chrome|Chromium|CriOS|Edg|EdgiOS|OPR|OPiOS|Firefox|FxiOS)\//;
const SAFARI_UA = /\bVersion\/[\d.]+.*\bSafari\//;

const NON_APPLE_PLATFORMS = new Set(["Android", "Windows", "Linux", "Chrome OS", "Chromium OS"]);

export function isAppleDevice(device: DeviceSignals): boolean {
  const platform = device.userAgentData?.platform;
  // Client Hints, when the engine sends them (Chromium). Safari and every real
  // iOS browser send none, so they fall through to the UA. "macOS" is not
  // decided here: a Chromium on a Mac says so too, and only the UA tells it
  // from Safari (an emulated Safari UA on Chromium reports "macOS" as well).
  if (platform === "iOS" || platform === "iPadOS") return true;
  // A known non-Apple platform is never Apple, whatever UA it was handed (an
  // Android tablet in desktop mode sends "Macintosh" and has a touchscreen).
  if (platform !== undefined && NON_APPLE_PLATFORMS.has(platform)) return false;
  const ua = device.userAgent;
  // Every iOS browser (CriOS, FxiOS, EdgiOS…) is WebKit under Apple's rules.
  if (IOS_UA.test(ua)) return true;
  if (!MAC_UA.test(ua)) return false;
  // iPadOS asks for the desktop site by default: "Macintosh", but with a
  // touchscreen, which no Mac has.
  if ((device.maxTouchPoints ?? 0) > 1) return true;
  return SAFARI_UA.test(ua) && !NOT_SAFARI_UA.test(ua);
}

/** {@link isAppleDevice} for the page this runs in; `false` outside a browser. */
export function onAppleDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return isAppleDevice(navigator as Navigator & { userAgentData?: { platform?: string } });
}
