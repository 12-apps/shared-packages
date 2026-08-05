/**
 * Device detection utilities for determining Apple device usage
 * Used to conditionally show Apple Sign-In button
 */

export interface DeviceInfo {
  isAppleDevice: boolean;
  isIOS: boolean;
  isMac: boolean;
  isSafari: boolean;
  userAgent: string;
}

/**
 * Detects if the current device is an Apple device (iOS or macOS)
 * This is used to determine whether to show the Apple Sign-In button
 *
 * @param userAgent - Optional user agent string (for SSR usage)
 * @returns DeviceInfo object with detection results
 */
const SSR_DEFAULTS: DeviceInfo = {
  isAppleDevice: false,
  isIOS: false,
  isMac: false,
  isSafari: false,
  userAgent: "",
};

// An iPad on iOS 13+ reports itself as a Mac, so it takes three strategies to
// recognise: the plain iOS user agent, the Mac+Mobile pairing an SSR string
// gives us, and multi-touch support on the client.
const detectIOS = (uaLower: string): boolean => {
  if (/iphone|ipad|ipod/.test(uaLower)) return true;
  if (uaLower.includes("mac") && uaLower.includes("mobile")) return true;

  return (
    typeof navigator !== "undefined" &&
    "maxTouchPoints" in navigator &&
    navigator.maxTouchPoints > 1 &&
    uaLower.includes("mac")
  );
};

const detectSafari = (uaLower: string): boolean =>
  /safari/.test(uaLower) && !/chrome|chromium|edg/.test(uaLower);

export function detectAppleDevice(userAgent?: string): DeviceInfo {
  // For SSR, return defaults if no userAgent provided
  if (typeof window === "undefined" && !userAgent) {
    return SSR_DEFAULTS;
  }

  const ua = userAgent ?? (typeof navigator !== "undefined" ? navigator.userAgent : "");
  const uaLower = ua.toLowerCase();

  const isIOS = detectIOS(uaLower);
  const isMac = /macintosh|mac os x/.test(uaLower) && !isIOS;

  return {
    isAppleDevice: isIOS || isMac,
    isIOS,
    isMac,
    isSafari: detectSafari(uaLower),
    userAgent: ua,
  };
}

/**
 * Check if Apple Sign-In should be displayed
 * Shows on all Apple devices (iOS and macOS) for better UX
 * Can also be shown on non-Apple devices but Apple recommends showing it primarily on their devices
 *
 * @param forceShow - Always show Apple Sign-In regardless of device
 * @param userAgent - Optional user agent for SSR
 * @returns boolean indicating whether to show Apple Sign-In
 */
export function shouldShowAppleSignIn(forceShow = false, userAgent?: string): boolean {
  if (forceShow) return true;

  const deviceInfo = detectAppleDevice(userAgent);
  return deviceInfo.isAppleDevice;
}
