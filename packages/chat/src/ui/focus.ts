/**
 * The composer's focus, reported to the host: `true` when the field takes it,
 * `false` when it loses it — and `false` when the field goes away while it
 * holds it (the thread turned read-only, the screen closed), so a host that
 * hides its chrome while someone types never stays hidden.
 */

import { useEffect, useRef } from "react";

export function useFocusReport(onFocusChange?: (focused: boolean) => void): { onFocus: () => void; onBlur: () => void } {
  const latest = useRef(onFocusChange);
  const focused = useRef(false);
  useEffect(() => {
    latest.current = onFocusChange;
  }, [onFocusChange]);
  useEffect(
    () => () => {
      if (focused.current) latest.current?.(false);
    },
    [],
  );
  const report = (next: boolean): void => {
    focused.current = next;
    latest.current?.(next);
  };
  return { onFocus: () => report(true), onBlur: () => report(false) };
}
