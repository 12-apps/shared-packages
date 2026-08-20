/**
 * Apple-device detection for a SPA's social-login buttons, as a hook.
 *
 * The DETECTION itself is `@12-apps/auth`'s `detectAppleDevice`,
 * imported rather than re-implemented: platform quirks (iPadOS 13+ reporting as a
 * Mac being the famous one) are exactly the thing that must have one answer, and
 * this used to be a second copy of that function inside a private SPA package.
 * That subpath is a standalone module with no imports, so a browser bundle takes
 * only it and never the Next-only parts of `@12-apps/auth`.
 *
 * What is genuinely new here is the HOOK, and specifically `isHydrated`. The Apple
 * button is shown only on Apple devices, but it is rendered optimistically before
 * hydration so it never flashes in on a fast device — a caller needs to tell the
 * two phases apart to do that.
 */
import { useEffect, useState } from 'react';

import { detectAppleDevice, type DeviceInfo } from '@12-apps/auth';

/** Device info plus an `isHydrated` flag (false on the first render). */
export interface DeviceDetection extends DeviceInfo {
  isHydrated: boolean;
}

/** {@link detectAppleDevice} plus a hydration flag. */
export function useDeviceDetection(): DeviceDetection {
  const [info, setInfo] = useState<DeviceInfo>(() => detectAppleDevice());
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    setInfo(detectAppleDevice());
    setIsHydrated(true);
  }, []);

  return { ...info, isHydrated };
}
