/**
 * FUT-4401 — the card pane's elapsed wait opens the confirmation screen on its
 * timed-out face, under the new names AND the deprecated ones `resumeSurface`
 * still publishes, so an adopter reading either sees the same screen.
 */
import { describe, expect, it, vi } from "vitest";

import { withElapsedWait } from "../resolution-actions";

function surface() {
  const checkAgain = vi.fn();
  return {
    checkAgain,
    value: { awaitingTimedOut: false, awaitingCheckAgain: checkAgain, resumeTimedOut: false, resumeCheckAgain: checkAgain },
  };
}

describe("withElapsedWait (FUT-4401)", () => {
  it("leaves the surface alone while the card's wait has not run out", () => {
    const { value } = surface();
    expect(withElapsedWait(value, false, vi.fn())).toBe(value);
  });

  it("says the wait ran out under both spellings, and either check-again puts the spinner back", () => {
    const { value, checkAgain } = surface();
    const setElapsed = vi.fn();
    const folded = withElapsedWait(value, true, setElapsed);

    expect(folded.awaitingTimedOut).toBe(true);
    expect(folded.resumeTimedOut).toBe(true);
    folded.resumeCheckAgain();
    expect(setElapsed).toHaveBeenLastCalledWith(false);
    expect(checkAgain).toHaveBeenCalledTimes(1);
    folded.awaitingCheckAgain();
    expect(checkAgain).toHaveBeenCalledTimes(2);
  });
});
