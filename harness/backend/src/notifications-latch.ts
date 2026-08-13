/**
 * A gate the suite closes to hold every notification send open mid-flight.
 *
 * It exists for one class of test: two dispatchers racing one delivery. Without
 * it the first dispatcher finishes before the second even reads, so a
 * read-validate-write implementation would pass — which is exactly how the
 * equivalent double-send bug survived a full suite elsewhere in this estate.
 * With the send held, the second dispatcher is guaranteed to be inside the
 * window, and the only thing that can stop it sending is a real claim.
 *
 * Its own module because it is host test scaffolding rather than host wiring,
 * and because `notifications-host.ts` is at its size limit.
 */
export interface OutboxLatch {
  /** Hold every subsequent send until {@link OutboxLatch.release}. */
  hold(): void;
  /** Let the held sends through. Safe to call when nothing is held. */
  release(): void;
  /** Awaited from inside the recording driver; resolved unless held. */
  wait(): Promise<void>;
}

export function createOutboxLatch(): OutboxLatch {
  const state: { gate: Promise<void> | null; open: (() => void) | null } = {
    gate: null,
    open: null,
  };
  return {
    hold() {
      state.gate = new Promise<void>((resolve) => {
        state.open = resolve;
      });
    },
    release() {
      state.open?.();
      state.gate = null;
      state.open = null;
    },
    wait: () => state.gate ?? Promise.resolve(),
  };
}
