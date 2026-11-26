import { useEffect, useRef } from "react";

/**
 * Honour a host's `DiscountsScreenProps.createRequested`: open once the
 * screen is `ready`, then report it handled. A latch holds until the request
 * is dropped, so re-renders before the host commits that (or StrictMode's
 * second effect) cannot reopen a dialog already being typed in. `open` and
 * `handled` are read through refs so an inline arrow does not re-run the effect.
 */
export function useOpenOnCreateRequest(
  requested: boolean,
  ready: boolean,
  open: () => void,
  handled?: () => void,
): void {
  const latest = useRef({ open, handled });
  latest.current = { open, handled };
  const done = useRef(false);
  useEffect(() => {
    if (!requested) {
      done.current = false;
      return;
    }
    if (!ready || done.current) return;
    done.current = true;
    latest.current.open();
    latest.current.handled?.();
  }, [requested, ready]);
}
